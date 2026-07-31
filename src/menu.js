// Armory / loadout menu: class tabs, weapon cards with baked thumbnails,
// and an interactive 3D inspection viewer (drag to spin, wheel to zoom).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CFG, WEAPONS, CLASSES, PRIMARIES } from './config.js';
import { prewarm, weaponClones } from './assets.js';

const S = CFG.armoryStage;
const L = S.light;

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

// ---- Authoring stage colours in display space, on a tone-mapped pipeline ----
//
// The sky and deck used to encode to sRGB themselves and write straight to the
// canvas, which made an authored hex the final pixel. Bloom ends that: three
// disables tone mapping whenever it renders into a render target, so the
// composer's OutputPass has to own tone mapping and encoding for everything —
// and a shader that had already encoded itself would be put through ACES and
// sRGB a second time.
//
// So the stage shaders now emit plain scene-linear, like every other material.
// To keep the config authored in display space (which is the useful way to tune
// a backdrop — you pick the pixel you want), `stageColor` runs an authored hex
// BACKWARDS through the exact transform the OutputPass will apply, so it lands
// on that hex. Verified round-trip exact to 0/255 across the palette.
//
// This does NOT apply to lights — see `seamGlow` in config, which is authored
// in scene-linear on purpose so it can exceed 1.0 and bloom.
const ACES_IN = [0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777];
const ACES_OUT = [1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602];
const mat3Mul = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];

// three's ACESFilmicToneMapping, transcribed from tonemapping_pars_fragment.
function acesFilmic(c, exposure) {
  let v = c.map((x) => (x * exposure) / 0.6);
  v = mat3Mul(ACES_IN, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  v = mat3Mul(ACES_OUT, v);
  return v.map((x) => Math.min(1, Math.max(0, x)));
}

// Scene-linear colour that tone-maps to the authored hex. Componentwise fixed
// point — ACES is smooth and monotonic over this range, so scaling the input by
// how far the output missed converges in a few steps.
function stageColor(hex, exposure) {
  const target = new THREE.Color(hex).toArray();
  let c = target.map((x) => x / 0.3);
  for (let i = 0; i < 40; i++) {
    const got = acesFilmic(c, exposure);
    c = c.map((x, k) => (got[k] > 1e-9 ? x * (target[k] / got[k]) : x));
  }
  return new THREE.Color().fromArray(c);
}

// The sky, as a pure function of world ray direction, shared verbatim by the
// backdrop and the deck. That sharing is the whole reason the floor can mirror
// the room essentially for free: the backdrop evaluates it for the view ray,
// the deck evaluates it for the REFLECTED view ray. No render target, no second
// pass, and no chance of the two drifting apart.
//
// The vignette is deliberately NOT in here — it is a lens effect, so it belongs
// to the backdrop's screen space and must not appear in a reflection.
const SKY_FN = `
  uniform vec3 uSkyTop, uSkyHorizon, uSkyBand, uSkyCol;
  uniform float uSkyRise, uSkyBandW, uSkyColX, uSkyColW;

  vec3 skyColor(vec3 dir) {
    float up = dir.y;   // 0 on the horizon, +1 straight up
    vec3 c = mix(uSkyHorizon, uSkyTop, smoothstep(0.0, uSkyRise, up));
    // the tight atmospheric band sitting on the horizon line
    c += uSkyBand * exp(-abs(up) / max(uSkyBandW, 1e-4));
    // one soft distant light column behind the weapon
    float cx = (dir.x - uSkyColX) / max(uSkyColW, 1e-4);
    c += uSkyCol * exp(-cx * cx) * (1.0 - smoothstep(0.0, uSkyRise * 2.2, abs(up)));
    return c;
  }`;

// Sub-LSB dither, applied last. OutputPass writes 8-bit and does not dither;
// the stage spans only a handful of 8-bit steps end to end, so without this its
// gradients band into visible stripes.
const DitherShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = c;
    }`,
};

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
    this.pitch = S.pitch;   // degrees, drag-adjustable
    this.floorY = -0.2;     // replaced per weapon from its bounding box
    this._mirrors = {};     // cached mirrored clones, keyed by weapon
    this.thumbs = {};       // baked card renders, keyed by weapon (see _bakeThumbnails)

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
      <div class="ar-bottom" id="arBottom">
        <div class="ar-tabs" id="arTabs"></div>
        <div class="ar-panel">
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
          </div>
        </div>
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
      bottom: ov.querySelector('#arBottom'),
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
    // Enabled here, BEFORE prewarm() runs — shadows are part of three's program
    // key, so turning them on later recompiles every weapon material on the
    // first visible frame.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Also part of the program key, so it belongs here with the shadow flags.
    // Without it three defaults to NoToneMapping, which clips linearly: every
    // highlight above 1.0 flattens to the same value and the mids never fall
    // away. That is what made the weapon read as uniform mid-grey instead of a
    // dark body with bright specular edges.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = L.exposure;
    this.el.viewer.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // Gentle atmosphere on the weapon itself. three's fog_fragment sits BELOW
    // tonemapping_fragment and colorspace_fragment in the material shaders, so
    // the fog colour is mixed in final display space — the same space the sky
    // and deck shaders are authored in. Build it with LinearSRGBColorSpace so
    // three does not sRGB-decode the hex on the way in and land the weapon on a
    // different grey than the horizon it is supposed to be receding into.
    //
    // Fog is part of three's program cache key, so like the shadow and tone
    // mapping flags above it has to be set BEFORE prewarm() compiles anything.
    if (S.fog) {
      this.scene.fog = new THREE.Fog(
        new THREE.Color().setHex(S.fogColor, THREE.LinearSRGBColorSpace),
        S.fogNear, S.fogFar);
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), L.envBlur).texture;
    this.scene.environmentIntensity = L.env;
    const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemi);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(L.keyColor, L.key);
    key.position.set(...L.keyPos);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(L.rimColor, L.rim);
    rim.position.set(...L.rimPos);
    this.scene.add(rim);
    // A separate near-overhead light owns the shadow. Casting from `key` would
    // throw a long raking shadow off to one side; straight down gives the tight
    // contact patch that reads as "resting on the deck". Dim, so it adds the
    // top-edge highlight without disturbing the existing key/rim balance.
    const top = new THREE.DirectionalLight(L.topColor, L.top);
    top.position.set(...L.topPos);
    top.castShadow = true;
    top.shadow.mapSize.set(S.shadowSize, S.shadowSize);
    top.shadow.camera.near = 0.5;
    top.shadow.camera.far = 8;
    const ext = 1.3; // half-width of the shadow frustum; covers the longest gun
    Object.assign(top.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    top.shadow.camera.updateProjectionMatrix();
    top.shadow.bias = -0.0008;
    this.scene.add(top);
    this.scene.add(top.target);
    // Upper-front-left, on the muzzle side (the holder yaws the gun so its barrel
    // points -X). `key` is at +X and lights the stock; `rim` is on this side but
    // behind. Without this one the front half of every weapon goes unlit.
    const front = new THREE.DirectionalLight(L.frontColor, L.front);
    front.position.set(...L.frontPos);
    this.scene.add(front);
    this.scene.add(front.target);
    // Deck bounce: the only light coming from BELOW. Never casts — a shadow
    // thrown upward off the floor is not a thing.
    const bounce = new THREE.DirectionalLight(L.bounceColor, L.bounce);
    bounce.position.set(...L.bouncePos);
    this.scene.add(bounce);
    this.scene.add(bounce.target);
    this.lights = { hemi, key, rim, top, bounce, front }; // handles for console tuning

    this.camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.02, 20);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.zoom = 1;
    this._buildBackdrop();
    this._buildStage();
    this._buildComposer();

    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; });
    window.addEventListener('pointerup', () => { this.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging || !this.visible) return;
      // Horizontal drag turns the weapon on its stand; vertical drag orbits the
      // CAMERA instead of tipping the model. Tipping used to be fine in a void,
      // but now there is a deck — a gun rotated on X would sink through it and
      // its reflection would detach.
      this.holder.rotation.y += (e.clientX - this.lastX) * 0.012;
      this.pitch = Math.max(S.pitchMin, Math.min(S.pitchMax,
        this.pitch - (e.clientY - this.lastY) * S.pitchSpeed));
      this._frameCamera();
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.55, Math.min(2, this.zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
      this._frameCamera();
    }, { passive: false });

    // The canvas is CSS-stretched to fill the viewer, so a drawing buffer that
    // disagrees with the box shows up as a horizontally smeared gun. Track the
    // element itself — this covers window resizes and the first layout pass.
    this._resizeObs = new ResizeObserver(() => this._resizeViewer());
    this._resizeObs.observe(this.el.viewer);
  }

  // Scene -> bloom -> tone map -> dither.
  //
  // Everything in the scene now renders scene-linear into a half-float buffer;
  // OutputPass is what applies ACES and the sRGB encode at the end. That split
  // is forced rather than chosen: three turns tone mapping OFF whenever it
  // renders into a render target (three.module.js, `currentRenderTarget === null
  // ? renderer.toneMapping : NoToneMapping`), so the moment a post chain exists
  // the weapon stops being tone-mapped by the renderer and something at the end
  // has to do it. Which in turn is why the sky and deck had to give up encoding
  // themselves — see `stageColor`.
  _buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (S.bloom) {
      // Threshold is a SCENE RADIANCE here, not a display value: the deck sits
      // near 0.02 and the seams are driven past 1.0 by seamGlowStrength, so
      // this number separates lights from surfaces rather than bright from dark.
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(1, 1), S.bloomStrength, S.bloomRadius, S.bloomThreshold);
      this.composer.addPass(this.bloomPass);
    }
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(DitherShader));
  }

  // The sky, as a full-screen quad inside the scene rather than a CSS gradient
  // behind the canvas. Moving it in here is what lets the deck HAZE into it:
  // the floor shader blends toward the same horizon colour with distance, so
  // the two meet with no seam and the deck no longer needs an alpha fade (which
  // is what used to show up as a hard band cutting across the frame).
  //
  // Shaded off the WORLD-SPACE VIEW RAY, not off screen UVs. `dir.y == 0` is
  // exactly the horizon for any pitch, any zoom, and — importantly — any
  // setViewOffset, since the lens shift lives in projectionMatrix and therefore
  // in its inverse. A screen-space gradient would need re-tuning every time
  // _frameCamera moved the frustum.
  // The sky's uniform block. Built fresh for each material that wants it — the
  // deck needs the same numbers to reflect, and handing both shaders the same
  // named set is what keeps SKY_FN drop-in for either.
  _skyUniforms() {
    const K = S.sky, e = L.exposure;
    return {
      uSkyTop: { value: stageColor(K.top, e) },
      uSkyHorizon: { value: stageColor(K.horizon, e) },
      uSkyBand: { value: stageColor(K.band, e) },
      uSkyCol: { value: stageColor(K.column, e) },
      uSkyRise: { value: K.rise },
      uSkyBandW: { value: K.bandWidth },
      uSkyColX: { value: K.columnX },
      uSkyColW: { value: K.columnW },
    };
  }

  _buildBackdrop() {
    const K = S.sky;
    const mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...this._skyUniforms(),
        uProjInv: { value: new THREE.Matrix4() },
        uViewInv: { value: new THREE.Matrix4() },
        uVig: { value: K.vignette },
      },
      vertexShader: `
        varying vec2 vNdc;
        void main() {
          vNdc = position.xy;
          // straight to clip space at the far plane; no matrices involved
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,
      fragmentShader: `
        uniform mat4 uProjInv, uViewInv;
        uniform float uVig;
        varying vec2 vNdc;
        ${SKY_FN}

        void main() {
          vec4 vp = uProjInv * vec4(vNdc, -1.0, 1.0);
          vec3 dir = normalize((uViewInv * vec4(normalize(vp.xyz / vp.w), 0.0)).xyz);
          vec3 col = skyColor(dir);
          col *= 1.0 - uVig * dot(vNdc, vNdc) * 0.5;

          // scene-linear out; OutputPass tone maps and encodes
          gl_FragColor = vec4(max(col, 0.0), 1.0);
        }`,
    });
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.backdrop.frustumCulled = false; // its verts are already in clip space
    this.backdrop.renderOrder = -1;      // opaque, but must land before the gun
    this.scene.add(this.backdrop);
  }

  // Force a map to tile by mirror-blending a band at each border.
  //
  // At the very edge the output is the average of that pixel and its opposite
  // number, so column 0 and column W-1 come out identical and the tile joins
  // exactly — same for the rows. The two passes run in sequence rather than
  // being summed, which is what makes the CORNERS agree as well.
  //
  // Chosen over the alternatives because it holds for any map: cropping to a
  // whole number of panels needs a regular pitch (this one's is irregular, and
  // is not a whole fraction of its width either), and MirroredRepeatWrapping
  // would halve the effective panel pitch at every mirror line.
  _makeSeamless(img) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const band = Math.max(1, Math.round(Math.min(W, H) * S.deckSeamBlend));
    const src = g.getImageData(0, 0, W, H);
    const mid = g.createImageData(W, H);
    // weight reaches exactly 0.5 at the border and 0 by `band` pixels in
    const wOf = (i, n) => 0.5 * (1 - Math.min(1, Math.min(i, n - 1 - i) / band));

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const w = wOf(x, W), o = (y * W + x) * 4, m = (y * W + (W - 1 - x)) * 4;
        for (let k = 0; k < 3; k++) mid.data[o + k] = src.data[o + k] * (1 - w) + src.data[m + k] * w;
        mid.data[o + 3] = 255;
      }
    }
    const out = g.createImageData(W, H);
    let sum = 0;
    for (let y = 0; y < H; y++) {
      const w = wOf(y, H);
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4, m = ((H - 1 - y) * W + x) * 4;
        for (let k = 0; k < 3; k++) out.data[o + k] = mid.data[o + k] * (1 - w) + mid.data[m + k] * w;
        out.data[o + 3] = 255;
        sum += out.data[o];
      }
    }
    g.putImageData(out, 0, 0);
    // The shader reads the map against its own MEAN, so any map — dark plates,
    // mid-grey scuffs — drops in without re-tuning deckDetail.
    this._mapMid.value = Math.max(0.02, sum / (W * H) / 255);
    return cv;
  }

  // The deck's map. With `deckUrl` set it carries the whole plate structure —
  // grooves, bolts, cracks, plate-to-plate tone. Without one, a scuff map is
  // generated into a canvas so the stage still works with no asset; that one is
  // seamless by construction (smears run the full width, so X wraps for free,
  // and any crossing the top or bottom edge are drawn again wrapped).
  _deckTexture() {
    let tex;
    if (S.deckUrl) {
      // Loaded by hand rather than through TextureLoader: the bitmap has to be
      // processed on a canvas before the GPU sees it, both to make it tile and
      // to measure its mean.
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const g2 = cv.getContext('2d');
      g2.fillStyle = '#808080';
      g2.fillRect(0, 0, 1, 1);
      tex = new THREE.CanvasTexture(cv);
      const img = new Image();
      img.onload = () => {
        tex.image = this._makeSeamless(img);
        tex.needsUpdate = true;
      };
      img.onerror = () => console.warn(`deck map failed to load: ${S.deckUrl}`);
      img.src = S.deckUrl;
    } else {
      const N = 1024;
      const cv = document.createElement('canvas');
      cv.width = N; cv.height = N;
      const g = cv.getContext('2d');
      g.fillStyle = '#808080';
      g.fillRect(0, 0, N, N);

      // Broad polish smears. Long and thin — the anisotropy of a floor that has
      // been buffed in one direction, which is what gives the horizontal streaks
      // at a grazing camera.
      let seed = 20260731;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < 260; i++) {
        const y = rnd() * N;
        const h = 1 + rnd() * rnd() * 26;
        const v = (rnd() - 0.5) * 78;
        const x0 = rnd() * N;
        const w = N * (0.25 + rnd() * 0.9);
        const grad = g.createLinearGradient(x0, 0, x0 + w, 0);
        const c = `${128 + v | 0}`;
        grad.addColorStop(0, `rgba(${c},${c},${c},0)`);
        grad.addColorStop(0.5, `rgba(${c},${c},${c},${0.1 + rnd() * 0.4})`);
        grad.addColorStop(1, `rgba(${c},${c},${c},0)`);
        g.fillStyle = grad;
        for (const dx of [-N, 0, N]) {
          for (const dy of [-N, 0, N]) g.fillRect(x0 + dx, y + dy, w, h);
        }
      }

      // Fine grain on top, per pixel so it is seamless for free. Weighted toward
      // the middle, or the map reads as static rather than as a surface.
      const img = g.getImageData(0, 0, N, N);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = ((rnd() + rnd() + rnd()) / 3 - 0.5) * 26;
        d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, d[i] + n));
      }
      g.putImageData(img, 0, 0);
      tex = new THREE.CanvasTexture(cv);
      this._mapMid.value = 0.5; // generated map is centred by construction
    }
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // NoColorSpace, not sRGB: this is a multiplier, not a colour. Decoding it
    // would bend 0.5 off centre and darken the whole deck.
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  // The deck: a world-space grid that dissolves into the page background, a
  // shadow catcher a hair above it, and a mirrored copy of the weapon under it.
  //
  // Draw order matters and is pinned with renderOrder rather than left to
  // three's distance sort:
  //   gun (opaque) → deck (1) → shadow (2) → reflection (3)
  // The reflection is geometrically BELOW the deck, so it carries depthTest off
  // and draws last, smearing over the deck the way a real one would. It can
  // never cover the gun: reflected geometry is always on the far side of the
  // mirror line from the camera.
  _buildStage() {
    this._mapMid = { value: 0.5 }; // filled in by _deckTexture / _makeSeamless
    const dir = (p) => new THREE.Vector3(...p).normalize();
    const floorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...this._skyUniforms(), // the deck reflects the sky — see SKY_FN
        // Surface colours are authored in DISPLAY space and pushed back through
        // the tone curve by stageColor, so the hex in config is the pixel you
        // get. Lights (uSeamGlow, uGrooveGlow, uSpec) are NOT — those are
        // scene-linear and run past 1.0 so they bloom.
        uBase: { value: stageColor(S.floorBase, L.exposure) },
        uHorizon: { value: stageColor(S.floorHorizon, L.exposure) },
        uBand: { value: stageColor(S.floorBand, L.exposure) },
        uBandRamp: { value: S.bandRamp },
        uGroove: { value: stageColor(S.seamGroove, L.exposure) },
        uSeamOn: { value: S.proceduralSeams ? 1 : 0 },
        uSeamGlow: { value: new THREE.Color(S.seamGlow) },
        uSeamStr: { value: S.seamGlowStrength },
        uSeamStrMajor: { value: S.seamGlowMajor },
        uSeamW: { value: S.seamWidth },
        uSeamWMajor: { value: S.seamMajorWidth },
        uSeamGlowW: { value: S.seamGlowWidth },
        uSeamDrop: { value: S.seamDrop },
        uSeamVary: { value: S.seamVary },
        uPanelTone: { value: S.panelTone },
        uGlow: { value: stageColor(S.floorGlow, L.exposure) },
        uStep: { value: S.gridStep },
        uMajor: { value: S.gridMajor },
        uHaze: { value: S.haze },
        uHazeStart: { value: S.hazeStart },
        uLineNear: { value: S.seamNear },
        uLineSoft: { value: S.seamNearSoft },
        uGrooveGlow: { value: new THREE.Color(S.grooveGlow) },
        uGrooveStr: { value: S.grooveGlowStrength },
        uGrooveLo: { value: S.grooveLo },
        uGrooveHi: { value: S.grooveHi },
        uF0: { value: S.reflectF0 },
        uReflect: { value: S.reflectStrength },
        uRough: { value: S.reflectRough },
        uSpec: { value: new THREE.Color(S.specColor) },
        uSpecPow: { value: S.specPower },
        uL1: { value: dir(L.keyPos) },
        uL1Str: { value: S.specKey },
        uL2: { value: dir(L.frontPos) },
        uL2Str: { value: S.specFront },
        uGlossVar: { value: S.glossVar },
        uMap: { value: this._deckTexture() },
        uMapMid: this._mapMid,
        uMapMax: { value: S.deckMapMax },
        uTile: { value: S.deckTile },
        uDetail: { value: S.deckDetail },
        uGlowR: { value: S.glowRadius },
        uAlpha: { value: S.floorAlpha },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uBase, uHorizon, uBand, uGlow, uGroove, uSeamGlow;
        uniform float uBandRamp;
        uniform float uStep, uMajor, uSeamOn;
        uniform float uSeamStr, uSeamStrMajor, uSeamW, uSeamWMajor;
        uniform float uSeamGlowW, uSeamDrop, uSeamVary, uPanelTone;
        uniform vec3 uGrooveGlow, uSpec;
        uniform float uGrooveStr, uGrooveLo, uGrooveHi;
        uniform float uF0, uReflect, uRough, uSpecPow, uL1Str, uL2Str, uGlossVar;
        uniform vec3 uL1, uL2;
        uniform float uHaze, uHazeStart, uLineNear, uLineSoft;
        uniform sampler2D uMap;
        uniform float uTile, uDetail, uMapMid, uMapMax, uGlowR, uAlpha;
        varying vec3 vWorld;
        ${SKY_FN}

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 34.56);
          return fract(p.x * p.y);
        }

        // Metres to the nearest MINOR seam crossing axis "a", where "b" runs
        // along it. The pair (boundary index, cell index along that boundary) is
        // the SEGMENT identity, and hashing it is what makes individual runs go
        // missing — which is where the uneven spacing and the T-junctions come
        // from. A ruled grid cannot produce either.
        float seamMinor(float a, float b, float s) {
          float bi = floor(a / s + 0.5);
          // major boundaries are owned by seamMajor; skip them here so the two
          // tiers do not stack into one over-bright line
          if (abs(mod(bi, uMajor)) < 0.5) return 1e3;
          if (hash21(vec2(bi, floor(b / s))) < uSeamDrop) return 1e3;
          return abs(a / s - bi) * s;
        }

        // ...and to the nearest MAJOR seam. These never drop: they are the
        // structure the plates are laid against.
        float seamMajor(float a, float s) {
          return abs(a / s - floor(a / s + 0.5)) * s;
        }

        // Coverage of a seam of half-width "w" at distance "d", antialiased on
        // the distance field's own screen-space gradient. Widening to a pixel
        // and dimming to compensate is what makes far seams FADE rather than
        // sparkle — the energy is conserved instead of being point-sampled.
        float seamCoverage(float d, float w, float fp) {
          float wide = max(w, fp * 0.6);
          return (1.0 - smoothstep(0.0, wide, d)) * (w / wide);
        }

        void main() {
          // Distance from the CAMERA, not from the weapon. This is the whole
          // difference between "a room you are standing in" and "a lit grid
          // floating in a void": haze has to build with how far away a patch of
          // deck is from the eye, so the near field goes dark and the horizon
          // glows, not the other way around.
          float d = distance(vWorld, cameraPosition);
          float haze = 1.0 - exp(-max(d - uHazeStart, 0.0) * uHaze);
          // Grid and streaks both live in a mid band: suppressed right under the
          // camera, washed out toward the horizon by the haze mix below.
          float amp = smoothstep(uLineNear, uLineSoft, d);

          vec3 col = uBase;
          // Per-plate tone. Hashed per CELL, so where a seam has been dropped
          // and two cells read as one plate there is a small step across a seam
          // that is not there — keep uPanelTone low enough that it reads as
          // patina rather than as a mistake.
          vec2 cell = floor(vWorld.xz / uStep);
          col *= 1.0 + (hash21(cell) - 0.5) * 2.0 * uPanelTone;
          // small pool of light directly beneath the weapon
          col += uGlow * pow(1.0 - min(length(vWorld.xz) / uGlowR, 1.0), 2.0);
          // The deck map, sampled in world XZ so it stays put on the deck rather
          // than swimming with the camera. Read against its OWN MEAN, measured
          // at load: at the mean it changes nothing, grooves darken and bolts
          // brighten, and any map drops in without re-tuning uDetail. It
          // MULTIPLIES, so plate detail scales with how lit that patch is
          // instead of staying equally readable in the dark near field. Mip
          // selection handles the grazing angle.
          float det = texture2D(uMap, vWorld.xz / uTile).r;
          float m = clamp(det / uMapMid, 0.0, uMapMax);
          col *= mix(1.0, m, uDetail);

          // ---- light in the deck map's own grooves ----
          // Keyed off the map going dark, so it follows whatever panelling the
          // map has and is aligned to it by construction — which is the whole
          // reason the procedural seams below are off when a map is in use.
          float groove = 1.0 - smoothstep(uGrooveLo, uGrooveHi, m);
          col += uGrooveGlow * groove * uGrooveStr * amp;

          // ---- procedural panel seams (only without a panelled deck map) ----
          if (uSeamOn > 0.5) {
          float dMinor = min(seamMinor(vWorld.x, vWorld.z, uStep),
                             seamMinor(vWorld.z, vWorld.x, uStep));
          float dMajor = min(seamMajor(vWorld.x, uStep * uMajor),
                             seamMajor(vWorld.z, uStep * uMajor));
          // Clamp the footprint: a dropped segment makes the distance field jump
          // to 1e3, and fwidth across that discontinuity is enormous — unclamped
          // it blows the seam width open for one pixel at every plate corner.
          float fpMinor = clamp(fwidth(dMinor), 1e-5, uStep * 0.25);
          float fpMajor = clamp(fwidth(dMajor), 1e-5, uStep * 0.25);
          float cMinor = seamCoverage(dMinor, uSeamW, fpMinor);
          float cMajor = seamCoverage(dMajor, uSeamWMajor, fpMajor);

          // The groove is a recess in the plate, so it REPLACES the surface...
          col = mix(col, uGroove, max(cMinor, cMajor) * 0.9 * amp);
          // ...and the light in it is emissive, so it ADDS. The exp() skirt is
          // the light spilling onto the plates either side; bloom widens it
          // further, which is what finally reads as a glow rather than a line.
          float spill = exp(-dMinor / uSeamGlowW) * uSeamStr
                      + exp(-dMajor / uSeamGlowW) * uSeamStrMajor;
          // Vary brightness per plate edge. Keyed on the cell, so it steps at
          // every plate boundary — a long run reads as a line of separate lit
          // gaps rather than one uniform strip of neon.
          float segVar = 1.0 - uSeamVary * hash21(cell + 7.13);
          col += uSeamGlow * (cMinor * uSeamStr + cMajor * uSeamStrMajor + spill * 0.22) * amp * segVar;
          }

          // ---- environment reflection ----
          // The deck is polished, and the eye sits a few centimetres above it,
          // so Fresnel is doing most of the work: at these grazing angles the
          // surface reflects nearly everything, which is what produces the
          // brightening toward the horizon, the long soft smears and the wet
          // look all at once.
          vec3 V = normalize(vWorld - cameraPosition);
          vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
          float cosT = clamp(-V.y, 0.0, 1.0);
          float F = uF0 + (1.0 - uF0) * pow(1.0 - cosT, 5.0);
          // Scuffs break the polish, so the map drives glossiness too — that is
          // what stops the reflection reading as a clean mirror.
          float gloss = clamp(mix(1.0, m, uGlossVar), 0.0, 2.0);
          // Five weighted taps spread in Y approximate a rough reflection. Y
          // only: on a horizontal floor the sky varies almost entirely with
          // height, so blurring across it is where all the softness is. Five
          // rather than three because the horizon band is tight (uSkyBandW is
          // 0.02) — at any useful roughness three taps straddle it and the
          // reflection bands into visible steps instead of a smooth falloff.
          vec3 refl = skyColor(normalize(R + vec3(0.0, -uRough, 0.0)))
                    + skyColor(normalize(R + vec3(0.0, -uRough * 0.5, 0.0))) * 2.0
                    + skyColor(R) * 3.0
                    + skyColor(normalize(R + vec3(0.0, uRough * 0.5, 0.0))) * 2.0
                    + skyColor(normalize(R + vec3(0.0, uRough, 0.0)));
          refl /= 9.0;
          col = mix(col, refl, clamp(F * uReflect * gloss, 0.0, 1.0));
          // Broad specular lobes off the key and front lights. At a grazing view
          // these stretch along the deck into the horizontal smears.
          float spec = pow(max(dot(R, uL1), 0.0), uSpecPow) * uL1Str
                     + pow(max(dot(R, uL2), 0.0), uSpecPow) * uL2Str;
          col += uSpec * spec * F * gloss;

          // ...and the deck hazes into the sky. It has to land on the backdrop's
          // colour at ray.y == 0 INCLUDING that shader's horizon glow, hence the
          // band term — matching only uHorizon leaves a step in value sitting
          // right on the join. This replaces the old fade-to-transparent, which
          // compressed into a hard band of its own.
          vec3 far = uHorizon + uBand * smoothstep(uBandRamp, 1.0, haze);
          col = mix(col, far, haze);

          // scene-linear out; OutputPass tone maps and encodes
          gl_FragColor = vec4(max(col, 0.0), uAlpha);
        }`,
    });
    const quad = new THREE.PlaneGeometry(S.floorSize, S.floorSize).rotateX(-Math.PI / 2);
    this.floor = new THREE.Mesh(quad, floorMat);
    this.floor.renderOrder = 1;
    this.scene.add(this.floor);

    this.shadowPlane = new THREE.Mesh(quad, new THREE.ShadowMaterial({
      // fog off: the deck quad is huge now, and a fogged ShadowMaterial would
      // lift the contact shadow toward the horizon colour instead of darkening.
      opacity: S.shadowAlpha, transparent: true, depthWrite: false, fog: false,
    }));
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.renderOrder = 2;
    this.scene.add(this.shadowPlane);

    // Reflecting across y = floorY is scale(1,-1,1) then translate by 2*floorY.
    // That commutes with the holder's yaw, so the mirror only has to copy
    // rotation.y each frame — see render().
    this.mirror = new THREE.Group();
    this.mirror.scale.set(1, -1, 1);
    this.scene.add(this.mirror);
    this._mirrorShaders = []; // live uniforms, re-aimed whenever floorY moves
  }

  // A reflection at flat opacity is a detached ghost floating in the dark: the
  // deck has already dissolved by the time you are looking a metre under it.
  // Fade the mirrored copy out with depth below the mirror line so it stays a
  // smear hugging the contact point, which is all the reference image shows.
  //
  // `jitter` is this copy's screen-space offset per metre of depth below the
  // mirror line — see reflectBlur in config. Applied to gl_Position AFTER the
  // projection, multiplied by w so it stays a constant offset in pixels rather
  // than shrinking with distance: a blur kernel is a screen-space thing.
  _fadeMirrorMaterial(mat, jitter) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uMirrorY = { value: this.floorY };
      sh.uniforms.uMirrorFade = { value: S.reflectFade };
      sh.uniforms.uJitter = { value: jitter };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying float vMirY;\nuniform vec2 uJitter;\nuniform float uMirrorY;')
        .replace('#include <project_vertex>',
          '#include <project_vertex>\nvMirY = (modelMatrix * vec4(transformed, 1.0)).y;\n' +
          'gl_Position.xy += uJitter * max(0.0, uMirrorY - vMirY) * gl_Position.w;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>',
          '#include <common>\nvarying float vMirY;\nuniform float uMirrorY, uMirrorFade;')
        .replace('#include <dithering_fragment>',
          '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(0.0, uMirrorFade, uMirrorY - vMirY);');
      this._mirrorShaders.push(sh);
    };
    // onBeforeCompile is part of three's program cache key via customProgramCacheKey
    mat.customProgramCacheKey = () => 'armory-mirror';
  }

  // Mirrored copies need their own materials (transparent, depth-free), and the
  // originals are shared with the real gun — so clone the materials once per
  // weapon and keep them. Eight guns; cloning on every tab click would churn.
  //
  // The result is a STACK of `reflectBlurTaps` copies at a fraction of the
  // opacity each, spread along a mostly-vertical screen-space line: that stack
  // is the blur. Costs a few extra draw calls of already-uploaded geometry, and
  // buys a soft reflection with no render target, no second pass, and no
  // interaction with the composer.
  _mirrorFor(key) {
    if (this._mirrors[key]) return this._mirrors[key];
    const src = this.game.assets.weaponModels[key];
    if (!src) return null;
    const taps = Math.max(1, Math.round(S.reflectBlurTaps));
    const group = new THREE.Group();
    for (let i = 0; i < taps; i++) {
      const t = taps === 1 ? 0 : (i / (taps - 1)) * 2 - 1; // -1 .. 1
      // mostly vertical: a floor reflection spreads along the surface, which at
      // this camera is very nearly straight up the screen
      const jitter = new THREE.Vector2(t * S.reflectBlur * 0.22, t * S.reflectBlur);
      const m = src.clone(true);
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = false;
        o.renderOrder = 3;
        const one = !Array.isArray(o.material);
        const mats = (one ? [o.material] : o.material).map((mat) => {
          const c = mat.clone();
          c.transparent = true;
          c.opacity = S.reflect / taps;
          c.depthWrite = false;
          c.depthTest = false;          // the deck is drawn before it, not over it
          c.side = THREE.DoubleSide;    // negative Y scale flips triangle winding
          this._fadeMirrorMaterial(c, jitter);
          return c;
        });
        o.material = one ? mats[0] : mats;
      });
      group.add(m);
    }
    this._mirrors[key] = group;
    return group;
  }

  _placeStage() {
    this.floor.position.y = this.floorY;
    this.shadowPlane.position.y = this.floorY + 0.002;
    this.mirror.position.y = this.floorY * 2;
    for (const sh of this._mirrorShaders) sh.uniforms.uMirrorY.value = this.floorY;
  }

  _frameCamera() {
    // The span the frame covers, blended between "this weapon" and "the longest
    // weapon" by S.scaleFidelity — see the note on it in config. At 0 the camera
    // zooms to whatever is on the stand; the deck's 0.5 m grid carries the scale.
    const maxLen = Math.max(...Object.values(WEAPONS).map((d) => d.len));
    const len = (WEAPONS[this.viewKey] && WEAPONS[this.viewKey].len) || maxLen;
    // Zoom factor from scaleFidelity: 1 at full fidelity (frame the longest gun),
    // shrinking toward 1:1 with this weapon as it goes to 0.
    const k = Math.pow(maxLen / len, S.scaleFidelity);
    // Measured extents, not `len * a-constant`. That heuristic assumed every
    // weapon has the proportions of the longest one, which held while the frame
    // was fixed — but once the camera zooms per weapon, a short bulky gun like
    // the SMG is far taller relative to its length and burst out of frame.
    const ms = this.modelSpan || { x: len, y: len * 0.42 };
    const spanX = ms.x * k * S.padX;
    const spanY = ms.y * k * S.heightPad;
    // The viewer is full-bleed and the info panel floats over its left edge, so
    // only the band to the right of that panel is usable. Frame the gun into
    // that band, then slide the camera left so it sits centred in it.
    const blocked = Math.min(0.55, (S.infoBand + window.innerWidth * 0.04) / (this.el.viewer.clientWidth || 1));
    // Same trick vertically. The viewer now runs the FULL height of the overlay
    // and the loadout panel floats over its bottom edge, so without this the gun
    // centres on the whole viewport and the grip disappears behind the cards.
    // Measured off the element rather than configured — the panel's height moves
    // with the card size and the number of class weapons.
    const bottomPx = (this.el.bottom && this.el.bottom.offsetHeight) || 0;
    const blockedY = Math.min(0.5, bottomPx / (this.el.viewer.clientHeight || 1));
    // Fit BOTH axes and take the further distance. Width alone leaves the gun
    // clipped top/bottom on a short ultrawide viewer; height alone blows it up
    // past the edges on a narrow one.
    const t = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const dist = Math.max(
      spanX / (t * this.camera.aspect * (1 - blocked)),
      spanY / (t * (1 - blockedY))
    ) * this.zoom;
    const x = -t * dist * this.camera.aspect * blocked * 0.5;
    // Raising the weapon out of the bottom band is a LENS shift, not a camera
    // move. Sliding the camera down in world space (which is what the horizontal
    // dodge above does, harmlessly — there is nothing to the left to cross) puts
    // the eye underneath the deck at low pitch, and a floor you are below simply
    // is not there. setViewOffset slides the frustum instead: the camera stays
    // above the deck at the pitch you asked for, and the image moves. Same reason
    // a tilt-shift lens exists.
    const vw = this.el.viewer.clientWidth || 1;
    const vh = this.el.viewer.clientHeight || 1;
    // Automatic term lifts the gun clear of the loadout panel; S.shiftY is the
    // hand knob on top of it (positive = weapon moves DOWN).
    const offY = bottomPx * 0.5 - S.shiftY * vh;
    if (offY !== 0) this.camera.setViewOffset(vw, vh, 0, offY, vw, vh);
    else this.camera.clearViewOffset();
    // Aim below the weapon's centre so it sits high in the frame and the deck
    // fills the space underneath, then orbit up by `pitch` to look down on it.
    // A level camera cannot see a horizontal plane at all — this tilt is what
    // makes the deck exist.
    const aimY = -spanY * S.aimBias;
    const p = THREE.MathUtils.degToRad(this.pitch);
    this.camera.position.set(x, aimY + dist * Math.sin(p), dist * Math.cos(p));
    this.camera.lookAt(x, aimY, 0);
  }

  _showModel(key) {
    this.viewKey = key;
    while (this.holder.children.length) this.holder.remove(this.holder.children[0]);
    while (this.mirror.children.length) this.mirror.remove(this.mirror.children[0]);
    const src = this.game.assets.weaponModels[key];
    if (src) {
      const model = src.clone(true);
      // Measure the clone, never the cached original — that one may be mounted
      // in the player's viewmodel and would report the viewmodel's world box.
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      this.floorY = box.min.y - S.floorDrop;
      // Framing extents. Taken at the default profile yaw and NOT updated while
      // dragging — the frame should not breathe as you spin the gun.
      const size = box.getSize(new THREE.Vector3());
      this.modelSpan = { x: Math.max(size.x, size.z), y: size.y };
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.holder.add(model);
      const mir = this._mirrorFor(key);
      if (mir) this.mirror.add(mir);
    }
    this._placeStage();
    this.holder.rotation.set(0, -Math.PI / 2, 0); // clean side profile, muzzle left
    this.zoom = 1;
    this.pitch = S.pitch;
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
    const w = this.el.viewer.clientWidth;
    const h = this.el.viewer.clientHeight;
    if (!w || !h) return; // hidden — the observer fires again once it lays out
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h); // also resizes every pass, bloom included
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._frameCamera(); // framing depends on aspect
  }

  // ---------------------------------------------------------------- UI --
  show(mode) {
    this.mode = mode;
    this.visible = true;
    this.game.menuOpen = true;
    this.el.overlay.style.display = 'block';
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
      // Baked render first, hand-authored SVG line art as the fallback (the bake
      // needs a GL context and only exists after prewarm).
      img.src = this.thumbs[key] || this.icons[key] || '';
      img.className = this.thumbs[key] ? 'ar-thumb' : 'ar-line';
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

    // A class with three secondaries makes the panel taller than one with a
    // single card, and the framing reads that height — so re-aim after the rows
    // are rebuilt, not before.
    this._frameCamera();

    // keep the deploy screen's loadout strip and lobby preview in sync
    if (this.game.deployScreen) this.game.deployScreen.refreshLoadout();
    if (this.game.lobby && this.game.lobby.active) this.game.lobby.refreshPreview();
  }

  // The armory owns a SEPARATE WebGLRenderer, so it shares nothing with the
  // main context — every weapon texture uploads again the first time the
  // armory draws it. Do that behind the loading bar instead.
  async prewarm() {
    const assets = this.game.assets; // `game` is the session before a match exists
    if (!assets) return;
    this._frameCamera();
    const clones = weaponClones(assets);
    // Shadow casting compiles a second (depth) program per material, so the
    // prewarm copies have to cast too or the first real frame still hitches.
    for (const c of clones) c.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    await prewarm(this.renderer, this.scene, this.camera, clones);
    // ...then one real frame through the composer. three keys its program cache
    // on tone mapping AND output colour space, and both differ between the
    // shared prewarm's sRGB target and the composer's linear half-float one, so
    // without this every material compiles a second time on the first bloomed
    // frame — precisely the hitch prewarm exists to prevent.
    const bay = new THREE.Group();
    for (const c of clones) bay.add(c);
    this.scene.add(bay);
    this.composer.render();
    this.scene.remove(bay);
    this._bakeThumbnails();
    this.refresh(); // swap the cards over to the baked renders
  }

  // Card art: blueprint line drawings generated from the real models.
  //
  // Not shaded renders — those read as photographs and fight the weapon on the
  // stand for attention. EdgesGeometry keeps only edges where two faces meet at
  // more than `cardEdgeAngle`, which on hard-surface weapons means the silhouette
  // and the major panel breaks: a technical drawing rather than a wireframe.
  // Beats hand-authored SVGs because it cannot drift when a gun is re-exported.
  //
  // Runs once, inside prewarm, so the cost lands behind the loading bar.
  _bakeThumbnails() {
    const assets = this.game.assets;
    if (!assets) return;
    const W = S.cardThumbW, H = S.cardThumbH;
    const rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
    const cam = new THREE.PerspectiveCamera(26, W / H, 0.02, 20);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const px = new Uint8Array(W * H * 4);
    const line = W * 4;

    // Stage furniture off: the card wants the weapon alone on transparency.
    // The backdrop belongs in this list — it is opaque and full-screen, so
    // leaving it visible bakes the sky into every card.
    const hide = [this.backdrop, this.floor, this.shadowPlane, this.mirror, this.holder];
    const shown = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const prevTarget = this.renderer.getRenderTarget();
    const prevAlpha = this.renderer.getClearAlpha();
    const bay = new THREE.Group();
    this.scene.add(bay);

    // Unlit on purpose, and toneMapped OFF — ACES would darken the authored line
    // colour, and these are graphics, not lit surfaces.
    // ...and fog off for the same reason toneMapped is: these are graphics, not
    // surfaces in the room. The scene carries fog now, which would otherwise
    // wash the far half of every drawing toward the horizon colour.
    const lineMat = new THREE.LineBasicMaterial({
      color: S.cardLineColor, transparent: true, opacity: 0.95,
      toneMapped: false, fog: false,
    });
    const thresh = S.cardEdgeAngle;

    try {
      this.renderer.setClearAlpha(0);
      for (const [key, src] of Object.entries(assets.weaponModels)) {
        const model = src.clone(true);
        model.rotation.set(0, -Math.PI / 2, 0); // same side profile as the stand
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());

        // Flatten to a bag of line segments in world space. Collect the meshes
        // first — adding children mid-traverse would walk into what we just made.
        const meshes = [];
        model.traverse((o) => { if (o.isMesh && o.geometry) meshes.push(o); });
        const drawing = new THREE.Group();
        for (const mesh of meshes) {
          const eg = new THREE.EdgesGeometry(mesh.geometry, thresh);
          const seg = new THREE.LineSegments(eg, lineMat);
          seg.applyMatrix4(mesh.matrixWorld);
          drawing.add(seg);
        }
        drawing.position.sub(centre); // centre in frame
        bay.add(drawing);

        const t = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
        const d = Math.max(Math.max(size.x, size.z) * 1.06 / (t * cam.aspect), size.y * 1.5 / t);
        cam.position.set(0, 0, d);
        cam.lookAt(0, 0, 0);

        this.renderer.setRenderTarget(rt);
        this.renderer.clear();
        this.renderer.render(this.scene, cam);
        this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);

        // GL reads bottom-up; canvas ImageData is top-down. Also un-premultiply:
        // the context is premultipliedAlpha, so antialiased edge pixels come back
        // darkened, which shows as a grey halo once the card tints them.
        const img = ctx.createImageData(W, H);
        for (let y = 0; y < H; y++) {
          const s = (H - 1 - y) * line;
          for (let i = 0; i < line; i += 4) {
            const a = px[s + i + 3];
            const o = y * line + i;
            const k = a === 0 || a === 255 ? 1 : 255 / a;
            img.data[o] = Math.min(255, px[s + i] * k);
            img.data[o + 1] = Math.min(255, px[s + i + 1] * k);
            img.data[o + 2] = Math.min(255, px[s + i + 2] * k);
            img.data[o + 3] = a;
          }
        }
        ctx.putImageData(img, 0, 0);
        this.thumbs[key] = cv.toDataURL('image/png');
        // EdgesGeometry allocates a fresh buffer per mesh; the PNG is the only
        // thing we keep, so hand the GPU memory straight back.
        bay.remove(drawing);
        drawing.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      }
    } catch (e) {
      console.warn('thumbnail bake failed, cards fall back to SVG line art', e);
    } finally {
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearAlpha(prevAlpha);
      lineMat.dispose();
      this.scene.remove(bay);
      hide.forEach((o, i) => { o.visible = shown[i]; });
      rt.dispose();
    }
  }

  render() {
    if (!this.visible) return;
    // Reflection across a horizontal plane commutes with yaw, so copying the
    // angle is the whole sync — no need to rebuild the mirror transform.
    this.mirror.rotation.y = this.holder.rotation.y;
    // The sky is shaded off the view ray, so it needs the current inverses.
    // matrixWorld first: the renderer refreshes it, but not until after we would
    // have read a stale one here. projectionMatrixInverse comes free with
    // updateProjectionMatrix() and already carries setViewOffset's lens shift.
    this.camera.updateMatrixWorld();
    const bu = this.backdrop.material.uniforms;
    bu.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    bu.uViewInv.value.copy(this.camera.matrixWorld);
    this.composer.render();
  }
}
