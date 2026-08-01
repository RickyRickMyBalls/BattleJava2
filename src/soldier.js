// Soldier entity: shared by all AI (and the player's server-side body).
// Handles vitals, movement, animation state, and burst firing.

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { CFG, TEAM, WEAPONS, GRENADES, GADGETS, BIOFOAM } from './config.js';
import { classPerk } from './loadout.js';
import { restoreBakedDisplays } from './drivenmaterial.js';

const S = CFG.soldier;
const AI = CFG.ai;
const D = CFG.downed;
const ST = CFG.stamina;
const _v = new THREE.Vector3();
// Second scratch, for a throw direction. Safe to pass into throwGrenade because
// that only ever READS the direction (it copies it into the pooled grenade's
// velocity) — see the all-bullets-miss note in combat.js for why that matters.
const _v2 = new THREE.Vector3();

// Held-weapon grip transform relative to the right-hand bone (meters / radians).
// Tuned visually against the Mixamo rigs used by all three character models.
// After the -90° X rotation the barrel runs along holder +Y (forward).
export const GRIP = { pos: [0.08, 0.12, 0.02], rot: [-Math.PI / 2, 0, 0] };

// Stowed-weapon transform relative to the upper-spine bone: diagonal across
// the back, muzzle up over the left shoulder. Bone-local values, tunable per
// character rig in the /chartest.html test environment.
export const BACK = {
  marine: { pos: [-0.12, 0.15, -0.28], rot: [-1.6, 0.4, -1.13] },
  // Seeded from marine (same rig); retune on the range if the silhouette differs.
  marine2: { pos: [-0.12, 0.15, -0.28], rot: [-1.6, 0.4, -1.13] },
  marine3: { pos: [-0.12, 0.15, -0.28], rot: [-1.6, 0.4, -1.13] },
  spartan: { pos: [-0.01, 0.05, -0.27], rot: [-1.7, 0.4, -1.4] },
  elite: { pos: [-0.06, 0.07, -0.41], rot: [-1.95, 0.4, -1.1] },
};

// Create a scale-compensated mount on a named bone (canonical Mixamo name).
function makeBoneMount(mesh, boneName) {
  let bone = null;
  mesh.traverse((o) => {
    if (!bone && o.isBone &&
        o.name.replace(/^.*?mixamorig[:_]?/i, '').replace(/[:_\s]/g, '').toLowerCase() === boneName) {
      bone = o;
    }
  });
  if (!bone) return null;
  mesh.updateMatrixWorld(true);
  const ws = new THREE.Vector3();
  bone.getWorldScale(ws);
  const holder = new THREE.Group();
  holder.scale.setScalar(1 / (ws.x || 1));
  bone.add(holder);
  return holder;
}

// Right-hand mount for the held weapon.
// Shared by AI soldiers and the lobby character preview.
export function makeWeaponMount(mesh) {
  return makeBoneMount(mesh, 'righthand');
}

// Every weapon carries a `ref_muzzle` empty at the barrel tip (authored in
// Blender). Blender appends .001 to duplicate names — the DMR and rocket
// launcher both have it — and GLTFLoader then strips the dot as a reserved
// character, so what actually reaches the scene graph is `ref_muzzle001`.
// Match the suffix in any of its forms rather than the authored spelling.
// Resolve once per gun and cache: a traverse per shot, with 64 soldiers
// firing, is not free.
const MUZZLE_RE = /^ref_muzzle[._]?\d*$/i;
export function findMuzzle(root) {
  let found = null;
  if (root) root.traverse((o) => { if (!found && MUZZLE_RE.test(o.name || '')) found = o; });
  return found;
}

// Upper-spine mount for the stowed weapon.
export function makeBackMount(mesh) {
  return makeBoneMount(mesh, 'spine2') || makeBoneMount(mesh, 'spine1') || makeBoneMount(mesh, 'spine');
}

export function setHeldWeapon(holder, key, weaponModels) {
  while (holder.children.length) holder.remove(holder.children[0]);
  const src = weaponModels[key];
  if (!src) return;
  const def = WEAPONS[key];
  const gun = src.clone(true);
  restoreBakedDisplays(gun); // ammo counters: clones keep the baked look
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

    // Downed state. `alive` stays FALSE while downed, deliberately: every
    // existing "is this a live combatant" test — targeting, capture counts,
    // squad separation, the HUD — reads `alive`, and all of them want the same
    // answer for a casualty as for a corpse. The places that must tell the two
    // apart opt in by asking for `downed` explicitly, and there are only four
    // (the three hit filters in combat.js, and the AI respawn check in game.js).
    this.downed = false;
    this.downTimer = 0;        // bleedout remaining, seconds
    this.downedBy = null;      // credited if the bleedout runs out
    this.reviveProgress = 0;   // 0..1, driven by whoever is standing over us
    this.reviveHeld = false;   // set each frame by the rescuer; decays if not
    this.reviveTarget = null;  // AI: the casualty this soldier is walking to
    this.callTimer = 0;        // seconds left on a call for help
    // True on any frame this soldier is working on a casualty. Drives the CPR
    // pose and stows the rifle. The player controller writes it from its own
    // state, the same way it writes `crouching`/`aiming`; AI set it in
    // `_updateRevive`.
    this.reviving = false;
    this.supplyTarget = null;  // AI: the crate this soldier is walking to
    this.drawTimer = 0;        // AI: progress on the draw it is standing over

    this.waypoint = new THREE.Vector3();
    this.hasWaypoint = false;
    this.formationOffset = new THREE.Vector3();

    // Local-space move direction in the soldier's own frame: +F is where the
    // body is facing, +R is its right. `speed2D` alone cannot tell a strafe
    // from a charge, which is why every direction used to play the forward
    // cycle. Both movers (AI `_move`, the player controller) write these.
    this.moveF = 0;
    this.moveR = 0;
    this.crouching = false;     // player controller only; AI never crouch yet
    this.sprinting = false;     // ditto — set only while the boost is applying
    // Which of the two rifle idles this soldier settles into. Fixed per soldier
    // rather than rolled per transition, so nobody switches idle style every
    // time they stop walking.
    this.idleAnim = Math.random() < 0.5 ? 'idle' : 'idleLook';
    this.reloading = false;     // ditto — mirrors the controller's weapon state
    this.reloadTime = 0;        // carried weapon's reload duration, for the stretch
    this.airborne = false;      // ditto — AI have no jump
    // Mid-bash. Player controller only — AI have no melee verb yet, so this
    // never leaves false on them. `meleeSpan` is the window the clip is
    // compressed into (MELEE[x].animSpan), carried the same way `reloadTime`
    // carries the per-weapon reload for its stretch.
    this.meleeing = false;
    this.meleeSpan = 0;

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
    // Shield and jump height are PERK stats now, not loose class fields — the
    // Spartan's 70 / 3 m were perks in everything but the name, and giving them
    // a home is what stops every future class trait accreting as another key.
    const perkStats = (classPerk(cls) && classPerk(cls).stats) || {};
    this.maxShield = perkStats.shield || S.shield;
    // How high this soldier jumps, in metres. Everything else about the jump —
    // takeoff speed, hang time, how fast the jump clip plays — is derived from
    // this one number, so it is the only thing to tune. MJOLNIR clears 3 m.
    this.jumpHeight = perkStats.jumpHeight || S.jumpHeight;
    // Stamina, in SECONDS OF SPRINT (drain is 1/s by definition). It lives here
    // rather than on the controller for the same reason shield does: this is
    // where perks resolve, and it is what lets bots opt in later without the
    // rule being reimplemented on the other side.
    //
    // MJOLNIR's pool is literally Infinity, so `unlimited` is resolved once
    // here and every consumer asks the flag — no bar width, drain or ramp ever
    // divides by it.
    this.maxStamina = ST.max * (perkStats.staminaMax || 1);
    this.staminaUnlimited = !isFinite(this.maxStamina);
    this.staminaRegen = ST.regen * (perkStats.staminaRegen || 1);
    // MARATHON overrides the moving-regen penalty outright rather than scaling
    // it, which is what "keeps recovering while still moving" means.
    this.staminaMoveRegen = perkStats.staminaMoveRegen !== undefined
      ? perkStats.staminaMoveRegen
      : ST.moveRegenMult;
    // Clamp, never refill: setLoadout also runs on firing-range weapon pickups,
    // and picking a gun off the rack must not hand back a spent pool. `spawnAt`
    // is the only thing that fills it.
    this.stamina = Math.min(this.stamina !== undefined ? this.stamina : this.maxStamina, this.maxStamina);
    this.staminaTimer = 0;   // regen delay remaining, seconds
    this.exhausted = false;  // latched at empty, cleared at ST.resprintAt
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
    // head bone for the spectate/helmet camera
    this.headBone = null;
    this.mesh.traverse((o) => {
      if (!this.headBone && o.isBone &&
          o.name.replace(/^.*?mixamorig[:_]?/i, '').replace(/[:_\s]/g, '').toLowerCase() === 'head') {
        this.headBone = o;
      }
    });
  }

  // Both guns are cloned once up front — the active one in the right hand,
  // the other stowed on the back. Switching just re-parents them, so there is
  // no mid-fight clone hitch when the whole team swaps to secondaries.
  _initWeaponMount() {
    this.weaponHolder = makeWeaponMount(this.mesh);
    this.backHolder = makeBackMount(this.mesh);
    this.guns = {};
    this.heldKey = null;
    if (!this.weaponHolder) return;
    for (const def of [this.primary, this.secondary]) {
      const src = this.game.assets.weaponModels[def.key];
      if (src && !this.guns[def.key]) {
        const gun = src.clone(true);
        restoreBakedDisplays(gun); // ammo counters: clones keep the baked look
        gun.userData.muzzle = findMuzzle(gun);
        this.guns[def.key] = gun;
      }
    }
    if (this.activeWeapon) this._setHeldWeapon(this.activeWeapon.key);
  }

  // Make a model available for `key` if this soldier never spawned carrying it.
  // Both guns are normally cloned once up front precisely so nothing clones
  // mid-fight; this is the runtime-loadout escape hatch (armory apply, or the
  // firing range's rack pickups), and it clones at most once per new weapon.
  ensureGun(key) {
    if (!this.weaponHolder || !key || this.guns[key]) return;
    const src = this.game.assets.weaponModels[key];
    if (!src) return;
    const gun = src.clone(true);
    restoreBakedDisplays(gun);
    gun.userData.muzzle = findMuzzle(gun);
    this.guns[key] = gun;
  }

  _setHeldWeapon(key) {
    if (!this.weaponHolder || this.heldKey === key) return;
    this.heldKey = key;
    for (const [k, gun] of Object.entries(this.guns)) {
      if (k === key) {
        const def = WEAPONS[k];
        const pos = (def.grip && def.grip.pos) || GRIP.pos;
        const rot = (def.grip && def.grip.rot) || GRIP.rot;
        gun.position.set(pos[0], pos[1], pos[2]);
        gun.rotation.set(rot[0], rot[1], rot[2]);
        this.weaponHolder.add(gun);
      } else if (this.backHolder) {
        const bk = BACK[this.character && this.character.key] || BACK.marine;
        gun.position.set(bk.pos[0], bk.pos[1], bk.pos[2]);
        gun.rotation.set(bk.rot[0], bk.rot[1], bk.rot[2]);
        this.backHolder.add(gun);
      } else {
        gun.removeFromParent();
      }
    }
  }

  // Takeoff speed that reaches `jumpHeight` under the world's gravity, and the
  // hang time that follows from it. Derived rather than tuned so height stays
  // the single knob — see CFG.soldier.jumpHeight.
  get jumpVel() { return Math.sqrt(2 * CFG.gravity * this.jumpHeight); }
  get jumpAirtime() { return 2 * this.jumpVel / CFG.gravity; }

  // Project a world-space velocity onto the body's own frame. The mesh faces
  // local +Z, so with `mesh.rotation.y = yaw` its forward is (sin, cos) — the
  // same convention `muzzlePos` uses. Y-up and right-handed means a +Z-facing
  // model's right is local -X, so its world right is (-cos, sin).
  setMoveDir(wx, wz, speed) {
    if (speed > 1e-3) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      this.moveF = (wx * sin + wz * cos) / speed;
      this.moveR = (wz * sin - wx * cos) / speed;
    } else {
      this.moveF = 0;
      this.moveR = 0;
    }
  }

  // Pick the dominant movement axis and name the matching clip out of a 4-way
  // set. `moveF`/`moveR` are unit-length in the body's own frame, so a diagonal
  // resolves to whichever axis leads; the tie goes to forward/back.
  _dirAnim(fwd, back, left, right) {
    return Math.abs(this.moveF) >= Math.abs(this.moveR)
      ? (this.moveF >= 0 ? fwd : back)
      : (this.moveR >= 0 ? right : left);
  }

  // Which locomotion clip the current stance, speed and direction call for.
  //
  // Movement outranks the aim pose: `aim` is a stationary kneel, so letting a
  // target hold it while the soldier is walking left everyone sliding along in
  // a crouch. It is the pose for standing still with a target, not for moving
  // with one.
  _locomotionAnim() {
    const moving = this.speed2D > 0.4;
    if (this.airborne) return 'jump';
    // Working on a casualty outranks the whole locomotion set, including the
    // gait: this is a committed action, and showing a run over it would be the
    // body lying about what the soldier is doing. It loops until the pickup
    // completes or is broken off.
    if (this.reviving) return 'cpr';
    // A bash is a committed action like a pickup, so it outranks the gait and
    // the reload the same way — but it sits BELOW `reviving` and `airborne`,
    // which are states you cannot be swinging out of.
    if (this.meleeing) return 'melee';
    if (this.crouching) {
      if (!moving) return 'crouchIdle';
      return this._dirAnim('crouchFwd', 'crouchBack', 'crouchLeft', 'crouchRight');
    }
    if (moving) {
      // Reloading outranks the gait it replaces — same stride, hands busy — and
      // picks the clip matching the tier it stands in for. Forward only: these
      // clips' legs travel forward, so strafing or backpedalling falls through
      // to ordinary locomotion rather than sliding sideways mid-reload.
      if (this.reloading && this.moveF > 0 && Math.abs(this.moveF) >= Math.abs(this.moveR)) {
        return this.speed2D > 4 ? 'runReload' : 'walkReload';
      }
      // Sprint is a tier above run rather than a direction: the clip carries the
      // rifle low, which only reads going forward, and that is the only case the
      // controller flags — it drops the flag the moment the boost stops applying.
      if (this.sprinting) return 'sprint';
      return this.speed2D > 4
        ? this._dirAnim('run', 'runBack', 'runLeft', 'runRight')
        : this._dirAnim('walk', 'walkBack', 'walkLeft', 'walkRight');
    }
    if (this.reloading) return 'idleReload';
    if (this.target || this.aiming) return 'aim';
    return this.idleAnim;
  }

  playAnim(key, fade = 0.18) {
    if (!this.actions || this.currentAnim === key) return;
    const next = this.actions[key];
    if (!next) return;
    const prev = this.actions[this.currentAnim];
    next.reset();
    // One-shots: a death holds its final pose, and the jump, bash and reloads
    // hold their last frame rather than looping if the event outlasts the clip.
    const isReload = key.endsWith('Reload');
    if (key === 'jump' || key === 'melee' || isReload || key.startsWith('death')) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }
    // A clip that accompanies a timed event is stretched to span it, so it ends
    // as the event does. None of the three durations is a constant: a taller
    // jump hangs longer, reload time is per-weapon (2.1-3.4 s across the
    // armoury), and the bash window is per-melee (MELEE[x].animSpan).
    const span = key === 'jump' ? this.jumpAirtime
      : key === 'melee' ? this.meleeSpan
        : isReload ? this.reloadTime : 0;
    if (span > 0.05) next.setEffectiveTimeScale(next.getClip().duration / span);
    next.fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.currentAnim = key;
  }

  // Equip the gadget slots. Only the ones with AI behaviour behind them are
  // tracked — the rest are loadout data the sim has nothing to do with yet.
  setGadgets(keys, grenadeKey) {
    this.gadgetKeys = keys || [];
    // Biofoam is universal — every soldier carries it, and Support carries the
    // larger ration. It is no longer looked up in the gadget list because it is
    // no longer a gadget.
    this.biofoam = {
      def: BIOFOAM,
      charges: (BIOFOAM.perClass && BIOFOAM.perClass[this.cls]) || BIOFOAM.count,
      useTimer: 0,
      healLeft: 0,
    };
    // A placeable crate is the one slot gadget the AI can act on, so it gets
    // charge state of its own. The rest of `gadgetKeys` stays inert loadout
    // data the simulation has nothing to do with yet.
    this.crateKey = (this.gadgetKeys || []).find((k) => GADGETS[k] && GADGETS[k].crate) || null;
    this.crateCharges = this.crateKey ? (GADGETS[this.crateKey].charges || 0) : 0;
    const gdef = GRENADES[grenadeKey];
    this.grenade = gdef ? { def: gdef, count: gdef.count } : null;
    // A grenade with no `ai` block is one the AI never throws — that is how an
    // unbuilt type (smoke) rides in the pool without the simulation trying to
    // use it. Missing it here crashed match setup the moment a Recon rolled one.
    this.grenadeCooldown = Math.random() * ((gdef && gdef.ai && gdef.ai.cooldown) || 10);
  }

  spawnAt(x, z) {
    this.pos.set(x, this.game.world.heightAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.alive = true;
    this.downed = false;
    this.downTimer = 0;
    this.downedBy = null;
    this.reviveProgress = 0;
    this.reviveHeld = false;
    this.reviveTarget = null;
    this.reviving = false;
    this.supplyTarget = null;
    this.drawTimer = 0;
    this.callTimer = 0;
    this._called = false;
    this.shield = this.maxShield;
    this.health = S.health;
    this.stamina = this.maxStamina;
    this.staminaTimer = 0;
    this.exhausted = false;
    this.target = null;
    this.burstLeft = 0;
    // A respawn is a fresh kit — injector, frags and all.
    if (this.biofoam) {
      const b = this.biofoam.def;
      this.biofoam.charges = (b.perClass && b.perClass[this.cls]) || b.count;
      this.biofoam.useTimer = 0;
      this.biofoam.healLeft = 0;
    }
    // One crate per life, reissued on respawn like the rest of the kit.
    if (this.crateKey) this.crateCharges = GADGETS[this.crateKey].charges || 0;
    if (this.grenade) {
      const d = this.grenade.def;
      this.grenade.count = d.count;
      this.grenadeCooldown = Math.random() * ((d.ai && d.ai.cooldown) || 10);
    }
    if (this.mesh) {
      this.mesh.visible = !this.isPlayer;
      this.playAnim('idle', 0);
    }
  }

  eyePos(out) {
    return out.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
  }
  // Barrel tip of the gun actually being held, so a rocket launcher and a
  // pistol no longer fire from the same nominal chest point. Falls back to that
  // point when there is no model (arena stubs, a soldier before its mesh loads).
  //
  // The world matrix can lag by a frame on distant soldiers, whose animation is
  // throttled — invisible on a tracer origin, but do not build anything
  // precision-critical on it.
  muzzlePos(out) {
    const gun = this.guns && this.guns[this.heldKey];
    const m = gun && gun.userData.muzzle;
    if (m) return m.getWorldPosition(out);
    out.set(this.pos.x + Math.sin(this.yaw) * 0.5, this.pos.y + 1.42, this.pos.z + Math.cos(this.yaw) * 0.5);
    return out;
  }

  takeDamage(amount, attacker, isHead) {
    if (!this.alive && !this.downed) return false;
    if (this.isPlayer && this.game.spectating) return false;
    // Finishing a casualty needs no mechanic of its own — any further damage
    // kills. Going down inside an enemy push should almost never survive, and
    // this is what makes that true without a separate execute verb.
    if (this.downed) { this.die(attacker); return true; }
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
      // One margin instead of a damage-type list: a blow that carries far past
      // zero kills outright, anything less puts the soldier on the ground.
      // `health` is already negative here, so the overflow is free to read.
      if (D.enabled && -this.health < S.health * D.gibMargin) this.goDown(attacker);
      else this.die(attacker);
      return true;
    }
    return false;
  }

  // Out of the fight, not gone. Costs no ticket and no death — both are paid
  // in `die` if the bleedout runs out, which is why `downedBy` is kept.
  goDown(attacker) {
    this.alive = false;
    this.downed = true;
    this.downTimer = D.bleedout;
    this.downedBy = attacker || null;
    this.reviveProgress = 0;
    this.reviveHeld = false;
    this.reviveTarget = null;
    this.reviving = false;
    this.supplyTarget = null;
    this.drawTimer = 0;
    this.callTimer = 0;
    this._called = false;
    this.health = 0;
    this.shield = 0;
    this.target = null;
    this.deadTimer = 0;
    this.removeBodyTimer = 0;
    this.speed2D = 0;
    this.playAnim(Math.random() < 0.5 ? 'death1' : 'death2', 0.08);
    this.game.onDown(this, attacker);
  }

  die(attacker) {
    // Already lying down: re-triggering the death clip would snap the body back
    // to its first frame, which reads as the corpse flinching.
    const wasDowned = this.downed;
    this.downed = false;
    this.alive = false;
    this.deaths++;
    this.deadTimer = 0;
    this.removeBodyTimer = 0;
    this.target = null;
    this.reviveTarget = null;
    this.reviving = false;   // or the corpse keeps both guns stowed on its back
    this.supplyTarget = null;
    this.drawTimer = 0;
    this.callTimer = 0;
    this._called = false;
    const credit = attacker || this.downedBy;
    if (credit) credit.kills++;
    if (!wasDowned) this.playAnim(Math.random() < 0.5 ? 'death1' : 'death2', 0.08);
    this.game.onKill(credit, this);
  }

  // Advance a pickup. Called once per frame by whoever is standing over this
  // casualty — the player controller or an AI — and returns true on the frame
  // it completes, which is when the rescuer pays their biofoam charge. Paying
  // at the call site rather than in here is what keeps "spent on completion"
  // literally true in the code.
  applyRevive(by, dt) {
    if (!this.downed || !by) return false;
    const perk = classPerk(by.cls);
    const rate = (perk && perk.stats && perk.stats.reviveRate) || 1;
    this.reviveHeld = true;
    this.reviver = by;
    this.reviveProgress += (dt * rate) / D.reviveTime;
    if (this.reviveProgress < 1) return false;
    this.revive(by);
    return true;
  }

  // Back on your feet on half health, no shields, and carrying whatever biofoam
  // you had — this is not a respawn, so `spawnAt` (which re-issues the kit) is
  // deliberately not what runs here.
  revive(by) {
    this.downed = false;
    this.alive = true;
    this.downTimer = 0;
    this.reviveProgress = 0;
    this.reviveHeld = false;
    // `_updateDowned` is the only thing that decays a call, so leaving one set
    // here would strand it: the soldier is back on their feet still flagged as
    // shouting, forever.
    this.callTimer = 0;
    this._called = false;
    this.health = S.health * D.reviveHealth;
    this.shield = 0;
    this.shieldTimer = 0;
    // Up on the same fraction as health, on purpose: `reviveHealth` is already
    // the number that says how much of you came back, and reusing it means the
    // strength of a pickup stays ONE knob. Sprinting straight out of a rescue
    // is what the pool now costs you.
    this.stamina = this.maxStamina * D.reviveHealth;
    this.staminaTimer = 0;
    this.exhausted = false;
    this.target = null;
    if (this.mesh) {
      this.mesh.visible = !this.isPlayer;
      this.playAnim('idle', 0.25);
    }
    this.game.onRevive(this, by || null);
  }

  // ---- Per-frame update (AI only; the player overrides movement) --------
  update(dt) {
    if (this.downed) {
      this._updateDowned(dt);
      this._updateAnim(dt);
      return;
    }
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
      this._updateBiofoam(dt);
      this._think(dt);
      this._updateRevive(dt);
      this._updateSupply(dt);
      this._move(dt);
      this._fire(dt);
    }
    this._updateAnim(dt);
  }

  // Bleeding out. Progress banked by a rescuer decays once they stop working,
  // so walking away costs the attempt rather than leaving it half-saved for the
  // next passer-by. `reviveHeld` is set by applyRevive and cleared here, which
  // means a rescuer updating later in the soldier list is one frame late — a
  // rounding error against a 5-second pickup, and not worth an ordering pass.
  _updateDowned(dt) {
    this.speed2D = 0;
    this.moveF = 0;
    this.moveR = 0;
    if (!this.reviveHeld && this.reviveProgress > 0) {
      this.reviveProgress = Math.max(0, this.reviveProgress - dt * D.reviveDecay / D.reviveTime);
    }
    this.reviveHeld = false;
    if (this.callTimer > 0) this.callTimer = Math.max(0, this.callTimer - dt);
    // Bots call out once, a beat after they go down. Without this the `calling`
    // state would be unreachable in practice — the player never sees their own
    // marker, so every pulsing marker on screen belongs to a bot. It also
    // sorts the field usefully: a fresh casualty shouts, an old one is quiet.
    if (!this.isPlayer && !this._called && this.downTimer < D.bleedout - 1.5) {
      this._called = true;
      this.callForHelp();
    }
    this.downTimer -= dt;
    if (this.downTimer <= 0) this.die(this.downedBy);
  }

  // The one thing a casualty can still do. It is not decoration: a live call
  // widens the radius a bot will travel (see `_findCasualty`) and puts the
  // marker at the top of the pile, so shouting genuinely improves your odds.
  callForHelp() {
    if (!this.downed || this.callTimer > 0) return false;
    this.callTimer = D.callTime;
    return true;
  }

  // AI casualty recovery. The decision of WHO to go to is made on the think
  // tick (see `_think`); this is only the approach and the hold, which have to
  // run every frame. Fighting outranks first aid — a bot with a target drops
  // the errand rather than jogging across a firefight to it.
  _updateRevive(dt) {
    this.reviving = false;
    const t = this.reviveTarget;
    if (!t) return;
    if (!t.downed || this.target || !this.biofoam || this.biofoam.charges <= 0) {
      this.reviveTarget = null;
      return;
    }
    // Facing is already handled: `_move`'s reviveTarget branch turns the body
    // toward the casualty both on approach and once standing over it.
    if (this.pos.distanceTo(t.pos) > D.reviveRange) return;
    this.reviving = true;
    if (t.applyRevive(this, dt)) {
      this.biofoam.charges -= BIOFOAM.reviveCost;
      this.reviveTarget = null;
      this.reviving = false;
    }
  }

  // Nearest downed teammate worth walking to. Any teammate, not just the squad:
  // squads are four and the window is sixty seconds, so squad-only recovery
  // would leave most downs unanswerable on a field of thirty-two.
  _findCasualty() {
    // The arena/chartest game slice has no `teams` — no sides, no casualties.
    const t = this.game.teams && this.game.teams[this.team];
    if (!t) return null;
    const mates = t.soldiers;
    // Scored, not just nearest: a casualty who is calling reads as closer than
    // they are, so a shout wins against a silent body slightly nearer by. That
    // is the whole mechanical payload of calling for help.
    let best = null, bestScore = BIOFOAM.aiReviveRange;
    for (const m of mates) {
      if (m === this || !m.downed) continue;
      const d = this.pos.distanceTo(m.pos);
      const score = m.callTimer > 0 ? d / D.callRangeMult : d;
      if (score < bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  // AI biofoam. Without this the gadget effectively does not exist in the sim:
  // 31 of the 32 Assaults on a side are AI, so a player-only heal would not
  // move a single ticket.
  //
  // The AI uses it the way a player should — out of contact, hurt, and paying
  // the lockout. `shieldTimer` doubles as time-since-damage (it is what gates
  // shield regen), so it is already the "am I being shot at" signal.
  _updateBiofoam(dt) {
    const g = this.biofoam;
    if (!g) return;
    if (g.healLeft > 0) {
      const step = Math.min(g.healLeft, g.def.healRate * dt);
      this.health = Math.min(S.health, this.health + step);
      g.healLeft -= step;
    }
    if (g.useTimer > 0) {
      g.useTimer -= dt;
      if (g.useTimer <= 0) { g.useTimer = 0; g.healLeft = g.def.heal; }
      return;
    }
    if (g.charges <= 0 || g.healLeft > 0) return;
    // Hurt enough to be worth a charge, and not currently under fire. Both
    // thresholds are on the gadget def — see the note there on why the calm
    // window is its own number and not CFG.soldier.shieldRegenDelay.
    if (this.health > S.health * (g.def.aiUseBelow ?? 0.7)) return;
    if (this.shieldTimer < (g.def.aiCalmTime ?? 2.0)) return;
    g.charges--;
    g.useTimer = g.def.useTime;
    // Committed: the injection costs the same tempo it costs a player.
    this.fireTimer = Math.max(this.fireTimer, g.def.useTime);
    this.burstLeft = 0;
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

    // Errands, decided on the same tick as targeting because they are the same
    // decision: fight, or go do something useful. Priority is fight > pick
    // someone up > resupply. `shieldTimer` doubles as time-since-damage — the
    // signal `_updateBiofoam` already trusts to mean "not being shot at".
    const charges = this.biofoam ? this.biofoam.charges : 0;
    const calm = this.shieldTimer >= BIOFOAM.aiReviveCalm;

    if (D.enabled && !this.target && calm && charges > 0) {
      if (!this.reviveTarget || !this.reviveTarget.downed) {
        this.reviveTarget = this._findCasualty();
      }
    } else {
      this.reviveTarget = null;
    }

    // Resupply is what a bot does when it has nothing left to spend, which is
    // why this is NOT chained onto the check above: an empty injector is
    // exactly the state casualty recovery rejects, so sharing that early-out
    // would mean a bot could only go looking for a crate while it still had
    // charges — the one time it does not need one.
    if (!this.target && !this.reviveTarget && this.biofoam && charges <= CFG.crate.aiSeekBelow) {
      if (!this.supplyTarget || this.supplyTarget.pool <= 0) {
        this.supplyTarget = this._findCrate();
      }
    } else {
      this.supplyTarget = null;
    }

    if (!this.target && calm) this._tryPlaceCrate();
  }

  // Support bots dropping their crate. Placement is instant and happens where
  // the bot already is, so unlike the other errands it needs no movement branch
  // — the condition is simply "I am standing somewhere worth supplying".
  //
  // Proximity is measured to the nearest SECTOR, not to the squad's assigned
  // objective, and that is a correction rather than a preference: sampled over
  // a 150 s battle, the median distance from a support bot to its squad
  // objective was 148 m. Squads spend nearly all their time in transit toward
  // one, so an objective test at any sane radius almost never fires. Sectors are
  // where the fighting actually concentrates, which is what makes a crate
  // dropped at one read as a supply line rather than as litter.
  _tryPlaceCrate() {
    if (!this.crateKey || this.crateCharges <= 0) return;
    const sup = this.game.supply;
    if (!sup) return;
    const C = CFG.crate;
    let nearSector = Infinity;
    for (const s of this.game.world.sectors) {
      const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
      if (d < nearSector) nearSector = d;
    }
    if (nearSector > C.aiNearObjective) return;
    let live = 0;
    for (const c of sup.crates) {
      if (c.team !== this.team || c.pool <= 0) continue;
      if (this.pos.distanceTo(c.pos) < C.aiMinSpacing) return;  // do not cluster
      live++;
    }
    if (live >= C.aiTeamCap) return;
    this.crateCharges--;
    sup.place(this, GADGETS[this.crateKey]);
  }

  // Nearest friendly medical crate with something left in it. Ammunition crates
  // are skipped because a bot has no reserve to refill — see CFG.crate.
  _findCrate() {
    const sup = this.game.supply;
    if (!sup) return null;
    let best = null, bestD = CFG.crate.aiSeekRange;
    for (const c of sup.crates) {
      if (c.team !== this.team || c.pool <= 0) continue;
      if (c.def.crate.give !== 'biofoam') continue;
      const d = this.pos.distanceTo(c.pos);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // Walk to a crate and draw from it. Same pool and the same per-draw amount
  // the player takes — `supply.draw` is the single place a crate is spent, so
  // a bot cannot quietly get a better deal than a human standing next to it.
  _updateSupply(dt) {
    const t = this.supplyTarget;
    if (!t) { this.drawTimer = 0; return; }
    if (t.pool <= 0 || this.target || !this.biofoam) {
      this.supplyTarget = null;
      this.drawTimer = 0;
      return;
    }
    if (this.pos.distanceTo(t.pos) > CFG.crate.reach) { this.drawTimer = 0; return; }
    this.drawTimer += dt;
    if (this.drawTimer < CFG.crate.drawTime) return;
    this.drawTimer = 0;
    const got = this.game.supply.draw(t);
    if (got > 0) {
      const b = this.biofoam.def;
      const max = (b.perClass && b.perClass[this.cls]) || b.count;
      this.biofoam.charges = Math.min(max, this.biofoam.charges + got);
    }
    this.supplyTarget = null;
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
    } else if (this.reviveTarget) {
      // Answering a down outranks the squad's waypoint but never a live target,
      // so this sits between the two. Stop short of the body rather than on it,
      // or the separation push and the pickup range fight each other.
      const t = this.reviveTarget;
      const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > D.reviveRange * 0.7) {
        desired.set(dx / dist, 0, dz / dist).multiplyScalar(S.runSpeed);
      }
      if (dist > 1e-3) this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), Math.min(1, dt * 8));
    } else if (this.supplyTarget) {
      // Below casualties, above the squad's waypoint. A bot with an empty
      // injector is worth less to the squad at the objective than it is a few
      // seconds later with a full one.
      const t = this.supplyTarget;
      const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > CFG.crate.reach * 0.6) {
        desired.set(dx / dist, 0, dz / dist).multiplyScalar(S.runSpeed);
      }
      if (dist > 1e-3) this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), Math.min(1, dt * 8));
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
    this.setMoveDir(desired.x, desired.z, this.speed2D);
    this.pos.x += desired.x * dt;
    this.pos.z += desired.z * dt;
    this.game.world.collideCircle(this.pos, 0.6);
    const col = this.game.world.collision;
    if (col) col.pushOut(this.pos, 0.5);
    this.game.world.clampToMap(this.pos);
    const g = col ? col.groundAt(this.pos.x, this.pos.y, this.pos.z) : null;
    this.pos.y = g !== null ? g : this.game.world.heightAt(this.pos.x, this.pos.z);
  }

  _fire(dt) {
    this.fireTimer -= dt;
    this.rocketCooldown -= dt;
    if (this.grenadeCooldown > 0) this.grenadeCooldown -= dt;
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
      // Frag a clustered group. Sits ahead of the rocket check because it is
      // the shorter-ranged answer to the same situation, and `_explode` only
      // damages the thrower's enemies, so there is no friendly-fire risk to
      // weigh — the AI never has to decide whether a throw is safe.
      if (this.grenade && this.grenade.def.ai && this.grenade.count > 0 && this.grenadeCooldown <= 0
          && dist >= this.grenade.def.ai.minRange && dist <= this.grenade.def.ai.maxRange
          && this._clusterSize(this.target) >= this.grenade.def.ai.cluster) {
        const def = this.grenade.def;
        this.muzzlePos(_v);
        const dx = this.target.pos.x - _v.x, dz = this.target.pos.z - _v.z;
        const flat = Math.hypot(dx, dz) || 1;
        // Loft scaled by distance. Not a ballistic solve — a frag is an area
        // weapon and landing near is the whole requirement.
        _v2.set(dx / flat, 0.22 + flat * 0.012, dz / flat).normalize();
        this.game.combat.throwGrenade(this, _v.clone(), _v2, def);
        this.grenade.count--;
        this.grenadeCooldown = def.ai.cooldown;
        this.fireTimer = def.useTime;
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
    if (this.game.spectatedSoldier === this) interval = 0; // live feed needs full rate
    if (this.animAccum < interval) return;
    const step = this.animAccum;
    this.animAccum = 0;

    // The player's body animates from the same state as everyone else's: the
    // controller writes pos/yaw/speed2D onto it each frame. It was excluded
    // here, which left it frozen in the idle set at setCharacter — invisible in
    // first person, but wrong the moment freecam or any third-person view shows
    // it. `aiming` is set by the player controller only; AI have no such flag,
    // so their behaviour is unchanged.
    if (this.alive) this.playAnim(this._locomotionAnim());
    // Both hands are on the casualty during a pickup, so both guns go to the
    // back — `_setHeldWeapon(null)` matches nothing, which parents every gun to
    // the back mount. The branch below re-equips the instant the pickup ends.
    if (this.reviving) this._setHeldWeapon(null);
    else if (this.activeWeapon && this.heldKey !== this.activeWeapon.key) {
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
