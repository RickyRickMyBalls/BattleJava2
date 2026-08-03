// Copy the assets the game actually references from the source/ master kit
// into public/ (the Vite publicDir, and the only asset tree that ships).
//
//   npm run assets:sync            copy referenced assets, report what is unused
//   npm run assets:sync -- --prune also delete files in public/ nothing references
//
// source/ is never modified. Re-run this after exporting anything from Blender,
// then `npm run assets:compress`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MASTER = path.join(ROOT, 'source');
const SHIP = path.join(ROOT, 'public');
const PRUNE = process.argv.includes('--prune');
const EXT = /\.(glb|gltf|png|jpe?g|svg|wav|mp3|ogg|hdr|exr|ktx2|bin|webp)$/i;
const SKIP_DIRS = /^(node_modules|dist|debug|\.git|source|public|tools)$/;

if (!fs.existsSync(MASTER)) {
  console.error(`source/ not found at ${MASTER}.\nIt is the untracked local master kit - nothing to sync from.`);
  process.exit(1);
}

// --- 1. every asset path referenced from code -------------------------------
const code = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) walk(path.join(d, e.name)); }
    else if (/\.(js|html|css)$/.test(e.name)) code.push(path.join(d, e.name));
  }
})(ROOT);

const refs = new Map(); // normalised path -> first "file:line" that wants it
const RE = /['"`]([^'"`\n]*?\.(?:glb|gltf|png|jpe?g|svg|wav|mp3|ogg|hdr|exr|ktx2|bin|webp))['"`]/gi;
for (const f of code) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    let m; RE.lastIndex = 0;
    while ((m = RE.exec(line))) {
      let p = m[1];
      if (/^(https?:|data:|blob:)/.test(p)) continue;
      // drop a ${import.meta.env.BASE_URL} head, leading ./ or /, and a source/
      // or public/ prefix (prose comments spell paths either way)
      p = p.replace(/^\$\{[^}]*\}/, '').replace(/^\.?\//, '').replace(/^(source|public)\//, '');
      if (!p || !EXT.test(p)) continue;
      const rel = path.normalize(p).replace(/\\/g, '/');
      if (!refs.has(rel)) refs.set(rel, `${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}`);
    }
  });
}

// --- 2. inventory the master kit -------------------------------------------
const master = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else master.push(path.relative(MASTER, p).replace(/\\/g, '/'));
  }
})(MASTER);
// Authoring casing is inconsistent on Windows; match case-insensitively but
// always write the name as it exists on disk.
const byLower = new Map(master.map((m) => [m.toLowerCase(), m]));

// --- 3. copy ----------------------------------------------------------------
const MB = (b) => (b / 1048576).toFixed(1);
const wanted = new Set();
let copied = 0, skipped = 0, bytes = 0;
const missing = [];

for (const [rel, where] of [...refs].sort()) {
  const actual = byLower.get(rel.toLowerCase());
  if (!actual) { missing.push([rel, where]); continue; }
  wanted.add(actual);
  const from = path.join(MASTER, actual);
  const to = path.join(SHIP, actual);
  const src = fs.statSync(from);
  // Only copy when public/ is absent or older. Never clobber a compressed file
  // with its bigger master unless the master is genuinely newer.
  if (fs.existsSync(to) && fs.statSync(to).mtimeMs >= src.mtimeMs) { skipped++; continue; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++; bytes += src.size;
  console.log(`  + ${actual}  (${MB(src.size)} MB)`);
}

console.log(`\ncopied ${copied} file(s), ${MB(bytes)} MB` +
  (skipped ? `; ${skipped} already current` : ''));

if (missing.length) {
  console.log(`\nREFERENCED BUT MISSING from source/ (${missing.length}) - these will 404:`);
  for (const [rel, where] of missing) console.log(`  ! ${rel}   <- ${where}`);
}

// --- 4. stale files sitting in public/ --------------------------------------
const shipped = [];
if (fs.existsSync(SHIP)) (function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else shipped.push(path.relative(SHIP, p).replace(/\\/g, '/'));
  }
})(SHIP);

const wantedLower = new Set([...wanted].map((w) => w.toLowerCase()));
const stale = shipped.filter((s) => !wantedLower.has(s.toLowerCase()));
if (stale.length) {
  const staleBytes = stale.reduce((a, s) => a + fs.statSync(path.join(SHIP, s)).size, 0);
  if (PRUNE) {
    for (const s of stale) { fs.rmSync(path.join(SHIP, s)); console.log(`  - ${s}`); }
    console.log(`\npruned ${stale.length} unreferenced file(s), ${MB(staleBytes)} MB`);
  } else {
    console.log(`\nIn public/ but referenced by nothing (${stale.length}, ${MB(staleBytes)} MB).` +
      `\nRe-run with --prune to delete them:`);
    for (const s of stale.slice(0, 15)) console.log(`  ? ${s}`);
    if (stale.length > 15) console.log(`  ... and ${stale.length - 15} more`);
  }
}

// --- 5. how much of the master kit is dead weight ---------------------------
const unusedMaster = master.filter((m) => !wantedLower.has(m.toLowerCase()));
if (unusedMaster.length) {
  const b = unusedMaster.reduce((a, m) => a + fs.statSync(path.join(MASTER, m)).size, 0);
  console.log(`\nsource/ holds ${unusedMaster.length} file(s) the game never loads (${MB(b)} MB) - not copied.`);
}
