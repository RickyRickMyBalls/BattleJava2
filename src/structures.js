// Placed structures — the Engineer's quick wall and the squad leader's rally
// beacon today, whatever else a gadget stands up in the world later.
//
// The shape is Supply's, deliberately: this module owns the props, their meshes
// and their lifetimes, and knows nothing about why anyone wanted one. What
// differs is what the thing IS. A crate is a pool you draw from and the world
// can ignore it; a wall is a VOLUME, and the world has to be told.
//
// The beacon is the third answer and it inverts both halves of the wall. It is
// NOT a volume — no cover box, nothing to splice out, rounds pass the space
// beside it — and it does not expire; it has hit points instead, so what ends
// it is the enemy rather than a clock. Those two differences are the whole of
// why `place` branches: everything else here (ground sampling, the legality
// test, mesh lifetime) is common and stays common.
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
const B = CFG.beacon;

// What kind of thing a def stands up. Read off the def's own shape — `wall` or
// `beacon` — never off its name, so a fourth kind is a config block and a mesh
// function rather than a branch anyone has to find.
function kindOf(def) {
  if (!def) return null;
  if (def.wall) return 'wall';
  if (def.beacon) return 'beacon';
  return null;
}

// [length, height, thickness] for either kind, so the legality test can be
// written once against a footprint instead of once per kind.
function footprintOf(def) {
  return def.wall ? def.wall.size : B.size;
}

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

// A beacon reads as a signal, not as furniture: a short mast with a lit head
// and a ring that CLIMBS it, over and over. The pulse is functional rather than
// decorative — this is the object a squadmate is looking for while running, and
// a dark post 1.5 m tall is invisible against any of this game's terrain.
//
// The ring rises rather than spreading across the deck, and that is a fix, not
// a style choice. A ring lying flat at ankle height disappears: the height the
// base is snapped to comes from the COLLISION surface, the drawn ground is not
// exactly that surface, and 8 cm of clearance was not enough to keep the ring
// out of it — it rendered perfectly at 0.9 m and not at all at 0.08. Anything
// flat on the deck would have the same problem again the moment a beacon lands
// on a slope, which is most of this map.
//
// `userData.ring` / `.head` are what `update` animates; nothing else reads them.
// The climb starts ABOVE the base plate, not at it. At 0.12 the ring is only a
// few centimetres proud of a plate that is nearly as wide, and the plate's rim
// hides it from any normal eye height — verified, it simply did not appear.
const RING_Y0 = 0.42;
const RING_Y1 = B.size[1] * 0.95;
function makeBeaconMesh(size, color) {
  const [w, height] = size;
  const g = new THREE.Group();

  const baseMat = new THREE.MeshStandardMaterial({ color: 0x39434b, roughness: 0.85 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(w * 1.25, w * 1.5, 0.12, 10), baseMat);
  base.position.y = 0.06;
  g.add(base);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(w * 0.28, w * 0.34, height * 0.86, 8),
    new THREE.MeshStandardMaterial({ color: 0x6f7c86, roughness: 0.7, metalness: 0.25 }),
  );
  mast.position.y = height * 0.5;
  g.add(mast);

  const glowMat = new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(w * 0.62, 12, 10), glowMat);
  head.position.y = height * 0.93;
  g.add(head);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(w * 2.2, w * 0.1, 6, 20),
    new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.1, roughness: 0.5,
      transparent: true, opacity: 0.8,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = RING_Y0;
  g.add(ring);

  g.userData.ring = ring;
  g.userData.head = head;
  return g;
}

export class Structures {
  constructor(game) {
    this.game = game;
    this.list = [];
    // Beacons kept in their own list purely for the hit test: combat.js walks
    // this per bullet, and filtering `list` by kind in that path would allocate
    // an array for every round fired in a 64-soldier battle.
    this.beacons = [];
  }

  // Live structures of one kind on one side. Counted per KIND because the cap
  // it feeds is a cap on cover: beacons are limited one-per-squad by their own
  // rule, and letting them eat the wall budget would mean a team's rally points
  // silently cost it fortifications.
  count(team, kind = 'wall') {
    let n = 0;
    for (const s of this.list) if (s.team === team && s.kind === kind) n++;
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
    const kind = kindOf(def);
    const [len, height, thick] = footprintOf(def);
    const hx = len / 2, hz = thick / 2;

    if (kind === 'wall' && this.count(team, 'wall') >= C.maxPerTeam) {
      return { ok: false, why: 'STRUCTURE LIMIT' };
    }

    // A beacon may not go down on top of the people you are fighting. Without
    // this it stops being a rally point and becomes a teleporter: reinforcements
    // arrive faster than the counterplay (shoot the thing) can possibly resolve,
    // and the enemy never gets the beat in which to act on it.
    if (kind === 'beacon') {
      for (const s of this.game.allSoldiers) {
        if (!s.alive || s.team === team) continue;
        const dx = s.pos.x - x, dz = s.pos.z - z;
        if (dx * dx + dz * dz < B.enemyClear * B.enemyClear) {
          return { ok: false, why: 'ENEMY TOO CLOSE' };
        }
      }
    }

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
    const kind = kindOf(def);
    if (!kind) return null;
    const yaw = owner.yaw;
    const ahead = kind === 'beacon' ? B.placeAhead : C.placeAhead;
    const x = owner.pos.x + Math.sin(yaw) * ahead;
    const z = owner.pos.z + Math.cos(yaw) * ahead;

    const check = this.canPlaceAt(x, z, yaw, def, owner.team, owner.pos.y + 1);
    if (!check.ok) { this.lastRefusal = check.why; return null; }
    this.lastRefusal = null;

    const [len, height, thick] = footprintOf(def);
    const s = {
      def,
      kind,
      team: owner.team,
      owner,
      squad: kind === 'beacon' ? owner.squad || null : null,
      // A wall is on a clock and a beacon is not. Infinity rather than a null
      // or a flag, so `update` ticks one number for both kinds and the "does
      // this expire" question never becomes a branch that can be got wrong.
      life: kind === 'beacon' ? Infinity : C.life,
      // ...and the mirror of it: a wall cannot be shot down, a beacon is
      // nothing but. Same trick, so `damage` needs no kind test either.
      hp: kind === 'beacon' ? B.hp : Infinity,
      // ONLY a wall is a volume. A beacon with a cover box would be a bullet
      // shield you could hide a squad behind, and worse, one the enemy has to
      // destroy to shoot through — see the header.
      box: kind === 'wall' ? check.box : null,
      pos: new THREE.Vector3(x, check.base, z),
      mesh: kind === 'beacon'
        ? makeBeaconMesh(footprintOf(def), def.beacon.color)
        : makeWallMesh(len, height, thick, def.wall.color),
      pulse: 0,
    };
    s.mesh.position.copy(s.pos);
    // The mesh and the cover box share one angle — see the convention note on
    // makeCoverBox. If these ever disagree, rounds stop where nothing is drawn.
    s.mesh.rotation.y = yaw;

    // One rally per squad, and a second one REPLACES the first rather than
    // being refused. A leader planting a beacon is saying "we are here now",
    // and refusing that because of a beacon three sectors back would make the
    // ability useless exactly when the squad has advanced — which is the only
    // time anyone wants it. Done after the legality check, so a refused
    // placement never costs the squad the rally it already had.
    if (kind === 'beacon' && s.squad) {
      if (s.squad.beacon) this.remove(s.squad.beacon);
      s.squad.beacon = s;
    }

    this.game.scene.add(s.mesh);
    if (s.box) this.game.world.coverBoxes.push(s.box);
    if (kind === 'beacon') this.beacons.push(s);
    this.list.push(s);
    return s;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      s.life -= dt;
      if (s.life <= 0) { this.remove(s); continue; }
      if (s.kind === 'beacon') this._pulse(s, dt);
    }
  }

  // The climbing ring. Not decoration: this is the object a squadmate is
  // sprinting to find, and a 1.5 m post reads as terrain clutter without it.
  // Rises and widens as it fades, so the motion is upward and away — see the
  // note on makeBeaconMesh for why it does not lie on the ground.
  _pulse(s, dt) {
    s.pulse = (s.pulse + dt * 0.85) % 1;
    const ring = s.mesh && s.mesh.userData.ring;
    if (!ring) return;
    const p = s.pulse;
    ring.position.y = RING_Y0 + (RING_Y1 - RING_Y0) * p;
    const k = 0.8 + p * 0.7;
    ring.scale.set(k, k, 1);
    // Squared falloff: bright for most of the climb, gone by the top, so the
    // eye catches a rising mark rather than a permanently lit halo.
    ring.material.opacity = 0.85 * (1 - p * p);
  }

  // Incoming fire. Rounds and splash both land here; `hp === Infinity` is what
  // makes shooting a wall a no-op without the caller having to know what it hit.
  // Returns true when this was the killing hit, because a rally that vanishes
  // with nothing said is a squad wondering where their spawn went.
  damage(s, amount) {
    if (!s || !(s.hp < Infinity)) return false;
    s.hp -= amount;
    // The head dims as it takes damage, so "nearly dead" is readable across the
    // map to both sides — the enemy is owed the information too, since finding
    // and finishing one is their half of this system.
    const head = s.mesh && s.mesh.userData.head;
    if (head) head.material.emissiveIntensity = 0.35 + 1.25 * Math.max(0, s.hp / B.hp);
    if (s.hp > 0) return false;
    this.remove(s);
    return true;
  }

  remove(s) {
    const i = this.list.indexOf(s);
    if (i >= 0) this.list.splice(i, 1);
    const bi2 = this.beacons.indexOf(s);
    if (bi2 >= 0) this.beacons.splice(bi2, 1);
    // The squad's pointer is the spawn system's view of this object. Left
    // dangling it is a deploy option that lands people at a beacon that no
    // longer exists — the same class of bug as the stale cover box below.
    if (s.squad && s.squad.beacon === s) s.squad.beacon = null;

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
