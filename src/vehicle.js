// Vehicles — chassis, suspension and tyres.
//
// See VEHICLE_PLAN.md for the whole arc. This module is Phase 1 (spawn),
// Phase 2 (drive) and Phase 5 (crew: five seats and the ring gun). It stops
// there deliberately: no damage model, no bots at the wheel.
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
// The retracted gear pose. Identity is not a magic number here — it is what the
// rig authors: every leg carries its DEPLOYED rotation, so zero is up.
const _qIdent = new THREE.Quaternion();
const _Z = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;   // the linkage table is authored in degrees
const _X = new THREE.Vector3(1, 0, 0);
const _tmpBox = new THREE.Box3();
const _mat = new THREE.Matrix4();
// Flight scratch. Deliberately NOT shared with the chassis scratch above: the
// flight pass runs inside step(), between passes that own _v1/_up/_fwd, and the
// historic all-bullets-miss bug in combat.js is exactly this mistake.
const _fA = new THREE.Vector3();
const _fB = new THREE.Vector3();
const _fC = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const _fq2 = new THREE.Quaternion();
const _fq3 = new THREE.Quaternion();

// Door outlines. Shared materials — visibility is per LineSegments, so nothing
// per-instance lives on the material and every hog can point at the same two.
// depthTest off so a door reads through the bodywork in front of it, which is
// the entire point of holding ALT.
const _outlineDim = new THREE.LineBasicMaterial({
  color: 0x7fd4ff, transparent: true, opacity: 0.55, depthTest: false,
});
const _outlineHot = new THREE.LineBasicMaterial({
  color: 0xffd66e, transparent: true, opacity: 1, depthTest: false,
});
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();
const _hullHit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const _hullPoint = new THREE.Vector3();
const _hullProbe = new THREE.Vector3();

// Shortest signed representation of an angle. The turret tracks the gunner's
// look, and without this a target across the +/-PI seam sends the ring the long
// way round.
function wrapPi(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function teamOfMarker(name) {
  if (/_BLUE/i.test(name)) return TEAM.BLUE;
  if (/_RED/i.test(name)) return TEAM.RED;
  return null;
}

// A vehicle's RIG config: everything about the shape of the thing, as opposed
// to `tune`, which is the numbers it drives with.
//
// This is an OVERLAY, not a move. `CFG.vehicle.seats` and friends stay exactly
// where they have always been and are the fallback; `CFG.vehicle.<key>.seats`
// overrides for one vehicle. Two reasons it is done this way round rather than
// nesting the Warthog's blocks under `V.warthog`:
//
//   The SEAT and VEHICLE tabs paste into the global paths, and those blocks
//   hold owner-tuned measured numbers. Re-pointing every paste target is a
//   silent way to lose them.
//
//   Nothing that already worked moves, so nothing that already worked can
//   break. Adding the second vehicle should not be able to regress the first.
//
// The cost is that there are two places a value can live. The rule is simple
// enough to hold: if only one vehicle in the game has it, it goes in that
// vehicle's block.
function rigFor(key) {
  const own = V[key] || {};
  const pick = (name) => (own[name] !== undefined ? own[name] : V[name]);
  return {
    label: own.label || key.toUpperCase(),
    // Whether bots may claim and crew it. Defaults to true — a vehicle has to
    // opt OUT, so a new ground vehicle joins the AI's motor pool for free and
    // only something genuinely undriveable has to say so.
    aiCanUse: own.aiCanUse !== undefined ? own.aiCanUse : true,
    seats: pick('seats'),
    corners: pick('corners'),
    doors: pick('doors'),
    turret: pick('turret'),
    linkage: pick('linkage'),
    flip: pick('flip'),
    thirdPerson: pick('thirdPerson'),
    camera: pick('camera'),
    seatPose: pick('seatPose'),
    // Present only on aircraft. Its existence IS the branch — see `isAircraft`.
    flight: pick('flight'),
  };
}

// The vehicle a marker spawns, by longest matching prefix so a more specific
// name always wins. Null for a marker nothing claims — the caller reports those
// rather than dropping them silently, because a mistyped marker in Blender is
// otherwise invisible until someone notices the vehicle is missing.
export function vehicleKeyForMarker(name) {
  const n = (name || '').toUpperCase();
  let best = null;
  for (const m of V.markers || []) {
    if (n.startsWith(m.prefix.toUpperCase())
      && (!best || m.prefix.length > best.prefix.length)) best = m;
  }
  return best ? best.key : null;
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
    // All three are OPTIONAL. A landing-gear strut has no steering node and no
    // spinning wheel to drive, and its contact ref is a leaf rather than the
    // parent of the corner, so there is nothing to move in Y either. Null here
    // means "this rig does not have one", not "look it up later".
    this.travelRef = refs.travel;     // moved in Y to show compression
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
    this.rig = rigFor(key);

    // Materiel in the back. Same contract as Soldier.cargo — logistics.js owns
    // it and this class never reads it. A loaded hog handles like an empty one
    // on purpose: the cost of a supply run is the exposure, not the handling.
    this.cargo = 0;

    // --- Rigid body state (world) ---
    this.pos = new THREE.Vector3();      // centre of mass
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();

    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.steerAngle = 0;                 // radians, eased toward the input
    this.speed = 0;                      // signed forward speed, m/s — for HUD/AI
    this.asleep = false;
    this.stillTimer = 0;
    this.flipped = false;                // on its roof and settled; see _flipCheck
    this.flipTimer = 0;
    // Set from the spawn marker. Bots never claim a reserved vehicle, so it is
    // still sitting there when the player walks over. It does NOT stop the
    // player's squad piling in once the player is aboard — that path goes
    // through the vehicle the player occupies, not through claiming.
    this.reserved = false;
    this.claimedBy = null;               // the Squad that has called dibs

    // Crew. One entry per CFG.vehicle.seats def; `occupant` is a Player or a
    // Soldier (Phase 7) or null. The driver is seat 0 by convention and is
    // exposed as a getter so the physics never has to know about seating.
    this.seats = this.rig.seats.map((def) => ({ def, occupant: null }));
    this.turretYaw = 0;                  // radians, relative to the chassis
    this.turretPitch = 0;

    // --- Flight (AIR_VEHICLE_PLAN.md phase 2) ---------------------------
    // Having a flight block is what makes something an aircraft; there is no
    // second class and no mode flag to keep in sync with reality.
    this.isAircraft = !!this.rig.flight;
    // What the PILOT is asking for, written by the controller and read by
    // `_flight`. `dir` is where they are LOOKING — a direction, never a
    // velocity. Nothing in this file may write velocity from it.
    this.flightCmd = {
      dir: new THREE.Vector3(0, 0, 1), throttle: 0, collective: 0, roll: 0,
    };
    this.enginesOn = false;
    this.airborne = false;
    this.hoverBlend = 0;                 // 0 on the gear, 1 in the air, eased
    // One parameter, three outputs: nacelle tilt, plume crossfade, engine note.
    // 0 is hover, 1 is cruise. See CFG.vehicle.pelican.vector.
    this.vector = 0;

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
    // Node lookup by AUTHORED name, dots and all — three's GLTFLoader strips
    // them. The same normalization `_measureLinkage` uses, hoisted because the
    // corner table now addresses nodes that `indexRefs` does not index (a
    // Pelican's gear wheels are `LandingGear_back_left_wheel`, not `wheel_*`).
    const byName = {};
    g.traverse((o) => { if (o.name) byName[o.name.replace(/\./g, '').toLowerCase()] = o; });
    const node = (n) => (n ? byName[n.replace(/\./g, '').toLowerCase()] || null : null);

    // Corners come from config now. The four-wheeled car was hardcoded here,
    // which meant a tricycle undercarriage was not a different vehicle, it was
    // four warnings and no suspension at all.
    //
    // `steer`, `spin` and `travel` are OPTIONAL and default to the Warthog's
    // naming. Explicit null means the rig genuinely has no such node — an
    // aircraft's gear does not steer — and is not the same as "missing", which
    // still warns.
    for (const def of this.rig.corners) {
      const name = def.id;
      const contact = node(def.contact || `ref_contact_${name}`);
      const steer = def.steer === null ? null : node(def.steer || `ref_steer_${name}`);
      const spin = def.spin === null ? null : node(def.spin || `wheel_${name}`);
      const travel = def.travel === null ? null : node(def.travel || def.contact || `ref_contact_${name}`);
      if (!contact) {
        console.warn(`[vehicle] ${this.key}: corner ${name} has no contact ref — no suspension on it`);
        continue;
      }
      if (def.steer !== null && !steer) console.warn(`[vehicle] ${this.key}: corner ${name} steer ref missing`);
      if (def.spin !== null && !spin) console.warn(`[vehicle] ${this.key}: corner ${name} wheel mesh missing`);

      const w = new Wheel(name, def.front, def.left, { contact, steer, spin, travel });
      contact.getWorldPosition(w.localXZ);
      w.baseY = travel ? travel.position.y : 0;
      if (steer) w.steerBase.copy(steer.quaternion);
      if (spin) w.spinBase.copy(spin.quaternion);

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
      if (spin) {
        _v1.set(0, 0, 1).applyQuaternion(spin.getWorldQuaternion(_q1));
        w.spinSign = _v1.x >= 0 ? 1 : -1;
      }

      this.wheels.push(w);
    }

    this._measureTurret();
    this._measureLinkage();
    this._measureDoors();
    this._measureVectorRig();
    this._measureGear();
    this._measureButtons();

    // Hull sample points. An AUTHORED list in the tune block wins, because the
    // eight-corner derivation below is only defensible when the shell is a
    // reasonable convex stand-in for the vehicle — true of a Warthog, and not
    // remotely true of an aircraft whose collision shell measures 30 x 11 x 24 m
    // and would wrap it in a box the size of a building.
    //
    // Authored points are NOT inset by `hullSkin`. The inset exists to undo the
    // inflation of taking a bounding box; a hand-placed point is already on the
    // airframe and pulling it in would sink the belly into the ground.
    if (T.hullPoints && T.hullPoints.length) {
      for (const p of T.hullPoints) this.hullPoints.push(new THREE.Vector3().fromArray(p));
      return;
    }

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

  // The turret's two hinges. Both axes are DERIVED rather than assumed, the way
  // the wheel spin sign is: "yaw is local Y and pitch is local Z" happens to be
  // true of this rig and is exactly the sort of thing a re-export quietly
  // changes. What is actually true regardless is that the ring turns about the
  // chassis's up, and the gun elevates about the axis square to both that and
  // its own barrel.
  //
  // Each axis is stored in its node's PARENT frame, because that is the frame
  // `Object3D.quaternion` lives in — which is also why the rotation is applied
  // by pre-multiplying the authored base rather than replacing it.
  _measureTurret() {
    const yawRef = this.refs['ref_turret_base_rotate_yaw'];
    const pitchRef = this.refs['ref_gun_turret_handle_rotate_pitch'];
    const muzzle = this.refs['ref_muzzle_gunner'];
    this.turret = null;
    if (!yawRef || !pitchRef || !muzzle) {
      if (yawRef || pitchRef || muzzle) {
        console.warn(`[vehicle] ${this.key}: turret rig incomplete — no gunner`);
      }
      return;
    }
    const inParentFrame = (node, worldAxis) => {
      _q1.identity();
      if (node.parent) node.parent.getWorldQuaternion(_q1);
      return worldAxis.clone().applyQuaternion(_q1.invert()).normalize();
    };

    // The barrel, as the rig has it: muzzle minus the elevation pivot.
    const pivot = pitchRef.getWorldPosition(new THREE.Vector3());
    const tip = muzzle.getWorldPosition(new THREE.Vector3());
    _v1.copy(tip).sub(pivot);
    // Elevation axis: square to both the barrel and up. Points to the chassis's
    // LEFT, and a positive rotation about left pitches the muzzle DOWN — hence
    // the negation where it is applied.
    _v2.copy(_Y).cross(_v1).normalize();

    // Which of the muzzle empty's own axes points down the barrel. Derived, for
    // the third time in this file and for the third good reason: assuming +Z
    // put the rounds out of the side of the gun at exactly 90 degrees, because
    // ref_muzzle_gunner carries a baked -90 degree Y. The barrel's true
    // direction is the one thing we can measure — tip minus pivot — so the
    // local axis is whichever best agrees with it.
    muzzle.getWorldQuaternion(_q1);
    _v3.copy(_v1).normalize();
    let bestAxis = null, bestDot = -Infinity;
    for (const a of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const d = _v2.set(a[0], a[1], a[2]).applyQuaternion(_q1).dot(_v3);
      if (d > bestDot) { bestDot = d; bestAxis = a; }
    }
    // Recompute the elevation axis now that _v2 has been reused above.
    _v2.copy(_Y).cross(_v3).normalize();

    this.turret = {
      yawRef, pitchRef, muzzle,
      yawBase: yawRef.quaternion.clone(),
      pitchBase: pitchRef.quaternion.clone(),
      yawAxis: inParentFrame(yawRef, _Y),
      pitchAxis: inParentFrame(pitchRef, _v2),
      muzzleAxis: new THREE.Vector3().fromArray(bestAxis),
    };
  }

  // Doors. DISCOVERED rather than listed — anything named `ref_door*` is one —
  // because the Warthog has seventeen and a hand-written list is a thing to
  // forget to update when the rig changes. What discovery cannot tell us is
  // which way a given node swings or how far: nothing in the GLB distinguishes
  // a cab door from an engine panel. That comes from CFG overrides, and only
  // the ones that differ from the default need saying.
  //
  // The outline is built here, once, as an EdgesGeometry child of the door
  // itself. Parenting it to the door is the whole trick — it then swings with
  // the thing it is outlining for free, and costs one hidden LineSegments per
  // door the rest of the time.
  _measureDoors() {
    const D = this.rig.doors;
    this.doors = [];
    const nodes = [];
    this.group.traverse((o) => { if (/^ref_door/i.test(o.name || '')) nodes.push(o); });

    for (const node of nodes) {
      // Blender's dots are stripped by the loader; the override table is
      // written in the authored spelling, so normalize both ends.
      const key = Object.keys(D.overrides).find(
        (k) => k.replace(/\./g, '').toLowerCase() === node.name.replace(/\./g, '').toLowerCase(),
      );
      const o = (key && D.overrides[key]) || {};
      const axis = o.axis || D.defaultAxis;
      const degrees = o.degrees === undefined ? D.defaultDegrees : o.degrees;

      // Where the door IS, as opposed to where its hinge is — the ref sits on
      // the pivot, which for a door is off to one side of the panel, and
      // aiming at a hinge is not what anyone does.
      _box.makeEmpty();
      const edges = [];
      node.traverse((c) => {
        if (!c.isMesh || !c.geometry) return;
        c.geometry.computeBoundingBox();
        _box.union(_tmpBox.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld));
        const line = new THREE.LineSegments(
          new THREE.EdgesGeometry(c.geometry, 28), _outlineDim,
        );
        line.visible = false;
        line.renderOrder = 3;
        line.frustumCulled = false;
        c.add(line);
        edges.push(line);
      });
      if (!edges.length) continue;

      // Into the DOOR'S OWN space. `_box` was accumulated from child world
      // matrices, so it is in chassis space; storing that and then applying the
      // node's world matrix at query time would transform it twice, and the
      // reticle would look for doors somewhere out past the far side of the
      // vehicle. Converting once, here, is also what makes the centre swing
      // with the door when it opens.
      const centre = _box.getCenter(new THREE.Vector3())
        .applyMatrix4(_mat.copy(node.matrixWorld).invert());

      this.doors.push({
        node, edges, axis: axis === 'x' ? _X : axis === 'z' ? _Z : _Y,
        angle: degrees * DEG,
        base: node.quaternion.clone(),
        localCentre: centre,
        open: 0,        // 0..1, eased
        target: 0,
      });
    }
  }

  // Animated every frame regardless of sleep — a parked hog still has to be
  // able to open its doors, and sleep is a PHYSICS optimisation.
  updateDoors(dt) {
    if (!this.doors || !this.doors.length) return;
    const rate = dt / Math.max(0.01, this.rig.doors.openTime);
    for (const d of this.doors) {
      if (d.open === d.target) continue;
      const step = Math.min(rate, Math.abs(d.target - d.open));
      d.open += Math.sign(d.target - d.open) * step;
      d.node.quaternion.copy(d.base)
        .multiply(_q2.setFromAxisAngle(d.axis, d.open * d.angle));
    }
  }

  toggleDoor(d) { d.target = d.target > 0.5 ? 0 : 1; return d.target > 0.5; }

  // A door named by a seat def, resolved with the same dot-and-case
  // normalization the override table uses — Blender's dots are stripped by the
  // loader, so `ref_door_trunk` and `ref_door.trunk` have to match.
  doorByName(name) {
    if (!name || !this.doors) return null;
    const want = name.replace(/\./g, '').toLowerCase();
    return this.doors.find(
      (d) => (d.node.name || '').replace(/\./g, '').toLowerCase() === want,
    ) || null;
  }

  // Hold open the door a seat uses while anybody is in it, and close it when
  // the last of them leaves.
  //
  // Driven from `enterSeat`/`exitSeat` rather than polled every frame, and that
  // is the difference between this and a rule: a player who opens the tailgate
  // by hand keeps it open, because nothing re-asserts a target until somebody
  // actually gets on or off. Polling would slam it shut in their face.
  //
  // Keyed off `def.door` rather than knowing what a tailgate is, so the cab
  // doors can join in as soon as the DOOR tuner works out which of the 14
  // `ref_door*` empties they are.
  _syncSeatDoors() {
    if (!this.doors) return;
    const done = new Set();
    for (const s of this.seats) {
      const name = s.def.door;
      if (!name || done.has(name)) continue;
      done.add(name);
      const door = this.doorByName(name);
      if (!door) continue;
      door.target = this.seats.some((x) => x.def.door === name && x.occupant) ? 1 : 0;
    }
  }

  // Show or hide every door's outline, optionally marking one as the target.
  setDoorOutline(on, target) {
    if (!this.doors) return;
    for (const d of this.doors) {
      const mat = d === target ? _outlineHot : _outlineDim;
      for (const e of d.edges) { e.visible = on; e.material = mat; }
    }
  }

  doorWorldCentre(d, out) {
    return out.copy(d.localCentre).applyMatrix4(d.node.matrixWorld);
  }

  // The door the crosshair is on: nearest to the ray by ANGLE, not by distance,
  // so a big panel behind a small one does not win just for being closer to the
  // camera. Returns null when nothing is both in range and near the crosshair.
  doorAtReticle(origin, dir, range, cone) {
    if (!this.doors) return null;
    let best = null, bestAng = cone;
    for (const d of this.doors) {
      this.doorWorldCentre(d, _v1).sub(origin);
      const dist = _v1.length();
      if (dist > range || dist < 1e-3) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, _v1.dot(dir) / dist)));
      if (ang < bestAng) { bestAng = ang; best = d; }
    }
    return best;
  }

  // The visible linkage: A-arms, coil-overs, the steering wheel, the brake
  // lights. None of it affects the physics — it exists so the physics can be
  // SEEN. Four independent corners doing real work every frame read as nothing
  // at all while the arms are rigid and the springs never move.
  //
  // Every axis here is derived off the rig, for the same reason the turret's
  // are: "the hinge is local X" happens to be true of this export and is
  // exactly the sort of thing that changes silently when a part is re-authored.
  // What is true regardless is that an A-arm hinges FORE-AFT and a coil-over
  // compresses along its own length.
  _measureLinkage() {
    const L = { arms: [], springs: [], steer: null, brakeMats: [] };
    this.linkage = L;
    const byCode = {
      FL: 'front_left', FR: 'front_right', RL: 'rear_left', RR: 'rear_right',
    };
    const wheelOf = {};
    for (const w of this.wheels) wheelOf[w.id] = w;

    // Nodes are addressed by the AUTHORED name, dots and all, and normalized
    // here — three's GLTFLoader strips the dots, so `ref_sus_arm_FL.001` is
    // `ref_sus_arm_FL001` at runtime. Keeping the table in Blender's spelling
    // means it can be compared against the .blend without translation.
    const byName = {};
    this.group.traverse((o) => { if (o.name) byName[o.name.replace(/\./g, '')] = o; });

    for (const [code, name, axis, dir, family] of this.rig.linkage.hardware) {
      const node = byName[name.replace(/\./g, '')];
      const w = wheelOf[byCode[code]];
      if (!node || !w) {
        console.warn(`[vehicle] ${this.key}: linkage ${name} missing`);
        continue;
      }
      const entry = {
        node, wheel: w, family, dir,
        base: node.quaternion.clone(),
        axis: new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0),
      };
      if (family === 'spring') {
        entry.baseScaleY = node.scale.y;
        L.springs.push(entry);
      } else {
        L.arms.push(entry);
      }
    }

    this.group.traverse((o) => {
      if (/^steering_wheel$/i.test(o.name || '') && o.isMesh) {
        // The column is the axis the disc is THIN along — measured off the
        // geometry rather than assumed, because the rim is round and the only
        // thing that distinguishes the column is the short extent.
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        const e = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
        const i = e[0] <= e[1] && e[0] <= e[2] ? 0 : (e[1] <= e[2] ? 1 : 2);
        L.steer = { node: o, base: o.quaternion.clone(),
          axis: new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0) };
        return;
      }

      // Brake lamps. The material is SHARED — by two meshes here and, because
      // `clone(true)` shares materials, by every hog on the map. Animating it
      // in place would light up the whole motor pool together, which is the
      // same trap ammodisplay.js documents for the digit atlas.
      if (/^breaklight/i.test(o.name || '') && o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        o.material = Array.isArray(o.material) ? mats.map((m) => m.clone()) : mats[0].clone();
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          L.brakeMats.push(m);
          m.emissiveIntensity = 0;
        }
      }
    });
  }

  _deriveConstants() {
    const T = this.tune;
    const g = CFG.gravity;
    this.mass = T.mass;
    this.com = new THREE.Vector3().fromArray(T.com);

    // Spring rate follows from the sag target rather than being authored, so
    // mass and ride height stay independent knobs. See the CFG note.
    //
    // The divisor is the NUMBER OF STRUTS, not four. It was hardcoded, which is
    // invisible while every vehicle is a car and is a 33% error the moment one
    // is not: a three-strut aircraft would get springs sized for four corners,
    // carry its weight on 3/4 of the intended rate, and sag past the target
    // ride height — and it would read as "the Pelican tuning is wrong" rather
    // than as a bug. Guarded against zero so a vehicle whose corners all failed
    // to resolve produces a warning and not a NaN chassis.
    const n = Math.max(1, this.wheels.length);
    this.sagLen = T.travel * T.sag;
    this.springK = (T.mass * g) / (n * this.sagLen);
    const cornerMass = T.mass / n;
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

  // Place it the way it would come to rest: ON the ground plane through its own
  // four contact points, tilted to match, with every spring already at its
  // static compression.
  //
  // Spawning level at the highest corner (which is what placeAt does) leaves
  // the downhill wheels dangling, so the whole vehicle drops onto its springs
  // and slides while it settles — measured peaking at 2.6 m/s at the blue HQ
  // before it caught. Nothing about that is wrong physics; it is just a
  // vehicle being dropped rather than parked.
  //
  // The height falls out of the suspension geometry rather than being another
  // constant: at rest a contact point sits at chassis-local y = 0 (the strut
  // top is `radius + travel*(1-sag)` up and the ray to the ground is
  // `travel + radius - sag` long), so the group origin belongs exactly ON the
  // plane, not above it.
  settleAt(x, z, yaw) {
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const pts = [];
    for (const w of this.wheels) {
      const wx = x + cos * w.localXZ.x + sin * w.localXZ.z;
      const wz = z - sin * w.localXZ.x + cos * w.localXZ.z;
      pts.push(new THREE.Vector3(wx, this.groundAt(wx, wz), wz));
    }
    if (pts.length < 3) { this.placeAt(x, this.groundAt(x, z), z, yaw); return; }

    // Ground normal under the contact patch.
    //
    // FOUR points rarely lie on a plane exactly, so the cross product of the
    // DIAGONALS is the least-squares-ish answer for a rectangle without
    // actually solving anything.
    //
    // THREE points define a plane exactly, so the tricycle case is not a
    // degraded version of the above — it is the exact one, and it takes the
    // plain edge-pair cross product. This used to bail to `placeAt` below four
    // corners, which put an aircraft down LEVEL on ground that runs to 9.5
    // degrees at the red HQ and left it to fall onto one strut and slide.
    if (pts.length === 3) {
      _v1.copy(pts[1]).sub(pts[0]);
      _v2.copy(pts[2]).sub(pts[0]);
    } else {
      _v1.copy(pts[3]).sub(pts[0]);
      _v2.copy(pts[2]).sub(pts[1]);
    }
    _v3.copy(_v1).cross(_v2).normalize();
    if (_v3.y < 0) _v3.negate();
    if (!Number.isFinite(_v3.x) || _v3.y < 0.2) _v3.set(0, 1, 0);   // degenerate

    // Chassis basis: +X left, +Y up, +Z forward. The requested heading is
    // projected onto the plane so the vehicle faces where it was asked to
    // without leaning out of it.
    _fwd.set(sin, 0, cos);
    _fwd.addScaledVector(_v3, -_fwd.dot(_v3)).normalize();
    _side.copy(_v3).cross(_fwd);                 // up x forward = left
    _mat.makeBasis(_side, _v3, _fwd);
    this.quat.setFromRotationMatrix(_mat);

    // Centroid over however many contacts there are, not a hardcoded four.
    const c = pts[0].clone();
    for (let i = 1; i < pts.length; i++) c.add(pts[i]);
    c.multiplyScalar(1 / pts.length);
    this.pos.copy(this.com).applyQuaternion(this.quat).add(c);

    // Geometry alone is not enough on a slope. `_probe` samples the ground
    // DIRECTLY BELOW the strut top while the ray itself runs along the chassis,
    // and those are different points once the vehicle is tilted — it reads
    // t = h / cos^2(theta) rather than h, so a hog placed exactly on the plane
    // starts UNDER-compressed and settles anyway. At 25 degrees it started at
    // zero compression and dropped the whole way onto its springs.
    //
    // Rather than invert that analytically (and have the inversion drift the
    // moment the probe changes), solve it WITH the probe: nudge the height
    // along the chassis up-axis until the mean compression is the static sag.
    // One pass is nearly exact because the relationship is linear in height;
    // the loop is there for the ground moving under the strut as it shifts.
    _t1.set(0, 1, 0).applyQuaternion(this.quat);
    for (let iter = 0; iter < 8; iter++) {
      let mean = 0;
      for (const w of this.wheels) {
        _t2.copy(w.localHard).sub(this.com).applyQuaternion(this.quat).add(this.pos);
        mean += this.rayLen - (_t2.y - this.groundAt(_t2.x, _t2.z)) / _t1.y;
      }
      const err = this.sagLen - mean / this.wheels.length;
      if (Math.abs(err) < 1e-4) break;
      this.pos.addScaledVector(_t1, -err);
    }

    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.steerAngle = 0;
    this.flipped = false;
    this.flipTimer = 0;
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
    // A crewed vehicle can sleep too now (see _sleepCheck), so this no longer
    // asks whether anyone is aboard — only whether anyone is asking it to move.
    // `_updateDriving` wakes it on the first frame of any input.
    if (this.asleep) { this._syncWheelVisuals(); return; }
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
    // Suspension first, across every corner, because the TYRE pass needs to
    // know the whole axle's load before it can divide the drive torque.
    let totalLoad = 0;
    for (const w of this.wheels) {
      w.force.set(0, 0, 0);
      if (!w.grounded) { w.load = 0; continue; }
      this._suspension(w, h);
      totalLoad += w.load;
    }
    for (const w of this.wheels) {
      if (w.grounded) this._tyre(w, h, totalLoad);
    }
    for (const w of this.wheels) {
      if (w.grounded) this._applyForce(w.force, w.contact, h);
    }

    // Flight goes here — AFTER the struts, so an aircraft on its gear is held
    // up by its springs and one in the air is not, and BEFORE gravity, so lift
    // and weight are summed in the same substep rather than a frame apart.
    // There is no takeoff state: the transition IS whether a strut found ground.
    if (this.isAircraft && this.enginesOn) this._flight(h);

    // Gravity and drag act at the centre of mass, so they are velocity changes
    // rather than torques.
    this.vel.y -= CFG.gravity * h;
    // An aircraft's drag is ANISOTROPIC and lives in the flight pass. Applying
    // this isotropic term as well would quietly halve the wing: the whole point
    // is that sideways costs far more than forwards, and a term that does not
    // care which way you are moving averages exactly that distinction away.
    const sp = this.isAircraft ? 0 : this.vel.length();
    if (sp > 0.01) {
      const drag = (T.airDrag * sp * sp) / this.mass;
      this.vel.addScaledVector(this.vel, -Math.min(1, (drag * h) / sp));
    }
    this.angVel.multiplyScalar(Math.max(0, 1 - T.angularDamping * h));

    this.pos.addScaledVector(this.vel, h);
    this._integrateRotation(h);

    // The ground runs whenever the suspension is not doing the job — inverted,
    // airborne, or moving. A hog sitting level on four loaded springs is the
    // one case that can skip it.
    if (!upright || this.crewed || this.vel.lengthSq() > 0.25
      || this.wheels.some((w) => !w.grounded)) this._collideGround(h);
    // Eight BVH queries per substep is the most expensive thing in here, and a
    // parked hog cannot drive into anything. Everything that moves still pays.
    if (this.crewed || this.vel.lengthSq() > 0.25) this._collideHull(h);

    // Last resort, and it runs UNCONDITIONALLY — it used to sit at the bottom
    // of the wall-collision routine, behind an early return that fires whenever
    // nothing is being hit, so the one situation it existed to catch was the
    // one situation it never ran in.
    const floor = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < floor - 2) { this.pos.y = floor + 0.5; this.vel.y = Math.max(0, this.vel.y); }
    this.world.clampToMap(this.pos);

    // An aircraft is never "flipped". Inverted is a thing you can fly out of,
    // and prompting someone to walk over and right a Pelican by hand is not a
    // recovery, it is a soft-lock with a progress bar.
    if (!this.isAircraft) this._flipCheck(h, upright);
    this._sleepCheck(h);
  }

  // -------------------------------------------------------- gear rig --

  // The retracted pose is IDENTITY. The owner authored the DEPLOYED pose as a
  // rotation on each leg, so raising the gear is a slerp toward zero — no
  // second pose to author, and the tuner this phase was supposed to need does
  // not have to exist.
  //
  // The node list is in config rather than discovered, and that is not laziness:
  // `LandingGear_*` also matches the wheels and axles hanging under each leg,
  // and rotating those would spin the tyres into the bodywork.
  _measureGear() {
    this.gear = null;
    const G = this.tune.gear;
    if (!G || !G.parts) return;
    const byName = {};
    this.group.traverse((o) => { if (o.name) byName[o.name.replace(/\./g, '')] = o; });
    const parts = [];
    for (const def of G.parts) {
      const node = byName[def.node.replace(/\./g, '')];
      if (!node) { console.warn(`[vehicle] ${this.key}: gear node ${def.node} missing`); continue; }
      const phase = def.phase || [0, 1];
      if (def.lift) {
        // A sliding strut. Its rest position is the DEPLOYED one and it rises
        // by `lift` to stow, which is why it carries no rotation to fold.
        parts.push({ node, mode: 'lift', restY: node.position.y, rise: def.lift, phase });
        continue;
      }
      if (Math.abs(node.quaternion.w) > 0.9999) {
        // Nothing to slerp to. Says so rather than silently animating nothing:
        // a swinging part with no deployed pose is a Blender gap, and a part
        // that only ever slides should have declared `lift` instead.
        console.warn(`[vehicle] ${this.key}: gear node ${def.node} is at identity and has no lift — nothing to animate`);
        continue;
      }
      parts.push({ node, mode: 'rotate', down: node.quaternion.clone(), phase });
    }
    if (!parts.length) return;
    this.gear = { parts, pos: 1, target: 1 };   // 1 = down, 0 = up
  }

  // Eased on real frame time, outside the physics substep — cosmetic, and a
  // parked aircraft still has to be able to cycle its gear.
  updateGear(dt) {
    const g = this.gear;
    if (!g || g.pos === g.target) return;
    const rate = dt / Math.max(0.01, this.tune.gear.time);
    g.pos += Math.sign(g.target - g.pos) * Math.min(rate, Math.abs(g.target - g.pos));
    for (const p of g.parts) {
      // Each part only moves during its own slice of the travel, which is what
      // sequences the nose bay: leg up first, doors shut after.
      const [a, b] = p.phase;
      const u = b - a < 1e-6 ? 1 : Math.max(0, Math.min(1, (g.pos - a) / (b - a)));
      if (p.mode === 'lift') {
        p.node.position.y = p.restY + p.rise * (1 - u);
      } else {
        // Slerp from identity toward the authored deployed pose.
        // `slerpQuaternions` takes the short arc, which is what a leg swinging
        // 60 degrees — or a bay door swinging 122 — wants.
        p.node.quaternion.slerpQuaternions(_qIdent, p.down, u);
      }
    }
  }

  toggleGear() {
    if (!this.gear) return null;
    this.gear.target = this.gear.target > 0.5 ? 0 : 1;
    return this.gear.target > 0.5;      // true = coming down
  }

  get gearDown() { return this.gear ? this.gear.target > 0.5 : true; }

  // ------------------------------------------------------ button rig --

  // Cockpit and hull switches. Discovered off `Button_*` and mapped to an
  // action by config, so the rig names what exists and config says what it does.
  //
  // THE TRAP THIS WALKS INTO: `npm run assets` quantizes geometry, which moves
  // a named node's mesh onto an auto-named CHILD — so `Button_RearRamp_Exterior`
  // is an Object3D carrying no geometry at all, and reading `node.geometry` for
  // its bounds gets undefined. Traversing for the mesh is the only correct
  // idiom, and it is the one `_measureDoors` already uses. Documented at intake
  // in AIR_VEHICLE_PLAN.md; this is the phase where it would have bitten.
  _measureButtons() {
    this.buttons = [];
    const B = this.tune.buttons;
    if (!B || !B.actions) return;
    this.group.traverse((o) => {
      if (!/^Button_/i.test(o.name || '')) return;
      const key = Object.keys(B.actions).find(
        (k) => k.replace(/\./g, '').toLowerCase() === o.name.replace(/\./g, '').toLowerCase(),
      );
      if (!key) return;
      _box.makeEmpty();
      let found = false;
      o.traverse((c) => {
        if (!c.isMesh || !c.geometry) return;
        found = true;
        c.geometry.computeBoundingBox();
        _box.union(_tmpBox.copy(c.geometry.boundingBox).applyMatrix4(c.matrixWorld));
      });
      if (!found) return;
      // Into the BUTTON'S own space, the same conversion the doors do — storing
      // the chassis-space centre and then applying the node's world matrix at
      // query time would transform it twice.
      const centre = _box.getCenter(new THREE.Vector3())
        .applyMatrix4(_mat.copy(o.matrixWorld).invert());
      this.buttons.push({ node: o, action: B.actions[key], localCentre: centre });
    });
  }

  buttonWorldCentre(b, out) {
    return out.copy(b.localCentre).applyMatrix4(b.node.matrixWorld);
  }

  // Nearest button to the crosshair by ANGLE, same rule as `doorAtReticle` —
  // distance would let a big far panel beat the small near switch you are
  // actually looking at.
  buttonAtReticle(origin, dir, range, cone) {
    if (!this.buttons || !this.buttons.length) return null;
    let best = null, bestAng = cone;
    for (const b of this.buttons) {
      this.buttonWorldCentre(b, _v1).sub(origin);
      const dist = _v1.length();
      if (dist > range || dist < 1e-3) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, _v1.dot(dir) / dist)));
      if (ang < bestAng) { bestAng = ang; best = b; }
    }
    return best;
  }

  // What a button does. Kept on the vehicle rather than in the controller so
  // the same switch works from the cockpit, from inside the bay and from the
  // ground without three copies of the mapping.
  pressButton(b) {
    if (b.action === 'ramp') {
      // Both halves together — a tail hatch is one door with two panels, and
      // opening half of it is not a thing anybody wants.
      const top = this.doorByName('ref_door_rear_top');
      const bottom = this.doorByName('ref_door_rear_bottom');
      const opening = !(bottom || top || {}).target;
      for (const d of [top, bottom]) if (d) d.target = opening ? 1 : 0;
      return opening ? 'RAMP OPEN' : 'RAMP CLOSED';
    }
    if (b.action === 'gear') {
      const down = this.toggleGear();
      if (down === null) return 'NO GEAR';
      return down ? 'GEAR DOWN' : 'GEAR UP';
    }
    if (b.action === 'engine') {
      this.enginesOn = !this.enginesOn;
      if (this.enginesOn) this.wake();
      return this.enginesOn ? 'ENGINES ON' : 'ENGINES OFF';
    }
    return null;
  }

  // ------------------------------------------------------- vector rig --

  // The nacelles and the plumes. Discovered, not listed: anything matching
  // `Wing_<family>_<side>_root` is a pod hinge, which means a fifth pod costs
  // an export and no code.
  //
  // MEASURED rather than assumed, and it needed to be. Each root's local Z maps
  // to the CHASSIS X axis, so a rotation about it tilts the pod fore and aft —
  // the obvious guess (a wing hinges about the fore-aft axis, like a control
  // surface) is right for a wing and wrong for a nacelle, and would have rolled
  // the engines sideways.
  _measureVectorRig() {
    this.pods = [];
    this.glow = null;
    if (!this.rig.flight) return;

    this.group.traverse((o) => {
      const m = /^Wing_(front|rear)_(left|right)_root$/i.exec(o.name || '');
      if (m) {
        this.pods.push({
          node: o,
          base: o.quaternion.clone(),
          family: m[1].toLowerCase(),
          // +1 left, -1 right. The differential term needs a side; nothing else
          // does, because both pods on an axle tilt together.
          side: m[2].toLowerCase() === 'left' ? 1 : -1,
        });
      }
    });
    if (!this.pods.length) return;

    // The plume materials, CLONED PER VEHICLE. `template.clone(true)` shares
    // materials, so animating them in place would light up every Pelican on the
    // map together — the third time this project has met the same trap, after
    // ammodisplay.js's digit atlas and the Warthog's brake lamps.
    //
    // Keyed by ROLE rather than by node, because the two nozzles on a pod are
    // separate meshes with separate materials and the crossfade is between the
    // roles, not between the sides.
    const roles = { down: [], forward: [], hover: [] };
    const seen = new Map();
    this.group.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((mat) => {
        const n = (mat.name || '').toLowerCase();
        let role = null;
        if (/^thrustglow_.*_down$/.test(n)) role = 'down';
        else if (/^thrustglow_.*_forward$/.test(n)) role = 'forward';
        else if (/^hover_thrusters$/.test(n)) role = 'hover';
        if (!role) return mat;
        // One clone per SOURCE material, not per mesh: the left and right down
        // nozzles are separate materials and stay separate, but a material used
        // by two meshes must not be cloned twice or only one would animate.
        let c = seen.get(mat);
        if (!c) {
          c = mat.clone();
          seen.set(mat, c);
          // WHICH KNOB the material actually responds to, decided per material
          // rather than assumed. `thrustglow_*` carry a real emissive (#bdffff)
          // so intensity drives them; `hover_thrusters` is a transparent
          // MeshPhysicalMaterial whose emissive is pure BLACK, and writing
          // emissiveIntensity to that is a silent no-op — the value changes,
          // nothing renders differently, and it looks like the crossfade works.
          const lit = c.emissive && (c.emissive.r + c.emissive.g + c.emissive.b) > 0;
          roles[role].push({ mat: c, drive: lit ? 'emissive' : 'opacity' });
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    this.glow = roles;
  }

  // Drive the pods, the plumes and (via `vector`) the engine note off ONE
  // parameter. Runs on real frame time outside the physics substep — it is
  // cosmetic, and a parked aircraft still has to be able to sit with its
  // nozzles cold.
  updateVector(dt) {
    if (!this.isAircraft || !this.pods || !this.pods.length) return;
    const K = this.tune.vector;
    if (!K) return;

    // Forward airspeed, not total: an aircraft sliding sideways at 30 m/s is
    // not cruising, and using the speed magnitude would have it transition to
    // cruise in the middle of the very slide the drag model exists to produce.
    _fA.set(0, 0, 1).applyQuaternion(this.quat);
    const along = Math.max(0, this.vel.dot(_fA));
    const grounded = this.wheels.some((w) => w.grounded);
    const want = (!this.enginesOn || grounded)
      ? K.groundVector
      : Math.max(0, Math.min(1, along / Math.max(1e-3, K.cruiseSpeed)));

    const step = K.rate * dt;
    this.vector += Math.max(-step, Math.min(step, want - this.vector));

    // Differential: the pods tilt asymmetrically with the roll and yaw command,
    // so the engines are visibly doing the thing that is turning you.
    // Both terms mean LEFT when positive — `roll` by the convention above, and
    // `angVel.y` because a positive rotation about world up swings the nose
    // toward +X, which is the chassis's left. So they ADD. Subtracting them
    // cancelled the differential in exactly the case it exists for: a turn
    // where the pilot is both banking and yawing the same way.
    const cmd = Math.max(-1, Math.min(1, this.flightCmd.roll + this.angVel.y));
    for (const p of this.pods) {
      const span = p.family === 'front' ? K.wingFront : K.wingRear;
      const deg = span[0] + (span[1] - span[0]) * this.vector
        + cmd * p.side * K.differential * this.hoverBlend;
      p.node.quaternion.copy(p.base).multiply(_q2.setFromAxisAngle(_Z, deg * DEG));
    }

    if (this.glow) {
      const on = this.enginesOn ? 1 : 0;
      // `amount` is 0..1 and `peak` is the configured full-brightness value, so
      // an emissive material and a transparent one take the same call and each
      // applies it to the knob it actually has.
      const set = (list, amount, peak) => {
        for (const e of list) {
          if (e.drive === 'emissive') e.mat.emissiveIntensity = peak * amount;
          else e.mat.opacity = Math.max(0, Math.min(1, peak * amount));
        }
      };
      // Crossfaded, not switched. Both nozzles are physically present on the
      // pod at all times — see the config note — so what changes between hover
      // and cruise is which one is lit.
      set(this.glow.down, on * (1 - this.vector), K.glowDown);
      set(this.glow.forward, on * this.vector, K.glowForward);
      set(this.glow.hover, on * (1 - this.vector), K.glowHover);
    }
  }

  // ------------------------------------------------------------- flight --

  // Mode 1: point the camera, the ship goes there, with weight.
  //
  // THE INVARIANT, and the only thing in here worth defending: this function
  // never writes velocity from the look direction. The look builds a desired
  // ORIENTATION, a rate-limited controller turns the HULL toward it, and thrust
  // is applied along the HULL'S OWN forward. Where you end up is the integral of
  // all three. Momentum is not a damping constant that was tuned to feel heavy —
  // it is what you get by refusing to take the shortcut.
  //
  // The shortcut version (velocity = look * speed) looks identical in a
  // screenshot and is a camera with a mesh attached: it has no state, it stops
  // the instant you stop asking, and it can never overshoot.
  //
  // Runs INSIDE step(), after the suspension pass and before gravity, so an
  // aircraft on its gear is held up by its struts and one in the air is not.
  // That is the whole of the ground/air transition — there is no takeoff state.
  _flight(h) {
    const F = this.rig.flight;
    const c = this.flightCmd;

    // Airborne is OBSERVED, not latched: it is simply whether any strut found
    // ground this substep. No state to get stuck in, and a wheels-down landing
    // hands control back to the spring solver the moment the gear touches.
    this.airborne = !this.wheels.some((w) => w.grounded);
    this.hoverBlend += ((this.airborne ? 1 : 0) - this.hoverBlend)
      * Math.min(1, h * F.hoverBlend);

    // `hoverBlend` doubles as CONTROL AUTHORITY, and that is not a shortcut —
    // it is the same physical fact twice. These are thrusters: they hold the
    // aircraft up and they turn it, so an airframe with its weight on its gear
    // has neither.
    //
    // Without this the attitude controller torques a PARKED aircraft, which
    // rolls it off its own struts; going airborne then engages the hover, and
    // the Pelican takes off purely by rotating. Measured: engines on with no
    // collective at all lifted it 4.4 m and put it at 26 degrees nose-up and
    // 21 degrees of bank, because the stale command happened to sit 141 degrees
    // off its parked heading.
    //
    // Using the eased blend rather than a hard `if (airborne)` also makes the
    // hand-off smooth in both directions: lifting off ramps control in over the
    // same fraction of a second the lift ramps in, and touching down hands the
    // airframe back to the spring solver instead of fighting it on the ground.
    const authority = this.hoverBlend;

    // ---- Attitude: chase the commanded direction ------------------------
    _fA.copy(c.dir);
    if (_fA.lengthSq() < 1e-8) _fA.set(0, 0, 1);
    _fA.normalize();                                   // desired forward

    // Bank into the turn, off the yaw rate the body actually has rather than
    // the one commanded — so the lean follows the turn instead of leading it.
    // `roll` carries the SAME handedness as a ground vehicle's `steer`:
    // positive is left, because +X is chassis left and A means left everywhere
    // else in the game. The negation is what converts that into a bank angle
    // about the forward axis, where positive drops the RIGHT wing.
    //
    // It was missing, so A rolled right and D rolled left. The auto term was
    // already correct, which is what made it findable: the two are summed, and
    // measured in a right-hand turn the automatic part banked right (-26 deg)
    // while holding A banked the other way (-30 deg for a left-hand input).
    // Two terms feeding one angle and disagreeing about which way is left.
    const bank = Math.max(-F.bankMax, Math.min(F.bankMax, -this.angVel.y * F.bankPerYaw))
      - c.roll * F.bankManual;

    // Basis. `left = up x forward`, matching the chassis convention (+X left)
    // that settleAt and every seat offset already use. The degenerate case is
    // real and reachable: look straight up and world-up is parallel to forward,
    // so the cross product vanishes and the aircraft would tumble.
    _fB.set(0, 1, 0);
    if (Math.abs(_fA.y) > 0.999) _fB.set(0, 0, _fA.y > 0 ? -1 : 1);
    _fC.copy(_fB).cross(_fA).normalize();              // left
    _fB.copy(_fA).cross(_fC).normalize();              // up
    _fq.setFromAxisAngle(_fA, bank);
    _fC.applyQuaternion(_fq);
    _fB.applyQuaternion(_fq);
    _mat.makeBasis(_fC, _fB, _fA);
    _fq2.setFromRotationMatrix(_mat);                  // desired orientation

    // Error as a world-frame rotation vector: qDesired * qCurrent^-1, taken the
    // short way round. Without the sign flip an error just past 180 degrees
    // sends the airframe the long way, which at these rates is several seconds
    // of the nose going somewhere nobody asked for.
    _fq3.copy(this.quat).invert().premultiply(_fq2);
    if (_fq3.w < 0) { _fq3.x = -_fq3.x; _fq3.y = -_fq3.y; _fq3.z = -_fq3.z; _fq3.w = -_fq3.w; }
    const sin = Math.hypot(_fq3.x, _fq3.y, _fq3.z);
    const angle = 2 * Math.atan2(sin, _fq3.w);
    if (sin > 1e-7) _fA.set(_fq3.x, _fq3.y, _fq3.z).multiplyScalar(angle / sin);
    else _fA.set(0, 0, 0);

    // Into the BODY frame, so the per-axis limits mean pitch, yaw and roll
    // rather than three arbitrary world directions. Body x is left (pitch),
    // y is up (yaw), z is forward (roll).
    _fq.copy(this.quat).invert();
    _fA.applyQuaternion(_fq);                          // error
    _fB.copy(this.angVel).applyQuaternion(_fq);        // current rate
    const e = [_fA.x, _fA.y, _fA.z];
    const r = [_fB.x, _fB.y, _fB.z];
    for (let i = 0; i < 3; i++) {
      // Rate-limited PD. The proportional term commands a RATE which is then
      // clamped, rather than commanding a torque directly, and that is what
      // makes `turnRate` mean what it says: no amount of error can ever produce
      // a faster rotation than the airframe is allowed. `turnAccel` then caps
      // how quickly that rate is reached, which is the difference between an
      // airframe that leans into a turn and one that snaps.
      const want = Math.max(-F.turnRate[i], Math.min(F.turnRate[i], F.kP * e[i]));
      const a = (want - r[i]) * F.kD;
      e[i] = Math.max(-F.turnAccel[i], Math.min(F.turnAccel[i], a));
    }
    _fB.set(e[0], e[1], e[2]).applyQuaternion(this.quat);
    this.angVel.addScaledVector(_fB, h * authority);

    // ---- Lift ------------------------------------------------------------
    // Along WORLD up, not the hull's. A hull-up hover would drop the aircraft
    // every time the pilot looked down, which fights the one thing mode 1 is
    // for. The hull's contribution to where you go comes from THRUST.
    // Commanding lift SPOOLS THE ENGINES to at least the hover point, and that
    // is what makes taking off possible at all. Gating the hover baseline on
    // being airborne is circular — `collective` is authority ABOUT the hover
    // point, not total thrust, so on the ground the pilot was asking for
    // 13 m/s^2 against a gravity of 18 and the struts simply held it down.
    // Measured: full collective for 3 s moved it 0.2 m.
    //
    // Physically this is just an engine that is already at hover thrust when you
    // ask it to climb, which is what a VTOL does. Neutral in the air still holds
    // altitude, and neutral on the ground still commands nothing at all — so a
    // parked aircraft with its engines running stays parked.
    const spool = Math.max(this.hoverBlend, c.collective > 0 ? 1 : 0);
    this.vel.y += (spool * F.hover * CFG.gravity + c.collective * F.collective) * h;

    // ---- Thrust ----------------------------------------------------------
    // Along the HULL'S forward, which is the whole ball game: while the nose is
    // still swinging toward where you looked, the push is still going where the
    // nose currently points. That gap is the drift.
    _fA.set(0, 0, 1).applyQuaternion(this.quat);
    const along = this.vel.dot(_fA);
    let t = 0;
    if (c.throttle > 0) {
      t = F.thrust * c.throttle * Math.max(0, 1 - Math.max(0, along) / F.topSpeed);
    } else if (c.throttle < 0) {
      const back = F.topSpeed * F.reverse;
      t = F.thrust * F.reverse * c.throttle * Math.max(0, 1 - Math.max(0, -along) / back);
    }
    if (t !== 0) this.vel.addScaledVector(_fA, t * h * authority);

    // ---- Drag, anisotropic in the hull frame -----------------------------
    // The second most important thing here after the rate limit. Lateral and
    // vertical drag run an order of magnitude above longitudinal, which is the
    // cheapest honest wing: the airframe slides when it is thrown sideways, and
    // then the slide bleeds off and it carves.
    _fq.copy(this.quat).invert();
    _fB.copy(this.vel).applyQuaternion(_fq);
    _fC.set(
      -F.dragLat * _fB.x * Math.abs(_fB.x),
      -F.dragVert * _fB.y * Math.abs(_fB.y),
      -F.dragLong * _fB.z * Math.abs(_fB.z),
    ).applyQuaternion(this.quat);
    this.vel.addScaledVector(_fC, h * authority);

    // ---- Ceiling ---------------------------------------------------------
    if (this.pos.y > F.ceiling) {
      this.pos.y = F.ceiling;
      if (this.vel.y > 0) this.vel.y = 0;
    }
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

  // Spring, damper, anti-roll bar and bump stop for one corner. Split out from
  // the tyre because the drive torque cannot be divided until every corner's
  // load is known.
  _suspension(w, h) {
    _arm.copy(w.contact).sub(this.pos);
    // Velocity of the contact patch: the body's velocity plus the part that
    // comes from the body rotating about its centre of mass. Without the second
    // term there is no yaw damping at all and the vehicle spins up forever.
    _v2.copy(this.angVel).cross(_arm).add(this.vel);
    const strutVel = _v2.dot(_up);
    const damp = strutVel < 0 ? this.damperC : this.damperRebound;
    let load = this.springK * w.compression - damp * strutVel + (w.arb || 0)
      + this.bumpStopK * w.bump;
    load = Math.max(0, load);       // a spring cannot pull the ground upward
    w.load = load;
    w.force.addScaledVector(_up, load);
  }

  // Tractive force available at a given road speed, as a multiple of
  // `driveForce`. Two terms:
  //
  //   The linear falloff to nothing at `topSpeed` is what SETS the top speed —
  //   there is no speed clamp anywhere in this file.
  //
  //   `lowGear` is the gearbox. Without it the model has no torque
  //   multiplication at crawl speed, which is exactly where a hill needs it:
  //   measured max sustained climb was 29 degrees, and the hog settled to a
  //   5 m/s stall at 30 rather than pulling through. A real drivetrain trades
  //   speed for force at the bottom of the range and this is the cheapest
  //   honest version of that.
  _driveCurve(v) {
    const T = this.tune;
    const falloff = Math.max(0, 1 - v / T.topSpeed);
    const low = 1 + (T.lowGear - 1) * Math.max(0, 1 - v / T.lowGearSpeed);
    return falloff * low;
  }

  _tyre(w, h, totalLoad) {
    const T = this.tune;
    const load = w.load;

    _arm.copy(w.contact).sub(this.pos);
    _v2.copy(this.angVel).cross(_arm).add(this.vel);

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

    // Drive torque is divided by LOAD, not equally. That is what a locked
    // centre diff does, and the equal split was quietly throwing force away
    // exactly when it was needed most: climbing, the front axle unloads, so its
    // quarter of the torque exceeded its grip budget and the excess was clipped
    // and discarded while the loaded rear sat well inside its own budget with
    // nothing extra to give. Measured at 40 degrees: front wheels at slip 1.0,
    // rear at 0.61.
    const share = totalLoad > 1 ? load / totalLoad : 1 / this.wheels.length;
    let fLong = 0;
    if (this.input.throttle > 0) {
      fLong += T.driveForce * share * this.input.throttle
        * this._driveCurve(Math.max(0, this.speed));
    } else if (this.input.throttle < 0) {
      fLong += T.driveForce * share * T.reverseMult * this.input.throttle
        * Math.max(0, 1 - Math.max(0, -this.speed) / (T.topSpeed * T.reverseMult));
    }
    // Braking stays an EQUAL split, unlike drive. Brakes are per-corner
    // hardware with no differential between them, and the friction circle
    // below already stops an unloaded wheel from using more than it has.
    const driven = this.wheels.length;
    let braking = this.input.brake * T.brakeForce / driven;
    if (this.input.handbrake && !w.front) braking += T.handbrakeForce / 2;
    // Hill hold. Keyed on NOBODY ASKING IT TO MOVE, not on nobody being aboard
    // — that was the first version and it released the brake the instant you
    // sat down, so a hog parked on a slope rolled away the moment it was
    // occupied, which is the one moment you are watching it.
    //
    // A real vehicle does not drop its handbrake because someone got in. This
    // holds whenever there is no throttle and no brake input, which covers the
    // empty vehicle, the driver sitting still, and the driver who has just
    // lifted off — and releases the instant the throttle is touched.
    //
    // Starting from rest it never lets the vehicle build speed at all: the
    // `stop` clamp below sizes the force to exactly arrest the contact patch,
    // so at low speed it asks for very little and gets it.
    const idle = this.input.throttle === 0 && this.input.brake === 0 && !this.input.handbrake;
    if (idle && Math.abs(this.speed) < T.parkBrakeSpeed) {
      braking += T.parkBrake * budget;
    }
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

  // Effective mass along `n` for a contact at offset `r` from the centre of
  // mass: 1 / ( 1/m + n · ((I⁻¹(r × n)) × r) ).
  //
  // This denominator is the whole difference between a collision and a
  // catapult. An impulse applied off-centre spends part of itself on rotation,
  // so the impulse needed to cancel a given closing speed is SMALLER than
  // m·Δv — using m·Δv over-corrects by however much of the hit should have
  // become spin. Landing a hog on its roof from 6 m returned it 12 m into the
  // air on the first bounce.
  _effectiveMass(n, r) {
    _t1.copy(r).cross(n);
    _q1.copy(this.quat).invert();
    _t1.applyQuaternion(_q1);
    _t1.set(_t1.x * this.invInertia.x, _t1.y * this.invInertia.y, _t1.z * this.invInertia.z);
    _t1.applyQuaternion(this.quat);
    _t2.copy(_t1).cross(r);
    return 1 / (1 / this.mass + n.dot(_t2));
  }

  // One contact, resolved properly: a normal impulse that cancels the closing
  // speed (plus restitution), then Coulomb friction on the tangent capped by
  // it. Shared by the ground and the wall shells because a contact is a
  // contact — the only thing that differs is where the normal came from.
  _resolveContact(point, normal, restitution, friction) {
    _arm.copy(point).sub(this.pos);
    _t3.copy(this.angVel).cross(_arm).add(this.vel);
    const closing = _t3.dot(normal);
    if (closing >= 0) return 0;

    const jN = -(1 + restitution) * closing * this._effectiveMass(normal, _arm);
    _force.copy(normal).multiplyScalar(jN);
    this._applyForce(_force, point, 1);

    if (friction > 0) {
      _arm.copy(point).sub(this.pos);
      _t3.copy(this.angVel).cross(_arm).add(this.vel);
      _t3.addScaledVector(normal, -_t3.dot(normal));   // tangential part
      const vt = _t3.length();
      if (vt > 1e-4) {
        _t3.divideScalar(vt);
        const jT = Math.min(vt * this._effectiveMass(_t3, _arm), friction * jN);
        _force.copy(_t3).multiplyScalar(-jT);
        this._applyForce(_force, point, 1);
      }
    }
    return jN;
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

  // Hull vs the ground. THE SUSPENSION IS NOT A FLOOR: it is the only thing
  // holding an upright vehicle up, and `_probe` switches it off entirely once
  // the chassis is inverted, because no wheel is pointing at anything any more.
  // Without this pass a flipped hog therefore has nothing at all underneath it
  // — measured falling 41 m through the terrain and still accelerating, taking
  // the driver with it. This is the floor of last resort, and it is what makes
  // landing on the roof a recoverable situation instead of a lost vehicle.
  _collideGround(h) {
    const T = this.tune;
    let deepest = 0;
    for (const p of this.hullPoints) {
      _v1.copy(p).sub(this.com).applyQuaternion(this.quat).add(this.pos);
      const pen = this.groundAt(_v1.x, _v1.z) - _v1.y;
      if (pen > deepest) { deepest = pen; _hullPoint.copy(_v1); }
    }
    if (deepest <= 0) return;

    this.pos.y += deepest;
    _hullPoint.y += deepest;
    // Resolved AT the contact rather than at the centre, so a corner striking
    // first rolls the body instead of stopping it flat — which is what lets a
    // hog bounce onto its roof and settle there rather than pancaking.
    this._resolveContact(_hullPoint, _Y, T.restitution, this.rig.flip.groundFriction);
    this.wake();
  }

  // Hull vs the authored blockers. Wall shells are what GLB maps carry; the
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
    // Same contact solver the ground uses — a corner strike spins the vehicle
    // instead of stopping it dead square, and the impulse is scaled by the
    // effective mass so an off-centre hit does not launch it.
    this._resolveContact(_hullPoint, _v3, T.restitution, T.hullFriction ?? 0.4);
    this.wake();
  }

  // A hog on its roof is a recoverable situation, not a lost vehicle. The state
  // latches only once it has STOPPED — mid-barrel-roll is not flipped, it is
  // airborne, and prompting someone to right a vehicle that is still tumbling
  // would be prompting them to walk into it.
  _flipCheck(h, upright) {
    const F = this.rig.flip;
    _v1.set(0, 1, 0).applyQuaternion(this.quat);
    const settled = this.vel.lengthSq() < 4 && this.angVel.lengthSq() < 1;
    if (_v1.y < F.upThreshold && settled) {
      this.flipTimer += h;
      if (this.flipTimer > F.settleTime) this.flipped = true;
    } else if (_v1.y > F.upThreshold) {
      this.flipTimer = 0;
      this.flipped = false;
    }
  }

  // Put it back on its wheels, keeping the heading it came to rest on. Dropped
  // from a small clearance rather than placed exactly, so the suspension takes
  // up the landing and the result is never a vehicle interpenetrating the
  // ground it was just righted onto.
  rightUp() {
    this.quat.setFromAxisAngle(_Y, this.yaw);
    this.pos.y = this.groundAt(this.pos.x, this.pos.z) + this.com.y + this.rig.flip.rightLift;
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.steerAngle = 0;
    this.flipped = false;
    this.flipTimer = 0;
    this.wake();
    this.syncVisuals();
  }

  // Sleep is what actually STOPS a vehicle, not the brake. The hill hold above
  // can only ever leave a residual creep of `gravity_along * substep`: it
  // zeroes the contact patch's velocity and then gravity puts a step's worth
  // straight back, every step. Measured at 0.03-0.14 m/s, invisible per frame
  // and a metre a minute if you sit and watch it.
  //
  // So the condition is NOBODY ASKING IT TO MOVE, not nobody aboard. That was
  // the original rule and it meant an occupied vehicle could never settle —
  // the empty one on the same slope drifted 0.07 m while the seated one
  // drifted 1.07 m, on identical speeds, purely because only one of them was
  // allowed to fall asleep.
  _sleepCheck(h) {
    const T = this.tune;
    // Engines running is "somebody is asking it to move", the same rule the
    // hill hold uses. A hovering aircraft holding perfectly still would
    // otherwise fall asleep and freeze in mid-air with the pilot aboard.
    if (this.enginesOn) { this.stillTimer = 0; return; }
    const still = this.vel.lengthSq() < T.sleepSpeed * T.sleepSpeed
      && this.angVel.lengthSq() < T.sleepSpin * T.sleepSpin
      && this.input.throttle === 0 && this.input.brake === 0
      && this.input.steer === 0 && !this.input.handbrake;
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
    this._syncTurret();
    this._syncLinkage();
  }

  // Suspension state -> one of three authored poses, piecewise-linear:
  // [full droop, ride height, full bump]. Two segments rather than one gain
  // because the halves of the travel move at visibly different rates — the
  // droop side covers 0.13 m and the bump side 0.21 m, and the arms turn
  // through more degrees on the shorter half.
  _travelMap(compression, triple) {
    const sag = this.sagLen;
    if (compression <= sag) {
      const u = sag > 1e-4 ? Math.max(0, compression / sag) : 1;
      return triple[0] + (triple[1] - triple[0]) * u;
    }
    const span = this.tune.travel - sag;
    const u = span > 1e-4 ? Math.min(1, (compression - sag) / span) : 0;
    return triple[1] + (triple[2] - triple[1]) * u;
  }

  // Drive the visible linkage off state the physics already computed. Costs
  // nothing but a few quaternions, and it is the difference between a hog that
  // has suspension and a hog that looks like it does.
  _syncLinkage() {
    const L = this.linkage;
    if (!L) return;
    const K = this.rig.linkage;

    for (const a of L.arms) {
      const deg = this._travelMap(a.wheel.compression, K.armAngles[a.family]);
      a.node.quaternion.copy(a.base)
        .multiply(_q2.setFromAxisAngle(a.axis, a.dir * deg * DEG));
    }

    for (const s of L.springs) {
      const deg = this._travelMap(s.wheel.compression, K.springAngles);
      s.node.quaternion.copy(s.base)
        .multiply(_q2.setFromAxisAngle(s.axis, s.dir * deg * DEG));
      s.node.scale.y = s.baseScaleY
        * (this._travelMap(s.wheel.compression, K.springScaleY) / K.springScaleY[0]);
    }

    if (L.steer) {
      // Lock to lock in `steerWheelTurns` turns of the rim, so the wheel spins
      // far more than the road wheels do — which is what makes it read as a
      // steering wheel rather than a dial.
      const ratio = (K.steerWheelTurns * Math.PI * 2) / (this.tune.steerMax * 2);
      L.steer.node.quaternion.copy(L.steer.base)
        .premultiply(_q2.setFromAxisAngle(L.steer.axis, this.steerAngle * ratio));
    }

    if (L.brakeMats.length) {
      // Lit under the brake, and also whenever the hog is being reversed —
      // both are "the driver is on the pedal".
      const on = this.input.brake > 0 || this.input.handbrake;
      const want = on ? K.brakeGlow : 0;
      for (const m of L.brakeMats) m.emissiveIntensity = want;
    }
  }

  _syncTurret() {
    const t = this.turret;
    if (!t) return;
    t.yawRef.quaternion.copy(t.yawBase)
      .premultiply(_q2.setFromAxisAngle(t.yawAxis, this.turretYaw));
    // Negated: a positive rotation about the LEFT axis pitches the muzzle down.
    t.pitchRef.quaternion.copy(t.pitchBase)
      .premultiply(_q2.setFromAxisAngle(t.pitchAxis, -this.turretPitch));
  }

  _syncWheelVisuals() {
    for (const w of this.wheels) {
      // Compression measured from the RESTING compression, since the authored
      // pose is the vehicle sitting on its springs, not hanging on full droop.
      if (w.travelRef) w.travelRef.position.y = w.baseY + (w.compression - this.sagLen);
      if (w.front && w.steerRef) {
        w.steerRef.quaternion.copy(w.steerBase).multiply(_q2.setFromAxisAngle(_Y, this.steerAngle));
      }
      if (w.spinRef) w.spinRef.quaternion.copy(w.spinBase).multiply(_q2.setFromAxisAngle(_Z, w.spin));
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

  // Seat 0 by convention. A getter so the physics can ask "is anyone driving"
  // without knowing that seating exists at all.
  get driver() { return this.seats[0].occupant; }
  get crewed() { return this.seats.some((s) => s.occupant); }
  seatOf(who) { return this.seats.findIndex((s) => s.occupant === who); }

  // Where a seat is in the world. Prefers the rig's own empty and falls back to
  // a chassis-frame offset for the seats the GLB does not author (the tailgate
  // riders — VEHICLE_PLAN.md open question 3).
  seatWorld(i, out) {
    const d = this.seats[i].def;
    if (d.ref && this.refs[d.ref]) return this.refs[d.ref].getWorldPosition(out);
    return out.fromArray(d.offset).applyQuaternion(this.quat).add(this.group.position);
  }

  // Where a seated body hangs. Every seat mounts on `group` — the chassis
  // frame, which the sim writes directly (see _syncTransform) and which is
  // therefore known to be +Z forward, unit scale and free of baked rotation.
  //
  // Mounting on the seat EMPTY instead would be the obvious choice and is the
  // wrong one: the empties in this rig carry baked rotations (the ±90° steer
  // pair and ref_muzzle_gunner's −90° are both documented in VEHICLE_PLAN.md),
  // so a body parented to one inherits whatever the exporter left there. One
  // clean frame for all five seats is worth the extra transform.
  seatMount(i) {
    // The gunner hangs off the RING, not the chassis, so their body turns with
    // the gun they are holding — the difference between a manned turret and a
    // gun bolted to a car, which is the same argument `ref_camera_gunner`
    // already makes for the eye.
    //
    // Safe to parent to directly, and that was worth checking rather than
    // assuming: `yawBase` is identity and `yawAxis` is a clean +Y, so unlike
    // the muzzle and the steer corners this node carries no baked rotation to
    // cancel. The pitch node is its CHILD, so this inherits yaw only — the
    // barrel elevates and the gunner does not, which is what a person does.
    const d = this.seats[i] && this.seats[i].def;
    if (d && d.role === 'turret' && this.turret) return this.turret.yawRef;
    return this.group;
  }

  // The world orientation a seated body should HOLD, before its own tuned pose
  // is applied on top. The chassis for most seats; the chassis yawed by the
  // ring for the gunner, so they face the gun rather than the windscreen.
  //
  // This exists because the MOUNT's frame cannot be used directly. Everything
  // below the loader's -X to +Z correction sits in the raw model frame, so
  // `ref_turret_base_rotate_yaw`'s own +Z is 90 degrees off the chassis's —
  // `yawBase` being identity says only that it matches its PARENT, which is
  // itself rotated. Handing out the desired world orientation and letting the
  // caller invert the mount out of it means no one has to know that.
  seatWorldQuat(i, out) {
    const d = this.seats[i] && this.seats[i].def;
    if (d && d.role === 'turret' && this.turret) {
      // chassis * yaw(ring). Built in `out` and premultiplied so no module
      // scratch is involved and a caller cannot alias it.
      return out.setFromAxisAngle(_Y, this.turretYaw).premultiply(this.quat);
    }
    return out.copy(this.quat);
  }

  // Where a seat sits in the frame of the node its body mounts on.
  //
  // Separate from `seatLocal` rather than replacing it: `seatLocal` means
  // CHASSIS frame, and the SEAT tab's marker column and its camera framing both
  // read it that way. Only the mesh parenting wants the mount's frame.
  seatMountLocal(i, out) {
    const mount = this.seatMount(i);
    this.seatWorld(i, out);
    // worldToLocal reads matrixWorld without refreshing it, and the ring has
    // usually just been re-posed this frame.
    mount.updateWorldMatrix(true, false);
    const d = this.seats[i] && this.seats[i].def;
    if (!d || d.role !== 'turret' || !this.turret) return mount.worldToLocal(out);

    // The gunner's standing position is resolved AS IF THE RING WERE CENTRED,
    // then carried round by the parent. `offset` is authored in the chassis
    // frame, and the plain conversion bakes in whatever angle the gun happened
    // to be at when he climbed on — so a gunner boarding a hog whose turret was
    // left pointing sideways ends up standing beside it forever. It also makes
    // the SEAT tab lie, since dragging the ring slider and then editing the
    // anchor would resolve against a different frame each time.
    //
    // Undoing the ring is exact, not approximate. `syncVisuals` builds the
    // node as `R(yawAxis, angle) * yawBase`, so with `yawBase` identity the
    // ring is the last factor of the mount's WORLD rotation and cancels by
    // right-multiplying its inverse. The axis is the rig's own `yawAxis` — it
    // happens to be a clean +Y on the Warthog, but reading it costs nothing and
    // assuming it is how the muzzle axis caught this project out twice.
    mount.getWorldPosition(_v1);
    mount.getWorldQuaternion(_q1);
    _q1.multiply(_q2.setFromAxisAngle(this.turret.yawAxis, -this.turretYaw)).invert();
    return out.sub(_v1).applyQuaternion(_q1);
  }

  // A seat's position in that frame. The `ref` seats convert their empty's
  // world position back into it; the derived ones already ARE in it, which is
  // what `offset` has always meant (see seatWorld).
  seatLocal(i, out) {
    const d = this.seats[i].def;
    if (d.ref && this.refs[d.ref]) {
      this.refs[d.ref].getWorldPosition(out);
      return this.group.worldToLocal(out);
    }
    return out.fromArray(d.offset);
  }

  // The eye for a seat. Read LIVE off the hierarchy rather than computed,
  // because ref_camera_gunner hangs off the turret body and therefore yaws with
  // the ring — which is the behaviour we want and would have to be re-derived
  // by hand otherwise.
  seatEye(i, out) {
    const d = this.seats[i].def;
    if (d.camera && this.refs[d.camera]) return this.refs[d.camera].getWorldPosition(out);
    this.seatWorld(i, out);
    out.y += 0.75;
    return out;
  }

  // Which seat a soldier standing here would take: the nearest FREE one. No
  // menu, no cycle key — walk round to the back of the hog and press E and you
  // are on the tailgate, stand at the door and you are driving.
  // `skipRoles` lets a caller refuse seats it cannot actually crew. Bots use it
  // to leave the driver's seat alone: nothing drives for them yet (phase 7b),
  // so a bot taking the wheel does not produce a moving Warthog, it produces a
  // parked one with the wheel occupied.
  nearestFreeSeat(pos, skipRoles = null) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].occupant) continue;
      if (skipRoles && skipRoles.includes(this.seats[i].def.role)) continue;
      const d = pos.distanceToSquared(this.seatWorld(i, _v3));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  enterSeat(i, who) {
    if (i < 0 || i >= this.seats.length || this.seats[i].occupant) return false;
    this.seats[i].occupant = who;
    this._syncSeatDoors();
    this.wake();
    return true;
  }

  exitSeat(who) {
    const i = this.seatOf(who);
    if (i < 0) return;
    this.seats[i].occupant = null;
    this._syncSeatDoors();
    if (i === 0) {
      this.input.throttle = 0;
      this.input.brake = 0;
      this.input.steer = 0;
      this.input.handbrake = false;
    }
  }

  // Drag every seated bot's `pos` along with the seat.
  //
  // The MESH does not need this — it is parented, so it rides for free — but
  // `pos` is what the rest of the sim reads: who is near an objective, who a
  // squad forms up on, and where a bullet has to land to hit them. A rider
  // whose `pos` stayed at the kerb would be shot at an empty patch of road.
  //
  // Called after the physics step rather than from the soldier's own update,
  // because the soldier pass runs BEFORE vehicles (game.js) — reading the seat
  // from there is a frame stale, which is 40 cm at 25 m/s. Same ordering
  // argument as `player.updateVehicleCamera`.
  //
  // The player is skipped: their controller owns `pos` and writes it from the
  // seat itself, and two writers would race. It is identified by `seatIdx` —
  // the field a mounted Soldier carries and the Player controller does not (it
  // keeps its own `vehicleSeatIdx`). Testing `isPlayer` would NOT work: the
  // occupant for the player is the controller, which has no such flag, so the
  // yaw write below would land on it and stamp out their look direction.
  syncOccupants() {
    for (let i = 0; i < this.seats.length; i++) {
      const who = this.seats[i].occupant;
      if (!who || who.seatIdx !== i || !who.pos) continue;
      this.seatWorld(i, _v1);
      who.pos.copy(_v1);
      who.yaw = this.yaw;
    }
  }

  // Aim the ring. Rates rather than a snap, so a heavy gun reads as heavy and
  // whipping the mouse does not teleport the barrel across the field.
  aimTurret(yaw, pitch, dt) {
    const T = this.rig.turret;
    const dy = wrapPi(yaw - this.turretYaw);
    const my = T.yawRate * dt;
    this.turretYaw = wrapPi(this.turretYaw + Math.max(-my, Math.min(my, dy)));
    const want = Math.max(T.pitchMin, Math.min(T.pitchMax, pitch));
    const mp = T.pitchRate * dt;
    this.turretPitch += Math.max(-mp, Math.min(mp, want - this.turretPitch));
  }

  // Muzzle position and the direction the barrel actually points — not where
  // the gunner is looking. They differ while the ring is still catching up, and
  // the round has to leave the gun.
  muzzle(outPos, outDir) {
    if (!this.turret) return false;
    this.turret.muzzle.getWorldPosition(outPos);
    this.turret.muzzle.getWorldQuaternion(_q1);
    outDir.copy(this.turret.muzzleAxis).applyQuaternion(_q1).normalize();
    return true;
  }

  // Where a soldier stepping out should land: beside the vehicle on the side
  // their seat is on, on the ground, clear of the hull.
  exitPoint(out, seatIdx = 0) {
    this.seatWorld(seatIdx, _v1);
    _v2.copy(_v1).sub(this.group.position);
    _v3.set(1, 0, 0).applyQuaternion(this.quat);          // chassis left
    const side = _v2.dot(_v3) >= 0 ? 1 : -1;
    out.copy(this.group.position).addScaledVector(_v3, 2.4 * side);
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
    if (!this.game.assets.vehicles) return;

    const unclaimed = [];
    for (const m of spawns) {
      // WHAT this marker spawns is a config lookup now, not a hardcoded
      // 'warthog'. A marker nothing claims is COLLECTED and reported rather
      // than skipped in silence — a typo in Blender is otherwise invisible
      // until somebody notices a vehicle is missing from the map.
      const key = vehicleKeyForMarker(m.name);
      if (!key) { unclaimed.push(m.name); continue; }
      if (!this.game.assets.vehicles[key]) {
        console.warn(`[vehicle] ${m.name}: no template loaded for "${key}"`);
        continue;
      }
      const team = teamOfMarker(m.name);
      // A marker whose name carries `_RESERVE` is the player's. It spawns ONE
      // vehicle rather than a pair, and that vehicle is flagged so no squad
      // will claim it — see Squad._findVehicle. The alternative was reserving
      // one of the ordinary pair, which quietly takes a hog off the team that
      // spawned it; a marker says what it is and can be parked where the owner
      // wants it rather than at an offset invented in code.
      const reserved = V.reserveMarker.test(m.name);
      // Markers carry POSITION ONLY — maps.js stores `getWorldPosition` and
      // drops the quaternion, and nothing in map-3 authors a rotation on them
      // anyway. Facing is therefore derived: point at the sector they would be
      // driven to, which reads as staged for the push rather than abandoned.
      const yaw = this._yawTowardNearestSector(m.x, m.z);
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      // One per marker for anything with a real footprint. `perSpawn` lays
      // copies out across the marker's facing at `spacing` metres, which is
      // Warthog spacing — a 24 m wingspan would park two aircraft inside each
      // other, so anything but a hog gets exactly one.
      const n = (reserved || key !== 'warthog') ? 1 : V.perSpawn;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * V.spacing;
        const v = this.spawn(key, m.x + rx * off, m.z + rz * off, yaw, team, m.y);
        if (v) v.reserved = reserved;
      }
    }
    if (unclaimed.length) {
      console.warn(`[vehicle] ${unclaimed.length} marker(s) match no CFG.vehicle.markers prefix: ${unclaimed.join(', ')}`);
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

  spawn(key, x, z, yaw, team = null, markerY = null) {
    const template = this.game.assets.vehicles[key];
    if (!template) return null;

    const group = template.clone(true);
    const v = new Vehicle(key, group, team, this.game.world);
    this.game.scene.add(group);

    // Placed the way it would come to rest — on the plane through its own
    // contact points, tilted to match, springs already at static compression —
    // rather than level at the highest corner with the rest left to fall.
    v.settleAt(x, z, yaw);

    // Then LIFTED back to the marker's authored height, because the markers are
    // placed deliberately above the floor so a vehicle drops onto it.
    //
    // Doing it in this order rather than simply spawning at the marker height
    // is the whole point. `settleAt` exists because dropping a vehicle in LEVEL
    // over sloped ground leaves the downhill corners dangling, so it lands on
    // one corner and slides while it settles — measured at 2.6 m/s at the blue
    // HQ. Settling first fixes the ATTITUDE to the ground it is going to land
    // on; lifting along world Y afterwards preserves that attitude. The result
    // is a vehicle that falls parallel to the slope and lands on all of its
    // struts at once, which is the drop the marker was authored for and not the
    // tumble it would otherwise get. Both HQ pads run to 7.9 and 9.5 degrees.
    // The fall is capped at what the gear can absorb, NOT at what the marker
    // asks for. See the `dropMin` note in config: map-3's markers stand 3.4 m
    // to 6.4 m above the floor, which at `CFG.gravity` of 18 is an arrival at
    // 11-15 m/s and carries an order of magnitude more energy than any of these
    // springs can store. Uncapped, every vehicle on the map spawns by crashing.
    if (markerY !== null && Number.isFinite(markerY)) {
      const T = v.tune;
      const absorb = T.dropAbsorb !== undefined
        ? T.dropAbsorb
        : T.travel * (1 - T.sag) / Math.max(1e-3, T.sag);
      let drop = markerY - v.group.position.y;
      if (drop > V.dropMax) {
        console.warn(`[vehicle] ${key}: marker stands ${drop.toFixed(1)} m above the floor — that is almost certainly a mistake`);
      }
      drop = Math.min(drop, absorb, V.dropMax);
      if (drop > V.dropMin) {
        v.pos.y += drop;
        v.wake();
        v.syncVisuals();
      }
    }
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
    // Doors run on real frame time, not the physics accumulator, and outside
    // the sleep check — a parked hog still has to be able to open a door.
    for (const v of this.vehicles) {
      v.updateDoors(dt);
      v.updateGear(dt);
      v.updateVector(dt);
      v.syncVisuals();
      v.syncOccupants();
    }
  }

  // Every vehicle within `range` of a point. The ALT outline needs the set, not
  // the nearest one.
  within(pos, range) {
    const out = [];
    for (const v of this.vehicles) {
      if (pos.distanceToSquared(v.group.position) <= range * range) out.push(v);
    }
    return out;
  }

  dispose() {
    for (const v of this.vehicles) this.game.scene.remove(v.group);
    this.vehicles.length = 0;
  }
}
