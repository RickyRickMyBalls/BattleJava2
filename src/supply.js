// Deployed supply crates — Support's two placeables.
//
// A crate is a FINITE POOL, not a station. It holds a number of draws, hands
// them out one interaction at a time, and when it is empty it is scrap. That
// single rule is what stops one Support anchoring a position for a whole match,
// and it is why `pool` and `per` live on the gadget def rather than here: the
// machinery is shared, the economy is per-crate.
//
// This module owns crates, their meshes and their pools. It deliberately does
// NOT know how to resupply anybody — what a draw does to a soldier's ammo or
// injector belongs with that soldier's state, so `draw()` only decrements the
// pool and the caller applies the goods. See `player._takeSupply`.

import * as THREE from 'three';
import { CFG } from './config.js';

const C = CFG.crate;

// Blockout geometry: a body and a lid band in the crate's own colour, bright
// enough to pick out at range without a light on it. Swap for an authored GLB
// by giving the crate defs a prop key and cloning `assets.props` here instead —
// nothing else in this file cares what the mesh is.
function makeCrateMesh(color) {
  const g = new THREE.Group();
  const [w, h, d] = C.size;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x2f3a42, roughness: 0.85, metalness: 0.1 }),
  );
  body.position.y = h / 2;
  g.add(body);
  // A band around the lid plus a stripe down the front: the emissive is what
  // keeps it legible in the shade, where a crate is most likely to be dropped.
  const bandMat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 0.55, roughness: 0.6,
  });
  const band = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.16, d * 1.02), bandMat);
  band.position.y = h * 0.82;
  g.add(band);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, h * 0.5, d * 1.03), bandMat);
  stripe.position.y = h * 0.42;
  g.add(stripe);
  return g;
}

export class Supply {
  constructor(game) {
    this.game = game;
    this.crates = [];
  }

  // Drop a crate in front of `owner`. Returns it, or null if there is nowhere
  // sensible to put it.
  place(owner, def) {
    if (!def || !def.crate) return null;
    const yaw = owner.yaw;
    const x = owner.pos.x + Math.sin(yaw) * C.placeAhead;
    const z = owner.pos.z + Math.cos(yaw) * C.placeAhead;
    const world = this.game.world;
    const col = world.collision;
    let y = col ? col.groundAt(x, owner.pos.y + 1, z) : null;
    if (y === null) y = world.heightAt(x, z);

    const crate = {
      def,
      team: owner.team,
      owner,
      pool: def.crate.pool,
      life: C.life,
      pos: new THREE.Vector3(x, y, z),
      mesh: makeCrateMesh(def.crate.color),
    };
    crate.mesh.position.copy(crate.pos);
    crate.mesh.rotation.y = yaw;
    this.game.scene.add(crate.mesh);
    this.crates.push(crate);
    return crate;
  }

  // Nearest crate of `team` within reach of `pos` that still has something in
  // it. Empty crates are skipped rather than offered — a prompt you cannot act
  // on is worse than no prompt.
  nearest(pos, team) {
    let best = null, bestD = C.reach;
    for (const c of this.crates) {
      if (c.team !== team || c.pool <= 0) continue;
      const d = pos.distanceTo(c.pos);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // Spend one draw. Returns the amount actually taken (0 if the crate is dry),
  // leaving the caller to apply it — see the note at the top of this file.
  draw(crate) {
    if (!crate || crate.pool <= 0) return 0;
    const per = Math.min(crate.def.crate.per, crate.pool);
    crate.pool -= per;
    if (crate.pool <= 0) this._retire(crate);
    return per;
  }

  update(dt) {
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.life -= dt;
      if (c.life <= 0) this.remove(c);
    }
  }

  // An emptied crate does not vanish under the hands of whoever just used it —
  // it sinks and goes out on a short timer, so the resupply reads as finishing
  // rather than as the world deleting something mid-interaction.
  _retire(crate) {
    crate.life = Math.min(crate.life, 2.5);
    for (const m of crate.mesh.children) {
      if (m.material && m.material.emissive) m.material.emissiveIntensity = 0;
    }
  }

  remove(crate) {
    const i = this.crates.indexOf(crate);
    if (i >= 0) this.crates.splice(i, 1);
    if (crate.mesh) {
      this.game.scene.remove(crate.mesh);
      crate.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      crate.mesh = null;
    }
  }

  dispose() {
    for (const c of [...this.crates]) this.remove(c);
  }
}
