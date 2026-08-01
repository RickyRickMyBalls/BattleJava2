// Hitscan resolution, projectiles, tracers, muzzle flashes, impacts, hit routing.

import * as THREE from 'three';
import { CFG } from './config.js';

const _from = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _pellet = new THREE.Vector3();
// Reused result record for traceHit — read it before the next call.
const _trace = { t: 0, hit: null, isHead: false, blockT: 1 };

const MAX_TRACERS = 140;
const MAX_ROCKETS = 12;
const MAX_BOOMS = 8;
const MAX_GRENADES = 24;
// Grenade gravity, heavier than real g so a throw arcs visibly instead of
// sailing. Worked out against the actual numbers rather than picked: a throw
// leaves the eye at 1.78 m and 18 m/s with the player's 0.24 loft, which is a
// 13.5 degree launch, so direct range before the first bounce is
//    9.8 -> 20.4 m | 12 -> 17.5 m | 15 -> 14.7 m | 18 -> 12.9 m
// 18 was the first guess here and it is too short to be worth a slot. 12 lands
// a level throw at ~17 m with roughly 2 s of fuse left to roll, and caps a
// deliberate 45-degree lob at 27 m.
const GRENADE_GRAV = 12;

export class Combat {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;

    // Pooled tracer lines (a single LineSegments with per-vertex color).
    // Two kinds share the pool: moving "bolts" (a short bright segment that
    // flies from muzzle to impact) and static fading lines (sniper vapor,
    // laser beams, rocket smoke).
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(MAX_TRACERS * 6);
    this.tracerCol = new Float32Array(MAX_TRACERS * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    this.tracers = [];
    for (let i = 0; i < MAX_TRACERS; i++) {
      this.tracers.push({
        active: false, mode: 0,               // 0 = static fade, 1 = bolt
        ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0,   // static endpoints
        dx: 0, dy: 0, dz: 0, dist: 0,               // bolt path (a* = origin)
        head: 0, len: 0, speed: 0,                  // bolt segment state
        life: 0, maxLife: 0, drift: 0,
        r: 1, g: 1, b: 1,
      });
    }
    this.tracerHead = 0;
    this._shotCount = new Map(); // per-weapon counter for tracer-every-Nth
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

    // Pooled grenades. Unlike rockets these do not detonate on contact — they
    // bounce, settle, and go off on their fuse, which is the whole reason you
    // can bank one around a corner.
    this.grenades = [];
    const fallbackGeo = new THREE.SphereGeometry(0.06, 6, 5);
    const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.8 });
    const fragModel = game.assets && game.assets.props && game.assets.props.frag;
    for (let i = 0; i < MAX_GRENADES; i++) {
      // The authored frag if it loaded, a dull olive pebble if it did not.
      const m = fragModel ? fragModel.clone(true) : new THREE.Mesh(fallbackGeo, fallbackMat);
      m.visible = false;
      this.scene.add(m);
      this.grenades.push({
        mesh: m, active: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        owner: null, def: null, fuse: 0, spin: new THREE.Vector3(),
      });
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
    // Aimed at the chest, scaled by the target's posture so a crouched soldier
    // is shot at where they actually are. Without the scale a bot keeps aiming
    // at a standing chest that is no longer there, and every round sails over a
    // wall the target is ducking behind — cover that only works by accident.
    _to.set(target.pos.x,
      target.pos.y + (target.isPlayer ? 1.5 : 1.25) * target.postureScale,
      target.pos.z);
    _dir.subVectors(_to, _from).normalize();
    this._firePellets(shooter, _from, _dir, def, spreadRad);
    this.game.audio.playShotAt(_from, def);
    this.game.hud.notePlayerAwareShot(shooter);
  }

  // ---- Player shot from the camera -------------------------------------
  firePlayerShot(from, dir, def, spreadRad, visualFrom) {
    this._firePellets(this.game.playerSoldier, from, dir, def, spreadRad, visualFrom || from);
  }

  _firePellets(shooter, from, dir, def, spreadRad, visualFrom = from) {
    const pellets = def.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      _pellet.copy(dir);
      applySpread(_pellet, spreadRad + (pellets > 1 ? def.pelletSpread : 0));
      this.resolveRay(shooter, from, _pellet, def, visualFrom);
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

  // ---- Grenades ---------------------------------------------------------
  throwGrenade(thrower, from, dir, def) {
    const g = this.grenades.find((x) => !x.active);
    if (!g) return null;
    g.active = true;
    g.pos.copy(from);
    g.vel.copy(dir).normalize().multiplyScalar(def.throwSpeed);
    g.owner = thrower;
    g.def = def;
    g.fuse = def.fuse;
    // Tumble. Purely cosmetic, but a grenade that flies without rotating reads
    // as a thrown rock.
    g.spin.set(6 + Math.random() * 6, 4 + Math.random() * 4, 3 + Math.random() * 5);
    g.mesh.visible = true;
    g.mesh.position.copy(from);
    return g;
  }

  _updateGrenades(dt) {
    const world = this.game.world;
    for (const g of this.grenades) {
      if (!g.active) continue;
      g.fuse -= dt;
      const ox = g.pos.x, oy = g.pos.y, oz = g.pos.z;
      g.vel.y -= GRENADE_GRAV * dt;
      g.pos.addScaledVector(g.vel, dt);

      // Walls and cover: no surface normal is available from the raycasts, so
      // the step is rejected and the horizontal velocity reversed and damped.
      // Crude, but at a grenade's size and speed it reads exactly like a bounce
      // and it can never tunnel through a wall into a room it should not reach.
      if (world.raycastCover(ox, oy, oz, g.pos.x, g.pos.y, g.pos.z) < 1
          || world.raycastTerrain(ox, oy, oz, g.pos.x, g.pos.y, g.pos.z) < 1) {
        g.pos.set(ox, oy, oz);
        g.vel.x *= -g.def.bounce;
        g.vel.z *= -g.def.bounce;
        g.vel.y *= 0.5;
      }

      // Ground. `groundAt` where there is collision geometry (so it settles on
      // tunnel floors and roofs, not the terrain underneath them), heightfield
      // otherwise.
      const col = world.collision;
      const gy = col ? col.groundAt(g.pos.x, g.pos.y + 0.5, g.pos.z) : null;
      const floor = gy !== null ? gy : world.heightAt(g.pos.x, g.pos.z);
      if (g.pos.y <= floor) {
        g.pos.y = floor;
        if (Math.abs(g.vel.y) > 1.2) {
          g.vel.y = -g.vel.y * g.def.bounce;   // bounce
          g.vel.x *= 0.75; g.vel.z *= 0.75;
        } else {
          g.vel.y = 0;                          // settled: roll to a stop
          g.vel.x *= 0.86; g.vel.z *= 0.86;
        }
      }
      world.clampToMap(g.pos);

      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        this._explode(g.pos, g.owner, g.def);
        continue;
      }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.spin.x * dt;
      g.mesh.rotation.y += g.spin.y * dt;
      g.mesh.rotation.z += g.spin.z * dt;
    }
  }

  _explode(pos, owner, def) {
    // Splash damage against the owner's enemies (and the player if hostile)
    const radius = def.splash;
    for (const s of this.game.allSoldiers) {
      if ((!s.alive && !s.downed) || s.team === owner.team) continue;
      if (s.isPlayer && this.game.spectating) continue;
      const dx = s.pos.x - pos.x, dy = (s.pos.y + (s.downed ? 0.3 : 1)) - pos.y, dz = s.pos.z - pos.z;
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
      this.spawnTracer(ox, oy, oz, r.pos.x, r.pos.y, r.pos.z, null, [1, 0.75, 0.4], 0.25, 0, 0.6);
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
  // `visualFrom` is where the shot is DRAWN from; `from`/`dir` stay the ray the
  // hit is resolved on. They differ for the player, whose aim comes off the
  // camera while the tracer has to leave the barrel — otherwise every shot
  // appears to come out of the middle of the screen. Defaults to `from`, which
  // is what AI want: they already fire from their own muzzle.
  // Nearest thing a ray meets — soldiers, cover, terrain — with no side effects.
  // Shared so that third-person aiming asks exactly the question the shot
  // resolver answers; a second copy of this would drift and the crosshair would
  // quietly stop agreeing with where rounds land. Returns a reused record, so
  // read it before calling again. Never pass a module scratch as `from`/`dir`:
  // `_tmp` is written in here.
  traceHit(shooter, from, dir, range) {
    const world = this.game.world;
    const ex = from.x + dir.x * range, ey = from.y + dir.y * range, ez = from.z + dir.z * range;

    const tCover = world.raycastCover(from.x, from.y, from.z, ex, ey, ez);
    const tTerrain = world.raycastTerrain(from.x, from.y, from.z, ex, ey, ez);
    const tBlock = Math.min(tCover, tTerrain, 1);

    let hit = null, hitT = tBlock, isHead = false;
    for (const s of this.game.allSoldiers) {
      if ((!s.alive && !s.downed) || s.team === shooter.team || s === shooter) continue;
      if (s.isPlayer && this.game.spectating) continue;
      const dx = s.pos.x - from.x, dz = s.pos.z - from.z;
      if (dx * dx + dz * dz > range * range) continue;

      // A casualty is a body on the ground, not a standing silhouette: one low
      // sphere instead of the three-part stack, and no head to find. Without
      // this, finishing someone means shooting the air above them.
      if (s.downed) {
        _tmp.set(s.pos.x, s.pos.y + 0.35, s.pos.z);
        const td = raySphere(from, dir, _tmp, 0.55, range);
        if (td >= 0 && td / range < hitT) { hit = s; hitT = td / range; isHead = false; }
        continue;
      }

      // The three-sphere stack, folded toward the ground when the soldier is
      // crouched. Only the OFFSETS scale — a crouched soldier is folded, not
      // thinner, so the radii stand and the spheres simply overlap more. This
      // is the half of the posture rule that stops a wall lying: without it a
      // player ducked fully behind 1.4 m of cover still owns a head sphere at
      // 1.7 m, floating above the wall for any round crossing that space.
      const ps = s.postureScale;
      _tmp.set(s.pos.x, s.pos.y + (s.isPlayer ? 1.7 : 1.75) * ps, s.pos.z);
      let t = raySphere(from, dir, _tmp, 0.26, range);
      if (t >= 0 && t / range < hitT) { hit = s; hitT = t / range; isHead = true; continue; }
      _tmp.set(s.pos.x, s.pos.y + 1.15 * ps, s.pos.z);
      t = raySphere(from, dir, _tmp, 0.42, range);
      if (t >= 0 && t / range < hitT) { hit = s; hitT = t / range; isHead = false; continue; }
      _tmp.set(s.pos.x, s.pos.y + 0.55 * ps, s.pos.z);
      t = raySphere(from, dir, _tmp, 0.4, range);
      if (t >= 0 && t / range < hitT) { hit = s; hitT = t / range; isHead = false; }
    }

    _trace.t = hit ? hitT : tBlock;
    _trace.hit = hit;
    _trace.isHead = isHead;
    _trace.blockT = tBlock;
    return _trace;
  }

  // Point the crosshair is actually over. Third person fires from the barrel,
  // which sits off to one side of the camera, so the round has to be aimed at
  // this rather than simply sent along the camera's forward.
  aimPoint(shooter, from, dir, range, out) {
    const t = this.traceHit(shooter, from, dir, range).t;
    return out.set(from.x + dir.x * range * t, from.y + dir.y * range * t, from.z + dir.z * range * t);
  }

  resolveRay(shooter, from, dir, def, visualFrom = from) {
    const range = def.range;
    const tr = this.traceHit(shooter, from, dir, range);
    const hit = tr.hit, isHead = tr.isHead;

    const endT = tr.t;
    const endX = from.x + dir.x * range * endT;
    const endY = from.y + dir.y * range * endT;
    const endZ = from.z + dir.z * range * endT;

    const trc = def.tracer || {};
    const style = trc.style || (trc.thick ? 'beam' : 'bolt');
    const alpha = trc.opacity ?? 1;
    const vx = visualFrom.x, vy = visualFrom.y, vz = visualFrom.z;
    if (style === 'beam') {
      // laser: three slightly offset full-length lines, fading out
      for (let i = -1; i <= 1; i++) {
        this.spawnTracer(vx + i * 0.03, vy + i * 0.03, vz, endX, endY, endZ, shooter.team, trc.color, trc.life, 0, alpha);
      }
    } else if (style === 'vapor') {
      // sniper: instant full-length trail that lingers, rises and fades
      this.spawnTracer(vx, vy, vz, endX, endY, endZ, shooter.team, trc.color, trc.life || 0.85, trc.drift ?? 0.35, alpha);
    } else {
      // ballistic bolt; `every` spawns a tracer only on every Nth shot
      const every = trc.every || 1;
      const n = (this._shotCount.get(def.key) || 0) + 1;
      this._shotCount.set(def.key, n);
      if (n % every === 0) {
        // Aim from the muzzle to the impact point rather than reusing `dir`:
        // when the two origins differ the bolt has to converge on the hit, or
        // it flies visibly parallel to where the round actually landed.
        const bx = endX - vx, by = endY - vy, bz = endZ - vz;
        const blen = Math.hypot(bx, by, bz) || 1;
        this.spawnBolt(vx, vy, vz, bx / blen, by / blen, bz / blen, blen,
          shooter.team, trc.color, trc.len || 4, trc.speed || 420, alpha);
      }
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

  _tracerSlot() {
    const t = this.tracers[this.tracerHead];
    this.tracerHead = (this.tracerHead + 1) % MAX_TRACERS;
    return t;
  }

  // Static line that fades out over its life (rocket smoke, sniper vapor,
  // laser beams). drift > 0 makes the whole line rise like smoke.
  spawnTracer(ax, ay, az, bx, by, bz, team, color, life, drift = 0, opacity = 1) {
    const t = this._tracerSlot();
    t.active = true; t.mode = 0;
    t.ax = ax; t.ay = ay; t.az = az;
    t.bx = bx; t.by = by; t.bz = bz;
    t.life = t.maxLife = life || 0.09;
    t.drift = drift;
    // additive blending: opacity bakes into the color intensity
    const col = color || (team === 0 ? [0.55, 0.8, 1] : [1, 0.6, 0.4]);
    t.r = col[0] * opacity; t.g = col[1] * opacity; t.b = col[2] * opacity;
  }

  // Short bright segment that travels from the muzzle to the impact point.
  spawnBolt(fx, fy, fz, dx, dy, dz, dist, team, color, len, speed, opacity = 1) {
    const t = this._tracerSlot();
    t.active = true; t.mode = 1;
    t.ax = fx; t.ay = fy; t.az = fz;
    t.dx = dx; t.dy = dy; t.dz = dz;
    t.dist = dist; t.head = 0;
    t.len = len; t.speed = speed;
    const col = color || (team === 0 ? [0.55, 0.8, 1] : [1, 0.6, 0.4]);
    t.r = col[0] * opacity; t.g = col[1] * opacity; t.b = col[2] * opacity;
  }

  _clearTracer(o) {
    const p = this.tracerPos;
    p[o + 3] = p[o]; p[o + 4] = p[o + 1]; p[o + 5] = p[o + 2]; // degenerate
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
    this._updateGrenades(dt);

    let dirty = false;
    const p = this.tracerPos, c = this.tracerCol;
    for (let i = 0; i < MAX_TRACERS; i++) {
      const t = this.tracers[i];
      if (!t.active) continue;
      dirty = true;
      const o = i * 6;
      if (t.mode === 1) {
        // bolt: head flies forward, tail trails by len, dies at impact
        t.head += t.speed * dt;
        const tail = Math.max(0, t.head - t.len);
        if (tail >= t.dist) { t.active = false; this._clearTracer(o); continue; }
        const head = Math.min(t.head, t.dist);
        p[o] = t.ax + t.dx * tail; p[o + 1] = t.ay + t.dy * tail; p[o + 2] = t.az + t.dz * tail;
        p[o + 3] = t.ax + t.dx * head; p[o + 4] = t.ay + t.dy * head; p[o + 5] = t.az + t.dz * head;
        // dim tail -> bright head reads as motion
        c[o] = t.r * 0.25; c[o + 1] = t.g * 0.25; c[o + 2] = t.b * 0.25;
        c[o + 3] = t.r; c[o + 4] = t.g; c[o + 5] = t.b;
      } else {
        t.life -= dt;
        if (t.life <= 0) { t.active = false; this._clearTracer(o); continue; }
        if (t.drift) { t.ay += t.drift * dt; t.by += t.drift * dt; }
        const f = t.life / t.maxLife;
        p[o] = t.ax; p[o + 1] = t.ay; p[o + 2] = t.az;
        p[o + 3] = t.bx; p[o + 4] = t.by; p[o + 5] = t.bz;
        c[o] = t.r * f; c[o + 1] = t.g * f; c[o + 2] = t.b * f;
        c[o + 3] = t.r * f; c[o + 4] = t.g * f; c[o + 5] = t.b * f;
      }
    }
    if (dirty) {
      this.tracerGeo.attributes.position.needsUpdate = true;
      this.tracerGeo.attributes.color.needsUpdate = true;
    }

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
