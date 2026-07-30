// Hitscan resolution, projectiles, tracers, muzzle flashes, impacts, hit routing.

import * as THREE from 'three';
import { CFG } from './config.js';

const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _pellet = new THREE.Vector3();

const MAX_TRACERS = 90;
const MAX_ROCKETS = 12;
const MAX_BOOMS = 8;

export class Combat {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;

    // Pooled tracer lines (a single LineSegments with per-vertex color)
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(MAX_TRACERS * 6);
    this.tracerCol = new Float32Array(MAX_TRACERS * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    this.tracerLife = new Float32Array(MAX_TRACERS);
    this.tracerHead = 0;
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tracerMesh = new THREE.LineSegments(this.tracerGeo, mat);
    this.tracerMesh.frustumCulled = false;
    this.scene.add(this.tracerMesh);

    // Pooled impact sparks
    this.sparks = [];
    const sparkGeo = new THREE.SphereGeometry(0.07, 4, 3);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(sparkGeo, sparkMat);
      m.visible = false;
      this.scene.add(m);
      this.sparks.push({ mesh: m, life: 0 });
    }
    this.sparkHead = 0;

    // Pooled rockets
    this.rockets = [];
    const rocketGeo = new THREE.SphereGeometry(0.14, 6, 4);
    const rocketMat = new THREE.MeshBasicMaterial({ color: 0xffe0a8 });
    for (let i = 0; i < MAX_ROCKETS; i++) {
      const m = new THREE.Mesh(rocketGeo, rocketMat);
      m.visible = false;
      this.scene.add(m);
      this.rockets.push({ mesh: m, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), owner: null, def: null, life: 0 });
    }

    // Pooled explosion flashes
    this.booms = [];
    const boomGeo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < MAX_BOOMS; i++) {
      const bm = new THREE.MeshBasicMaterial({ color: 0xffb050, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(boomGeo, bm);
      m.visible = false;
      this.scene.add(m);
      this.booms.push({ mesh: m, life: 0 });
    }
    this.boomHead = 0;
  }

  // ---- AI shot at a soldier target -------------------------------------
  fireShot(shooter, target, def, spreadRad) {
    shooter.muzzlePos(_from);
    _to.set(target.pos.x, target.pos.y + (target.isPlayer ? 1.5 : 1.25), target.pos.z);
    _dir.subVectors(_to, _from).normalize();
    this._firePellets(shooter, _from, _dir, def, spreadRad);
    this.game.audio.playShotAt(_from, def);
    this.game.hud.notePlayerAwareShot(shooter);
  }

  // ---- Player shot from the camera -------------------------------------
  firePlayerShot(from, dir, def, spreadRad) {
    this._firePellets(this.game.playerSoldier, from, dir, def, spreadRad);
  }

  _firePellets(shooter, from, dir, def, spreadRad) {
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      _pellet.copy(dir);
      applySpread(_pellet, spreadRad + (pellets > 1 ? def.pelletSpread : 0));
      this.resolveRay(shooter, from, _pellet, def);
    }
  }

  // ---- Rockets ----------------------------------------------------------
  fireRocket(shooter, from, dir, def) {
    const r = this.rockets.find((x) => !x.active);
    if (!r) return;
    r.active = true;
    r.pos.copy(from);
    r.vel.copy(dir).normalize().multiplyScalar(def.projSpeed);
    r.owner = shooter;
    r.def = def;
    r.life = 8;
    r.mesh.visible = true;
    r.mesh.position.copy(from);
    if (shooter.isPlayer) this.game.audio.playShot(def);
    else this.game.audio.playShotAt(from, def);
    this.game.hud.notePlayerAwareShot(shooter);
  }

  _explode(pos, owner, def) {
    // Splash damage against the owner's enemies (and the player if hostile)
    const radius = def.splash;
    for (const s of this.game.allSoldiers) {
      if (!s.alive || s.team === owner.team) continue;
      if (s.isPlayer && this.game.spectating) continue;
      const dx = s.pos.x - pos.x, dy = (s.pos.y + 1) - pos.y, dz = s.pos.z - pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > radius + 0.5) continue;
      const frac = Math.max(0, 1 - d / (radius + 0.5));
      const dmg = def.dmg * Math.pow(frac, 1.4) * (owner.isPlayer ? 1 : CFG.ai.damageScale);
      const killed = s.takeDamage(dmg, owner, false);
      if (owner.isPlayer) this.game.hud.showHitmarker(killed);
      if (s.isPlayer) this.game.onPlayerDamaged(owner);
    }
    const b = this.booms[this.boomHead];
    this.boomHead = (this.boomHead + 1) % MAX_BOOMS;
    b.mesh.position.copy(pos);
    b.mesh.visible = true;
    b.life = 0.35;
    this.game.audio.playExplosionAt(pos);
  }

  _updateRockets(dt) {
    const world = this.game.world;
    for (const r of this.rockets) {
      if (!r.active) continue;
      r.life -= dt;
      const ox = r.pos.x, oy = r.pos.y, oz = r.pos.z;
      r.vel.y -= 3.5 * dt; // slight drop
      r.pos.addScaledVector(r.vel, dt);
      let hit = r.life <= 0;
      // terrain / cover along this step
      if (!hit && world.raycastTerrain(ox, oy, oz, r.pos.x, r.pos.y, r.pos.z) < 1) hit = true;
      if (!hit && world.raycastCover(ox, oy, oz, r.pos.x, r.pos.y, r.pos.z) < 1) hit = true;
      // direct soldier hit
      if (!hit) {
        for (const s of this.game.allSoldiers) {
          if (!s.alive || s.team === r.owner.team) continue;
          if (s.isPlayer && this.game.spectating) continue;
          _tmp.set(s.pos.x - r.pos.x, s.pos.y + 1 - r.pos.y, s.pos.z - r.pos.z);
          if (_tmp.lengthSq() < 1.2) { hit = true; break; }
        }
      }
      // smoke-ish trail
      this.spawnTracer(ox, oy, oz, r.pos.x, r.pos.y, r.pos.z, null, [1, 0.75, 0.4], 0.25);
      if (hit) {
        r.active = false;
        r.mesh.visible = false;
        this._explode(r.pos, r.owner, r.def);
      } else {
        r.mesh.position.copy(r.pos);
      }
    }
  }

  // ---- Shared hitscan: soldiers vs cover vs terrain, nearest wins -------
  resolveRay(shooter, from, dir, def) {
    const world = this.game.world;
    const range = def.range;
    const ex = from.x + dir.x * range, ey = from.y + dir.y * range, ez = from.z + dir.z * range;

    const tCover = world.raycastCover(from.x, from.y, from.z, ex, ey, ez);
    const tTerrain = world.raycastTerrain(from.x, from.y, from.z, ex, ey, ez);
    const tBlock = Math.min(tCover, tTerrain, 1);

    let hit = null, hitT = tBlock, isHead = false;
    for (const s of this.game.allSoldiers) {
      if (!s.alive || s.team === shooter.team || s === shooter) continue;
      if (s.isPlayer && this.game.spectating) continue;
      const dx = s.pos.x - from.x, dz = s.pos.z - from.z;
      if (dx * dx + dz * dz > range * range) continue;

      _tmp.set(s.pos.x, s.pos.y + (s.isPlayer ? 1.7 : 1.75), s.pos.z);
      let t = raySphere(from, dir, _tmp, 0.26, range);
      if (t >= 0 && t / range < hitT) { hit = s; hitT = t / range; isHead = true; continue; }
      _tmp.set(s.pos.x, s.pos.y + 1.15, s.pos.z);
      t = raySphere(from, dir, _tmp, 0.42, range);
      if (t >= 0 && t / range < hitT) { hit = s; hitT = t / range; isHead = false; continue; }
      _tmp.set(s.pos.x, s.pos.y + 0.55, s.pos.z);
      t = raySphere(from, dir, _tmp, 0.4, range);
      if (t >= 0 && t / range < hitT) { hit = s; hitT = t / range; isHead = false; }
    }

    const endT = hit ? hitT : tBlock;
    const endX = from.x + dir.x * range * endT;
    const endY = from.y + dir.y * range * endT;
    const endZ = from.z + dir.z * range * endT;

    const trc = def.tracer;
    if (trc && trc.thick) {
      // beam: three slightly offset lines
      for (let i = -1; i <= 1; i++) {
        this.spawnTracer(from.x + i * 0.03, from.y + i * 0.03, from.z, endX, endY, endZ, shooter.team, trc.color, trc.life);
      }
    } else {
      this.spawnTracer(from.x, from.y, from.z, endX, endY, endZ, shooter.team, trc && trc.color, trc && trc.life);
    }

    if (hit) {
      const dist = range * endT;
      let damage = falloff(def, dist);
      if (!shooter.isPlayer) damage *= CFG.ai.damageScale;
      const killed = hit.takeDamage(damage, shooter, isHead);
      if (shooter.isPlayer) this.game.hud.showHitmarker(killed);
      if (hit.isPlayer) this.game.onPlayerDamaged(shooter);
    } else if (endT < 1) {
      this.spawnSpark(endX, endY, endZ);
    }
  }

  spawnTracer(ax, ay, az, bx, by, bz, team, color, life) {
    const i = this.tracerHead;
    this.tracerHead = (this.tracerHead + 1) % MAX_TRACERS;
    const p = this.tracerPos, c = this.tracerCol;
    p[i * 6] = ax; p[i * 6 + 1] = ay; p[i * 6 + 2] = az;
    p[i * 6 + 3] = bx; p[i * 6 + 4] = by; p[i * 6 + 5] = bz;
    const col = color || (team === 0 ? [0.55, 0.8, 1] : [1, 0.6, 0.4]);
    c[i * 6] = col[0]; c[i * 6 + 1] = col[1]; c[i * 6 + 2] = col[2];
    c[i * 6 + 3] = col[0]; c[i * 6 + 4] = col[1]; c[i * 6 + 5] = col[2];
    this.tracerLife[i] = life || 0.09;
    this.tracerGeo.attributes.position.needsUpdate = true;
    this.tracerGeo.attributes.color.needsUpdate = true;
  }

  spawnSpark(x, y, z) {
    const s = this.sparks[this.sparkHead];
    this.sparkHead = (this.sparkHead + 1) % this.sparks.length;
    s.mesh.position.set(x, y, z);
    s.mesh.visible = true;
    s.life = 0.12;
  }

  update(dt) {
    this._updateRockets(dt);

    let dirty = false;
    for (let i = 0; i < MAX_TRACERS; i++) {
      if (this.tracerLife[i] > 0) {
        this.tracerLife[i] -= dt;
        if (this.tracerLife[i] <= 0) {
          this.tracerPos[i * 6 + 3] = this.tracerPos[i * 6];
          this.tracerPos[i * 6 + 4] = this.tracerPos[i * 6 + 1];
          this.tracerPos[i * 6 + 5] = this.tracerPos[i * 6 + 2];
          dirty = true;
        }
      }
    }
    if (dirty) this.tracerGeo.attributes.position.needsUpdate = true;

    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        if (s.life <= 0) s.mesh.visible = false;
      }
    }
    for (const b of this.booms) {
      if (b.life > 0) {
        b.life -= dt;
        const t = 1 - b.life / 0.35;
        b.mesh.scale.setScalar(0.5 + t * 5.5);
        b.mesh.material.opacity = 0.9 * (1 - t);
        if (b.life <= 0) b.mesh.visible = false;
      }
    }
  }
}

function applySpread(dir, spread) {
  dir.x += (Math.random() - 0.5) * 2 * spread;
  dir.y += (Math.random() - 0.5) * 2 * spread;
  dir.z += (Math.random() - 0.5) * 2 * spread;
  dir.normalize();
}

function falloff(def, dist) {
  const [start, end, farFrac] = def.falloff;
  if (dist <= start) return def.dmg;
  if (dist >= end) return def.dmg * farFrac;
  const t = (dist - start) / (end - start);
  return def.dmg * (1 - t * (1 - farFrac));
}

// Ray-sphere: returns distance along ray or -1.
function raySphere(origin, dir, center, radius, maxDist) {
  const ox = center.x - origin.x, oy = center.y - origin.y, oz = center.z - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0 || tca > maxDist) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}
