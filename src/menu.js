// Armory / loadout menu: class tabs, weapon cards with baked thumbnails,
// and an interactive 3D inspection viewer (drag to spin, wheel to zoom).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { WEAPONS, CLASSES, PRIMARIES } from './config.js';

const MODE_TAGS = {
  auto: 'FULL-AUTO', burst: '3-ROUND BURST', semi: 'SEMI-AUTO',
  pump: 'PUMP-ACTION', projectile: 'ROCKET', charge: 'CHARGE BEAM',
};

const DESCRIPTIONS = {
  ar: 'Standard-issue UNSC rifle. Dependable full-auto fire for any engagement inside mid range.',
  br: 'Precision 3-round burst rifle. Rewards trigger discipline at mid and long range.',
  smg: 'Compact bullet hose. Shreds shields up close — falls off fast past 50 meters.',
  shotgun: 'Eight-pellet close-quarters cannon. One pump, one story.',
  dmr: 'Marksman rifle with a clean semi-auto punch. Versatile at nearly any distance.',
  sniper: 'Anti-personnel sniper system. Two body shots or one clean headshot.',
  rocket: 'Shoulder-fired rockets with a wide blast radius. Vehicles, squads, problems.',
  laser: 'Charge, hold the line steady, and delete whatever the beam touches.',
};

const norm = (v, min, max) => Math.max(0.05, Math.min(1, (v - min) / (max - min)));

export class LoadoutMenu {
  constructor(game) {
    this.game = game;
    this.loadout = game.playerLoadout;
    this.visible = false;
    this.mode = 'deploy';
    this.onDeploy = null;
    this.viewKey = this.loadout.primary;
    this.dragging = false;
    this.icons = {};

    this._buildDom();
    this._buildViewer();
    this._loadIcons();
    this.refresh();
  }

  // ---------------------------------------------------------------- DOM --
  _buildDom() {
    const ov = document.createElement('div');
    ov.id = 'armory';
    ov.innerHTML = `
      <div class="ar-head">
        <div class="ar-title">SELECT LOADOUT</div>
        <div class="ar-sub" id="arClassName"></div>
      </div>
      <div class="ar-main">
        <div class="ar-info">
          <div class="ar-wpn-name" id="arWpnName"></div>
          <div class="ar-tags" id="arTags"></div>
          <div class="ar-desc" id="arDesc"></div>
          <div class="ar-nums">
            <div class="ar-num"><span id="arDmg"></span><label>DMG</label></div>
            <div class="ar-num"><span id="arRof"></span><label>ROF</label></div>
            <div class="ar-num"><span id="arMag"></span><label>MAG</label></div>
          </div>
          <div class="ar-bars" id="arBars"></div>
        </div>
        <div class="ar-viewer" id="arViewer"></div>
      </div>
      <div class="ar-tabs" id="arTabs"></div>
      <div class="ar-cards">
        <div class="ar-slot">
          <div class="ar-slot-label">PRIMARY</div>
          <div class="ar-row" id="arPrimaries"></div>
        </div>
        <div class="ar-slot">
          <div class="ar-slot-label">CLASS WEAPON</div>
          <div class="ar-row" id="arSecondaries"></div>
        </div>
      </div>
      <div class="ar-foot">
        <div class="ar-summary" id="arSummary"></div>
        <button id="arDeploy">DEPLOY</button>
      </div>`;
    document.body.appendChild(ov);
    this.el = {
      overlay: ov,
      className: ov.querySelector('#arClassName'),
      wpnName: ov.querySelector('#arWpnName'),
      tags: ov.querySelector('#arTags'),
      desc: ov.querySelector('#arDesc'),
      dmg: ov.querySelector('#arDmg'),
      rof: ov.querySelector('#arRof'),
      mag: ov.querySelector('#arMag'),
      bars: ov.querySelector('#arBars'),
      viewer: ov.querySelector('#arViewer'),
      tabs: ov.querySelector('#arTabs'),
      primaries: ov.querySelector('#arPrimaries'),
      secondaries: ov.querySelector('#arSecondaries'),
      summary: ov.querySelector('#arSummary'),
      deploy: ov.querySelector('#arDeploy'),
    };
    this.el.deploy.onclick = () => { if (this.onDeploy) this.onDeploy(this.mode); };
  }

  // ------------------------------------------------------------- Viewer --
  _buildViewer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.el.viewer.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x394450, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fd4ff, 1.2);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);

    this.camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.02, 20);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.zoom = 1;

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.visible) return;
      this.holder.rotation.y += (e.clientX - this.lastX) * 0.012;
      this.holder.rotation.x = Math.max(-1.1, Math.min(1.1, this.holder.rotation.x + (e.clientY - this.lastY) * 0.008));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.55, Math.min(2, this.zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
      this._frameCamera();
    }, { passive: false });
  }

  _frameCamera() {
    // Fixed framing for every weapon (sized to the longest gun in the arsenal)
    // so relative weapon sizes are visible — an SMG should look small.
    const maxLen = Math.max(...Object.values(WEAPONS).map((d) => d.len));
    this.camera.position.set(0, 0.02, (maxLen * 0.72 + 0.12) * this.zoom);
    this.camera.lookAt(0, 0, 0);
  }

  _showModel(key) {
    this.viewKey = key;
    while (this.holder.children.length) this.holder.remove(this.holder.children[0]);
    const src = this.game.assets.weaponModels[key];
    if (src) this.holder.add(src.clone(true));
    this.holder.rotation.set(0, -Math.PI / 2, 0); // clean side profile, muzzle left
    this.zoom = 1;
    this._frameCamera();
  }

  // Load the line-art SVG icons; recolor any black-stroke ones to HUD cyan.
  async _loadIcons() {
    await Promise.all(Object.entries(WEAPONS).map(async ([key, def]) => {
      if (!def.icon) return;
      try {
        let text = await (await fetch(def.icon)).text();
        text = text.replace(/stroke:\s*#000\b/g, 'stroke: #08f7ff')
                   .replace(/stroke="black"/g, 'stroke="#08f7ff"')
                   .replace(/stroke="#000(000)?"/g, 'stroke="#08f7ff"');
        this.icons[key] = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      } catch (e) {
        console.warn(`icon failed for ${key}`, e);
      }
    }));
    this.refresh();
  }

  _resizeViewer() {
    const w = this.el.viewer.clientWidth || 640;
    const h = this.el.viewer.clientHeight || 320;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- UI --
  show(mode) {
    this.mode = mode;
    this.visible = true;
    this.game.menuOpen = true;
    this.el.overlay.style.display = 'flex';
    this.el.deploy.textContent = mode === 'deploy' ? 'DEPLOY' : 'APPLY';
    this._showModel(this.loadout.primary);
    this.refresh();
    requestAnimationFrame(() => this._resizeViewer());
  }

  hide() {
    this.visible = false;
    this.game.menuOpen = this.game.deployScreen ? this.game.deployScreen.visible : false;
    this.el.overlay.style.display = 'none';
  }

  refresh() {
    const lo = this.loadout;
    this.el.className.textContent = `${CLASSES[lo.cls].name.toUpperCase()} CLASS`;

    // tabs
    this.el.tabs.innerHTML = '';
    for (const [key, def] of Object.entries(CLASSES)) {
      const b = document.createElement('button');
      b.textContent = def.name.toUpperCase();
      b.classList.toggle('sel', lo.cls === key);
      b.onclick = () => {
        lo.cls = key;
        if (!def.secondaries.includes(lo.secondary)) lo.secondary = def.secondaries[0];
        this._showModel(lo.secondary);
        this.refresh();
      };
      this.el.tabs.appendChild(b);
    }

    // cards
    const mkCard = (key, selected, slot) => {
      const card = document.createElement('div');
      card.className = 'ar-card' + (selected ? ' sel' : '') + (this.viewKey === key ? ' viewing' : '');
      const img = document.createElement('img');
      img.src = this.icons[key] || '';
      img.draggable = false;
      const label = document.createElement('div');
      label.className = 'ar-card-name';
      label.textContent = WEAPONS[key].name;
      card.appendChild(img);
      card.appendChild(label);
      card.onclick = () => {
        if (slot === 'primary') lo.primary = key; else lo.secondary = key;
        this._showModel(key);
        this.refresh();
      };
      return card;
    };
    this.el.primaries.innerHTML = '';
    for (const key of PRIMARIES) this.el.primaries.appendChild(mkCard(key, lo.primary === key, 'primary'));
    this.el.secondaries.innerHTML = '';
    for (const key of CLASSES[lo.cls].secondaries) this.el.secondaries.appendChild(mkCard(key, lo.secondary === key, 'secondary'));

    // info panel for the viewed weapon
    const def = WEAPONS[this.viewKey];
    this.el.wpnName.textContent = def.name;
    const slotTag = PRIMARIES.includes(this.viewKey) ? 'PRIMARY' : 'CLASS WEAPON';
    this.el.tags.innerHTML = [MODE_TAGS[def.mode], slotTag].map((t) => `<span>${t}</span>`).join('');
    this.el.desc.textContent = DESCRIPTIONS[this.viewKey] || '';
    this.el.dmg.textContent = def.pellets ? `${def.dmg}×${def.pellets}` : def.dmg;
    this.el.rof.textContent = def.mode === 'charge' ? '—' : def.rpm;
    this.el.mag.textContent = def.mag;

    const bars = [
      ['PRECISION', 1 - norm(def.spreadAds, 0.001, 0.02)],
      ['HIPFIRE', 1 - norm(def.spreadHip, 0.004, 0.045)],
      ['RANGE', norm(def.falloff[1], 40, 820)],
      ['MOBILITY', 1 - norm(def.len, 0.55, 1.4)],
    ];
    this.el.bars.innerHTML = bars.map(([label, v]) =>
      `<div class="ar-bar"><label>${label}</label><div class="ar-track"><div style="width:${Math.round(v * 100)}%"></div></div></div>`
    ).join('');

    this.el.summary.textContent =
      `${CLASSES[lo.cls].name.toUpperCase()} — ${WEAPONS[lo.primary].name} + ${WEAPONS[lo.secondary].name}`;

    // keep the deploy screen's loadout strip in sync as the user picks
    if (this.game.deployScreen) this.game.deployScreen.refreshLoadout();
  }

  render() {
    if (!this.visible) return;
    this.renderer.render(this.scene, this.camera);
  }
}
