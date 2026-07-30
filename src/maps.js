// GLB map loading: normalizes an imported battlefield to playable scale and
// bakes a heightfield from it on the GPU (top-down ortho render of world-Y,
// packed into two color channels), so terrainHeight() stays a cheap lookup.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildMapCollision } from './collision.js';

const TARGET_MAX_DIM = 900;   // largest XZ extent after normalization (meters)
const BAKE_COLS = 384;

export function loadMap(mapDef, renderer, onProgress) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(
      mapDef.url,
      (gltf) => {
        try {
          resolve(prepareMap(mapDef, gltf, renderer));
        } catch (e) {
          reject(e);
        }
      },
      (e) => {
        if (onProgress && e.total > 0) onProgress(e.loaded / e.total);
        else if (onProgress) onProgress(Math.min(0.95, e.loaded / 200e6));
      },
      reject
    );
  });
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
  const w = Math.min(1400, spanX * s + 240);
  const d = Math.min(1400, spanZ * s + 240);
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
  const vehicleSpawns = Object.keys(markers)
    .filter((k) => k.startsWith('FC_VEHICLE_'))
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
  const heightfield = bakeHeightfield(group, w, d, maxY, renderer);
  for (const o of hidden) o.visible = true;

  ambient.scale = s;
  return { def: mapDef, group, w, d, maxY, sample: heightfield.sample, hqDefs, sectorDefs, vehicleSpawns, ambient, collision };
}

function bakeHeightfield(group, w, d, maxY, renderer) {
  const cols = BAKE_COLS;
  const rows = Math.max(32, Math.round(cols * (d / w)));

  // Height-writing material: world Y packed into R (high byte) + G (low byte)
  const heightMat = new THREE.ShaderMaterial({
    uniforms: { maxY: { value: maxY } },
    vertexShader: /* glsl */`
      varying float vH;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vH = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying float vH;
      uniform float maxY;
      void main() {
        float h = clamp(vH / maxY, 0.0, 1.0);
        float hh = h * 65535.0;
        float hi = floor(hh / 256.0);
        float lo = hh - hi * 256.0;
        gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);
      }`,
  });

  const bakeScene = new THREE.Scene();
  bakeScene.add(group);
  bakeScene.overrideMaterial = heightMat;

  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.1, maxY + 20);
  cam.position.set(0, maxY + 10, 0);
  cam.rotation.set(-Math.PI / 2, 0, 0);
  cam.updateMatrixWorld();

  const rt = new THREE.WebGLRenderTarget(cols, rows);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 1); // empty pixels read as height 0
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
    data[i] = ((pixels[i * 4] * 256 + pixels[i * 4 + 1]) / 65535) * maxY;
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
