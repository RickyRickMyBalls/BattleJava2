// GLB map loading: normalizes an imported battlefield to playable scale and
// bakes a heightfield from it on the GPU (top-down ortho render of world-Y,
// packed into two color channels), so terrainHeight() stays a cheap lookup.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildMapCollision } from './collision.js';

// Largest XZ extent after normalization (meters). map-3 is authored in metres —
// its FC_VEHICLE_ slots sit 10.6 units apart, which only reads as sane Warthog
// parking (5.6 m hog) at 1 unit = 1 m — so this is set to that map's marker span
// (2352.27) + 240 of breathing room, giving s = 1.0 and HQs 2578 m apart.
const TARGET_MAX_DIM = 2592;
// Backstop only. By construction max(spanX, spanZ) * s + 240 === TARGET_MAX_DIM,
// so this can never bite unless the math above changes; it was a fixed 1400,
// which silently truncated the playfield (and with it the baked heightfield) the
// moment TARGET_MAX_DIM went past it, leaving both HQs outside the bake.
const MAX_PLAYFIELD = TARGET_MAX_DIM;
const BAKE_COLS = 1024;

// Fetching the GLB is split from preparing it so the download can start while
// the player is still in the lobby picking a kit. map-3.glb is 235 MB — more
// than half the whole payload — and it used to be fetched only after START
// GAME, which is the player sitting and watching a bar for all of it.
//
// Only the DOWNLOAD is prefetched, deliberately. prepareMap bakes a heightfield
// on the GPU and builds collision BVHs, and running either while the lobby is
// animating would hitch the very screen the prefetch exists to hide behind.
//
// url -> { promise, progress, listeners }
const gltfCache = new Map();

// Start (or join) the download for `mapDef`. Safe to call repeatedly and on
// procedural maps, which have nothing to fetch. Nothing cancels an in-flight
// fetch when the player switches maps — GLTFLoader has no abort, and the entry
// stays cached, so switching back is instant rather than wasted.
export function prefetchMap(mapDef) {
  if (!mapDef || mapDef.type !== 'glb' || !mapDef.url) return null;
  const url = mapDef.url;
  const cached = gltfCache.get(url);
  if (cached) return cached;

  const entry = { progress: 0, listeners: new Set() };
  entry.promise = new Promise((resolve, reject) => {
    new GLTFLoader().load(url, resolve, (e) => {
      // Servers that send no Content-Length report total 0; the rough scale
      // keeps the bar moving instead of pinning it at zero for the whole load.
      entry.progress = e.total > 0 ? e.loaded / e.total : Math.min(0.95, e.loaded / 200e6);
      for (const fn of entry.listeners) fn(entry.progress);
    }, reject);
  });
  // A failed prefetch must not poison the retry at START GAME.
  entry.promise.catch(() => { if (gltfCache.get(url) === entry) gltfCache.delete(url); });
  gltfCache.set(url, entry);
  return entry;
}

// How far along `mapDef`'s prefetch is, 0..1. The lobby rebuilds its map rows
// from scratch on every click, so it needs to read this back rather than rely
// on having held on to the entry.
export function mapLoadProgress(mapDef) {
  const entry = mapDef && mapDef.url ? gltfCache.get(mapDef.url) : null;
  return entry ? entry.progress : 0;
}

export async function loadMap(mapDef, renderer, onProgress) {
  const entry = prefetchMap(mapDef);
  if (onProgress) {
    onProgress(entry.progress);   // report where the prefetch already got to
    entry.listeners.add(onProgress);
  }
  try {
    const gltf = await entry.promise;
    if (onProgress) onProgress(1);
    // One-shot: prepareMap mutates the gltf in place — it rescales and reparents
    // the root and hides the collision shells — so a second match on this map
    // has to parse its own copy. By then the bytes are in the browser's HTTP
    // cache, so that refetch is cheap.
    gltfCache.delete(mapDef.url);
    return prepareMap(mapDef, gltf, renderer);
  } finally {
    entry.listeners.delete(onProgress);
  }
}

// Maps are authored with FC_* marker empties: FC_HQ_BLUE / FC_HQ_RED,
// FC_SECTOR_A.., FC_VEHICLE_*. The markers define the playable area — the
// GLB's raw bounding box is useless (skybox + distant scenery inflate it).
function prepareMap(mapDef, gltf, renderer) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // Collect raw marker positions + skybox/ambient nodes by naming convention:
  // rotate_* spins slowly, move_* drifts +X; ring/clouds/ships stay out of the bake
  const markers = {};
  const ambient = { rotators: [], movers: [], skyNodes: [] };
  root.traverse((o) => {
    if (!o.name) return;
    if (o.name.startsWith('FC_')) {
      markers[o.name.toUpperCase()] = o.getWorldPosition(new THREE.Vector3());
      return;
    }
    const n = o.name.toLowerCase();
    if (/^rotate_/.test(n)) ambient.rotators.push(o);
    else if (/^move_/.test(n)) { o.userData.startX = o.position.x; ambient.movers.push(o); }
    if (/^(rotate_|move_|ring|sky|cloud)/.test(n)) ambient.skyNodes.push(o);
  });
  const hqBlue = markers.FC_HQ_BLUE;
  const hqRed = markers.FC_HQ_RED;
  const sectorKeys = Object.keys(markers).filter((k) => k.startsWith('FC_SECTOR_')).sort();
  if (!hqBlue || !hqRed || sectorKeys.length < 2) {
    throw new Error(`Map is missing FC_ markers (found: ${Object.keys(markers).join(', ') || 'none'})`);
  }

  // Playable footprint from the markers
  const pts = [hqBlue, hqRed, ...sectorKeys.map((k) => markers[k])];
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of pts) { min.min(p); max.max(p); }
  const spanX = Math.max(1, max.x - min.x);
  const spanZ = Math.max(1, max.z - min.z);
  const cx = (min.x + max.x) / 2;
  const cz = (min.z + max.z) / 2;
  const groundY = min.y;

  // Scale so the marker span plus breathing room lands at battlefield size
  const s = (TARGET_MAX_DIM - 240) / Math.max(spanX, spanZ);
  const w = Math.min(MAX_PLAYFIELD, spanX * s + 240);
  const d = Math.min(MAX_PLAYFIELD, spanZ * s + 240);
  const maxY = (max.y - groundY) * s + 200; // bake ceiling: above markers, below sky

  const group = new THREE.Group();
  root.scale.setScalar(s);
  root.position.set(-cx * s, -groundY * s, -cz * s);
  group.add(root);
  // Material sidedness is authored in Blender (sky spheres are viewed from
  // inside and need their exported double/back-side setting respected).
  group.traverse((o) => {
    if (o.isMesh) o.frustumCulled = true;
  });

  // Markers → final battlefield space
  const toLocal = (p) => ({ x: (p.x - cx) * s, y: (p.y - groundY) * s, z: (p.z - cz) * s });
  const hqDefs = [
    { team: 0, ...toLocal(hqBlue) },
    { team: 1, ...toLocal(hqRed) },
  ];
  const sectorDefs = sectorKeys.map((k) => {
    const p = toLocal(markers[k]);
    return { id: k.replace('FC_SECTOR_', ''), x: p.x, z: p.z, r: 32 };
  });
  // Every marker that is not an HQ or a sector is a spawn candidate, and WHAT
  // it spawns is decided downstream by `CFG.vehicle.markers`. This file knows
  // what a marker is; it deliberately does not know what a Warthog is, which is
  // why adding the Pelican needed no vehicle-key list here.
  //
  // The Y is carried through, and that is a behaviour change rather than tidying.
  // Markers are authored slightly ABOVE the floor so a vehicle drops onto it,
  // and the old filter both dropped every non-Warthog marker AND discarded the
  // height on the ones it kept — so the authored intent had never reached the
  // spawner. See `VehicleManager.spawn`.
  const vehicleSpawns = Object.keys(markers)
    .filter((k) => !k.startsWith('FC_HQ') && !k.startsWith('FC_SECTOR_'))
    .map((k) => ({ name: k, ...toLocal(markers[k]) }));

  // Sky items: fog would swallow them at distance — render them clean
  for (const o of ambient.skyNodes) {
    o.traverse((c) => {
      if (c.isMesh && c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) { m.fog = false; m.needsUpdate = true; }
      }
    });
  }

  // Authored collision shells (floor/wall/cover parents) → BVHs; also hides them
  const collision = buildMapCollision(group);

  // Sky items must not shadow the terrain in the height bake; wall/cover
  // shells would turn into phantom terrain columns (floor shells are fine —
  // they ARE the floor). All restored right after the bake.
  const hidden = [];
  const bakeExcluded = [...ambient.skyNodes];
  if (collision && collision.parents) {
    if (collision.parents.wallParent) bakeExcluded.push(collision.parents.wallParent);
    if (collision.parents.coverParent) bakeExcluded.push(collision.parents.coverParent);
  }
  for (const o of bakeExcluded) {
    if (o.visible) { o.visible = false; hidden.push(o); }
  }
  // The bake encodes world Y into 16 bits over a FIXED range, and anything below
  // that range's floor clamps to it. That floor used to sit at Y=0 — the LOWEST
  // FC_ MARKER — so every metre of ground authored below the markers read back as
  // flat marker height: you spawn standing on an invisible plane with the real
  // terrain somewhere underneath. Take the floor from the geometry the bake
  // actually renders instead, so the range covers what it encodes. Clamped to at
  // most 0, so a map with nothing below its markers bakes exactly as it always did.
  const bakeMinY = Math.min(0, visibleMinY(group));
  const heightfield = bakeHeightfield(group, w, d, bakeMinY, maxY, renderer);
  for (const o of hidden) o.visible = true;

  ambient.scale = s;
  return { def: mapDef, group, w, d, maxY, sample: heightfield.sample, hqDefs, sectorDefs, vehicleSpawns, ambient, collision };
}

// Lowest world Y among the meshes the bake will actually draw. `Box3.setFromObject`
// is no use here: it ignores `visible`, so it would fold the sky and the wall
// shells — the very things hidden for the bake — straight back in.
function visibleMinY(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let min = Infinity;
  const walk = (o) => {
    if (!o.visible) return;   // hidden subtree: the bake will not draw it either
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (box.min.y < min) min = box.min.y;
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return isFinite(min) ? min : 0;
}

function bakeHeightfield(group, w, d, minY, maxY, renderer) {
  const cols = BAKE_COLS;
  const rows = Math.max(32, Math.round(cols * (d / w)));
  const spanY = Math.max(1, maxY - minY);

  // Height-writing material: world Y packed into R (high byte) + G (low byte),
  // normalized over minY..maxY. B is a WRITTEN FLAG — the clear color has none —
  // which is how the readback tells "no geometry in this pixel" apart from
  // "geometry sitting exactly on the bottom of the range".
  const heightMat = new THREE.ShaderMaterial({
    uniforms: { minY: { value: minY }, spanY: { value: spanY } },
    vertexShader: /* glsl */`
      varying float vH;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vH = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying float vH;
      uniform float minY;
      uniform float spanY;
      void main() {
        float h = clamp((vH - minY) / spanY, 0.0, 1.0);
        float hh = h * 65535.0;
        float hi = floor(hh / 256.0);
        float lo = hh - hi * 256.0;
        gl_FragColor = vec4(hi / 255.0, lo / 255.0, 1.0, 1.0);
      }`,
  });

  const bakeScene = new THREE.Scene();
  bakeScene.add(group);
  bakeScene.overrideMaterial = heightMat;

  // The far plane has to clear the BOTTOM of the range, not just Y=0 — ground
  // authored below the marker plane is exactly what this bake exists to capture,
  // and a far plane that stops at 0 would clip it away instead of encoding it.
  const camY = maxY + 10;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.1, camY - minY + 10);
  cam.position.set(0, camY, 0);
  cam.rotation.set(-Math.PI / 2, 0, 0);
  cam.updateMatrixWorld();

  const rt = new THREE.WebGLRenderTarget(cols, rows);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 1); // no geometry: the B flag stays 0
  renderer.setRenderTarget(rt);
  renderer.render(bakeScene, cam);

  const pixels = new Uint8Array(cols * rows * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, cols, rows, pixels);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();

  bakeScene.overrideMaterial = null;
  bakeScene.remove(group); // caller re-parents it into the game scene

  const data = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    // Unwritten pixels still decode to height 0 (the marker plane), NOT to the
    // bottom of the range: the 240 m of breathing room around the authored map
    // has no geometry in it, and dropping it to the range floor would turn the
    // whole border into a pit you fall into on the way out of bounds.
    data[i] = pixels[i * 4 + 2] === 0
      ? 0
      : minY + ((pixels[i * 4] * 256 + pixels[i * 4 + 1]) / 65535) * spanY;
  }

  // Top-down camera: frame top = world -Z; GL readPixels row 0 = frame bottom
  // = world +Z. So row 0 holds z=+d/2 and rows grow toward -Z.
  const sample = (x, z) => {
    const fx = ((x + w / 2) / w) * (cols - 1);
    const fz = ((d / 2 - z) / d) * (rows - 1);
    const cx = Math.max(0, Math.min(cols - 1.001, fx));
    const cz = Math.max(0, Math.min(rows - 1.001, fz));
    const x0 = Math.floor(cx), z0 = Math.floor(cz);
    const tx = cx - x0, tz = cz - z0;
    const idx = (zz, xx) => data[zz * cols + xx];
    const h00 = idx(z0, x0), h10 = idx(z0, x0 + 1);
    const h01 = idx(z0 + 1, x0), h11 = idx(z0 + 1, x0 + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };

  return { sample, data, cols, rows };
}
