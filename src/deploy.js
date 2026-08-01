// Deploy screen: live top-down map hub. Shows the real battlefield through an
// overhead camera, DOM markers for sectors/HQs (clickable spawn points), a
// canvas layer for soldier dots, loadout strip, and the deploy dive transition.

import * as THREE from 'three';
import { CFG, TEAM } from './config.js';
import { saveBook } from './loadout.js';
import { LoadoutBar } from './loadoutbar.js';
import { terrainHeight } from './world.js';

const _v = new THREE.Vector3();
const EASE = (t) => t * t * (3 - 2 * t);

// Helmet-cam mount relative to the head bone (meters, scale-compensated
// holder like the weapon grip). Orientation is stabilized per-frame from the
// soldier's yaw — position inherits the head bob, horizon stays level.
const HEAD_CAM = { pos: [0, 0.12, 0.10] };
const _pq = new THREE.Quaternion();
const _pe = new THREE.Euler();

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
    // legacy triangle-wireframe overlay on Collision_floor meshes; replaced
    // by the world-space shader grid — flip to true to bring it back
    this.meshWireframe = false;

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
      <div class="dp-vignette"></div>
      <div class="dp-chrome">
        <div class="dp-title">
          <div class="dp-mode">SECTOR CONTROL</div>
          <div class="dp-map">FRONTIER VALLEY</div>
        </div>
        <div class="dp-status" id="dpStatus"></div>
        <div class="dp-header">
          <div class="dp-tk-row">
            <span class="dp-tk blue" id="dpTkBlue">400</span>
            <div class="dp-tkbar blue"><div id="dpTkBarBlue"></div></div>
            <span class="dp-timer" id="dpTimer">00:00</span>
            <div class="dp-tkbar red"><div id="dpTkBarRed"></div></div>
            <span class="dp-tk red" id="dpTkRed">400</span>
          </div>
          <div class="dp-chips" id="dpChips"></div>
          <div class="dp-tc" id="dpTc">
            <button data-tc="pause" title="Pause (P)">❚❚</button>
            <button data-tc="1">1x</button>
            <button data-tc="2">2x</button>
            <button data-tc="4">4x</button>
            <button data-tc="8">8x</button>
          </div>
        </div>
        <div class="dp-killed" id="dpKilled"></div>
        <div class="dp-squad" id="dpSquadPanel">
          <div class="dp-squad-head">SQUADS <button id="dpTeamBtn"></button></div>
          <div id="dpSquad"></div>
        </div>
        <div class="dp-pip" id="dpPip" style="display:none">
          <div class="dp-pip-head">
            <span id="dpPipName"></span>
            <span id="dpPipHp"></span>
            <button id="dpPipClose">✕</button>
          </div>
          <div class="dp-pip-view" id="dpPipView"><div class="dp-pip-kia" id="dpPipKia">K.I.A.</div></div>
        </div>
        <!-- LoadoutBar mounts here. The lobby mounts the same component, so
             the fast path (class -> kit -> deploy) looks and behaves the same
             on both screens without either owning the markup. -->
        <div class="dp-load2" id="dpLoadoutBar"></div>
        <div class="dp-bottom">
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
      loadoutBar: el.querySelector('#dpLoadoutBar'),
      deploy: el.querySelector('#dpDeploy'),
      status: el.querySelector('#dpStatus'),
      tkBlue: el.querySelector('#dpTkBlue'),
      tkRed: el.querySelector('#dpTkRed'),
      tkBarBlue: el.querySelector('#dpTkBarBlue'),
      tkBarRed: el.querySelector('#dpTkBarRed'),
      timer: el.querySelector('#dpTimer'),
      chips: el.querySelector('#dpChips'),
      tc: el.querySelector('#dpTc'),
      teamBtn: el.querySelector('#dpTeamBtn'),
      pip: el.querySelector('#dpPip'),
      pipName: el.querySelector('#dpPipName'),
      pipHp: el.querySelector('#dpPipHp'),
      pipView: el.querySelector('#dpPipView'),
      pipKia: el.querySelector('#dpPipKia'),
    };
    el.querySelector('#dpPipClose').onclick = () => this.unwatch();
    this.watched = null;
    this.pipCamera = null;
    this.pipHolder = null;
    this.kiaTimer = 0;
    this.el.teamBtn.onclick = () => {
      const g = this.game;
      if (g.setPlayerTeam(1 - g.playerTeam)) {
        this.selected = 'hq';
        this._buildMarkers();
        this._updateSquadPanel();
        this._updateTeamBtn();
      }
    };
    this.ctx = this.el.dots.getContext('2d');

    this.el.deploy.onclick = () => this._onDeployClick();
    for (const b of this.el.tc.querySelectorAll('button')) {
      b.onclick = () => {
        if (b.dataset.tc === 'pause') this.game.togglePause();
        else this.game.setTimeScale(Number(b.dataset.tc));
      };
    }

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
    // The rally marker is built unconditionally and hidden when there is no
    // beacon, rather than built on demand: markers are only rebuilt on show(),
    // and a beacon can be planted or destroyed while this screen is open. One
    // element whose visibility tracks the squad is cheaper and cannot go stale.
    const bm = document.createElement('div');
    bm.className = 'dp-beacon';
    bm.textContent = 'R';
    bm.title = 'Spawn on your squad rally beacon';
    bm.style.display = 'none';
    this.el.mapLayer.appendChild(bm);
    bm.addEventListener('mousedown', (e) => e.stopPropagation());
    bm.onclick = () => { if (this._spawnOk('beacon')) this._select('beacon'); };
    this.markers.push({ id: 'beacon', el: bm, rally: true, x: 0, z: 0 });
  }

  // Every place the player may enter the field. The single source of truth for
  // the whole screen — markers, the canvas, the DEPLOY button and the "did my
  // choice just fall out from under me" check in _updateMarkers all read this,
  // which is why a rally beacon becomes a spawn option here and nowhere else.
  _spawnPoints() {
    const team = this.game.playerTeam;
    const hq = this.game.world.hqDefs[team];
    const pts = [{ id: 'hq', x: hq.x, z: hq.z }];
    // The squad's rally, while it stands. Listed straight after HQ because it
    // is the forward option, and it can vanish between two frames of this
    // screen being open — the enemy can be shooting it right now — which the
    // per-frame revalidation below already handles.
    const rally = this.game.playerSquad && this.game.playerSquad.beacon;
    if (rally) pts.push({ id: 'beacon', x: rally.pos.x, z: rally.pos.z });
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
    this._buildChips();
    this._resizeCanvas();
    this.refreshLoadout();
    this._updateTeamBtn();
    this._updateStatus();
    this.game.hud.setMode('map');
    // fog is tuned for ground level; it turns the overhead view milky
    const fog = this.game.scene.fog;
    if (fog && !this._fogFar) { this._fogFar = fog.far; this._fogNear = fog.near; }
    if (fog) { fog.near = 4000; fog.far = 8000; }
    this._buildFloorEdges();
    this._applyMapStyle(true);
  }

  // White line-work on the floor-collision structures (bridges, roads,
  // tunnels) so they read as blueprints on the tactical map.
  _buildFloorEdges() {
    if (!this.meshWireframe) return;
    if (this._floorEdgesFor === this.game.world.def) return;
    this._floorEdgesFor = this.game.world.def;
    if (this._floorEdges) { this.game.scene.remove(this._floorEdges); this._floorEdges = null; }
    let parent = null;
    this.game.scene.traverse((o) => { if (!parent && /^collision_floor/i.test(o.name)) parent = o; });
    if (!parent) return;
    this.game.scene.updateMatrixWorld(true);
    const group = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1, depthWrite: false });
    this._floorEdgeMat = mat;
    parent.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      // full wireframe: every triangle edge, blueprint-grid look
      const ls = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), mat);
      ls.matrixAutoUpdate = false;
      ls.matrix.copy(o.matrixWorld);
      group.add(ls);
    });
    // lift the lines off the surfaces they trace — coplanar lines z-fight
    // (flicker) against their own mesh; from the overhead camera ~1m of
    // offset is invisible but settles the depth test for good
    group.position.y = 1.0;
    group.visible = false;
    this.game.scene.add(group);
    this._floorEdges = group;
  }

  hide() {
    this.visible = false;
    this.unwatch();
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
    if (this._floorEdges) this._floorEdges.visible = on && this.meshWireframe;
    if (on) {
      this._bgBackup = scene.background;
      this._mapBg = new THREE.Color(0x060b16);
      scene.background = this._mapBg;
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
        // dense imported meshes turn the normal-edge pass into noise — depth
        // only; floor structures get real EdgesGeometry lines instead
        thinAmp: { value: this.game.world.def.type === 'glb' ? 0.0 : 1.0 },
        thinThresh: { value: new THREE.Vector2(0.35, 0.8) },
        thinCol: { value: new THREE.Vector3(0.06, 0.22, 0.45) },
        depthRange: { value: this.game.world.def.type === 'glb' ? new THREE.Vector2(3.5, 7.0) : new THREE.Vector2(1.0, 2.2) },
        // renderer may store logarithmic depth — decode must match
        logDepth: { value: renderer.capabilities.logarithmicDepthBuffer ? 1.0 : 0.0 },
        // world-position reconstruction for the tactical grid
        projInv: { value: new THREE.Matrix4() },
        camMat: { value: new THREE.Matrix4() },
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
        uniform vec2 depthRange, thinThresh;
        uniform vec3 thinCol;
        uniform mat4 projInv, camMat;

        // ---- tactical grid config (world meters) ----
        #define GRID_STEP  3.0     // minor line spacing
        #define GRID_MID   5.0     // every 5th minor line -> mid line (15m)
        #define GRID_MAJOR 35.0    // every 35th minor line -> major line (105m)

        // 1.0 on a grid line (~1px wide, antialiased), 0.0 between lines
        float gridLine(float coord, float spacing) {
          float d = abs(fract(coord / spacing - 0.5) - 0.5) * spacing / max(fwidth(coord), 1e-4);
          return 1.0 - min(d, 1.0);
        }

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
          float thin = smoothstep(thinThresh.x, thinThresh.y, nd) * (1.0 - thick) * thinAmp;

          vec3 col = base.rgb
            + thin * thinCol
            + thick * vec3(0.25, 0.55, 0.95);

          float bg = step(0.99999, texture2D(tDepth, vUv).x);

          // ---- tactical grid: world-space lines draped over the terrain ----
          // reconstruct this pixel's world position from its depth
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 vr = projInv * vec4(ndc, -1.0, 1.0);
          vec3 dir = vr.xyz / vr.w;
          dir /= -dir.z;                       // view ray scaled to viewZ = -1
          vec3 wpos = (camMat * vec4(dir * c, 1.0)).xyz;

          float gMinor = max(gridLine(wpos.x, GRID_STEP), gridLine(wpos.z, GRID_STEP));
          float gMid   = max(gridLine(wpos.x, GRID_STEP * GRID_MID), gridLine(wpos.z, GRID_STEP * GRID_MID));
          float gMajor = max(gridLine(wpos.x, GRID_STEP * GRID_MAJOR), gridLine(wpos.z, GRID_STEP * GRID_MAJOR));
          float onGeom = 1.0 - bg;
          // minor: dark, faint  |  mid: white  |  major: bright blue
          col = mix(col, vec3(0.004), gMinor * 0.25 * (1.0 - max(gMid, gMajor)) * onGeom);
          col = mix(col, vec3(0.55, 0.60, 0.66), gMid * 0.40 * (1.0 - gMajor) * onGeom);
          col = mix(col, vec3(0.08, 0.42, 1.00), gMajor * 0.85 * onGeom);

          // outside the battlefield (no geometry): dark tactical backdrop
          // with a faint blocky pattern + coarse grid, instead of flat sky
          vec2 cell = floor(vUv * res / 26.0);
          float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
          vec3 pat = vec3(0.016, 0.024, 0.038) + h * vec3(0.010, 0.014, 0.020);
          float grid = step(0.985, fract(vUv.x * res.x / 108.0)) + step(0.985, fract(vUv.y * res.y / 108.0));
          pat += grid * vec3(0.010, 0.016, 0.024);
          col = mix(col, pat, bg);

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
      this._renderPip(renderer);
      return;
    }
    if (!this.post) this._initPost(renderer);
    const p = this.post;

    // wireframe density scales with zoom: from high up the terrain triangles
    // are subpixel and the full grid would white out the map — fade it in as
    // the camera drops and the lines actually resolve
    if (this._floorEdgeMat) {
      this._floorEdgeMat.opacity = THREE.MathUtils.clamp(
        THREE.MathUtils.mapLinear(this.h, 700, 220, 0.10, 0.45), 0.10, 0.45);
    }

    // grid shader reconstructs world positions from this frame's camera
    this.camera.updateMatrixWorld();
    p.material.uniforms.projInv.value.copy(this.camera.projectionMatrixInverse);
    p.material.uniforms.camMat.value.copy(this.camera.matrixWorld);

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
    this._renderPip(renderer);
  }

  setTimer(t) {
    this.timer = t;
  }

  // The armoury and the lobby preview read the same loadout object, and the
  // armoury already calls back into here when it changes something. This is the
  // other direction — without it, applying a preset would leave the armoury
  // showing the kit you had before you picked one.
  _syncScreens() {
    if (this.game.session) saveBook(this.game.session.loadouts);
    if (this.game.armory && this.game.armory.visible) this.game.armory.refresh();
    if (this.game.lobby && this.game.lobby.active) this.game.lobby.refreshPreview();
  }

  // The bar is a shared component (see loadoutbar.js); the lobby mounts the
  // same one. This screen only owns WHEN it refreshes and what happens after.
  refreshLoadout() {
    const game = this.game;
    if (!this.bar) {
      this.bar = new LoadoutBar({
        get session() { return game.session; },
        get armory() { return game.armory; },
        get loadout() { return game.playerLoadout; },
        onChange: () => this._syncScreens(),
      }).mount(this.el.loadoutBar);
    }
    this.bar.refresh();
  }

  _buildChips() {
    this.el.chips.innerHTML = '';
    this.chipEls = [];
    for (const sec of this.game.world.sectors) {
      const c = document.createElement('span');
      c.className = 'dp-chip';
      c.textContent = sec.id;
      this.el.chips.appendChild(c);
      this.chipEls.push({ el: c, sec });
    }
  }

  _updateHeader() {
    const g = this.game;
    this.el.tkBlue.textContent = Math.max(0, Math.ceil(g.teams[0].tickets));
    this.el.tkRed.textContent = Math.max(0, Math.ceil(g.teams[1].tickets));
    this.el.tkBarBlue.style.width = `${Math.max(0, (g.teams[0].tickets / CFG.tickets) * 100)}%`;
    this.el.tkBarRed.style.width = `${Math.max(0, (g.teams[1].tickets / CFG.tickets) * 100)}%`;
    const t = Math.floor(g.elapsed);
    this.el.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    for (const { el, sec } of this.chipEls || []) {
      el.className = 'dp-chip' +
        (sec.owner === TEAM.BLUE ? ' blue' : sec.owner === TEAM.RED ? ' red' : '') +
        (sec.contested ? ' contested' : '');
    }
    // time-control states
    for (const b of this.el.tc.querySelectorAll('button')) {
      if (b.dataset.tc === 'pause') b.classList.toggle('sel', g.paused);
      else b.classList.toggle('sel', !g.paused && g.timeScale === Number(b.dataset.tc));
    }
  }

  _updateStatus() {
    const g = this.game;
    const mine = g.playerTeam;
    const rows = g.world.sectors.map((sec) => {
      let cls = 'neutral', txt = 'NEUTRAL';
      if (sec.contested) { cls = 'contested'; txt = 'CONTESTED'; }
      else if (sec.owner === mine) { cls = 'mine'; txt = 'SECURED'; }
      else if (sec.owner !== null) { cls = 'enemy'; txt = 'ENEMY CONTROL'; }
      return `<div class="dp-st-row ${cls}"><span class="dp-st-id">${sec.id}</span><span>${txt}</span></div>`;
    });
    this.el.status.innerHTML = `<div class="dp-st-head">STATUS</div>` + rows.join('');
  }

  _onDeployClick() {
    if (this.el.deploy.disabled || this.transition) return;
    if (!this._spawnOk(this.selected)) return;
    const pt = this._spawnPoints().find((p) => p.id === this.selected);
    this.game.audio.resume();
    // jittered exact landing spot, kept inside the map
    const a = Math.random() * Math.PI * 2;
    // A rally lands you tight. The 5-11 m scatter is right for an HQ or a
    // sector, where it stops a squad stacking on one pixel, and wrong for a
    // beacon: that one was planted in cover deliberately, and 11 m from it is
    // the open ground the leader was avoiding. Matches the radius bots use in
    // game._respawnAI, so the whole squad arrives in the same pocket.
    const r = this.selected === 'beacon'
      ? CFG.beacon.spawnRadius * (0.45 + Math.random() * 0.55)
      : 5 + Math.random() * 6;
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
    this.unwatch();
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
    this._updatePip(dt);
    this._updateHeader();

    this.squadRefresh -= dt;
    if (this.squadRefresh <= 0) {
      this.squadRefresh = 0.5;
      this._updateSquadPanel();
      this._updateStatus();
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
      if (m.rally) {
        const b = this.game.playerSquad && this.game.playerSquad.beacon;
        m.el.style.display = b ? 'flex' : 'none';
        if (!b) continue;
        // Tracked live rather than captured at build time — a squad's rally is
        // wherever the leader last planted one, and this screen outlives that
        // decision.
        m.x = b.pos.x; m.z = b.pos.z;
      }
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
        // capture-progress arc
        const prog = Math.abs(sec.progress);
        if (prog > 2 && prog < 100) {
          m.el.style.setProperty('--cap', `${prog}%`);
          m.el.style.setProperty('--capcol', sec.progress > 0 ? '#3aa0ff' : '#ff5a4d');
        } else {
          m.el.style.setProperty('--cap', '0%');
        }
      } else if (m.rally) {
        m.el.className = 'dp-beacon' + (this.selected === 'beacon' ? ' sel' : '');
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

  // ------------------------------------------------------- helmet cam --
  watch(soldier) {
    if (!soldier || !soldier.alive || soldier.isPlayer || !soldier.headBone) return;
    this.unwatch();
    if (!this.pipCamera) {
      this.pipCamera = new THREE.PerspectiveCamera(72, 16 / 9, 0.08, 2000);
    }
    soldier.mesh.updateMatrixWorld(true);
    const ws = new THREE.Vector3();
    soldier.headBone.getWorldScale(ws);
    this.pipHolder = new THREE.Group();
    this.pipHolder.scale.setScalar(1 / (ws.x || 1));
    soldier.headBone.add(this.pipHolder);
    this.pipCamera.position.set(...HEAD_CAM.pos);
    this.pipHolder.add(this.pipCamera);

    this.watched = soldier;
    this.game.spectatedSoldier = soldier;
    this.kiaTimer = 0;
    this.el.pip.style.display = 'block';
    this.el.pipKia.style.display = 'none';
    this.el.pipName.textContent = `${soldier.name} · ${soldier.cls.toUpperCase()}`;
  }

  unwatch() {
    if (this.pipHolder && this.pipHolder.parent) this.pipHolder.parent.remove(this.pipHolder);
    this.pipHolder = null;
    this.watched = null;
    this.game.spectatedSoldier = null;
    this.kiaTimer = 0;
    this.el.pip.style.display = 'none';
  }

  _updatePip(dt) {
    if (!this.watched) return;
    const s = this.watched;
    this.el.pipHp.textContent = s.alive ? `${Math.max(0, Math.round(s.shield + s.health))} HP` : '';
    if (!s.alive && this.kiaTimer <= 0) {
      this.kiaTimer = 1.4; // linger on the death cam, then hop to a squadmate
      this.el.pipKia.style.display = 'flex';
    }
    if (this.kiaTimer > 0) {
      this.kiaTimer -= dt;
      if (this.kiaTimer <= 0) {
        const squad = s.squad;
        const next = squad && squad.members.find((m) => m.alive && !m.isPlayer && m !== s);
        this.el.pipKia.style.display = 'none';
        if (next) this.watch(next);
        else this.unwatch();
      }
    }
  }

  _renderPip(renderer) {
    if (!this.watched || this.transition) return;
    const rect = this.el.pipView.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    this.pipCamera.aspect = rect.width / rect.height;
    this.pipCamera.updateProjectionMatrix();

    // stabilized orientation: level horizon, facing the soldier's aim yaw
    this.watched.mesh.updateMatrixWorld(true);
    this.pipHolder.getWorldQuaternion(_pq);
    const desired = new THREE.Quaternion().setFromEuler(_pe.set(0, this.watched.yaw + Math.PI, 0, 'YXZ'));
    this.pipCamera.quaternion.copy(_pq.invert().multiply(desired));

    // lift the tactical-map dimming for this render (uniform-only, no recompiles)
    const scene = this.game.scene;
    const dimmed = this._styled;
    if (dimmed) {
      for (const d of this._dimmed) d.m.opacity = 1;
      scene.background = this._bgBackup;
      if (scene.fog) { scene.fog.near = this._fogNear; scene.fog.far = this._fogFar; }
    }
    const meshWasVisible = this.watched.mesh.visible;
    this.watched.mesh.visible = false; // don't render the inside of their own head

    const x = rect.left;
    const y = window.innerHeight - rect.bottom;
    renderer.setScissorTest(true);
    renderer.setViewport(x, y, rect.width, rect.height);
    renderer.setScissor(x, y, rect.width, rect.height);
    renderer.render(scene, this.pipCamera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);

    this.watched.mesh.visible = meshWasVisible;
    if (dimmed) {
      for (const d of this._dimmed) d.m.opacity = 0.5;
      scene.background = this._mapBg;
      if (scene.fog) { scene.fog.near = 4000; scene.fog.far = 8000; }
    }
  }

  _updateTeamBtn() {
    const red = this.game.playerTeam === 1;
    this.el.teamBtn.textContent = red ? 'DEFECT TO UNSC' : 'DEFECT TO COVENANT';
    this.el.teamBtn.classList.toggle('red', !red);
  }

  _updateSquadPanel() {
    const g = this.game;
    const squads = g.teams[g.playerTeam].squads;
    const rows = squads.map((sq, i) => {
      const mine = sq === g.playerSquad;
      const slots = sq.members.map((m, mi) =>
        `<span class="dp-slot${m.alive ? '' : ' dead'}${m.isPlayer ? ' you' : ''}${!m.isPlayer && m.alive ? ' watchable' : ''}" data-sq="${i}" data-m="${mi}" title="${m.isPlayer ? 'You' : m.name + ' — click for helmet cam'}">${m.isPlayer ? '★' : m.cls[0].toUpperCase()}</span>`
      ).join('');
      const btn = mine
        ? `<button class="dp-sq-btn leave" data-i="${i}">LEAVE</button>`
        : `<button class="dp-sq-btn" data-i="${i}"${sq.members.length >= 5 ? ' disabled' : ''}>JOIN</button>`;
      const members = mine
        ? `<div class="dp-sq-members">${sq.members.map((m, mi) => m.isPlayer ? '' :
            `<div class="dp-mate${m.alive ? '' : ' dead'}${m.alive ? ' watchable' : ''}" data-sq="${i}" data-m="${mi}" title="Click for helmet cam">
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
    // click a member (slot or row) → helmet cam
    for (const elm of this.el.squad.querySelectorAll('.watchable')) {
      elm.onclick = () => {
        const sq = squads[Number(elm.dataset.sq)];
        const m = sq && sq.members[Number(elm.dataset.m)];
        if (m && m.alive && !m.isPlayer) this.watch(m);
      };
    }
  }
}
