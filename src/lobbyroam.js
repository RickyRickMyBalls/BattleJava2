// Walk around the lobby stage (TAB). The camera flies from the portrait pose
// into the back of the character's head, then the REAL Player takes over — same
// class the match uses, hosted on a lobby arena (see arena.js). This is the
// future firing range / vehicle test area.
//
// Nothing about movement, weapons or animation is reimplemented here. If it
// feels different from the match, that is a bug in this file, not a feature.
//
// States: idle → in → roam → out → idle.

import * as THREE from 'three';
import { CFG, CLASSES, WEAPONS } from './config.js';
import { makeLobbyArena } from './arena.js';
import { LobbyWorld } from './lobbyworld.js';
import { Player } from './player.js';
import { Soldier } from './soldier.js';
import { WeaponRack } from './weaponrack.js';

const R = CFG.lobbyRoam;
const P = CFG.player;

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

const easeInOut = (t) => t * t * (3 - 2 * t);
const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export class LobbyRoam {
  constructor(lobby) {
    this.lobby = lobby;
    this.session = lobby.session;
    this.state = 'idle';
    this.t = 0;
    this.built = false;

    this.home = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 35 };
    this.from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 35 };
    this.ctrl = new THREE.Vector3();
    this.end = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), yaw: 0 };

    this.hint = document.getElementById('lbHint');
    this.prompt = document.getElementById('lbPrompt');
    this._look = new THREE.Vector3();
    this._bindInput();
  }

  get active() { return this.state !== 'idle'; }

  _bindInput() {
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab') return;
      // Tab is the browser's focus-cycle key; it must never reach the document.
      e.preventDefault();
      if (!this._canToggle()) return;
      if (this.state === 'idle') this.enter();
      else if (this.state === 'roam') this.exit();
    });

    document.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyE' || this.state !== 'roam') return;
      if (this.session.menuOpen || !this.rack || !this.rack.target) return;
      this.rack.take(this.player);
      this._updatePrompt();
    });

    // Esc is swallowed by the browser to release pointer lock, so losing the
    // lock IS the exit signal — no keybinding needed for the common case.
    document.addEventListener('pointerlockchange', () => {
      if (this.state === 'roam' && document.pointerLockElement === null) this.exit();
    });
  }

  _canToggle() {
    const lb = this.lobby;
    // `launching` covers the team-select screen, where the lobby keeps
    // rendering behind the overlay and a real Game (with its own Player) exists.
    return lb.active && !lb.launching && !this.session.menuOpen && !!lb.charGroup;
  }

  // Built once, on first entry: the stage GLB has to be loaded before any of
  // this can be measured.
  _build() {
    const lb = this.lobby;
    this.world = new LobbyWorld(lb.stage ? lb.stage.root : null);
    this.arena = makeLobbyArena({
      scene: lb.scene,
      camera: lb.camera,
      assets: this.session.assets,
      session: this.session,
      world: this.world,
    });

    const lo = this.session.playerLoadout;
    // Same rule as the match and the lobby portrait: Covenant is the Elite,
    // UNSC wears whatever body its class declares (CLASSES[].model).
    const charKey = this.arena.playerTeam === 1 ? 'elite' : (CLASSES[lo.cls].model || 'marine');
    const character = this.session.assets.characters[charKey] || this.session.assets.characters.marine;
    this.soldier = new Soldier(this.arena, 0, null, 'You', character, lo.cls, lo.primary, lo.secondary);
    this.soldier.isPlayer = true;
    this.arena.playerSoldier = this.soldier;

    // The viewmodel is parented to the camera, so the camera must be in the
    // scene graph or the gun never renders. The lobby camera is standalone.
    if (lb.camera.parent !== lb.scene) lb.scene.add(lb.camera);

    this.player = new Player(this.arena, lb.camera, this.lobby.renderer.domElement);
    this.arena.player = this.player;
    this.player.setEnabled(false);
    // The viewmodel is parented to the camera, so it renders from the moment
    // the camera joins the scene — a gun floating through the fly-in. It comes
    // back on at handoff, via spawnAt().
    this.player.viewmodel.visible = false;

    // Fallback layout needs "away from the lobby camera" so an unauthored rack
    // lands behind the character instead of through the portrait framing.
    const away = lb.charPos.clone().sub(lb.camera.position);
    this.rack = new WeaponRack(lb.scene, this.session.assets, lb.stage, lb.charPos, away);
    this.built = true;
  }

  // ------------------------------------------------------------- enter --
  enter() {
    if (!this.built) this._build();

    const lb = this.lobby;
    // Snapshot the pose to come back to. Taken here rather than at stage-layout
    // time so an exit always returns to wherever the lobby camera actually was.
    this.home.pos.copy(lb.camera.position);
    this.home.quat.copy(lb.camera.quaternion);
    this.home.fov = lb.camera.fov;
    this.from.pos.copy(this.home.pos);
    this.from.quat.copy(this.home.quat);
    this.from.fov = this.home.fov;

    // Where the Player's camera will sit on its first frame. Ending the flight
    // exactly there is what makes the handoff popless — aiming at the head bone
    // instead would leave a visible snap.
    const cp = lb.charPos;
    const floorY = this.world.heightAt(cp.x, cp.z);
    this.end.pos.set(cp.x, floorY + P.eyeHeight, cp.z);

    // Look out the way the character looks. The two conventions differ by a
    // half turn: Player's camera forward is (-sin yaw, 0, -cos yaw) — -Z at
    // yaw 0 — while these character models face +Z locally. (Verified against
    // the authored stage, where the portrait shows the marine's front, and
    // against the stage-less fallback pose, which agrees.) Without the flip the
    // camera sweeps around the character's face and lands staring at the back
    // wall.
    _euler.setFromQuaternion(lb.charQuat || lb.charGroup.quaternion, 'YXZ');
    this.end.yaw = _euler.y + Math.PI;
    this.end.quat.setFromEuler(new THREE.Euler(0, this.end.yaw, 0, 'YXZ'));

    // Control point behind one shoulder: the camera sweeps around the character
    // rather than through it.
    const fwd = _a.set(-Math.sin(this.end.yaw), 0, -Math.cos(this.end.yaw));
    const right = _b.set(Math.cos(this.end.yaw), 0, -Math.sin(this.end.yaw));
    this.ctrl.copy(this.end.pos)
      .addScaledVector(fwd, -R.arc.back)
      .addScaledVector(right, R.arc.side);
    this.ctrl.y += R.arc.up;

    this.state = 'in';
    this.t = 0;

    this.rack.setVisible(true);
    lb.hidePanels();
    this._setHint('roam');
    if (lb.scene.fog) {
      this._fogFar = lb.scene.fog.far;
      lb.scene.fog.far = R.fogFar;
    }
    // Pointer lock must be requested inside the user gesture that started this
    // (the Tab keydown) — asking a second later, at handoff, gets rejected.
    this.lobby.renderer.domElement.requestPointerLock();
    // Audio has the same constraint. The arena carries a real GameAudio left
    // uninitialised so that merely building an arena never creates an
    // AudioContext; this is the gesture that is allowed to. Creating one at
    // handoff instead — a second later, outside the gesture — yields a
    // suspended context and silence. resume() covers a context the browser
    // suspended later.
    this.arena.initAudio();
    this.arena.audio.resume();
  }

  // -------------------------------------------------------------- exit --
  exit() {
    if (this.state !== 'roam' && this.state !== 'in') return;
    this.player.setEnabled(false);
    this.player.viewmodel.visible = false;
    this.from.pos.copy(this.lobby.camera.position);
    this.from.quat.copy(this.lobby.camera.quaternion);
    this.from.fov = this.lobby.camera.fov;
    this.state = 'out';
    this.t = 0;
    this._setHint('enter');
    this._updatePrompt();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _finishExit() {
    const lb = this.lobby;
    this.state = 'idle';
    lb.camera.position.copy(this.home.pos);
    lb.camera.quaternion.copy(this.home.quat);
    lb.camera.fov = this.home.fov;
    lb.camera.updateProjectionMatrix();
    if (lb.charGroup) lb.charGroup.visible = true;
    if (lb.scene.fog && this._fogFar !== undefined) lb.scene.fog.far = this._fogFar;
    this.rack.setVisible(false);
    this._updatePrompt();
    lb.showPanels();
    this._setHint('enter');
  }

  // "E — SRS99 SNIPER" while a rack gun is targeted.
  _updatePrompt() {
    if (!this.prompt) return;
    const t = this.state === 'roam' && this.rack ? this.rack.target : null;
    if (!t) { this.prompt.style.display = 'none'; return; }
    this.prompt.style.display = 'block';
    this.prompt.innerHTML = `<b>E</b> ${WEAPONS[t.key].name}`;
  }

  _setHint(kind) {
    if (!this.hint) return;
    if (kind === null) { this.hint.style.display = 'none'; return; }
    this.hint.style.display = 'block';
    this.hint.innerHTML = kind === 'roam'
      ? '<b>ESC</b> RETURN TO SETUP'
      : '<b>TAB</b> WALK THE HANGAR';
  }

  // Shown whenever the lobby is idle and roam is available.
  refreshHint() {
    if (this.state === 'roam' || this.state === 'in') this._setHint('roam');
    else if (this._canToggle()) this._setHint('enter');
    else this._setHint(null);
  }

  // ------------------------------------------------------------ update --
  update(dt) {
    if (this.state === 'idle') return;
    const lb = this.lobby;
    const cam = lb.camera;

    if (this.state === 'roam') {
      this.player.update(dt);
      this.soldier.update(dt);
      this.arena.combat.update(dt);
      // Refills the per-frame budget that caps positional shot sounds. The
      // player's own gun does not use it, but target dummies will.
      this.arena.audio.update();
      cam.getWorldDirection(this._look);
      this.rack.update(dt, this.player.pos, this._look);
      this._updatePrompt();
      // Same off-screen pass Game.renderScopes does, so scope screens are live
      // here too — the lobby is meant to be the test range for exactly this.
      // Must precede the lobby's own render, which happens right after us.
      this.player.renderScope(lb.renderer, lb.scene);
      return;
    }

    if (this.state === 'in') {
      this.t = Math.min(1, this.t + dt / R.enterTime);
      const e = easeInOut(this.t);
      // Quadratic Bezier: home → behind the shoulder → eye position.
      const u = 1 - e;
      cam.position.copy(this.from.pos).multiplyScalar(u * u)
        .addScaledVector(this.ctrl, 2 * u * e)
        .addScaledVector(this.end.pos, e * e);
      cam.quaternion.slerpQuaternions(this.from.quat, this.end.quat, e);
      // Hold the portrait fov, then widen late — that late kick is what reads
      // as "dropping into first person".
      cam.fov = this.from.fov + (R.fov - this.from.fov) * smoothstep(R.fovHold, 1, this.t);
      cam.updateProjectionMatrix();

      if (lb.charGroup) lb.charGroup.visible = this.t < R.hideCharAt;
      if (this.t >= 1) this._handoff();
      return;
    }

    if (this.state === 'out') {
      this.t = Math.min(1, this.t + dt / R.exitTime);
      const e = easeInOut(this.t);
      cam.position.lerpVectors(this.from.pos, this.home.pos, e);
      cam.quaternion.slerpQuaternions(this.from.quat, this.home.quat, e);
      cam.fov = this.from.fov + (this.home.fov - this.from.fov) * e;
      cam.updateProjectionMatrix();
      if (lb.charGroup && this.t >= R.showCharAt) lb.charGroup.visible = true;
      if (this.t >= 1) this._finishExit();
    }
  }

  _handoff() {
    const lb = this.lobby;
    const cp = lb.charPos;
    // spawnAt overwrites yaw with a face-the-map heading, so orientation is set
    // after it — the flight ended on end.yaw and must continue from it.
    this.player.spawnAt(cp.x, cp.z);
    this.player.yaw = this.end.yaw;
    this.player.pitch = 0;
    this.player.setEnabled(true);
    // The pointerlockchange that granted the lock fired while the Player was
    // disabled, so its handler swallowed it. Sync by hand or the mouse is dead.
    this.player.locked = document.pointerLockElement === this.player.dom;
    if (lb.charGroup) lb.charGroup.visible = false;
    // Whatever the loadout put in your hands is off the rack.
    this.rack.syncCarried(this.player.weapons.map((w) => w.key));
    this.state = 'roam';
  }
}
