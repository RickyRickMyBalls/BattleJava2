// Vehicles — chassis, suspension and tyres.
//
// See VEHICLE_PLAN.md for the whole arc. This module is Phase 1 (spawn) plus
// Phase 2 (drive), and it stops there deliberately: no seats but the driver's,
// no turret, no damage.
//
// THE MODEL: a raycast vehicle. The chassis is a rigid body with full 3-DOF
// rotation; each of the four corners casts a ray for the ground, a spring
// pushes along the strut, and a tyre model turns the contact patch's velocity
// into force. No physics engine — `package.json` carries three and
// three-mesh-bvh and nothing else, and the codebase's whole idiom is
// analytic-or-BVH. A WASM rigid-body library for one jeep would also bring a
// second source of truth for "where is the ground" and its own substepping to
// reconcile with `game._simStep`'s, which is what makes 8x fast-forward
// numerically identical to 8 real frames.
//
// Almost nothing here is a special case. Weight transfer, squat, dive, body
// roll and the Warthog's signature power-on slide are all CONSEQUENCES of four
// independent springs, a centre of mass above the ground, and a friction budget
// that longitudinal and lateral demand have to share. There is no drift code,
// no "is cornering" flag, and there should never be one — if the car does not
// slide, the fix is a number in CFG, not a branch in here.
//
// COORDINATE FRAME. The chassis frame is what `prepareVehicle` establishes:
// origin on the ground at the centre of the wheelbase, +Z forward, +Y up, and
// therefore +X to the LEFT (forward x up). Every `local*` field below is in
// that frame; every `pos`/`vel`/`angVel` is world. `pos` is the CENTRE OF MASS,
// not the group origin — the group is placed from it at sync time.

import * as THREE from 'three';
import { CFG, TEAM } from './config.js';
import { pushOutCoverBoxes } from './cover.js';

const V = CFG.vehicle;

// Module scratch. Never pass one of these into a function that also writes it
// — that is the historic all-bullets-miss bug in combat.js, and the same trap
// exists here with twice the state.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _force = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _torque = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _box = new THREE.Box3();
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _hullHit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const _hullPoint = new THREE.Vector3();
const _hullProbe = new THREE.Vector3();

function teamOfMarker(name) {
  if (/_BLUE/i.test(name)) return TEAM.BLUE;
  if (/_RED/i.test(name)) return TEAM.RED;
  return null;
}

function indexRefs(root) {
  const refs = {};
  root.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (!n) return;
    if (n.startsWith('ref_') || n.startsWith('wheel_') || n.startsWith('rim_')
      || n.startsWith('collision_')) refs[n] = o;
  });
  return refs;
}

// One suspension corner. Holds the measured rig geometry (which never changes)
// and the per-step contact state (which changes every substep).
class Wheel {
  constructor(id, front, left, refs) {
    this.id = id;
    this.front = front;          // steered, and paired with the other front for anti-roll
    this.left = left;
    this.contactRef = refs.contact;   // moved in Y to show compression
    this.steerRef = refs.steer;       // turned about its own Y to steer
    this.spinRef = refs.spin;         // turned about its own Z to roll

    this.localXZ = new THREE.Vector3();   // rest contact point, chassis frame
    this.localHard = new THREE.Vector3(); // strut top, chassis frame
    this.baseY = 0;                       // contactRef's authored local Y
    this.steerBase = new THREE.Quaternion();
    this.spinBase = new THREE.Quaternion();
    this.spinSign = 1;

    this.grounded = false;
    this.compression = 0;        // metres, 0 = fully extended
    this.bump = 0;               // metres past the end of the strut
    this.load = 0;               // N along the strut
    this.contact = new THREE.Vector3();
    this.force = new THREE.Vector3();  // this substep's total, applied in a second pass
    this.spin = 0;               // radians
    this.slip = 0;               // |lateral force| / budget, 0..1 — for FX later
  }
}

export class Vehicle {
  constructor(key, group, team, world) {
    this.key = key;
    this.group = group;
    this.team = team;
    this.world = world;
    this.refs = indexRefs(group);
    this.tune = V[key] || V.warthog;

    // --- Rigid body state (world) ---
    this.pos = new THREE.Vector3();      // centre of mass
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();

    this.driver = null;                  // Player, when one is in the seat
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.steerAngle = 0;                 // radians, eased toward the input
    this.speed = 0;                      // signed forward speed, m/s — for HUD/AI
    this.asleep = false;
    this.stillTimer = 0;

    this.wheels = [];
    this.hullPoints = [];                // chassis-frame hull sample points
    this._measureRig();
    this._deriveConstants();
  }

  // Everything the rig can tell us, read ONCE with the group at identity so a
  // node's world transform IS its chassis-frame transform. Doing this per frame
  // would be the obvious way to write it and would also mean the physics reads
  // positions it wrote itself one line earlier.
  _measureRig() {
    const g = this.group;
    g.position.set(0, 0, 0);
    g.quaternion.identity();
    g.updateMatrixWorld(true);

    const T = this.tune;
    const corners = [
      ['front_left', true, true], ['front_right', true, false],
      ['rear_left', false, true], ['rear_right', false, false],
    ];
    for (const [name, front, left] of corners) {
      const contact = this.refs[`ref_contact_${name}`];
      const steer = this.refs[`ref_steer_${name}`];
      const spin = this.refs[`wheel_${name}`];
      if (!contact || !steer || !spin) {
        console.warn(`[vehicle] ${this.key}: corner ${name} incomplete — no suspension on it`);
        continue;
      }
      const w = new Wheel(name, front, left, { contact, steer, spin });
      contact.getWorldPosition(w.localXZ);
      w.baseY = contact.position.y;
      w.steerBase.copy(steer.quaternion);
      w.spinBase.copy(spin.quaternion);

      // The strut top. Height is derived so that AT REST — i.e. once the spring
      // has been compressed by the vehicle's own weight — the wheel centre sits
      // at exactly the authored radius above the ground. Pick the geometry to
      // match the physics rather than nudging the model to match a guess.
      w.localHard.set(w.localXZ.x, T.wheelRadius + T.travel * (1 - T.sag), w.localXZ.z);

      // Which way is "forward" for this wheel's spin? Derived rather than
      // assumed: a wheel rotates about its own local Z on this rig, and whether
      // +Z maps to chassis-left or chassis-right decides the sign. Rotating a
      // point at the top of the wheel about chassis +X carries it forward, so
      // the sign is the local Z axis's X component.
      _v1.set(0, 0, 1).applyQuaternion(spin.getWorldQuaternion(_q1));
      w.spinSign = _v1.x >= 0 ? 1 : -1;

      this.wheels.push(w);
    }

    // Hull sample points, from the authored collision shell if it is there and
    // the whole model's bounds if it is not. Corners only: the hull is convex
    // enough that eight points catch anything a 6 m vehicle can drive into, and
    // every extra point is a BVH query per substep.
    const hull = this.refs.collision_warthog
      || this.refs[Object.keys(this.refs).find((k) => k.startsWith('collision_')) || ''];
    _box.makeEmpty();
    if (hull) {
      hull.updateWorldMatrix(true, false);
      hull.geometry.computeBoundingBox();
      _box.copy(hull.geometry.boundingBox).applyMatrix4(hull.matrixWorld);
    } else {
      _box.setFromObject(g);
      console.warn(`[vehicle] ${this.key}: no collision_* shell — hull taken from the render bounds`);
    }
    // Inset, so the skin radius on each point roughly restores the real shell
    // instead of inflating it.
    const inset = this.tune.hullSkin;
    _box.expandByScalar(-inset);
    for (const x of [_box.min.x, _box.max.x]) {
      for (const y of [_box.min.y, _box.max.y]) {
        for (const z of [_box.min.z, _box.max.z]) {
          this.hullPoints.push(new THREE.Vector3(x, y, z));
        }
      }
    }
  }

  _deriveConstants() {
    const T = this.tune;
    const g = CFG.gravity;
    this.mass = T.mass;
    this.com = new THREE.Vector3().fromArray(T.com);

    // Spring rate follows from the sag target rather than being authored, so
    // mass and ride height stay independent knobs. See the CFG note.
    this.sagLen = T.travel * T.sag;
    this.springK = (T.mass * g) / (4 * this.sagLen);
    const cornerMass = T.mass / 4;
    const critical = 2 * Math.sqrt(this.springK * cornerMass);
    this.damperC = T.damping * critical;
    this.damperRebound = T.dampingRebound * critical;
    this.antiRollK = T.antiRoll * this.springK;
    this.bumpStopK = T.bumpStop * this.springK;
    this.rayLen = T.travel + T.wheelRadius;

    // Uniform box inertia, scaled per axis. X is the lateral axis so Ixx is
    // pitch; Y is yaw; Z is the forward axis so Izz is roll.
    const [bw, bh, bl] = T.inertiaBox;
    const [sx, sy, sz] = T.inertiaScale;
    const m12 = T.mass / 12;
    this.inertia = new THREE.Vector3(
      m12 * (bh * bh + bl * bl) * sx,
      m12 * (bw * bw + bl * bl) * sy,
      m12 * (bw * bw + bh * bh) * sz,
    );
    this.invInertia = new THREE.Vector3(1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z);
  }

  // Re-read the tuning block after a live edit. The tuning range changes these
  // numbers while the vehicle is driving, and re-deriving the constants is not
  // enough on its own: the strut top's height is a function of `travel` and
  // `sag`, so moving either without moving the hardpoint would change the ride
  // height as a side effect of changing the spring.
  retune() {
    this._deriveConstants();
    const y = this.tune.wheelRadius + this.tune.travel * (1 - this.tune.sag);
    for (const w of this.wheels) w.localHard.y = y;
    this.wake();
  }

  get yaw() {
    _v1.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(_v1.x, _v1.z);
  }

  // Place the body from a ground position and a heading — the spawn path, and
  // the only place that writes the transform without going through physics.
  placeAt(x, groundY, z, yaw) {
    this.quat.setFromAxisAngle(_Y, yaw);
    this.pos.copy(this.com).applyQuaternion(this.quat).add(_v1.set(x, groundY, z));
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.wake();
    this.syncVisuals();
  }

  wake() { this.asleep = false; this.stillTimer = 0; }

  // Ground height under a point. Same two-tier rule every other entity uses —
  // authored floor shells first so tunnels and bridges work, the baked
  // heightfield as the fallback — seeded from the heightfield rather than from
  // somewhere safely high, because `groundAt` takes the FIRST floor it meets
  // casting down and would otherwise find roofs.
  groundAt(x, z) {
    const seed = this.world.heightAt(x, z);
    const hit = this.world.collision ? this.world.collision.groundAt(x, seed, z) : null;
    return hit !== null ? hit : seed;
  }

  // ---------------------------------------------------------------- step --

  step(h) {
    if (this.asleep && !this.driver) { this._syncWheelVisuals(); return; }
    const T = this.tune;

    // Steering eases toward the held direction, and full lock is only available
    // at low speed. Without the speed term a hog at 25 m/s spins on the spot
    // the instant A is touched, which is not difficulty, it is a broken car.
    const speedFrac = Math.min(1, Math.abs(this.speed) / T.topSpeed);
    const maxSteer = T.steerMax + (T.steerMaxFast - T.steerMax) * speedFrac;
    const target = this.input.steer * maxSteer;
    const rate = (Math.abs(target) > Math.abs(this.steerAngle) ? T.steerRate : T.steerReturn) * h;
    this.steerAngle += Math.max(-rate, Math.min(rate, target - this.steerAngle));

    _up.set(0, 1, 0).applyQuaternion(this.quat);
    _v3.set(0, 0, 1).applyQuaternion(this.quat);
    this.speed = this.vel.dot(_v3);

    // On its roof (or nearly), no wheel is doing anything. Bail before the
    // strut math starts dividing by a vanishing up-vector.
    const upright = _up.y > 0.15;

    // Two passes, and the split is load-bearing. Every corner must be solved
    // against the SAME body velocity — apply each one as it is computed and the
    // corners done later see a body the earlier ones already pushed, which
    // biases the result by wheel order. It showed up as a persistent 0.4 degree
    // roll driving in a straight line on flat ground, leaning consistently
    // toward whichever side came last in the array.
    for (const w of this.wheels) this._probe(w, upright);
    this._antiRoll();
    for (const w of this.wheels) {
      w.force.set(0, 0, 0);
      if (w.grounded) this._wheelForces(w, h);
    }
    for (const w of this.wheels) {
      if (w.grounded) this._applyForce(w.force, w.contact, h);
    }

    // Gravity and drag act at the centre of mass, so they are velocity changes
    // rather than torques.
    this.vel.y -= CFG.gravity * h;
    const sp = this.vel.length();
    if (sp > 0.01) {
      const drag = (T.airDrag * sp * sp) / this.mass;
      this.vel.addScaledVector(this.vel, -Math.min(1, (drag * h) / sp));
    }
    this.angVel.multiplyScalar(Math.max(0, 1 - T.angularDamping * h));

    this.pos.addScaledVector(this.vel, h);
    this._integrateRotation(h);
    // Eight BVH queries per substep is the most expensive thing in here, and a
    // parked hog cannot drive into anything. Everything that moves still pays.
    if (this.driver || this.vel.lengthSq() > 0.25) this._collideHull(h);
    this._sleepCheck(h);
  }

  // Cast for ground and resolve the spring. The ray runs along the STRUT
  // (chassis-down), not world-down, because that is the axis the wheel actually
  // travels on — but the ground query underneath is a world-down height sample,
  // so the strut length to a horizontal ground plane is the height difference
  // divided by the up-vector's Y. Exact for level ground, and correct to first
  // order on the slopes that matter.
  _probe(w, upright) {
    const T = this.tune;
    w.grounded = false;
    w.bump = 0;
    _v1.copy(w.localHard).sub(this.com).applyQuaternion(this.quat).add(this.pos);
    if (!upright) { w.compression = 0; w.load = 0; return; }

    const groundY = this.groundAt(_v1.x, _v1.z);
    const t = (_v1.y - groundY) / _up.y;
    if (t >= this.rayLen || t < -T.wheelRadius) { w.compression = 0; w.load = 0; return; }

    w.grounded = true;
    const raw = this.rayLen - t;
    w.compression = Math.max(0, Math.min(T.travel, raw));
    // Past the end of the strut. Without a bump stop the spring simply stops
    // getting stiffer and the chassis keeps going — a 4 m drop put the body
    // 0.45 m below its resting height, which on a real landing is the floor
    // pan through the rock. The stop is a second, much harder spring that only
    // exists in the overshoot.
    w.bump = Math.max(0, raw - T.travel);
    w.contact.copy(_v1).addScaledVector(_up, -t);
  }

  // Load transfer across each axle. This is the knob that decides whether the
  // body flops through a corner or stays flat; it is separate from spring rate
  // because stiffening the springs to control roll would also ruin the ride.
  _antiRoll() {
    for (const front of [true, false]) {
      const l = this.wheels.find((w) => w.front === front && w.left);
      const r = this.wheels.find((w) => w.front === front && !w.left);
      if (!l || !r) continue;
      const transfer = this.antiRollK * (l.compression - r.compression);
      l.arb = -transfer;
      r.arb = transfer;
    }
  }

  _wheelForces(w, h) {
    const T = this.tune;

    // Velocity of the contact patch: the body's velocity plus the part that
    // comes from the body rotating about its centre of mass. Without the second
    // term there is no yaw damping at all and the vehicle spins up forever.
    _arm.copy(w.contact).sub(this.pos);
    _v2.copy(this.angVel).cross(_arm).add(this.vel);

    // --- Spring + damper, along the strut ---
    const strutVel = _v2.dot(_up);
    const damp = strutVel < 0 ? this.damperC : this.damperRebound;
    let load = this.springK * w.compression - damp * strutVel + (w.arb || 0)
      + this.bumpStopK * w.bump;
    load = Math.max(0, load);       // a spring cannot pull the ground upward
    w.load = load;
    w.force.addScaledVector(_up, load);

    // --- Tyre ---
    // The wheel's own axes: chassis forward/left turned by the steer angle.
    // Built from the chassis quaternion, so they are automatically square to
    // the strut and no re-orthogonalization is needed.
    const s = w.front ? this.steerAngle : 0;
    const sin = Math.sin(s), cos = Math.cos(s);
    _fwd.set(sin, 0, cos).applyQuaternion(this.quat);
    _side.set(cos, 0, -sin).applyQuaternion(this.quat);
    const vLong = _v2.dot(_fwd);
    const vLat = _v2.dot(_side);

    const mu = (w.front ? T.grip : T.gripRear)
      * (this.input.handbrake && !w.front ? T.handbrakeGrip : 1);
    const budget = mu * load;

    // Longitudinal. Drive falls off linearly to nothing at topSpeed, which is
    // what sets the top speed — there is no speed clamp anywhere.
    let fLong = 0;
    const driven = this.wheels.length;
    if (this.input.throttle > 0) {
      fLong += (T.driveForce / driven) * this.input.throttle
        * Math.max(0, 1 - Math.max(0, this.speed) / T.topSpeed);
    } else if (this.input.throttle < 0) {
      fLong += (T.driveForce / driven) * T.reverseMult * this.input.throttle
        * Math.max(0, 1 - Math.max(0, -this.speed) / (T.topSpeed * T.reverseMult));
    }
    let braking = this.input.brake * T.brakeForce / driven;
    if (this.input.handbrake && !w.front) braking += T.handbrakeForce / 2;
    if (braking > 0) {
      // Clamp so a brake can stop the contact patch but never drag it backwards
      // within one substep — that is what makes hard braking judder otherwise.
      const stop = (Math.abs(vLong) * this.mass) / (driven * h);
      fLong -= Math.sign(vLong) * Math.min(braking, stop);
    }
    // Rolling resistance is COULOMB — a roughly constant drag once the wheel is
    // turning — not viscous. Written as `-v * k * load` it becomes a damper
    // worth 14 kN at speed, which quietly capped the hog at 13.6 m/s with a
    // 25 m/s top speed configured. tanh gives the sign without the jitter a
    // bare Math.sign produces around zero.
    fLong -= Math.tanh(vLong * 4) * T.rollResist * load;

    // Lateral, from slip angle. The +1 in the denominator keeps the angle
    // finite at a standstill; without it a parked vehicle has infinite slip and
    // twitches.
    const slipAngle = Math.atan2(vLat, Math.abs(vLong) + 1);
    let fLat = -T.cornerStiffness * load * slipAngle;
    fLat = Math.max(-budget, Math.min(budget, fLat));

    // The friction circle. THIS is the line that makes the Warthog a Warthog:
    // drive and grip spend the same budget, so a greedy throttle leaves the
    // rear nothing to corner with and the back steps out. Scaling both together
    // rather than clamping each keeps the direction of the combined force
    // honest.
    const mag = Math.hypot(fLong, fLat);
    if (mag > budget && mag > 1e-4) {
      const k = budget / mag;
      fLong *= k; fLat *= k;
      w.slip = 1;
    } else {
      w.slip = budget > 1e-4 ? mag / budget : 0;
    }

    w.force.addScaledVector(_fwd, fLong).addScaledVector(_side, fLat);

    // Visual spin follows the ground speed, plus a kick while the tyre is at
    // its limit under power so wheelspin reads.
    const spinV = vLong + (w.slip >= 1 && this.input.throttle > 0 ? 4 : 0);
    w.spin += w.spinSign * (spinV / T.wheelRadius) * h;
  }

  // Force at a world point: linear at the centre of mass, plus the torque its
  // offset generates. Inertia is diagonal in the BODY frame, so the torque goes
  // into body space, gets divided, and comes back out.
  _applyForce(force, point, h) {
    this.vel.addScaledVector(force, h / this.mass);
    _arm.copy(point).sub(this.pos);
    _torque.copy(_arm).cross(force);
    _q1.copy(this.quat).invert();
    _torque.applyQuaternion(_q1);
    _torque.set(
      _torque.x * this.invInertia.x,
      _torque.y * this.invInertia.y,
      _torque.z * this.invInertia.z,
    );
    _torque.applyQuaternion(this.quat);
    this.angVel.addScaledVector(_torque, h);
  }

  // q' = q + 0.5 * (omega as a pure quaternion) * q * dt
  _integrateRotation(h) {
    _q1.set(this.angVel.x, this.angVel.y, this.angVel.z, 0).multiply(this.quat);
    const k = h * 0.5;
    this.quat.set(
      this.quat.x + _q1.x * k,
      this.quat.y + _q1.y * k,
      this.quat.z + _q1.z * k,
      this.quat.w + _q1.w * k,
    ).normalize();
  }

  // Hull vs the world. Wall shells are the authored blockers on GLB maps; the
  // cover boxes are what the procedural map has instead, and a hog that drives
  // through every crate on the demo map is not finished.
  _collideHull(h) {
    const T = this.tune;
    const col = this.world.collision;
    const boxes = this.world.coverBoxes;
    let bestDepth = 0;
    _v3.set(0, 0, 0);   // accumulated push

    for (const p of this.hullPoints) {
      _v1.copy(p).sub(this.com).applyQuaternion(this.quat).add(this.pos);

      if (col && col.wallBvh) {
        const res = col.wallBvh.closestPointToPoint(_v1, _hullHit, 0, T.hullSkin);
        if (res && res.distance < T.hullSkin) {
          _v2.copy(_v1).sub(res.point);
          const d = _v2.length();
          if (d > 1e-5) {
            _v2.divideScalar(d);
            const depth = T.hullSkin - d;
            if (depth > bestDepth) { bestDepth = depth; _v3.copy(_v2); _hullPoint.copy(_v1); }
          }
        }
      }

      if (boxes && boxes.length) {
        _hullProbe.copy(_v1);
        pushOutCoverBoxes(boxes, _hullProbe, T.hullSkin, 0.1);
        _v2.set(_hullProbe.x - _v1.x, 0, _hullProbe.z - _v1.z);
        const d = _v2.length();
        if (d > bestDepth) { bestDepth = d; _v3.copy(_v2).divideScalar(d); _hullPoint.copy(_v1); }
      }
    }

    if (bestDepth <= 0) return;

    // A wall must never launch the vehicle: an upward component gets mostly
    // thrown away, or driving into a kerb becomes a ramp.
    if (_v3.y > 0) _v3.y *= 0.2;
    if (_v3.lengthSq() < 1e-8) return;
    _v3.normalize();

    this.pos.addScaledVector(_v3, bestDepth);
    const closing = this.vel.dot(_v3);
    if (closing < 0) {
      // An impulse, not a force — so `h` is 1 and the magnitude already carries
      // the mass. Applied at the deepest contact point rather than at the
      // centre, which is what makes a corner strike spin the vehicle instead of
      // stopping it dead square.
      _force.copy(_v3).multiplyScalar(-closing * (1 + T.restitution) * this.mass);
      this._applyForce(_force, _hullPoint, 1);
      this.wake();
    }

    // Last resort: never let the body end up under the world.
    const floor = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < floor - 1) { this.pos.y = floor + 0.5; this.vel.y = Math.max(0, this.vel.y); }
    this.world.clampToMap(this.pos);
  }

  _sleepCheck(h) {
    const T = this.tune;
    const still = this.vel.lengthSq() < T.sleepSpeed * T.sleepSpeed
      && this.angVel.lengthSq() < T.sleepSpin * T.sleepSpin
      && !this.driver
      && this.input.throttle === 0 && this.input.brake === 0;
    this.stillTimer = still ? this.stillTimer + h : 0;
    if (this.stillTimer > T.sleepDelay) {
      this.asleep = true;
      this.vel.set(0, 0, 0);
      this.angVel.set(0, 0, 0);
    }
  }

  // ------------------------------------------------------------- visuals --

  syncVisuals() {
    this.group.quaternion.copy(this.quat);
    _v1.copy(this.com).applyQuaternion(this.quat);
    this.group.position.copy(this.pos).sub(_v1);
    this._syncWheelVisuals();
  }

  _syncWheelVisuals() {
    for (const w of this.wheels) {
      // Compression measured from the RESTING compression, since the authored
      // pose is the vehicle sitting on its springs, not hanging on full droop.
      w.contactRef.position.y = w.baseY + (w.compression - this.sagLen);
      if (w.front) {
        w.steerRef.quaternion.copy(w.steerBase).multiply(_q2.setFromAxisAngle(_Y, this.steerAngle));
      }
      w.spinRef.quaternion.copy(w.spinBase).multiply(_q2.setFromAxisAngle(_Z, w.spin));
    }
  }

  // ------------------------------------------------------------- seating --

  // World transform of a named ref, for cameras and seats. Reads the live
  // hierarchy, so it is only valid after syncVisuals for this frame.
  refWorld(name, out) {
    const r = this.refs[name];
    if (!r) return null;
    return r.getWorldPosition(out);
  }

  enter(player) { this.driver = player; this.wake(); }

  exit() {
    this.driver = null;
    this.input.throttle = 0;
    this.input.brake = 0;
    this.input.steer = 0;
    this.input.handbrake = false;
  }

  // Where a soldier stepping out should land: beside the driver's door, on the
  // ground, clear of the hull.
  exitPoint(out) {
    _v1.set(1, 0, 0).applyQuaternion(this.quat);   // chassis left
    out.copy(this.group.position).addScaledVector(_v1, 2.4);
    out.y = this.groundAt(out.x, out.z);
    return out;
  }
}

export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.vehicles = [];
    this.accum = 0;
    this._spawnAll();
  }

  _groundAt(x, z) {
    const world = this.game.world;
    const seed = world.heightAt(x, z);
    const hit = world.collision ? world.collision.groundAt(x, seed, z) : null;
    return hit !== null ? hit : seed;
  }

  _spawnAll() {
    const spawns = this.game.world.vehicleSpawns || [];
    if (!spawns.length) return;
    if (!this.game.assets.vehicles || !this.game.assets.vehicles.warthog) {
      console.warn('[vehicle] warthog template missing — nothing to spawn');
      return;
    }

    for (const m of spawns) {
      const team = teamOfMarker(m.name);
      // Markers carry POSITION ONLY — maps.js stores `getWorldPosition` and
      // drops the quaternion, and nothing in map-3 authors a rotation on them
      // anyway. Facing is therefore derived: point at the sector they would be
      // driven to, which reads as staged for the push rather than abandoned.
      const yaw = this._yawTowardNearestSector(m.x, m.z);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      for (let i = 0; i < V.perSpawn; i++) {
        const off = (i - (V.perSpawn - 1) / 2) * V.spacing;
        this.spawn('warthog', m.x + rx * off, m.z + rz * off, yaw, team);
      }
    }
    console.log(`[vehicle] spawned ${this.vehicles.length} from ${spawns.length} marker(s)`);
  }

  _yawTowardNearestSector(x, z) {
    let best = null, bestD = Infinity;
    for (const s of this.game.world.sectors) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return 0;
    return Math.atan2(best.x - x, best.z - z);
  }

  spawn(key, x, z, yaw, team = null) {
    const template = this.game.assets.vehicles[key];
    if (!template) return null;

    const group = template.clone(true);
    const v = new Vehicle(key, group, team, this.game.world);
    this.game.scene.add(group);

    // Sit it on the highest ground under its four wheels so no corner starts
    // buried. The springs take it from there.
    let ground = -Infinity;
    for (const w of v.wheels) {
      const wx = x + Math.sin(yaw) * w.localXZ.z + Math.cos(yaw) * w.localXZ.x;
      const wz = z + Math.cos(yaw) * w.localXZ.z - Math.sin(yaw) * w.localXZ.x;
      ground = Math.max(ground, this._groundAt(wx, wz));
    }
    if (ground === -Infinity) ground = this._groundAt(x, z);

    v.placeAt(x, ground, z, yaw);
    this.vehicles.push(v);
    return v;
  }

  // Nearest vehicle a soldier could climb into, or null.
  nearest(pos, range = V.enterRange) {
    let best = null, bestD = range * range;
    for (const v of this.vehicles) {
      const d = pos.distanceToSquared(v.group.position);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  // Fixed-step, with the leftover carried between frames. `_simStep` calls this
  // with the same dt every time (that is what makes 8x fast-forward exact), so
  // the accumulator stays deterministic.
  update(dt) {
    const h = V.substep;
    this.accum = Math.min(this.accum + dt, h * V.maxSubsteps);
    let steps = 0;
    while (this.accum >= h && steps < V.maxSubsteps) {
      for (const v of this.vehicles) v.step(h);
      this.accum -= h;
      steps++;
    }
    for (const v of this.vehicles) v.syncVisuals();
  }

  dispose() {
    for (const v of this.vehicles) this.game.scene.remove(v.group);
    this.vehicles.length = 0;
  }
}
