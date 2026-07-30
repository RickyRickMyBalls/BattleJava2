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

    this.post = null;      // edge-outline render pipeline, built lazily
    this._styled = false;  // map-mode material dimming active

    this._buildDom();
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this._resizeCanvas();
      if (this.post) { this.post.rtColor.dispose(); this.post.rtNormal.dispose(); this.post = null; }
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
          <div class="dp-squad-head">SQUADS</div>
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
      const maxH = Math.max(850, this.game.world.mapD * 1.6);
      this.h = Math.max(150, Math.min(maxH, this.h * (e.deltaY > 0 ? 1.12 : 0.89)));
    }, { passive: false });
  }

  _clampPan() {
    const w = this.game.world.mapW, d = this.game.world.mapD;
    this.cx = Math.max(-w / 2, Math.min(w / 2, this.cx));
    this.cz = Math.max(-d / 2, Math.min(d / 2, this.cz));
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
    for (const hq of this.game.world.hqDefs) {
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
    const hq = this.game.world.hqDefs[team];
    const pts = [{ id: 'hq', x: hq.x, z: hq.z }];
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
    this.el.root.querySelector('.dp-map').textContent = (this.game.world.def.name || 'DEMO MAP').toUpperCase();
    this.cx = 0;
    this.cz = 0;
    this.h = Math.max(600, this.game.world.mapD * 1.28);
    if (!this._spawnOk(this.selected)) this.selected = 'hq';
    this._buildMarkers();
    this._resizeCanvas();
    this.refreshLoadout();
    this.game.hud.setMode('map');
    // fog is tuned for ground level; it turns the overhead view milky
    const fog = this.game.scene.fog;
    if (fog && !this._fogFar) { this._fogFar = fog.far; this._fogNear = fog.near; }
    if (fog) { fog.near = 4000; fog.far = 8000; }
    this._applyMapStyle(true);
  }

  hide() {
    this.visible = false;
    this.el.root.style.display = 'none';
    this.game.menuOpen = this.game.armory ? this.game.armory.visible : false;
    const fog = this.game.scene.fog;
    if (fog && this._fogFar) { fog.near = this._fogNear; fog.far = this._fogFar; }
    this._applyMapStyle(false);
  }

  // Tactical map style: opaque world materials drop to 50% opacity over a dark
  // navy background, so everything picks up the blue tint through transparency.
  _applyMapStyle(on) {
    if (on === this._styled) return;
    this._styled = on;
    const scene = this.game.scene;
    if (on) {
      this._bgBackup = scene.background;
      scene.background = new THREE.Color(0x14243a);
      this._dimmed = [];
      this._ghosts = [];
      const seen = new Set();
      scene.traverse((o) => {
        if (o.isSprite || !o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          if (m.transparent) continue; // beams/domes/tracers keep their look
          this._dimmed.push({ m });
          m.transparent = true;
          m.opacity = 0.5;
          m.needsUpdate = true;
        }
        // very see-through helpers (beams, boundary walls) pollute the normal pass
        if (!Array.isArray(o.material) && o.material.transparent && o.material.opacity < 0.5) {
          this._ghosts.push(o);
        }
      });
      this.game.player.viewmodel.visible = false;
    } else {
      scene.background = this._bgBackup;
      for (const d of this._dimmed || []) {
        d.m.opacity = 1;
        d.m.transparent = false;
        d.m.needsUpdate = true;
      }
      this._dimmed = [];
      this._ghosts = [];
      this.game.player.viewmodel.visible = !this.game.playerDead;
    }
  }

  // ------------------------------------------------- outline post-process --
  _initPost(renderer) {
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    const rtColor = new THREE.WebGLRenderTarget(size.x, size.y);
    rtColor.depthTexture = new THREE.DepthTexture(size.x, size.y);
    const rtNormal = new THREE.WebGLRenderTarget(size.x, size.y);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: rtColor.texture },
        tDepth: { value: rtColor.depthTexture },
        tNormal: { value: rtNormal.texture },
        res: { value: size.clone() },
        near: { value: this.camera.near },
        far: { value: this.camera.far },
        // dense imported meshes turn the normal-edge pass into noise — depth only
        thinAmp: { value: this.game.world.def.type === 'glb' ? 0.0 : 1.0 },
        depthRange: { value: this.game.world.def.type === 'glb' ? new THREE.Vector2(3.5, 7.0) : new THREE.Vector2(1.0, 2.2) },
        // renderer may store logarithmic depth — decode must match
        logDepth: { value: renderer.capabilities.logarithmicDepthBuffer ? 1.0 : 0.0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */`
        #include <packing>
        varying vec2 vUv;
        uniform sampler2D tColor, tDepth, tNormal;
        uniform vec2 res;
        uniform float near, far, thinAmp, logDepth;
        uniform vec2 depthRange;

        float readDepth(vec2 uv) {
          float z = texture2D(tDepth, uv).x;
          if (logDepth > 0.5) {
            // three.js log depth: z = log2(1+w)/log2(far+1), w = eye distance
            return exp2(z * log2(far + 1.0)) - 1.0;
          }
          return -perspectiveDepthToViewZ(z, near, far);
        }

        void main() {
          vec4 base = texture2D(tColor, vUv);
          vec2 px = 1.0 / res;

          // thick bright silhouette: depth discontinuity (object vs ground)
          float c = readDepth(vUv);
          float dd = 0.0;
          dd = max(dd, abs(readDepth(vUv + vec2(px.x * 2.0, 0.0)) - c));
          dd = max(dd, abs(readDepth(vUv - vec2(px.x * 2.0, 0.0)) - c));
          dd = max(dd, abs(readDepth(vUv + vec2(0.0, px.y * 2.0)) - c));
          dd = max(dd, abs(readDepth(vUv - vec2(0.0, px.y * 2.0)) - c));
          float thick = smoothstep(depthRange.x, depthRange.y, dd);

          // thin interior edges: normal discontinuity (facets, creases)
          vec3 n = texture2D(tNormal, vUv).rgb;
          float nd = 0.0;
          nd = max(nd, distance(texture2D(tNormal, vUv + vec2(px.x, 0.0)).rgb, n));
          nd = max(nd, distance(texture2D(tNormal, vUv - vec2(px.x, 0.0)).rgb, n));
          nd = max(nd, distance(texture2D(tNormal, vUv + vec2(0.0, px.y)).rgb, n));
          nd = max(nd, distance(texture2D(tNormal, vUv - vec2(0.0, px.y)).rgb, n));
          float thin = smoothstep(0.35, 0.8, nd) * (1.0 - thick) * thinAmp;

          vec3 col = base.rgb
            + thin * vec3(0.06, 0.22, 0.45)
            + thick * vec3(0.25, 0.55, 0.95);
          // render targets hold linear color; convert for the screen
          col = pow(col, vec3(0.4545));
          gl_FragColor = vec4(col, base.a);
        }`,
    });

    const quadScene = new THREE.Scene();
    quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.post = { rtColor, rtNormal, material, quadScene, quadCam, normalMat: new THREE.MeshNormalMaterial() };
  }

  // Render the map view. Styled (dimmed + outlines) normally; plain during the
  // deploy dive so the world "comes back to life" as you drop in.
  renderFrame(renderer) {
    const scene = this.game.scene;
    if (!this._styled || this.transition) {
      renderer.render(scene, this.camera);
      return;
    }
    if (!this.post) this._initPost(renderer);
    const p = this.post;

    renderer.setRenderTarget(p.rtColor);
    renderer.render(scene, this.camera);

    for (const o of this._ghosts) o.visible = false;
    scene.overrideMaterial = p.normalMat;
    renderer.setRenderTarget(p.rtNormal);
    renderer.render(scene, this.camera);
    scene.overrideMaterial = null;
    for (const o of this._ghosts) o.visible = true;

    renderer.setRenderTarget(null);
    renderer.render(p.quadScene, p.quadCam);
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
    this._applyMapStyle(false); // the dive shows the world in full color
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
    const squad = g.playerSquad;

    for (const s of g.teams[g.playerTeam].soldiers) {
      if (!s.alive || s.isPlayer) continue;
      const p = this._project(s.pos.x, s.pos.z);
      if (p.behind) continue;
      const isSquad = !!squad && s.squad === squad;
      ctx.fillStyle = isSquad ? '#3ddc7a' : '#3aa0ff';
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
    const squads = g.teams[g.playerTeam].squads;
    const rows = squads.map((sq, i) => {
      const mine = sq === g.playerSquad;
      const slots = sq.members.map((m) =>
        `<span class="dp-slot${m.alive ? '' : ' dead'}${m.isPlayer ? ' you' : ''}" title="${m.isPlayer ? 'You' : m.name}">${m.isPlayer ? '★' : m.cls[0].toUpperCase()}</span>`
      ).join('');
      const btn = mine
        ? `<button class="dp-sq-btn leave" data-i="${i}">LEAVE</button>`
        : `<button class="dp-sq-btn" data-i="${i}"${sq.members.length >= 5 ? ' disabled' : ''}>JOIN</button>`;
      const members = mine
        ? `<div class="dp-sq-members">${sq.members.filter((m) => !m.isPlayer).map((m) =>
            `<div class="dp-mate${m.alive ? '' : ' dead'}">
              <span class="dp-mate-cls">${m.cls[0].toUpperCase()}</span>
              <span>${m.name}</span>
              <span class="dp-mate-k">${m.kills}</span>
            </div>`).join('')}</div>`
        : '';
      return `<div class="dp-sq-row${mine ? ' mine' : ''}">
        <div class="dp-sq-top">
          <span class="dp-sq-name">${sq.name.toUpperCase()}</span>
          <span class="dp-sq-slots">${slots}</span>
          ${btn}
        </div>${members}</div>`;
    });
    this.el.squad.innerHTML = rows.join('');
    for (const b of this.el.squad.querySelectorAll('.dp-sq-btn')) {
      b.onclick = () => {
        const sq = squads[Number(b.dataset.i)];
        g.joinSquad(sq === g.playerSquad ? null : sq);
        this._updateSquadPanel();
      };
    }
  }
}
