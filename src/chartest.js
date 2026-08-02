// Character test environment (/chartest.html): every rig in ASSET_PATHS.characters
// side by side, held gun + stowed back gun, with live tuning of the per-character
// BACK transform. Copy the generated block into soldier.js when happy.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { loadAssets } from './assets.js';
import { makeWeaponMount, makeBackMount, setHeldWeapon, BACK, GRIP } from './soldier.js';
import { WEAPONS, FP_DEFAULT, ADS_DEFAULT, ASSET_PATHS } from './config.js';
import { createScopeDisplay, tagViewmodelLayer, VIEWMODEL_LAYER } from './scopedisplay.js';
import { createVehicleRange } from './vehiclerange.js';

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

// ---- line-up ------------------------------------------------------------
// One slot per loaded character, so a new body in ASSET_PATHS shows up on the
// range with no edit here. Held/stowed picks rotate through a rifle, a long
// sniper and a bulky launcher to give every rig a size range to tune against.
const HELD_PICKS = ['ar', 'br', 'smg'];
const BACK_PICKS = ['br', 'sniper', 'rocket'];
const SETUP = Object.keys(ASSET_PATHS.characters).map((key, i) => ({
  key, held: HELD_PICKS[i % HELD_PICKS.length], back: BACK_PICKS[i % BACK_PICKS.length],
}));
// A rig with no BACK block yet still needs inputs to tune, so seed it off the
// marine. dumpValues() then emits the new key in the paste-ready block.
for (const cfg of SETUP) {
  if (!BACK[cfg.key]) BACK[cfg.key] = { pos: [...BACK.marine.pos], rot: [...BACK.marine.rot] };
}
const SLOT_W = 1.7;                                  // metres between characters
const slotX = (i) => (i - (SETUP.length - 1) / 2) * SLOT_W; // centred on x = 0
const LINEUP_HALF = ((SETUP.length - 1) / 2) * SLOT_W;
const RANGE_R = Math.max(7, LINEUP_HALF + 3);        // ground/grid grow with the line-up

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(RANGE_R, 48).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x2c3440, roughness: 0.95 })
);
scene.add(ground);
const grid = new THREE.GridHelper(RANGE_R * 2, Math.round(RANGE_R * 4), 0x3a5566, 0x24303c);
scene.add(grid);

// ---- alignment targets (fp / ads modes) ---------------------------------
// Sight alignment is a yes/no question, not a guess: bullseyes sit dead ahead
// at eye height, so with pitch 0 the crosshair is exactly on centre and any
// offset in the tuned pose shows up as the sight sitting off the bull.
//
// The lane is offset to +X because the characters stand across x = 0 and would
// block a lane down the middle. It sits one slot clear of the widest one, so it
// stays clear as bodies are added. The fp camera starts on the lane; turning
// left puts the line-up back in frame for a life-size reference.
const LANE_X = LINEUP_HALF + SLOT_W;
const targets = new THREE.Group();
targets.visible = false;
scene.add(targets);

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#7fd4ff';
  ctx.font = 'bold 40px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
}

function makeBullseye(dist, r, xOff = 0) {
  const g = new THREE.Group();
  g.position.set(LANE_X + xOff, 1.7, dist);
  g.rotation.y = Math.PI; // CircleGeometry faces +Z; the shooter is at -Z
  const flat = (geo, color, z) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.z = z;
    g.add(m);
    return m;
  };
  flat(new THREE.CircleGeometry(r, 48), 0x0e1a24, 0);
  for (let i = 3; i >= 1; i--) {
    flat(new THREE.RingGeometry(r * i * 0.25 - r * 0.012, r * i * 0.25, 48), 0x7fd4ff, 0.001 * i);
  }
  flat(new THREE.CircleGeometry(r * 0.06, 16), 0xff5a4d, 0.005);
  // hairlines: judging "is the post centred" reads better against a cross
  const th = r * 0.008;
  flat(new THREE.PlaneGeometry(r * 2, th), 0x7fd4ff, 0.004);
  flat(new THREE.PlaneGeometry(th, r * 2), 0x7fd4ff, 0.004);
  const label = makeLabel(`${dist}m`);
  label.scale.set(r * 0.9, r * 0.45, 1);
  label.position.set(0, r * 1.25, 0);
  g.add(label);
  targets.add(g);
}

// Near bull sits exactly on the lane — pitch 0 and yaw straight ahead puts the
// crosshair on its pip, so it is the alignment reference. The far one is swung
// off axis because a target directly behind another is simply hidden by it.
makeBullseye(30, 0.9);
makeBullseye(100, 2.6, 6);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 200);
// Start behind the line-up (backs face -Z), far enough out to frame all of it.
camera.position.set(0, 1.7, -(4.2 + Math.max(0, SETUP.length - 3) * 0.9));
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

const chars = [];
let mode = 'back'; // 'back' | 'grip' | 'fp' | 'ads' — the last two render through the first-person camera
// Everything in WEAPONS that actually mounts in a pair of hands. A `mounted`
// def (the Warthog's turret) has no model and no grip to tune.
const HAND_WEAPONS = Object.keys(WEAPONS).filter((k) => !WEAPONS[k].mounted);

const isFpMode = (m) => m === 'fp' || m === 'ads';
// The vehicle range owns its own ground, camera and input. It is a tab rather
// than its own page because the tuning workflow lives at one address, and
// because loadAssets already pulls the Warthog — a second page would download
// 38 MB again for the same model.
let range = null;
let fpUpdate = null; // set by buildPanel: per-frame move/shoot logic for fp/ads modes
let fpPreRender = null; // set by buildPanel: scope-screen pass, runs before the main render
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
const f3 = (n) => (Math.round(n * 1000) / 1000).toString();

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

function ensureAds(key) {
  const def = WEAPONS[key];
  // idempotent: keep object identity so live input bindings stay valid
  if (!def.ads || !def.ads.pos || !def.ads.rot) {
    const a = def.ads || {};
    def.ads = {
      pos: [...(a.pos || ADS_DEFAULT.pos)],
      rot: [...(a.rot || ADS_DEFAULT.rot)],
      scale: a.scale ?? ADS_DEFAULT.scale,
      sens: a.sens ?? ADS_DEFAULT.sens,
      speed: a.speed ?? ADS_DEFAULT.speed,
    };
  }
  return def.ads;
}

function dumpAds() {
  const lines = Object.keys(WEAPONS).map((k) => {
    const a = WEAPONS[k].ads;
    if (!a) return `  ${k}: (default)`;
    return `  ${k}: ads: { pos: [${a.pos.map(f3).join(', ')}], rot: [${a.rot.map(f3).join(', ')}]` +
      `, scale: ${f(a.scale)}, sens: ${f(a.sens)}, speed: ${f(a.speed)} }, adsFov: ${f(WEAPONS[k].adsFov)},`;
  });
  document.getElementById('out').value =
    `// ADS pose -> paste into each def in config.js WEAPONS\n${lines.join('\n')}`;
}

// Frame counter, plus the numbers that actually say WHY a frame is slow.
//
// It times with performance.now() rather than the `dt` handed to frame(): that
// value is clamped to 0.05 by the loop, so anything worse than 20 fps reports
// as exactly 20 and a real hitch becomes invisible at the moment you most want
// to see it.
//
// `worst` is the headline number after fps. An average hides stutter, and
// stutter is what "something is off" almost always turns out to be — one
// 200 ms frame per second reads as a perfectly healthy 55 fps average.
function makePerf(renderer) {
  const el = document.getElementById('perf');
  el.style.display = 'block';
  let last = performance.now();
  let acc = 0, frames = 0, worst = 0, since = 0;
  return () => {
    const now = performance.now();
    const ms = now - last;
    last = now;
    // The first frame after a load or a tab switch is meaningless.
    if (ms > 0 && ms < 2000) { acc += ms; frames++; worst = Math.max(worst, ms); }
    since += ms;
    if (since < 250 || !frames) return;
    const avg = acc / frames;
    const fps = 1000 / avg;
    const info = renderer.info;
    const cls = fps < 30 ? 'bad' : fps < 55 ? 'warn' : '';
    const wcls = worst > 50 ? 'bad' : worst > 25 ? 'warn' : '';
    el.innerHTML =
      `<b class="${cls}">${fps.toFixed(0)} fps</b>  ${avg.toFixed(1)} ms\n`
      + `worst    <b class="${wcls}">${worst.toFixed(1)} ms</b>\n`
      + `draws    ${info.render.calls}\n`
      + `tris     ${(info.render.triangles / 1000).toFixed(0)}k\n`
      + `programs ${info.programs ? info.programs.length : '?'}\n`
      + `geom/tex ${info.memory.geometries} / ${info.memory.textures}`;
    acc = 0; frames = 0; worst = 0; since = 0;
  };
}

function dumpVehicle() {
  if (range) document.getElementById('out').value = range.dump();
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
  // `mounted` defs are bolted to a vehicle and have no GLB and no hand pose,
  // so there is nothing here to tune for them.
  for (const key of HAND_WEAPONS) {
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
  const fpCam = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 400);
  fpCam.position.set(LANE_X, 1.7, -3.4); // on the target lane, line-up off to the left
  fpCam.rotation.y = Math.PI;
  // Same split as the game: the viewmodel lives on its own layer so a scope
  // camera cannot see the gun it is bolted to. Enabling it here also keeps the
  // fp gun out of the orbit camera's view in BACK/GRIP modes.
  fpCam.layers.enable(VIEWMODEL_LAYER);
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
  let fpScope = null;

  function fpApply() {
    const fp = ensureFp(fpKey);
    fpMount.position.set(fp.pos[0], fp.pos[1], fp.pos[2]);
    fpMount.rotation.set(fp.rot[0], fp.rot[1], fp.rot[2]);
  }

  function fpHold(key) {
    fpKey = key;
    if (fpScope) { fpScope.dispose(); fpScope = null; }
    if (fpGun) fpGun.removeFromParent();
    fpGun = assets.weaponModels[key].clone(true);
    fpMount.add(fpGun);
    fpApply();
    // live scope glass, exactly as player.js mounts it — tuning the sniper or
    // the laser without the real magnified feed is guesswork
    fpScope = createScopeDisplay(fpGun, WEAPONS[key]);
    tagViewmodelLayer(fpViewmodel); // the gun that just joined is still on layer 0
    const snap = document.getElementById('adsSnapBtn');
    snap.disabled = !fpScope;
    snap.title = fpScope
      ? 'centre the scope screen on the crosshair'
      : 'no scope screen on this weapon — align its iron sights by hand';
  }

  fpPreRender = (cam) => { if (fpScope) fpScope.render(renderer, scene, cam); };

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

  // VIEWMODEL and ADS tune the same mounted gun from the same camera — one
  // selection, two button rows kept in sync.
  const wpnRows = ['fpWpnBtns', 'adsWpnBtns'].map((id) => document.getElementById(id));
  function selectWeapon(key) {
    fpHold(key);
    for (const row of wpnRows) {
      row.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x.dataset.key === key));
    }
    buildFpInputs();
    buildAdsInputs();
    if (mode === 'ads') dumpAds(); else dumpFp();
  }
  for (const row of wpnRows) {
    for (const key of HAND_WEAPONS) {
      const b = document.createElement('button');
      b.textContent = key.toUpperCase();
      b.dataset.key = key;
      if (key === fpKey) b.classList.add('sel');
      b.onclick = () => selectWeapon(key);
      row.appendChild(b);
    }
  }

  // ---- ADS tab -----------------------------------------------------------
  // Same rig, aimed. `fp` puts the gun in the holder; `ads` moves the HOLDER,
  // which is the transform that lands a sight on the crosshair. The pose is
  // held by default (ADS LOCK) because tuning means clicking into the panel,
  // which drops pointer lock and would otherwise release the aim.
  let adsLock = true;
  const adsOn = () => mode === 'ads' && (adsLock || ctl.adsHeld);

  const adsSection = document.getElementById('adsSection');
  function buildAdsInputs() {
    adsSection.innerHTML = '';
    const a = ensureAds(fpKey);
    const def = WEAPONS[fpKey];
    const fs = document.createElement('fieldset');
    fs.innerHTML = `<legend>${def.name}</legend>`;
    const fields = [
      ['pos x', a.pos, 0, 0.005], ['pos y', a.pos, 1, 0.005], ['pos z', a.pos, 2, 0.005],
      ['rot x', a.rot, 0, 0.01], ['rot y', a.rot, 1, 0.01], ['rot z', a.rot, 2, 0.01],
      ['fov', def, 'adsFov', 1],
      ['scale', a, 'scale', 0.02],
      ['sens', a, 'sens', 0.05],
      ['speed', a, 'speed', 0.5],
    ];
    for (const [label, obj, idx, step] of fields) {
      const row = document.createElement('div');
      row.className = 'row';
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      input.value = obj[idx];
      input.oninput = () => {
        obj[idx] = Number(input.value) || 0;
        dumpAds(); // the pose is applied per frame from the same objects
      };
      const lab = document.createElement('label');
      lab.textContent = label;
      row.appendChild(lab);
      row.appendChild(input);
      fs.appendChild(row);
    }
    adsSection.appendChild(fs);
  }

  const adsLockBtn = document.getElementById('adsLockBtn');
  adsLockBtn.onclick = () => {
    adsLock = !adsLock;
    adsLockBtn.classList.toggle('sel', adsLock);
    adsLockBtn.textContent = adsLock ? 'ADS LOCK' : 'HIP (RMB AIMS)';
  };

  // One Newton step: the holder is a direct child of the camera, so shifting it
  // by minus the screen's camera-space x/y puts the glass on the crosshair.
  // Press again after a rot/scale edit to re-converge.
  //
  // Aim at the GEOMETRY's centre, not the mesh origin — the screens are authored
  // as part of the weapon and keep its origin, which sits well below the glass.
  const _snap = new THREE.Vector3();
  document.getElementById('adsSnapBtn').onclick = () => {
    if (!fpScope) return;
    const a = ensureAds(fpKey);
    fpCam.updateMatrixWorld(true);
    fpScope.screen.updateWorldMatrix(true, false);
    fpScope.screen.geometry.computeBoundingBox();
    const p = fpScope.screen.geometry.boundingBox.getCenter(_snap)
      .applyMatrix4(fpScope.screen.matrixWorld);
    fpCam.worldToLocal(p);
    a.pos[0] = Math.round((fpViewmodel.position.x - p.x) * 1000) / 1000;
    a.pos[1] = Math.round((fpViewmodel.position.y - p.y) * 1000) / 1000;
    buildAdsInputs();
    dumpAds();
  };

  document.getElementById('adsResetBtn').onclick = () => {
    const a = ensureAds(fpKey);
    a.pos = [...ADS_DEFAULT.pos];
    a.rot = [...ADS_DEFAULT.rot];
    a.scale = ADS_DEFAULT.scale;
    a.sens = ADS_DEFAULT.sens;
    a.speed = ADS_DEFAULT.speed;
    buildAdsInputs();
    dumpAds();
  };

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

  const ctl = {
    yaw: Math.PI, pitch: 0, keys: new Set(), firing: false, fireTimer: 0, recoil: 0,
    adsHeld: false, sens: 0.0021,
  };
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (!isFpMode(mode)) return;
    if (document.pointerLockElement !== renderer.domElement) { renderer.domElement.requestPointerLock(); return; }
    if (e.button === 0) ctl.firing = true;
    if (e.button === 2) ctl.adsHeld = true;
  });
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) ctl.adsHeld = false; else ctl.firing = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!isFpMode(mode) || document.pointerLockElement !== renderer.domElement) return;
    ctl.yaw -= e.movementX * ctl.sens;
    ctl.pitch = Math.max(-1.4, Math.min(1.4, ctl.pitch - e.movementY * ctl.sens));
  });
  window.addEventListener('keydown', (e) => ctl.keys.add(e.code));
  window.addEventListener('keyup', (e) => ctl.keys.delete(e.code));

  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _from = new THREE.Vector3(), _dir = new THREE.Vector3();

  // Hip reference pose — the same numbers player.js hardcodes for the holder.
  const HIP_POS = [0.28, -0.24, -0.55];
  const HIP_FOV = 75;
  const TAN_HIP = Math.tan(THREE.MathUtils.degToRad(HIP_FOV) / 2);
  const vmBase = new THREE.Vector3().fromArray(HIP_POS); // lerped, recoil-free
  const vmRot = { x: 0, y: 0, z: 0 };
  const _tgt = new THREE.Vector3();
  let vmScale = 1;

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

    // ---- hip / ADS pose ----------------------------------------------------
    // Everything the aimed state changes, lerped from one rate so the whole
    // gun arrives together. Recoil stays additive on top, as in player.js.
    const a = ensureAds(fpKey);
    const on = adsOn();
    const k = Math.min(1, dt * (a.speed || ADS_DEFAULT.speed));
    _tgt.fromArray(on ? a.pos : HIP_POS);
    vmBase.lerp(_tgt, k);
    fpViewmodel.position.copy(vmBase);
    fpViewmodel.position.z += ctl.recoil * 0.06;
    const tr = on ? a.rot : ADS_DEFAULT.rot;
    vmRot.x += (tr[0] - vmRot.x) * k;
    vmRot.y += (tr[1] - vmRot.y) * k;
    vmRot.z += (tr[2] - vmRot.z) * k;
    fpViewmodel.rotation.set(vmRot.x + ctl.recoil * 0.12, vmRot.y, vmRot.z);
    vmScale += ((on ? (a.scale ?? 1) : 1) - vmScale) * k;
    fpViewmodel.scale.setScalar(vmScale);

    const tgtFov = on ? (def.adsFov || 55) : HIP_FOV;
    if (Math.abs(fpCam.fov - tgtFov) > 0.01) {
      fpCam.fov += (tgtFov - fpCam.fov) * k;
      fpCam.updateProjectionMatrix();
    }
    // Look speed scales with the zoom, so `sens` is a feel nudge and 1.0 is
    // already right at every magnification. This is the rule player.js should
    // adopt in place of its single 0.0011.
    ctl.sens = 0.0021 * (on ? (a.sens ?? 1) : 1) *
      Math.tan(THREE.MathUtils.degToRad(fpCam.fov) / 2) / TAN_HIP;

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
      const veh = mode === 'veh';
      document.getElementById('backMode').style.display = mode === 'back' ? 'block' : 'none';
      document.getElementById('gripMode').style.display = mode === 'grip' ? 'block' : 'none';
      document.getElementById('fpMode').style.display = mode === 'fp' ? 'block' : 'none';
      document.getElementById('adsMode').style.display = mode === 'ads' ? 'block' : 'none';
      document.getElementById('vehMode').style.display = veh ? 'block' : 'none';
      // The character line-up and the proving ground are different worlds at
      // the same origin; showing both at once puts a Warthog through six
      // marines. The anim row is theirs too, so it goes with them.
      for (const c of chars) c.mesh.visible = !veh;
      ground.visible = !veh;
      grid.visible = !veh;
      document.getElementById('animBtns').style.display = veh ? 'none' : 'flex';
      panel.classList.toggle('wide', veh);
      if (range) range.setActive(veh);
      controls.enabled = !isFpMode(mode) && !veh;
      cross.style.display = isFpMode(mode) ? 'block' : 'none';
      targets.visible = isFpMode(mode);
      if (!isFpMode(mode) && document.pointerLockElement) document.exitPointerLock();
      document.getElementById('hint').textContent =
        mode === 'grip' ? 'values update live · paste grip lines into config.js WEAPONS'
        : mode === 'fp' ? 'first-person view · paste fp lines into config.js WEAPONS'
        : mode === 'ads' ? 'aimed · RMB aims when LOCK is off · paste ads lines into config.js WEAPONS'
        : veh ? 'WASD drive · SPACE handbrake · R reset · C camera · paste block into config.js CFG.vehicle'
        : 'values update live · paste block into soldier.js BACK';
      if (mode === 'grip') { holdEverywhere(gripKey); buildGripInputs(); dumpGrips(); }
      else if (isFpMode(mode)) {
        fpHold(fpKey);
        buildFpInputs();
        buildAdsInputs();
        if (mode === 'ads') dumpAds(); else dumpFp();
      }
      else if (veh) dumpVehicle();
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
    mesh.position.set(slotX(i), 0, 0);
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

  range = createVehicleRange(assets);
  scene.add(range.group);
  resizeCams.push(range.camera);
  // Same shape as __ctGet/__ctFrame above: a handle for headless verification,
  // since rAF halts whenever this tab is not composited.
  window.__ctRange = range;
  window.__ctScene = { renderer, scene, camera };

  loadmsg.style.display = 'none';
  panel.style.display = 'block';
  buildPanel(assets);

  range.buildInputs(document.getElementById('vehInputs'), dumpVehicle);
  document.getElementById('vehReset').onclick = () => range.reset();
  document.getElementById('vehCam').onclick = () => {
    // Same cycle the C key drives, so the button is a label as much as a
    // control — the name updates from the range either way (see the frame loop).
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC' }));
  };

  // singleton: if a stale HMR instance's loop is still alive, it stops itself
  const token = {};
  window.__ctToken = token;
  const clock = new THREE.Clock();
  const telEl = document.getElementById('vehTel');
  const camBtn = document.getElementById('vehCam');
  // Sampled at the TOP of the frame, so renderer.info describes the frame that
  // was actually drawn rather than one that has not happened yet.
  const perf = makePerf(renderer);
  const frame = (dt) => {
    perf();
    if (mode === 'veh') {
      range.update(dt);
      telEl.textContent = range.telemetry();
      camBtn.textContent = `CAM: ${range.camName} (C)`;
      window.__ctDebug = { mode, cam: range.camName };
      renderer.render(scene, range.camera);
      return;
    }
    for (const c of chars) c.mixer.update(dt);
    if (controls.enabled) controls.update();
    if (isFpMode(mode) && fpUpdate) fpUpdate(dt);
    const cam = isFpMode(mode) && window.__fpCam ? window.__fpCam : camera;
    window.__ctDebug = { mode, usingFp: cam !== camera };
    if (isFpMode(mode) && fpPreRender) fpPreRender(cam); // scope glass, before the main pass
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
