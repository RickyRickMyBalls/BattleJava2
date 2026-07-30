// One of each weapon, laid out in the hangar for the firing range. Walk up to
// one and press E to take it.
//
// Models never move between slots. The rack is a permanent display of all eight
// guns, and a gun is simply hidden while the player is carrying it — so taking
// the sniper empties its spot and the rifle you were holding reappears on its
// own. That is the whole swap: one-of-each stays true with no inventory
// bookkeeping, no duplicates and no empty slots to track.
//
// Purely ephemeral. Picking up never touches session.playerLoadout, so there is
// no way to end up carrying a kit the armory menu would reject. Entering roam
// re-applies the loadout (Player.spawnAt → applyLoadout), which is what makes
// "TAB out and back in returns your chosen weapons" fall out for free.
//
// Placement prefers authored empties, matching the FC_ marker convention the
// stage already uses:
//   FC_WEAPON_<KEY>  — one per gun (FC_WEAPON_SNIPER, FC_WEAPON_AR, …),
//                      giving position AND rotation, like FC_PROP_VEHICLE
//   FC_ARMORY        — a single anchor; guns auto-arrange in a row from it
//   neither          — a row behind the character, away from FC_CAM, so the
//                      authored portrait framing is left alone

import * as THREE from 'three';
import { CFG, WEAPONS } from './config.js';
import { restoreBakedDisplays } from './drivenmaterial.js';

const R = CFG.armoryRack;
const UP = new THREE.Vector3(0, 1, 0);
const _to = new THREE.Vector3();

export class WeaponRack {
  // `origin`/`forward` place the fallback row: origin is the character spot and
  // forward points away from the lobby camera.
  constructor(scene, assets, stage, origin, forward) {
    this.scene = scene;
    this.slots = [];
    this.target = null;
    this.visible = false;
    this._t = 0;
    this._build(assets, stage, origin, forward);
  }

  _build(assets, stage, origin, forward) {
    const markers = (stage && stage.markers) || {};
    const keys = Object.keys(WEAPONS).filter((k) => assets.weaponModels[k]);

    // Fallback row: centred behind the character, laid out along the axis
    // perpendicular to the view direction.
    const fwd = forward.clone().setY(0).normalize();
    const axis = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    const centre = origin.clone().addScaledVector(fwd, R.autoDistance);
    const faceBack = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1), fwd.clone().negate()
    );

    keys.forEach((key, i) => {
      const mk = markers[`FC_WEAPON_${key.toUpperCase()}`] || null;
      const anchor = markers.FC_ARMORY || null;

      let pos, quat;
      if (mk) {
        pos = mk.pos.clone();
        quat = mk.quat.clone();
      } else {
        const t = (i - (keys.length - 1) / 2) * R.spacing;
        const base = anchor ? anchor.pos.clone() : centre;
        pos = base.clone().addScaledVector(axis, t);
        pos.y = (anchor ? anchor.pos.y : origin.y) + R.height;
        quat = anchor ? anchor.quat.clone() : faceBack.clone();
      }

      // A clone, never the cached original — the player mounts that one, and
      // re-parenting it here would rip the gun out of the viewmodel.
      const model = assets.weaponModels[key].clone(true);
      restoreBakedDisplays(model); // keep the baked screens/counters
      // assets.js turns culling off for viewmodel use; rack guns are static
      // set dressing and should cull normally.
      model.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
      model.position.copy(pos);
      model.quaternion.copy(quat);
      model.visible = false;
      this.scene.add(model);

      this.slots.push({ key, model, pos, quat, spin: 0 });
    });
  }

  setVisible(on) {
    this.visible = on;
    if (!on) this.target = null;
    for (const s of this.slots) s.model.visible = on;
  }

  // Hide whatever the player is carrying: those guns are "off the rack".
  syncCarried(keys) {
    const held = new Set(keys);
    for (const s of this.slots) s.model.visible = this.visible && !held.has(s.key);
  }

  // Pick by how directly you are looking at it, with distance only as a
  // tie-break — nearest-wins would hand you the gun behind your shoulder.
  update(dt, playerPos, lookDir) {
    if (!this.visible) { this.target = null; return; }
    this._t += dt;

    let best = null, bestDot = R.minDot;
    for (const s of this.slots) {
      if (!s.model.visible) continue;
      _to.subVectors(s.pos, playerPos);
      const dist = _to.length();
      if (dist > R.radius) continue;
      _to.divideScalar(dist || 1);
      const dot = _to.dot(lookDir);
      if (dot > bestDot) { bestDot = dot; best = s; }
    }
    this.target = best;

    for (const s of this.slots) {
      const on = s === best;
      s.spin = on ? s.spin + dt * R.highlightSpin : 0;
      s.model.quaternion.copy(s.quat);
      if (s.spin) s.model.rotateY(s.spin);
      s.model.position.y = s.pos.y + (on ? R.highlightLift + Math.sin(this._t * 3) * 0.015 : 0);
    }
  }

  // Swap the targeted gun into the player's ACTIVE slot. The one being replaced
  // needs no handling: syncCarried puts it back on its own spot.
  take(player) {
    const s = this.target;
    if (!s) return null;
    player.setWeaponAt(player.active, s.key);
    this.syncCarried(player.weapons.map((w) => w.key));
    return s.key;
  }
}
