// Armory / loadout menu: class tabs, weapon cards with baked thumbnails,
// and an interactive 3D inspection viewer (drag to spin, wheel to zoom).
//
// The bottom panel has two states. GRID shows all six equipped slots at once —
// primary, secondary, two gadgets, grenade, melee. Clicking one drops into
// PICKER, which replaces the grid with that slot's options and a way back. The
// two rows of everything-at-once this replaced could not survive going from two
// slots to six: most pools hold one or two items, so a permanent row per slot
// spent the panel's whole height showing single cards.
//
// What may go in a slot, and what to do when a change makes a slot illegal,
// both live in loadout.js — deploy.js edits the same object and has to agree.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CFG, WEAPONS, CLASSES } from './config.js';
import { SLOTS, slotById, slotValue, setSlot, slotDef, validateLoadout } from './loadout.js';
import { prewarm, weaponClones } from './assets.js';

const S = CFG.armoryStage;
const L = S.light;

const MODE_TAGS = {
  auto: 'FULL-AUTO', burst: '3-ROUND BURST', semi: 'SEMI-AUTO',
  pump: 'PUMP-ACTION', projectile: 'ROCKET', charge: 'CHARGE BEAM',
};

// The gadget-kind half of the same idea: a display name for GADGETS[].kind, so
// the breadcrumb reads WEAPON SLOT rather than the raw `weaponSlot`.
const KIND_TAGS = {
  consumable: 'CONSUMABLE', weaponSlot: 'WEAPON UPGRADE',
  placeable: 'PLACEABLE', passive: 'PASSIVE',
  tool: 'TOOL', movement: 'MOBILITY', deployable: 'DEPLOYABLE',
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
  magnum: 'Sidearm you can draw twice as fast as you can reload. For the moment your rifle clicks empty.',
  // Non-weapon slots. Keyed the same way — the info panel reads one map.
  biofoam: 'Field injector. Your shields come back on their own; your health does not. This is what buys it back.',
  frag: 'Fragmentation grenade. Three-second fuse, wide lethal radius — the answer to a held room.',
  smokenade: 'Screening smoke. Crosses open ground that rifles otherwise own.',
  bash: 'Buttstock across the jaw. Two strikes through full shields, one against anyone already stripped.',
  // Weapon upgrades
  webbing: 'Harness rated for a second long gun in place of the sidearm. Both weapons carry less spare ammo.',
  shotgun_kit: 'Trades your rifle for the M90. Everything inside twenty metres dies; nothing outside it does.',
  launcher_kit: 'Heavy tube in the second slot. You keep your rifle — this is for armour, not for people.',
  marksman_kit: 'Trades your rifle for a long gun and leaves you the Magnum. Reach, at the cost of everything close.',
  // Assault
  breach: 'Shaped charge. Opens a wall, a door, or whatever the Engineers spent the last five minutes building.',
  smoke: 'Screening smoke on a launcher. The tool for crossing ground you do not own yet.',
  // Engineer
  quickwall: 'Hardened barrier, up in half a second. Instant cover, not a fortification — blueprints are for those.',
  emp: 'Burst that kills vehicle electronics, turrets and sensors without scratching the paint.',
  // Recon
  sensor: 'Ground sensor. Paints anything that moves near it onto the squad minimap.',
  drone: 'Remote flyer. You leave your body behind to fly it, and everything it sees, your team sees.',
  // Support
  medcrate: 'Field station. Restores health to anyone standing over it.',
  ammocrate: 'Resupply point. Refills ammunition, grenades, biofoam and gadget charges for the whole team.',
  supplypouch: 'One soldier, one top-up, thrown. The crate when you cannot afford the crate.',
  ballisticshield: 'Armour plate you hold. Stops what comes from the front and nothing else.',
  // Spartan
  overshield: 'Second shield layer over the first. Absorbs a burst that would otherwise strip you.',
  camo: 'Light-bending sheath. Move slowly and you are very hard to see; sprint and you are not.',
  grapple: 'Line and winch. Reaches rooftops and ledges nothing else on this roster can.',
  jetpack: 'Sustained lift. Vertical becomes a direction you can attack from.',
  // Global
  repairtool: 'Welder. Builds blueprints, patches vehicles, and puts armour plating back on people.',
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
    // Repair on the way in: a session loadout may predate a config change, or
    // still be the old two-field shape, and every screen assumes six legal slots.
    this.loadout = validateLoadout(game.playerLoadout);
    this.visible = false;
    this.mode = 'deploy';
    this.onDeploy = null;
    // Which slot's options are open. null = the six-card grid.
    this.pickSlot = null;
    // What the info panel and the stage are describing. The SLOT matters as
    // well as the key: with combat webbing the same rifle can sit in either
    // weapon slot, so the key alone no longer identifies where you are.
    this.viewSlot = 'primary';
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
          <div class="ar-crumb" id="arCrumb"></div>
          <div class="ar-desc" id="arDesc"></div>
          <!-- Generated: the three stats are per-KIND now. A weapon reports
               damage/RPM/mag, biofoam reports heal/charges/inject time, a
               grenade reports damage/radius/carried. Hardcoding the labels
               only worked while every slot held a gun. -->
          <div class="ar-nums" id="arNums"></div>
          <div class="ar-bars" id="arBars"></div>
        </div>
        <div class="ar-viewer" id="arViewer"></div>
      </div>
      <div class="ar-bottom" id="arBottom">
        <div class="ar-tabs" id="arTabs"></div>
        <div class="ar-panel">
          <!-- Filled by _renderGrid / _renderPicker. -->
          <div class="ar-cards" id="arCards"></div>
          <div class="ar-foot">
            <div class="ar-summary" id="arSummary"></div>
            <button id="arDeploy">DEPLOY</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
    // The card art box derives its shape from this — see `.ar-card img`. Written
    // from config rather than repeated in the stylesheet so the bake's aspect and
    // the box's aspect cannot drift apart, which is exactly how the art ended up
    // drawing at half height.
    ov.style.setProperty('--ar-thumb-aspect', `${S.cardThumbW} / ${S.cardThumbH}`);
    this.el = {
      overlay: ov,
      className: ov.querySelector('#arClassName'),
      wpnName: ov.querySelector('#arWpnName'),
      crumb: ov.querySelector('#arCrumb'),
      desc: ov.querySelector('#arDesc'),
      nums: ov.querySelector('#arNums'),
      bars: ov.querySelector('#arBars'),
      viewer: ov.querySelector('#arViewer'),
      bottom: ov.querySelector('#arBottom'),
      tabs: ov.querySelector('#arTabs'),
      cards: ov.querySelector('#arCards'),
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
    // `fogColor` is matched to the procedural horizon, which is not on screen in
    // plate mode — so the plate gets its own say. Decided here, before prewarm,
    // because fog is part of three's program cache key.
    if (S.fog && (!S.plate.url || S.plate.fog)) {
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
    // Still lights the gun when the shadow is off — the top-edge highlight is
    // half of why this light exists. Dropping the cast is what skips the pass:
    // with no caster left, three does no shadow render at all.
    top.castShadow = !S.plate.url || S.plate.shadow;
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

  // A painted room instead of the gradient. Same quad, same slot, same clip-space
  // vertex shader — only the fragment differs, so everything downstream (bloom,
  // OutputPass, the thumbnail bake's hide list) is untouched.
  //
  // `uReady` rather than a placeholder texture: a null sampler2D binds as white
  // in three, which would flash a white screen for however many frames the load
  // takes. Black until the plate arrives is the only acceptable first frame.
  _buildPlateBackdrop() {
    const P = S.plate;
    const mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPlate: { value: null },
        uCover: { value: new THREE.Vector2(1, 1) }, // set by _resizeViewer
        uAnchor: { value: P.anchorY },
        uGain: { value: P.gain },
        uReady: { value: 0 },
      },
      vertexShader: `
        varying vec2 vNdc;
        void main() {
          vNdc = position.xy;
          // straight to clip space at the far plane; no matrices involved
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uPlate;
        uniform vec2 uCover;
        uniform float uAnchor, uGain, uReady;
        varying vec2 vNdc;

        void main() {
          // uCover carries the aspect correction, so this is a cover-fit: the
          // plate fills the frame and the long axis is cropped rather than
          // squashed. ClampToEdge on the texture handles an anchor that pushes
          // the window off the image — the plate's borders are near-black, so
          // the smear is invisible.
          vec2 uv = vNdc * 0.5 * uCover + vec2(0.5, uAnchor);
          vec3 col = texture2D(uPlate, uv).rgb * uGain * uReady;

          // scene-linear out; OutputPass tone maps and encodes
          gl_FragColor = vec4(max(col, 0.0), 1.0);
        }`,
    });
    new THREE.TextureLoader().load(P.url, (tex) => {
      // sRGB: this one IS a colour, unlike the deck's map — three decodes it to
      // scene-linear on sample and OutputPass puts it back through the curve.
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      mat.uniforms.uPlate.value = tex;
      mat.uniforms.uReady.value = 1;
      this._resizeViewer(); // the plate's aspect is only knowable now
    }, undefined, () => console.warn(`armory plate failed to load: ${P.url}`));
    return mat;
  }

  _buildBackdrop() {
    const K = S.sky;
    const mat = S.plate.url ? this._buildPlateBackdrop() : new THREE.ShaderMaterial({
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
    // 0 = the map already tiles as authored, and blending is not free of charge:
    // it MIRRORS a band inward, so anything sitting on the border comes back as a
    // ghost of itself a few pixels in. A map with a grid line on its edge wants
    // this off, not merely small.
    if (S.deckSeamBlend <= 0) return cv;
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
    for (let y = 0; y < H; y++) {
      const w = wOf(y, H);
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4, m = ((H - 1 - y) * W + x) * 4;
        for (let k = 0; k < 3; k++) out.data[o + k] = mid.data[o + k] * (1 - w) + mid.data[m + k] * w;
        out.data[o + 3] = 255;
      }
    }
    g.putImageData(out, 0, 0);
    return cv;
  }

  // Repack a deck map into the one texture the shader samples:
  //   R = height / albedo detail
  //   G, B = the surface normal's two tangential components
  //
  // Packed rather than shipped as a second texture because R is all the deck
  // shader was ever reading — G and B were carrying a duplicate of it. One
  // upload, one sampler, one fetch in the inner loop, and the normal can never
  // drift out of register with the albedo because they are the same pixels.
  //
  // The normal is a Sobel gradient of the luminance treated as height, which is
  // what finally gives the deck something for the specular lobes and the
  // reflection to catch: until now it was a mathematically flat plane, so every
  // bolt and chamfer in the map was painted-on shading that could not respond to
  // light. Sampling wraps, because the map tiles.
  //
  // Gradients are scaled by 3x their own RMS rather than by a fixed constant, so
  // a soft map and a crunchy one both land in range; strength stays tunable in
  // the shader via deckNormal.
  _packDeckMap(cv) {
    const W = cv.width, H = cv.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    const h = new Float32Array(W * H);
    let sum = 0;
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      h[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      sum += h[p];
    }
    // The gradient is only taken when something is going to read it. Skipping is
    // not an optimisation, it is correctness: an EMISSIVE map is not a height
    // field, and Sobelling one puts a hard bevel down either side of every glow
    // line, with the brightest thing in the map driving the biggest gradient.
    // G/B go neutral rather than being left as the source's own chroma, so a
    // later non-zero deckNormal on a map with no authored relief reads as flat
    // instead of as a wildly tilted surface.
    if (S.deckNormal <= 0) {
      for (let p = 0, i = 0; p < W * H; p++, i += 4) {
        d[i] = Math.round(h[p] * 255);
        d[i + 1] = d[i + 2] = 128;
        d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this._mapMid.value = Math.max(0.02, sum / (W * H));
      return cv;
    }

    // Blur a COPY of the height before differencing it. A Sobel over the raw
    // map turns its film grain into normals too, and grain-sized normals read
    // as speckle rather than as surface — the relief we want is the bolts,
    // chamfers and groove edges, which are all far larger than a pixel. The
    // albedo keeps using the unblurred height, so plate detail stays crisp.
    let hb = h;
    const rad = Math.max(0, Math.round(S.deckNormalBlur));
    if (rad > 0) {
      const n = rad * 2 + 1, tmp = new Float32Array(W * H);
      hb = new Float32Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let s = 0;
          for (let i = -rad; i <= rad; i++) s += h[y * W + ((((x + i) % W) + W) % W)];
          tmp[y * W + x] = s / n;
        }
      }
      for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
          let s = 0;
          for (let i = -rad; i <= rad; i++) s += tmp[((((y + i) % H) + H) % H) * W + x];
          hb[y * W + x] = s / n;
        }
      }
    }
    const at = (x, y) => hb[((y % H) + H) % H * W + (((x % W) + W) % W)];
    const gx = new Float32Array(W * H), gy = new Float32Array(W * H);
    let sq = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        gx[p] = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
              - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
        gy[p] = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
              - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
        sq += gx[p] * gx[p] + gy[p] * gy[p];
      }
    }
    const rms = Math.sqrt(sq / (2 * W * H));
    const k = 1 / Math.max(1e-4, rms * 3);
    const enc = (v) => Math.round((Math.max(-1, Math.min(1, v * k)) * 0.5 + 0.5) * 255);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      d[i] = Math.round(h[p] * 255);
      d[i + 1] = enc(gx[p]);
      d[i + 2] = enc(gy[p]);
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // The shader reads the map against its own MEAN, so any map — dark plates,
    // mid-grey scuffs — drops in without re-tuning deckDetail.
    this._mapMid.value = Math.max(0.02, sum / (W * H));
    return cv;
  }

  // The deck's map. With `deckUrl` set it carries the whole plate structure —
  // grooves, bolts, cracks, plate-to-plate tone. Without one, a scuff map is
  // generated into a canvas so the stage still works with no asset; that one is
  // seamless by construction (smears run the full width, so X wraps for free,
  // and any crossing the top or bottom edge are drawn again wrapped).
  _deckTexture() {
    let tex;
    // The GLB deck brings its own maps and the shader quad is switched off, so
    // there is nothing here worth 1.5M pixels of CPU packing at boot. The
    // material still needs a valid sampler, hence the 1x1.
    if (S.deckGlb) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 1;
      const g = cv.getContext('2d');
      g.fillStyle = '#808080';
      g.fillRect(0, 0, 1, 1);
      tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.NoColorSpace;
      return tex;
    }
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
        tex.image = this._packDeckMap(this._makeSeamless(img));
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

      let seed = 20260731;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

      // One soft-edged elongated blob, drawn nine times so it wraps.
      //
      // An ellipse with a radial falloff rather than a faded rect, and that is
      // the fix for the banding: a rect faded only along its LENGTH is cut dead
      // across its WIDTH, and a hard edge is exactly what the Sobel below turns
      // into a strong normal. Every smear used to contribute two sharp
      // horizontal ridges. A radial falloff has no edge anywhere.
      //
      // The gradient is built INSIDE the transform, which is the other fix: the
      // old code built it once in absolute canvas coordinates and then drew the
      // rect at three different X offsets, so the wrapped copies landed outside
      // their own gradient and painted nothing. Smears never tiled horizontally,
      // and the discontinuity down the texture edge was the diagonal seam on the
      // floor.
      const blob = (cx, cy, w, h, ang, v, a) => {
        const c = `${Math.max(0, Math.min(255, 128 + v)) | 0}`;
        for (const dx of [-N, 0, N]) {
          for (const dy of [-N, 0, N]) {
            g.save();
            g.translate(cx + dx, cy + dy);
            g.rotate(ang);
            g.scale(Math.max(0.01, w / 2), Math.max(0.01, h / 2));
            const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
            grad.addColorStop(0, `rgba(${c},${c},${c},${a})`);
            grad.addColorStop(1, `rgba(${c},${c},${c},0)`);
            g.fillStyle = grad;
            g.beginPath();
            g.arc(0, 0, 1, 0, Math.PI * 2);
            g.fill();
            g.restore();
          }
        }
      };

      // Broad polish smears — the buffed direction of the floor, and the only
      // thing in this map meant to read as FORM rather than as detail. Long,
      // soft, low contrast, and near enough axis-aligned to give the surface a
      // grain without becoming lines.
      for (let i = 0; i < S.deckSmears; i++) {
        blob(rnd() * N, rnd() * N,
             N * (0.25 + rnd() * 0.9),        // long
             // ...and thin, but not thinner than about 10 px. A radial falloff
             // needs room to fall off: squash the ellipse to 2-3 px and it comes
             // back out as a hard line, which is the very thing this shape was
             // chosen to avoid. The minimum is the whole point of the range.
             10 + rnd() * rnd() * 26,
             (rnd() - 0.5) * 0.12,            // barely off the buff direction
             (rnd() - 0.5) * 78,
             0.1 + rnd() * 0.4);
      }

      // Scratches: SHORT, clustered, and mostly following the buff direction.
      //
      // Short is the word that matters. These used to run 25-110% of the map
      // width, so every one crossed the whole texture and they piled into a
      // pick-up-sticks hatch — which is what the floor was showing. Real wear is
      // short, grouped where something has been dragged across, and broadly
      // aligned with how the surface was polished.
      //
      // Clustering plus a modest angle spread is what keeps them off the two
      // failure modes either side: fully random angles read as hatching, and
      // perfectly axis-aligned ones lie along lines of CONSTANT DEPTH on this
      // floor, where they project to horizontal screen lines and stack into
      // scanlines. Short and slightly angled does neither.
      //
      // They earn their place through the normal, not the albedo: a scratch
      // multiplied into a floorBase this dark is invisible, but one that tilts
      // the surface catches the sky reflection and the spec lobes and comes out
      // as a glint.
      const clusters = [];
      for (let i = 0; i < S.deckScratchClusters; i++) clusters.push([rnd() * N, rnd() * N]);
      for (let i = 0; i < S.deckScratches; i++) {
        const [bx, by] = clusters[(rnd() * clusters.length) | 0];
        const spread = N * S.deckScratchSpread;
        blob(bx + (rnd() - 0.5) * spread, by + (rnd() - 0.5) * spread,
             N * (0.03 + rnd() * rnd() * 0.12),   // 3-15% of the map, not 25-110%
             2 + rnd() * rnd() * 2,               // 2-4 px, same reason as above
             (rnd() - 0.5) * 2 * S.deckScratchAngle * Math.PI / 180,
             // Mostly faint, occasionally not. Squaring keeps the strong ones
             // rare, which is what stops scuffing reading as hatching.
             (rnd() < 0.5 ? -1 : 1) * (18 + rnd() * rnd() * 60),
             0.12 + rnd() * rnd() * 0.4);
      }

      // No fine grain on top. Per-pixel noise is the highest-frequency content
      // there is, and at 4.8 cm of eye height it is the first thing minification
      // destroys — it reads as speckle for the first metre and then averages to
      // flat grey, which is the detail edge this map exists to avoid. The smears
      // and scratches above are the whole map on purpose.
      //
      // same packing as the loaded path — the shader always expects normals in
      // G/B, so a generated map that left them as a copy of R would read as a
      // wildly tilted surface everywhere
      tex = new THREE.CanvasTexture(this._packDeckMap(cv));
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
        // A LIGHT, so scene-linear like the other two — no stageColor.
        uEmisColor: { value: new THREE.Color(S.deckEmisColor) },
        uEmisStr: { value: S.deckEmisStrength },
        uEmisFloor: { value: S.deckEmisFloor },
        uEmisNear: { value: S.deckEmisNear },
        uEmisSoft: { value: S.deckEmisSoft },
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
        uNormalStr: { value: S.deckNormal },
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
        uniform vec3 uGrooveGlow, uSpec, uEmisColor;
        uniform float uGrooveStr, uGrooveLo, uGrooveHi;
        uniform float uEmisStr, uEmisFloor, uEmisNear, uEmisSoft;
        uniform float uF0, uReflect, uRough, uSpecPow, uL1Str, uL2Str, uGlossVar, uNormalStr;
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
          vec4 tex = texture2D(uMap, vWorld.xz / uTile);
          float det = tex.r;
          float m = clamp(det / uMapMid, 0.0, uMapMax);
          col *= mix(1.0, m, uDetail);
          // Surface normal, unpacked from G/B. Faded out with haze: normal maps
          // alias viciously at grazing angles, and the far deck is exactly that.
          // Mip averaging already pulls the gradients toward zero out there, so
          // this only finishes a job the hardware has started.
          float nStr = uNormalStr * (1.0 - haze);
          vec3 N = normalize(vec3((tex.g - 0.5) * -2.0 * nStr,
                                  1.0,
                                  (tex.b - 0.5) * -2.0 * nStr));

          // ---- light in the deck map's own grooves ----
          // Keyed off the map going dark, so it follows whatever panelling the
          // map has and is aligned to it by construction — which is the whole
          // reason the procedural seams below are off when a map is in use.
          // Off for an emissive map, where the lit part is the BRIGHT part —
          // see uGrooveStr in config.
          float groove = 1.0 - smoothstep(uGrooveLo, uGrooveHi, m);
          col += uGrooveGlow * groove * uGrooveStr * amp;

          // ---- the deck map's emissive grid ----
          // The other half of the same texture read, and the reason the map is
          // sampled once but interpreted twice. det above went through the mean
          // and the uMapMax clamp to become surface; here it is taken RAW,
          // because for a lit map the absolute level is the signal — the field
          // sits near black and everything above it is light.
          //
          // (No backticks anywhere in this shader: it is a JS template literal,
          // so quoting an identifier the way the JS comments above do would end
          // the string and take the whole module out with it.)
          //
          // A floor subtracted and the remainder rescaled, rather than a
          // smoothstep: the halo either side of each line is authored into the
          // texture, and this keeps its falloff exactly. It ADDS, so unlike the
          // albedo path it does not care that floorBase is nearly black.
          float ampE = smoothstep(uEmisNear, uEmisSoft, d);
          float emis = max(det - uEmisFloor, 0.0) / max(1e-3, 1.0 - uEmisFloor);
          col += uEmisColor * emis * uEmisStr * ampE;

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
          // Reflected about the MAP's normal, not a flat up vector: this is what
          // makes bolts, chamfers and groove edges actually catch the sky and
          // the spec lobes instead of being painted-on shading.
          vec3 V = normalize(vWorld - cameraPosition);
          vec3 R = reflect(V, N);
          float cosT = clamp(dot(-V, N), 0.0, 1.0);
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

    // The plate paints its own floor, so the deck stands down — and with
    // `plate.shadow` off the contact shadow goes with it. The mirror stays.
    // Built rather than skipped so the switch is one flag both ways:
    // `plate.url: null` and the deck is simply visible again.
    if (S.plate.url) {
      this.floor.visible = false;
      if (!S.plate.shadow) this.shadowPlane.visible = false;
    }
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
      sh.uniforms.uBlurMin = { value: S.reflectBlurMin };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying float vMirY;\nuniform vec2 uJitter;\nuniform float uMirrorY, uBlurMin;')
        .replace('#include <project_vertex>',
          '#include <project_vertex>\nvMirY = (modelMatrix * vec4(transformed, 1.0)).y;\n' +
          // uBlurMin keeps a little spread even AT the contact line. Without it
          // the taps collapse to a point there and the reflection is perfectly
          // sharp exactly where it meets the deck, which no real surface does.
          'gl_Position.xy += uJitter * (uBlurMin + max(0.0, uMirrorY - vMirY)) * gl_Position.w;');
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
      // Taps are spread over a 2D ELLIPSE, not along a line. This is the whole
      // difference between "rough surface" and "offset copy": convolving with a
      // line kernel is directional blur — the same operation as motion blur —
      // and no amount of tuning its length stops it reading as a displaced
      // image. Roughness spreads in both axes at once.
      //
      // Golden-angle (Vogel) placement, because at these tap counts a ring or a
      // grid leaves visible structure while this stays evenly packed. The
      // ellipse is taller than wide (reflectBlurAspect) since a floor reflection
      // genuinely does smear more along the view than across it.
      const r = taps === 1 ? 0 : Math.sqrt((i + 0.5) / taps);
      const a = i * 2.399963; // golden angle in radians
      const jitter = new THREE.Vector2(
        Math.cos(a) * r * S.reflectBlur * S.reflectBlurAspect,
        Math.sin(a) * r * S.reflectBlur);
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
    if (this.deckGlb) this.deckGlb.position.y = this.floorY;
    this.shadowPlane.position.y = this.floorY + 0.002;
    this.mirror.position.y = this.floorY * 2;
    for (const sh of this._mirrorShaders) sh.uniforms.uMirrorY.value = this.floorY;
  }

  // The deck as an authored GLB. Everything the stage needs from a deck — the
  // plate surface, the lit grid, roughness, how it takes the environment — comes
  // out of the file's own material, so this is a load-and-place with no shading
  // decisions left on this side. Tuning moves to Blender.
  //
  // Loaded inside prewarm() rather than the constructor for two reasons: prewarm
  // is awaited at boot, so the cost lands behind the loading bar instead of the
  // deck popping in a frame late, and it runs before _bakeThumbnails, which has
  // to be able to switch the deck off while it bakes the cards.
  //
  // A failure here is not fatal — the procedural deck is still fully built and
  // simply stays visible, which is also exactly what happens with deckGlb null.
  // The deck's own fog, and ONLY the deck's. Scene fog cannot be used for this:
  // the weapon shares the scene and sits 0.6-1.3 m from the eye, so fog pulled in
  // close enough to fade the deck starts eating the back of the rifle — which is
  // why `fogFar` sits out at 16 and why the procedural deck carried its own haze
  // term before the GLB replaced it. This puts that term back.
  //
  // Exponential and measured from the camera, so it never fully arrives: there is
  // no far plane to keep in sync, and the deck plane's own EDGE hazes out of
  // existence at any pitch rather than being something to keep off screen.
  //
  // Spliced in AFTER three's fog chunk on purpose. That is the last thing to
  // touch gl_FragColor, so the haze catches the emissive grid as well as the
  // surface — fogged lines fall back under `bloomThreshold` and stop glowing,
  // which is most of what actually reads as distance here. It also means the mix
  // happens in the same space the scene fog's does, hence the same
  // LinearSRGBColorSpace treatment on the colour.
  // Patched even at deckHaze 0 — the uniform makes it a no-op (exp(0) = 1), and
  // that keeps `tuneHaze` able to bring it back up live. Costs one mix per
  // fragment on a single plane, which is not worth a config-time branch.
  _hazeMaterial(mat) {
    if (!mat) return;
    const color = new THREE.Color().setHex(
      S.deckHazeColor == null ? S.fogColor : S.deckHazeColor, THREE.LinearSRGBColorSpace);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uDeckHaze = { value: S.deckHaze };
      sh.uniforms.uDeckHazeStart = { value: S.deckHazeStart };
      sh.uniforms.uDeckHazeColor = { value: color };
      // Kept so the numbers stay pokeable at runtime — this is a look knob and
      // it will want scrubbing against a real weapon on the stand.
      this._deckHaze.push(sh.uniforms);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uDeckHaze, uDeckHazeStart;
          uniform vec3 uDeckHazeColor;`)
        // vViewPosition is the fragment-to-camera vector, declared unconditionally
        // by the physical material — so camera distance costs nothing extra here.
        .replace('#include <fog_fragment>', `#include <fog_fragment>
          {
            float hazeD = length(vViewPosition);
            float haze = 1.0 - exp(-max(hazeD - uDeckHazeStart, 0.0) * uDeckHaze);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uDeckHazeColor, haze);
          }`);
    };
    // Without this three would hand the deck a cached program compiled from the
    // UNPATCHED source if anything else in the scene shares its material key.
    mat.customProgramCacheKey = () => 'deckHaze';
    mat.needsUpdate = true;
  }

  // Live tuning for the two knobs that fight over this look: the deck's own haze
  // and the scene fog. Changes land on the next frame — no reload, no re-export.
  //
  //   FC.menu.tuneHaze({ haze: 0.35, start: 0.8 })  // gentler, starting later
  //   FC.menu.tuneHaze({ haze: 0 })                 // deck haze off, to A/B
  //   FC.menu.tuneHaze({ fogNear: 2, fogFar: 7 })   // the other lever (hits the gun too)
  //   FC.menu.tuneHaze()                            // print, ready to paste into config
  //
  // Printing a paste-ready block rather than just mutating is the point: this is
  // a look knob, so the numbers have to survive back into config by hand.
  tuneHaze(v = {}) {
    for (const u of this._deckHaze || []) {
      if (v.haze !== undefined) u.uDeckHaze.value = v.haze;
      if (v.start !== undefined) u.uDeckHazeStart.value = v.start;
      if (v.color !== undefined) u.uDeckHazeColor.value.setHex(v.color, THREE.LinearSRGBColorSpace);
    }
    const fog = this.scene.fog;
    if (fog) {
      if (v.fogNear !== undefined) fog.near = v.fogNear;
      if (v.fogFar !== undefined) fog.far = v.fogFar;
    }
    const u0 = (this._deckHaze || [])[0];
    // Read back in the SAME space it was written in, or the hex that comes out is
    // not the hex that goes into config.
    const hex = (c) => `0x${c.getHex(THREE.LinearSRGBColorSpace).toString(16).padStart(6, '0')}`;
    const block = [
      u0 ? `deckHaze: ${u0.uDeckHaze.value},` : 'deck haze: not patched (deckGlb off?)',
      u0 ? `deckHazeStart: ${u0.uDeckHazeStart.value},` : '',
      u0 ? `deckHazeColor: ${hex(u0.uDeckHazeColor.value)},` : '',
      fog ? `fogNear: ${fog.near},` : '',
      fog ? `fogFar: ${fog.far},` : '',
    ].filter(Boolean).join('\n');
    console.log(block);
    return block;
  }

  // Live tuning for the loadout panel's glass. Same deal as tuneHaze: this is a
  // look knob, so it has to be scrubbable against a real weapon and then survive
  // back into index.html by hand — hence the paste-ready block on the way out.
  //
  //   FC.menu.tunePanel({ top: 0.3, bot: 0.6 })  // more of the deck through it
  //   FC.menu.tunePanel({ blur: 40 })            // softer defocus
  //   FC.menu.tunePanel({ top: 0.9, bot: 0.95 }) // back to the old opaque slab
  //   FC.menu.tunePanel()                        // print current, change nothing
  //
  // The one number that actually decides whether this reads as glass is the
  // alpha: past ~0.8 the blur behind it is invisible work no matter how large.
  tunePanel(v = {}) {
    const p = this._panelTune || (this._panelTune = {
      top: 0.44, mid: 0.64, bot: 0.72, midStop: 55, blur: 28, sat: 0.9,
    });
    Object.assign(p, v);
    const filter = `blur(${p.blur}px) saturate(${p.sat})`;
    const bg = `linear-gradient(180deg,\n        rgba(6,11,18,${p.top}) 0,\n`
             + `        rgba(6,11,18,${p.mid}) ${p.midStop}%,\n`
             + `        rgba(6,11,18,${p.bot}) 100%)`;
    if (!this._panelStyle) {
      this._panelStyle = document.createElement('style');
      document.head.appendChild(this._panelStyle);
    }
    this._panelStyle.textContent = `.ar-panel::before {
      backdrop-filter: ${filter};
      -webkit-backdrop-filter: ${filter};
      background: ${bg};
    }`;
    const block = `.ar-panel::before {\n`
      + `      content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none;\n`
      + `      backdrop-filter: ${filter};\n`
      + `      -webkit-backdrop-filter: ${filter};\n`
      + `      background: ${bg};\n    }`;
    console.log(block);
    return block;
  }

  async _loadDeckGlb() {
    if (!S.deckGlb || S.plate.url) return; // the plate is the floor now
    this._deckHaze = [];
    let gltf;
    try {
      gltf = await new GLTFLoader().loadAsync(S.deckGlb);
    } catch (e) {
      console.warn(`deck GLB failed to load: ${S.deckGlb}`, e);
      return;
    }
    const deck = gltf.scene;
    deck.scale.setScalar(S.deckGlbScale);
    deck.updateMatrixWorld(true);
    // Measured off the geometry rather than assumed, so deckGlbTile keeps
    // meaning "metres per repeat" if the plane is ever resized or re-exported.
    const box = new THREE.Box3().setFromObject(deck);
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1;
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    deck.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      // Same slot the shader quad held, so the shadow catcher and the mirrored
      // weapon still land on top of it in the order they were written for.
      o.renderOrder = 1;
      for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
        // Every map has to be re-tiled TOGETHER — the emissive grid, the albedo
        // it sits on and the specular tint are the same image, and tiling one
        // without the others slides the glow off the plates it belongs to.
        for (const slot of ['map', 'emissiveMap', 'specularColorMap', 'normalMap',
                            'roughnessMap', 'metalnessMap', 'aoMap']) {
          const t = mat[slot];
          if (!t) continue;
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          // The deck is seen at a grazing angle from ~5 cm up, which is the worst
          // case there is for minification — see the note on deckUrl.
          t.anisotropy = aniso;
          if (S.deckGlbTile) t.repeat.setScalar(span / S.deckGlbTile);
          t.needsUpdate = true;
        }
        this._hazeMaterial(mat);
      }
    });
    this.deckGlb = deck;
    this.scene.add(deck);
    this.floor.visible = false; // the procedural deck stands down
    this._placeStage();
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

  // Swapping the model resets the stage — zoom, pitch and the spin you dragged
  // it to. Hover fires this constantly as the cursor crosses a row of cards, so
  // it MUST no-op when the model is not actually changing; without the guard,
  // sweeping across the six grid cards re-clones and re-frames on every card
  // boundary and throws away whatever angle you had set up.
  //
  // `viewKey` is no longer set here — _view owns it, because the stage and the
  // info panel no longer always show the same thing (a gadget has no model, so
  // the deck keeps showing your primary while the panel describes the gadget).
  _showModel(key) {
    if (this.modelKey === key) return;
    this.modelKey = key;
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
    this._fitPlate(w / h);
  }

  // Cover-fit for the plate: keep its aspect, crop the axis with slack, never
  // squash. uCover is the fraction of the image each screen axis spans, so 1
  // means "this axis shows the whole plate" and the other one is the cropped
  // one. Both 1 would be a stretch-to-fill, which is exactly what we do not want
  // on a photograph of a room with straight architecture in it.
  _fitPlate(viewAspect) {
    const u = this.backdrop && this.backdrop.material.uniforms;
    if (!u || !u.uCover || !u.uPlate.value) return;
    const img = u.uPlate.value.image;
    const plateAspect = img.width / img.height;
    if (viewAspect > plateAspect) u.uCover.value.set(1, plateAspect / viewAspect);
    else u.uCover.value.set(viewAspect / plateAspect, 1);
  }

  // ---------------------------------------------------------------- UI --
  show(mode) {
    this.mode = mode;
    this.visible = true;
    this.game.menuOpen = true;
    this.el.overlay.style.display = 'block';
    this.el.deploy.textContent = mode === 'deploy' ? 'DEPLOY' : 'APPLY LOADOUT';
    // Always open on the grid looking at the primary, whatever was left over
    // from the last visit.
    this.pickSlot = null;
    this.viewSlot = 'primary';
    this.viewKey = this.loadout.primary;
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
    const lo = validateLoadout(this.loadout);
    this.el.className.textContent = `${CLASSES[lo.cls].name.toUpperCase()} CLASS`;

    // tabs
    this.el.tabs.innerHTML = '';
    for (const [key, def] of Object.entries(CLASSES)) {
      const b = document.createElement('button');
      b.textContent = def.name.toUpperCase();
      b.classList.toggle('sel', lo.cls === key);
      b.onclick = () => {
        lo.cls = key;
        // Every slot can be invalidated by a class switch, not just the one the
        // old code repaired — and the repair order matters. loadout.js owns it.
        validateLoadout(lo);
        this.pickSlot = null;          // a pool you were browsing may be gone
        this._view(slotById('primary'), lo.primary);
        this.refresh();
      };
      this.el.tabs.appendChild(b);
    }

    if (this.pickSlot) this._renderPicker(); else this._renderGrid();
    this._renderInfo();

    const wpn = (k) => (WEAPONS[k] ? WEAPONS[k].name : '—');
    this.el.summary.textContent =
      `${CLASSES[lo.cls].name.toUpperCase()} — ${wpn(lo.primary)} | ${wpn(lo.secondary)}`;

    // The panel's height drives the framing, and the picker is a different
    // height from the grid — so re-aim after the rows are rebuilt, not before.
    this._frameCamera();

    // keep the deploy screen's loadout strip and lobby preview in sync
    if (this.game.deployScreen) this.game.deployScreen.refreshLoadout();
    if (this.game.lobby && this.game.lobby.active) this.game.lobby.refreshPreview();
  }

  // ------------------------------------------------------------ Panel --
  // One card builder for both states and every registry. `art` on the slot says
  // where the picture comes from: weapons have a baked 3D thumbnail (with the
  // hand-drawn SVG behind it for the frames before prewarm finishes), and
  // everything else has the inline glyph its registry entry carries.
  _mkCard(slot, key, opts) {
    const def = slotDef(slot, key);
    const isWeapon = slot.art === 'weapon';
    const card = document.createElement('div');
    card.className = (isWeapon ? 'ar-card' : 'ar-chip')
      + (opts.selected ? ' sel' : '')
      + (this.viewSlot === slot.id && this.viewKey === key ? ' viewing' : '')
      // The corner tick used to be hardcoded to the class-weapon row. It marks
      // specialist-tier weapons now, which is what that row actually held.
      + (isWeapon && def && def.slot === 'specialist' ? ' specialist' : '');
    card.dataset.slot = slot.id;
    card.dataset.key = key || '';

    if (opts.slotTag) {
      const tag = document.createElement('div');
      tag.className = 'ar-card-slot';
      tag.textContent = slot.label;
      card.appendChild(tag);
    }
    if (isWeapon) {
      const img = document.createElement('img');
      img.src = this.thumbs[key] || this.icons[key] || '';
      img.className = this.thumbs[key] ? 'ar-thumb' : 'ar-line';
      img.draggable = false;
      card.appendChild(img);
    } else {
      const glyph = document.createElement('div');
      glyph.className = 'ar-glyph';
      glyph.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${(def && def.svg) || ''}</svg>`;
      card.appendChild(glyph);
    }
    const label = document.createElement('div');
    label.className = 'ar-card-name';
    label.textContent = (def && def.name) || '—';
    card.appendChild(label);

    card.onclick = opts.onClick;
    // Hover previews into the info panel and onto the stage. Deliberately does
    // NOT call refresh() — that would tear down the card the cursor is inside
    // and rebuild it, which drops the hover state and re-enters this handler.
    card.onmouseenter = () => this._view(slot, key);
    return card;
  }

  _slotRow(labelText, onBack) {
    const wrap = document.createElement('div');
    wrap.className = 'ar-slot';
    const label = document.createElement('div');
    label.className = 'ar-slot-label' + (onBack ? ' ar-back' : '');
    label.innerHTML = onBack ? `<i>&lsaquo;</i>${labelText}` : labelText;
    if (onBack) label.onclick = onBack;
    const row = document.createElement('div');
    row.className = 'ar-row';
    wrap.appendChild(label);
    wrap.appendChild(row);
    this.el.cards.appendChild(wrap);
    return row;
  }

  // All six equipped slots at once. Every card reads `sel` because every card
  // IS what you are carrying — the grid shows state, the picker shows choice.
  _renderGrid() {
    const lo = this.loadout;
    this.el.cards.innerHTML = '';
    const row = this._slotRow('LOADOUT', null);
    // Every grid card is `sel` so its art sits at full opacity — but six cyan
    // borders at once is a wall of selection state that means nothing, since
    // "equipped" is the only thing any of them could be. .ar-grid tones the
    // border back down and leaves .viewing to be the thing that stands out.
    row.classList.add('ar-grid');
    for (const slot of SLOTS) {
      const key = slotValue(lo, slot);
      row.appendChild(this._mkCard(slot, key, {
        selected: true,
        slotTag: true,
        onClick: () => { this.pickSlot = slot.id; this._view(slot, key); this.refresh(); },
      }));
    }
  }

  // One slot's options. Picking commits, re-validates (a weaponSlot gadget can
  // invalidate the secondary from here) and returns to the grid.
  _renderPicker() {
    const lo = this.loadout;
    const slot = slotById(this.pickSlot);
    if (!slot) { this.pickSlot = null; this._renderGrid(); return; }
    this.el.cards.innerHTML = '';
    const back = () => { this.pickSlot = null; this.refresh(); };
    const row = this._slotRow(slot.label, back);
    const cur = slotValue(lo, slot);
    for (const key of slot.pool(lo.cls, lo)) {
      row.appendChild(this._mkCard(slot, key, {
        selected: key === cur,
        onClick: () => {
          setSlot(lo, slot, key);
          validateLoadout(lo);
          this.pickSlot = null;
          this.refresh();
        },
      }));
    }
  }

  // Point the info panel and the stage at one item, without rebuilding the
  // panel around the cursor. Called on hover and on any state change.
  _view(slot, key) {
    if (this.viewSlot === slot.id && this.viewKey === key) return;
    this.viewSlot = slot.id;
    this.viewKey = key;
    for (const el of this.el.cards.querySelectorAll('.viewing')) el.classList.remove('viewing');
    const el = this.el.cards.querySelector(`[data-slot="${slot.id}"][data-key="${key || ''}"]`);
    if (el) el.classList.add('viewing');
    // Only weapons have a model. Rather than empty the deck for a gadget, the
    // stage keeps showing the gun you are carrying — the info panel is what is
    // describing the gadget.
    this._showModel(slot.art === 'weapon' && key ? key : this.loadout.primary);
    this._renderInfo();
  }

  // Per-kind info. A weapon reports damage/RPM/mag and the four bars; the other
  // registries report what they actually have, and skip the bars entirely —
  // those are all derived from ballistics a gadget does not carry.
  _renderInfo() {
    const lo = this.loadout;
    const slot = slotById(this.viewSlot) || SLOTS[0];
    const def = slotDef(slot, this.viewKey);
    if (!def) {
      this.el.wpnName.textContent = '—';
      this.el.crumb.innerHTML = '';
      this.el.desc.textContent = '';
      this.el.nums.innerHTML = '';
      this.el.bars.innerHTML = '';
      return;
    }

    this.el.wpnName.textContent = def.name;
    // Breadcrumb rather than bordered chips: at chip weight this line competed
    // with the weapon name directly above it. Same information, read as a path.
    // The slot comes from the SLOT now, not from guessing at the weapon key —
    // with webbing the same rifle is legal in either weapon slot.
    // The third crumb is what KIND of thing this is. A grenade slot holding a
    // grenade has nothing to add there, so it drops out rather than repeating
    // the slot name back at you.
    const kindTag = slot.art === 'weapon' ? MODE_TAGS[def.mode] : KIND_TAGS[def.kind];
    const crumb = [`${CLASSES[lo.cls].name.toUpperCase()} KIT`, slot.label, kindTag]
      .filter(Boolean)
      .filter((t, i, a) => a.indexOf(t) === i);   // GRENADE / GRENADE reads as a bug
    this.el.crumb.innerHTML = `<i>&lsaquo;</i>` + crumb.map((t) => `<span>${t}</span>`).join('');
    // Most of the roster is declared and not yet built. Saying so is better
    // than a card that looks identical to a working one and then does nothing.
    const unbuilt = def.built === false;
    this.el.desc.innerHTML = (unbuilt ? `<b class="ar-wip">NOT YET IMPLEMENTED</b> ` : '')
      + (DESCRIPTIONS[this.viewKey] || '');

    const nums = this._statsFor(slot, def);
    this.el.nums.innerHTML = nums.map(([v, l]) =>
      `<div class="ar-num"><span>${v}</span><label>${l}</label></div>`).join('');

    if (slot.art === 'weapon') {
      // HANDLING is hipfire spread under a friendlier name — how controllable the
      // weapon is unaimed, which is what the word means to a player. Keeping it
      // keyed to spreadHip is what stops it duplicating MOBILITY, which is length.
      const bars = [
        ['ACCURACY', 1 - norm(def.spreadAds, 0.001, 0.02)],
        ['RANGE', norm(def.falloff[1], 40, 820)],
        ['HANDLING', 1 - norm(def.spreadHip, 0.004, 0.045)],
        ['MOBILITY', 1 - norm(def.len, 0.55, 1.4)],
      ];
      this.el.bars.innerHTML = bars.map(([label, v]) =>
        `<div class="ar-bar"><label>${label}</label><div class="ar-track"><div style="width:${Math.round(v * 100)}%"></div></div></div>`
      ).join('');
    } else {
      this.el.bars.innerHTML = '';
    }
  }

  // [value, label] triples for the stat row, per slot kind.
  _statsFor(slot, def) {
    if (slot.art === 'weapon') {
      return [
        [def.pellets ? `${def.dmg}×${def.pellets}` : def.dmg, 'DAMAGE'],
        [def.mode === 'charge' ? '—' : def.rpm, 'RPM'],
        [def.mag, 'MAG'],
      ];
    }
    if (slot.id === 'grenade') {
      return [[def.dmg || '—', 'DAMAGE'], [`${def.splash || def.cloudRadius || 0}m`, 'RADIUS'], [def.count, 'CARRIED']];
    }
    if (slot.id === 'melee') {
      return [[def.dmg, 'DAMAGE'], [`${def.range}m`, 'REACH'], [`${def.useTime}s`, 'SWING']];
    }
    // A weapon upgrade's interesting numbers are which slot it rewrites, what
    // it costs, and how many guns it opens up.
    if (def.kind === 'weaponSlot') {
      const opts = (def.weapons && def.weapons.length) || 3;  // `pool` resolves per class
      return [
        [def.upgrades === 'primary' ? 'PRIMARY' : '2ND', 'UPGRADES'],
        [def.reserveMult ? `×${def.reserveMult}` : '—', 'RESERVE'],
        [opts, opts === 1 ? 'OPTION' : 'OPTIONS'],
      ];
    }
    // No TYPE stat here — the breadcrumb above already names the kind, and
    // repeating it read as filler.
    const out = [];
    if (def.charges !== undefined) out.push([def.charges, 'CARRIED']);
    const t = def.deployTime ?? def.useTime;
    if (t !== undefined) out.push([`${t}s`, 'DEPLOY']);
    return out;
  }

  // The armory owns a SEPARATE WebGLRenderer, so it shares nothing with the
  // main context — every weapon texture uploads again the first time the
  // armory draws it. Do that behind the loading bar instead.
  async prewarm() {
    // Before the assets guard: the deck is stage furniture and should be there
    // even on the path where there are no weapons to warm.
    await this._loadDeckGlb();
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
  // more than `cardEdgeAngle`, which on hard-surface weapons means the major
  // panel breaks: a technical drawing rather than a wireframe.
  // Beats hand-authored SVGs because it cannot drift when a gun is re-exported.
  //
  // Crease edges ALONE are not a drawing, though, and that is worth spelling
  // out because it is not obvious from the picture:
  //   - nothing occludes anything, so the far side of the gun and every
  //     internal component draw straight through the body;
  //   - a smooth surface has no creases at all, so a barrel or a scope tube
  //     contributes nothing but its end caps.
  // Together those two are why parts appeared to float. `cardHiddenLine` fixes
  // the first with a depth-only pre-pass and `cardSilhouette` the second with an
  // inverted hull — see the passes in the loop below.
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
    const hide = [this.backdrop, this.floor, this.shadowPlane, this.mirror, this.holder,
                  this.deckGlb].filter(Boolean);
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
      // The depth-only solid below owns the depth buffer for this drawing.
      // Lines must TEST against it (that is the whole point) but must not WRITE
      // to it, or a near line starts occluding the silhouette pass behind it.
      depthWrite: false,
    });
    // The occluder. Renders nothing — colorWrite off — and exists purely to put
    // the weapon's solid form into the depth buffer so the line passes have
    // something to be hidden by. Polygon offset pushes it back a hair so a line
    // sitting exactly on the surface it was derived from is not in a coin-flip
    // depth tie with it.
    // DoubleSide is load-bearing, not caution. These GLBs do not all wind the
    // same way, and at FrontSide a reversed mesh is culled entirely — it writes
    // NO depth, so nothing occludes anything and the hull below passes over the
    // whole body. That is not a subtle artefact: the shotgun and the rocket
    // baked as solid filled slugs while the BR came out perfect.
    const depthMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: S.cardDepthBias,
      polygonOffsetUnits: S.cardDepthBias,
    });
    // Inverted-hull silhouette: back faces only, each vertex pushed outward
    // along its normal IN SCREEN SPACE. Screen space rather than world space is
    // what keeps the outline an even weight — a world-space offset would come
    // out thicker on the near end of a gun than the far end, which reads as a
    // mistake rather than as a drawing.
    //
    // The x offset is divided by aspect because a given NDC step covers more
    // pixels horizontally than vertically on a 3.1:1 frame; without it the
    // outline is over three times heavier on the top and bottom than the sides.
    // Pushed BACK in depth, harder than the occluder above is. Inside the
    // body's silhouette that makes the hull lose the depth test no matter which
    // way the mesh winds; outside it there is no depth to lose to, so the
    // outline still draws. Cheaper and far more robust than trying to detect
    // and normalise winding per mesh.
    const hullMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      polygonOffset: true,
      polygonOffsetFactor: S.cardSilhouetteBias,
      polygonOffsetUnits: S.cardSilhouetteBias,
      uniforms: {
        uColor: { value: new THREE.Color(S.cardLineColor) },
        uWidth: { value: S.cardSilhouette },
        uAspect: { value: W / H },
      },
      vertexShader: `
        uniform float uWidth, uAspect;
        void main() {
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vec2 nd = (projectionMatrix * vec4(normalize(normalMatrix * normal), 0.0)).xy;
          // A normal pointing straight at the camera projects to nothing, and
          // normalize() of a zero vector is NaN — which would throw the whole
          // triangle off screen. Those verts are dead centre of a face and have
          // no business moving anyway, so leave them where they are.
          vec2 dir = length(nd) > 1e-6 ? normalize(nd) : vec2(0.0);
          clip.x += dir.x * uWidth / uAspect * clip.w;
          clip.y += dir.y * uWidth * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        void main() { gl_FragColor = vec4(uColor, 1.0); }`,
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
        // Three passes per mesh, pinned with renderOrder rather than left to
        // three's own sort, because they are strictly sequential:
        //   0  depth-only solid  — writes depth, draws nothing
        //   1  silhouette hull   — the contour, occluded by anything in front
        //   2  crease edges      — the panel lines, likewise occluded
        // Geometry is SHARED with the source model here (only EdgesGeometry is
        // freshly allocated) — see the disposal note below, which depends on it.
        const drawing = new THREE.Group();
        for (const mesh of meshes) {
          if (S.cardHiddenLine) {
            const solid = new THREE.Mesh(mesh.geometry, depthMat);
            solid.applyMatrix4(mesh.matrixWorld);
            solid.renderOrder = 0;
            drawing.add(solid);
          }
          if (S.cardSilhouette > 0) {
            const hull = new THREE.Mesh(mesh.geometry, hullMat);
            hull.applyMatrix4(mesh.matrixWorld);
            hull.renderOrder = 1;
            drawing.add(hull);
          }
          const eg = new THREE.EdgesGeometry(mesh.geometry, thresh);
          const seg = new THREE.LineSegments(eg, lineMat);
          seg.applyMatrix4(mesh.matrixWorld);
          seg.renderOrder = 2;
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
        //
        // LineSegments ONLY. The depth and hull meshes above share geometry
        // with the real weapon models — a blanket dispose here would free the
        // buffers out from under every gun in the game, not just the card.
        bay.remove(drawing);
        drawing.traverse((o) => { if (o.isLineSegments && o.geometry) o.geometry.dispose(); });
      }
    } catch (e) {
      console.warn('thumbnail bake failed, cards fall back to SVG line art', e);
    } finally {
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearAlpha(prevAlpha);
      lineMat.dispose();
      depthMat.dispose();
      hullMat.dispose();
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
    // The plate is screen-space and has no view ray to feed.
    if (bu.uProjInv) {
      bu.uProjInv.value.copy(this.camera.projectionMatrixInverse);
      bu.uViewInv.value.copy(this.camera.matrixWorld);
    }
    this.composer.render();
  }
}
