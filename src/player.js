// First-person controller: pointer lock, movement, class loadout with two
// weapons (auto/burst/semi/pump/projectile/charge fire modes), freecam.

import * as THREE from 'three';
import { CFG, WEAPONS, CLASSES, GADGETS, GRENADES, MELEE, FP_DEFAULT, ADS_DEFAULT } from './config.js';
import { weaponSlotGadget } from './loadout.js';
import { createAmmoDisplay } from './ammodisplay.js';
import { createScopeDisplay, tagViewmodelLayer, VIEWMODEL_LAYER } from './scopedisplay.js';
import { findMuzzle } from './soldier.js';

const P = CFG.player;
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();

// Hip reference pose for the viewmodel holder. Aiming moves the holder to the
// weapon's own `ads.pos` — the transform that puts that weapon's sight on the
// crosshair — instead of the one slide-to-centre that used to serve every gun.
const HIP_POS = [0.28, -0.24, -0.55];
const HIP_FOV = 75;
const HIP_SENS = 0.0021;
const TAN_HIP = Math.tan(THREE.MathUtils.degToRad(HIP_FOV) / 2);
const ZERO3 = [0, 0, 0];

function mkWeaponState(key) {
  const def = WEAPONS[key];
  return {
    key, def,
    mag: def.mag,
    reserve: def.reserve,
    reloading: false,
    reloadTimer: 0,
    burstLeft: 0,
    chargeT: 0,
  };
}

// Runtime state for one equipped gadget. Passive kinds (weaponSlot) get a state
// object too so the slot indices stay aligned with loadout.gadgets — pressing
// their key simply does nothing.
function mkGadgetState(key) {
  const def = GADGETS[key];
  if (!def) return null;
  return {
    key, def,
    charges: def.charges || 0,
    useTimer: 0,     // >0 while the animation/lockout is playing
    cooldown: 0,     // >0 between charges
    healLeft: 0,     // HP still owed by an injection that has landed
  };
}

// Muzzle-flash glow: white-hot core fading through orange to transparent.
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,220,150,0.9)');
  g.addColorStop(0.55, 'rgba(255,150,60,0.35)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Player {
  constructor(game, camera, domElement) {
    this.game = game;
    this.camera = camera;
    this.dom = domElement;

    this.yaw = Math.PI / 2;
    this.pitch = 0;
    this.pos = new THREE.Vector3();
    this.velY = 0;
    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.walking = false;   // Ctrl: drops under the run threshold into the walk set
    this.ads = false;
    // Third-person observation camera (O). Look and movement are unchanged —
    // only where the camera sits. Firing is suppressed while it is on, since
    // shots originate at the camera and would spawn behind the player.
    this.thirdPerson = false;
    this.tpDist = 0; // eased boom length, so wall collisions do not snap
    this.tpAds = 0;  // 0..1 blend from the hip boom to the over-shoulder one
    this.lookSens = HIP_SENS; // recomputed per frame from the current zoom
    this.eye = P.eyeHeight;

    this.weapons = [mkWeaponState('ar'), mkWeaponState('smg')];
    this.gadgets = [];      // one state per loadout.gadgets entry, same order
    this.grenade = null;    // { def, count, useTimer, cooldown, released }
    this.melee = null;      // { def, useTimer, cooldown, struck }
    this.swing = 0;         // 0..1 viewmodel dip, drives throw and bash motion
    this.active = 0;
    this.switchTimer = 0;
    this.fireTimer = 0;
    this.firing = false;
    this.prevFiring = false;
    this.heat = 0;

    this.keys = {};
    this.locked = false;

    // Input ownership. Listeners live on `document`, so every Player that
    // exists is handling every event — fine while there was only ever one, but
    // a second host (lobby roam) needs to hand the keyboard back and forth.
    // Nothing tore these down before either; dispose() closes that leak.
    this.enabled = true;
    this._listeners = [];

    // Freecam state
    this.freecam = false;
    this.fcPos = new THREE.Vector3();
    this.fcYaw = 0;
    this.fcPitch = 0;
    this.fcSpeed = 30;

    this._bindInput();
    this._buildViewmodel();
  }

  get soldier() { return this.game.playerSoldier; }
  get weapon() { return this.weapons[this.active]; }

  // Register a listener that is inert while disabled and removable on dispose.
  _on(target, type, fn) {
    const wrapped = (e) => { if (this.enabled) fn(e); };
    target.addEventListener(type, wrapped);
    this._listeners.push([target, type, wrapped]);
  }

  // Hand input to (or away from) this Player. Disabling drops any held state so
  // a key still down at the handoff doesn't stick on once control returns.
  setEnabled(on) {
    if (this.enabled === on) return;
    this.enabled = on;
    if (!on) {
      this.keys = {};
      this.firing = false;
      this.ads = false;
      this.locked = false;
    }
  }

  dispose() {
    this.setEnabled(false);
    for (const [target, type, fn] of this._listeners) target.removeEventListener(type, fn);
    this._listeners.length = 0;
  }

  _bindInput() {
    this._on(document, 'keydown', (e) => {
      this.keys[e.code] = true;
      if (this.game.menuOpen) return; // armory owns the keyboard
      if (e.code === 'KeyR' && !this.freecam) this.startReload();
      if (e.code === 'KeyM') document.exitPointerLock();
      if (e.code === 'KeyF') this.game.toggleFreecam();
      if (e.code === 'KeyO' && !this.freecam) this.setThirdPerson(!this.thirdPerson);
      if (e.code === 'KeyP') this.game.togglePause();
      if (e.code === 'KeyT') this.game.cycleTimeScale();
      if (!this.freecam) {
        // Number keys follow the loadout's slot order: 1-2 weapons, 3-4 gadgets.
        // Grenade and melee get their own keys when those slots are implemented.
        if (e.code === 'Digit1') this.switchWeapon(0);
        if (e.code === 'Digit2') this.switchWeapon(1);
        if (e.code === 'Digit3') this.useGadget(0);
        if (e.code === 'Digit4') this.useGadget(1);
        if (e.code === 'KeyG') this.throwGrenade();
        if (e.code === 'KeyV') this.meleeAttack();
        if (e.code === 'KeyQ') this.switchWeapon(1 - this.active);
      }
    });
    this._on(document, 'keyup', (e) => { this.keys[e.code] = false; });
    this._on(document, 'wheel', (e) => {
      if (this.game.menuOpen) return;
      if (this.freecam) {
        this.fcSpeed = Math.max(5, Math.min(200, this.fcSpeed * (e.deltaY > 0 ? 0.8 : 1.25)));
      } else if (this.locked) {
        this.switchWeapon(1 - this.active);
      }
    });

    this._on(this.dom, 'mousedown', (e) => {
      if (this.game.menuOpen) return;
      if (!this.locked) { this.requestLock(); return; }
      if (this.freecam) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.ads = true;
    });
    this._on(document, 'mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.ads = false;
    });
    this._on(document, 'contextmenu', (e) => e.preventDefault());

    this._on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.firing = false;
    });
    this._on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      if (this.freecam) {
        this.fcYaw -= e.movementX * 0.0021;
        this.fcPitch -= e.movementY * 0.0021;
        this.fcPitch = Math.max(-1.55, Math.min(1.55, this.fcPitch));
        return;
      }
      this.yaw -= e.movementX * this.lookSens;
      this.pitch -= e.movementY * this.lookSens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
  }

  requestLock() {
    if (this.game.gameOver) return;
    if (this.game.playerDead && !this.freecam) return;
    this.dom.requestPointerLock();
  }

  setFreecam(on) {
    if (on) this.setThirdPerson(false); // one camera mode at a time
    this.freecam = on;
    this.firing = false;
    this.ads = false;
    this.viewmodel.visible = !on;
    const s = this.soldier;
    if (on) {
      this.fcPos.copy(this.camera.position);
      this.fcYaw = this.yaw;
      this.fcPitch = this.pitch;
      if (s.mesh && s.alive) s.playAnim('idle', 0);
      this.requestLock();
    }
    this.syncBodyVisibility();
  }

  // Third person is a camera mode, not a game mode: the controller, the body
  // and `s.yaw` all behave exactly as in first person.
  setThirdPerson(on) {
    if (this.thirdPerson === on) return;
    this.thirdPerson = on;
    this.firing = false;
    this.ads = false;              // ADS drives fov/sens for a gun we are not showing
    this.viewmodel.visible = !on;
    if (on) this.tpDist = 0;       // ease the boom out from the head
    this.syncBodyVisibility();
    // The crosshair stays up: rounds are aimed at what it covers, so it is
    // telling the truth in this view too.
    this.game.hud.setCrosshairVisible(true);
    // The flash cannot ride a hidden viewmodel — park it in the world and drive
    // it from the body's muzzle instead.
    const flashHome = on ? this.game.scene : this.viewmodel;
    flashHome.add(this.flash);
    flashHome.add(this.muzzleLight);
    if (!on) {
      this.flash.position.set(0, 0.03, -0.55);
      this.muzzleLight.position.copy(this.flash.position);
    }
    this.game.hud.setModeTag(on ? 'THIRD PERSON — O TO EXIT' : null);
  }

  // The single writer for the player body's visibility. It used to be assigned
  // from six places (spawn, death, respawn, freecam, match setup), which meant
  // any new viewer had to win a race against all of them — `spawnAt` resetting
  // it to hidden was the standing example. Deriving it once per frame from the
  // modes that actually want a body removes that class of bug.
  syncBodyVisibility() {
    const s = this.soldier;
    if (!s || !s.mesh) return;
    s.mesh.visible = s.alive && (this.freecam || this.thirdPerson);
  }

  _buildViewmodel() {
    this.viewmodel = new THREE.Group();
    this.gunHolder = new THREE.Group();
    this.gunHolder.rotation.y = Math.PI; // muzzle away from camera
    this.viewmodel.add(this.gunHolder);
    this.viewmodel.position.set(0.28, -0.24, -0.55);
    this.camera.add(this.viewmodel);
    // Only the main camera sees the viewmodel layer; scope cameras must not,
    // or the scope fills with the rifle it is bolted to.
    this.camera.layers.enable(VIEWMODEL_LAYER);

    // radial glow texture — an untextured sprite renders as a solid square
    const flashMat = new THREE.SpriteMaterial({
      map: makeGlowTexture(), color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthTest: false,
    });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.scale.set(0.35, 0.35, 1);
    this.flash.position.set(0, 0.03, -0.55);
    this.viewmodel.add(this.flash);

    // muzzle light: kicks warm light onto the gun body and nearby surfaces.
    // Lives in the scene permanently (intensity 0) so lighting programs are
    // compiled once up front, not on the first shot.
    this.muzzleLight = new THREE.PointLight(0xffb36b, 0, 5, 2);
    this.muzzleLight.position.copy(this.flash.position);
    this.viewmodel.add(this.muzzleLight);

    this.recoil = 0;
    this.bobTime = 0;
    // Lerped holder state. Z is tracked apart from viewmodel.position.z because
    // recoil is added on top of it every frame and would otherwise be lerped in.
    this.vmZ = HIP_POS[2];
    this.vmRot = { x: 0, y: 0, z: 0 };
    this.vmScale = 1;
    this._mountGun();
  }

  _mountGun() {
    while (this.gunHolder.children.length) this.gunHolder.remove(this.gunHolder.children[0]);
    if (this.scopeDisplay) { this.scopeDisplay.dispose(); this.scopeDisplay = null; }
    const model = this.game.assets.weaponModels[this.weapon.key];
    if (model) {
      // per-weapon first-person offset (config `fp`, tuned in /chartest.html).
      // Applied on a wrapper group so the shared cached model stays untouched.
      const fp = this.weapon.def.fp || {};
      const mount = new THREE.Group();
      const p = fp.pos || FP_DEFAULT.pos, r = fp.rot || FP_DEFAULT.rot;
      mount.position.set(p[0], p[1], p[2]);
      mount.rotation.set(r[0], r[1], r[2]);
      if (fp.scale) mount.scale.setScalar(fp.scale);
      mount.add(model);
      this.gunHolder.add(mount);
      // Barrel tip of the viewmodel. The viewmodel is posed for the screen
      // rather than placed physically, so this sits ~half a metre off the
      // camera — which is exactly where the gun the player can see is.
      this.vmMuzzle = findMuzzle(model);
      // drive the gun's built-in ammo counter (weapons with a numbers_atlas)
      this.ammoDisplay = createAmmoDisplay(model);
      if (this.ammoDisplay) this.ammoDisplay.set(this.weapon.mag);
      // live scope screen (weapons with a `scope` block in config)
      this.scopeDisplay = createScopeDisplay(model, this.weapon.def);
      // re-tag every mount: the gun that just joined is still on layer 0
      tagViewmodelLayer(this.viewmodel);
    } else {
      this.ammoDisplay = null;
      this.vmMuzzle = null;
    }
    this.game.hud.setWeaponName(this.weapon.def.name);
    this._syncBodyWeapons();
  }

  // Keep the third-person body carrying what the viewmodel shows. Hooked into
  // _mountGun because every path that changes weapons goes through it —
  // applyLoadout, switchWeapon and setWeaponAt alike. Hidden in first person,
  // but freecam and any future third-person view read it, and a rack pickup can
  // hand over a weapon the soldier never spawned with.
  _syncBodyWeapons() {
    const s = this.soldier;
    if (!s || !s.setLoadout) return;
    s.setLoadout(s.cls, this.weapons[0].key, this.weapons[1].key);
    s.activeWeapon = this.weapon.def; // setLoadout assumes primary; we may be on the secondary
    s.ensureGun(this.weapon.key);
  }

  // Combat webbing's cost. Carrying a second long gun instead of a sidearm means
  // less spare ammo for BOTH of them — the reason the build wants Support's ammo
  // crate rather than being self-sufficient. Kept as a method because rack
  // pickups (setWeaponAt) build fresh weapon states that have to pay it too.
  _applyReservePenalty(w) {
    const g = weaponSlotGadget(this.loadout);
    if (g && g.reserveMult) w.reserve = Math.round(w.reserve * g.reserveMult);
    return w;
  }

  applyLoadout(loadout) {
    this.loadout = loadout;
    this.weapons = [mkWeaponState(loadout.primary), mkWeaponState(loadout.secondary)]
      .map((w) => this._applyReservePenalty(w));
    this.gadgets = (loadout.gadgets || []).map(mkGadgetState);
    const gdef = GRENADES[loadout.grenade];
    this.grenade = gdef
      ? { def: gdef, count: gdef.count, useTimer: 0, cooldown: 0, released: false }
      : null;
    const mdef = MELEE[loadout.melee];
    this.melee = mdef ? { def: mdef, useTimer: 0, cooldown: 0, struck: false } : null;
    this.active = 0;
    this.fireTimer = 0;
    this._mountGun();
    const s = this.soldier;
    if (s) {
      // setLoadout resolves the class jump height; takeoff speed and hang time
      // come off the soldier, so the controller has no jump numbers of its own.
      s.setLoadout(loadout.cls, loadout.primary, loadout.secondary);
      // body model follows the class (marine vs spartan); Covenant is always the Elite
      const charKey = this.game.playerTeam === 1 ? 'elite' : CLASSES[loadout.cls].model;
      const char = this.game.assets.characters[charKey];
      if (char) s.setCharacter(char);
    }
  }

  // Replace one loadout slot at runtime — firing-range pickups. Deliberately
  // does NOT touch the session loadout: re-entering roam re-applies it, which
  // is what returns the player to their chosen kit.
  //
  // The third-person body keeps its spawn loadout. It is hidden in first person,
  // and re-syncing means re-cloning the soldier's guns; a future third-person
  // pass wants soldier.setLoadout + _initWeaponMount here.
  setWeaponAt(i, key) {
    if (!WEAPONS[key] || !this.weapons[i]) return;
    this.weapons[i] = this._applyReservePenalty(mkWeaponState(key));
    this.fireTimer = Math.max(this.fireTimer, 0.3);
    this.recoil = Math.min(1, this.recoil + 0.5);
    if (i === this.active) this._mountGun();
  }

  switchWeapon(i) {
    if (i === this.active || !this.weapons[i]) return;
    if (this.actionBusy()) return;          // hands occupied
    const w = this.weapon;
    w.reloading = false;
    w.burstLeft = 0;
    w.chargeT = 0;
    this.game.hud.setReloading(false);
    this.active = i;
    // The cost is drawing the weapon you are switching TO, so it comes off that
    // weapon's def. This was a flat 0.4 for everything, which left the Magnum
    // with no reason to exist — the whole point of a sidearm is that reaching
    // for it beats reloading (0.2 s versus the MA5's 2.3 s).
    const draw = this.weapons[i].def.swapTime || P.swapTime;
    this.fireTimer = Math.max(this.fireTimer, draw);
    this.recoil = Math.min(1, this.recoil + 0.5); // little raise animation
    this._mountGun();
  }

  spawnAt(x, z) {
    this.pos.set(x, this.game.world.heightAt(x, z), z);
    this.velY = 0;
    this.applyLoadout(this.game.playerLoadout);
    this.pitch = 0;
    this.yaw = Math.atan2(-x, -z) + Math.PI;
    const s = this.soldier;
    s.spawnAt(x, z);
    this.syncBodyVisibility();
    // the deploy dive restores map styling while we're still "dead", which
    // leaves the viewmodel hidden — spawning always brings the gun back
    this.viewmodel.visible = !this.freecam && !this.thirdPerson;
  }

  // ------------------------------------------------------------ Gadgets --
  // True while a gadget is mid-use. Firing, reloading and swapping are all
  // locked out for this window — that lockout IS the cost of the gadget, and
  // without it biofoam would be a free full heal mid-fight.
  gadgetBusy() {
    return this.gadgets.some((g) => g && g.useTimer > 0);
  }

  // Any hands-busy action: injecting, throwing, or swinging. Firing, reloading
  // and swapping all check this — you get one of them at a time, and that
  // exclusivity is what stops a grenade from being free.
  actionBusy() {
    return this.gadgetBusy()
      || !!(this.grenade && this.grenade.useTimer > 0)
      || !!(this.melee && this.melee.useTimer > 0);
  }

  useGadget(i) {
    const g = this.gadgets[i];
    if (!g || this.freecam) return;
    const s = this.soldier;
    if (!s || !s.alive) return;
    // Only consumables do anything on a keypress. weaponSlot gadgets (combat
    // webbing) are passive — they were spent at the armoury, on the loadout.
    if (g.def.kind !== 'consumable') return;
    if (this.actionBusy() || g.cooldown > 0) return;
    if (g.charges <= 0) { this.game.hud.message(`${g.def.name} — EMPTY`, 1.5); return; }
    if (s.health >= CFG.soldier.health) {
      this.game.hud.message(`${g.def.name} — NOT INJURED`, 1.5);
      return;
    }
    g.charges--;
    g.useTimer = g.def.useTime;
    // Cancel whatever the weapon was doing; you cannot inject and reload.
    const w = this.weapon;
    w.reloading = false;
    w.burstLeft = 0;
    w.chargeT = 0;
    this.game.hud.setReloading(false);
    this.game.hud.message(`${g.def.name} — ${g.charges} LEFT`, 1.5);
  }

  _updateGadgets(dt) {
    const s = this.soldier;
    for (const g of this.gadgets) {
      if (!g) continue;
      if (g.cooldown > 0) g.cooldown = Math.max(0, g.cooldown - dt);
      if (g.useTimer > 0) {
        g.useTimer -= dt;
        // The injection lands at the END of the lockout, not the start — the
        // commitment has to be paid before the reward arrives.
        if (g.useTimer <= 0) {
          g.useTimer = 0;
          g.healLeft = g.def.heal || 0;
          g.cooldown = g.def.cooldown || 0;
        }
      }
      // Heal flows over time and does NOT lock you down — you are free to move
      // and shoot while it works. Only the injection itself costs you tempo.
      if (g.healLeft > 0 && s && s.alive) {
        const step = Math.min(g.healLeft, (g.def.healRate || 0) * dt);
        const room = CFG.soldier.health - s.health;
        const applied = Math.min(step, Math.max(0, room));
        s.health += applied;
        g.healLeft -= step;
        if (room <= 0) g.healLeft = 0;  // topped out; the rest is wasted
      }
    }
  }

  // ---------------------------------------------------- Grenade & melee --
  // Both follow the same shape as biofoam: commit to a lockout, and the effect
  // lands PART WAY THROUGH rather than on the keypress. The recovery tail after
  // it is what makes the action cost something.
  //
  // Neither has an animation yet — there is no throw or bash clip in
  // ASSET_PATHS.animations — so the feedback is a viewmodel dip driven by
  // `swing`. The timings below are authored to suit a real clip when one lands.
  _cancelWeaponAction() {
    const w = this.weapon;
    w.reloading = false;
    w.burstLeft = 0;
    w.chargeT = 0;
    this.game.hud.setReloading(false);
  }

  throwGrenade() {
    const g = this.grenade;
    if (!g || this.freecam) return;
    const s = this.soldier;
    if (!s || !s.alive) return;
    if (this.actionBusy() || g.cooldown > 0) return;
    if (g.count <= 0) { this.game.hud.message('NO GRENADES', 1.5); return; }
    g.count--;
    g.useTimer = g.def.useTime;
    g.released = false;
    this._cancelWeaponAction();
  }

  meleeAttack() {
    const m = this.melee;
    if (!m || this.freecam) return;
    const s = this.soldier;
    if (!s || !s.alive) return;
    if (this.actionBusy() || m.cooldown > 0) return;
    m.useTimer = m.def.useTime;
    m.struck = false;
    this._cancelWeaponAction();
  }

  _releaseGrenade() {
    const g = this.grenade;
    this.camera.getWorldDirection(_dir);
    // Loft. Without it a level throw drills straight into the floor a few
    // metres out, because gravity is the only thing shaping the arc.
    _dir.y += 0.24;
    _dir.normalize();
    // Leave from just in front of the eye, not the barrel — the throw is the
    // other hand, and spawning inside the player's own collision would have it
    // bounce off geometry it should already be past.
    _from.copy(this.camera.position).addScaledVector(_dir, 0.6);
    this.game.combat.throwGrenade(this.soldier, _from, _dir, g.def);
  }

  // Short forward sweep. Nearest enemy inside `range` and within `arc` of the
  // crosshair takes it — one target, so a bash cannot clear a doorway.
  _meleeStrike() {
    const m = this.melee;
    const s = this.soldier;
    if (!s) return;
    this.camera.getWorldDirection(_dir);
    const eyeY = this.pos.y + this.eye;
    const cosArc = Math.cos(m.def.arc);
    // The arc is measured on the HORIZONTAL plane only, with height handled as
    // a separate limit. Testing it in full 3D looked right and was not: the eye
    // sits at 1.78 m and the target's mass at ~1.0, so someone standing right
    // in front of you is already 24 degrees below the crosshair, and that tilt
    // ate most of the arc before any left-right forgiveness was applied. A
    // target 35 degrees off-centre — comfortably inside the 40-degree arc —
    // came out at a dot of 0.747 against a 0.765 threshold and was missed.
    // You should be able to bash what is in front of you regardless of whether
    // it is slightly up or down a slope.
    const fLen = Math.hypot(_dir.x, _dir.z) || 1;
    let best = null, bestD = Infinity;
    for (const e of this.game.allSoldiers) {
      if (!e.alive || e.team === s.team) continue;
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      // Height difference FOOT TO FOOT, not eye to chest. Measuring it from the
      // eye made the band lopsided: standing on level ground already puts a
      // target 0.78 m "below" you, so a 0.8 m dip fell outside a 1.5 m limit
      // while a 1.0 m rise sat comfortably inside it. Foot to foot, level
      // ground is 0 and the knob means what it says in both directions.
      const dLevel = e.pos.y - this.pos.y;
      const flat = Math.hypot(dx, dz);
      // Not someone on a roof or down a shaft. Its own limit, and it has to be
      // checked before the arc: a target directly overhead has no horizontal
      // offset to measure an angle against, so without this it was reachable
      // straight through the ceiling.
      if (Math.abs(dLevel) > (m.def.vertical ?? 1.5)) continue;
      const d = Math.hypot(flat, dLevel);
      if (d > m.def.range) continue;
      if (flat > 0.001 && (dx * _dir.x + dz * _dir.z) / (flat * fLen) < cosArc) continue;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;
    const killed = best.takeDamage(m.def.dmg, s, false);
    this.game.hud.showHitmarker(killed);
  }

  _updateActions(dt) {
    const g = this.grenade;
    if (g) {
      if (g.cooldown > 0) g.cooldown = Math.max(0, g.cooldown - dt);
      if (g.useTimer > 0) {
        g.useTimer -= dt;
        // Release part way through the motion, so the rest of the timer is the
        // recovery you are paying rather than a delay before anything happens.
        if (!g.released && g.useTimer <= g.def.useTime * 0.55) {
          g.released = true;
          this._releaseGrenade();
        }
        if (g.useTimer <= 0) { g.useTimer = 0; g.cooldown = g.def.cooldown; }
      }
    }
    const m = this.melee;
    if (m) {
      if (m.cooldown > 0) m.cooldown = Math.max(0, m.cooldown - dt);
      if (m.useTimer > 0) {
        m.useTimer -= dt;
        if (!m.struck && m.useTimer <= m.def.useTime * 0.5) {
          m.struck = true;
          this._meleeStrike();
        }
        if (m.useTimer <= 0) { m.useTimer = 0; m.cooldown = m.def.cooldown; }
      }
    }
    // Viewmodel dip: rises with how far into the action we are, falls away
    // after. Stands in for the animation that does not exist yet.
    const active = Math.max(
      g && g.useTimer > 0 ? g.useTimer / g.def.useTime : 0,
      m && m.useTimer > 0 ? m.useTimer / m.def.useTime : 0,
    );
    const target = active > 0 ? Math.sin(Math.PI * (1 - active)) : 0;
    this.swing += (target - this.swing) * Math.min(1, dt * 14);
  }

  startReload() {
    const w = this.weapon;
    if (this.actionBusy()) return;
    if (w.reloading || w.mag >= w.def.mag || w.reserve <= 0) return;
    w.reloading = true;
    w.reloadTimer = w.def.reload;
    w.chargeT = 0;
    this.game.audio.playUI('reload');
    this.game.hud.setReloading(true);
  }

  update(dt) {
    const s = this.soldier;
    if (!s.alive) return;

    // ---- Movement ----
    this.walking = !!this.keys['ControlLeft'];
    this.sprinting = !!this.keys['ShiftLeft'] && !this.ads && !this.walking;
    this.crouching = !!this.keys['KeyC'];
    const targetEye = this.crouching ? P.crouchEye : P.eyeHeight;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);

    let mx = 0, mz = 0;
    if (this.keys['KeyW']) mz += 1;
    if (this.keys['KeyS']) mz -= 1;
    if (this.keys['KeyA']) mx -= 1;
    if (this.keys['KeyD']) mx += 1;
    const moving = mx !== 0 || mz !== 0;
    let speed = P.speed;
    if (this.sprinting && mz > 0) speed *= P.sprintMult;
    if (this.walking) speed *= P.walkMult;
    if (this.crouching) speed *= P.crouchMult;

    let wx = 0, wz = 0;
    if (moving) {
      const l = Math.hypot(mx, mz);
      mx /= l; mz /= l;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      wx = -sin * mz + cos * mx;  // forward = (-sin,-cos), right = (cos,-sin)
      wz = -cos * mz - sin * mx;
      this.pos.x += wx * speed * dt;
      this.pos.z += wz * speed * dt;
    }

    // Mesh collision (authored floor shells) makes tunnels/bridges work; the
    // heightfield only ever sees the top surface, so it's the fallback.
    const col = this.game.world.collision;
    let ground = col ? col.groundAt(this.pos.x, this.pos.y, this.pos.z) : null;
    if (ground === null) ground = this.game.world.heightAt(this.pos.x, this.pos.z);
    if (this.onGround && this.keys['Space']) {
      this.velY = s.jumpVel; // height, and everything from it, lives on the soldier
      this.onGround = false;
    }
    if (!this.onGround || this.pos.y > ground + 0.01) {
      this.velY -= CFG.gravity * dt;
      this.pos.y += this.velY * dt;
      if (this.pos.y <= ground) { this.pos.y = ground; this.velY = 0; this.onGround = true; }
    } else {
      this.pos.y = ground;
      this.onGround = true;
    }

    this.game.world.collideCircle(this.pos, 0.55);
    if (col) col.pushOut(this.pos, 0.55);
    this.game.world.clampToMap(this.pos);

    s.pos.copy(this.pos);
    // The body mesh faces its local +Z, i.e. (sin yaw, cos yaw) — the convention
    // the AI and `muzzlePos` use. The camera looks the other way, along
    // (-sin, -cos), so handing it the raw camera yaw left the third-person body
    // facing backwards: invisible in first person, wrong in freecam/spectate and
    // wrong for every directional locomotion clip picked off `moveF`.
    s.yaw = this.yaw + Math.PI;
    s.speed2D = moving ? speed : 0;
    s.aiming = this.ads; // drives the body's aim pose; AI use `target` instead
    s.crouching = this.crouching;
    // Only while the boost actually applies — `sprinting` stays true when you
    // strafe with Shift down, but the speed bonus (and the clip) do not.
    s.sprinting = this.sprinting && mz > 0;
    s.airborne = !this.onGround;
    // `w` is declared further down in this scope, so read through the getter.
    s.reloading = this.weapon.reloading;
    s.reloadTime = this.weapon.def.reload;
    // Direction is resolved against the body's own facing, not the camera's, so
    // the strafe clips stay correct however `s.yaw` is derived.
    s.setMoveDir(wx, wz, moving ? 1 : 0);

    // ---- Camera ----
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.thirdPerson) {
      this._applyBoom(dt);
      // world-space flash follows the body's barrel while it is alight
      if (this.flash.material.opacity > 0 || this.muzzleLight.intensity > 0) {
        s.muzzlePos(_muzzle);
        this.flash.position.copy(_muzzle);
        this.muzzleLight.position.copy(_muzzle);
      }
    }
    this.syncBodyVisibility();
    // ---- Aim: everything the weapon's `ads` block drives -------------------
    // One rate for the whole pose so the gun arrives together, and the weapon
    // owns it — a sniper comes up slower than an SMG. Tuned in /chartest.html.
    const aim = this.ads;
    const ads = this.weapon.def.ads || ADS_DEFAULT;
    const k = Math.min(1, dt * (ads.speed || ADS_DEFAULT.speed));

    // Third person aims by moving the camera, not by zooming — see the boom.
    const targetFov = (aim && !this.thirdPerson) ? this.weapon.def.adsFov : HIP_FOV;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
    // Look speed follows the zoom, so `sens` is a per-weapon feel nudge and 1.0
    // is already right at every magnification — no hand-picked ADS constant.
    // With no zoom to follow, third-person ADS needs that slowdown stated.
    this.lookSens = HIP_SENS * (aim ? (ads.sens ?? 1) : 1) *
      (this.thirdPerson ? 1 + (P.thirdPerson.ads.sens - 1) * this.tpAds : 1) *
      Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / TAN_HIP;

    // ---- Viewmodel pose/bob/recoil ----
    if (moving && this.onGround) this.bobTime += dt * (this.sprinting ? 11 : 7.5);
    const bobA = aim ? 0.004 : 0.012;
    const base = aim ? ads.pos : HIP_POS;
    const vx = base[0] + Math.sin(this.bobTime) * bobA;
    const vy = base[1] + Math.abs(Math.cos(this.bobTime)) * bobA;
    this.viewmodel.position.x += (vx - this.viewmodel.position.x) * k;
    this.viewmodel.position.y += (vy - this.viewmodel.position.y) * k;
    this.vmZ += (base[2] - this.vmZ) * k;
    this.recoil = Math.max(0, this.recoil - dt * 3);
    this.viewmodel.position.z = this.vmZ + this.recoil * 0.06;
    const rot = aim ? ads.rot : ZERO3;
    this.vmRot.x += (rot[0] - this.vmRot.x) * k;
    this.vmRot.y += (rot[1] - this.vmRot.y) * k;
    this.vmRot.z += (rot[2] - this.vmRot.z) * k;
    // `swing` drops the gun out of frame and rolls it while a throw or a bash
    // is playing — it stands in for the animation, and it also reads as the
    // reason you cannot shoot during one.
    this.viewmodel.position.y -= this.swing * 0.22;
    this.viewmodel.position.z += this.swing * 0.10;
    this.viewmodel.rotation.set(
      this.vmRot.x + this.recoil * 0.12 - this.swing * 0.55,
      this.vmRot.y,
      this.vmRot.z + this.swing * 0.35,
    );
    this.vmScale += ((aim ? (ads.scale ?? 1) : 1) - this.vmScale) * k;
    this.viewmodel.scale.setScalar(this.vmScale);
    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 22);
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 110);

    this._updateGadgets(dt);
    this._updateActions(dt);
    this._updateWeapon(dt, moving, speed);

    const w = this.weapon;
    this.game.hud.setAmmo(w.mag, w.reserve);
    this.game.hud.setGadgets(this.gadgets, this.grenade); // no-op unless changed
    if (this.ammoDisplay) this.ammoDisplay.set(w.mag); // no-op unless changed
    this.prevFiring = this.firing;
  }

  _updateWeapon(dt, moving, speed) {
    const w = this.weapon;
    const def = w.def;

    // Hands busy — injecting, throwing or swinging. Bleed the fire timer down
    // so the gun is ready the instant the lockout ends rather than adding a
    // second delay on top of it.
    if (this.actionBusy()) {
      this.fireTimer -= dt;
      return;
    }

    // Reload
    if (w.reloading) {
      w.reloadTimer -= dt;
      if (w.reloadTimer <= 0) {
        const need = def.mag - w.mag;
        const take = Math.min(need, w.reserve);
        w.mag += take;
        w.reserve -= take;
        w.reloading = false;
        this.game.hud.setReloading(false);
      }
      return;
    }

    this.fireTimer -= dt;
    this.heat = Math.max(0, this.heat - dt * 0.06);

    const trigger = this.firing && this.locked;
    const triggerEdge = trigger && !this.prevFiring;

    // finish an in-flight burst regardless of trigger
    if (def.mode === 'burst' && w.burstLeft > 0) {
      if (this.fireTimer <= 0) {
        this._dischargeRound(moving, speed);
        w.burstLeft--;
        this.fireTimer = w.burstLeft > 0 ? def.burstInterval : 60 / def.rpm;
      }
      return;
    }

    if (def.mode === 'charge') {
      if (trigger && w.mag > 0 && this.fireTimer <= 0) {
        w.chargeT += dt;
        this.flash.material.opacity = Math.min(0.5, w.chargeT / def.chargeTime * 0.5);
        if (w.chargeT >= def.chargeTime) {
          this._dischargeRound(moving, speed);
          w.chargeT = 0;
          this.fireTimer = 60 / def.rpm;
        }
      } else if (!trigger) {
        w.chargeT = 0;
      }
      if (triggerEdge && w.mag <= 0) this._dryFire();
      return;
    }

    if (this.fireTimer > 0) return;

    const wants =
      def.mode === 'auto' ? trigger :
      triggerEdge; // semi / pump / projectile / burst-start

    if (!wants) return;

    if (w.mag <= 0) {
      this._dryFire();
      return;
    }

    if (def.mode === 'burst') {
      w.burstLeft = def.burst;
      // first round leaves immediately
      this._dischargeRound(moving, speed);
      w.burstLeft--;
      this.fireTimer = def.burstInterval;
      return;
    }

    this._dischargeRound(moving, speed);
    this.fireTimer = 60 / def.rpm;
  }

  _dryFire() {
    this.game.audio.playUI('empty');
    this.fireTimer = 0.25;
    if (this.weapon.reserve > 0) this.startReload();
  }

  _dischargeRound(moving, speed) {
    const w = this.weapon;
    const def = w.def;
    w.mag--;

    let spread = this.ads ? def.spreadAds : def.spreadHip;
    if (moving) spread += 0.02 * (speed / P.speed) * (this.ads ? 0.4 : 1);
    if (this.crouching) spread *= 0.65;
    spread += this.heat;
    this.heat = Math.min(0.04, this.heat + 0.004);

    this.camera.getWorldDirection(_dir);
    _from.copy(this.camera.position).addScaledVector(_dir, 0.3);
    // Aim stays on the camera ray — the crosshair must keep telling the truth —
    // but the round is drawn leaving the barrel. `_muzzle` is only ever read
    // here, so it is safe to hand to a function that does not write it.
    let muzzle = this.vmMuzzle ? this.vmMuzzle.getWorldPosition(_muzzle) : _from;

    if (this.thirdPerson) {
      // The viewmodel is hidden, so the visible gun is the body's — and the
      // camera sits metres behind and to one side of it. Sending the round
      // along the camera's forward from there would land it well off the
      // crosshair, worse the closer the target is. So: find what the crosshair
      // covers, then aim the round from the barrel at that point. Cover between
      // the muzzle and the target now blocks the shot even when the camera can
      // see over it, which is correct and is the one behaviour that differs
      // from first person.
      muzzle = this.soldier.muzzlePos(_muzzle);
      this.game.combat.aimPoint(this.soldier, _from, _dir, def.range, _aim);
      _dir.subVectors(_aim, muzzle).normalize();
      _from.copy(muzzle);
    }

    if (def.mode === 'projectile') {
      // A rocket is a visible object with travel time, so spawning it at the
      // eye instead of the tube is far more obvious than a tracer doing it.
      this.game.combat.fireRocket(this.soldier, muzzle.clone(), _dir.clone(), def);
    } else {
      this.game.combat.firePlayerShot(_from, _dir, def, spread, muzzle);
      this.game.audio.playShot(def);
    }

    const kick = def.dmg >= 50 ? 1.9 : def.mode === 'pump' ? 1.6 : def.mode === 'projectile' ? 1.6 : 1;
    this.recoil = Math.min(1.6, this.recoil + 0.35 * kick);
    this.pitch += (0.0035 + Math.random() * 0.002) * kick;
    this.flash.material.opacity = 0.75 + Math.random() * 0.25; // flicker
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    this.flash.scale.setScalar(0.25 + Math.random() * 0.2);
    this.muzzleLight.intensity = 6 + Math.random() * 4;

    if (w.mag <= 0 && w.reserve > 0) this.startReload();
  }

  // Scope screens need their own pass, before the main render. Skipped whenever
  // the gun is not actually on screen (dead, freecam, map view).
  renderScope(renderer, scene) {
    if (!this.scopeDisplay || this.freecam || !this.viewmodel.visible) return;
    // Soldiers are the cullable bulk — 64 of them, all with frustum culling
    // disabled, so the scope has to reject them itself.
    this.scopeDisplay.render(renderer, scene, this.camera, this.game.allSoldiers);
  }

  // Pull the camera back onto a boom behind the eye. The rotation set by
  // `update` is left alone, so aiming, movement and `s.yaw` behave exactly as
  // they do in first person — only the eye point moves.
  _applyBoom(dt) {
    const TP = P.thirdPerson;
    // Aiming slides the whole rig over the shoulder rather than zooming. The
    // weapon owns the rate, the same one the first-person pose uses.
    const adsDef = this.weapon.def.ads || ADS_DEFAULT;
    const target = this.ads ? 1 : 0;
    this.tpAds += (target - this.tpAds) * Math.min(1, dt * (adsDef.speed || ADS_DEFAULT.speed));
    const a = this.tpAds;
    const dist = TP.dist + (TP.ads.dist - TP.dist) * a;
    const shoulder = TP.shoulder + (TP.ads.shoulder - TP.shoulder) * a;
    const lift = TP.lift + (TP.ads.lift - TP.lift) * a;

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;   // camera forward
    const rx = cy, rz = -sy;                       // camera right
    const px = this.pos.x + rx * shoulder;
    const py = this.pos.y + this.eye + lift;
    const pz = this.pos.z + rz * shoulder;

    let want = dist;
    const col = this.game.world.collision;
    if (col) {
      const hit = col.rayDistance(px, py, pz, -fx, -fy, -fz, dist + TP.skin);
      if (hit !== null) want = Math.max(TP.minDist, hit - TP.skin);
    }
    // Pull in the instant something is in the way, ease back out once it is
    // clear: easing inward would let the camera sit inside the wall meanwhile.
    if (want < this.tpDist) this.tpDist = want;
    else this.tpDist += (want - this.tpDist) * Math.min(1, dt * TP.lerp);

    const cx = px - fx * this.tpDist;
    const cz = pz - fz * this.tpDist;
    let cyy = py - fy * this.tpDist;
    // Wall shells only exist on authored maps; the heightfield catches the rest.
    const floor = this.game.world.heightAt(cx, cz) + 0.35;
    if (cyy < floor) cyy = floor;
    this.camera.position.set(cx, cyy, cz);
  }

  updateFreecam(dt) {
    let mx = 0, mz = 0, my = 0;
    if (this.keys['KeyW']) mz += 1;
    if (this.keys['KeyS']) mz -= 1;
    if (this.keys['KeyA']) mx -= 1;
    if (this.keys['KeyD']) mx += 1;
    if (this.keys['Space']) my += 1;
    if (this.keys['KeyC'] || this.keys['ControlLeft']) my -= 1;
    let speed = this.fcSpeed;
    if (this.keys['ShiftLeft']) speed *= 3.5;

    const sin = Math.sin(this.fcYaw), cos = Math.cos(this.fcYaw);
    const cp = Math.cos(this.fcPitch), sp = Math.sin(this.fcPitch);
    const fx = -sin * cp, fy = sp, fz = -cos * cp;
    const rx = cos, rz = -sin;
    this.fcPos.x += (fx * mz + rx * mx) * speed * dt;
    this.fcPos.y += (fy * mz + my) * speed * dt;
    this.fcPos.z += (fz * mz + rz * mx) * speed * dt;
    this.fcPos.y = Math.max(this.fcPos.y, this.game.world.heightAt(this.fcPos.x, this.fcPos.z) + 0.5);

    this.camera.position.copy(this.fcPos);
    this.camera.rotation.set(this.fcPitch, this.fcYaw, 0, 'YXZ');
    if (Math.abs(this.camera.fov - HIP_FOV) > 0.1) {
      this.camera.fov = HIP_FOV;
      this.camera.updateProjectionMatrix();
    }
  }
}
