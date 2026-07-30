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

  soldier: {
    shield: 45,
    health: 55,
    shieldRegenDelay: 4.5,
    shieldRegenRate: 12,
    runSpeed: 6.2,
    walkSpeed: 3.4,
    respawnDelay: 6,
  },

  player: {
    eyeHeight: 1.78,
    crouchEye: 1.15,
    speed: 6.4,
    sprintMult: 1.5,
    crouchMult: 0.55,
    jumpVel: 6.5,
    gravity: 18,
    respawnDelay: 5,
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
    grip: { rot: [-Math.PI / 2, 0, -Math.PI / 2] }, // roll -90 around the barrel for held pose
    mode: 'auto', rpm: 620, dmg: 8.5, mag: 60, reserve: 240, reload: 2.3,
    spreadHip: 0.028, spreadAds: 0.007, adsFov: 55,
    falloff: [35, 150, 0.47], range: 320,
    snd: { key: 'shot', rate: 1.05, vol: 0.5 },
    ai: { aiMin: 0, range: 160, burst: [3, 6], interval: 0.11, pause: [0.35, 0.95], spread: 0.008 },
  },
  br: {
    name: 'BR55 BATTLE RIFLE', model: '/UNSC/weapons/battle-rifle/battle-rifle.glb', len: 0.95,
    icon: '/UNSC/weapons/battle-rifle/Battle-Rifle_Icon.svg',
    mode: 'burst', burst: 3, burstInterval: 0.06, rpm: 270, dmg: 11, mag: 36, reserve: 288, reload: 2.4,
    spreadHip: 0.014, spreadAds: 0.004, adsFov: 50,
    falloff: [60, 230, 0.55], range: 420,
    snd: { key: 'shot', rate: 1.0, vol: 0.5 },
    ai: { aiMin: 0, range: 210, burst: [3, 3], interval: 0.06, pause: [0.55, 1.1], spread: 0.006 },
  },
  smg: {
    name: 'M7 SMG', model: '/UNSC/weapons/SMG/SMG.glb', len: 0.62,
    icon: '/UNSC/weapons/SMG/SMG_icon.svg',
    mode: 'auto', rpm: 900, dmg: 6, mag: 60, reserve: 360, reload: 2.1,
    spreadHip: 0.042, spreadAds: 0.018, adsFov: 60,
    falloff: [20, 80, 0.35], range: 200,
    snd: { key: 'shot', rate: 1.35, vol: 0.35 },
    ai: { aiMin: 0, range: 75, burst: [5, 9], interval: 0.067, pause: [0.3, 0.7], spread: 0.014 },
  },
  shotgun: {
    name: 'M90 SHOTGUN', model: '/UNSC/weapons/Shotgun/Shotgun_2.1.glb', len: 0.95,
    icon: '/UNSC/weapons/Shotgun/Shotgun_icon.svg',
    mode: 'pump', rpm: 62, dmg: 6.5, pellets: 8, pelletSpread: 0.045, mag: 8, reserve: 40, reload: 3.0,
    grip: { rot: [-Math.PI / 2, -Math.PI / 2, 0] }, // model's long axis differs from the other guns
    spreadHip: 0.01, spreadAds: 0.006, adsFov: 60,
    falloff: [12, 42, 0.2], range: 90,
    snd: { key: 'shot', rate: 0.62, vol: 0.75 },
    ai: { aiMin: 0, range: 32, burst: [1, 1], interval: 1.0, pause: [0.9, 1.5], spread: 0.012 },
  },
  dmr: {
    name: 'M392 DMR', model: '/UNSC/weapons/DMR/DMR.glb', len: 1.0,
    icon: '/UNSC/weapons/DMR/DMR_icon.svg',
    mode: 'semi', rpm: 260, dmg: 20, mag: 15, reserve: 135, reload: 2.4,
    spreadHip: 0.012, spreadAds: 0.0025, adsFov: 38,
    falloff: [80, 300, 0.6], range: 500,
    snd: { key: 'dmrShot', rate: 1.0, vol: 0.55 },
    ai: { aiMin: 40, range: 260, burst: [1, 2], interval: 0.4, pause: [0.9, 1.6], spread: 0.006 },
  },
  sniper: {
    name: 'SRS99 SNIPER', model: '/UNSC/weapons/sniper/sniper.glb', len: 1.35,
    icon: '/UNSC/weapons/sniper/Sniper_icon.svg',
    mode: 'semi', rpm: 46, dmg: 80, mag: 4, reserve: 20, reload: 3.2,
    spreadHip: 0.03, spreadAds: 0.0012, adsFov: 22,
    falloff: [200, 500, 0.8], range: 700,
    tracer: { color: [1, 0.9, 0.6], life: 0.25 },
    snd: { key: 'sniperShot', rate: 1.0, vol: 0.65 },
    ai: { aiMin: 60, range: 320, burst: [1, 1], interval: 1.5, pause: [2.8, 4.8], spread: 0.005 },
  },
  rocket: {
    name: 'M41 ROCKET LAUNCHER', model: '/UNSC/weapons/rocket-launcher/Rocket-Launcher.glb', len: 1.15,
    icon: '/UNSC/weapons/rocket-launcher/Rocket-Launcher_icon.svg',
    mode: 'projectile', rpm: 50, dmg: 120, splash: 5.5, projSpeed: 55, mag: 2, reserve: 8, reload: 3.4,
    spreadHip: 0.008, spreadAds: 0.004, adsFov: 50,
    falloff: [50, 200, 1], range: 400,
    snd: { key: 'rocketShot', rate: 1.0, vol: 0.7 },
    ai: { aiMin: 35, range: 130, burst: [1, 1], interval: 1.2, pause: [3, 5], spread: 0.01, cooldown: 12 },
  },
  laser: {
    name: 'SPARTAN LASER', model: '/UNSC/weapons/Spartan-Laser/Spartan-Laser.glb', len: 1.15,
    icon: '/UNSC/weapons/Spartan-Laser/Spartan-Laser_icon.svg',
    mode: 'charge', chargeTime: 1.1, rpm: 40, dmg: 150, mag: 5, reserve: 5, reload: 3.0,
    spreadHip: 0.004, spreadAds: 0.0015, adsFov: 40,
    falloff: [400, 800, 1], range: 800,
    tracer: { color: [1, 0.15, 0.1], life: 0.3, thick: true },
    snd: { key: 'sniperShot', rate: 0.55, vol: 0.7 },
    ai: { aiMin: 60, range: 240, burst: [1, 1], interval: 1.5, pause: [6, 10], spread: 0.005 },
  },
};

// Let a weapon def know its own key (used for held-weapon attachment)
for (const [k, def] of Object.entries(WEAPONS)) def.key = k;

export const PRIMARIES = ['ar', 'br'];

// `shield` overrides the default soldier shield; `model` picks the character
// mesh for the class (blue team) — Spartans are the only class in MJOLNIR.
// `gadgets` are visual loadout slots for now (implementations come later).
export const CLASSES = {
  assault: { name: 'Assault', secondaries: ['smg', 'shotgun'], model: 'marine', gadgets: ['frag', 'medkit'] },
  engineer: { name: 'Engineer', secondaries: ['rocket', 'laser'], model: 'marine', gadgets: ['repair', 'mines'] },
  recon: { name: 'Recon', secondaries: ['sniper', 'dmr'], model: 'marine', gadgets: ['sensor', 'frag'] },
  support: { name: 'Support', secondaries: ['shotgun'], model: 'marine', gadgets: ['ammo', 'medkit'] },
  spartan: { name: 'Spartan', secondaries: ['shotgun', 'sniper', 'rocket', 'laser'], model: 'spartan', shield: 70, gadgets: ['frag', 'shield'] },
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
    idle: '/animations/idle.glb',
    run: '/animations/run-forward.glb',
    runBack: '/animations/run-backwards.glb',
    walk: '/animations/walk-forward-in-place.glb',
    aim: '/animations/idle-crouching-aiming.glb',
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
