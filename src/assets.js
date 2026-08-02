// Asset pipeline: loads GLB characters / weapon / Mixamo animation clips,
// normalizes character height, and retargets animation tracks onto each
// character's actual bone names (Mixamo naming variants tolerated).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
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

// Which component of a hips translation carries height. Both the characters and
// the Mixamo clips come out of Blender with the armature rotated (Z-up source
// into a Y-up glTF), so the hips' local height axis is -Z — local Y moves the
// hips sideways and does nothing vertically. The other two components are small
// lateral offsets, so the dominant one is the leg length: finding it by
// magnitude gets the right axis without hardcoding the export convention.
function hipsHeightAxis(v) {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return 0;
  return ay >= az ? 1 : 2;
}

// Retarget one Mixamo clip onto a character skeleton:
//  - rename tracks to the character's bone names
//  - keep rotations; keep position only for hips, rescaled and locked laterally
//  - drop scale tracks entirely (this is what fixes "animation resizes the character")
//
// `srcHipsRest` is the source rig's rest hips translation, captured at load. The
// scale factor has to come from that rather than from the clip's own first
// frame: normalizing per clip pins every clip's opening pose to the character's
// standing hip height, which silently cancels any clip that does not start
// standing — crouches never lower, deaths never reach the floor.
// The retarget is split in two because the halves have different dependencies.
// Everything except the hips position depends only on the bone NAME mapping, so
// any two rigs sharing a skeleton naming convention produce byte-identical
// output — that half is the ~50 tracks per clip, and it can be computed once and
// shared. The hips position track depends on this character's own bind pose,
// which differs by a unit or two between exports of the same rig, so it is
// always rebuilt. See loadAssets for the cache that exploits this.
//
// Rotations are kept, scale tracks are dropped entirely (this is what fixes
// "animation resizes the character"), and position is kept for the hips only.
function retargetPoseTracks(clip, boneMap) {
  const tracks = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const prop = track.name.slice(dot + 1);
    if (prop === 'scale' || prop === 'position') continue; // hips handled separately
    const bone = boneMap.get(canonicalBoneName(track.name.slice(0, dot)));
    if (!bone) continue;
    const T = track.constructor;
    tracks.push(new T(`${bone.name}.${prop}`, Array.from(track.times), Array.from(track.values)));
  }
  return tracks;
}

// `srcHipsRest` is the source rig's rest hips translation, captured at load. The
// scale factor has to come from that rather than from the clip's own first
// frame: normalizing per clip pins every clip's opening pose to the character's
// standing hip height, which silently cancels any clip that does not start
// standing — crouches never lower, deaths never reach the floor.
function retargetHipsTrack(clip, boneMap, srcHipsRest) {
  const hips = boneMap.get('hips');
  if (!hips) return null;
  const rest = [hips.position.x, hips.position.y, hips.position.z];
  const cAx = hipsHeightAxis(rest);
  const sAx = srcHipsRest ? hipsHeightAxis(srcHipsRest) : cAx;
  // Source units vary per clip, so this converts the source rig's hip height
  // into the character's own units while preserving how far each frame deviates
  // from rest. Null when the rest pose is unknown — then the hips stay planted,
  // which is what the old per-clip normalization effectively did anyway.
  const ratio = (srcHipsRest && Math.abs(srcHipsRest[sAx]) > 1e-4)
    ? rest[cAx] / srcHipsRest[sAx]
    : null;
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (track.name.slice(dot + 1) !== 'position') continue;
    if (boneMap.get(canonicalBoneName(track.name.slice(0, dot))) !== hips) continue;
    const src = track.values;
    // Trust the rest pose only if it actually belongs to this animation. An
    // export whose bind pose was authored at a different scale than its track
    // (rest -15 against a track at -103) would otherwise scale the whole body
    // by that error and produce a giant. Clips legitimately open anywhere from
    // a crouch (~0.4x standing) to upright, so anything outside that band is a
    // broken export, not a pose — fall back to normalizing the opening frame,
    // which is right for the standing clips this tends to happen to.
    let scale = ratio;
    if (scale !== null) {
      const opening = (src[sAx] * scale) / rest[cAx];
      if (!(opening > 0.25 && opening < 1.5)) {
        scale = Math.abs(src[sAx]) > 1e-4 ? rest[cAx] / src[sAx] : null;
        console.warn(`[assets] "${clip.name}": bind pose disagrees with its own hips track `
          + `(rest ${srcHipsRest[sAx].toFixed(1)} vs track ${src[sAx].toFixed(1)}, `
          + `would stand ${opening.toFixed(1)}x too tall). Falling back to first-frame `
          + `normalization — re-export this clip to get correct vertical motion.`);
      }
    }
    const values = new Float32Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      values[i] = rest[0];                  // lock laterally: no root motion drift
      values[i + 1] = rest[1];
      values[i + 2] = rest[2];
      if (scale !== null) values[i + cAx] = src[i + sAx] * scale;
    }
    return new THREE.VectorKeyframeTrack(`${hips.name}.position`, Array.from(track.times), Array.from(values));
  }
  return null;
}

// Identity of a skeleton as far as the shareable half of the retarget goes:
// which canonical bone each source track lands on, and what that bone is
// actually called (the output track names are built from it). Two rigs agreeing
// on that produce identical pose tracks — every marine variant off the same
// Mixamo skeleton lands on one signature, even though their bind poses differ
// slightly, because the bind pose only feeds the hips track.
function boneNameSignature(boneMap) {
  const parts = [];
  for (const [canon, bone] of boneMap) parts.push(`${canon}>${bone.name}`);
  return parts.sort().join('|');
}

// GPU prewarm: shader programs compile and textures upload the first time an
// object is drawn — without this, the first swap to each weapon hitches for a
// beat and the gun "pops in".
//
// This is PER SCENE, not per session. Three keys its program cache on the
// scene's lights, fog and shadow config, so the same rifle shown in the lobby,
// the armory and the match compiles three times. The armory goes further and
// owns a separate WebGLRenderer — a whole second GL context, which re-uploads
// every texture from scratch. Each surface therefore has to prewarm itself,
// with its own renderer, scene and camera.
//
// `objects` may be empty: the compile pass still walks everything already in
// the scene, which is how a late-arriving map or stage gets warmed.
//
// Two axes have to be covered separately, and getting either wrong leaves a
// hitch that looks like "the first time you see X":
//
//   CULLING — `renderer.render` only touches what this one camera can see, so
//   warming by rendering leaves every off-screen material cold. `compile()`
//   walks the whole scene graph instead and is the primary pass here. On a GLB
//   map the difference was 57 programs: the terrain and props outside the spawn
//   view, all compiling the first time the deploy map looked down at them.
//
//   COLOUR SPACE — three forces LinearSRGBColorSpace whenever a render target
//   is bound (WebGLPrograms.getParameters), and the output colour space is part
//   of the program key. So the canvas pass and any off-screen pass need
//   SEPARATE program sets, and which one you get depends purely on what was
//   bound when the warm ran. Pass `offscreen: true` for a surface that also
//   renders through a target (the match: deploy-map outline pass, scope
//   screens) to warm both.
export async function prewarm(renderer, scene, camera, objects = [], opts = {}) {
  const group = new THREE.Group();
  for (const o of objects) group.add(o);
  scene.add(group);
  const prevTarget = renderer.getRenderTarget();
  const compileAll = async () => {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  };
  const rt = new THREE.WebGLRenderTarget(8, 8);
  try {
    // 1. Programs for the canvas pass. compile() does not draw, so binding the
    //    canvas here is safe even with a loading screen up.
    renderer.setRenderTarget(null);
    await compileAll();

    // 2. Programs for the off-screen passes (linear output), same coverage.
    renderer.setRenderTarget(rt);
    if (opts.offscreen) await compileAll();

    // 3. compile() covers shaders only — geometry buffers and textures still
    //    upload lazily on first draw. One throwaway render forces those. It is
    //    frustum-culled, which is exactly why it is no longer the whole story.
    renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
    scene.remove(group);
  }
}

// Throwaway copies for prewarming. Clones share geometry and materials, which
// is exactly what we want — it is the material that needs compiling. Never
// prewarm with the cached originals: the player mounts those, and re-parenting
// one into a prewarm group would steal it out of the viewmodel.
export function weaponClones(assets) {
  return Object.values(assets.weaponModels).map((m) => m.clone(true));
}

export function characterClones(assets) {
  return Object.values(assets.characters).map((c) => cloneSkeleton(c.template));
}

// Authored facing -> the Y rotation that turns it into the +Z-forward, +Y-up
// convention the soldiers and the AI already use. Stated per vehicle in
// ASSET_PATHS rather than guessed, because a GLB's forward axis is whatever the
// artist's scene was and there is no way to read it back off the geometry.
const FORWARD_YAW = { '-x': Math.PI / 2, '+x': -Math.PI / 2, '+z': 0, '-z': Math.PI };

// Vehicles are the one asset class that keeps its authored scale. Characters
// are normalized to a measured height and weapons/props to a measured length,
// because in all three cases the real-world size is a design number we own. A
// vehicle's is not: it is a fact about the model, and normalizing would hide a
// mis-scaled export instead of showing it.
//
// What DOES get fixed up is the origin and the facing, so that placing one is
// `group.position.set(x, groundY, z)` + `group.rotation.y = yaw` and nothing
// else. The origin lands on the ground at the centre of the wheelbase:
//   - XZ from the four ref_contact_* empties (the bounding box would centre on
//     the roll cage and turret, and a vehicle wants placing by its tyres)
//   - Y from the bottom of the four wheel MESHES, not the contact empties,
//     which sit ~6 cm high on the Warthog and would park it floating.
function prepareVehicle(key, scene, def) {
  scene.updateMatrixWorld(true);

  const contacts = [];
  const wheels = [];
  scene.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (n.startsWith('ref_contact_')) contacts.push(o.getWorldPosition(new THREE.Vector3()));
    else if (o.isMesh && /^wheel_/.test(n)) wheels.push(o);
    // The authored hull. It ships with a material literally named `collision`
    // and exists to be raycast against in step 2, not to be looked at — unlike
    // a MAP's collision parents, which double as real floors and walls and are
    // therefore never hidden in code (see CLAUDE.md). Flip this line if the
    // shell turns out to be intended as visible geometry.
    else if (o.isMesh && n.startsWith('collision_')) o.visible = false;
  });

  const origin = new THREE.Vector3();
  if (contacts.length) {
    for (const c of contacts) origin.add(c);
    origin.divideScalar(contacts.length);
  } else {
    console.warn(`[assets] vehicle ${key}: no ref_contact_* empties — falling back to the bounding box`);
    new THREE.Box3().setFromObject(scene).getCenter(origin);
  }

  if (wheels.length) {
    const b = new THREE.Box3(), acc = new THREE.Box3();
    acc.makeEmpty();
    for (const w of wheels) {
      w.geometry.computeBoundingBox();
      acc.union(b.copy(w.geometry.boundingBox).applyMatrix4(w.matrixWorld));
    }
    origin.y = acc.min.y;
  } else {
    console.warn(`[assets] vehicle ${key}: no wheel_* meshes — grounding on the contact empties`);
  }

  // Two nested groups, and the nesting matters: the inner one carries the
  // facing correction, so the wrapper's rotation.y stays a plain world yaw that
  // callers can read and write without knowing anything about how the GLB was
  // authored.
  const inner = new THREE.Group();
  scene.position.sub(origin);
  inner.add(scene);
  inner.rotation.y = FORWARD_YAW[def.forward] ?? 0;
  if (!(def.forward in FORWARD_YAW)) {
    console.warn(`[assets] vehicle ${key}: unknown forward "${def.forward}" — leaving it as authored`);
  }
  const wrapper = new THREE.Group();
  wrapper.add(inner);

  const size = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3());
  console.log(`[assets] vehicle ${key}: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m `
    + `(W x H x L), ${contacts.length} contact refs, ${wheels.length} wheels`);
  return wrapper;
}


export async function loadAssets(onProgress) {
  const out = { characters: {}, clips: {}, clipHipsRest: {}, audio: {}, weaponModels: {}, props: {}, vehicles: {} };
  const jobs = [];
  let done = 0;
  const total =
    Object.keys(ASSET_PATHS.characters).length + Object.keys(WEAPONS).length +
    Object.keys(ASSET_PATHS.props || {}).length +
    Object.keys(ASSET_PATHS.vehicles || {}).length +
    Object.keys(ASSET_PATHS.animations).length +
    Object.keys(ASSET_PATHS.audio).length;

  const tick = (label) => { done++; onProgress?.(done / total, label); };

  // Characters ------------------------------------------------------------
  // Straight off ASSET_PATHS — a new body needs no edit here.
  for (const [key, def] of Object.entries(ASSET_PATHS.characters)) {
    jobs.push(loadGLB(def.url).then((gltf) => {
      const template = normalizeCharacter(gltf.scene, def.height);
      const boneMap = collectBones(template);
      out.characters[key] = { key, template, boneMap, height: def.height };
      tick(key);
    }).catch((e) => { console.warn(`Failed character ${def.url}`, e); tick(key); }));
  }

  // Weapons ---------------------------------------------------------------
  // `mounted` defs have no GLB of their own — their geometry is part of the
  // vehicle they are bolted to. They are still real weapon defs everywhere else
  // (combat, tracers, audio); they just have nothing to load or to hold.
  for (const [key, def] of Object.entries(WEAPONS)) {
    if (def.mounted) { tick(key); continue; }
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

  // Props -----------------------------------------------------------------
  // Same normalize-to-`len` treatment the weapons get, and for the same reason:
  // an authored GLB's scale is whatever the artist's scene was in, and the frag
  // ships at 0.26 m on its longest axis. Centred on its own origin so a pooled
  // copy can just have its position set.
  for (const [key, def] of Object.entries(ASSET_PATHS.props || {})) {
    jobs.push(loadGLB(def.url).then((gltf) => {
      const scene = gltf.scene;
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const s = def.len / (Math.max(size.x, size.y, size.z) || 1);
      const wrapper = new THREE.Group();
      scene.scale.setScalar(s);
      scene.position.sub(box.getCenter(new THREE.Vector3()).multiplyScalar(s));
      wrapper.add(scene);
      wrapper.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      out.props[key] = wrapper;
      tick(key);
    }).catch((e) => { console.warn(`Failed prop ${def.url}`, e); tick(key); }));
  }

  // Vehicles --------------------------------------------------------------
  // The one asset class that keeps its authored scale — see prepareVehicle.
  for (const [key, def] of Object.entries(ASSET_PATHS.vehicles || {})) {
    jobs.push(loadGLB(def.url).then((gltf) => {
      out.vehicles[key] = prepareVehicle(key, gltf.scene, def);
      tick(key);
    }).catch((e) => { console.warn(`Failed vehicle ${def.url}`, e); tick(key); }));
  }

  // Animations ------------------------------------------------------------
  // An entry is either a plain URL or `{ url, clip }`. The named form exists
  // because a Blender glTF export carries every action still loaded in the
  // .blend, not just the one the file is named after — so animations[0] can
  // easily be the wrong motion (strafe-left files that open on the backpedal).
  // Naming the clip makes the pick explicit instead of order-dependent.
  for (const [key, entry] of Object.entries(ASSET_PATHS.animations)) {
    const url = typeof entry === 'string' ? entry : entry.url;
    const want = typeof entry === 'string' ? null : entry.clip;
    jobs.push(loadGLB(url).then((gltf) => {
      const clips = (gltf.animations) || [];
      let clip = clips[0];
      if (want) {
        const named = clips.find((c) => c.name === want);
        if (named) clip = named;
        else console.warn(`[assets] clip "${want}" not in ${url} — has [${clips.map((c) => c.name).join(', ')}], falling back to first`);
      }
      if (clip) out.clips[key] = clip;
      else console.warn(`No animation found in ${url}`);
      // The source rig's rest hips translation — the reference the hips track is
      // scaled against. It lives in the GLB's node hierarchy, which is otherwise
      // thrown away here since only the clip is kept.
      if (gltf.scene) {
        gltf.scene.traverse((o) => {
          if (!out.clipHipsRest[key] && canonicalBoneName(o.name || '') === 'hips') {
            out.clipHipsRest[key] = [o.position.x, o.position.y, o.position.z];
          }
        });
      }
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
  // The pose tracks are cached by bone-name signature rather than per character,
  // so N marines off one Mixamo rig pay for the ~50-track bulk once and share
  // the arrays; only the single hips track is rebuilt against each character's
  // own bind pose. Tracks are immutable data and every soldier owns its own
  // AnimationMixer, so sharing costs nothing at playback.
  const poseCache = new Map(); // `${signature}|${animKey}` -> Track[]
  for (const charKey of Object.keys(out.characters)) {
    const ch = out.characters[charKey];
    ch.clips = {};
    const sig = boneNameSignature(ch.boneMap);
    let shared = 0;
    for (const [animKey, clip] of Object.entries(out.clips)) {
      const ck = `${sig}|${animKey}`;
      let pose = poseCache.get(ck);
      if (pose) shared++;
      else poseCache.set(ck, (pose = retargetPoseTracks(clip, ch.boneMap)));
      const hipsTrack = retargetHipsTrack(clip, ch.boneMap, out.clipHipsRest[animKey]);
      const tracks = hipsTrack ? [...pose, hipsTrack] : pose.slice();
      if (tracks.length >= 8) ch.clips[animKey] = new THREE.AnimationClip(clip.name, clip.duration, tracks);
      else console.warn(`Retarget produced only ${tracks.length} tracks for ${charKey}/${animKey} — skeleton mismatch?`);
    }
    console.log(`[assets] ${charKey}: ${ch.boneMap.size} bones, `
      + `${shared ? `${shared} clips share pose tracks with an identical rig, ` : ''}`
      + `clips: ${Object.keys(ch.clips).join(', ')}`);
  }

  return out;
}
