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
const _euler = new THREE.Euler();
const _qWant = new THREE.Quaternion();
const _qPose = new THREE.Quaternion();
const _qMount = new THREE.Quaternion();

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
// Forcing the pose makes it true right now.
//
// The suppression is `enabled`, NOT `setEffectiveWeight(0)`, and the difference
// is the whole comment. `setEffectiveWeight` writes the action's BASE weight,
// `_updateWeight` computes `weight = this.weight` and then MULTIPLIES by the
// fade interpolant, and `reset()` — which `playAnim` calls on every transition
// — clears fading but never restores `weight`. So a base of 0 is permanent:
// every later crossfade multiplies by zero, the mixer contributes nothing, and
// the body freezes in the driving pose the moment it leaves the seat while
// `currentAnim` cheerfully reports `idle`. It survived respawn too, because
// `setCharacter` early-returns when the character has not changed, so the
// actions were never rebuilt — one ride broke that soldier for the rest of the
// match, bots included.
//
// `enabled` has none of that: `_updateWeight` returns 0 for a disabled action,
// the base weight stays 1 so future fades have something to scale, and
// `playAnim`'s `next.reset()` sets `enabled = true` — so a clip revives the
// instant it is next selected, with no restore step anyone can forget. (The
// zero-then-restore pairing lobby.js:439/449 uses is the other correct answer;
// it is wrong HERE because it would leave the outgoing clip and the seat clip
// both at weight 1 with their fades stopped, blending two poses 50/50.)
//
// The seat clip still needs `setEffectiveWeight(1)` specifically: it calls
// `stopFading()` internally, which discards the zero-length `fadeIn`
// interpolant that evaluates to 0 at t = now. Killing that interpolant is the
// original reason this function exists.
export function forcePose(actions, key) {
  for (const k of Object.keys(actions)) {
    const a = actions[k];
    if (!a) continue;
    if (k === key) a.setEffectiveWeight(1);
    else a.enabled = false;
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
  // The mount is per-seat: riders hang off the chassis, the gunner off the ring
  // so their body turns with the gun. `seatMountLocal` is the seat position in
  // whichever of those frames applies — NOT `seatLocal`, which is always the
  // chassis frame and is what the SEAT tab reports against.
  vehicle.seatMount(seatIdx).add(mesh);
  // Read the scratch vector out into locals BEFORE anything else can touch it.
  // Leaving `.z` to be read after another call would be the module-scratch
  // aliasing bug combat.js carries a standing warning about.
  vehicle.seatMountLocal(seatIdx, _v);
  const sx = _v.x, sy = _v.y, sz = _v.z;
  mesh.position.set(sx + p.pos[0], sy + p.pos[1] - rise, sz + p.pos[2]);

  // Orientation is DERIVED from the world frame the seat wants, not written
  // straight into `mesh.rotation`. The mount node is not chassis-aligned:
  // everything below the loader's -X to +Z correction lives in the RAW MODEL
  // frame, so `ref_turret_base_rotate_yaw`'s own +Z is 90 degrees off the
  // chassis's, and writing the tuned Euler into it stood the gunner square
  // across his own gun. `yawBase` being identity does not save you — identity
  // means "matches my parent", and the parent is the rotated one.
  //
  // For a chassis-mounted seat the mount's world quaternion IS the chassis's,
  // so this reduces exactly to the old behaviour and the tuned pose numbers
  // keep meaning what they meant.
  const mount = vehicle.seatMount(seatIdx);
  _euler.set(p.rot[0], p.rot[1], p.rot[2]);
  vehicle.seatWorldQuat(seatIdx, _qWant).multiply(_qPose.setFromEuler(_euler));
  mount.getWorldQuaternion(_qMount);
  mesh.quaternion.copy(_qMount).invert().multiply(_qWant);
}

// The pose block a seat actually uses: its own override if it has one, the
// vehicle-wide default otherwise. One reader so the tuner and the game cannot
// disagree about precedence.
export function poseFor(seatDef, fallback) {
  return (seatDef && seatDef.pose) || fallback || DEFAULT_POSE;
}
