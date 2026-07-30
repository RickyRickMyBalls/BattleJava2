// Mesh collision for GLB maps, built from Blender-authored parents:
//   Collision_floor_parent — walkable surfaces (grounding via down-ray → tunnels work)
//   Collision_wall_parent  — blocking shells (capsule push-out)
//   Collision_cover_parent — optional; becomes AABB cover for LOS/bullet checks
// Geometry is baked into world space so all queries use identity transforms.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _ray = new THREE.Ray();
const _down = new THREE.Vector3(0, -1, 0);
const _point = new THREE.Vector3();
const _target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

// Merge every mesh under `parent` into one world-space position-only geometry.
// `filter(mesh)` optionally rejects meshes (the lobby stage uses it to drop sky
// and decor nodes, which have no business in a collision hull).
export function extractWorldGeometry(parent, filter = null) {
  const parts = [];
  parent.updateMatrixWorld(true);
  parent.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (filter && !filter(o)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position') g.deleteAttribute(name);
    }
    g.applyMatrix4(o.matrixWorld);
    parts.push(g);
  });
  if (!parts.length) return null;
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  for (const p of parts) { if (p !== merged) p.dispose(); }
  return merged;
}

export class MapCollision {
  constructor(floorParent, wallParent) {
    this.floorBvh = null;
    this.wallBvh = null;

    const floorGeo = floorParent ? extractWorldGeometry(floorParent) : null;
    if (floorGeo) this.floorBvh = new MeshBVH(floorGeo);

    const wallGeo = wallParent ? extractWorldGeometry(wallParent) : null;
    if (wallGeo) this.wallBvh = new MeshBVH(wallGeo);
  }

  // Height of the walkable surface beneath (x, y, z), looking down from just
  // above head height. Inside a tunnel the ray starts below the roof, so it
  // finds the tunnel floor instead of the hill above it. Returns null if no
  // floor within reach (caller falls back to the heightfield).
  groundAt(x, y, z, headroom = 1.4, reach = 8) {
    if (!this.floorBvh) return null;
    _ray.origin.set(x, y + headroom, z);
    _ray.direction.copy(_down);
    const hit = this.floorBvh.raycastFirst(_ray, THREE.DoubleSide);
    if (!hit || hit.distance > headroom + reach) return null;
    return hit.point.y;
  }

  // Push a capsule (feet at pos.y) out of wall shells. XZ-only so walls never
  // launch anyone vertically. Two sphere samples: shins and chest.
  pushOut(pos, radius = 0.55, height = 1.7) {
    if (!this.wallBvh) return;
    for (const sampleY of [pos.y + 0.5, pos.y + height * 0.8]) {
      _point.set(pos.x, sampleY, pos.z);
      const res = this.wallBvh.closestPointToPoint(_point, _target, 0, radius);
      if (!res) continue;
      const dx = pos.x - res.point.x;
      const dz = pos.z - res.point.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6 && res.distance < radius) {
        const push = (radius - res.distance) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
  }

  // Does a straight segment cross a wall shell? (For future LOS use.)
  segmentBlocked(ax, ay, az, bx, by, bz) {
    if (!this.wallBvh) return false;
    _ray.origin.set(ax, ay, az);
    _ray.direction.set(bx - ax, by - ay, bz - az);
    const len = _ray.direction.length();
    if (len < 1e-6) return false;
    _ray.direction.divideScalar(len);
    const hit = this.wallBvh.raycastFirst(_ray, THREE.DoubleSide);
    return !!hit && hit.distance < len;
  }
}

// Find the authored parents inside a loaded map root, build collision, hide
// the shells from rendering, and surface cover AABBs if the parent exists.
export function buildMapCollision(root) {
  root.updateMatrixWorld(true);
  let floorParent = null, wallParent = null, coverParent = null;
  root.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (n === 'collision_floor_parent') floorParent = o;
    else if (n === 'collision_wall_parent') wallParent = o;
    else if (n === 'collision_cover_parent') coverParent = o;
  });
  if (!floorParent && !wallParent && !coverParent) return null;

  const collision = new MapCollision(floorParent, wallParent);

  // Cover parent → AABBs for the existing LOS / bullet / AI cover systems
  collision.coverBoxes = [];
  if (coverParent) {
    coverParent.updateMatrixWorld(true);
    const box = new THREE.Box3();
    coverParent.traverse((o) => {
      if (!o.isMesh) return;
      box.setFromObject(o);
      collision.coverBoxes.push({
        minX: box.min.x, maxX: box.max.x,
        minY: box.min.y, maxY: box.max.y,
        minZ: box.min.z, maxZ: box.max.z,
      });
    });
  }

  // Visibility is authored in Blender — collision meshes may double as real
  // visual floors/walls, so we never hide them here. (Give a shell an
  // invisible material in Blender if it shouldn't render.)
  collision.parents = { floorParent, wallParent, coverParent };

  return collision;
}
