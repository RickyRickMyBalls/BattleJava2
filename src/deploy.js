// Deploy screen: live top-down map hub. Shows the real battlefield through an
// overhead camera, DOM markers for sectors/HQs (clickable spawn points), a
// canvas layer for soldier dots, loadout strip, and the deploy dive transition.

import * as THREE from 'three';
import { CFG, TEAM, WEAPONS, CLASSES } from './config.js';
import { terrainHeight } from './world.js';

const _v = new THREE.Vector3();
const EASE = (t) => t * t * (3 - 2 * t);

export class DeployScreen {
  constructor(game) {
    this.game = game;
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 3000);
    this.visible = false;
    this.mode = 'initial';
    this.cx = 0;
    this.cz = 0;
    this.h = 720;                 // camera height = zoom level
    this.selected = 'hq';
    this.timer = 0;
    this.transition = null;
    this.dragging = false;
    this.squadRefresh = 0;

    this._buildDom();
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this._resizeCanvas();
    });
  }

  // ------------------------------------------------------------------ DOM --
  _buildDom() {
    const el = document.createElement('div');
    el.id = 'deploy';
    el.innerHTML = `
      <canvas id="dpDots"></canvas>
      <div id="dpMapLayer"></div>
      <div class="dp-chrome">
        <div class="dp-title">
          <div class="dp-mode">SECTOR CONTROL</div>
          <div class="dp-map">FRONTIER VALLEY</div>
        </div>
        <div class="dp-killed" id="dpKilled"></div>
        <div class="dp-squad" id="dpSquadPanel">
          <div class="dp-squad-head">ALPHA SQUAD</div>
          <div id="dpSquad"></div>
        </div>
        <div class="dp-bottom">
          <div class="dp-loadout">
            <div class="dp-lo-head">
              <div class="dp-lo-class" id="dpLoClass"></div>
              <button id="dpCustomize">CUSTOMIZE</button>
            </div>
            <div class="dp-lo-icons" id="dpLoIcons"></div>
          </div>
          <button id="dpDeploy" disabled>DEPLOY</button>
        </div>
        <div class="dp-hint">SCROLL zoom · DRAG pan · CLICK a spawn point</div>
      </div>`;
    document.body.appendChild(el);
    this.el = {
      root: el,
      dots: el.querySelector('#dpDots'),
      mapLayer: el.querySelector('#dpMapLayer'),
      chrome: el.querySelector('.dp-chrome'),
      killed: el.querySelector('#dpKilled'),
      squad: el.querySelector('#dpSquad'),
      loClass: el.querySelector('#dpLoClass'),
      loIcons: el.querySelector('#dpLoIcons'),
      customize: el.querySelector('#dpCustomize'),
      deploy: el.querySelector('#dpDeploy'),
    };
    this.ctx = this.el.dots.getContext('2d');

    this.el.customize.onclick = () => {
      if (this.game.armory) this.game.armory.show('apply');
    };
    this.el.deploy.onclick = () => this._onDeployClick();

    // pan / zoom on the map layer
    const ml = this.el.mapLayer;
    ml.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.visible || this.transition) return;
      const wpp = (2 * this.h * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / window.innerHeight;
      this.cx -= (e.clientX - this.lastX) * wpp;
      this.cz -= (e.clientY - this.lastY) * wpp;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this._clampPan();
    });
    ml.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.h = Math.max(150, Math.min(850, this.h * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, { passive: false });
  }

  _clampPan() {
    this.cx = Math.max(-CFG.map.w / 2, Math.min(CFG.map.w / 2, this.cx));
    this.cz = Math.max(-CFG.map.d / 2, Math.min(CFG.map.d / 2, this.cz));
  }

  _resizeCanvas() {
    this.el.dots.width = window.innerWidth;
    this.el.dots.height = window.innerHeight;
  }

  // Build spawn/sector markers fresh on each show.
  _buildMarkers() {
    this.el.mapLayer.innerHTML = '';
    this.markers = [];
    const team = this.game.playerTeam;
    for (const hq of CFG.hq) {
      const m = document.createElement('div');
      m.className = 'dp-hq' + (hq.team === team ? ' own' : ' enemy');
      m.textContent = 'HQ';
      this.el.mapLayer.appendChild(m);
      const id = hq.team === team ? 'hq' : 'hq-enemy';
      m.addEventListener('mousedown', (e) => e.stopPropagation());
      if (hq.team === team) {
        m.title = 'Spawn at headquarters';
        m.onclick = () => this._select(id);
      }
      this.markers.push({ id, el: m, x: hq.x, z: hq.z, spawnable: hq.team === team });
    }
    for (const sec of this.game.world.sectors) {
      const m = document.createElement('div');
      m.className = 'dp-sector';
      m.textContent = sec.id;
      this.el.mapLayer.appendChild(m);
      m.addEventListener('mousedown', (e) => e.stopPropagation());
      m.onclick = () => { if (this._spawnOk(sec.id)) this._select(sec.id); };
      this.markers.push({ id: sec.id, el: m, sec, x: sec.x, z: sec.z });
    }
  }

  _spawnPoints() {
    const team = this.game.playerTeam;
    const pts = [{ id: 'hq', x: CFG.hq[team].x, z: CFG.hq[team].z }];
    for (const sec of this.game.world.sectors) {
      if (sec.owner === team && !sec.contested) pts.push({ id: sec.id, x: sec.x, z: sec.z });
    }
    return pts;
  }

  _spawnOk(id) {
    return this._spawnPoints().some((p) => p.id === id);
  }

  _select(id) {
    this.selected = id;
  }

  // ------------------------------------------------------------- lifecycle --
  show(mode, killerName) {
    this.mode = mode;
    this.visible = true;
    this.transition = null;
    this.game.menuOpen = true;
    this.el.root.style.display = 'block';
    this.el.root.classList.remove('transitioning');
    this.el.killed.textContent = killerName ? `KILLED BY ${killerName}` : '';
    this.cx = 0;
    this.cz = 0;
    this.h = 720;
    if (!this._spawnOk(this.selected)) this.selected = 'hq';
    this._buildMarkers();
    this._resizeCanvas();
    this.refreshLoadout();
    this.game.hud.setMode('map');
    // fog is tuned for ground level; it turns the overhead view milky
    const fog = this.game.scene.fog;
    if (fog && !this._fogFar) { this._fogFar = fog.far; this._fogNear = fog.near; }
    if (fog) { fog.near = 4000; fog.far = 8000; }
  }

  hide() {
    this.visible = false;
    this.el.root.style.display = 'none';
    this.game.menuOpen = this.game.armory ? this.game.armory.visible : false;
    const fog = this.game.scene.fog;
    if (fog && this._fogFar) { fog.near = this._fogNear; fog.far = this._fogFar; }
  }

  setTimer(t) {
    this.timer = t;
  }

  refreshLoadout() {
    const lo = this.game.playerLoadout;
    this.el.loClass.textContent = CLASSES[lo.cls].name.toUpperCase();
    const icons = (this.game.armory && this.game.armory.icons) || {};
    const slot = (key, label) => {
      const def = WEAPONS[key];
      const img = icons[key]
        ? `<img src="${icons[key]}" draggable="false">`
        : `<span class="dp-lo-fallback">${def.name.split(' ')[0]}</span>`;
      return `<div class="dp-lo-slot" title="${def.name}">${img}<span class="dp-lo-num">${label}</span></div>`;
    };
    this.el.loIcons.innerHTML = slot(lo.primary, '1') + slot(lo.secondary, '2');
  }

  _onDeployClick() {
    if (this.el.deploy.disabled || this.transition) return;
    if (!this._spawnOk(this.selected)) return;
    const pt = this._spawnPoints().find((p) => p.id === this.selected);
    this.game.audio.resume();
    // jittered exact landing spot, kept inside the map
    const a = Math.random() * Math.PI * 2;
    const r = 5 + Math.random() * 6;
    const x = pt.x + Math.cos(a) * r;
    const z = pt.z + Math.sin(a) * r;
    this._startTransition(x, z);
  }

  _startTransition(x, z) {
    const eyeY = terrainHeight(x, z) + CFG.player.eyeHeight;
    const yaw = Math.atan2(-x, -z) + Math.PI; // face map center, matches spawnAt
    this.transition = {
      t: 0,
      x, z,
      fromPos: new THREE.Vector3(this.cx, this.h, this.cz),
      toPos: new THREE.Vector3(x, eyeY, z),
      fromQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)),
      toQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')),
    };
    this.el.root.classList.add('transitioning');
  }

  _finishTransition() {
    const { x, z } = this.transition;
    this.transition = null;
    this.game.deployPlayerAt(x, z);
    this.hide();
    this.game.hud.setMode('fps');
    this.game.player.requestLock();
  }

  // ---------------------------------------------------------------- update --
  update(dt) {
    if (!this.visible) return;

    if (this.transition) {
      const tr = this.transition;
      tr.t += dt / 1.15;
      const k = EASE(Math.min(1, tr.t));
      this.camera.position.lerpVectors(tr.fromPos, tr.toPos, k);
      this.camera.quaternion.slerpQuaternions(tr.fromQuat, tr.toQuat, k);
      if (tr.t >= 1) this._finishTransition();
      return;
    }

    this.camera.position.set(this.cx, this.h, this.cz);
    this.camera.rotation.set(-Math.PI / 2, 0, 0);
    this.camera.updateMatrixWorld();

    this._updateMarkers();
    this._drawDots();
    this._updateDeployButton();

    this.squadRefresh -= dt;
    if (this.squadRefresh <= 0) {
      this.squadRefresh = 0.5;
      this._updateSquadPanel();
    }
  }

  _project(x, z) {
    _v.set(x, terrainHeight(x, z), z).project(this.camera);
    return {
      sx: (_v.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-_v.y * 0.5 + 0.5) * window.innerHeight,
      behind: _v.z > 1,
    };
  }

  _updateMarkers() {
    const team = this.game.playerTeam;
    for (const m of this.markers) {
      const p = this._project(m.x, m.z);
      m.el.style.transform = `translate(${p.sx}px, ${p.sy}px) translate(-50%, -50%)`;
      if (m.sec) {
        const sec = m.sec;
        const ownCls = sec.owner === TEAM.BLUE ? 'blue' : sec.owner === TEAM.RED ? 'red' : 'neutral';
        const ok = this._spawnOk(sec.id);
        m.el.className = `dp-sector ${ownCls}` +
          (sec.contested ? ' contested' : '') +
          (ok ? ' spawnable' : '') +
          (this.selected === sec.id ? ' sel' : '');
      } else if (m.spawnable) {
        m.el.className = 'dp-hq own' + (this.selected === 'hq' ? ' sel' : '');
      }
    }
    // fell out from under us? (sector lost while browsing)
    if (!this._spawnOk(this.selected)) this.selected = 'hq';
  }

  _drawDots() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.el.dots.width, this.el.dots.height);
    const g = this.game;
    const squad = g.teams[g.playerTeam].squads[0];

    for (const s of g.teams[g.playerTeam].soldiers) {
      if (!s.alive || s.isPlayer) continue;
      const p = this._project(s.pos.x, s.pos.z);
      if (p.behind) continue;
      const isSquad = s.squad === squad;
      ctx.fillStyle = isSquad ? '#9fe8ff' : '#3aa0ff';
      if (isSquad) {
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#ff5a4d';
    for (const [s] of this.game.hud.spottedShooters) {
      if (!s.alive) continue;
      const p = this._project(s.pos.x, s.pos.z);
      if (p.behind) continue;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _updateDeployButton() {
    const waiting = this.timer > 0;
    const ok = this._spawnOk(this.selected) && !waiting && !this.game.gameOver;
    this.el.deploy.disabled = !ok;
    this.el.deploy.textContent = waiting ? `DEPLOY IN ${Math.ceil(this.timer)}` : 'DEPLOY';
  }

  _updateSquadPanel() {
    const g = this.game;
    const squad = g.teams[g.playerTeam].squads[0];
    const rows = [];
    for (const m of squad.members) {
      if (m.isPlayer) continue;
      rows.push(`<div class="dp-mate${m.alive ? '' : ' dead'}">
        <span class="dp-mate-cls">${m.cls[0].toUpperCase()}</span>
        <span>${m.name}</span>
        <span class="dp-mate-k">${m.kills}</span>
      </div>`);
    }
    this.el.squad.innerHTML = rows.join('');
  }
}
