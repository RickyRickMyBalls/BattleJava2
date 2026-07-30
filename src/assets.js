// Asset pipeline: loads GLB characters / weapon / Mixamo animation clips,
// normalizes character height, and retargets animation tracks onto each
// character's actual bone names (Mixamo naming variants tolerated).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_PATHS, WEAPONS } from './config.js';

const gltfLoader = new GLTFLoader();
const audioLoader = new THREE.AudioLoader();

function loadGLB(url) {
  return new Promise((resolve, reject) => gltfLoader.load(url, resolve, undefined, reject));
}
function loadAudio(url) {
  return new Promise((resolve, reject) => audioLoader.load(url, resolve, undefined, reject));
}

// "mixamorig:Hips" / "mixamorigHips" / "mixamorig_Hips" / "Hips" -> "hips"
function canonicalBoneName(name) {
  return name.replace(/^.*?mixamorig[:_]?/i, '').replace(/[:_\s]/g, '').toLowerCase();
}

// Collect skeleton bones of a character template.
function collectBones(root) {
  const map = new Map(); // canonical -> Bone
  root.traverse((o) => {
    if (o.isBone) {
      const c = canonicalBoneName(o.name);
      if (!map.has(c)) map.set(c, o);
    }
  });
  return map;
}

// Wrap a loaded scene so it stands `targetHeight` meters tall with feet at y=0.
// Skinned meshes must be measured through their bone transforms — the raw
// geometry bounds can be wildly different when bind matrices carry scale.
function normalizeCharacter(scene, targetHeight) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let hasSkinned = false;
  scene.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.computeBoundingBox();
      box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
      hasSkinned = true;
    }
  });
  if (!hasSkinned) box.setFromObject(scene);
  const h = Math.max(0.01, box.max.y - box.min.y);
  const s = targetHeight / h;
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  scene.scale.setScalar(s);
  scene.position.y = -box.min.y * s;
  scene.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false; // skinned bounds are unreliable after scaling
      if (o.material) o.material.side = THREE.FrontSide;
    }
  });
  return wrapper;
}

// Retarget one Mixamo clip onto a character skeleton:
//  - rename tracks to the character's bone names
//  - keep rotations; keep position only for hips, rescaled and locked to rest X/Z
//  - drop scale tracks entirely (this is what fixes "animation resizes the character")
function retargetClip(clip, boneMap) {
  const tracks = [];
  const hips = boneMap.get('hips');
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const nodeName = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const bone = boneMap.get(canonicalBoneName(nodeName));
    if (!bone) continue;
    if (prop === 'scale') continue;
    if (prop === 'position') {
      if (bone !== hips) continue;
      const src = track.values;
      const firstY = Math.abs(src[1]) > 1e-4 ? src[1] : 1;
      const ratio = hips.position.y / firstY;
      const values = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        values[i] = hips.position.x;          // lock X/Z: no root motion drift
        values[i + 1] = src[i + 1] * ratio;   // keep vertical motion, rescaled
        values[i + 2] = hips.position.z;
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, Array.from(track.times), Array.from(values)));
      continue;
    }
    const T = track.constructor;
    tracks.push(new T(`${bone.name}.${prop}`, Array.from(track.times), Array.from(track.values)));
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// GPU prewarm: shader programs compile and textures upload the first time an
// object is rendered — without this, the first swap to each weapon hitches
// for a beat and the gun "pops in". Compile everything up front instead.
export async function prewarmWeapons(renderer, scene, camera, assets) {
  const group = new THREE.Group();
  for (const m of Object.values(assets.weaponModels)) group.add(m.clone(true)); // clones share materials/geometry
  scene.add(group);
  try {
    if (renderer.compileAsync) await renderer.compileAsync(group, camera, scene);
    else renderer.compile(scene, camera);
    // compileAsync covers shaders only — geometry buffers and textures still
    // upload lazily on first draw. One offscreen render forces all of it
    // (weapon meshes have frustumCulled=false, so every gun gets drawn).
    const rt = new THREE.WebGLRenderTarget(8, 8);
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    rt.dispose();
  } finally {
    scene.remove(group);
  }
}

export async function loadAssets(onProgress) {
  const out = { characters: {}, clips: {}, audio: {}, weaponModels: {} };
  const jobs = [];
  let done = 0;
  const total =
    3 /* characters */ + Object.keys(WEAPONS).length +
    Object.keys(ASSET_PATHS.animations).length +
    Object.keys(ASSET_PATHS.audio).length;

  const tick = (label) => { done++; onProgress?.(done / total, label); };

  // Characters ------------------------------------------------------------
  const charDefs = [
    { key: 'spartan', url: ASSET_PATHS.characters.spartan, height: 2.06 },
    { key: 'elite', url: ASSET_PATHS.characters.elite, height: 2.35 },
    { key: 'marine', url: ASSET_PATHS.characters.marine, height: 1.86 },
  ];
  for (const def of charDefs) {
    jobs.push(loadGLB(def.url).then((gltf) => {
      const template = normalizeCharacter(gltf.scene, def.height);
      const boneMap = collectBones(template);
      out.characters[def.key] = { template, boneMap, height: def.height };
      tick(def.key);
    }));
  }

  // Weapons ---------------------------------------------------------------
  for (const [key, def] of Object.entries(WEAPONS)) {
    jobs.push(loadGLB(def.model).then((gltf) => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const len = Math.max(size.x, size.y, size.z) || 1;
      const s = def.len / len; // normalize to the weapon's real-world length
      const wrapper = new THREE.Group();
      scene.scale.setScalar(s);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
      scene.position.sub(center);
      wrapper.add(scene);
      wrapper.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      out.weaponModels[key] = wrapper;
      tick(key);
    }).catch((e) => { console.warn(`Failed weapon ${def.model}`, e); tick(key); }));
  }

  // Animations ------------------------------------------------------------
  for (const [key, url] of Object.entries(ASSET_PATHS.animations)) {
    jobs.push(loadGLB(url).then((gltf) => {
      const clip = gltf.animations && gltf.animations[0];
      if (clip) out.clips[key] = clip;
      else console.warn(`No animation found in ${url}`);
      tick(key);
    }).catch((e) => { console.warn(`Failed animation ${url}`, e); tick(key); }));
  }

  // Audio -----------------------------------------------------------------
  for (const [key, url] of Object.entries(ASSET_PATHS.audio)) {
    jobs.push(loadAudio(url).then((buf) => { out.audio[key] = buf; tick(`sfx:${key}`); })
      .catch((e) => { console.warn(`Failed audio ${url}`, e); tick(`sfx:${key}`); }));
  }

  await Promise.all(jobs);

  // Retarget every clip for every character type -------------------------
  for (const charKey of Object.keys(out.characters)) {
    const ch = out.characters[charKey];
    ch.clips = {};
    for (const [animKey, clip] of Object.entries(out.clips)) {
      const rc = retargetClip(clip, ch.boneMap);
      if (rc.tracks.length >= 8) ch.clips[animKey] = rc;
      else console.warn(`Retarget produced only ${rc.tracks.length} tracks for ${charKey}/${animKey} — skeleton mismatch?`);
    }
    console.log(`[assets] ${charKey}: ${ch.boneMap.size} bones, clips: ${Object.keys(ch.clips).join(', ')}`);
  }

  return out;
}
