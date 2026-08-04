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
const _Z = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;   // the linkage table is authored in degrees
const _X = new THREE.Vector3(1, 0, 0);
const _tmpBox = new THREE.Box3();
const _mat = new THREE.Matrix4();

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

    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.steerAngle = 0;                 // radians, eased toward the input
    this.speed = 0;                      // signed forward speed, m/s — for HUD/AI
    this.asleep = false;
    this.stillTimer = 0;
    this.flipped = false;                // on its roof and settled; see _flipCheck
    this.flipTimer = 0;

    // Crew. One entry per CFG.vehicle.seats def; `occupant` is a Player or a
    // Soldier (Phase 7) or null. The driver is seat 0 by convention and is
    // exposed as a getter so the physics never has to know about seating.
    this.seats = V.seats.map((def) => ({ def, occupant: null }));
    this.turretYaw = 0;                  // radians, relative to the chassis
    this.turretPitch = 0;

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

    this._measureTurret();
    this._measureLinkage();
    this._measureDoors();

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
    const D = V.doors;
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
    const rate = dt / Math.max(0.01, V.doors.openTime);
    for (const d of this.doors) {
      if (d.open === d.target) continue;
      const step = Math.min(rate, Math.abs(d.target - d.open));
      d.open += Math.sign(d.target - d.open) * step;
      d.node.quaternion.copy(d.base)
        .multiply(_q2.setFromAxisAngle(d.axis, d.open * d.angle));
    }
  }

  toggleDoor(d) { d.target = d.target > 0.5 ? 0 : 1; return d.target > 0.5; }

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

    for (const [code, name, axis, dir, family] of V.linkage.hardware) {
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
    if (pts.length < 4) { this.placeAt(x, this.groundAt(x, z), z, yaw); return; }

    // Normal from the diagonals — four points rarely lie on a plane exactly,
    // and the diagonal cross product is the least-squares-ish answer for a
    // rectangle without solving anything.
    _v1.copy(pts[3]).sub(pts[0]);
    _v2.copy(pts[2]).sub(pts[1]);
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

    const c = pts[0].add(pts[1]).add(pts[2]).add(pts[3]).multiplyScalar(0.25);
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

    this._flipCheck(h, upright);
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
    this._resolveContact(_hullPoint, _Y, T.restitution, V.flip.groundFriction);
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
    const F = V.flip;
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
    this.pos.y = this.groundAt(this.pos.x, this.pos.z) + this.com.y + V.flip.rightLift;
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
    const K = V.linkage;

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
  seatMount() { return this.group; }

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
  nearestFreeSeat(pos) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].occupant) continue;
      const d = pos.distanceToSquared(this.seatWorld(i, _v3));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  enterSeat(i, who) {
    if (i < 0 || i >= this.seats.length || this.seats[i].occupant) return false;
    this.seats[i].occupant = who;
    this.wake();
    return true;
  }

  exitSeat(who) {
    const i = this.seatOf(who);
    if (i < 0) return;
    this.seats[i].occupant = null;
    if (i === 0) {
      this.input.throttle = 0;
      this.input.brake = 0;
      this.input.steer = 0;
      this.input.handbrake = false;
    }
  }

  // Aim the ring. Rates rather than a snap, so a heavy gun reads as heavy and
  // whipping the mouse does not teleport the barrel across the field.
  aimTurret(yaw, pitch, dt) {
    const T = V.turret;
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

    // Placed the way it would come to rest — on the plane through its own four
    // contact points, tilted to match, springs already at static compression —
    // rather than level at the highest corner with the rest left to fall.
    v.settleAt(x, z, yaw);
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
    for (const v of this.vehicles) { v.updateDoors(dt); v.syncVisuals(); }
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
