# Frontline Command — 32v32 Halo-themed combined-arms prototype

Three.js (r170) + Vite. Player + 31 AI vs 32 AI, sector control, class loadouts,
deploy-map hub.

Design docs — all aspirational; build incrementally, owner approves each step
(propose first when asked "give suggestion / read only"):

- `GAME_DESIGN_PLAN.md` — the whole game. Parent doc.
- `CLASS_AND_GADGET_PLAN.md` — what a soldier is and carries: classes, perks,
  loadout slots, gadgets, construction, downed state.
- `GAME_TYPE_PLAN.md` — what the match is: objectives, spawning, economy, victory.
  Locks the Battlefield-chassis / Squad-structure call, and splits the modes into
  two economies (Sector Control spends lives, Frontline accrues territory).
- `VEHICLE_PLAN.md` — what a vehicle is: raycast-suspension physics, seats, crew,
  bot driving. Built around the Warthog. Its "what is already true" and "rig
  contract" sections are MEASURED (scale, -X forward, the ±90° steer trap) —
  read them before touching `vehicle.js` or a vehicle GLB.

Each carries **Locked / Working / Open / Long-term** labels per decision — check
the label before treating anything in them as a requirement.

## Run / debug

- Dev server: `npm run dev` → **port 5199** (5173 is taken). Test range: `/chartest.html`.
- `POST /__save?name=X[&dir=…&ext=…]` (dev plugin in `vite.config.js`) writes a data-URL
  body to `debug/X.jpg` — used for headless screenshot verification. Read the file back
  to inspect renders.
- Debug handle in console: `window.FC` → `{ game, deploy, renderer, launchMap(id) }`.
  `FC.launchMap('demo'|'map3')` skips menus (auto-picks UNSC).
- Screenshot procedure: **pause or don't call `game.update()` after positioning the
  camera** — `player.update` owns/resets the camera every frame.
- Sim can be fast-forwarded: `game.setTimeScale(8)` + a loop of `game.update(1/60)`.
- `requestAnimationFrame` freezes when the browser pane isn't composited — for headless
  chartest driving use `window.__ctFrame(dt)`.

## Source layout (src/)

- `config.js` — ALL tuning: `CFG`, `WEAPONS` (per-weapon `ai`, `grip`, `fp`, `tracer`
  blocks), `PRIMARIES`, `CLASSES`, `GADGETS`, `GAME_TYPES`, `MAPS`, `FP_DEFAULT`,
  `ASSET_PATHS`. Prefer adding knobs here over hardcoding.
- `main.js` — boot, session object (owns `playerLoadout` + `menuOpen`), screen flow:
  title → lobby → team select → deploy. GPU prewarm (`prewarmWeapons`) runs at match
  setup so first renders don't hitch.
- `game.js` — match state, teams, tickets, deploy/respawn, win check.
- `soldier.js` — AI soldier entity. Weapon mounts: scale-compensated holders on bones
  (`GRIP` global + per-weapon `WEAPONS[k].grip`; stowed gun on spine via per-character
  `BACK`). Both guns pre-cloned at spawn — switching only re-parents (never clone
  mid-fight, it hitches).
- `player.js` — FPS controller, viewmodel (per-weapon `fp` offset), muzzle flash +
  light, ammo-counter hookup.
- `combat.js` — hitscan, pooled tracers (moving "bolt" / static fading "vapor"/"beam"
  styles per `WEAPONS[k].tracer`), rockets, sparks. **Never pass a module-level scratch
  Vector3 into a function that also writes it** (historic all-bullets-miss bug).
- `ammodisplay.js` — drives gun ammo counters from the `numbers_atlas` convention (below).
- `world.js` / `maps.js` / `collision.js` — procedural demo map vs GLB maps; heightfield
  GPU bake; three-mesh-bvh floor/wall collision.
- `deploy.js` — deploy-map hub (own header/UI, edge-outline post shader, world-space
  tactical grid, helmet-cam PiP). `hud.js` — FPS chrome, hidden in map mode.
- `lobby.js`, `menu.js` (armory), `hud.js`, `assets.js` (loading + Mixamo retarget),
  `chartest.js` (tuning range page).

## Asset kit & authoring conventions (owner authors in Blender; code follows names)

- Two asset trees. `source/` is the **local master kit** — everything the owner has
  ever exported, ~1.9 GB, **excluded from git**. `public/` is the Vite publicDir
  (served at `/UNSC/...`, `/animations/...`, `/Maps/...`), holds **only what the code
  actually references**, compressed, and **is what ships**. Owner has a live Blender
  bridge (BlenderMCP, TCP port 9876); Blender 5.2 at
  `G:\Steam\steamapps\common\Blender`.
- **After exporting anything from Blender, run `npm run assets`** (= `assets:sync`
  then `assets:compress`). Sync copies referenced files `source/` → `public/` and
  lists what nothing loads; compress re-encodes textures to WebP (cap 2048px) and
  quantizes geometry, in place and idempotently. Skipping this re-inflates the repo —
  raw map exports run 100-235 MB each, and **GitHub rejects any file over 100 MB**.
  - Both transforms ride on extensions three r170 decodes natively
    (`EXT_texture_webp`, `KHR_mesh_quantization`), so no loader/decoder wiring.
  - `tools/compress-assets.mjs` deliberately does **not** use flatten / join /
    instance / prune / dedup: the game resolves objects by name, and those passes
    drop or merge the marker empties below. Every file is gated on a before/after
    name diff and reverted if any name is lost. Keep it that way.
  - Compression is lossy on textures. `source/` is the master you re-derive from —
    never compress `source/` in place, and never point publicDir back at it.
- **Adding a character body** is two edits: one `ASSET_PATHS.characters` entry
  (`key: { url, height }`) plus the `model:` field on the class that wears it.
  `assets.js` walks that map — no loader list to keep in sync. Also add a `BACK`
  entry in `soldier.js` (falls back to `BACK.marine`); `/chartest.html` picks the
  new rig up automatically and seeds one to tune. Retargeted pose tracks are
  cached by bone-name signature, so marine variants off one rig cost a download,
  not a retarget — the per-character bind pose still drives its own hips track.
- Characters are Mixamo-rigged. Retarget strips `mixamorig[:_]` prefixes, drops scale
  tracks, hips-Y-only position. Height must be measured via per-SkinnedMesh
  `computeBoundingBox` union (bind matrices can carry ~100x scale; `Box3.setFromObject`
  lies). Feet grounding: sample toe/foot BONE positions across the clip — skinned bbox
  reports phantom lows ~25 cm below visible boots.
- PBR needs `scene.environment` (RoomEnvironment PMREM) or armor renders black.
- GLB maps: `FC_HQ_BLUE/RED`, `FC_SECTOR_A..`, `FC_VEHICLE_*` marker empties define
  scale/center/bounds — never trust the GLB bbox (sky inflates it). Sky nodes:
  `rotate_*` spin, `move_*` drift +X; `ring|sky|cloud|rotate_|move_` excluded from
  height bake. Collision: `Collision_floor_parent` (down-raycast grounding, tunnels OK),
  `Collision_wall_parent` (XZ push-out), `Collision_cover_parent` (cover AABBs). These
  RENDER as authored — never hide them in code.
- Lobby stage: `source/other/lobby_stage.glb`, markers `FC_CHAR`/`FC_CAM`/
  `FC_PROP_VEHICLE` drive position AND rotation.
- **Ammo counters** (`numbers_atlas` convention): a material named `numbers_atlas`
  holding a 10-cell horizontal 0-9 digit strip + quad meshes named `*ones*` / `*tens*`
  UV'd to any one cell. `ammodisplay.js` clones material+texture per quad and slides
  `offset.x` by `(digit - homeCell)/10`. AI clones must call `restoreBakedDisplays()`
  after cloning so they keep the baked look.
- Weapon icons: `*_icon.svg` line art in each weapon folder (recolored cyan in UI).

## Tuning workflow

- `/chartest.html` — the tuning range: BACK tab (stowed-gun transform per character →
  paste into `BACK` in soldier.js), GRIP tab (per-weapon hand grip → `WEAPONS[k].grip`),
  VIEWMODEL tab (first-person offsets → `WEAPONS[k].fp`; FPS controls: click to lock,
  WASD, LMB fire). Values transfer 1:1 into config.
- Owner hand-tunes values and pastes blocks back; build tuning UIs rather than
  guessing numbers.

## Workflow expectations

- Verify visually via the screenshot loop after render-affecting changes; verify sim
  changes by scripted fast-forward battles.
- Commit when a feature works (owner may need a nudge). PowerShell: avoid embedded
  double quotes in commit messages (native arg splitting mangles them).
- Vite HMR fully reloads the page on edits to entry-adjacent modules; re-run
  `FC.launchMap(...)` after reloads before testing.
