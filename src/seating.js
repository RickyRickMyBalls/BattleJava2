// Putting a body in a vehicle seat.
//
// This lives on its own, with no Game and no Soldier in it, for one reason: the
// SEAT tab of /chartest.html has to place its preview bodies through the SAME
// code the match does. A tuner that positions a marine even slightly
// differently from the game is a tuner that produces numbers which do not
// transfer, which is worse than no tuner — you would trust it.
//
// So `soldier.js` and `seatrange.js` both call these two functions and neither
// owns a private copy of the arithmetic.

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export const DEFAULT_POSE = { pos: [0, 0, 0], rot: [0, 0, 0] };

// Mixamo names survive retargeting with the `mixamorig` prefix stripped (see
// assets.js), so match on the bare name and tolerate either separator.
export function findBone(mesh, want) {
  let found = null;
  mesh.traverse((o) => {
    if (found || !o.isBone) return;
    const n = o.name.replace(/^.*?mixamorig[:_]?/i, '').replace(/[:_\s]/g, '').toLowerCase();
    if (n === want) found = o;
  });
  return found;
}

// How high above its own origin this rig's hips sit while holding `act`.
//
// Derived rather than authored because a soldier's origin is at the FEET —
// that is what grounds them when they are walking — but a seated clip's feet
// are out in front of the body. Dropping the origin onto a seat marker
// therefore leaves the character standing in the footwell. Subtracting this
// lands the HIPS on the marker, which is the only reading of a seat empty that
// does not need a magic number.
//
// Measured on the live skeleton, so it reflects the retargeted clip on THIS
// character rather than the source file's numbers — per-character bind poses
// differ, the same reason assets.js measures heights per SkinnedMesh instead of
// trusting the GLB.
//
// Averaged across the clip, not read at t=0, for the same reason assets.js
// samples foot bones across a walk: a seated idle still breathes, and anchoring
// to whichever frame the soldier happened to sit down on would make ride height
// depend on when the player pressed E.
export function measureHipsRise(mesh, mixer, act, samples = 5) {
  if (!mesh || !mixer || !act) return 0;
  const hips = findBone(mesh, 'hips');
  if (!hips) return 0;
  const dur = act.getClip().duration;
  const held = act.time;
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    act.time = (i / samples) * dur;
    mixer.update(0);
    mesh.updateMatrixWorld(true);
    hips.getWorldPosition(_v2);
    mesh.getWorldPosition(_v);
    sum += _v2.y - _v.y;
  }
  act.time = held;
  mixer.update(0);
  return sum / samples;
}

// A zero-length crossfade is SCHEDULED, not applied — three.js resolves it on
// the next mixer step with a real dt. Anything that measures the skeleton
// immediately after `fadeIn(0)` therefore reads the OUTGOING pose. That cost 18
// cm of error (a standing marine's hips instead of a seated one's) and made it
// intermittent, because what it measured depended on what had been playing.
// Forcing the weights makes the pose true right now.
export function forcePose(actions, key) {
  for (const k of Object.keys(actions)) {
    if (actions[k]) actions[k].setEffectiveWeight(k === key ? 1 : 0);
  }
}

// Park a mesh on a seat. Called once on entry rather than per frame — the
// parent moves, so the child does not have to.
//
// The mesh is PARENTED to the vehicle rather than driven from a world position
// each frame, and that is the whole trick. Two measured reasons:
//
//   - a soldier's mesh transform is written inside `_updateAnim`'s distance
//     throttle, so past 60 m a rider driven from `pos` updates every other
//     frame and visibly swims behind a hog doing 20 m/s;
//   - `pos` + `yaw` carry a yaw and nothing else, and the chassis rolls 7.4° in
//     a corner (VEHICLE_PLAN.md phase 2) — a yaw-only body leans out of its own
//     seat.
//
// Parenting buys roll, pitch and suspension travel for free, at no per-frame
// cost.
export function seatMeshOn(vehicle, seatIdx, mesh, rise, pose) {
  if (!vehicle || !mesh) return;
  const p = pose || DEFAULT_POSE;
  vehicle.seatMount().add(mesh);
  // Read the scratch vector out into locals BEFORE anything else can touch it.
  // Leaving `.z` to be read after another call would be the module-scratch
  // aliasing bug combat.js carries a standing warning about.
  vehicle.seatLocal(seatIdx, _v);
  const sx = _v.x, sy = _v.y, sz = _v.z;
  mesh.position.set(sx + p.pos[0], sy + p.pos[1] - rise, sz + p.pos[2]);
  mesh.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
}

// The pose block a seat actually uses: its own override if it has one, the
// vehicle-wide default otherwise. One reader so the tuner and the game cannot
// disagree about precedence.
export function poseFor(seatDef, fallback) {
  return (seatDef && seatDef.pose) || fallback || DEFAULT_POSE;
}
