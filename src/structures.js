// Placed structures — the Engineer's quick wall today, whatever else a gadget
// stands up in the world later.
//
// The shape is Supply's, deliberately: this module owns the props, their meshes
// and their lifetimes, and knows nothing about why anyone wanted one. What
// differs is what the thing IS. A crate is a pool you draw from and the world
// can ignore it; a wall is a VOLUME, and the world has to be told.
//
// That is the real reason this is a module rather than three lines in
// player.js. A cover box has to be pushed into `world.coverBoxes` when the wall
// goes up and SPLICED OUT when it comes down. Crates never needed a remove
// path, so the cover list never had one — and a despawned wall whose box stayed
// behind is an invisible bullet-stopper sitting in the middle of the map, the
// kind of bug that reads as netcode.
//
// Placement is blind: the wall lands `placeAhead` metres in front of the placer
// at their yaw, the same way a crate does. A ghost preview is the better verb
// for something you aim, and `canPlaceAt` is written to be the test behind one
// — it takes a position rather than reading the owner, so a preview and the
// commit can ask exactly the same question.

import * as THREE from 'three';
import { CFG } from './config.js';
import { makeCoverBox } from './cover.js';

const C = CFG.structure;

// Blockout geometry: a slab with a lit strip along its top edge and a post at
// each end. The strip is the functional part — it marks the line you can crouch
// under and shoot over, which is the whole point of the object, and it has to
// read in shade because a wall's job is to be somewhere dark and defensible.
// Swap for an authored GLB by giving the wall def a prop key and cloning
// `assets.props` here; nothing else in this file cares what the mesh is.
function makeWallMesh(len, height, thick, color) {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(len, height, thick),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 }),
  );
  body.position.y = height / 2;
  g.add(body);

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xffc44d, emissive: 0xffc44d, emissiveIntensity: 0.5, roughness: 0.6,
  });
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(len * 0.98, height * 0.07, thick * 1.06), trimMat,
  );
  strip.position.y = height * 0.965;
  g.add(strip);

  // End posts, slightly proud of the slab, so the wall has a readable extent
  // instead of dissolving into whatever is behind it at a glance.
  const postGeo = new THREE.BoxGeometry(thick * 1.1, height * 1.04, thick * 1.5);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3f4850, roughness: 0.85 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(sx * (len / 2 - thick * 0.55), height * 0.52, 0);
    g.add(post);
  }

  return g;
}

export class Structures {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  count(team) {
    let n = 0;
    for (const s of this.list) if (s.team === team) n++;
    return n;
  }

  // Ground height at a point, preferring authored collision over the analytic
  // terrain — the same order every other grounded thing in the game uses.
  _groundAt(x, z, fromY) {
    const world = this.game.world;
    const col = world.collision;
    const y = col ? col.groundAt(x, fromY, z) : null;
    return y === null || y === undefined ? world.heightAt(x, z) : y;
  }

  // Is this a legal spot? Written against explicit position/yaw rather than an
  // owner so a placement ghost can ask the identical question a frame before
  // committing. Returns a reason string when it says no, because the HUD saying
  // WHY is the difference between a rule and a mystery.
  canPlaceAt(x, z, yaw, def, team, fromY) {
    const [len, height, thick] = def.wall.size;
    const hx = len / 2, hz = thick / 2;

    if (this.count(team) >= C.maxPerTeam) return { ok: false, why: 'STRUCTURE LIMIT' };

    // Ground under the four corners. A rigid box on broken ground either buries
    // an end or floats one, and a floating wall leaks bullets under it.
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    let lo = Infinity, hi = -Infinity;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = sx * hx, lz = sz * hz;
        const wx = x + lx * cos + lz * sin;
        const wz = z - lx * sin + lz * cos;
        const gy = this._groundAt(wx, wz, fromY);
        if (gy < lo) lo = gy;
        if (gy > hi) hi = gy;
      }
    }
    if (hi - lo > C.maxSlope) return { ok: false, why: 'GROUND TOO STEEP' };

    const base = lo;
    const box = makeCoverBox(x, z, hx, hz, base - 0.5, base + height, yaw);

    // Overlap against what is already standing. Compared as world AABBs, which
    // is conservative for turned boxes — it refuses a few spots that would
    // actually fit. Refusing a legal spot costs a second; allowing two walls to
    // interpenetrate costs a permanent piece of broken geometry.
    for (const b of this.game.world.coverBoxes) {
      if (box.minX > b.maxX || box.maxX < b.minX) continue;
      if (box.minZ > b.maxZ || box.maxZ < b.minZ) continue;
      if (box.minY > b.maxY || box.maxY < b.minY) continue;
      return { ok: false, why: 'NO ROOM' };
    }

    // Nobody standing in it. Includes the placer's own squad and the placer —
    // `placeAhead` normally clears them, but a wall is 3.2 m wide and a
    // squadmate crowding your shoulder is well inside that.
    const reach = Math.max(hx, hz) + C.clearRadius;
    for (const s of this.game.allSoldiers) {
      if (!s.alive && !s.downed) continue;
      const dx = s.pos.x - x, dz = s.pos.z - z;
      if (dx * dx + dz * dz > reach * reach) continue;
      // Precise test in the wall's own frame, so standing off the END of a wall
      // does not block it the way the round reach check alone would.
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) < hx + C.clearRadius && Math.abs(lz) < hz + C.clearRadius) {
        return { ok: false, why: 'SOMEONE IN THE WAY' };
      }
    }

    return { ok: true, box, base };
  }

  // Stand one up in front of `owner`. Returns the structure, or null with the
  // reason left on `this.lastRefusal` for the caller to surface.
  place(owner, def) {
    if (!def || !def.wall) return null;
    const yaw = owner.yaw;
    const x = owner.pos.x + Math.sin(yaw) * C.placeAhead;
    const z = owner.pos.z + Math.cos(yaw) * C.placeAhead;

    const check = this.canPlaceAt(x, z, yaw, def, owner.team, owner.pos.y + 1);
    if (!check.ok) { this.lastRefusal = check.why; return null; }
    this.lastRefusal = null;

    const [len, height, thick] = def.wall.size;
    const s = {
      def,
      team: owner.team,
      owner,
      life: C.life,
      box: check.box,
      pos: new THREE.Vector3(x, check.base, z),
      mesh: makeWallMesh(len, height, thick, def.wall.color),
    };
    s.mesh.position.copy(s.pos);
    // The mesh and the cover box share one angle — see the convention note on
    // makeCoverBox. If these ever disagree, rounds stop where nothing is drawn.
    s.mesh.rotation.y = yaw;

    this.game.scene.add(s.mesh);
    this.game.world.coverBoxes.push(s.box);
    this.list.push(s);
    return s;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.life -= dt;
      if (s.life <= 0) this.remove(s);
    }
  }

  remove(s) {
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);

    // The half that matters. A box left in the cover list outlives the mesh and
    // goes on stopping bullets in open ground where nothing is drawn.
    const bi = this.game.world.coverBoxes.indexOf(s.box);
    if (bi >= 0) this.game.world.coverBoxes.splice(bi, 1);
    s.box = null;

    if (s.mesh) {
      this.game.scene.remove(s.mesh);
      s.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      s.mesh = null;
    }
  }

  dispose() {
    for (const s of [...this.list]) this.remove(s);
  }
}
