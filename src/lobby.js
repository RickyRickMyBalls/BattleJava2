// Pre-game lobby: game type + map selection with a live 3D render of the
// player's character holding their primary weapon. Also the post-load team
// select screen (UNSC left / Covenant right).

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAPS, GAME_TYPES, CLASSES, WEAPONS } from './config.js';
import { makeWeaponMount, setHeldWeapon } from './soldier.js';
import { LobbyRoam } from './lobbyroam.js';
import { prewarm, weaponClones, characterClones } from './assets.js';

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


export class Lobby {
  constructor(session, renderer, envTexture, onStart) {
    this.session = session;
    this.renderer = renderer;
    this.onStart = onStart;
    this.active = false;
    this.launching = false; // true from START GAME onward, incl. team select

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
    this.roam = new LobbyRoam(this);
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
    // hero spotlight from above — the shadow caster
    const spot = new THREE.SpotLight(0xf4f8ff, 40, 14, 0.5, 0.5, 1.4);
    spot.position.set(0.6, 5.2, 0.6);
    spot.target.position.set(0.75, 0.9, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 12;
    spot.shadow.bias = -0.0003;
    spot.shadow.radius = 2.5;
    this.scene.add(spot);
    this.scene.add(spot.target);
    this.spot = spot;

    // Fallback floor only — the Blender stage provides the real one
    const fallbackFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x07090d, roughness: 0.6, metalness: 0.3 })
    );
    fallbackFloor.rotation.x = -Math.PI / 2;
    fallbackFloor.receiveShadow = true;
    this.scene.add(fallbackFloor);
    this.fallbackFloor = fallbackFloor;


    // faint volumetric cone above the character
    // Soft-edged volumetric cone: alpha peaks where the view passes through
    // the "thickest" light (facing fragments) and falls to zero at the
    // silhouette, so there is no hard edge. Vertical fade melts the bottom.
    const coneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false, // avoids log-depth mismatch; it's a faint additive glow
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        color: { value: new THREE.Color(0xbfe2ff) },
        strength: { value: 0.05 },
      },
      vertexShader: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vNormal = normalMatrix * normal;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec2 vUv;
        uniform vec3 color;
        uniform float strength;
        void main() {
          float facing = abs(dot(normalize(vView), normalize(vNormal)));
          float body = pow(facing, 2.2);                    // soft silhouette
          float vert = smoothstep(0.0, 0.45, vUv.y)         // dissolve at floor
                     * (1.0 - smoothstep(0.9, 1.0, vUv.y) * 0.4);
          gl_FragColor = vec4(color, body * vert * strength);
        }`,
    });
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 2.1, 4.6, 40, 1, true), coneMat);
    cone.position.set(0.7, 2.5, 0.2);
    cone.renderOrder = 10;
    this.scene.add(cone);
    this.cone = cone;

    // curved wall of hangar "screens" showing a distant battle
    const screenTex = makeScreenTexture();
    this.screens = [];
    for (let i = -2; i <= 2; i++) {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(8.4, 4.6),
        new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, opacity: 0.75, fog: false })
      );
      const a = i * 0.4;
      panel.position.set(Math.sin(a) * 16, 2.75, -Math.cos(a) * 16 + 4);
      panel.rotation.y = a;
      this.scene.add(panel);
      this.screens.push(panel);
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
      this.vehicleWrap = wrap;
      // dim service light over the parked vehicle
      const lamp = new THREE.PointLight(0xa8c4ff, 4, 6, 1.6);
      lamp.position.set(-1.1, 2.2, -2.0);
      this.scene.add(lamp);
      this.vehicleLamp = lamp;
      this._applyStageLayout();
      this._warmLateArrivals();
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
    this.charPos = new THREE.Vector3(0.75, 0.02, 0);
    this.stage = null;
    this._loadStage();
  }

  // Blender-authored hangar stage (source/other/lobby_stage.glb). Markers:
  // FC_CHAR (character spot), FC_PROP_VEHICLE, FC_CAM. Replaces the
  // procedural backdrop screens when present.
  _loadStage() {
    new GLTFLoader().load('/other/lobby_stage.glb', (gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const markers = {};
      root.traverse((o) => {
        if (o.name && o.name.toUpperCase().startsWith('FC_')) {
          markers[o.name.toUpperCase()] = {
            pos: o.getWorldPosition(new THREE.Vector3()),
            quat: o.getWorldQuaternion(new THREE.Quaternion()),
          };
        }
      });
      root.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
      this.scene.add(root);
      this.stage = { root, markers };
      for (const s of this.screens) s.visible = false;
      if (this.fallbackFloor) this.fallbackFloor.visible = false; // stage floor takes over
      if (this.scene.fog) this.scene.fog.far = 36; // room is deep; let the back wall breathe
      this._applyStageLayout();
      this.refreshPreview();
      this._warmLateArrivals();
    }, undefined, () => { /* no stage authored yet — procedural set stays */ });
  }


  // Marker empties drive full placement AND orientation:
  //   FC_CHAR — character position + facing (rotate the empty's Z in Blender)
  //   FC_CAM  — camera transform verbatim (aim it like a Blender camera)
  //   FC_PROP_VEHICLE — vehicle position + rotation
  _applyStageLayout() {
    if (!this.stage) return;
    const mk = this.stage.markers;
    if (mk.FC_CHAR) {
      this.charPos.copy(mk.FC_CHAR.pos).add(new THREE.Vector3(0, 0.02, 0));
      this.charQuat = mk.FC_CHAR.quat;
      this.cone.position.set(this.charPos.x - 0.05, 2.5, this.charPos.z + 0.2);
      if (this.spot) {
        // near-vertical, a touch behind: contact shadow pools at the feet
        this.spot.position.set(this.charPos.x + 0.05, 5.2, this.charPos.z - 0.3);
        this.spot.target.position.set(this.charPos.x, 0.6, this.charPos.z);
      }
    }
    if (mk.FC_CAM) {
      this.camera.position.copy(mk.FC_CAM.pos);
      this.camera.quaternion.copy(mk.FC_CAM.quat);
    }
    if (mk.FC_PROP_VEHICLE && this.vehicleWrap) {
      // slight sink: the model's lowest point is undercarriage, not wheel rims
      this.vehicleWrap.position.set(mk.FC_PROP_VEHICLE.pos.x, -0.07, mk.FC_PROP_VEHICLE.pos.z);
      this.vehicleWrap.quaternion.copy(mk.FC_PROP_VEHICLE.quat);
      if (this.vehicleLamp) this.vehicleLamp.position.set(mk.FC_PROP_VEHICLE.pos.x, 2.2, mk.FC_PROP_VEHICLE.pos.z);
    }
  }

  // Compile this scene's materials behind the loading bar instead of on the
  // first frame the player sees. The lobby's light rig differs from the match's,
  // so the match-time prewarm does not cover it — every gun and character has
  // to compile again here.
  // Everything funnels through one queue. Boot awaits this; the stage and the
  // Mongoose call it again when they land. Two runs at once would interleave
  // their scene.add/remove around each other's render and warm a partial scene.
  prewarm() {
    this._warmQueue = (this._warmQueue || Promise.resolve())
      .then(() => this._prewarmNow())
      .catch(() => {});
    return this._warmQueue;
  }

  async _prewarmNow() {
    const assets = this.session.assets;
    if (!assets) return;
    const objects = [...weaponClones(assets), ...characterClones(assets)];
    // Match the real character's shadow flags exactly. The hero spotlight casts,
    // so a caster needs a depth-material program on top of its lit one — but
    // `receiveShadow` is also part of three's program key, so prewarming with it
    // set compiles a variant nothing then uses and the real mesh compiles again
    // on the frame the player sees. refreshPreview sets castShadow only.
    for (const o of objects) o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
    await prewarm(this.renderer, this.scene, this.camera, objects);
  }

  // The stage and the parked Mongoose load lazily, after boot's prewarm has
  // run, and neither comes from `assets` — so nothing else would warm them.
  //
  // This re-runs the FULL prewarm, not just a bare render of the scene, because
  // the Mongoose brings a service PointLight with it and the scene's light
  // counts are part of three's program key: the moment that lamp is added,
  // every material compiled at boot is invalidated and has to compile again.
  // Cheap to redo here — it happens under the title screen, not in front of
  // the player.
  // The stage and the Mongoose load lazily and neither comes from `assets`, so
  // nothing else would warm them. Unconditional: they routinely land WHILE
  // boot's prewarm is still running (it takes most of a second), so gating on
  // "has boot finished" silently skipped the run that mattered. The Mongoose
  // also brings a service PointLight, and scene light counts are part of
  // three's program key — every material compiled before it arrives is
  // invalidated, which is why this re-runs the full prewarm and not a bare
  // render of the scene.
  _warmLateArrivals() {
    this.prewarm();
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
    this.charGroup.position.copy(this.charPos);
    if (this.charQuat) this.charGroup.quaternion.copy(this.charQuat);
    else this.charGroup.rotation.y = -1.25; // fallback profile without a stage
    this.scene.add(this.charGroup);

    this.mixer = new THREE.AnimationMixer(mesh);
    // the aim pose presents the weapon properly (idle tucks it into the body)
    const clip = character.clips.aim || character.clips.idle;
    if (clip) this.mixer.clipAction(clip).play();

    const holder = makeWeaponMount(mesh);
    if (holder) setHeldWeapon(holder, lo.primary, assets.weaponModels);

    // character + held gun cast onto the stage floor
    this.charGroup.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    // Ground the pose via the toe/foot BONES (Mixamo toe joints sit at sole
    // level) — skinned bounding boxes report phantom lows on these rigs.
    // The clip breathes, so sample the whole loop and take the lowest point.
    const feetBones = [];
    mesh.traverse((o) => {
      if (o.isBone) {
        const n = o.name.replace(/^.*?mixamorig[:_]?/i, '').toLowerCase();
        if (n.includes('toe') || n.includes('foot')) feetBones.push(o);
      }
    });
    const _bp = new THREE.Vector3();
    const box = new THREE.Box3();
    const measure = () => {
      this.charGroup.updateMatrixWorld(true);
      let m = Infinity;
      if (feetBones.length) {
        for (const b of feetBones) m = Math.min(m, b.getWorldPosition(_bp).y);
        return m;
      }
      mesh.traverse((o) => {
        if (o.isSkinnedMesh) {
          o.computeBoundingBox();
          box.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
          m = Math.min(m, box.min.y);
        }
      });
      return m;
    };
    let minY = Infinity;
    if (clip) {
      for (let i = 0; i < 12; i++) {
        this.mixer.setTime((i / 12) * clip.duration);
        minY = Math.min(minY, measure());
      }
      this.mixer.setTime(0);
    } else {
      minY = measure();
    }
    let groundY = 0;
    if (this.stage) {
      const ray = new THREE.Raycaster(
        new THREE.Vector3(this.charPos.x, this.charPos.y + 2.5, this.charPos.z),
        new THREE.Vector3(0, -1, 0), 0, 15
      );
      const hits = ray.intersectObject(this.stage.root, true);
      if (hits.length) groundY = hits[0].point.y;
    }
    if (isFinite(minY)) this.charGroup.position.y += groundY - minY;

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
    if (this.roam) this.roam.refreshHint();
  }

  hidePanels() {
    this.el.panels.style.display = 'none';
  }

  showPanels() {
    this.el.panels.style.display = 'flex';
  }

  hide() {
    this.active = false;
    this.el.lobby.style.display = 'none';
    if (this.roam) this.roam.refreshHint();
  }

  setStatus(text, progress = null) {
    this.el.status.textContent = text;
    if (progress !== null) {
      const row = this.el.maps.querySelector('.lb-row.sel .lb-row-progress > div');
      if (row) row.style.width = `${Math.round(progress * 100)}%`;
    }
  }

  setLaunching(on) {
    this.launching = on;
    this.el.start.disabled = on;
    this.el.start.textContent = on ? 'LOADING…' : 'START GAME';
    if (this.roam) this.roam.refreshHint();
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
    if (this.dust) {
      const pos = this.dust.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 0.05;
        if (y < 0) y = 3.6;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    // Owns the camera while entering/roaming/exiting — must run before the render.
    if (this.roam) this.roam.update(dt);
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
