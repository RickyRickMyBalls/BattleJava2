// The class perk: what it is, and what it actually does.
//
// Two presentations. The loadout bar shows it as a card in the slot row (see
// LoadoutBar._perkCard) where the CUSTOMIZE button used to be. The armoury
// shows the full breakdown in its left column — inline rather than a modal,
// because that column had dead space under the stat bars and detail you can
// read while still choosing beats detail you have to dismiss.

import { CLASSES, PERKS, GADGETS, CFG } from './config.js';

// Human labels and formatting for PERKS[].stats. A raw `staminaMax: 1.5` means
// nothing on screen.
const STAT_LABELS = {
  shield: { label: 'SHIELD', fmt: (v) => `${v}`, base: () => `${CFG.soldier.shield}` },
  jumpHeight: { label: 'JUMP HEIGHT', fmt: (v) => `${v} m`, base: () => `${CFG.soldier.jumpHeight} m` },
  staminaMax: { label: 'STAMINA POOL', fmt: (v) => (v === Infinity ? 'UNLIMITED' : `×${v}`) },
  staminaRegen: { label: 'STAMINA RECOVERY', fmt: (v) => `×${v}` },
  // Stated as the resulting behaviour, not the multiplier: "×1" against a
  // baseline of 0.35 tells a player nothing, and this is the row that carries
  // MARATHON's whole identity.
  staminaMoveRegen: {
    label: 'RECOVERS ON THE MOVE',
    fmt: (v) => (v >= 1 ? 'FULL RATE' : `×${v}`),
    base: () => `×${CFG.stamina.moveRegenMult}`,   // rendered as "others ×0.35"
  },
  buildRate: { label: 'BUILD SPEED', fmt: (v) => `×${v}` },
  repairRate: { label: 'REPAIR SPEED', fmt: (v) => `×${v}` },
  reviveRate: { label: 'REVIVE SPEED', fmt: (v) => `×${v}` },
};

// Which perk stats the simulation actually reads today — soldier.setLoadout
// resolves these off the perk, and player._stepStamina spends the pool. The
// rest wait on systems that do not exist yet (construction, the downed state),
// and the panel says so rather than implying a perk does something.
//
// Stamina is PLAYER-ONLY so far. It is live here because these rows are read in
// the armoury, where you are choosing your own class — a bot's Marathon does
// nothing yet, but a bot never reads this panel.
const LIVE_STATS = new Set([
  'shield', 'jumpHeight', 'staminaMax', 'staminaRegen', 'staminaMoveRegen',
]);

export function perkFor(cls) {
  const c = CLASSES[cls];
  return (c && PERKS[c.perk]) || null;
}

// Rows of what the perk actually does, each marked live or pending.
function perkStats(perk) {
  const stats = [];
  // Stated as what it SAVES you, because that is the form a perk is felt in:
  // everyone else spends a slot on this.
  for (const key of perk.grants || []) {
    const g = GADGETS[key];
    if (!g) continue;
    stats.push({
      label: 'GRANTS', value: g.name,
      note: 'free — no gadget slot', pending: g.built === false,
    });
  }
  if (perk.freeSecondary) {
    stats.push({
      label: 'SECOND WEAPON', value: 'ANY IN ARMOURY',
      note: 'free — others spend a gadget', pending: false,
    });
  }
  for (const [key, val] of Object.entries(perk.stats || {})) {
    const def = STAT_LABELS[key];
    if (!def) continue;
    stats.push({
      label: def.label,
      value: def.fmt(val),
      note: def.base ? `others ${def.base()}` : '',
      pending: !LIVE_STATS.has(key),
    });
  }
  return stats;
}

// The left-column panel. Persistent — it always describes the current class's
// perk, so there is nothing to open and nothing to close.
export function renderPerkDetail(host, cls) {
  const perk = perkFor(cls);
  host.innerHTML = '';
  if (!perk) return;
  const stats = perkStats(perk);
  const pending = stats.filter((s) => s.pending).length;
  host.innerHTML =
    `<div class="pd-head">CLASS PERK</div>`
    + `<div class="pd-name">${perk.name}</div>`
    + `<div class="pd-desc">${perk.desc}</div>`
    + stats.map((s) => `<div class="pd-stat${s.pending ? ' pending' : ''}">`
      + `<span class="k">${s.label}</span>`
      + `<span class="v">${s.value}</span>`
      + `<span class="n">${s.note || ''}</span></div>`).join('')
    + (pending
      ? `<div class="pd-note">Dimmed entries are designed but not built — they wait on systems that do not exist yet.</div>`
      : '');
}
