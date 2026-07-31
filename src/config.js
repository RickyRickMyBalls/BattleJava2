// Central tuning constants for the 32v32 prototype.

export const TEAM = { BLUE: 0, RED: 1 };

export const CFG = {
  teamSize: 32,
  squadSize: 4,

  map: { w: 900, d: 560 },   // world extents: x in [-450,450], z in [-280,280]

  hq: [
    { team: TEAM.BLUE, x: -410, z: 0 },
    { team: TEAM.RED, x: 410, z: 0 },
  ],

  sectors: [
    { id: 'A', x: -250, z: -70, r: 32 },
    { id: 'B', x: -125, z: 105, r: 32 },
    { id: 'C', x: 0, z: -30, r: 36 },
    { id: 'D', x: 125, z: 120, r: 32 },
    { id: 'E', x: 250, z: -60, r: 32 },
  ],

  tickets: 400,
  bleedInterval: 3,      // seconds between bleed applications
  captureRate: 14,       // capture points/sec per net attacker (progress 0..100)
  headshotMult: 1.6,
  gravity: 18,           // world constant: anything that falls, and every jump

  soldier: {
    shield: 45,
    health: 55,
    shieldRegenDelay: 4.5,
    shieldRegenRate: 12,
    runSpeed: 6.2,
    walkSpeed: 3.4,
    // Jump is authored as a HEIGHT IN METRES — the single number to tune. Every
    // other jump quantity is derived from it and CFG.gravity: takeoff velocity
    // is sqrt(2*g*h), airtime is 2*v/g, and the jump clip is stretched to span
    // that airtime. Per-class overrides live on CLASSES; this is the default,
    // and it applies to every soldier, AI included.
    jumpHeight: 1.17,
    respawnDelay: 6,
  },

  player: {
    eyeHeight: 1.78,
    crouchEye: 1.15,
    speed: 6.4,
    sprintMult: 1.5,
    // Hold to walk (Ctrl). Must land the player under the 4 m/s run threshold
    // in soldier._locomotionAnim, or the walk clips are unreachable: 6.4 * 0.5
    // = 3.2, which is also close to the AI's own 3.4 walk speed.
    walkMult: 0.5,
    crouchMult: 0.55,
    respawnDelay: 5,
    // Third-person view (O). A debug/observation camera for watching the body
    // animate — firing is suppressed while it is on, so these are presentation
    // only. `dist` is the boom length behind the eye, `shoulder` offsets it to
    // the right so the body does not sit dead centre, `lift` raises the pivot,
    // and `minDist` is how close the boom may be pulled in when a wall is in
    // the way before the camera would end up inside the character.
    thirdPerson: {
      dist: 3.2,
      shoulder: 0.75,
      lift: 0.15,
      minDist: 0.8,
      skin: 0.25,          // keep the camera off the wall it collided with
      lerp: 12,            // boom ease, per second
    },
  },

  // Walking around the lobby stage (TAB). Movement itself is deliberately NOT
  // tuned here — roam reuses the real Player, so it reads CFG.player.speed,
  // eyeHeight and the rest. These are only the transition and presentation.
  // The hangar preview character. He holds a relaxed rifle idle and glances
  // around now and then, rather than sighting down the weapon the whole time
  // the player is picking a loadout.
  lobbyIdle: {
    // Seconds of calm idle between glances. The lookaround clip is itself ~10 s,
    // so these want to be comfortably longer than it or he spends half his time
    // looking around rather than occasionally.
    lookEveryMin: 16,
    lookEveryMax: 34,
    fade: 0.6,             // crossfade; both poses are near-identical at the
  },                       // hips, so a quick cut reads as a twitch

  lobbyRoam: {
    enterTime: 1.0,        // seconds: camera flight from the lobby pose into first person
    exitTime: 0.7,         // and back out
    fov: 75,               // matches the in-game FPS fov (lobby portrait fov is 35)
    fovHold: 0.55,         // fraction of the flight before the fov starts widening
    // Bezier control point, relative to the character: the camera swings behind
    // one shoulder instead of pushing straight through the chest.
    arc: { back: 2.4, side: 1.8, up: 0.8 },
    hideCharAt: 0.8,       // t at which the preview body is hidden (camera is inside it)
    showCharAt: 0.3,       // t on the way out at which it comes back
    fogFar: 120,           // stage fog is tuned tight for the portrait framing
  },

  // Scope screens re-render the world from a second camera. Optics are per
  // weapon (WEAPONS[k].scope); this is the cost policy.
  //
  // Narrowing the fov does NOT reduce cost on its own: three sets
  // frustumCulled = false on every SkinnedMesh, and assets.js does the same for
  // weapons and characters, so all 64 soldiers draw whichever way the scope
  // points. The cull below is done by hand for exactly that reason.
  scopeRender: {
    everyNFrames: 2,   // ~30Hz on the glass; imperceptible, halves the cost
    cullRadius: 2.2,   // soldier bounding sphere for the manual frustum test
  },

  // One of each weapon, laid out in the hangar for the firing range. Placement
  // prefers authored FC_WEAPON_<KEY> empties; these only drive the fallback
  // layout and the pickup feel.
  armoryRack: {
    autoDistance: 4.5,   // metres behind the character when no markers exist
    spacing: 0.85,       // gap between guns in the fallback row
    height: 1.05,        // rack height off the floor
    radius: 2.6,         // how close you must be to take one
    minDot: 0.55,        // ...and how directly you must be looking at it
    highlightLift: 0.08, // the targeted gun rises and turns; no material or
    highlightSpin: 1.2,  // light changes, both of which would cost a recompile
  },

  ai: {
    spreadPerMeter: 0.00012,
    damageScale: 0.85,      // AI bullets hit a bit softer, keeps TTK fair at 32v32
    thinkInterval: 0.4,
    squadReplanInterval: 8,
  },

  // Team-wide class rotation (squads end up with varied mixes; ~1 in 5 is a Spartan)
  squadComposition: ['spartan', 'assault', 'engineer', 'recon', 'support'],

  colors: {
    blue: 0x3aa0ff,
    red: 0xff5a4d,
    blueDim: 0x1d5f9e,
    redDim: 0x99342c,
  },
};

// ---------------------------------------------------------------------------
// Weapons. `ai` block: range/aiMin define the usable band for AI weapon choice;
// burst/interval/pause drive the AI trigger discipline; spread is base aim error.
// falloff: [start, end, farFraction-of-damage].
// ---------------------------------------------------------------------------
export const WEAPONS = {
  ar: {
    name: 'MA5 ASSAULT RIFLE', model: '/UNSC/weapons/assault rifle/assault-rifle.glb', len: 0.85,
    icon: '/UNSC/weapons/assault rifle/Assault-Rifle-line.svg',
    grip: { pos: [0.08, 0.25, 0.02], rot: [-1.75, -0.2, -1.57] },
    mode: 'auto', rpm: 620, dmg: 8.5, mag: 60, reserve: 240, reload: 2.3,
    spreadHip: 0.028, spreadAds: 0.007, adsFov: 55,
    ads: { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [35, 150, 0.47], range: 320,
    tracer: { style: 'bolt', color: [1, 0.85, 0.5], len: 2, speed: 420, every: 2, opacity: 0.25 },
    snd: { key: 'shot', rate: 1.05, vol: 0.5 },
    ai: { aiMin: 0, range: 160, burst: [3, 6], interval: 0.11, pause: [0.35, 0.95], spread: 0.008 },
  },
  br: {
    name: 'BR55 BATTLE RIFLE', model: '/UNSC/weapons/battle-rifle/battle-rifle.glb', len: 0.95,
    icon: '/UNSC/weapons/battle-rifle/Battle-Rifle_Icon.svg',
    grip: { pos: [0.04, 0.29, 0.02], rot: [-1.5, -0.2, -1.5] },
    fp: { pos: [0.15, 0.11, -0.31], rot: [0, 0, 0] },
    mode: 'burst', burst: 3, burstInterval: 0.06, rpm: 270, dmg: 11, mag: 36, reserve: 288, reload: 2.4,
    spreadHip: 0.014, spreadAds: 0.004, adsFov: 25,
    ads: { pos: [0.145, -0.235, -0.43], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [60, 230, 0.55], range: 420,
    tracer: { style: 'bolt', color: [0.7, 0.9, 1], len: 5, speed: 500, opacity: 0.5 },
    snd: { key: 'shot', rate: 1.0, vol: 0.5 },
    ai: { aiMin: 0, range: 210, burst: [3, 3], interval: 0.06, pause: [0.55, 1.1], spread: 0.006 },
  },
  smg: {
    name: 'M7 SMG', model: '/UNSC/weapons/SMG/SMG.glb', len: 0.62,
    icon: '/UNSC/weapons/SMG/SMG_icon.svg',
    grip: { pos: [-0.03, 0.28, 0.02], rot: [-1.57, -0.2, -1.5] },
    mode: 'auto', rpm: 900, dmg: 6, mag: 60, reserve: 360, reload: 2.1,
    spreadHip: 0.042, spreadAds: 0.018, adsFov: 60,
    ads: { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [20, 80, 0.35], range: 200,
    tracer: { style: 'bolt', color: [1, 0.8, 0.45], len: 2.8, speed: 380, every: 2, opacity: 0.5 },
    snd: { key: 'shot', rate: 1.35, vol: 0.35 },
    ai: { aiMin: 0, range: 75, burst: [5, 9], interval: 0.067, pause: [0.3, 0.7], spread: 0.014 },
  },
  shotgun: {
    name: 'M90 SHOTGUN', model: '/UNSC/weapons/Shotgun/Shotgun_2.1.glb', len: 0.95,
    icon: '/UNSC/weapons/Shotgun/Shotgun_icon.svg',
    mode: 'pump', rpm: 62, dmg: 6.5, pellets: 8, pelletSpread: 0.045, mag: 8, reserve: 40, reload: 3.0,
    grip: { pos: [0.03, 0.38, 0], rot: [-1.57, -0.25, -1.5] },
    fp: { pos: [0.2, 0.07, -0.36], rot: [0, 0, 0] },
    spreadHip: 0.01, spreadAds: 0.006, adsFov: 60,
    ads: { pos: [0.2, -0.195, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [12, 42, 0.2], range: 90,
    tracer: { style: 'bolt', color: [1, 0.7, 0.4], len: 1.6, speed: 300, every: 3, opacity: 0.5 }, // per pellet -> keep sparse
    snd: { key: 'shot', rate: 0.62, vol: 0.75 },
    ai: { aiMin: 0, range: 32, burst: [1, 1], interval: 1.0, pause: [0.9, 1.5], spread: 0.012 },
  },
  dmr: {
    name: 'M392 DMR', model: '/UNSC/weapons/DMR/DMR.glb', len: 1.0,
    icon: '/UNSC/weapons/DMR/DMR_icon.svg',
    grip: { pos: [0.08, 0.33, 0.02], rot: [-1.57, -0.15, -1.5] },
    fp: { pos: [0.18, 0.12, -0.23], rot: [0, 0, 0] },
    mode: 'semi', rpm: 260, dmg: 20, mag: 15, reserve: 135, reload: 2.4,
    spreadHip: 0.012, spreadAds: 0.0025, adsFov: 15,
    ads: { pos: [0.171, -0.231, -0.43], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [80, 300, 0.6], range: 500,
    tracer: { style: 'bolt', color: [0.75, 0.92, 1], len: 5.5, speed: 520, opacity: 0.5 },
    snd: { key: 'dmrShot', rate: 1.0, vol: 0.55 },
    ai: { aiMin: 40, range: 260, burst: [1, 2], interval: 0.4, pause: [0.9, 1.6], spread: 0.006 },
  },
  sniper: {
    name: 'SRS99 SNIPER', model: '/UNSC/weapons/sniper/sniper.glb', len: 1.35,
    icon: '/UNSC/weapons/sniper/Sniper_icon.svg',
    grip: { pos: [0.08, 0.45, 0.02], rot: [-1.5, -0.25, -1.5] },
    fp: { pos: [0.15, 0.1, 0.02], rot: [0, 0, 0] },
    // Live scope screen. `material` is matched case-insensitively against the
    // authored material name. The camera sits at that mesh and is boresighted
    // to the crosshair (see scopedisplay.js), so pos/rot are nudges from that
    // — both zero is already correct. fov IS the magnification.
    scope: { material: 'sniper_screen', fov: 5, pos: [0, 0, 0], rot: [0, 0, 0], size: 256 },
    mode: 'semi', rpm: 46, dmg: 80, mag: 4, reserve: 20, reload: 3.2,
    spreadHip: 0.03, spreadAds: 0.0012, adsFov: 22,
    ads: { pos: [0.15, -0.195, -0.435], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [200, 500, 0.8], range: 700,
    tracer: { style: 'vapor', color: [1, 0.9, 0.6], life: 0.85, drift: 0.35, opacity: 0.55 }, // lingering smoke trail
    snd: { key: 'sniperShot', rate: 1.0, vol: 0.65 },
    ai: { aiMin: 60, range: 320, burst: [1, 1], interval: 1.5, pause: [2.8, 4.8], spread: 0.005 },
  },
  rocket: {
    name: 'M41 ROCKET LAUNCHER', model: '/UNSC/weapons/rocket-launcher/Rocket-Launcher.glb', len: 1.15,
    icon: '/UNSC/weapons/rocket-launcher/Rocket-Launcher_icon.svg',
    grip: { pos: [0.3, 0.11, 0.04], rot: [-1.5, -0.3, -1.5] },
    fp: { pos: [0.07, 0.21, -0.31], rot: [0, 0, 0] },
    mode: 'projectile', rpm: 50, dmg: 120, splash: 5.5, projSpeed: 55, mag: 2, reserve: 8, reload: 3.4,
    spreadHip: 0.008, spreadAds: 0.004, adsFov: 50,
    ads: { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [50, 200, 1], range: 400,
    snd: { key: 'rocketShot', rate: 1.0, vol: 0.7 },
    ai: { aiMin: 35, range: 130, burst: [1, 1], interval: 1.2, pause: [3, 5], spread: 0.01, cooldown: 12 },
  },
  laser: {
    name: 'SPARTAN LASER', model: '/UNSC/weapons/Spartan-Laser/Spartan-Laser.glb', len: 1.15,
    icon: '/UNSC/weapons/Spartan-Laser/Spartan-Laser_icon.svg',
    grip: { pos: [0.3, 0.11, 0.04], rot: [-1.5, -0.3, -1.5] },
    fp: { pos: [0.12, 0.18, -0.43], rot: [0, 0, 0] },
    // Screen material is authored with emissive black and no base map, unlike
    // the sniper's — scopedisplay.js forces emissive white so the render shows.
    scope: { material: 'Spartan-Laser_screen', fov: 8, pos: [0, 0, 0], rot: [0, 0, 0], size: 256 },
    mode: 'charge', chargeTime: 1.1, rpm: 40, dmg: 150, mag: 5, reserve: 5, reload: 3.0,
    spreadHip: 0.004, spreadAds: 0.0015, adsFov: 30,
    ads: { pos: [0.18, -0.195, -0.405], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [400, 800, 1], range: 800,
    tracer: { style: 'beam', color: [1, 0.15, 0.1], life: 0.3, opacity: 0.85 }, // it IS a laser
    snd: { key: 'sniperShot', rate: 0.55, vol: 0.7 },
    ai: { aiMin: 60, range: 240, burst: [1, 1], interval: 1.5, pause: [6, 10], spread: 0.005 },
  },
};

// Let a weapon def know its own key (used for held-weapon attachment)
for (const [k, def] of Object.entries(WEAPONS)) def.key = k;

// Default first-person viewmodel offset; per-weapon `fp` in the def overrides.
export const FP_DEFAULT = { pos: [0.15, 0.07, -0.31], rot: [0, 0, 0] };

// Aim-down-sights pose. `fp` positions the gun inside the viewmodel holder;
// this positions the HOLDER itself (same space as the hip base 0.28,-0.24,-0.55
// in player.js) — that is the transform that puts a weapon's optic on the
// crosshair, and it has to be per weapon because every sight sits somewhere
// different on its model. Tuned in /chartest.html ADS tab.
//
//   scale — counteracts the viewmodel blowing up at a narrow adsFov (the gun
//           shares the main camera, so 22° magnifies it ~3.4x)
//   sens  — multiplier on top of automatic zoom-proportional sensitivity
//   speed — how fast the gun comes up; lerp rate, so bigger is snappier
// Seeded from the tuned MA5 pose — a new weapon starts somewhere sane rather
// than at the old hardcoded slide-to-centre, which suited nothing.
export const ADS_DEFAULT = { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 };

export const PRIMARIES = ['ar', 'br'];

// `shield` overrides the default soldier shield; `model` picks the character
// mesh for the class (blue team) — Spartans are the only class in MJOLNIR.
// `gadgets` are visual loadout slots for now (implementations come later).
// `jumpHeight` overrides CFG.soldier.jumpHeight for the class, in METRES — the
// only jump number to touch. Takeoff velocity, airtime and the jump clip's
// playback speed all follow from it. Note height goes with the SQUARE of
// takeoff speed, so doubling the height is only 1.41x the velocity and airtime.
export const CLASSES = {
  assault: { name: 'Assault', secondaries: ['smg', 'shotgun'], model: 'marine', gadgets: ['frag', 'medkit'] },
  engineer: { name: 'Engineer', secondaries: ['rocket', 'laser'], model: 'marine', gadgets: ['repair', 'mines'] },
  recon: { name: 'Recon', secondaries: ['sniper', 'dmr'], model: 'marine', gadgets: ['sensor', 'frag'] },
  support: { name: 'Support', secondaries: ['shotgun'], model: 'marine', gadgets: ['ammo', 'medkit'] },
  spartan: { name: 'Spartan', secondaries: ['shotgun', 'sniper', 'rocket', 'laser'], model: 'spartan', shield: 70, jumpHeight: 3, gadgets: ['frag', 'shield'] },
};

// Gadget registry: line-art slot icons (stroke uses currentColor).
export const GADGETS = {
  frag: { name: 'M9 FRAG', svg: '<circle cx="12" cy="14" r="6"/><rect x="10" y="4" width="4" height="3.4"/><circle cx="16.4" cy="5" r="1.8"/>' },
  medkit: { name: 'MED KIT', svg: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M12 9.5v6M9 12.5h6"/>' },
  repair: { name: 'REPAIR TOOL', svg: '<path d="M15 4a5 5 0 0 0-6 6.5L4.5 15 9 19.5l4.5-4.5A5 5 0 0 0 20 9l-3 3-4-4z"/>' },
  mines: { name: 'AT MINES', svg: '<path d="M12 5l8 14H4z"/><path d="M12 11v4.5"/>' },
  sensor: { name: 'MOTION SENSOR', svg: '<circle cx="12" cy="13" r="2"/><path d="M7.5 13a4.5 4.5 0 0 1 9 0M4.5 13a7.5 7.5 0 0 1 15 0"/>' },
  ammo: { name: 'AMMO PACK', svg: '<rect x="6" y="9" width="3" height="9"/><rect x="10.5" y="6.5" width="3" height="11.5"/><rect x="15" y="9" width="3" height="9"/>' },
  shield: { name: 'OVERSHIELD', svg: '<path d="M12 3.5l7.5 2.8V12c0 4.6-3.2 7.4-7.5 8.5C7.7 19.4 4.5 16.6 4.5 12V6.3z"/>' },
};

export const GAME_TYPES = {
  conquest: {
    id: 'conquest', name: 'SECTOR CONTROL',
    desc: 'Capture and hold sectors to bleed enemy tickets. 32 v 32 combined arms.',
  },
};

export const MAPS = {
  demo: {
    id: 'demo', name: 'Demo Map', type: 'procedural',
    desc: 'Procedurally generated training valley. Five sectors, open sightlines, scattered cover.',
    tag: 'GENERATED',
  },
  map3: {
    id: 'map3', name: 'Map 3', type: 'glb', url: '/Maps/map-3.glb',
    desc: 'Imported battlefield terrain — first mesh-based map test.',
    tag: 'IMPORTED',
  },
};

export const ASSET_PATHS = {
  characters: {
    spartan: '/UNSC/Characters/Spartan/Spartan_Mark-IV.glb',
    elite: '/Covenant/Characters/Elite/Elite_1.glb',
    marine: '/UNSC/Characters/Marine/Marine_1.glb',
  },
  animations: {
    // Two rifle idles, assigned per soldier at spawn so a crowd standing around
    // is not 64 copies of one loop. Both are long (8.6 s / 10.7 s), which is
    // what keeps them from reading as a cycle. These replace the old generic
    // idle.glb, which was an unarmed pose on soldiers who all carry rifles.
    idle: '/animations/idle_rifle_1/idle_rifle_1.glb',
    idleLook: '/animations/idle_rifle_2_lookaround/idle_rifle_2_lookaround.glb',
    // Standing locomotion, 4-way per speed tier. The walk set is cycle-matched
    // at ~1.03 s so the step cadence does not change when you strafe
    // (walking-backwards.glb is the same motion at 1.46 s — it breaks that).
    run: '/animations/run-forward.glb',
    // Sprint (Shift): rifle carried low, the classic head-down run. Its own tier
    // above `run`, so it only shows while the sprint boost is actually applying.
    sprint: '/animations/rifle-down-run.glb',
    // Reloads, played full-body per gait rather than masked over one: legs and
    // arms were authored together, which avoids a reload's torso fighting a
    // separately-authored stride. One per speed tier, each stretched to the
    // carried weapon's reload time (2.1-3.4 s across the armoury). The moving
    // two are shown forward-only, since their legs travel forward.
    idleReload: '/animations/idle_reload/idle_reload.glb',   // 2.97 s
    walkReload: '/animations/walk_reload/walk_reload.glb',   // 4.13 s
    runReload: '/animations/run_reload/run_reload.glb',      // 3.70 s
    runBack: '/animations/run-backwards.glb',
    runLeft: '/animations/run-left.glb',
    runRight: '/animations/run-right.glb',
    walk: '/animations/walk-forward-in-place.glb',
    walkBack: '/animations/walk-backward.glb',
    walkLeft: '/animations/walk-left.glb',
    walkRight: '/animations/walk-right.glb',
    // 0.63 s, stretched at playback to whatever the jumper's airtime works out
    // to, and clamped so the landing frame holds if the fall outlasts the clip.
    jump: '/animations/rifle-jump.glb',
    // Standing rifle-aim: the pose for holding still with a target. Exported
    // from a reduced Mixamo skeleton (42 bones — middle/ring/pinky fingers are
    // absent), so those bones keep whatever the outgoing clip left them at.
    aim: '/animations/Idle_rifle_aim/Idle_rifle_aim.glb',
    // The crouch idle is its own pose now that `aim` stands up.
    crouchIdle: '/animations/idle-crouching-aiming.glb',
    // Crouch locomotion, 4-way. These are re-exports with the mesh stripped
    // (~75 KB vs ~1.9 MB); several carry leftover actions, hence the explicit
    // clip names — see the loader note in assets.js.
    crouchFwd: { url: '/animations/crouch_walk_forward_aim/crouch_walk_forward_aim.glb', clip: 'walk-crouching-forward' },
    crouchBack: { url: '/animations/crouch_walk_backwards_aim/crouch_walk_backwards_aim.glb', clip: 'walk-crouching-backward' },
    crouchLeft: { url: '/animations/crouch_walk_left_aim/crouch_walk_left_aim.glb', clip: 'walk-crouching-left' },
    crouchRight: { url: '/animations/crouch_walk_right_aim/crouch_walk_right_aim.glb', clip: 'walk-crouching-right' },
    death1: '/animations/dying_normal-with-rifle.glb',
    death2: '/animations/death_1.glb',
  },
  audio: {
    shot: '/UNSC/weapons/battle-rifle/audio/battle-rifle-shot-1.mp3',
    dmrShot: '/UNSC/weapons/DMR/DMR_shot.wav',
    sniperShot: '/UNSC/weapons/sniper/Sniper_shot.wav',
    rocketShot: '/UNSC/weapons/rocket-launcher/Rocket-Launcher_shot.wav',
    reload: '/UNSC/weapons/assault rifle/audio/assault-rifle-reload-1.mp3',
    empty: '/UNSC/weapons/pistol/empty_sound.mp3',
  },
};
