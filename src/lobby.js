// Pre-game lobby: game type + map selection with a live 3D render of the
// player's character holding their primary weapon. Also the post-load team
// select screen (UNSC left / Covenant right).

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { MAPS, GAME_TYPES, CLASSES, WEAPONS } from './config.js';
import { makeWeaponMount, setHeldWeapon } from './soldier.js';

// Emissive "hangar screen" texture: dark panel with battle-glow band + scanlines
function makeScreenTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#05090f';
  ctx.fillRect(0, 0, 512, 256);
  // warm battle glow along the lower band
  const glow = ctx.createLinearGradient(0, 130, 0, 240);
  glow.addColorStop(0, 'rgba(0,0,0,0)');
  glow.addColorStop(0.65, 'rgba(255,110,45,0.10)');
  glow.addColorStop(1, 'rgba(255,140,60,0.20)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 100, 512, 156);
  // distant silhouettes / smoke columns
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512;
    const w = 6 + Math.random() * 30;
    const h = 12 + Math.random() * 60;
    ctx.fillStyle = `rgba(2,4,8,${0.35 + Math.random() * 0.45})`;
    ctx.fillRect(x, 210 - h, w, h);
  }
  // cyan scanlines up top
  ctx.fillStyle = 'rgba(127,212,255,0.05)';
  for (let y = 0; y < 130; y += 5) ctx.fillRect(0, y, 512, 1);
  // a few bright tracers
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * 512, y = 150 + Math.random() * 60;
    ctx.strokeStyle = `rgba(255,${180 + Math.random() * 60 | 0},120,0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20 + Math.random() * 40, y - 4 - Math.random() * 10);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Hangar deck plating: panel grid, scuffs, grime. Semi-transparent so the
// mirror reflection underneath ghosts through, strongest along panel seams.
function makeDeckTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(9,12,17,0.90)';
  ctx.fillRect(0, 0, 512, 512);
  // uneven grime patches
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const r = 14 + Math.random() * 55;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() > 0.5;
    g.addColorStop(0, dark ? 'rgba(4,6,9,0.25)' : 'rgba(60,75,95,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // scuff streaks
  ctx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    ctx.strokeStyle = `rgba(3,5,8,${0.12 + Math.random() * 0.2})`;
    ctx.lineWidth = 1 + Math.random() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 24);
    ctx.stroke();
  }
  // panel seams: slightly more transparent → reflection reads along them
  ctx.strokeStyle = 'rgba(130,165,200,0.10)';
  ctx.lineWidth = 2;
  for (let p = 0; p <= 512; p += 128) {
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(512, p); ctx.stroke();
  }
  // rivets at seam crossings
  ctx.fillStyle = 'rgba(150,180,210,0.14)';
  for (let px = 0; px <= 512; px += 128) {
    for (let py = 0; py <= 512; py += 128) {
      for (const [ox, oy] of [[10, 10], [-10, 10], [10, -10], [-10, -10]]) {
        ctx.beginPath();
        ctx.arc((px + ox + 512) % 512, (py + oy + 512) % 512, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft radial light pool for the floor under the character
function makePoolTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(190,220,255,0.55)');
  g.addColorStop(0.5, 'rgba(120,170,220,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

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
    this.scene.background = new THREE.Color(0x04070c);
    this.scene.environment = envTexture;
    this.scene.environmentIntensity = 0.35;
    this.scene.fog = new THREE.Fog(0x04070c, 9, 26);

    // moody base light + warm key + cyan rim
    this.scene.add(new THREE.HemisphereLight(0x9fc4e0, 0x131a22, 0.22));
    const key = new THREE.DirectionalLight(0xffe9c4, 1.15);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fd4ff, 1.8);
    rim.position.set(-3.5, 2, -2.5);
    this.scene.add(rim);
    // hero spotlight from above
    const spot = new THREE.SpotLight(0xf4f8ff, 40, 14, 0.5, 0.5, 1.4);
    spot.position.set(0.6, 5.2, 0.6);
    spot.target.position.set(0.75, 0.9, 0);
    this.scene.add(spot);
    this.scene.add(spot.target);

    // true planar reflection under semi-transparent deck plating
    const mirror = new Reflector(new THREE.PlaneGeometry(60, 60), {
      textureWidth: 1024,
      textureHeight: 1024,
      color: 0x505c6c,
      clipBias: 0.003,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.002;
    this.scene.add(mirror);

    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({
        map: makeDeckTexture(),
        transparent: true,
        opacity: 0.86,
        roughness: 0.9,
        metalness: 0.1,
        depthWrite: false,
      })
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = 0.004;
    this.scene.add(deck);

    // light pool under the character
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshBasicMaterial({ map: makePoolTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0.75, 0.012, 0);
    this.scene.add(pool);

    // faint volumetric cone above the character
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 2.1, 4.6, 28, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xbfe2ff, transparent: true, opacity: 0.032, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    cone.position.set(0.7, 2.5, 0.2);
    this.scene.add(cone);
    this.spotCone = cone;

    // curved wall of hangar "screens" showing a distant battle
    const screenTex = makeScreenTexture();
    for (let i = -2; i <= 2; i++) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(8.4, 4.6),
        new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, opacity: 0.75, fog: false })
      );
      const a = i * 0.4;
      panel.position.set(Math.sin(a) * 16, 2.75, -Math.cos(a) * 16 + 4);
      panel.rotation.y = a;
      this.scene.add(panel);
    }

    // drifting dust motes
    const dustGeo = new THREE.BufferGeometry();
    const dustCount = 160;
    const pos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      pos[i * 3] = -2.5 + Math.random() * 6;
      pos[i * 3 + 1] = Math.random() * 3.6;
      pos[i * 3 + 2] = -3 + Math.random() * 6;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0xa8d4ff, size: 0.016, transparent: true, opacity: 0.4, depthWrite: false,
    }));
    this.scene.add(this.dust);

    // parked Mongoose as set dressing (lazy, non-blocking)
    new GLTFLoader().load('/UNSC/Land Vehicles/mongoose.glb', (gltf) => {
      const m = gltf.scene;
      m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const s = 2.4 / Math.max(size.x, size.y, size.z);
      m.scale.setScalar(s);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
      m.position.set(-center.x, -box.min.y * s, -center.z); // center in the wrapper
      const wrap = new THREE.Group();
      wrap.add(m);
      wrap.rotation.y = 2.3;
      wrap.position.set(-1.15, 0, -2.1);
      this.scene.add(wrap);
      // dim service light over the parked vehicle
      const lamp = new THREE.PointLight(0xa8c4ff, 4, 6, 1.6);
      lamp.position.set(-1.1, 2.2, -2.0);
      this.scene.add(lamp);
    }, undefined, () => {});

    this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 60);
    this.camera.position.set(-0.5, 1.45, 3.7);
    this.camera.lookAt(0.75, 1.0, 0);
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
    this.sway += dt;
    if (this.charGroup) {
      this.charGroup.rotation.y = -1.25 + Math.sin(this.sway * 0.3) * 0.1;
    }
    if (this.spotCone) {
      this.spotCone.material.opacity = 0.03 + Math.sin(this.sway * 1.7) * 0.008;
    }
    if (this.dust) {
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 0.05;
        if (y < 0) y = 3.6;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
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
