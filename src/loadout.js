// The loadout model: the one place that knows what slots a soldier has, what
// may legally go in each, and how to repair a loadout that has drifted.
//
// Both the armoury (menu.js) and the deploy screen (deploy.js) edit loadouts,
// and each used to carry its own copy of the "class changed — is this weapon
// still legal?" check. That duplication was survivable at two slots. At six,
// with a cross-slot dependency (see weaponSlotGadget), it would guarantee the
// two screens drift apart.

import { CLASSES, WEAPONS, GADGETS, GRENADES, MELEE, PRIMARIES } from './config.js';

// Every class is presented as six slots whether or not its config entry has
// been migrated to the new shape. A legacy class — still on `secondaries` +
// `gadgets` — is mapped INTO that shape here rather than special-cased up in
// the UI:
//
//   primaries  <- the old global PRIMARIES list
//   sidearms   <- the old `secondaries`, so the class weapon keeps slot two
//   gadgetA/B  <- the old `gadgets` pair, split one per slot
//   grenades   <- frag
//   melees     <- bash
//
// So all five classes work in the new armoury today, and migrating one later is
// purely additive: give it the new fields and this bridge stops applying to it.
export function classPools(cls) {
  const c = CLASSES[cls] || {};
  const legacy = c.gadgets || [];
  return {
    primaries: c.primaries || PRIMARIES,
    sidearms: c.sidearms || c.secondaries || ['magnum'],
    gadgetA: c.gadgetA || (legacy[0] ? [legacy[0]] : []),
    gadgetB: c.gadgetB || (legacy[1] ? [legacy[1]] : []),
    grenades: c.grenades || ['frag'],
    melees: c.melees || ['bash'],
  };
}

// A gadget with kind 'weaponSlot' — Assault's combat webbing, and later
// Engineer's launcher and Recon's long gun — overrides what the SECOND weapon
// slot may hold. This is the single mechanic behind "two weapons, always": what
// changes is what earned slot two, never how many slots there are.
export function weaponSlotGadget(lo) {
  for (const key of (lo && lo.gadgets) || []) {
    const g = GADGETS[key];
    if (g && g.kind === 'weaponSlot') return g;
  }
  return null;
}

// The slot table. This drives the armoury grid, the armoury picker, the info
// panel's per-kind branch, the deploy strip and validateLoadout below — so a
// slot is described once and five things follow.
//
// `field`/`index` say where the slot's value lives on the loadout object
// (gadgets share one array). `art` says where the card gets its picture:
// 'weapon' has a baked 3D thumbnail with an SVG file behind it, 'glyph' has the
// inline `svg` string carried by every non-weapon registry entry.
export const SLOTS = [
  {
    id: 'primary', label: 'PRIMARY', field: 'primary', reg: WEAPONS, art: 'weapon',
    pool: (cls) => classPools(cls).primaries,
  },
  {
    id: 'secondary', label: 'SECONDARY', field: 'secondary', reg: WEAPONS, art: 'weapon',
    pool: (cls, lo) => {
      const g = weaponSlotGadget(lo);
      const pools = classPools(cls);
      return (g && pools[g.pool]) || pools.sidearms;
    },
  },
  {
    id: 'gadgetA', label: 'GADGET 1', field: 'gadgets', index: 0, reg: GADGETS, art: 'glyph',
    pool: (cls) => classPools(cls).gadgetA,
  },
  {
    id: 'gadgetB', label: 'GADGET 2', field: 'gadgets', index: 1, reg: GADGETS, art: 'glyph',
    pool: (cls) => classPools(cls).gadgetB,
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
// def, a grenade or a melee. Callers branch on `kind` (gadgets) or on the slot's
// own `reg` to decide how to present it.
export function slotDef(slot, key) { return key ? slot.reg[key] : null; }

// Repair a loadout in place and hand it back. Call after anything that can
// invalidate a slot: a class switch, a gadget change, or loading a loadout that
// was saved before a config change moved a weapon between pools.
//
// ORDER MATTERS. Gadgets resolve BEFORE the secondary, because a weaponSlot
// gadget decides what the secondary's pool even is. Validating the secondary
// first would check it against the wrong list, and the gadget pass would then
// silently invalidate what it had just approved.
export function validateLoadout(lo) {
  if (!lo) return lo;
  if (!CLASSES[lo.cls]) lo.cls = 'assault';
  if (!Array.isArray(lo.gadgets)) lo.gadgets = [];

  for (const slot of SLOTS) {
    if (slot.id === 'secondary') continue; // second pass, below
    const pool = slot.pool(lo.cls, lo);
    if (!pool.length) { setSlot(lo, slot, undefined); continue; }
    if (!pool.includes(slotValue(lo, slot))) setSlot(lo, slot, pool[0]);
  }

  const sec = slotById('secondary');
  const pool = sec.pool(lo.cls, lo);
  if (!pool.includes(lo.secondary)) lo.secondary = pool[0];
  // Carrying two rifles is the point of the webbing; carrying the SAME rifle
  // twice is not. It reads as a bug, and the stowed copy would z-fight the held
  // one on the character's back. Only reachable when the two pools are the same
  // list, which is exactly the webbing case.
  if (lo.secondary === lo.primary) {
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

// A random legal loadout — what the 63 AI soldiers spawn with, so a squad is a
// mix rather than 63 copies of one kit. Same two-pass order as validateLoadout,
// and for the same reason: the secondary's pool is not known until the gadgets
// are, because a weaponSlot gadget is what decides it.
export function randomLoadout(cls) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const lo = { cls, gadgets: [] };
  for (const slot of SLOTS) {
    if (slot.id === 'secondary') continue;
    const pool = slot.pool(cls, lo);
    if (pool.length) setSlot(lo, slot, pick(pool));
  }
  const pool = slotById('secondary').pool(cls, lo);
  if (pool.length) lo.secondary = pick(pool);
  return validateLoadout(lo);
}
