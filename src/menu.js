// Armory / loadout menu: class tabs, weapon cards with baked thumbnails,
// and an interactive 3D inspection viewer (drag to spin, wheel to zoom).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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

// Output encoding for the stage's two raw shaders (sky and deck). three only
// injects its own colour-space conversion into its own materials, so a raw
// ShaderMaterial has to do this itself or it renders linear — far darker than
// the authored hex.
//
// It has to be the REAL sRGB curve, not the pow(1/2.2) approximation that used
// to be here. THREE.Color decodes an authored hex with the real curve, and that
// curve has a LINEAR TOE near black; pow has none. Through midtones the two
// agree closely enough not to notice. Through the near-black values this whole
// palette is made of they do not: #05080e went in and #0d1116 came out, about
// three times too bright in linear, and no amount of tuning the config could
// put the deck down on black because the floor of the encode was the problem.
// With the matching OETF the hex you author is the pixel you get.
const SRGB_ENCODE = `
  vec3 toSRGB(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }
  // Sub-LSB dither. The stage spans only a handful of 8-bit steps end to end,
  // so without breaking them up its gradients show as banded stripes.
  float dither(vec2 p) {
    return (fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  }`;

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
  _buildBackdrop() {
    const K = S.sky;
    // Colours go through THREE.Color (sRGB-decoded on the way in) and come back
    // out through pow(1/2.2) at the end of the shader — the same round trip the
    // deck does, so the hex you author is roughly the pixel you get.
    const mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uProjInv: { value: new THREE.Matrix4() },
        uViewInv: { value: new THREE.Matrix4() },
        uTop: { value: new THREE.Color(K.top) },
        uHorizon: { value: new THREE.Color(K.horizon) },
        uBand: { value: new THREE.Color(K.band) },
        uBandW: { value: K.bandWidth },
        uRise: { value: K.rise },
        uCol: { value: new THREE.Color(K.column) },
        uColX: { value: K.columnX },
        uColW: { value: K.columnW },
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
        uniform vec3 uTop, uHorizon, uBand, uCol;
        uniform float uBandW, uRise, uColX, uColW, uVig;
        varying vec2 vNdc;
        ${SRGB_ENCODE}

        void main() {
          vec4 vp = uProjInv * vec4(vNdc, -1.0, 1.0);
          vec3 dir = normalize((uViewInv * vec4(normalize(vp.xyz / vp.w), 0.0)).xyz);
          float up = dir.y;   // 0 on the horizon, +1 straight up

          vec3 col = mix(uHorizon, uTop, smoothstep(0.0, uRise, up));
          // the tight atmospheric band sitting on the horizon line
          col += uBand * exp(-abs(up) / max(uBandW, 1e-4));
          // one soft distant light column behind the weapon
          float cx = (dir.x - uColX) / max(uColW, 1e-4);
          col += uCol * exp(-cx * cx) * (1.0 - smoothstep(0.0, uRise * 2.2, abs(up)));
          col *= 1.0 - uVig * dot(vNdc, vNdc) * 0.5;

          gl_FragColor = vec4(toSRGB(col) + dither(gl_FragCoord.xy), 1.0);
        }`,
    });
    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.backdrop.frustumCulled = false; // its verts are already in clip space
    this.backdrop.renderOrder = -1;      // opaque, but must land before the gun
    this.scene.add(this.backdrop);
  }

  // The deck's detail map. Greyscale around 0.5 — the shader reads it as a
  // signed multiplier, so 0.5 is "leave this pixel alone".
  //
  // Generated into a canvas when no `deckUrl` is configured, so the stage needs
  // no asset to look right. Seamless by construction: the smears run the full
  // width (so X wraps for free) and any that would cross the top or bottom edge
  // are drawn a second time wrapped, which is what makes Z wrap too.
  _deckTexture() {
    let tex;
    if (S.deckUrl) {
      tex = new THREE.TextureLoader().load(S.deckUrl);
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
    const floorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        // NOTE: authored in FINAL DISPLAY space. The deck is a raw ShaderMaterial,
        // so three's ACES tone mapping never touches it — these are the pixels you
        // get. Consequence worth knowing while tuning: changing `light.exposure`
        // moves the weapon but NOT the deck, so the two can drift apart.
        uBase: { value: new THREE.Color(S.floorBase) },
        uHorizon: { value: new THREE.Color(S.floorHorizon) },
        uBand: { value: new THREE.Color(S.floorBand) },
        uBandRamp: { value: S.bandRamp },
        uLine: { value: new THREE.Color(S.lineColor) },
        uGlow: { value: new THREE.Color(S.floorGlow) },
        uStep: { value: S.gridStep },
        uMajor: { value: S.gridMajor },
        uMinorAmp: { value: S.lineMinor },
        uMajorAmp: { value: S.lineMajor },
        uHaze: { value: S.haze },
        uHazeStart: { value: S.hazeStart },
        uLineNear: { value: S.lineNear },
        uLineSoft: { value: S.lineNearSoft },
        uMap: { value: this._deckTexture() },
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
        uniform vec3 uBase, uHorizon, uBand, uLine, uGlow;
        uniform float uBandRamp;
        uniform float uStep, uMajor, uMinorAmp, uMajorAmp;
        uniform float uHaze, uHazeStart, uLineNear, uLineSoft;
        uniform sampler2D uMap;
        uniform float uTile, uDetail, uGlowR, uAlpha;
        varying vec3 vWorld;
        ${SRGB_ENCODE}

        // 1.0 on a grid line (~1px wide, antialiased), 0.0 between lines
        float gridLine(float c, float s) {
          float w = max(fwidth(c), 1e-5);
          float d = abs(fract(c / s - 0.5) - 0.5) * s / w;
          float line = 1.0 - min(d, 1.0);
          // Dissolve once a line is narrower than the pixel drawing it. Without
          // this the term never reaches 0 in the far field and the whole horizon
          // whitens into a solid sheet of line colour instead of a floor — which
          // is exactly what happens the moment the deck gets big enough to have
          // a real distance to it.
          return line * (1.0 - smoothstep(s * 0.35, s * 0.9, w));
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
          // small pool of light directly beneath the weapon
          col += uGlow * pow(1.0 - min(length(vWorld.xz) / uGlowR, 1.0), 2.0);
          // Surface detail, sampled in world XZ so it stays put on the deck
          // rather than swimming with the camera. Signed around 0.5, and it
          // MULTIPLIES: scuffs have to scale with how lit a patch of deck is,
          // or they stay equally visible in the dark near field where nothing
          // should be readable. Mip selection handles the grazing angle, so
          // unlike the sine version this needs no distance fade of its own.
          float det = texture2D(uMap, vWorld.xz / uTile).r;
          col *= 1.0 + (det - 0.5) * 2.0 * uDetail;

          float minor = max(gridLine(vWorld.x, uStep), gridLine(vWorld.z, uStep));
          float major = max(gridLine(vWorld.x, uStep * uMajor), gridLine(vWorld.z, uStep * uMajor));
          col += uLine * (minor * uMinorAmp + major * uMajorAmp) * amp;

          // ...and the deck hazes into the sky. It has to land on the backdrop's
          // colour at ray.y == 0 INCLUDING that shader's horizon glow, hence the
          // band term — matching only uHorizon leaves a step in value sitting
          // right on the join. This replaces the old fade-to-transparent, which
          // compressed into a hard band of its own.
          vec3 far = uHorizon + uBand * smoothstep(uBandRamp, 1.0, haze);
          col = mix(col, far, haze);

          gl_FragColor = vec4(toSRGB(col) + dither(gl_FragCoord.xy), uAlpha);
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
  _fadeMirrorMaterial(mat) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uMirrorY = { value: this.floorY };
      sh.uniforms.uMirrorFade = { value: S.reflectFade };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vMirY;')
        .replace('#include <project_vertex>',
          '#include <project_vertex>\nvMirY = (modelMatrix * vec4(transformed, 1.0)).y;');
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
  _mirrorFor(key) {
    if (this._mirrors[key]) return this._mirrors[key];
    const src = this.game.assets.weaponModels[key];
    if (!src) return null;
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
        c.opacity = S.reflect;
        c.depthWrite = false;
        c.depthTest = false;            // the deck is drawn before it, not over it
        c.side = THREE.DoubleSide;      // negative Y scale flips triangle winding
        this._fadeMirrorMaterial(c);
        return c;
      });
      o.material = one ? mats[0] : mats;
    });
    this._mirrors[key] = m;
    return m;
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
    this.renderer.render(this.scene, this.camera);
  }
}
