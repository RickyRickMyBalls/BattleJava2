// Mesh collision for GLB maps, built from Blender-authored parents:
//   Collision_floor_parent — surfaces you walk on (grounding via down-ray → tunnels work)
//   Collision_wall_parent  — blocking shells (capsule push-out)
//   Collision_cover_parent — optional; becomes AABB cover for LOS/bullet checks
// Geometry is baked into world space so all queries use identity transforms.
//
// The two hulls are NOT the two parents. At load the floor parent is split by
// slope: anything past GROUND_MAX_SLOPE is a wall, wherever it was authored, and
// joins the wall parent's geometry in the blocking hull. So a parent is a hint
// about intent, not a promise — a building can go in whole and come out with its
// decks walkable and its flanks solid.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _ray = new THREE.Ray();
const _down = new THREE.Vector3(0, -1, 0);
const _point = new THREE.Vector3();
const _target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

// How far below the query point an authored floor still counts as "the ground
// under you". Raising this is FREE: `raycastFirst(ray, side)` leaves its `far`
// at Infinity, so the BVH already walks all the way down to that floor and the
// old limit only threw the answer away. It was 8 m, which is shorter than plenty
// of the real drops on a 1:1-scale map — past it the caller fell back to the
// heightfield, which reads the TOP surface (wrong under a bridge) and used to be
// clamped flat below the marker plane (wrong everywhere low). This is a sanity
// leash on the answer, not a cost.
const GROUND_REACH = 250;

// Steepest surface you can stand on, in degrees off horizontal. Everything in a
// floor parent past this is re-filed as a wall at load (see splitBySlope), which
// is what lets a whole building be parented to Collision_floor_parent: its decks
// hold you up, its flanks stop you, and nothing needs splitting in Blender.
const GROUND_MAX_SLOPE = 70;
const MIN_UP = Math.cos(GROUND_MAX_SLOPE * THREE.MathUtils.DEG2RAD);

// Split a floor hull by that slope: what you can stand on, and what should be
// stopping you. Doing this ONCE at build time beats testing every ray hit, and
// it is strictly more useful, because the steep half is exactly the set of
// surfaces that ought to block — so it gets folded into the wall hull below.
// That is what lets one authored parent do both jobs: parent a whole building to
// Collision_floor_parent and its decks hold you up while its flanks stop you.
//
// Geometry arrives as a world-space, position-only triangle soup (see
// extractWorldGeometry), so a triangle is nine consecutive floats and its normal
// is the raw cross product — no transform, no index indirection. Winding is not
// to be trusted (an authored floor is just as walkable with its normal flipped),
// hence the abs: what matters is how far off horizontal a surface lies, not
// which way it faces.
function splitBySlope(geo) {
  const pos = geo.attributes.position.array;
  const tris = Math.floor(pos.length / 9);
  const flag = new Uint8Array(tris);   // 1 walkable, 2 steep, 0 degenerate
  let nWalk = 0, nSteep = 0;
  for (let t = 0; t < tris; t++) {
    const i = t * 9;
    const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
    const ux = pos[i + 3] - ax, uy = pos[i + 4] - ay, uz = pos[i + 5] - az;
    const vx = pos[i + 6] - ax, vy = pos[i + 7] - ay, vz = pos[i + 8] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;   // zero-area: belongs in neither hull
    if (Math.abs(ny) / len >= MIN_UP) { flag[t] = 1; nWalk++; } else { flag[t] = 2; nSteep++; }
  }

  const walk = nWalk ? new Float32Array(nWalk * 9) : null;
  const steep = nSteep ? new Float32Array(nSteep * 9) : null;
  let w = 0, s = 0;
  for (let t = 0; t < tris; t++) {
    if (flag[t] === 1) { walk.set(pos.subarray(t * 9, t * 9 + 9), w); w += 9; }
    else if (flag[t] === 2) { steep.set(pos.subarray(t * 9, t * 9 + 9), s); s += 9; }
  }
  const soup = (arr) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  return {
    walkable: walk ? soup(walk) : null,
    steep: steep ? soup(steep) : null,
    walkTris: nWalk,
    steepTris: nSteep,
  };
}

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
    // Un-quantize BEFORE baking to world space. `npm run assets` ships every map
    // through KHR_mesh_quantization, so `position` arrives as a NORMALIZED Int16
    // whose real scale lives in the node transform — and `applyMatrix4` reads
    // those ints denormalized (-1..1) but writes the world-space result straight
    // back into the Int16 array, where a coordinate like 1120 saturates at 32767.
    // Every compressed map's floor and wall BVH collapsed into a 2 m cube at the
    // origin: grounding fell through to the heightfield everywhere and walls
    // stopped blocking, silently, at the moment the map got compressed.
    const src = g.attributes.position;
    if (src.normalized || !(src.array instanceof Float32Array)) {
      const f = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) {
        f[i * 3] = src.getX(i); f[i * 3 + 1] = src.getY(i); f[i * 3 + 2] = src.getZ(i);
      }
      g.setAttribute('position', new THREE.BufferAttribute(f, 3));
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
    const split = floorGeo ? splitBySlope(floorGeo) : null;
    if (split && split.walkable) this.floorBvh = new MeshBVH(split.walkable);

    // Authored walls plus the floor parent's own steep faces. Both are
    // world-space position-only soups, so they merge without conversion.
    const wallGeo = wallParent ? extractWorldGeometry(wallParent) : null;
    const steepGeo = split ? split.steep : null;
    const blocking = wallGeo && steepGeo
      ? mergeGeometries([wallGeo, steepGeo], false)
      : (wallGeo || steepGeo);
    if (blocking) this.wallBvh = new MeshBVH(blocking);

    // Reported by the map loader; the walkable/steep ratio is the fastest read
    // on whether a map's floor parent is authored the way the code expects.
    this.slopeSplit = split
      ? { walkable: split.walkTris, steep: split.steepTris }
      : { walkable: 0, steep: 0 };
  }

  // Height of the walkable surface beneath (x, y, z), looking down from just
  // above head height. Inside a tunnel the ray starts below the roof, so it
  // finds the tunnel floor instead of the hill above it. Anything steeper than
  // GROUND_MAX_SLOPE is skipped rather than stood on. Returns null if no floor
  // within reach (caller falls back to the heightfield).
  groundAt(x, y, z, headroom = 1.4, reach = GROUND_REACH) {
    if (!this.floorBvh) return null;
    const top = y + headroom;
    _ray.origin.set(x, top, z);
    _ray.direction.copy(_down);
    const hit = this.floorBvh.raycastFirst(_ray, THREE.DoubleSide);
    if (!hit) return null;
    // No slope test here on purpose: splitBySlope already kept the steep faces
    // out of this hull, so the nearest hit IS the nearest standable surface and
    // the ray falls through a wall to the deck below it for free.
    if (hit.point.y < top - (headroom + reach)) return null;
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

  // Distance to the first wall shell along a ray, or null if nothing within
  // `maxDist`. `dir` need not be normalized. The third-person boom uses this to
  // stop short of whatever is behind the player.
  rayDistance(ox, oy, oz, dx, dy, dz, maxDist) {
    if (!this.wallBvh) return null;
    _ray.origin.set(ox, oy, oz);
    _ray.direction.set(dx, dy, dz);
    const len = _ray.direction.length();
    if (len < 1e-6) return null;
    _ray.direction.divideScalar(len);
    const hit = this.wallBvh.raycastFirst(_ray, THREE.DoubleSide);
    return hit && hit.distance <= maxDist ? hit.distance : null;
  }

  // Does a straight segment cross a wall shell? (For future LOS use.)
  segmentBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    return this.rayDistance(ax, ay, az, dx, dy, dz, len) !== null;
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
