// Player settings: what they are, what they default to, how they persist, and
// who to tell when one changes.
//
// Deliberately a tiny store rather than a config block. CFG is the game's
// TUNING — authored numbers that ship with the build and are the same for
// everyone. This is the opposite: values the player owns, which survive a reload
// and which no simulation code should ever read at tuning time. Keeping them
// apart is what stops a graphics preference ending up in a balance discussion.
//
// The definitions below drive the menu. A new setting is ONE entry here plus
// somewhere that reads it — `pausemenu.js` builds its rows by walking this, so
// nothing has to be added to the UI by hand.

const STORE_KEY = 'fc.settings.v1';

// `tab` groups them in the menu; `kind` picks the control. Order within a tab
// follows declaration order, so this list is also the layout.
export const SETTING_DEFS = {
  // The repair beam's POINT LIGHT, not the beam itself — the beam mesh is ~3
  // draw calls and free, and the light is the entire cost. Measured on the demo
  // map: turning one on compiled 60 new shader programs, because scene light
  // COUNT is part of three's program cache key (the same trap documented in
  // lobby.js for the Mongoose's service lamp). Frame cost went 36.9 -> 39.7 ms.
  //
  // Three caches a variant per count, so a toggle is free once each count has
  // been seen — but the first time N bots weld at once is a fresh count and a
  // fresh compile, mid-firefight. That is what this setting exists to bound.
  //
  // Values are a LIGHT BUDGET, not a beam count: beams always draw. AI beams are
  // not wired yet, so today 1 and 4 behave identically — the tier is here so the
  // pool has a number to read when they land.
  beamLights: {
    tab: 'video', label: 'REPAIR BEAM LIGHTS', kind: 'choice', def: 1,
    hint: 'How many repair beams cast light. Beams still draw either way — this is the light budget.',
    options: [
      { v: 0, label: 'OFF', note: 'No beam casts light. Cheapest.' },
      { v: 1, label: 'OWN ONLY', note: 'Your beam lights its work; other soldiers’ do not.' },
      { v: 4, label: 'NEARBY', note: 'The nearest few welders light up too.' },
    ],
  },
  volume: {
    tab: 'audio', label: 'MASTER VOLUME', kind: 'slider', def: 0.5,
    min: 0, max: 1, step: 0.05,
    hint: 'Everything the game plays, at the mixer.',
    fmt: (v) => `${Math.round(v * 100)}%`,
  },
};

// Tab order and titles. Separate from the defs so an empty tab is possible while
// a feature is half-built, rather than a tab appearing the moment its first
// setting is declared.
export const SETTING_TABS = [
  { id: 'video', label: 'VIDEO' },
  { id: 'audio', label: 'AUDIO' },
];

const values = {};
for (const [k, d] of Object.entries(SETTING_DEFS)) values[k] = d.def;

const listeners = new Set();

// Same try/catch shape as the loadout book: private mode throws on access, and a
// player who cannot save settings should still be able to change them for this
// session rather than hit a wall.
function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(values)); } catch (e) { /* private mode */ }
}

// Every stored value is re-validated against its def rather than trusted. A
// build that removes an option (or a hand-edited localStorage) must not be able
// to put the game into a state the menu cannot show or the renderer cannot use.
export function loadSettings() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (e) { return values; }
  if (!raw) return values;
  let saved;
  try { saved = JSON.parse(raw); } catch (e) { return values; }
  for (const [k, def] of Object.entries(SETTING_DEFS)) {
    const v = saved && saved[k];
    if (v === undefined) continue;
    if (def.kind === 'choice') {
      if (def.options.some((o) => o.v === v)) values[k] = v;
    } else if (def.kind === 'slider') {
      const n = Number(v);
      if (Number.isFinite(n)) values[k] = Math.min(def.max, Math.max(def.min, n));
    }
  }
  return values;
}

export function getSetting(key) { return values[key]; }

export function setSetting(key, value) {
  if (!(key in values) || values[key] === value) return;
  values[key] = value;
  persist();
  for (const fn of listeners) fn(key, value);
}

// Returns an unsubscribe, so a screen that is torn down and rebuilt (the match,
// on a second launch) cannot leave a listener holding a dead renderer.
export function onSettingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
