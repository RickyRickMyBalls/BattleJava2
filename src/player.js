// First-person controller: pointer lock, movement, class loadout with two
// weapons (auto/burst/semi/pump/projectile/charge fire modes), freecam.

import * as THREE from 'three';
import { CFG, WEAPONS, CLASSES } from './config.js';
import { terrainHeight } from './world.js';

const P = CFG.player;
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();

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
    this.ads = false;
    this.eye = P.eyeHeight;

    this.weapons = [mkWeaponState('ar'), mkWeaponState('smg')];
    this.active = 0;
    this.switchTimer = 0;
    this.fireTimer = 0;
    this.firing = false;
    this.prevFiring = false;
    this.heat = 0;

    this.keys = {};
    this.locked = false;

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

  _bindInput() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (this.game.menuOpen) return; // armory owns the keyboard
      if (e.code === 'KeyR' && !this.freecam) this.startReload();
      if (e.code === 'KeyM') document.exitPointerLock();
      if (e.code === 'KeyF') this.game.toggleFreecam();
      if (e.code === 'KeyP') this.game.togglePause();
      if (e.code === 'KeyT') this.game.cycleTimeScale();
      if (!this.freecam) {
        if (e.code === 'Digit1') this.switchWeapon(0);
        if (e.code === 'Digit2') this.switchWeapon(1);
        if (e.code === 'KeyQ') this.switchWeapon(1 - this.active);
      }
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    document.addEventListener('wheel', (e) => {
      if (this.game.menuOpen) return;
      if (this.freecam) {
        this.fcSpeed = Math.max(5, Math.min(200, this.fcSpeed * (e.deltaY > 0 ? 0.8 : 1.25)));
      } else if (this.locked) {
        this.switchWeapon(1 - this.active);
      }
    });

    this.dom.addEventListener('mousedown', (e) => {
      if (this.game.menuOpen) return;
      if (!this.locked) { this.requestLock(); return; }
      if (this.freecam) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.ads = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.ads = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.firing = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      if (this.freecam) {
        this.fcYaw -= e.movementX * 0.0021;
        this.fcPitch -= e.movementY * 0.0021;
        this.fcPitch = Math.max(-1.55, Math.min(1.55, this.fcPitch));
        return;
      }
      const sens = this.ads ? 0.0011 : 0.0021;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
  }

  requestLock() {
    if (this.game.gameOver) return;
    if (this.game.playerDead && !this.freecam) return;
    this.dom.requestPointerLock();
  }

  setFreecam(on) {
    this.freecam = on;
    this.firing = false;
    this.ads = false;
    this.viewmodel.visible = !on;
    const s = this.soldier;
    if (on) {
      this.fcPos.copy(this.camera.position);
      this.fcYaw = this.yaw;
      this.fcPitch = this.pitch;
      if (s.mesh && s.alive) {
        s.mesh.visible = true;
        s.playAnim('idle', 0);
      }
      this.requestLock();
    } else {
      if (s.mesh) s.mesh.visible = false;
    }
  }

  _buildViewmodel() {
    this.viewmodel = new THREE.Group();
    this.gunHolder = new THREE.Group();
    this.gunHolder.rotation.y = Math.PI; // muzzle away from camera
    this.viewmodel.add(this.gunHolder);
    this.viewmodel.position.set(0.28, -0.24, -0.55);
    this.camera.add(this.viewmodel);

    const flashMat = new THREE.SpriteMaterial({ color: 0xffe6a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.scale.set(0.35, 0.35, 1);
    this.flash.position.set(0, 0.03, -0.55);
    this.viewmodel.add(this.flash);

    this.recoil = 0;
    this.bobTime = 0;
    this._mountGun();
  }

  _mountGun() {
    while (this.gunHolder.children.length) this.gunHolder.remove(this.gunHolder.children[0]);
    const model = this.game.assets.weaponModels[this.weapon.key];
    if (model) this.gunHolder.add(model);
    this.game.hud.setWeaponName(this.weapon.def.name);
  }

  applyLoadout(loadout) {
    this.weapons = [mkWeaponState(loadout.primary), mkWeaponState(loadout.secondary)];
    this.active = 0;
    this.fireTimer = 0;
    this._mountGun();
    const s = this.soldier;
    if (s) {
      s.setLoadout(loadout.cls, loadout.primary, loadout.secondary);
      // body model follows the class (marine vs spartan) — visible in freecam
      const charKey = CLASSES[loadout.cls].model;
      const char = this.game.assets.characters[charKey];
      if (char) s.setCharacter(char);
    }
  }

  switchWeapon(i) {
    if (i === this.active || !this.weapons[i]) return;
    const w = this.weapon;
    w.reloading = false;
    w.burstLeft = 0;
    w.chargeT = 0;
    this.game.hud.setReloading(false);
    this.active = i;
    this.fireTimer = Math.max(this.fireTimer, 0.4);
    this.recoil = Math.min(1, this.recoil + 0.5); // little raise animation
    this._mountGun();
  }

  spawnAt(x, z) {
    this.pos.set(x, terrainHeight(x, z), z);
    this.velY = 0;
    this.applyLoadout(this.game.playerLoadout);
    this.pitch = 0;
    this.yaw = Math.atan2(-x, -z) + Math.PI;
    const s = this.soldier;
    s.spawnAt(x, z);
    if (s.mesh) s.mesh.visible = false;
  }

  startReload() {
    const w = this.weapon;
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
    this.sprinting = !!this.keys['ShiftLeft'] && !this.ads;
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
    if (this.crouching) speed *= P.crouchMult;

    if (moving) {
      const l = Math.hypot(mx, mz);
      mx /= l; mz /= l;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const wx = -sin * mz + cos * mx;  // forward = (-sin,-cos), right = (cos,-sin)
      const wz = -cos * mz - sin * mx;
      this.pos.x += wx * speed * dt;
      this.pos.z += wz * speed * dt;
    }

    const ground = terrainHeight(this.pos.x, this.pos.z);
    if (this.onGround && this.keys['Space']) {
      this.velY = P.jumpVel;
      this.onGround = false;
    }
    if (!this.onGround || this.pos.y > ground + 0.01) {
      this.velY -= P.gravity * dt;
      this.pos.y += this.velY * dt;
      if (this.pos.y <= ground) { this.pos.y = ground; this.velY = 0; this.onGround = true; }
    } else {
      this.pos.y = ground;
      this.onGround = true;
    }

    this.game.world.collideCircle(this.pos, 0.55);
    this.game.world.clampToMap(this.pos);

    s.pos.copy(this.pos);
    s.yaw = this.yaw;
    s.speed2D = moving ? speed : 0;

    // ---- Camera ----
    this.camera.position.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const targetFov = this.ads ? this.weapon.def.adsFov : 75;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
    }

    // ---- Viewmodel bob/recoil ----
    if (moving && this.onGround) this.bobTime += dt * (this.sprinting ? 11 : 7.5);
    const bobA = this.ads ? 0.004 : 0.012;
    const vx = 0.28 + Math.sin(this.bobTime) * bobA - (this.ads ? 0.28 : 0);
    const vy = -0.24 + Math.abs(Math.cos(this.bobTime)) * bobA - (this.ads ? 0.065 : 0);
    this.viewmodel.position.x += (vx - this.viewmodel.position.x) * Math.min(1, dt * 10);
    this.viewmodel.position.y += (vy - this.viewmodel.position.y) * Math.min(1, dt * 10);
    this.recoil = Math.max(0, this.recoil - dt * 3);
    this.viewmodel.position.z = -0.55 + this.recoil * 0.06;
    this.viewmodel.rotation.x = this.recoil * 0.12;
    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 22);

    this._updateWeapon(dt, moving, speed);

    const w = this.weapon;
    this.game.hud.setAmmo(w.mag, w.reserve);
    this.prevFiring = this.firing;
  }

  _updateWeapon(dt, moving, speed) {
    const w = this.weapon;
    const def = w.def;

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

    if (def.mode === 'projectile') {
      this.game.combat.fireRocket(this.soldier, _from.clone(), _dir.clone(), def);
    } else {
      this.game.combat.firePlayerShot(_from, _dir, def, spread);
      this.game.audio.playShot(def);
    }

    const kick = def.dmg >= 50 ? 1.9 : def.mode === 'pump' ? 1.6 : def.mode === 'projectile' ? 1.6 : 1;
    this.recoil = Math.min(1.6, this.recoil + 0.35 * kick);
    this.pitch += (0.0035 + Math.random() * 0.002) * kick;
    this.flash.material.opacity = 1;
    this.flash.scale.setScalar(0.3 + Math.random() * 0.15);

    if (w.mag <= 0 && w.reserve > 0) this.startReload();
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
    this.fcPos.y = Math.max(this.fcPos.y, terrainHeight(this.fcPos.x, this.fcPos.z) + 0.5);

    this.camera.position.copy(this.fcPos);
    this.camera.rotation.set(this.fcPitch, this.fcYaw, 0, 'YXZ');
    if (Math.abs(this.camera.fov - 75) > 0.1) {
      this.camera.fov = 75;
      this.camera.updateProjectionMatrix();
    }
  }
}
