// Soldier entity: shared by all AI (and the player's server-side body).
// Handles vitals, movement, animation state, and burst firing.

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { CFG, TEAM, WEAPONS, CLASSES } from './config.js';
import { terrainHeight } from './world.js';

const S = CFG.soldier;
const AI = CFG.ai;
const _v = new THREE.Vector3();

// Held-weapon grip transform relative to the right-hand bone (meters / radians).
// Tuned visually against the Mixamo rigs used by all three character models.
// After the -90° X rotation the barrel runs along holder +Y (forward).
export const GRIP = { pos: [0.08, 0.12, 0.02], rot: [-Math.PI / 2, 0, 0] };

// Create a scale-compensated mount on a character's right-hand bone.
// Shared by AI soldiers and the lobby character preview.
export function makeWeaponMount(mesh) {
  let handBone = null;
  mesh.traverse((o) => {
    if (!handBone && o.isBone &&
        o.name.replace(/^.*?mixamorig[:_]?/i, '').replace(/[:_\s]/g, '').toLowerCase() === 'righthand') {
      handBone = o;
    }
  });
  if (!handBone) return null;
  mesh.updateMatrixWorld(true);
  const ws = new THREE.Vector3();
  handBone.getWorldScale(ws);
  const holder = new THREE.Group();
  holder.scale.setScalar(1 / (ws.x || 1));
  handBone.add(holder);
  return holder;
}

export function setHeldWeapon(holder, key, weaponModels) {
  while (holder.children.length) holder.remove(holder.children[0]);
  const src = weaponModels[key];
  if (!src) return;
  const def = WEAPONS[key];
  const gun = src.clone(true);
  const pos = (def.grip && def.grip.pos) || GRIP.pos;
  const rot = (def.grip && def.grip.rot) || GRIP.rot;
  gun.position.set(pos[0], pos[1], pos[2]);
  gun.rotation.set(rot[0], rot[1], rot[2]);
  holder.add(gun);
}

let nextId = 1;

export class Soldier {
  constructor(game, team, squad, name, character, cls = 'assault', primary = 'ar', secondary = 'smg') {
    this.id = nextId++;
    this.game = game;
    this.team = team;
    this.squad = squad;
    this.name = name;
    this.isPlayer = false;
    this.setLoadout(cls, primary, secondary);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.alive = true;
    this.shield = this.maxShield;
    this.health = S.health;
    this.shieldTimer = 0;
    this.deadTimer = 0;
    this.removeBodyTimer = 0;

    this.waypoint = new THREE.Vector3();
    this.hasWaypoint = false;
    this.formationOffset = new THREE.Vector3();

    this.target = null;         // enemy Soldier
    this.thinkTimer = Math.random() * AI.thinkInterval;
    this.burstLeft = 0;
    this.fireTimer = Math.random();
    this.rocketCooldown = 3 + Math.random() * 6;
    this.stuckTimer = 0;

    this.kills = 0;
    this.deaths = 0;

    // Visuals
    if (character) this.setCharacter(character);
    this.animAccum = 0;
  }

  setLoadout(cls, primary, secondary) {
    this.cls = cls;
    this.primary = WEAPONS[primary];
    this.secondary = WEAPONS[secondary];
    this.activeWeapon = this.primary;
    this.maxShield = (CLASSES[cls] && CLASSES[cls].shield) || S.shield;
    // targeting reach = the longest gun carried (capped so recon isn't omniscient)
    this.engageRange = Math.min(320, Math.max(this.primary.ai.range, this.secondary.ai.range));
    this.maxRange = Math.max(this.primary.ai.range, this.secondary.ai.range);
  }

  // Swap the character mesh (e.g., player switching between marine and spartan classes).
  setCharacter(character) {
    if (this.character === character) return;
    if (this.mesh) this.game.scene.remove(this.mesh);
    this.character = character;
    this.mesh = cloneSkeleton(character.template);
    this.mixer = new THREE.AnimationMixer(this.mesh);
    this.actions = {};
    for (const [key, clip] of Object.entries(character.clips)) {
      this.actions[key] = this.mixer.clipAction(clip);
    }
    this.currentAnim = null;
    this.playAnim('idle', 0);
    this.mesh.position.copy(this.pos);
    this.mesh.visible = !this.isPlayer;
    this.game.scene.add(this.mesh);
    this._initWeaponMount();
  }

  // Mount point on the right hand for the held weapon.
  _initWeaponMount() {
    this.weaponHolder = makeWeaponMount(this.mesh);
    this.heldKey = null;
    if (this.weaponHolder && this.activeWeapon) this._setHeldWeapon(this.activeWeapon.key);
  }

  _setHeldWeapon(key) {
    if (!this.weaponHolder || this.heldKey === key) return;
    this.heldKey = key;
    setHeldWeapon(this.weaponHolder, key, this.game.assets.weaponModels);
  }

  playAnim(key, fade = 0.18) {
    if (!this.actions || this.currentAnim === key) return;
    const next = this.actions[key];
    if (!next) return;
    const prev = this.actions[this.currentAnim];
    next.reset();
    if (key.startsWith('death')) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    next.fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.currentAnim = key;
  }

  spawnAt(x, z) {
    this.pos.set(x, terrainHeight(x, z), z);
    this.vel.set(0, 0, 0);
    this.alive = true;
    this.shield = this.maxShield;
    this.health = S.health;
    this.target = null;
    this.burstLeft = 0;
    if (this.mesh) {
      this.mesh.visible = !this.isPlayer;
      this.playAnim('idle', 0);
    }
  }

  eyePos(out) {
    return out.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
  }
  muzzlePos(out) {
    out.set(this.pos.x + Math.sin(this.yaw) * 0.5, this.pos.y + 1.42, this.pos.z + Math.cos(this.yaw) * 0.5);
    return out;
  }

  takeDamage(amount, attacker, isHead) {
    if (!this.alive) return false;
    if (this.isPlayer && this.game.spectating) return false;
    this.shieldTimer = 0;
    let dmg = amount * (isHead ? CFG.headshotMult : 1);
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, dmg);
      this.shield -= absorbed;
      dmg -= absorbed;
    }
    if (dmg > 0) this.health -= dmg;
    // Getting shot makes AI aware of the attacker
    if (!this.target && attacker && attacker.alive && attacker.team !== this.team) {
      this.target = attacker;
    }
    if (this.health <= 0) {
      this.die(attacker);
      return true;
    }
    return false;
  }

  die(attacker) {
    this.alive = false;
    this.deaths++;
    this.deadTimer = 0;
    this.removeBodyTimer = 0;
    this.target = null;
    if (attacker) attacker.kills++;
    this.playAnim(Math.random() < 0.5 ? 'death1' : 'death2', 0.08);
    this.game.onKill(attacker, this);
  }

  // ---- Per-frame update (AI only; the player overrides movement) --------
  update(dt) {
    if (!this.alive) {
      this.deadTimer += dt;
      this.removeBodyTimer += dt;
      if (this.mesh && this.removeBodyTimer > 15) this.mesh.visible = false;
      this._updateAnim(dt);
      return;
    }

    // Shield regen
    this.shieldTimer += dt;
    if (this.shieldTimer > S.shieldRegenDelay && this.shield < this.maxShield) {
      this.shield = Math.min(this.maxShield, this.shield + S.shieldRegenRate * dt);
    }

    if (!this.isPlayer) {
      this._think(dt);
      this._move(dt);
      this._fire(dt);
    }
    this._updateAnim(dt);
  }

  _think(dt) {
    this.thinkTimer -= dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = AI.thinkInterval * (0.8 + Math.random() * 0.4);

    // Validate current target
    if (this.target && this.target.isPlayer && this.game.spectating) this.target = null;
    if (this.target && (!this.target.alive || this.pos.distanceTo(this.target.pos) > this.engageRange * 1.25)) {
      this.target = null;
    }
    if (this.target && !this._canSee(this.target)) {
      // lost sight — keep briefly then drop
      if (Math.random() < 0.4) this.target = null;
    }
    if (!this.target) {
      this.target = this._acquireTarget();
    }
  }

  _acquireTarget() {
    const enemies = this.game.teams[this.team === TEAM.BLUE ? TEAM.RED : TEAM.BLUE].soldiers;
    let best = null, bestD = this.engageRange;
    for (const e of enemies) {
      if (!e.alive || (e.isPlayer && this.game.spectating)) continue;
      const d = this.pos.distanceTo(e.pos);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best && this._canSee(best)) return best;
    // try up to 2 more nearby candidates
    let tries = 0;
    for (const e of enemies) {
      if (!e.alive || e === best || (e.isPlayer && this.game.spectating)) continue;
      const d = this.pos.distanceTo(e.pos);
      if (d < this.engageRange && this._canSee(e)) return e;
      if (++tries >= 3) break;
    }
    return null;
  }

  _canSee(enemy) {
    const a = this.eyePos(_v).clone();
    return this.game.world.hasLOS(a.x, a.y, a.z, enemy.pos.x, enemy.pos.y + 1.3, enemy.pos.z);
  }

  _move(dt) {
    const engaging = !!this.target;
    let desired = _v.set(0, 0, 0);

    if (engaging) {
      const d = this.pos.distanceTo(this.target.pos);
      // close the gap until inside a comfortable band for the carried guns;
      // recon's long reach means they naturally hold back
      if (d > this.engageRange * 0.55) {
        desired.subVectors(this.target.pos, this.pos).normalize().multiplyScalar(S.walkSpeed);
      }
      // face target
      const ty = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      this.yaw = lerpAngle(this.yaw, ty, Math.min(1, dt * 10));
    } else if (this.hasWaypoint) {
      const wp = _v.copy(this.waypoint).add(this.formationOffset);
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 2.5) {
        desired.set(dx / dist, 0, dz / dist).multiplyScalar(S.runSpeed);
        this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), Math.min(1, dt * 6));
      }
    }

    // Separation from squadmates
    for (const mate of this.squad.members) {
      if (mate === this || !mate.alive) continue;
      const dx = this.pos.x - mate.pos.x, dz = this.pos.z - mate.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 6.25 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        desired.x += (dx / d) * (2.5 - d) * 1.6;
        desired.z += (dz / d) * (2.5 - d) * 1.6;
      }
    }

    this.speed2D = desired.length();
    this.pos.x += desired.x * dt;
    this.pos.z += desired.z * dt;
    this.game.world.collideCircle(this.pos, 0.6);
    const col = this.game.world.collision;
    if (col) col.pushOut(this.pos, 0.5);
    this.game.world.clampToMap(this.pos);
    const g = col ? col.groundAt(this.pos.x, this.pos.y, this.pos.z) : null;
    this.pos.y = g !== null ? g : terrainHeight(this.pos.x, this.pos.z);
  }

  _fire(dt) {
    this.fireTimer -= dt;
    this.rocketCooldown -= dt;
    if (!this.target || !this.target.alive) return;
    const dist = this.pos.distanceTo(this.target.pos);
    if (dist > this.maxRange) return;
    if (this.fireTimer > 0) return;

    if (this.burstLeft <= 0) {
      // start a new burst only with LOS
      if (!this._canSee(this.target)) {
        this.fireTimer = 0.4;
        return;
      }
      // Engineer: rocket a clustered group on cooldown
      if (this.secondary.mode === 'projectile' && this.rocketCooldown <= 0
          && dist >= this.secondary.ai.aiMin && dist <= this.secondary.ai.range
          && this._clusterSize(this.target) >= 2) {
        const def = this.secondary;
        this.muzzlePos(_v);
        const aim = this.target.pos;
        const dx = aim.x - _v.x, dy = (aim.y + 0.8) - _v.y, dz = aim.z - _v.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        this.game.combat.fireRocket(this, _v.clone(), new THREE.Vector3(dx / len, dy / len, dz / len), def);
        this.rocketCooldown = def.ai.cooldown;
        this.fireTimer = def.ai.pause[0] + Math.random() * (def.ai.pause[1] - def.ai.pause[0]);
        return;
      }
      this.activeWeapon = this._chooseWeapon(dist);
      if (!this.activeWeapon) { this.fireTimer = 0.5; return; }
      const b = this.activeWeapon.ai.burst;
      this.burstLeft = b[0] + Math.floor(Math.random() * (b[1] - b[0] + 1));
    }

    const def = this.activeWeapon;
    this.burstLeft--;
    this.fireTimer = this.burstLeft > 0
      ? def.ai.interval
      : def.ai.pause[0] + Math.random() * (def.ai.pause[1] - def.ai.pause[0]);

    // def.ai.spread is angular — it already models precision at range.
    // Penalties only for the shooter moving or the target sprinting.
    let spread = def.ai.spread + (this.speed2D > 0.5 ? 0.012 : 0);
    if (this.target.speed2D > 4) spread *= 1.6;
    this.game.combat.fireShot(this, this.target, def, spread);
  }

  // Prefer the class secondary when the target sits in its band, else primary.
  _chooseWeapon(d) {
    const p = this.primary, s = this.secondary;
    const secOk = s.mode !== 'projectile' && d >= s.ai.aiMin && d <= s.ai.range;
    const priOk = d >= p.ai.aiMin && d <= p.ai.range;
    if (secOk) return s;
    if (priOk) return p;
    if (s.mode !== 'projectile' && d <= s.ai.range) return s;
    return null;
  }

  // How many enemies stand within 7m of this one (rocket-worthiness).
  _clusterSize(enemy) {
    let n = 0;
    for (const e of this.game.teams[enemy.team].soldiers) {
      if (!e.alive) continue;
      if (Math.hypot(e.pos.x - enemy.pos.x, e.pos.z - enemy.pos.z) < 7) n++;
    }
    return n;
  }

  _updateAnim(dt) {
    if (!this.mixer) return;
    // Distance-based animation throttling
    this.animAccum += dt;
    const cam = this.game.camera;
    const d = cam ? this.pos.distanceTo(cam.position) : 0;
    let interval = 0;
    if (d > 220) interval = 0.2;
    else if (d > 120) interval = 0.1;
    else if (d > 60) interval = 1 / 30;
    if (this.animAccum < interval) return;
    const step = this.animAccum;
    this.animAccum = 0;

    if (this.alive && !this.isPlayer) {
      if (this.target) this.playAnim('aim');
      else if (this.speed2D > 4) this.playAnim('run');
      else if (this.speed2D > 0.4) this.playAnim('walk');
      else this.playAnim('idle');
    }
    if (this.activeWeapon && this.heldKey !== this.activeWeapon.key) {
      this._setHeldWeapon(this.activeWeapon.key);
    }

    this.mixer.update(step);
    if (this.mesh) {
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.yaw;
    }
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
