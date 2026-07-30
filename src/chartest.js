// Character test environment (/chartest.html): all three rigs side by side,
// held gun + stowed back gun, with live tuning of the per-character BACK
// transform. Copy the generated block into soldier.js when happy.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { loadAssets } from './assets.js';
import { makeWeaponMount, makeBackMount, setHeldWeapon, BACK, GRIP } from './soldier.js';
import { WEAPONS, FP_DEFAULT } from './config.js';

const app = document.getElementById('app');
const loadmsg = document.getElementById('loadmsg');
const panel = document.getElementById('panel');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a222e);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2a2f26, 0.8));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
sun.position.set(4, 8, 5);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(7, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.95 })
);
scene.add(ground);
scene.add(new THREE.GridHelper(14, 28, 0x3a5566, 0x24303c));

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(0, 1.7, -4.2); // start behind the line-up: backs face -Z
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.1, 0);
controls.enableDamping = true;

const resizeCams = [camera];
window.addEventListener('resize', () => {
  for (const c of resizeCams) {
    c.aspect = window.innerWidth / window.innerHeight;
    c.updateProjectionMatrix();
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// held / stowed picks give a size range: rifle, long sniper, bulky launcher
const SETUP = [
  { key: 'marine', held: 'ar', back: 'br' },
  { key: 'spartan', held: 'br', back: 'sniper' },
  { key: 'elite', held: 'smg', back: 'rocket' },
];

const chars = [];
let mode = 'back'; // 'back' | 'grip' | 'fp' — fp renders through the first-person camera
let fpUpdate = null; // set by buildPanel: per-frame move/shoot logic for fp mode
const BOOT_ID = Date.now();
window.__ctGet = () => ({ mode, BOOT_ID });
window.__ctSet = (m) => { mode = m; };

function applyBack(entry) {
  const bk = BACK[entry.cfg.key];
  entry.stowed.position.set(bk.pos[0], bk.pos[1], bk.pos[2]);
  entry.stowed.rotation.set(bk.rot[0], bk.rot[1], bk.rot[2]);
}

function playAnim(key) {
  for (const c of chars) {
    const clip = c.character.clips[key] || c.character.clips.idle;
    if (!clip) continue;
    c.mixer.stopAllAction();
    c.mixer.clipAction(clip).play();
  }
}

const f = (n) => (Math.round(n * 100) / 100).toString();

function dumpValues() {
  const lines = Object.entries(BACK).map(([k, v]) =>
    `  ${k}: { pos: [${v.pos.map(f).join(', ')}], rot: [${v.rot.map(f).join(', ')}] },`);
  document.getElementById('out').value = `export const BACK = {\n${lines.join('\n')}\n};`;
}

// Every weapon gets a concrete grip object (seeded from its override or the
// global GRIP) so the inputs always have real arrays to edit. setHeldWeapon
// reads def.grip, so edits apply on re-mount.
function ensureGrip(key) {
  const def = WEAPONS[key];
  // idempotent: keep object identity so live input bindings stay valid
  if (!def.grip || !def.grip.pos || !def.grip.rot) {
    def.grip = {
      pos: [...((def.grip && def.grip.pos) || GRIP.pos)],
      rot: [...((def.grip && def.grip.rot) || GRIP.rot)],
    };
  }
  return def.grip;
}

function dumpGrips() {
  const lines = Object.keys(WEAPONS).map((k) => {
    const g = WEAPONS[k].grip;
    if (!g) return `  ${k}: (default GRIP)`;
    return `  ${k}: grip: { pos: [${g.pos.map(f).join(', ')}], rot: [${g.rot.map(f).join(', ')}] },`;
  });
  document.getElementById('out').value = `// per-weapon grip -> paste into each def in config.js WEAPONS\n${lines.join('\n')}`;
}

function ensureFp(key) {
  const def = WEAPONS[key];
  // idempotent: keep object identity so live input bindings stay valid
  if (!def.fp || !def.fp.pos || !def.fp.rot) {
    def.fp = {
      pos: [...((def.fp && def.fp.pos) || FP_DEFAULT.pos)],
      rot: [...((def.fp && def.fp.rot) || FP_DEFAULT.rot)],
    };
  }
  return def.fp;
}

function dumpFp() {
  const lines = Object.keys(WEAPONS).map((k) => {
    const g = WEAPONS[k].fp;
    if (!g) return `  ${k}: (default)`;
    return `  ${k}: fp: { pos: [${g.pos.map(f).join(', ')}], rot: [${g.rot.map(f).join(', ')}] },`;
  });
  document.getElementById('out').value = `// first-person offset -> paste into each def in config.js WEAPONS\n${lines.join('\n')}`;
}

function buildPanel(assets) {
  const sections = document.getElementById('sections');
  for (const entry of chars) {
    const key = entry.cfg.key;
    const bk = BACK[key];
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${key.toUpperCase()} (${entry.cfg.back})</legend>`;
    const fields = [
      ['pos x', bk.pos, 0, 0.01], ['pos y', bk.pos, 1, 0.01], ['pos z', bk.pos, 2, 0.01],
      ['rot x', bk.rot, 0, 0.05], ['rot y', bk.rot, 1, 0.05], ['rot z', bk.rot, 2, 0.05],
    ];
    for (const [label, arr, idx, step] of fields) {
      const row = document.createElement('div');
      row.className = 'row';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      input.value = arr[idx];
      input.oninput = () => {
        arr[idx] = Number(input.value) || 0;
        applyBack(entry);
        dumpValues();
      };
      const lab = document.createElement('label');
      lab.textContent = label;
      row.appendChild(lab);
      row.appendChild(input);
      fs.appendChild(row);
    }
    sections.appendChild(fs);
  }

  // ---- grip tuning tab ----
  let gripKey = 'ar';
  const gripSection = document.getElementById('gripSection');

  function holdEverywhere(key) {
    for (const entry of chars) {
      entry.cfg.held = key;
      setHeldWeapon(entry.hand, key, assets.weaponModels);
    }
  }

  function buildGripInputs() {
    gripSection.innerHTML = '';
    const g = ensureGrip(gripKey);
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${WEAPONS[gripKey].name}</legend>`;
    const fields = [
      ['pos x', g.pos, 0, 0.01], ['pos y', g.pos, 1, 0.01], ['pos z', g.pos, 2, 0.01],
      ['rot x', g.rot, 0, 0.05], ['rot y', g.rot, 1, 0.05], ['rot z', g.rot, 2, 0.05],
    ];
    for (const [label, arr, idx, step] of fields) {
      const row = document.createElement('div');
      row.className = 'row';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      input.value = arr[idx];
      input.oninput = () => {
        arr[idx] = Number(input.value) || 0;
        holdEverywhere(gripKey); // re-mount with the edited grip
        dumpGrips();
      };
      const lab = document.createElement('label');
      lab.textContent = label;
      row.appendChild(lab);
      row.appendChild(input);
      fs.appendChild(row);
    }
    gripSection.appendChild(fs);
  }

  const wpnBtns = document.getElementById('wpnBtns');
  for (const key of Object.keys(WEAPONS)) {
    const b = document.createElement('button');
    b.textContent = key.toUpperCase();
    if (key === gripKey) b.classList.add('sel');
    b.onclick = () => {
      gripKey = key;
      wpnBtns.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
      holdEverywhere(key);
      buildGripInputs();
      dumpGrips();
    };
    wpnBtns.appendChild(b);
  }

  // ---- first-person viewmodel tab ----
  // Replicates the player rig exactly (player.js _buildViewmodel/_mountGun):
  // camera -> viewmodel group at (0.28,-0.24,-0.55) -> gunHolder yaw-PI ->
  // fp mount -> gun. Values transfer 1:1 into config `fp`.
  let fpKey = 'ar';
  const fpCam = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 200);
  fpCam.position.set(0, 1.7, -3.4); // stands behind the line-up, faces them
  fpCam.rotation.y = Math.PI;
  scene.add(fpCam);
  window.__fpCam = fpCam;
  resizeCams.push(fpCam);
  const fpViewmodel = new THREE.Group();
  fpViewmodel.position.set(0.28, -0.24, -0.55);
  const fpHolder = new THREE.Group();
  fpHolder.rotation.y = Math.PI;
  fpViewmodel.add(fpHolder);
  fpCam.add(fpViewmodel);
  const fpMount = new THREE.Group();
  fpHolder.add(fpMount);
  let fpGun = null;

  function fpApply() {
    const fp = ensureFp(fpKey);
    fpMount.position.set(fp.pos[0], fp.pos[1], fp.pos[2]);
    fpMount.rotation.set(fp.rot[0], fp.rot[1], fp.rot[2]);
  }

  function fpHold(key) {
    fpKey = key;
    if (fpGun) fpGun.removeFromParent();
    fpGun = assets.weaponModels[key].clone(true);
    fpMount.add(fpGun);
    fpApply();
  }

  const fpSection = document.getElementById('fpSection');
  function buildFpInputs() {
    fpSection.innerHTML = '';
    const g = ensureFp(fpKey);
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${WEAPONS[fpKey].name}</legend>`;
    const fields = [
      ['pos x', g.pos, 0, 0.01], ['pos y', g.pos, 1, 0.01], ['pos z', g.pos, 2, 0.01],
      ['rot x', g.rot, 0, 0.05], ['rot y', g.rot, 1, 0.05], ['rot z', g.rot, 2, 0.05],
    ];
    for (const [label, arr, idx, step] of fields) {
      const row = document.createElement('div');
      row.className = 'row';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      input.value = arr[idx];
      input.oninput = () => {
        arr[idx] = Number(input.value) || 0;
        fpApply();
        dumpFp();
      };
      const lab = document.createElement('label');
      lab.textContent = label;
      row.appendChild(lab);
      row.appendChild(input);
      fs.appendChild(row);
    }
    fpSection.appendChild(fs);
  }

  const fpWpnBtns = document.getElementById('fpWpnBtns');
  for (const key of Object.keys(WEAPONS)) {
    const b = document.createElement('button');
    b.textContent = key.toUpperCase();
    if (key === fpKey) b.classList.add('sel');
    b.onclick = () => {
      fpWpnBtns.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
      fpHold(key);
      buildFpInputs();
      dumpFp();
    };
    fpWpnBtns.appendChild(b);
  }

  // ---- move & shoot in viewmodel mode ------------------------------------
  const cross = document.createElement('div');
  cross.style.cssText = 'position:fixed;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#7fd4ff;border-radius:50%;display:none;pointer-events:none;z-index:5;box-shadow:0 0 4px #7fd4ff';
  document.body.appendChild(cross);

  const glowC = document.createElement('canvas');
  glowC.width = glowC.height = 64;
  {
    const gctx = glowC.getContext('2d');
    const gr = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,220,150,0.9)');
    gr.addColorStop(0.55, 'rgba(255,150,60,0.35)');
    gr.addColorStop(1, 'rgba(255,120,40,0)');
    gctx.fillStyle = gr;
    gctx.fillRect(0, 0, 64, 64);
  }
  const flashTex = new THREE.CanvasTexture(glowC);
  flashTex.colorSpace = THREE.SRGBColorSpace;
  const flashMat = new THREE.SpriteMaterial({ map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false });
  const flash = new THREE.Sprite(flashMat);
  flash.scale.set(0.35, 0.35, 1);
  flash.position.set(0, 0.03, -0.55);
  fpViewmodel.add(flash);

  // tiny tracer pool
  const TR = 8;
  const trGeo = new THREE.BufferGeometry();
  const trPos = new Float32Array(TR * 6);
  trGeo.setAttribute('position', new THREE.BufferAttribute(trPos, 3));
  const trLines = new THREE.LineSegments(trGeo,
    new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  trLines.frustumCulled = false;
  scene.add(trLines);
  const trLife = new Float32Array(TR);
  let trHead = 0;

  const ctl = { yaw: Math.PI, pitch: 0, keys: new Set(), firing: false, fireTimer: 0, recoil: 0 };
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (mode !== 'fp') return;
    if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock(); return; }
    if (e.button === 0) ctl.firing = true;
  });
  window.addEventListener('mouseup', () => { ctl.firing = false; });
  window.addEventListener('mousemove', (e) => {
    if (mode !== 'fp' || document.pointerLockElement !== renderer.domElement) return;
    ctl.yaw -= e.movementX * 0.0022;
    ctl.pitch = Math.max(-1.4, Math.min(1.4, ctl.pitch - e.movementY * 0.0022));
  });
  window.addEventListener('keydown', (e) => ctl.keys.add(e.code));
  window.addEventListener('keyup', (e) => ctl.keys.delete(e.code));

  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _from = new THREE.Vector3(), _dir = new THREE.Vector3();
  fpUpdate = (dt) => {
    fpCam.rotation.set(ctl.pitch, ctl.yaw, 0, 'YXZ');
    // WASD relative to yaw, walking height locked
    const sp = (ctl.keys.has('ShiftLeft') ? 7 : 4) * dt;
    _f.set(-Math.sin(ctl.yaw), 0, -Math.cos(ctl.yaw));
    _r.crossVectors(_f, new THREE.Vector3(0, 1, 0)).negate();
    if (ctl.keys.has('KeyW')) fpCam.position.addScaledVector(_f, sp);
    if (ctl.keys.has('KeyS')) fpCam.position.addScaledVector(_f, -sp);
    if (ctl.keys.has('KeyA')) fpCam.position.addScaledVector(_r, -sp);
    if (ctl.keys.has('KeyD')) fpCam.position.addScaledVector(_r, sp);
    fpCam.position.y = 1.7;
    fpCam.position.x = Math.max(-12, Math.min(12, fpCam.position.x));
    fpCam.position.z = Math.max(-12, Math.min(12, fpCam.position.z));

    // firing
    ctl.fireTimer -= dt;
    ctl.recoil = Math.max(0, ctl.recoil - dt * 3);
    const def = WEAPONS[fpKey];
    if (ctl.firing && ctl.fireTimer <= 0) {
      ctl.fireTimer = 60 / (def.rpm || 300);
      if (def.mode !== 'auto' && def.mode !== 'burst') ctl.firing = false; // click per shot
      flashMat.opacity = 0.75 + Math.random() * 0.25;
      flashMat.rotation = Math.random() * Math.PI * 2;
      flash.scale.setScalar(0.25 + Math.random() * 0.2);
      const kick = def.mode === 'pump' || def.dmg >= 50 ? 1.6 : 1;
      ctl.recoil = Math.min(1.6, ctl.recoil + 0.35 * kick);
      ctl.pitch += (0.0035 + Math.random() * 0.002) * kick;
      // tracer along the crosshair ray, starting near the gun
      fpCam.getWorldPosition(_from);
      _dir.set(0, 0, -1).applyQuaternion(fpCam.quaternion);
      const off = new THREE.Vector3(0.22, -0.12, -0.6).applyQuaternion(fpCam.quaternion);
      const i = trHead; trHead = (trHead + 1) % TR;
      trLife[i] = 0.07;
      trPos[i * 6] = _from.x + off.x; trPos[i * 6 + 1] = _from.y + off.y; trPos[i * 6 + 2] = _from.z + off.z;
      trPos[i * 6 + 3] = _from.x + _dir.x * 80; trPos[i * 6 + 4] = _from.y + _dir.y * 80; trPos[i * 6 + 5] = _from.z + _dir.z * 80;
      trGeo.attributes.position.needsUpdate = true;
    }
    flashMat.opacity = Math.max(0, flashMat.opacity - dt * 22);
    fpViewmodel.position.z = -0.55 + ctl.recoil * 0.06;
    fpViewmodel.rotation.x = ctl.recoil * 0.12;
    for (let i = 0; i < TR; i++) {
      if (trLife[i] > 0) {
        trLife[i] -= dt;
        if (trLife[i] <= 0) {
          trPos[i * 6 + 3] = trPos[i * 6]; trPos[i * 6 + 4] = trPos[i * 6 + 1]; trPos[i * 6 + 5] = trPos[i * 6 + 2];
          trGeo.attributes.position.needsUpdate = true;
        }
      }
    }
  };

  for (const b of document.querySelectorAll('#modeBtns [data-mode]')) {
    b.onclick = () => {
      document.querySelectorAll('#modeBtns button').forEach((x) => x.classList.toggle('sel', x === b));
      mode = b.dataset.mode;
      document.getElementById('backMode').style.display = mode === 'back' ? 'block' : 'none';
      document.getElementById('gripMode').style.display = mode === 'grip' ? 'block' : 'none';
      document.getElementById('fpMode').style.display = mode === 'fp' ? 'block' : 'none';
      controls.enabled = mode !== 'fp';
      cross.style.display = mode === 'fp' ? 'block' : 'none';
      if (mode !== 'fp' && document.pointerLockElement) document.exitPointerLock();
      document.getElementById('hint').textContent =
        mode === 'grip' ? 'values update live · paste grip lines into config.js WEAPONS'
        : mode === 'fp' ? 'first-person view · paste fp lines into config.js WEAPONS'
        : 'values update live · paste block into soldier.js BACK';
      if (mode === 'grip') { holdEverywhere(gripKey); buildGripInputs(); dumpGrips(); }
      else if (mode === 'fp') { fpHold(fpKey); buildFpInputs(); dumpFp(); }
      else dumpValues();
    };
  }
  buildGripInputs();

  for (const b of document.querySelectorAll('#animBtns [data-anim]')) {
    b.onclick = () => {
      document.querySelectorAll('#animBtns [data-anim]').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      playAnim(b.dataset.anim);
    };
  }
  document.getElementById('swapBtn').onclick = () => {
    for (const entry of chars) {
      [entry.cfg.held, entry.cfg.back] = [entry.cfg.back, entry.cfg.held];
      setHeldWeapon(entry.hand, entry.cfg.held, assets.weaponModels);
      entry.stowed.removeFromParent();
      entry.stowed = assets.weaponModels[entry.cfg.back].clone(true);
      entry.backH.add(entry.stowed);
      applyBack(entry);
    }
    // relabel sections
    document.querySelectorAll('#sections legend').forEach((lg, i) => {
      lg.textContent = `${chars[i].cfg.key.toUpperCase()} (${chars[i].cfg.back})`;
    });
  };
  dumpValues();
}

async function boot() {
  const assets = await loadAssets((p, label) => { loadmsg.textContent = `LOADING ${label}… ${Math.round(p * 100)}%`; });

  SETUP.forEach((cfg, i) => {
    const character = assets.characters[cfg.key];
    if (!character) return;
    const mesh = cloneSkeleton(character.template);
    mesh.position.set((i - 1) * 1.7, 0, 0);
    scene.add(mesh);

    const mixer = new THREE.AnimationMixer(mesh);
    const clip = character.clips.idle;
    if (clip) mixer.clipAction(clip).play();

    const hand = makeWeaponMount(mesh);
    const backH = makeBackMount(mesh);
    if (hand) setHeldWeapon(hand, cfg.held, assets.weaponModels);
    const stowed = assets.weaponModels[cfg.back].clone(true);
    if (backH) backH.add(stowed);

    const entry = { cfg, character, mesh, mixer, hand, backH, stowed };
    applyBack(entry);
    chars.push(entry);
  });

  loadmsg.style.display = 'none';
  panel.style.display = 'block';
  buildPanel(assets);

  // singleton: if a stale HMR instance's loop is still alive, it stops itself
  const token = {};
  window.__ctToken = token;
  const clock = new THREE.Clock();
  const frame = (dt) => {
    for (const c of chars) c.mixer.update(dt);
    if (controls.enabled) controls.update();
    if (mode === 'fp' && fpUpdate) fpUpdate(dt);
    const cam = mode === 'fp' && window.__fpCam ? window.__fpCam : camera;
    window.__ctDebug = { mode, usingFp: cam !== camera };
    renderer.render(scene, cam);
  };
  window.__ctFrame = frame; // manual step for headless debugging (rAF halts when the tab isn't composited)
  (function loop() {
    if (window.__ctToken !== token) return;
    requestAnimationFrame(loop);
    frame(Math.min(0.05, clock.getDelta()));
  })();
}

boot().catch((e) => { loadmsg.textContent = `FAILED: ${e.message || e}`; console.error(e); });
