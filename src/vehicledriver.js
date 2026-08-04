// Driving a vehicle without hands on it.
//
// The whole module writes `vehicle.input` and reads `vehicle.pos/quat/speed`
// and nothing else. That narrowness is deliberate and is what makes it
// testable: the AUTOPILOT toggle on /chartest.html's VEHICLE tab drives the
// range hog through this exact code with no Game, no squad and no soldier
// anywhere near it, so "does the controller work" and "does the AI decide to
// drive" are separate questions with separate answers.
//
// It is a pure-pursuit controller with a speed governor, not a path follower.
// There is no path: it is handed a point and closes on it. Anything smarter
// belongs above this, in whatever chooses the point.
//
// GROUND IS SAMPLED THROUGH `vehicle.groundAt`, NEVER `world.heightAt`. On
// map-3 the baked heightfield reads a flat 0 across stretches where the
// authored floor is metres lower (VEHICLE_PLAN.md, "the baked heightfield
// disagrees with the authored floor"), so gradient probes against `heightAt`
// would be steering around terrain that is not there — and it would be
// diagnosed as an AI bug for a week before anyone suspected the bake.

import * as THREE from 'three';
import { CFG } from './config.js';

const _to = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _up = new THREE.Vector3();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class VehicleDriver {
  constructor(vehicle) {
    this.v = vehicle;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.reverseSteer = 0;
    this.arrived = false;
  }

  // Hands off. Leaves the vehicle coasting to a stop under its own parking
  // brake rather than holding the brake down, so a driver that dies does not
  // leave a hog pinned mid-slope by a control nobody is touching.
  release() {
    const i = this.v.input;
    i.throttle = 0; i.brake = 0; i.steer = 0; i.handbrake = false;
    this.stuckTimer = 0;
    this.reverseTimer = 0;
  }

  // Drive at a world point. Returns true once inside the arrival radius.
  drive(dt, tx, tz) {
    const v = this.v;
    const D = CFG.vehicle.driver;
    const i = v.input;

    _to.set(tx - v.pos.x, 0, tz - v.pos.z);
    const dist = _to.length();

    // Arrived. Brake rather than coast: the point of arriving is usually that
    // somebody wants to get out, and a hog still rolling at 4 m/s is one that
    // drops its squad a further 20 m down the road.
    if (dist <= D.arriveRadius) {
      i.throttle = 0;
      i.steer = 0;
      i.brake = Math.abs(v.speed) > 0.4 ? 1 : 0;
      i.handbrake = false;
      this.arrived = true;
      return true;
    }
    this.arrived = false;

    _fwd.set(0, 0, 1).applyQuaternion(v.quat);
    _fwd.y = 0;
    _fwd.normalize();
    _left.set(1, 0, 0).applyQuaternion(v.quat);   // +X is chassis left
    _left.y = 0;
    _left.normalize();

    // Signed bearing to the target: positive means it is off to the left, which
    // is the same sign convention the player's A key uses.
    const bearing = Math.atan2(_to.dot(_left), _to.dot(_fwd));

    // --- unstick -----------------------------------------------------------
    // Asking for throttle and going nowhere is the one failure this controller
    // cannot steer out of, because a nose against a rock produces exactly the
    // same bearing error forever. Back off and try again with opposite lock.
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      i.throttle = -1;
      i.brake = 0;
      i.steer = this.reverseSteer;
      i.handbrake = false;
      v.wake();
      return false;
    }
    if (i.throttle > 0 && Math.abs(v.speed) < D.stuckSpeed) {
      this.stuckTimer += dt;
      if (this.stuckTimer >= D.stuckTime) {
        this.stuckTimer = 0;
        this.reverseTimer = D.reverseTime;
        // Reverse with the wheels turned the OTHER way, so backing up actually
        // changes the approach angle instead of retracing the line that just
        // failed.
        this.reverseSteer = bearing >= 0 ? -1 : 1;
        return false;
      }
    } else {
      this.stuckTimer = 0;
    }

    // --- steering ----------------------------------------------------------
    const ground = this._probeGround(dist);
    let steer = clamp(bearing / D.steerScale, -1, 1) + ground.steer;
    steer = clamp(steer, -1, 1);

    // --- speed governor ----------------------------------------------------
    // Four separate factors, and they are separate on purpose: how hard the
    // corner is, how close the target is, how broken the ground ahead is, and
    // how far over the vehicle is already leaning. Folding the first two
    // together produced a hog that crawled the last 30 m of every straight
    // approach; the last two are what stop it arriving on its roof.
    const turnFactor = 1 - clamp(Math.abs(bearing) / D.slowAngle, 0, 1) * D.turnSlow;
    const arriveFactor = clamp(dist / D.slowRadius, D.minApproach, 1);
    // Attitude, read off the chassis rather than the terrain: it is the one
    // measure that already accounts for what the suspension is doing, and a hog
    // that is ALREADY leaning is the one about to go over.
    _up.set(0, 1, 0).applyQuaternion(v.quat);
    const leanFactor = clamp(1 - (1 - _up.y) * D.leanSlow, D.minApproach, 1);
    const want = D.cruiseSpeed * turnFactor * arriveFactor * ground.speed * leanFactor;

    if (v.speed < want - D.speedBand) {
      i.throttle = 1;
      i.brake = 0;
    } else if (v.speed > want + D.speedBand) {
      i.throttle = 0;
      // Proportional, so a governor overshoot is a lift rather than a stab on
      // the brake pedal that upsets the car mid-corner.
      i.brake = clamp((v.speed - want) / D.brakeBand, 0, 1);
    } else {
      i.throttle = 0;
      i.brake = 0;
    }

    i.steer = steer;
    i.handbrake = false;
    v.wake();
    return false;
  }

  // Three probes at a speed-scaled lookahead — the faster it is going the
  // further ahead it has to care — comparing the ground there against the
  // ground under the vehicle now. Returns both a steering bias and a speed
  // factor, from one set of samples, because they are answers to the same
  // question and sampling twice would be the same cost twice.
  //
  // BOTH DIRECTIONS COUNT. The first version only treated a RISE as an
  // obstacle, which is the half that strands you — and the half that does not
  // hurt. Two of four hogs ended an eight-minute battle upside down on high
  // ground, because a ledge is invisible to a check that only looks for walls
  // and a Warthog leaving one at 18 m/s lands on its roof.
  //
  // Deliberately NOT a full obstacle solver. It handles hillsides and ledges
  // and leaves everything else to the unstick reverse, which is the honest
  // division: cheap avoidance for the common cases, recovery for the rest.
  _probeGround(dist) {
    const v = this.v;
    const D = CFG.vehicle.driver;
    const look = Math.min(
      Math.max(D.lookMin, Math.abs(v.speed) * D.lookTime),
      Math.max(D.lookMin, dist),        // never probe past the target itself
    );
    const here = v.groundAt(v.pos.x, v.pos.z);
    const probe = (side) => {
      const px = v.pos.x + _fwd.x * look + _left.x * side * D.probeWidth;
      const pz = v.pos.z + _fwd.z * look + _left.z * side * D.probeWidth;
      return v.groundAt(px, pz) - here;
    };
    const bad = (d) => d > D.climbRise || d < -D.dropFall;
    const c = probe(0);
    // Speed always responds to what is ahead, even when it is drivable — the
    // steering only has to act once it is not.
    const rough = Math.max(0, Math.abs(c) - D.roughIgnore);
    const speed = clamp(1 - rough * D.roughSlow, D.roughMin, 1);
    if (!bad(c)) return { steer: 0, speed };
    const l = probe(1), r = probe(-1);
    // Both sides as bad as the middle: nothing to steer toward, so do not pick
    // a direction at random and commit to it — slow right down and let the
    // unstick reverse handle it if it comes to that.
    if (bad(l) && bad(r)) return { steer: 0, speed: D.roughMin };
    if (bad(l)) return { steer: -D.avoidStrength, speed: D.roughMin };
    if (bad(r)) return { steer: D.avoidStrength, speed: D.roughMin };
    return { steer: Math.abs(l) < Math.abs(r) ? D.avoidStrength : -D.avoidStrength, speed: D.roughMin };
  }
}
