// Pre-game lobby: game type + map selection with a live 3D render of the
// player's character holding their primary weapon. Also the post-load team
// select screen (UNSC left / Covenant right).

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { MAPS, GAME_TYPES, CLASSES, WEAPONS } from './config.js';
import { makeWeaponMount, setHeldWeapon } from './soldier.js';

export class Lobby {
  constructor(session, renderer, envTexture, onStart) {
    this.session = session;
    this.renderer = renderer;
    this.onStart = onStart;
    this.active = false;

    this.el = {
      lobby: document.getElementById('lobby'),
      panels: document.querySelector('.lb-panels'),
      types: document.getElementById('lbTypes'),
      maps: document.getElementById('lbMaps'),
      customize: document.getElementById('lbCustomize'),
      start: document.getElementById('lbStart'),
      status: document.getElementById('lbStatus'),
      charInfo: document.getElementById('lbCharInfo'),
      back: document.getElementById('lbBack'),
    };
    this.el.customize.onclick = () => {
      if (this.session.armory) this.session.armory.show('apply');
    };
    this.el.start.onclick = () => this.onStart && this.onStart();

    this._buildScene(envTexture);
  }

  // ------------------------------------------------------------- preview --
  _buildScene(envTexture) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1522);
    this.scene.environment = envTexture;
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x2c3540, 0.7));
    const key = new THREE.DirectionalLight(0xfff2dd, 2.0);
    key.position.set(2.5, 3.5, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fd4ff, 1.4);
    rim.position.set(-3, 2, -2.5);
    this.scene.add(rim);
    // subtle ground disc under the character
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.3, 0.04, 40),
      new THREE.MeshStandardMaterial({ color: 0x18242f, roughness: 0.85 })
    );
    disc.position.set(0.75, 0, 0);
    this.scene.add(disc);

    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 50);
    this.camera.position.set(-0.35, 1.55, 3.3);
    this.camera.lookAt(0.75, 1.05, 0);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });

    this.charGroup = null;
    this.mixer = null;
    this.sway = 0;
  }

  refreshPreview() {
    const { assets, playerLoadout: lo } = this.session;
    if (!assets) return;
    if (this.charGroup) this.scene.remove(this.charGroup);

    const charKey = CLASSES[lo.cls].model || 'marine';
    const character = assets.characters[charKey];
    if (!character) return;

    this.charGroup = new THREE.Group();
    const mesh = cloneSkeleton(character.template);
    this.charGroup.add(mesh);
    this.charGroup.position.set(0.75, 0.02, 0);
    this.charGroup.rotation.y = -1.25; // three-quarter profile, rifle silhouette readable
    this.scene.add(this.charGroup);

    this.mixer = new THREE.AnimationMixer(mesh);
    // the aim pose presents the weapon properly (idle tucks it into the body)
    const clip = character.clips.aim || character.clips.idle;
    if (clip) this.mixer.clipAction(clip).play();

    const holder = makeWeaponMount(mesh);
    if (holder) setHeldWeapon(holder, lo.primary, assets.weaponModels);

    // ground the pose: crouch clips shift the root, so measure skinned bounds
    // after one animation tick and drop the group so the feet touch the disc
    this.mixer.update(0.2);
    this.charGroup.updateMatrixWorld(true);
    let minY = Infinity;
    const box = new THREE.Box3();
    mesh.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.computeBoundingBox();
        box.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
        minY = Math.min(minY, box.min.y);
      }
    });
    if (isFinite(minY)) this.charGroup.position.y += 0.02 - minY;

    this.el.charInfo.innerHTML =
      `<div class="lb-ci-class">${CLASSES[lo.cls].name.toUpperCase()}</div>` +
      `<div class="lb-ci-guns">${WEAPONS[lo.primary].name} · ${WEAPONS[lo.secondary].name}</div>`;
  }

  // ------------------------------------------------------------------ UI --
  show() {
    this.active = true;
    this.el.lobby.style.display = 'block';
    this.el.panels.style.display = 'flex';
    this._renderLists();
    this.refreshPreview();
    this.setStatus('');
  }

  hidePanels() {
    this.el.panels.style.display = 'none';
  }

  hide() {
    this.active = false;
    this.el.lobby.style.display = 'none';
  }

  setStatus(text, progress = null) {
    this.el.status.textContent = text;
    if (progress !== null) {
      const row = this.el.maps.querySelector('.lb-row.sel .lb-row-progress > div');
      if (row) row.style.width = `${Math.round(progress * 100)}%`;
    }
  }

  setLaunching(on) {
    this.el.start.disabled = on;
    this.el.start.textContent = on ? 'LOADING…' : 'START GAME';
  }

  _renderLists() {
    const s = this.session;
    this.el.types.innerHTML = '';
    for (const t of Object.values(GAME_TYPES)) {
      const row = document.createElement('div');
      row.className = 'lb-row' + (s.gameType === t.id ? ' sel' : '');
      row.innerHTML = `<div class="lb-row-name">${t.name}</div><div class="lb-row-desc">${t.desc}</div>`;
      row.onclick = () => { s.gameType = t.id; this._renderLists(); };
      this.el.types.appendChild(row);
    }
    this.el.maps.innerHTML = '';
    for (const m of Object.values(MAPS)) {
      const row = document.createElement('div');
      row.className = 'lb-row' + (s.mapId === m.id ? ' sel' : '');
      row.innerHTML = `<div class="lb-row-name">${m.name.toUpperCase()} <span class="lb-tag">${m.tag}</span></div>` +
        `<div class="lb-row-desc">${m.desc}</div>` +
        `<div class="lb-row-progress"><div></div></div>`;
      row.onclick = () => { s.mapId = m.id; this._renderLists(); };
      this.el.maps.appendChild(row);
    }
  }

  update(dt) {
    if (!this.active) return;
    if (this.mixer) this.mixer.update(dt);
    if (this.charGroup) {
      this.sway += dt;
      this.charGroup.rotation.y = -1.25 + Math.sin(this.sway * 0.3) * 0.1;
    }
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------------------
export class TeamSelect {
  constructor() {
    const el = document.createElement('div');
    el.id = 'teamSelect';
    el.innerHTML = `
      <div class="ts-half ts-unsc">
        <div class="ts-inner">
          <h2>UNSC</h2>
          <p>Marines &amp; Spartan super-soldiers</p>
          <span class="ts-join">JOIN</span>
        </div>
      </div>
      <div class="ts-half ts-cov">
        <div class="ts-inner">
          <h2>COVENANT</h2>
          <p>Sangheili warbands</p>
          <span class="ts-join">JOIN</span>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.onPick = null;
    el.querySelector('.ts-unsc').onclick = () => this._pick(0);
    el.querySelector('.ts-cov').onclick = () => this._pick(1);
  }

  show(onPick) {
    this.onPick = onPick;
    this.el.style.display = 'flex';
  }

  _pick(team) {
    this.el.style.display = 'none';
    if (this.onPick) this.onPick(team);
  }
}
