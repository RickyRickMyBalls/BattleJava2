// Ground and collision for the lobby stage, satisfying the arena world slice
// (contract in arena.js). Sources, in order of preference:
//
//   1. Authored parents inside lobby_stage.glb — Collision_floor_parent /
//      Collision_wall_parent / Collision_cover_parent, exactly the convention
//      the GLB maps already use, so buildMapCollision() handles them unchanged.
//   2. A BVH over the stage's visible geometry, for before those parents are
//      authored. It is wrapped in a MapCollision so Player still gets the
//      headroom-aware groundAt() path, but it yields NO wall push-out:
//      treating every mesh as a wall would wedge the player inside the set
//      dressing. clampToMap() is the backstop until (1) exists.
//   3. Nothing usable → a flat plane, matching makeFlatWorld(). The lobby
//      already renders a procedural set when the stage GLB is missing, and
//      roam should still work there.
//
// Grounding must be headroom-aware, not "topmost surface": the authored hangar
// has a roof ~12m up, so a ray from above the bounding box lands on the roof
// and would spawn the player there. Everything casts from just above head
// height instead. heightAt() has no Y in the contract, so it uses a fixed
// origin near the floor — correct for a single-level set; a multi-level stage
// needs the authored Collision_floor_parent, which is the real answer anyway.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { MapCollision, buildMapCollision, extractWorldGeometry } from './collision.js';
import { raycastCoverBoxes, pushOutCoverBoxes } from './cover.js';

// The exclusions the GLB map height bake uses: spinning/drifting sky nodes and
// backdrop shells are scenery, not ground.
const SKIP = /ring|sky|cloud|rotate_|move_/i;

const _ray = new THREE.Ray();
const _down = new THREE.Vector3(0, -1, 0);

export class LobbyWorld {
  constructor(root, { fallbackY = 0, margin = 0.6, halfExtent = 40, headroom = 2.2 } = {}) {
    this.fallbackY = fallbackY;
    this.headroom = headroom;

    // Authored collision, if the owner has added the parents. Null otherwise.
    this.collision = root ? buildMapCollision(root) : null;
    this.coverBoxes = (this.collision && this.collision.coverBoxes) || [];

    // An authored floor wins; otherwise approximate from the visible set and
    // wrap it in a MapCollision so Player takes the headroom-aware groundAt()
    // path rather than the flat heightAt() fallback. A MapCollision built from
    // nothing has both BVHs null, so pushOut() stays inert — which is what we
    // want: no authored walls means no wall collision.
    this.floorBvh = this.collision ? this.collision.floorBvh : null;
    this.approximate = false;
    if (!this.floorBvh && root) {
      const geo = extractWorldGeometry(root, (m) => !SKIP.test(m.name || ''));
      if (geo) {
        this.floorBvh = new MeshBVH(geo);
        this.approximate = true;
        if (!this.collision) this.collision = new MapCollision(null, null);
        this.collision.floorBvh = this.floorBvh;
      }
    }

    // Bounds drive clampToMap and the downward ray's start height. Geometry is
    // already baked to world space, so its bbox needs no transform.
    const box = new THREE.Box3();
    if (this.floorBvh) {
      this.floorBvh.geometry.computeBoundingBox();
      box.copy(this.floorBvh.geometry.boundingBox);
    }
    if (box.isEmpty()) {
      box.set(
        new THREE.Vector3(-halfExtent, fallbackY, -halfExtent),
        new THREE.Vector3(halfExtent, fallbackY + 4, halfExtent)
      );
    }
    this.bounds = box;
    this.minX = box.min.x + margin;
    this.maxX = box.max.x - margin;
    this.minZ = box.min.z + margin;
    this.maxZ = box.max.z - margin;
    // A margin wider than the stage would invert the bounds; collapse to centre.
    if (this.minX > this.maxX) this.minX = this.maxX = (box.min.x + box.max.x) / 2;
    if (this.minZ > this.maxZ) this.minZ = this.maxZ = (box.min.z + box.max.z) / 2;
    this.mapW = this.maxX - this.minX;
    this.mapD = this.maxZ - this.minZ;
    // Ray origin for heightAt: head height above the lowest surface, so a roof
    // sits above the origin and is never mistaken for ground.
    this._rayY = box.min.y + headroom;
  }

  heightAt(x, z) {
    if (!this.floorBvh) return this.fallbackY;
    _ray.origin.set(x, this._rayY, z);
    _ray.direction.copy(_down);
    const hit = this.floorBvh.raycastFirst(_ray, THREE.DoubleSide);
    return hit ? hit.point.y : this.fallbackY;
  }

  clampToMap(v) {
    v.x = Math.max(this.minX, Math.min(this.maxX, v.x));
    v.z = Math.max(this.minZ, Math.min(this.maxZ, v.z));
  }

  // Cover push-out and segment tests. Both were private copies of World's until
  // cover.js took the math over — see the note at the top of that file. The
  // lobby gains the degenerate-overlap shove World always had, and orientation
  // it has no use for yet, at the cost of nothing.
  collideCircle(pos, radius) {
    pushOutCoverBoxes(this.coverBoxes, pos, radius);
  }

  raycastCover(ax, ay, az, bx, by, bz) {
    return raycastCoverBoxes(this.coverBoxes, ax, ay, az, bx, by, bz);
  }

  // Segment vs the stage surface; t in [0,1] of the hit, else Infinity. This is
  // what stops bullets on the hangar floor and walls.
  raycastTerrain(ax, ay, az, bx, by, bz) {
    if (!this.floorBvh) {
      if (ay < this.fallbackY) return 0;
      if (by >= this.fallbackY) return Infinity;
      return (ay - this.fallbackY) / (ay - by);
    }
    _ray.origin.set(ax, ay, az);
    _ray.direction.set(bx - ax, by - ay, bz - az);
    const len = _ray.direction.length();
    if (len < 1e-6) return Infinity;
    _ray.direction.divideScalar(len);
    const hit = this.floorBvh.raycastFirst(_ray, THREE.DoubleSide);
    return hit && hit.distance <= len ? hit.distance / len : Infinity;
  }
}
