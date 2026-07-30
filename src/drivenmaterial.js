// "Driven" materials: per-instance clones of an authored material that code
// mutates at runtime (ammo counters slide a digit atlas; scope screens swap in
// a render target).
//
// The hazard this exists to solve: assets.weaponModels[key] is a SHARED cached
// model. The player's mounted gun IS that object, and AI guns are clones of it.
// Mutating a material in place would push the player's state onto all 63 AI
// rifles. So anything driven gets its own clone, registered here, and AI clones
// call restoreBakedDisplays() to swap back to the authored original.

// driven material -> authored original. WeakMap (not userData) because
// Object3D.clone JSON-serializes userData, which would destroy the reference.
const origOf = new WeakMap();

// Give `mesh` its own clone of its material and register it, so the shared
// cached model's authored material is never mutated. Safe to call repeatedly:
// on a re-mount the mesh already carries a driven material, and cloning THAT
// would compound whatever the last mount did, so we clone from the original.
//
// Single-material meshes only — every weapon mesh in the kit is one material,
// and an array would make "the original" ambiguous.
export function deriveDrivenMaterial(mesh) {
  if (!mesh || !mesh.material || Array.isArray(mesh.material)) return null;
  const orig = origOf.get(mesh.material) || mesh.material;
  const m = orig.clone();
  origOf.set(m, orig);
  mesh.material = m;
  return m;
}

// AI gun clones inherit whatever material the shared model currently has —
// swap any player-driven material back to the authored one.
export function restoreBakedDisplays(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map((m) => origOf.get(m) || m);
    } else if (origOf.has(o.material)) {
      o.material = origOf.get(o.material);
    }
  });
}
