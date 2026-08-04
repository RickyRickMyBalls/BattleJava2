// Match rules — the delta a GAME TYPE applies to the match.
//
// The split this module exists to hold, and the reason it is not just more
// `CFG`:
//
//   `rules` answers WHICH RULE applies.   `CFG` answers WHAT THE NUMBER IS.
//
// A mode decides that the counter measures attrition rather than territory, or
// that a sector is capturable only when it neighbours one you hold. It does NOT
// decide that the bleed interval is 4 seconds — that stays in `CFG`, read live
// at the call site, so `FC.cfg.bleedInterval = 2` in the console still lands
// mid-match. Resolving a frozen snapshot of `CFG` into here would quietly kill
// that A/B path for exactly the six sites the modes care about most.
//
// See docs/GAME_TYPE_PLAN.md → "Architecture". The lock there is worth
// restating: only the six call sites in that table read `game.rules`. Do not
// sweep the codebase — modules capture their config at import scope
// (`const C = CFG.crate` in supply.js) and a broad rewrite breaks live editing.

import { GAME_TYPES } from './config.js';

// Every rule the match knows how to vary, at its SECTOR CONTROL value — which
// is to say, at the behaviour the prototype has had all along. A type that
// states nothing gets today's game.
export const DEFAULT_RULES = {
  id: 'conquest',

  // Are sectors PRIZES at all? 'capture' — take and hold them, the whole game
  // to date. 'none' — they still mark the map and the AI still fights over the
  // ground, but nobody can take one, so squads go where the enemy is instead.
  //
  // Deliberately separate from `lattice` below, and the pair reads as one
  // question in two parts: `objectives` says whether sectors are prizes,
  // `lattice` says which ones are live when they are.
  objectives: 'capture',

  // Which sectors may change hands. 'open' is every sector, always — five
  // points all live at once, the fight everywhere. A chain lattice answers
  // this from adjacency instead and is the single biggest lever between the
  // Battlefield and Squad feels. Read through `game.capturable(sec)`.
  lattice: 'open',

  // What the counter measures. 'attrition' bleeds tickets off whoever holds
  // fewer sectors; 'territory' would accrue score to whoever holds more.
  economy: 'attrition',

  // How the match ends. 'ticketsZero' — someone's counter hit the floor.
  victory: 'ticketsZero',

  // Tickets charged to the DEAD soldier's team, per death. Frontline sets this
  // to 0: there, dying costs position and materiel, never score.
  deathCost: 1,

  // Starting tickets, or null to take `CFG.tickets`. The one place a mode owns
  // a NUMBER rather than a rule, and it earns the exception: what a counter
  // starts at only means anything alongside what drains it, so 400 under a
  // ticket bleed and 400 under kills-only are not the same match length. Read
  // once at construction, so it was never live-editable through `FC.cfg`
  // anyway — which is the property the CFG-versus-rules split exists to
  // protect. A mode that has nothing to say here says nothing.
  tickets: null,

  // Where a soldier may re-enter the field.
  //   hq      — the home spawn is always available (deploy.js falls back to it)
  //   sectors — 'held' (any uncontested sector you own) | 'none'
  //   beacon  — a squad rally beacon is a spawn option
  spawn: { hq: true, sectors: 'held', beacon: true },
};

// Plain-object deep merge. Deliberately not general: rules are two levels of
// plain data, and anything cleverer would invite arrays and class instances
// into a structure that is about to be frozen.
function merge(base, delta) {
  if (!delta) return base;
  for (const k of Object.keys(delta)) {
    const v = delta[k];
    if (v && typeof v === 'object' && !Array.isArray(v)
      && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      merge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

function deepFreeze(o) {
  for (const k of Object.keys(o)) {
    if (o[k] && typeof o[k] === 'object') deepFreeze(o[k]);
  }
  return Object.freeze(o);
}

// Resolve once, at match setup, and hang the result on the game. Frozen because
// a rule that changes mid-match is a bug every time — the tuning knobs that are
// MEANT to move live all stayed in `CFG`.
export function resolveRules(typeId) {
  const type = GAME_TYPES[typeId] || GAME_TYPES.conquest;
  const out = merge(structuredClone(DEFAULT_RULES), type && type.rules);
  out.id = type ? type.id : DEFAULT_RULES.id;
  return deepFreeze(out);
}
