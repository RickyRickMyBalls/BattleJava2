// Compress the GLBs in public/ in place.
//
//   npm run assets:compress                 compress anything not already done
//   npm run assets:compress -- --force      redo everything (after changing --cap)
//   npm run assets:compress -- --cap 1024   lower the texture resolution ceiling
//   npm run assets:compress -- --dry        report what would change, touch nothing
//
// Two transforms, both riding on glTF extensions three r170 decodes natively,
// so no loader or decoder wiring is needed:
//   textureCompress  PNG/JPEG -> WebP, capped resolution   (EXT_texture_webp)
//   quantize         float32 vertex attrs -> ints          (KHR_mesh_quantization)
//
// Deliberately NOT used: flatten, join, instance, prune, dedup. The game
// resolves objects BY NAME - FC_HQ_*/FC_SECTOR_*/FC_VEHICLE_* map markers,
// Collision_{floor,wall,cover}_parent, vehicle ref_sus_arm_*, sky rotate_*/
// move_*, and the numbers_atlas + *ones*/*tens* ammo quads. Those passes merge
// or drop nodes and would break map bounds, collision and the HUD silently.
// Every file is gated on a before/after name diff and reverted if any is lost.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, quantize } from '@gltf-transform/functions';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIP = path.join(ROOT, 'public');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : Number(argv[i + 1]); };
const FORCE = argv.includes('--force');
const DRY = argv.includes('--dry');
const CAP = flag('--cap', 2048);
const QUALITY = flag('--quality', 90);

// Animation clips are pure keyframe data with no textures - nothing to win,
// and quantizing them risks the retarget pipeline. Left alone.
const LEAVE_ALONE = /^animations\//;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const MB = (b) => (b / 1048576).toFixed(1);

if (!fs.existsSync(SHIP)) {
  console.error('public/ not found - run `npm run assets:sync` first.');
  process.exit(1);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    // .tmp.glb is our own half-written scratch file - never treat it as input
    else if (/\.glb$/i.test(e.name) && !/\.tmp\.glb$/i.test(e.name)) files.push(p);
  }
})(SHIP);

// Every name the game might look up, compared before/after as a hard gate.
const names = (doc) => {
  const r = doc.getRoot();
  const g = (l) => l.map((x) => x.getName()).filter(Boolean).sort();
  return {
    nodes: g(r.listNodes()), meshes: g(r.listMeshes()), materials: g(r.listMaterials()),
    skins: g(r.listSkins()), animations: g(r.listAnimations()),
  };
};
const lost = (a, b) => Object.keys(a)
  .map((k) => { const m = a[k].filter((n) => !b[k].includes(n)); return m.length ? `${k}: ${m.slice(0, 5).join(', ')}` : null; })
  .filter(Boolean);

// Already compressed? Quantized geometry and every texture already WebP.
const isDone = (doc) => {
  const quantized = doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_mesh_quantization');
  const texes = doc.getRoot().listTextures();
  const allWebp = texes.length === 0 || texes.every((t) => t.getMimeType() === 'image/webp');
  return quantized && allWebp;
};

let before = 0, after = 0, done = 0, already = 0;
const flagged = [];

for (const f of files) {
  const rel = path.relative(SHIP, f).replace(/\\/g, '/');
  const size = fs.statSync(f).size;
  before += size;

  if (LEAVE_ALONE.test(rel)) { after += size; continue; }

  try {
    const doc = await io.read(f);
    if (!FORCE && isDone(doc)) { after += size; already++; continue; }

    const nBefore = names(doc);
    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [CAP, CAP], resizeFilter: 'lanczos3', quality: QUALITY }),
      quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8, quantizeWeight: 8 }),
    );

    const missing = lost(nBefore, names(doc));
    if (missing.length) {
      after += size;
      flagged.push(`${rel}: would lose names -> ${missing.join(' | ')}`);
      continue;
    }

    // Write beside the target, then swap. A partial write never replaces a good
    // file, and a per-file rename dodges the directory locks that a whole-folder
    // swap hits while a dev server is running.
    //
    // The temp name MUST still end in .glb - NodeIO picks its container from the
    // extension, so a ".glb.tmp" target silently writes JSON glTF and spills the
    // textures and buffers out as sidecar files.
    const tmp = f.replace(/\.glb$/i, '.tmp.glb');
    await io.write(tmp, doc);
    const newSize = fs.statSync(tmp).size;

    if (newSize >= size) { fs.rmSync(tmp); after += size; console.log(`  = ${rel} (no gain, kept)`); continue; }
    if (DRY) { fs.rmSync(tmp); after += newSize; console.log(`  ~ ${rel}  ${MB(size)} -> ${MB(newSize)} MB  (dry run)`); done++; continue; }

    fs.rmSync(f);
    fs.renameSync(tmp, f);
    after += newSize; done++;
    console.log(`  ${MB(size).padStart(7)} -> ${MB(newSize).padStart(6)} MB  ${(100 - newSize / size * 100).toFixed(0).padStart(3)}%  ${rel}`);
  } catch (err) {
    after += size;
    flagged.push(`${rel}: ${err.message.slice(0, 120)}`);
    try { fs.rmSync(f.replace(/\.glb$/i, '.tmp.glb')); } catch {}
  }
}

console.log(`\n${done} compressed` + (already ? `, ${already} already done` : '') +
  `\n${MB(before)} MB -> ${MB(after)} MB` +
  (before > after ? `  (${(100 - after / before * 100).toFixed(0)}% smaller)` : ''));

if (flagged.length) {
  console.log(`\nLEFT UNCHANGED (${flagged.length}) - originals kept:`);
  flagged.forEach((m) => console.log(`  ! ${m}`));
}

// GitHub hard-rejects >100 MB and warns >50 MB.
const big = files.filter(fs.existsSync).map((f) => [path.relative(SHIP, f).replace(/\\/g, '/'), fs.statSync(f).size])
  .filter(([, s]) => s > 50 * 1048576).sort((a, b) => b[1] - a[1]);
if (big.length) {
  console.log('\nLarge files - GitHub warns above 50 MB and REJECTS above 100 MB:');
  for (const [r, s] of big) console.log(`  ${s > 100 * 1048576 ? '!!' : ' !'} ${MB(s)} MB  ${r}`);
}
