// The loadout model: the one place that knows what slots a soldier has, what
// may legally go in each, and how to repair a loadout that has drifted.
//
// Both the armoury (menu.js) and the deploy screen (deploy.js) edit loadouts,
// and each used to carry its own copy of the "class changed — is this weapon
// still legal?" check. That duplication was survivable at two slots. At six,
// with gadgets that reach across and rewrite the weapon slots, it would
// guarantee the two screens drift apart.

import {
  CLASSES, WEAPONS, GADGETS, GRENADES, MELEE, PERKS,
  GLOBAL_GADGETS, ALL_WEAPONS, LOADOUTS,
} from './config.js';

export function classPerk(cls) {
  const c = CLASSES[cls];
  return (c && PERKS[c.perk]) || null;
}

// A class's pools, with the two rules that are computed rather than declared:
// globals join every class's gadget list, and a class whose perk already grants
// a global does not see it offered again. That removal IS the Engineer's perk —
// everyone else spends a slot on the repair tool and they do not.
export function classPools(cls) {
  const c = CLASSES[cls] || {};
  const perk = classPerk(cls);
  const granted = new Set((perk && perk.grants) || []);
  return {
    primaries: c.primaries || [],
    // MJOLNIR reaches the whole armoury in slot 2 without spending a gadget.
    sidearms: perk && perk.freeSecondary ? ALL_WEAPONS : (c.sidearms || ['magnum']),
    gadgets: [...(c.gadgets || []), ...GLOBAL_GADGETS].filter((k) => !granted.has(k)),
    grenades: c.grenades || ['frag'],
    melees: c.melees || ['bash'],
  };
}

// Which weapons a weaponSlot gadget can put in the slot it upgrades. Two forms:
// `weapons` is an explicit list (the launcher's rocket-or-laser), `pool` names a
// class list (webbing drawing from your own primaries).
export function gadgetWeapons(cls, def) {
  if (!def) return null;
  if (def.weapons) return def.weapons;
  if (def.pool) return classPools(cls)[def.pool] || null;
  return null;
}

// The equipped gadget that upgrades a given weapon slot, if any. This is the
// single mechanic behind every "better than a pistol" case in the game:
//
//   shotgun_kit   upgrades primary    Assault
//   marksman_kit  upgrades primary    Recon
//   webbing       upgrades secondary  Assault
//   launcher_kit  upgrades secondary  Engineer
//
// so "two weapons" is never violated — what changes is what earned each slot.
export function weaponSlotGadget(lo, which) {
  for (const key of (lo && lo.gadgets) || []) {
    const g = GADGETS[key];
    if (g && g.kind === 'weaponSlot' && g.upgrades === which) return g;
  }
  return null;
}

// The slot table. Drives the armoury grid, the armoury picker, the info panel's
// per-kind branch, the deploy strip and validateLoadout below — so a slot is
// described once and five things follow.
//
// `field`/`index` say where the slot's value lives on the loadout object (the
// two gadgets share one array). `art` says where the card gets its picture:
// 'weapon' has a baked 3D thumbnail with hand-drawn SVG behind it, 'glyph' has
// the inline `svg` every non-weapon registry entry carries.
export const SLOTS = [
  {
    id: 'primary', label: 'PRIMARY', field: 'primary', reg: WEAPONS, art: 'weapon',
    pool: (cls, lo) => gadgetWeapons(cls, weaponSlotGadget(lo, 'primary'))
      || classPools(cls).primaries,
  },
  {
    id: 'secondary', label: 'SECONDARY', field: 'secondary', reg: WEAPONS, art: 'weapon',
    pool: (cls, lo) => gadgetWeapons(cls, weaponSlotGadget(lo, 'secondary'))
      || classPools(cls).sidearms,
  },
  {
    id: 'gadget1', label: 'GADGET 1', field: 'gadgets', index: 0, reg: GADGETS, art: 'glyph',
    pool: (cls) => classPools(cls).gadgets,
  },
  {
    id: 'gadget2', label: 'GADGET 2', field: 'gadgets', index: 1, reg: GADGETS, art: 'glyph',
    pool: (cls) => classPools(cls).gadgets,
  },
  {
    id: 'grenade', label: 'GRENADE', field: 'grenade', reg: GRENADES, art: 'glyph',
    pool: (cls) => classPools(cls).grenades,
  },
  {
    id: 'melee', label: 'MELEE', field: 'melee', reg: MELEE, art: 'glyph',
    pool: (cls) => classPools(cls).melees,
  },
];

const GADGET_SLOTS = ['gadget1', 'gadget2'];

export function slotById(id) { return SLOTS.find((s) => s.id === id); }

export function slotValue(lo, slot) {
  return slot.index === undefined ? lo[slot.field] : (lo[slot.field] || [])[slot.index];
}

export function setSlot(lo, slot, key) {
  if (slot.index === undefined) { lo[slot.field] = key; return; }
  if (!Array.isArray(lo[slot.field])) lo[slot.field] = [];
  lo[slot.field][slot.index] = key;
}

// The registry entry behind a slot's current key — a WEAPONS def, a GADGETS
// def, a grenade or a melee.
export function slotDef(slot, key) { return key ? slot.reg[key] : null; }

// Both gadgets are drawn from ONE pool, so two rules have to hold that a single
// per-slot pool check cannot express.
function repairGadgets(lo) {
  const pool = classPools(lo.cls).gadgets;
  if (!Array.isArray(lo.gadgets)) lo.gadgets = [];
  lo.gadgets.length = 2;

  for (let i = 0; i < 2; i++) {
    if (!pool.includes(lo.gadgets[i])) lo.gadgets[i] = undefined;
  }
  // 1. No duplicates — taking the same gadget twice is never a build.
  if (lo.gadgets[0] && lo.gadgets[0] === lo.gadgets[1]) lo.gadgets[1] = undefined;
  // 2. At most ONE weapon gadget. Only Assault can trip this (shotgun upgrades
  //    the primary, webbing the secondary), and taking both would cover every
  //    range at once — exactly what giving up your rifle was meant to cost.
  const isWeapon = (k) => k && GADGETS[k] && GADGETS[k].kind === 'weaponSlot';
  if (isWeapon(lo.gadgets[0]) && isWeapon(lo.gadgets[1])) lo.gadgets[1] = undefined;

  // Backfill empties with the first legal pool entry that breaks neither rule.
  for (let i = 0; i < 2; i++) {
    if (lo.gadgets[i]) continue;
    const other = lo.gadgets[1 - i];
    lo.gadgets[i] = pool.find((k) => k !== other && !(isWeapon(k) && isWeapon(other)));
  }
}

// Repair a loadout in place and hand it back. Call after anything that can
// invalidate a slot: a class switch, a gadget change, or loading a loadout saved
// before a config change moved a weapon between pools.
//
// ORDER MATTERS. Gadgets resolve BEFORE the weapons, because a weaponSlot gadget
// is what decides a weapon slot's pool. Validating a weapon first would check it
// against the wrong list, and the gadget pass would then silently invalidate
// what it had just approved.
export function validateLoadout(lo) {
  if (!lo) return lo;
  if (!CLASSES[lo.cls]) lo.cls = 'assault';

  repairGadgets(lo);

  for (const slot of SLOTS) {
    if (GADGET_SLOTS.includes(slot.id)) continue;  // done above
    const pool = slot.pool(lo.cls, lo);
    if (!pool || !pool.length) { setSlot(lo, slot, undefined); continue; }
    if (!pool.includes(slotValue(lo, slot))) setSlot(lo, slot, pool[0]);
  }

  // Carrying two rifles is the point of the webbing; carrying the SAME rifle
  // twice is not — it reads as a bug, and the stowed copy would z-fight the held
  // one on the character's back. Only reachable when both slots draw from the
  // same list, which is exactly the webbing case.
  if (lo.secondary === lo.primary) {
    const pool = slotById('secondary').pool(lo.cls, lo) || [];
    const alt = pool.find((k) => k !== lo.primary);
    if (alt) lo.secondary = alt;
  }
  return lo;
}

// A fresh, legal loadout for a class. Every slot is filled by validateLoadout
// taking the first entry of each pool, so this stays correct as pools change.
export function makeLoadout(cls = 'assault') {
  return validateLoadout({ cls, gadgets: [] });
}

// ---------------------------------------------------------------------- Presets --
export function presetsFor(cls) { return LOADOUTS[cls] || []; }

// Copy a preset onto a loadout IN PLACE — the session holds one loadout object
// that several screens read through, so replacing the reference would leave the
// deploy strip and the lobby preview pointed at the old one.
//
// It goes through validateLoadout on the way out, which is what makes
// hand-authored presets safe: one naming something illegal is repaired rather
// than breaking, and the same guarantee will cover saved loadouts if those land.
export function applyPreset(lo, preset) {
  if (!lo || !preset) return lo;
  lo.primary = preset.primary;
  lo.secondary = preset.secondary;
  lo.gadgets = [...(preset.gadgets || [])];
  lo.grenade = preset.grenade;
  lo.melee = preset.melee;
  return validateLoadout(lo);
}

// Switch class and land on that class's first preset rather than on whatever
// makeLoadout assembles from the head of every pool. Those two only coincided
// for three of the five classes, so switching to Engineer or Spartan used to
// show MODIFIED before you had modified anything — you were on a kit with no
// name. Every screen that changes class goes through here so they agree.
export function switchClass(lo, cls) {
  lo.cls = cls;
  const first = presetsFor(cls)[0];
  return first ? applyPreset(lo, first) : validateLoadout(lo);
}

// Which preset the current loadout still matches, if any. Presets SEED rather
// than lock, so this is how the UI knows to say MODIFIED once you have changed
// something — order-insensitive on the gadget pair, because taking the same two
// gadgets in the other order is the same kit.
export function matchingPreset(lo) {
  if (!lo) return null;
  const mine = [...(lo.gadgets || [])].sort().join();
  return presetsFor(lo.cls).find((p) => p.primary === lo.primary
    && p.secondary === lo.secondary
    && p.grenade === lo.grenade
    && p.melee === lo.melee
    && [...(p.gadgets || [])].sort().join() === mine) || null;
}

// A random legal loadout — what the 63 AI soldiers spawn with, so a squad is a
// mix rather than 63 copies of one kit. Gadgets are rolled first for the same
// reason validateLoadout repairs them first: they decide the weapon pools.
export function randomLoadout(cls) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const pool = classPools(cls).gadgets;
  const lo = { cls, gadgets: [pick(pool), pick(pool)] };
  repairGadgets(lo);
  for (const slot of SLOTS) {
    if (GADGET_SLOTS.includes(slot.id)) continue;
    const p = slot.pool(cls, lo);
    if (p && p.length) setSlot(lo, slot, pick(p));
  }
  return validateLoadout(lo);
}
