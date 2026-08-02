// First-person controller: pointer lock, movement, class loadout with two
// weapons (auto/burst/semi/pump/projectile/charge fire modes), freecam.

import * as THREE from 'three';
import { CFG, WEAPONS, CLASSES, GADGETS, GRENADES, MELEE, BIOFOAM, BEACON, FP_DEFAULT, ADS_DEFAULT } from './config.js';
import { weaponSlotGadget, classPerk } from './loadout.js';
import { createAmmoDisplay } from './ammodisplay.js';
import { createScopeDisplay, tagViewmodelLayer, VIEWMODEL_LAYER } from './scopedisplay.js';
import { findMuzzle } from './soldier.js';

const P = CFG.player;
const D = CFG.downed;
const ST = CFG.stamina;
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _aim = new THREE.Vector3();
// Driving scratch
const _exit = new THREE.Vector3();
const _seat = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _drive = new THREE.Quaternion();
const _lookPitch = new THREE.Quaternion();
const _YAXIS = new THREE.Vector3(0, 1, 0);
const _XAXIS = new THREE.Vector3(1, 0, 0);

// Hip reference pose for the viewmodel holder. Aiming moves the holder to the
// weapon's own `ads.pos` — the transform that puts that weapon's sight on the
// crosshair — instead of the one slide-to-centre that used to serve every gun.
const HIP_POS = [0.28, -0.24, -0.55];
const HIP_FOV = 75;
const HIP_SENS = 0.0021;
const TAN_HIP = Math.tan(THREE.MathUtils.degToRad(HIP_FOV) / 2);
const ZERO3 = [0, 0, 0];

// A third held slot, past the two weapons. It is NOT a third weapon: nothing
// cycles into it, the armoury cannot put anything in it, and what lands here is
// whatever tool the loadout's gadgets grant. Named rather than written as a bare
// 2 because `1 - this.active` is the two-gun toggle all over this file, and a
// magic index would make every one of those sites ambiguous.
const TOOL_SLOT = 2;

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
    // A tool carries heat where a gun carries a magazine. Both live on the same
    // state object on purpose: `this.weapon` is read from a dozen places and
    // none of them should have to ask which kind of thing is in the hands.
    heat: 0,        // 0..1, full is an overheat
    vented: false,  // overheated — locked out until heat is back to zero
    idle: 0,        // seconds since the beam last ran, against tool.ventDelay
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
  };
}

// Biofoam is not a gadget — every soldier carries it and nobody spends a slot
// on it. Support's larger ration is the class's logistical identity, set in one
// place (BIOFOAM.perClass) rather than as a class field.
function mkBiofoamState(cls) {
  return {
    def: BIOFOAM,
    charges: (BIOFOAM.perClass && BIOFOAM.perClass[cls]) || BIOFOAM.count,
    useTimer: 0,
    cooldown: 0,
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
    this.sprinting = false; // Shift is down and the boost is legal to ask for
    // The exhaust latch lives on the SOLDIER (`soldier.exhausted`), not here:
    // bots latch too, and the HUD already reads the body rather than the
    // controller. Holding Shift does nothing while it is set.
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
    this.biofoam = null;    // universal, not a gadget — see mkBiofoamState
    // The rally beacon. Not in `gadgets` and not rebuilt by applyLoadout: the
    // ability comes from LEADING a squad, not from the kit, so its state has to
    // outlive loadout changes — and its cooldown deliberately outlives death
    // too. Planting one is a squad-level decision, and a leader who could reset
    // the timer by dying would be taught to do exactly that.
    this.rally = { def: BEACON, useTimer: 0, cooldown: 0, pendingPlace: false };
    this.grenade = null;    // { def, count, useTimer, cooldown, released }
    this.melee = null;      // { def, useTimer, cooldown, struck }
    this.swing = 0;         // 0..1 viewmodel dip, drives throw and bash motion
    this.active = 0;
    // Which GUN to come back to when the tool is stowed. Without it, putting the
    // tool away would always drop you on the primary, silently undoing a switch
    // you made before you drew it.
    this.lastGun = 0;
    this.repairTarget = null; // who the beam is currently working on, if anyone
    this.switchTimer = 0;
    this.fireTimer = 0;
    this.firing = false;
    this.prevFiring = false;
    this.heat = 0;

    this.keys = {};
    this.locked = false;

    // Casualty recovery. `reviving` counts as hands-busy (see actionBusy), so
    // holding E over a body locks the gun exactly as an injection does.
    this.reviving = false;
    this.reviveTarget = null;
    this.giveUpHeld = 0;    // seconds SPACE has been held while downed
    // Supply crates share the interact key with casualty pickups.
    this.drawing = false;
    this.drawTimer = 0;
    this.supplyCrate = null;

    // Input ownership. Listeners live on `document`, so every Player that
    // exists is handling every event — fine while there was only ever one, but
    // a second host (lobby roam) needs to hand the keyboard back and forth.
    // Nothing tore these down before either; dispose() closes that leak.
    this.enabled = true;
    this._listeners = [];

    // Driving. `vehicle` is the whole state — being in one is not a mode flag
    // plus a reference that can disagree with it. While it is set, `update`
    // hands over to `_updateDriving` and the camera is owned by
    // `updateVehicleCamera`, which runs AFTER the sim step (see game.update).
    this.vehicle = null;
    this.exitCooldown = 0;   // stops one E press exiting the car it just entered

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
        if (e.code === 'KeyX') this.useBiofoam();   // universal, not a slot
        if (e.code === 'KeyB') this.placeBeacon();  // leader's, not a slot
        if (e.code === 'Digit6') this.drawTool();   // carried kit, not a slot
        if (e.code === 'KeyQ') this.switchWeapon(this._cycleTarget());
      }
    });
    this._on(document, 'keyup', (e) => { this.keys[e.code] = false; });
    this._on(document, 'wheel', (e) => {
      if (this.game.menuOpen) return;
      if (this.freecam) {
        this.fcSpeed = Math.max(5, Math.min(200, this.fcSpeed * (e.deltaY > 0 ? 0.8 : 1.25)));
      } else if (this.locked) {
        this.switchWeapon(this._cycleTarget());
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
    // Hidden while driving even in third person: the body has no seated pose
    // yet, so it would stand upright through the roll cage. Phase 5 gives it
    // one and drops the last term.
    s.mesh.visible = (s.alive || s.downed) && (this.freecam || this.thirdPerson) && !this.vehicle;
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
    // Either weapon slot's upgrade may carry a penalty; today only the webbing
    // does, but checking both means a future primary-upgrading kit gets it for
    // free rather than silently skipping the cost.
    for (const which of ['primary', 'secondary']) {
      const g = weaponSlotGadget(this.loadout, which);
      if (g && g.reserveMult) w.reserve = Math.round(w.reserve * g.reserveMult);
    }
    return w;
  }

  applyLoadout(loadout) {
    this.loadout = loadout;
    this.weapons = [mkWeaponState(loadout.primary), mkWeaponState(loadout.secondary)]
      .map((w) => this._applyReservePenalty(w));
    // The third hand slot, empty unless a gadget grants a tool. `null` rather
    // than absent so `weapons[TOOL_SLOT]` is a question every path can ask.
    this.weapons[TOOL_SLOT] = null;
    const held = this._heldToolKey(loadout);
    if (held) this.weapons[TOOL_SLOT] = mkWeaponState(held);
    this.lastGun = 0;
    this.gadgets = (loadout.gadgets || []).map(mkGadgetState);
    this.biofoam = mkBiofoamState(loadout.cls);
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

  // Which WEAPONS entry, if any, this loadout puts in the tool slot. Two paths
  // reach it and both are legitimate: a tool taken in a utility slot, and the
  // Engineer's, which the perk grants for free and which is therefore absent
  // from `loadout.gadgets` entirely. Grants are checked first so a class that
  // carries one by perk never depends on the slot it was removed from.
  _heldToolKey(lo) {
    const perk = classPerk(lo.cls);
    for (const key of [...((perk && perk.grants) || []), ...(lo.gadgets || [])]) {
      const g = GADGETS[key];
      if (g && g.kind === 'tool' && g.held && WEAPONS[g.held]) return g.held;
    }
    return null;
  }

  // Q and the mouse wheel toggle between the two GUNS. The tool is drawn from
  // its own slot key and never cycled into — from the tool, "cycle" can only
  // sensibly mean "put it away", which is what returning `lastGun` does.
  _cycleTarget() {
    return this.active === TOOL_SLOT ? this.lastGun : 1 - this.active;
  }

  switchWeapon(i) {
    if (i === this.active || !this.weapons[i]) return;
    if (this.actionBusy()) return;          // hands occupied
    const w = this.weapon;
    w.reloading = false;
    w.burstLeft = 0;
    w.chargeT = 0;
    // Stowing a tool kills its beam with it. A beam still drawing off a tool
    // that is no longer in the player's hands is the kind of bug that survives
    // for weeks, because nothing else about the frame looks wrong.
    if (w.def.tool) w.idle = 0;
    this.game.hud.setReloading(false);
    if (this.active !== TOOL_SLOT) this.lastGun = this.active;
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
    return this.gadgets.some((g) => g && g.useTimer > 0)
      || !!(this.biofoam && this.biofoam.useTimer > 0);
  }

  // Any hands-busy action: injecting, throwing, or swinging. Firing, reloading
  // and swapping all check this — you get one of them at a time, and that
  // exclusivity is what stops a grenade from being free.
  actionBusy() {
    return this.gadgetBusy()
      || this.reviving
      || this.drawing
      || !!(this.grenade && this.grenade.useTimer > 0)
      || !!(this.melee && this.melee.useTimer > 0)
      || this.rally.useTimer > 0;
  }

  // Which system owns a placeable. `crate` and `wall` are the two shapes one
  // comes in, and the def says which — so a third kind of placeable is a config
  // entry plus a module, never a branch on a gadget's NAME.
  _placeSystem(def) {
    if (def.crate) return this.game.supply;
    if (def.wall || def.beacon) return this.game.structures;
    return null;
  }

  // ------------------------------------------------- Squad leader ability --
  // The rally beacon. Same committed-action shape as biofoam and the wall — pay
  // a lockout, the thing lands at the end of it — with one difference that is
  // the whole feature: the gate is not a charge or a class, it is whether you
  // are currently your squad's leader. That is checked live rather than cached,
  // because leadership moves the instant its holder goes down.
  placeBeacon() {
    if (this.freecam) return;
    const s = this.soldier;
    if (!s || !s.alive) return;
    const squad = s.squad;
    if (!squad) { this.game.hud.message('RALLY BEACON — NO SQUAD', 1.5); return; }
    if (squad.leader !== s) {
      // Names the current leader rather than just refusing: "not yours" is a
      // rule, "Bravo-2 has it" is a fact you can do something about.
      const who = squad.leader ? squad.leader.name : 'NOBODY';
      this.game.hud.message(`RALLY BEACON — ${who.toUpperCase()} LEADS ${squad.name.toUpperCase()}`, 2);
      return;
    }
    if (this.actionBusy()) return;
    if (this.rally.cooldown > 0) {
      this.game.hud.message(`RALLY BEACON — ${Math.ceil(this.rally.cooldown)}S`, 1.5);
      return;
    }
    this.rally.useTimer = BEACON.useTime;
    this.rally.pendingPlace = true;
    this._cancelWeaponAction();
  }

  _updateRally(dt) {
    const r = this.rally;
    if (r.cooldown > 0) r.cooldown = Math.max(0, r.cooldown - dt);
    if (r.useTimer <= 0) return;
    r.useTimer -= dt;
    if (r.useTimer > 0) return;
    r.useTimer = 0;
    if (!r.pendingPlace) return;
    r.pendingPlace = false;

    // Dying mid-plant loses it. The lockout is the commitment and you did not
    // survive it — no beacon, and no cooldown either, because you never got the
    // thing the cooldown pays for.
    const s = this.soldier;
    if (!s || !s.alive || s.squad !== this.game.playerSquad || !s.squad) return;

    const made = this.game.structures.place(s, BEACON);
    if (made) {
      // Charged only on success, the same principle as the wall's refund: a
      // placement refused by a rule you were never shown is the game's mistake.
      r.cooldown = CFG.beacon.cooldown;
      this.game.hud.message(`RALLY BEACON — ${s.squad.name.toUpperCase()} SPAWNS HERE`, 2.5);
    } else {
      this.game.hud.message(`RALLY BEACON — ${this.game.structures.lastRefusal || 'NO ROOM'}`, 2);
    }
  }

  // Slot gadgets. Most of the pool is still declared rather than implemented —
  // the `built` guard is what keeps an unfinished gadget from half-working
  // rather than obviously doing nothing.
  useGadget(i) {
    const g = this.gadgets[i];
    if (!g || this.freecam) return;
    const s = this.soldier;
    if (!s || !s.alive) return;
    if (g.def.kind === 'weaponSlot') return;   // spent at the armoury, not in play
    if (!g.def.built) { this.game.hud.message(`${g.def.name} — NOT IMPLEMENTED`, 1.5); return; }
    if (this.actionBusy() || g.cooldown > 0) return;
    // A tool is EQUIPMENT, not a charge. Its slot key DRAWS it and pressing
    // again stows it — nothing below this line applies, because there is no
    // lockout to pay and nothing to spend. Having it in your hands, and giving
    // up your rifle to do it, is the whole of the cost.
    if (g.def.kind === 'tool') { this.toggleTool(g.def); return; }
    if (g.charges <= 0) { this.game.hud.message(`${g.def.name} — EMPTY`, 1.5); return; }
    g.charges--;
    g.useTimer = g.def.useTime || 0;
    // Placed at the END of the lockout, the same shape biofoam uses: the
    // commitment is paid before the thing exists. Flagged rather than dropped
    // here so `_updateGadgets` stays the single place a lockout resolves.
    if (g.def.kind === 'placeable' && this._placeSystem(g.def)) g.pendingPlace = true;
    this._cancelWeaponAction();
  }

  // Draw the tool, or put it away. Routed through switchWeapon rather than
  // writing `active` here, so a tool draw pays the same swap time, cancels the
  // same reload and honours the same hands-busy rule as reaching for a sidearm.
  //
  // Two keys reach this, and both have to, because there are two ways to be
  // carrying a tool. A class that SPENDS a utility slot on one reaches it by
  // that slot's number key. The Engineer's is a PERK grant and occupies no slot
  // at all — so without a key of its own, the one class the tool was designed
  // around would be the one class unable to draw it. 6 is that key, on the same
  // principle as biofoam on X and the beacon on B: universal kit gets a key,
  // not a slot.
  drawTool() {
    if (!this.weapons[TOOL_SLOT]) {
      this.game.hud.message('NO TOOL CARRIED', 1.5);
      return;
    }
    if (this.actionBusy() || this.freecam) return;
    this.switchWeapon(this.active === TOOL_SLOT ? this.lastGun : TOOL_SLOT);
  }

  toggleTool(def) {
    const t = this.weapons[TOOL_SLOT];
    // A gadget slot can name a tool this loadout never resolved a model for.
    // Say so rather than eating the keypress — a key that does nothing at all
    // reads as a broken control.
    if (!t || (def.held && t.key !== def.held)) {
      this.game.hud.message(`${def.name} — NOT CARRIED`, 1.5);
      return;
    }
    this.drawTool();
  }

  // Biofoam. Universal, on its own key, and the same shape as every other
  // committed action: pay a lockout, and the heal lands after it.
  useBiofoam() {
    const b = this.biofoam;
    if (!b || this.freecam) return;
    const s = this.soldier;
    // No self-revive. Three charges would otherwise be three free self-pickups
    // and the recovery system would never fire — the charge is what you spend
    // on other people.
    if (s && s.downed) { this.game.hud.message('BIOFOAM — CANNOT REACH IT', 1.5); return; }
    if (!s || !s.alive) return;
    if (this.actionBusy() || b.cooldown > 0) return;
    if (b.charges <= 0) { this.game.hud.message('BIOFOAM — EMPTY', 1.5); return; }
    if (s.health >= CFG.soldier.health) {
      this.game.hud.message('BIOFOAM — NOT INJURED', 1.5);
      return;
    }
    b.charges--;
    b.useTimer = b.def.useTime;
    this._cancelWeaponAction();
    this.game.hud.message(`BIOFOAM — ${b.charges} LEFT`, 1.5);
  }

  _updateGadgets(dt) {
    for (const g of this.gadgets) {
      if (!g) continue;
      if (g.cooldown > 0) g.cooldown = Math.max(0, g.cooldown - dt);
      if (g.useTimer > 0) {
        g.useTimer -= dt;
        if (g.useTimer <= 0) {
          g.useTimer = 0;
          g.cooldown = g.def.cooldown || 0;
          if (g.pendingPlace) {
            g.pendingPlace = false;
            const sys = this._placeSystem(g.def);
            const made = sys && sys.place(this.soldier, g.def);
            if (made) {
              this.game.hud.message(`${g.def.name} DEPLOYED`, 2);
            } else {
              // Refunded, because placement is blind: the charge was spent
              // before anyone could see whether the spot was legal, so losing
              // it to a rule you were not shown is the game's mistake and not
              // the player's. The lockout is still paid, which is the part that
              // was actually a decision. A ghost preview would make this branch
              // unreachable and the refund pointless — which is the argument
              // for building one.
              g.charges++;
              const why = (sys && sys.lastRefusal) || 'NO ROOM';
              this.game.hud.message(`${g.def.name} — ${why}`, 2);
            }
          }
        }
      }
    }

    const b = this.biofoam;
    const s = this.soldier;
    if (!b) return;
    if (b.cooldown > 0) b.cooldown = Math.max(0, b.cooldown - dt);
    if (b.useTimer > 0) {
      b.useTimer -= dt;
      // The injection lands at the END of the lockout, not the start — the
      // commitment has to be paid before the reward arrives.
      if (b.useTimer <= 0) {
        b.useTimer = 0;
        b.healLeft = b.def.heal || 0;
        b.cooldown = b.def.cooldown || 0;
      }
    }
    // Heal flows over time and does NOT lock you down — you are free to move
    // and shoot while it works. Only the injection itself costs you tempo.
    if (b.healLeft > 0 && s && s.alive) {
      const step = Math.min(b.healLeft, (b.def.healRate || 0) * dt);
      const room = CFG.soldier.health - s.health;
      s.health += Math.min(step, Math.max(0, room));
      b.healLeft -= step;
      if (room <= 0) b.healLeft = 0;  // topped out; the rest is wasted
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
    // A tool has no magazine, so every test below reads `undefined` and passes.
    // Heat is what bounds it — see _updateTool.
    if (w.def.tool) return;
    if (w.reloading || w.mag >= w.def.mag || w.reserve <= 0) return;
    w.reloading = true;
    w.reloadTimer = w.def.reload;
    w.chargeT = 0;
    this.game.audio.playUI('reload');
    this.game.hud.setReloading(true);
  }

  // Downed. The camera drops to the ground and you can look around — that is
  // the whole verb. No movement, no weapon, no gadgets, and the only input left
  // is the decision to stop waiting. Deliberately NOT part of `update`: that
  // method owns the eye height, the collision push and the weapon state, and
  // all three are wrong for a body on the floor.
  updateDowned(dt) {
    const s = this.soldier;
    this.firing = false;
    this.ads = false;
    this.reviving = false;
    s.reviving = false;
    this.reviveTarget = null;
    this.eye += (D.camHeight - this.eye) * Math.min(1, dt * 6);
    this.pos.copy(s.pos);
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.lookSens = HIP_SENS;
    if (Math.abs(this.camera.fov - HIP_FOV) > 0.1) {
      this.camera.fov = HIP_FOV;
      this.camera.updateProjectionMatrix();
    }
    this.syncBodyVisibility();

    // The two things a casualty can still do, held on screen the whole time
    // rather than flashed once as a message — sixty seconds is long enough to
    // forget what the keys were.
    if (this.keys['KeyE'] && this.locked && s.callForHelp()) {
      this.game.audio.playUI('callHelp');
    }
    const call = s.callTimer > 0;
    this.game.hud.setPrompt(
      call ? 'CALLING FOR HELP · HOLD SPACE — GIVE UP' : 'E — CALL FOR HELP · HOLD SPACE — GIVE UP',
      call ? s.callTimer / D.callTime : 0,
    );

    // Hold, not tap. Giving up is irreversible, and a stray keypress should not
    // spend sixty seconds that someone might still be running to answer.
    if (this.keys['Space'] && this.locked) {
      this.giveUpHeld += dt;
      if (this.giveUpHeld >= D.giveUpHold) {
        this.giveUpHeld = 0;
        s.die(s.downedBy);
      }
    } else {
      this.giveUpHeld = 0;
    }
  }

  // Hold E over a downed teammate. The charge is spent on completion, so an
  // attempt broken off — by gunfire, by walking away, by the casualty bleeding
  // out under your hands — costs only the time.
  // E is the one interact key, and two things now answer to it. Casualties win:
  // a crate will still be there in ten seconds and a bleeding squadmate will
  // not, so a body in reach suppresses the crate prompt entirely rather than
  // the two competing for the same keypress.
  _updateInteract(dt) {
    if (this._nearestCasualty()) {
      this.drawTimer = 0;
      this._updateRevive(dt);
      return;
    }
    this._updateRevive(dt);          // clears revive state and the prompt
    if (this._updateVehiclePrompt()) return;
    this._updateSupply(dt);
  }

  // A vehicle in reach owns the interact key ahead of a crate, on exactly the
  // rule casualties use against both: the crate will still be there in ten
  // seconds. Returns true when it has claimed the prompt.
  _updateVehiclePrompt() {
    if (this.vehicle || this.exitCooldown > 0 || this.freecam) return false;
    const fleet = this.game.vehicles;
    const v = fleet && fleet.nearest(this.pos);
    if (!v) return false;
    if (v.driver) {
      this.game.hud.setPrompt('WARTHOG — SEAT TAKEN', 0);
      return true;
    }
    this.game.hud.setPrompt('E — DRIVE WARTHOG', 0);
    if (this.keys['KeyE'] && this.locked && !this.actionBusy()) this.enterVehicle(v);
    return true;
  }

  _updateRevive(dt) {
    this.reviving = this._stepRevive(dt);
    // The third-person body kneels over the casualty, and the first-person
    // hands put the rifle away — without the second half, a pickup in first
    // person is a rifle held steady at nothing for five seconds.
    //
    // This is now the per-frame writer for both, which is why it recomputes the
    // camera-mode terms rather than just toggling: setFreecam/setThirdPerson
    // also write `viewmodel.visible`, and the two must not disagree.
    this.soldier.reviving = this.reviving;
    this.viewmodel.visible = !this.reviving && !this.freecam && !this.thirdPerson;
  }

  // Returns whether the player is working on a casualty this frame. Split out
  // so every early exit still lands on the single writer above.
  _stepRevive(dt) {
    const t = this._nearestCasualty();
    this.reviveTarget = t;
    if (!t) {
      this.game.hud.setPrompt(null);
      return false;
    }
    const b = this.biofoam;
    if (!b || b.charges <= 0) {
      this.game.hud.setPrompt(`${t.name} DOWN — NO BIOFOAM`, 0);
      return false;
    }
    // `reviving` gates firing through actionBusy, so it must not latch on when
    // the hands are already committed to something else.
    const holding = !!this.keys['KeyE'] && this.locked && !this.freecam
      && !this.gadgetBusy() && !(this.grenade && this.grenade.useTimer > 0)
      && !(this.melee && this.melee.useTimer > 0);
    if (holding && t.applyRevive(this.soldier, dt)) {
      b.charges -= BIOFOAM.reviveCost;
      this.game.hud.setPrompt(null);
      this.game.hud.message(`BIOFOAM — ${b.charges} LEFT`, 1.5);
      return false;                       // done: hands back on the rifle
    }
    this.game.hud.setPrompt(
      holding ? `PICKING UP ${t.name}` : `HOLD E — PICK UP ${t.name}`,
      holding ? t.reviveProgress : 0,
    );
    return holding;
  }

  // Drawing from a supply crate. Hold E, the bar fills, one draw comes out and
  // the crate's pool drops by that much. Releasing loses the partial hold —
  // same rule as a pickup, and for the same reason: the cost of an interrupted
  // interaction should be the time, not a wasted resource.
  _updateSupply(dt) {
    const sup = this.game.supply;
    const s = this.soldier;
    if (!sup || !s || !s.alive) { this.drawing = false; this.drawTimer = 0; return; }
    const crate = sup.nearest(this.pos, s.team);
    this.supplyCrate = crate;
    if (!crate) { this.drawing = false; this.drawTimer = 0; return; }

    const cd = crate.def.crate;
    const holding = !!this.keys['KeyE'] && this.locked && !this.freecam && !this.gadgetBusy()
      && !(this.grenade && this.grenade.useTimer > 0)
      && !(this.melee && this.melee.useTimer > 0);
    // Offer the crate even when you cannot use it, and say why. A player
    // standing on a full crate with nothing happening will assume it is broken.
    const need = this._supplyNeed(cd);
    if (!need) {
      this.drawing = false;
      this.drawTimer = 0;
      this.game.hud.setPrompt(`${cd.label} CRATE — ${crate.pool} LEFT · FULL`, 0);
      return;
    }
    this.drawing = holding;
    if (holding) {
      this.drawTimer += dt;
      if (this.drawTimer >= CFG.crate.drawTime) {
        this.drawTimer = 0;
        const got = sup.draw(crate);
        if (got > 0) this._takeSupply(cd, got);
      }
    } else {
      this.drawTimer = 0;
    }
    this.game.hud.setPrompt(
      holding ? `TAKING ${cd.label}` : `HOLD E — ${cd.label} CRATE (${crate.pool} LEFT)`,
      holding ? this.drawTimer / CFG.crate.drawTime : 0,
    );
  }

  // Is there anything this crate can actually give us right now?
  _supplyNeed(cd) {
    if (cd.give === 'biofoam') {
      const b = this.biofoam;
      return !!b && b.charges < ((BIOFOAM.perClass && BIOFOAM.perClass[this.loadout.cls]) || BIOFOAM.count);
    }
    if (this.weapons.some((w) => w && w.reserve < this._reserveCap(w))) return true;
    return !!(this.grenade && this.grenade.count < this.grenade.def.count);
  }

  // The reserve ceiling for a weapon slot, honouring any gadget penalty — the
  // same rule `_applyReservePenalty` applies at spawn. A webbing build's "full"
  // is 0.6x everyone else's, and a crate must not quietly undo that by topping
  // it up to the unpenalised maximum.
  _reserveCap(w) {
    let cap = w.def.reserve;
    for (const which of ['primary', 'secondary']) {
      const g = weaponSlotGadget(this.loadout, which);
      if (g && g.reserveMult) cap = Math.round(cap * g.reserveMult);
    }
    return cap;
  }

  // Apply one draw. Reserve ammo only — the magazine in the gun is still yours
  // to reload, so a crate pays for the next firefight rather than winning the
  // one you are in.
  _takeSupply(cd, amount) {
    if (cd.give === 'biofoam') {
      const b = this.biofoam;
      const max = (BIOFOAM.perClass && BIOFOAM.perClass[this.loadout.cls]) || BIOFOAM.count;
      b.charges = Math.min(max, b.charges + amount);
      this.game.hud.message(`BIOFOAM — ${b.charges}`, 2);
    } else {
      for (const w of this.weapons) {
        if (!w) continue;
        const cap = this._reserveCap(w);
        w.reserve = Math.min(cap, w.reserve + Math.round(cap * (cd.reserveFrac ?? 1)));
      }
      if (this.grenade && cd.grenades) {
        this.grenade.count = Math.min(this.grenade.def.count, this.grenade.count + cd.grenades);
      }
      this.game.hud.message('RESUPPLIED', 2);
    }
    this.game.audio.playUI('resupply');
  }

  // Nearest downed teammate in reach. Any teammate, not just the squad — see
  // the casualty recovery section of CLASS_AND_GADGET_PLAN.md.
  _nearestCasualty() {
    if (!D.enabled) return null;
    const s = this.soldier;
    if (!s || !s.alive || this.freecam) return null;
    // The arena/chartest game slice has no `teams` — no sides, no casualties.
    const team = this.game.teams && this.game.teams[s.team];
    if (!team) return null;
    let best = null, bestD = D.reviveRange;
    for (const m of team.soldiers) {
      if (m === s || !m.downed) continue;
      const d = this.pos.distanceTo(m.pos);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  // Spend and refill the sprint pool. The rule itself lives on the soldier —
  // bots run the identical one, and two copies would drift — so this is only
  // the controller's half: which multiplier the player's sprint is worth.
  _stepStamina(dt, boosting, moving) {
    const s = this.soldier;
    if (!s) return P.sprintMult;
    return s.stepStamina(dt, boosting, moving, P.sprintMult);
  }

  // ------------------------------------------------------------- Driving --
  // Getting in and out. `yaw`/`pitch` are reused as CHASSIS-RELATIVE look while
  // driving rather than growing a second pair: every consumer of them
  // (mouselook, sensitivity, the exit heading) wants the same numbers, and two
  // sets would need reconciling on every transition instead of two.
  enterVehicle(v) {
    if (this.vehicle || !v || v.driver) return false;
    this.vehicle = v;
    v.enter(this);
    this.yaw = 0;              // looking straight down the bonnet
    this.pitch = 0;
    this.firing = false;
    this.ads = false;
    this.exitCooldown = 0.4;
    this.viewmodel.visible = false;
    this.game.hud.setPrompt(null);
    this.game.hud.message('E TO GET OUT', 2);
    return true;
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    v.exitPoint(_exit);
    this.vehicle = null;
    v.exit();
    // The relative look becomes an absolute one again, so stepping out leaves
    // you facing where you were looking rather than snapping to a world axis.
    // Same PI as the camera carries — see updateVehicleCamera.
    this.yaw += v.yaw + Math.PI;
    this.pos.copy(_exit);
    this.velY = 0;
    this.onGround = true;
    this.exitCooldown = 0.4;
    this.soldier.pos.copy(this.pos);
    this.game.hud.message(null, 0);
  }

  // Input only. The camera cannot be placed here: the vehicle has not been
  // stepped yet this frame, so anything read off the chassis now is a frame
  // stale — at 25 m/s that is 40 cm of visible judder. See updateVehicleCamera.
  _updateDriving(dt) {
    const v = this.vehicle;
    const s = this.soldier;
    this.exitCooldown = Math.max(0, this.exitCooldown - dt);

    const drive = this.locked && !this.game.menuOpen;
    const fwd = drive && !!this.keys['KeyW'];
    const back = drive && !!this.keys['KeyS'];
    let steer = 0;
    if (drive && this.keys['KeyA']) steer += 1;   // +X is chassis left
    if (drive && this.keys['KeyD']) steer -= 1;

    // S is brake-then-reverse rather than a dedicated key: while there is
    // forward speed to kill it brakes, and only once stopped does it back up.
    // A separate reverse key would be a key nobody presses in a panic.
    const rolling = v.speed > 0.6;
    v.input.throttle = fwd ? 1 : (back && !rolling ? -1 : 0);
    v.input.brake = back && rolling ? 1 : 0;
    v.input.handbrake = drive && !!this.keys['Space'];
    v.input.steer = steer;
    if (fwd || back || steer) v.wake();

    if (drive && this.keys['KeyE'] && this.exitCooldown <= 0) {
      this.exitVehicle();
      return;
    }

    // The body rides in the seat. It stays in `allSoldiers` and stays
    // shootable — a driver is not invulnerable, they are just not walking.
    s.speed2D = 0;
    s.sprinting = false;
    s.crouching = false;
    s.airborne = false;
    s.aiming = false;
    s.setMoveDir(0, 0, 0);
    this.viewmodel.visible = false;
    this.firing = false;
    this.lookSens = HIP_SENS;
  }

  // Camera and seat, AFTER the physics has run. Called from game.update once
  // the sim step is done, which is the only ordering that puts the eye where
  // the vehicle actually ended up this frame.
  updateVehicleCamera(dt) {
    const v = this.vehicle;
    if (!v) return;
    const s = this.soldier;
    v.group.updateMatrixWorld(true);

    // Seat the body and keep the controller's own position with it, so squad
    // follow, objective distance and `playerActive` all track the vehicle.
    const seat = v.refWorld('ref_seat_driver', _seat) || v.group.position;
    this.pos.set(seat.x, seat.y - P.eyeHeight, seat.z);
    s.pos.copy(this.pos);
    s.yaw = v.yaw;

    // Look is relative to the chassis, so the view rolls and pitches with the
    // hog. That coupling IS the vehicle — a camera that stays world-level while
    // the body pitches over a ridge reads as a spectator, not a driver.
    //
    // The PI is not a fudge. A three.js camera looks down its local -Z, and the
    // chassis frame is +Z forward, so handing the camera the chassis
    // orientation aims it out of the tailgate. It is the same offset the
    // infantry path carries as `s.yaw = this.yaw + Math.PI`.
    _drive.setFromAxisAngle(_YAXIS, Math.PI + this.yaw);
    _drive.premultiply(v.quat);
    _drive.multiply(_lookPitch.setFromAxisAngle(_XAXIS, this.pitch));

    if (this.thirdPerson) {
      this._applyVehicleBoom(v, _drive, dt);
    } else {
      const eye = v.refWorld('ref_camera_driver', _eye) || seat;
      this.camera.position.copy(eye);
      this.camera.quaternion.copy(_drive);
    }
    if (Math.abs(this.camera.fov - HIP_FOV) > 0.1) {
      this.camera.fov = HIP_FOV;
      this.camera.updateProjectionMatrix();
    }
    this.syncBodyVisibility();
  }

  // Same shape as the infantry boom (_applyBoom): pull in hard the instant
  // something is behind you, ease back out once it is clear. Its own CFG block
  // because the thing being framed is 6 m long and what you need to see is the
  // ground it is about to hit.
  _applyVehicleBoom(v, lookQuat, dt) {
    const TP = CFG.vehicle.thirdPerson;
    // The view direction is the camera's own -Z; the boom runs the other way.
    _dir.set(0, 0, 1).applyQuaternion(lookQuat);        // away from the view
    const px = v.pos.x, py = v.pos.y + TP.lift, pz = v.pos.z;

    let want = TP.dist;
    const col = this.game.world.collision;
    if (col) {
      const hit = col.rayDistance(px, py, pz, _dir.x, _dir.y, _dir.z, TP.dist + TP.skin);
      if (hit !== null) want = Math.max(TP.minDist, hit - TP.skin);
    }
    if (want < this.tpDist) this.tpDist = want;
    else this.tpDist += (want - this.tpDist) * Math.min(1, dt * TP.lerp);

    const cx = px + _dir.x * this.tpDist;
    const cz = pz + _dir.z * this.tpDist;
    let cy = py + _dir.y * this.tpDist;
    // Clamped against the SAME ground the vehicle drives on, not the raw
    // heightfield. On map-3 the baked heightfield reads 0 over large areas
    // where the authored floor shell is metres lower, and clamping to it
    // shoved the camera up inside the hillside the hog was driving along.
    const floor = v.groundAt(cx, cz) + 0.6;
    if (cy < floor) cy = floor;
    this.camera.position.set(cx, cy, cz);
    this.camera.quaternion.copy(lookQuat);
  }

  update(dt) {
    const s = this.soldier;
    if (!s.alive) return;
    if (this.vehicle) { this._updateDriving(dt); return; }
    this.exitCooldown = Math.max(0, this.exitCooldown - dt);

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
    // Hoisted out of the speed line because three things need the same answer:
    // the multiplier, the stamina drain, and the body's sprint clip. `mz` is
    // still the raw ±1 here — it is normalised below, which preserves the sign.
    const boosting = this.sprinting && mz > 0;
    const sprintMult = this._stepStamina(dt, boosting, moving);
    let speed = P.speed;
    if (boosting) speed *= sprintMult;
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
    // strafe with Shift down, but the speed bonus (and the clip) do not. Same
    // rule now covers an empty pool: once stamina has ramped the bonus away
    // there is no sprint to show, and the head-down clip over a jog is the body
    // lying about how fast it is going.
    s.sprinting = boosting && sprintMult > 1.01;
    s.airborne = !this.onGround;
    // `w` is declared further down in this scope, so read through the getter.
    s.reloading = this.weapon.reloading;
    s.reloadTime = this.weapon.def.reload;
    // Mid-bash. Flagged off the lockout timer rather than the cooldown, so the
    // body is swinging exactly as long as the hands are committed; the clip is
    // authored longer than that on purpose and blends out on the way down.
    s.meleeing = !!(this.melee && this.melee.useTimer > 0);
    s.meleeSpan = this.melee ? (this.melee.def.animSpan || this.melee.def.useTime) : 0;
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
    this._updateInteract(dt);
    // ---- Aim: everything the weapon's `ads` block drives -------------------
    // One rate for the whole pose so the gun arrives together, and the weapon
    // owns it — a sniper comes up slower than an SMG. Tuned in /chartest.html.
    // A welder has no sights, so RMB does nothing while one is held rather than
    // zooming the camera on a tool with no `ads` block to zoom to.
    const aim = this.ads && !this.weapon.def.tool;
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
    // `s.sprinting` rather than `this.sprinting`: the fast bob belongs to the
    // speed you are actually making, not to the key being held.
    if (moving && this.onGround) this.bobTime += dt * (s.sprinting ? 11 : 7.5);
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
    this._updateRally(dt);
    this._updateActions(dt);
    this._updateWeapon(dt, moving, speed);

    const w = this.weapon;
    // A tool has no rounds to count, so the ammo readout carries its heat
    // instead of printing `undefined` over the magazine.
    if (w.def.tool) {
      this.game.hud.setToolHeat(w.heat, w.vented);
    } else {
      this.game.hud.setAmmo(w.mag, w.reserve, w.def.mag);
      if (this.ammoDisplay) this.ammoDisplay.set(w.mag); // no-op unless changed
    }
    this.game.hud.setGadgets(this.biofoam, this.grenade, this.gadgets); // no-op unless changed
    this.prevFiring = this.firing;
  }

  _updateWeapon(dt, moving, speed) {
    const w = this.weapon;
    const def = w.def;

    // A tool shares none of the fire path below — no magazine, no cadence, no
    // recoil, no tracer, no round. Branch before any of it, and before the
    // hands-busy return, so the beam gets a frame to shut itself off.
    if (def.tool) { this._updateTool(dt, w); return; }

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

  // The held tool. Fuel is unlimited and HEAT is the limiter, which is the right
  // shape for a device that does three jobs — a charge pool would have to be
  // divided between build, vehicle and armour and re-tuned every time a job was
  // added, and would make the tool's usefulness a question of inventory rather
  // than of where you are standing.
  //
  // Armour is the first of the three jobs to have something to receive it.
  // Vehicles and blueprints hook in at the same site, on the same rule: find
  // what the beam is on, ask whether it wants work, apply it.
  //
  // Heat is charged for HOLDING the trigger, not for landing on a target. A tool
  // that only warmed up when it was being useful would make waving it around
  // free, and the limiter has to cost something at the moment you decide to
  // press rather than only in hindsight.
  _updateTool(dt, w) {
    const T = w.def.tool;
    this.fireTimer -= dt;    // the draw — a tool cannot work before it is up

    // Third person is excluded for the same reason firing is: the ray starts at
    // a camera sitting metres behind the body, so the beam would leave from
    // somewhere the player is not.
    const wants = this.firing && this.locked && !this.freecam && !this.thirdPerson
      && !this.actionBusy() && this.fireTimer <= 0;
    const working = wants && !w.vented;

    if (working) {
      w.idle = 0;
      w.heat = Math.min(1, w.heat + dt / T.heatUp);
      if (w.heat >= 1 && !w.vented) {
        w.vented = true;
        this.game.audio.playUI('empty');
        this.game.hud.message(`${w.def.name} — OVERHEATED`, 1.5);
      }
    } else {
      // Cooling waits out `ventDelay` first. Without that pause, tapping the
      // trigger beats holding it and the ceiling stops being a ceiling.
      w.idle += dt;
      if (w.idle >= T.ventDelay) {
        w.heat = Math.max(0, w.heat - dt / T.coolDown);
        // The lockout clears at ZERO, not at some threshold — a partial
        // recovery would invite riding the top of the gauge, which is exactly
        // the behaviour heat exists to punish.
        if (w.vented && w.heat <= 0) {
          w.vented = false;
          this.game.hud.message(`${w.def.name} — READY`, 1.2);
        }
      }
    }

    this._updateBeam(dt, w, working);
    this._applyRepair(dt, w, working);
  }

  // What the beam lands on. Deliberately separate from drawing it: the beam is
  // shown whether or not it is doing anything, because a tool that only rendered
  // when it was working would give away the answer before you had aimed.
  _applyRepair(dt, w, working) {
    const s = this.soldier;
    if (!working || !s) { this.repairTarget = null; return; }
    const t = this._beamTarget(w.def.tool.range);
    this.repairTarget = t;
    if (!t) return;
    // `applyRepair` is the shared entry point bots use too, and it is what owns
    // the Engineer's ×2 — so a player and a bot standing in the same place put
    // the same plating on, which is the rule crates already follow.
    const put = t.applyRepair(s, dt);
    if (put > 0 && !t.needsRepair) {
      this.game.hud.message(`${t.name} — ARMOUR RESTORED`, 1.5);
    }
  }

  // The friendly soldier under the crosshair, if one is close enough to work on
  // and has plating to put back. Its own trace rather than `combat.traceHit`,
  // because that one is written to find things to SHOOT — it stops at the first
  // body of either team and takes no interest in whether a teammate wants help.
  _beamTarget(range) {
    const s = this.soldier;
    const mates = this.game.teams[s.team].soldiers;
    this.camera.getWorldDirection(_dir);
    _from.copy(this.camera.position);
    let best = null, bestT = Infinity;
    for (const m of mates) {
      if (m === s || !m.needsRepair) continue;
      // Distance along the beam, and how far off it they sit. A generous radius
      // on purpose: this is a repair beam being pointed at a friend who is
      // probably moving, not a shot that has to be earned.
      _aim.subVectors(m.bodyPoint(_muzzle, 1.0), _from);
      const along = _aim.dot(_dir);
      if (along <= 0 || along > range || along >= bestT) continue;
      if (_aim.addScaledVector(_dir, -along).length() > 0.9) continue;
      bestT = along;
      best = m;
    }
    return best;
  }

  // Where the beam starts and where the world stops it. The pool draws it — not
  // requesting is how a beam goes away, so there is nothing to hide here.
  //
  // The pool may be absent: the lobby range runs on the `arena` host slice,
  // which has no match and therefore no beam pool, exactly as it has no crates.
  // Checking beats assuming, the same way the casualty scans check `teams`.
  _updateBeam(dt, w, working) {
    if (!working || !this.game.beams) return;
    const range = w.def.tool.range;
    this.camera.getWorldDirection(_dir);
    _from.copy(this.camera.position).addScaledVector(_dir, 0.3);
    // Aim is the camera ray — the crosshair tells the truth for a beam exactly
    // as it does for a round — but the beam is DRAWN leaving the nozzle.
    // `ref_muzzle` is the same authored empty every weapon in the armoury
    // carries; a tool GLB without one falls back to the eye, which reads as a
    // beam emitted from the middle of the screen.
    this.game.combat.aimPoint(this.soldier, _from, _dir, range, _aim);
    // The origin CANNOT be the eye, and that is not a detail. A beam sent along
    // the camera ray from the camera itself is seen end-on — it renders as a dot
    // at the crosshair and the player never sees a beam at all. It has to leave
    // the tool, off to the side, so it reads as a line converging on the target.
    //
    // `ref_muzzle` is the authored empty every weapon carries, and the repair
    // tool has one at its nozzle tip. The gun holder is the fallback for a tool
    // GLB that does not — it is roughly where the model is drawn on screen, so
    // the beam still leaves the tool rather than the face, just not from the
    // nozzle. Worth keeping: it is the difference between an unauthored empty
    // being a blemish and being a beam fired out of the player's eye.
    const origin = this.vmMuzzle
      ? this.vmMuzzle.getWorldPosition(_muzzle)
      : this.gunHolder.getWorldPosition(_muzzle);
    // Keyed on the SOLDIER, not the controller, so the pool can tell the
    // player's beam from a bot's by the one flag they share.
    this.game.beams.request(this.soldier, origin, _aim);
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
