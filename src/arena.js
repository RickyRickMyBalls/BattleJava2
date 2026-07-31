// The host contract ("arena") shared by a live match and the lobby.
//
// Player, Soldier, Combat and GameAudio each take a single `game` argument and
// touch only a small, enumerable slice of it. That slice is the contract below.
// Game satisfies it as a side effect of being Game; makeLobbyArena() satisfies
// it cheaply, so the *same* Player and Soldier classes can run on the lobby
// stage with no match in existence.
//
// The point is leverage: future controller and animation work lands in
// player.js / soldier.js only, and the lobby inherits it for free. Anything
// added here that the lobby has to special-case is a smell.
//
// ---- CONTRACT ------------------------------------------------------------
//   scene                      [Soldier.setCharacter, Combat pools]
//   camera                     [GameAudio distance/pan]
//   assets                     [Player._mountGun, Soldier._initWeaponMount]
//   world                      [Player, Soldier, Combat] — see WORLD SLICE
//   hud                        [Player, Combat]
//   audio                      [Player, Combat]
//   combat                     [Player._dischargeRound]
//   allSoldiers                [Combat] — hit candidates; [] = nothing to hit
//   playerSoldier              [Player.soldier getter, Combat pellets]
//   playerLoadout, playerTeam  [Player.applyLoadout]
//   player                     [toggleFreecam]
//   menuOpen                   [Player input guards]
//   gameOver, playerDead       [Player.requestLock]
//   spectating                 [Combat: skip the player's own body]
//   spectatedSoldier           [Soldier._updateAnim: full-rate anim for the feed]
//   onKill(attacker, victim)   [Soldier.die]
//   onPlayerDamaged(shooter)   [Combat]
//   toggleFreecam/togglePause/cycleTimeScale   [Player hotkeys F / P / T]
//
// ---- WORLD SLICE ---------------------------------------------------------
//   heightAt(x, z)             ground height           [Player, Soldier]
//   collideCircle(pos, radius) cover push-out          [Player]
//   clampToMap(pos)            bounds                  [Player]
//   collision                  MapCollision | null     [Player]
//   raycastTerrain(a…b)        t in [0,1] or Infinity  [Combat]
//   raycastCover(a…b)          t in [0,1] or Infinity  [Combat]

import { TEAM } from './config.js';
import { makeLoadout } from './loadout.js';
import { Combat } from './combat.js';
import { GameAudio } from './audio.js';

// A stand-in whose every property reads as a no-op function.
//
// Deliberately permissive: when player.js later grows a call to some new HUD
// method, the lobby keeps running instead of throwing — which is the whole
// reason the controller is shared. The cost is that it swallows typos too, so
// only use it for genuinely optional output sinks (the HUD), never for
// anything whose return value is read.
export function nullObject() {
  const noop = () => {};
  return new Proxy({}, { get: () => noop });
}

// Flat ground at `y`, bounded by a box. Two jobs: it lets an arena be built
// before any stage geometry exists, and it stays on as the lobby's fallback
// for when lobby_stage.glb fails to load (the lobby already renders a
// procedural set in that case). LobbyWorld replaces it when the stage is up.
export function makeFlatWorld(y = 0, halfExtent = 40) {
  return {
    collision: null,
    mapW: halfExtent * 2,
    mapD: halfExtent * 2,
    heightAt() { return y; },
    collideCircle() {},
    clampToMap(v) {
      v.x = Math.max(-halfExtent, Math.min(halfExtent, v.x));
      v.z = Math.max(-halfExtent, Math.min(halfExtent, v.z));
    },
    raycastCover() { return Infinity; },
    raycastTerrain(ax, ay, az, bx, by, bz) {
      if (ay < y) return 0;                  // started below the floor
      if (by >= y) return Infinity;          // never dips below it
      const t = (ay - y) / (ay - by);        // ay > y > by, so t is in (0,1)
      return t;
    },
  };
}

// Build a Game-shaped host for the lobby stage.
//
// `audio` is a real GameAudio left uninitialised: its constructor has no side
// effects and every play path early-returns without an AudioContext, so it is
// a silent null-object until initAudio() is called. That avoids creating an
// AudioContext (which browsers gate behind a user gesture) just by building
// an arena, while keeping the real class in place for the firing range.
//
// `combat` is the real Combat — it only needs `scene` plus the world slice, and
// with `allSoldiers` empty its shots simply hit nothing. Tracers, sparks and
// impact effects all work, so the firing range later is "push target dummies
// into arena.allSoldiers", not a new subsystem.
export function makeLobbyArena({ scene, camera, assets, session, world }) {
  const arena = {
    scene,
    camera,
    assets,
    session: session || null,
    world: world || makeFlatWorld(),

    hud: nullObject(),
    audio: null,   // set below — GameAudio needs the arena
    combat: null,

    allSoldiers: [],
    playerSoldier: null,
    player: null,
    playerTeam: TEAM.BLUE,
    // Read through to the session like menuOpen does, rather than capturing the
    // reference at build time — the arena outlives any single armory visit.
    get playerLoadout() {
      return (session && session.playerLoadout) || makeLoadout('assault');
    },

    // The lobby is never over, never dead, never bleeding tickets.
    gameOver: false,
    playerDead: false,
    spectating: false,
    spectatedSoldier: null,
    paused: false,
    timeScale: 1,

    // Mirrors Game.menuOpen: the session owns the flag so the armory can lock
    // the keyboard from either host.
    get menuOpen() { return session ? session.menuOpen : false; },
    set menuOpen(v) { if (session) session.menuOpen = v; },

    onKill() {},
    onPlayerDamaged() {},

    // No match clock to pause or scale; the lobby renders on real time.
    togglePause() {},
    cycleTimeScale() {},

    toggleFreecam() {
      if (!arena.player) return;
      arena.spectating = !arena.spectating;
      arena.player.setFreecam(arena.spectating);
    },

    initAudio() {
      if (!arena.audio.ctx && assets && assets.audio) arena.audio.init(assets.audio);
    },
  };

  arena.audio = new GameAudio(arena);
  arena.combat = new Combat(arena);
  return arena;
}
