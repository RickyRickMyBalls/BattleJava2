// Match orchestrator: teams, squads, spawning, capture logic, tickets, win state.

import * as THREE from 'three';
import { CFG, TEAM, CLASSES, WEAPONS } from './config.js';
import { makeLoadout, randomLoadout, validateLoadout } from './loadout.js';
import { World } from './world.js';
import { Soldier } from './soldier.js';
import { Squad, TeamBrain, squadNames } from './ai.js';
import { Combat } from './combat.js';
import { Supply } from './supply.js';
import { Structures } from './structures.js';
import { VehicleManager } from './vehicle.js';
import { Player } from './player.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { createBeamPool } from './repairtool.js';
import { getSetting, onSettingChange } from './settings.js';
import { prewarm, weaponClones, characterClones } from './assets.js';
import { resolveRules } from './rules.js';
import { Logistics } from './logistics.js';

// ---------------------------------------------------------------------------
// Match teardown (see Game.dispose). Everything a match puts in the scene has
// to come back out before the next one goes in, and the GPU memory with it — a
// 235 MB map parsed twice is two copies resident.
//
// The hard part is that a match does not OWN most of what it draws. Soldier
// bodies, weapons and vehicles are clones off the shared asset library, and a
// clone shares its source's geometry and materials outright. Disposing those
// would empty every gun in the armoury and every body in the lobby.
//
// So teardown disposes by EXCLUSION: collect everything reachable from the
// asset library, and dispose only what is not in it. What is left over is
// exactly the per-match geometry — terrain, sector rings, structures, tracer
// pools — and the map GLB, which is parsed fresh for every match (see maps.js).
function collectShared(assets) {
  const keep = new Set();
  if (!assets) return keep;
  const roots = [
    ...Object.values(assets.characters || {}).map((c) => c && c.template),
    ...Object.values(assets.weaponModels || {}),
    ...Object.values(assets.props || {}),
    ...Object.values(assets.vehicles || {}),
  ];
  for (const root of roots) {
    if (!root || !root.traverse) continue;
    root.traverse((o) => {
      if (o.geometry) keep.add(o.geometry);
      if (o.skeleton) keep.add(o.skeleton);
      for (const m of materialsOf(o)) {
        keep.add(m);
        for (const t of texturesOf(m)) keep.add(t);
      }
    });
  }
  return keep;
}

function materialsOf(o) {
  if (!o.material) return [];
  return Array.isArray(o.material) ? o.material : [o.material];
}

// Own enumerable properties only — every map slot a material actually uses is
// assigned in its constructor, and walking the prototype instead would poke
// three's deprecated accessors.
function texturesOf(m) {
  const out = [];
  for (const v of Object.values(m)) if (v && v.isTexture) out.push(v);
  return out;
}

function disposeTree(root, keep) {
  // Skeletons are collected and disposed after the walk because one is shared
  // by every skinned mesh of a rig — disposing in place would run it nine times
  // per soldier.
  const skeletons = new Set();
  root.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    // MEASURED: this line is most of the leak it exists to close. A cloned rig
    // gets its own Skeleton, and a Skeleton owns a BONE TEXTURE — one per
    // skinned mesh, nine per soldier, ~1100 per 64-soldier match. It is not a
    // material map, so the sweep below never sees it, and three's own texture
    // count climbed by that much on every restart until this was here.
    if (o.skeleton && !keep.has(o.skeleton)) skeletons.add(o.skeleton);
    for (const m of materialsOf(o)) {
      if (keep.has(m)) continue;
      for (const t of texturesOf(m)) if (!keep.has(t)) t.dispose();
      m.dispose();
    }
  });
  for (const s of skeletons) s.dispose();
}

const BLUE_NAMES = ['Reyes', 'Okafor', 'Tanaka', 'Silva', 'Novak', 'Baptiste', 'Kowalski', 'Iversen', 'Mbeki', 'Duarte', 'Halvorsen', 'Cross', 'Vega', 'Antar', 'Riley', 'Song', 'Petrov', 'Lindqvist', 'Moreau', 'Adeyemi', 'Castillo', 'Brandt', 'Oyelaran', 'Whitaker', 'Nakamura', 'Sorenson', 'Blake', 'Ferreira', 'Zhou', 'Kaminski', 'Dubois'];
const RED_NAMES = ['Zar\'Kul', 'Vestam', 'Ontar', 'Krellus', 'Sar\'Vek', 'Molvane', 'Teth', 'Uzek', 'Rathkar', 'Volsun', 'Ekar', 'Themos', 'Drax', 'Onvelu', 'Kaidon', 'Serevu', 'Tulkar', 'Wren', 'Ossek', 'Varn', 'Ilmar', 'Zetes', 'Korag', 'Mendu', 'Sulvan', 'Orrek', 'Talvu', 'Nezar', 'Ukam', 'Rhoss', 'Ventar', 'Ghelan'];

export class Game {
  constructor(scene, camera, assets, dom, mapDef, mapData, session) {
    this.scene = scene;
    this.camera = camera;
    this.assets = assets;
    this.session = session || null;
    // What was in the scene BEFORE this match existed — the camera, and nothing
    // else today. `dispose` removes every root-level child that is not in here,
    // which covers the world, the soldiers, the vehicles, the structures and the
    // tracer pools without any of them having to register anything.
    this._sceneBaseline = new Set(scene.children);
    // The match's rule set, resolved ONCE and frozen. Until now the lobby's
    // game-type selector wrote `session.gameType` and nothing read it; this is
    // the line that makes the choice mean something. A scripted or headless
    // match with no session gets SECTOR CONTROL, which is what it has always
    // silently been. See rules.js for what belongs here versus in `CFG`.
    this.rules = resolveRules(this.session ? this.session.gameType : 'conquest');
    this.playerTeam = TEAM.BLUE;
    // the session owns the loadout so lobby customization carries into the game
    // No session (a scripted/headless match) gets its own kit; otherwise this
    // reads through to the session every time — see the getter below.
    this._soloLoadout = session ? null : validateLoadout(makeLoadout('assault'));
    // Read through to the session rather than capturing the reference here, the
    // way arena.js already does. Switching loadout slot on the deploy screen
    // repoints session.playerLoadout at a different stored kit, and a captured
    // reference would leave the match still holding the kit you started on.
    Object.defineProperty(this, 'playerLoadout', {
      get: () => (this.session ? this.session.playerLoadout : this._soloLoadout),
    });

    this.world = new World(scene, mapDef, mapData);
    this.audio = new GameAudio(this);
    this.audio.init(assets.audio);
    this.combat = new Combat(this);
    // Null in modes with no resource economy, and every caller is written to
    // read that as "everything is free" rather than as a missing system.
    this.logistics = this.rules.resources ? new Logistics(this, this.rules.resources) : null;
    this.supply = new Supply(this);
    this.structures = new Structures(this);
    // Before `prewarm`, for the same reason the beam pool below is: the hogs
    // are in the scene when the match compiles, so their 26 textures upload
    // behind the loading bar instead of hitching the first frame one is in view.
    this.vehicles = new VehicleManager(this);
    this.hud = new Hud(this);
    // Said once, because it never changes inside a match. A counter labelled
    // TICKETS that only ever goes up would misread the mode at a glance.
    this.hud.setCounterLabel(this.rules.victory === 'chain' ? 'SECTORS' : 'TICKETS');
    this.hud.setMaterielVisible(!!this.rules.resources);
    // Built HERE, before `prewarm`, and that ordering is the whole point: the
    // pool's lights are in the scene when the match compiles its materials, so
    // the compile happens once behind the loading bar instead of the first time
    // anyone welds. See createBeamPool for why the light count must not move.
    this.beams = createBeamPool(this.scene, WEAPONS.repairtool.tool.beam, getSetting('beamLights'));
    this._unsubSettings = onSettingChange((key, value) => {
      if (key !== 'beamLights') return;
      this.beams.dispose();
      this.beams = createBeamPool(this.scene, WEAPONS.repairtool.tool.beam, value);
    });

    // A mode may own its starting count — what a counter starts at only means
    // something next to what drains it. Silence here means `CFG.tickets`.
    const startTickets = this.rules.tickets ?? CFG.tickets;
    this.teams = [
      { id: TEAM.BLUE, soldiers: [], squads: [], tickets: startTickets, brain: null },
      { id: TEAM.RED, soldiers: [], squads: [], tickets: startTickets, brain: null },
    ];
    this.allSoldiers = [];
    this.gameOver = false;
    this.playerDead = false;
    this.playerRespawnTimer = 0;
    this.bleedAccum = 0;
    this.elapsed = 0;
    this.paused = false;
    this.timeScale = 1;
    this.spectating = false;
    this.spectatedSoldier = null; // deploy-screen helmet-cam target

    this._buildTeams();

    this.player = new Player(this, camera, dom);
    this.playerPos = this.player.pos;

    this.teams[TEAM.BLUE].brain = new TeamBrain(this, TEAM.BLUE);
    this.teams[TEAM.RED].brain = new TeamBrain(this, TEAM.RED);

    this._initialDeploy();
  }

  _buildTeams() {
    const defs = [
      { team: TEAM.BLUE, names: BLUE_NAMES },
      { team: TEAM.RED, names: RED_NAMES },
    ];
    for (const def of defs) {
      const t = this.teams[def.team];
      const sqNames = squadNames(def.team);
      const numSquads = Math.ceil(CFG.teamSize / CFG.squadSize);
      for (let q = 0; q < numSquads; q++) t.squads.push(new Squad(def.team, sqNames[q]));

      let nameIdx = 0;
      for (let i = 0; i < CFG.teamSize; i++) {
        const squad = t.squads[Math.floor(i / CFG.squadSize)];
        const isPlayer = def.team === this.playerTeam && i === 0;
        const label = isPlayer ? 'You' : `${squad.name[0]}-${(i % CFG.squadSize) + 1} ${def.names[nameIdx++ % def.names.length]}`;
        const cls = isPlayer ? this.playerLoadout.cls : CFG.squadComposition[i % CFG.squadComposition.length];
        // AI kits come from the same slot pools the armoury offers, so a squad
        // is a mix and an AI can never carry something a player could not.
        const kit = isPlayer ? this.playerLoadout : randomLoadout(cls);
        const primary = kit.primary;
        const secondary = kit.secondary;
        // Blue wears the class's model (spartan vs marine); red is always Covenant
        const char = def.team === TEAM.BLUE
          ? this.assets.characters[CLASSES[cls].model] || this.assets.characters.marine
          : this.assets.characters.elite;
        const s = new Soldier(this, def.team, squad, label, char, cls, primary, secondary);
        s.setGadgets(kit.gadgets, kit.grenade);
        s.isPlayer = isPlayer;
        if (isPlayer) {
          this.playerSoldier = s;
          s.mesh.visible = false;
        }
        squad.addMember(s);
        t.soldiers.push(s);
        this.allSoldiers.push(s);
      }
    }
    // Alpha squad escorts the player
    this.teams[this.playerTeam].squads[0].followPlayer = true;
    this.playerSquad = this.teams[this.playerTeam].squads[0];
  }

  // Switch the player to the other team (deploy screen only, while not fielded).
  setPlayerTeam(team) {
    if (team === this.playerTeam || !this.playerDead || this.gameOver) return false;
    const p = this.playerSoldier;
    this.joinSquad(null);
    const oldArr = this.teams[this.playerTeam].soldiers;
    const i = oldArr.indexOf(p);
    if (i >= 0) oldArr.splice(i, 1);
    this.playerTeam = team;
    p.team = team;
    this.teams[team].soldiers.push(p);
    // body model: Covenant is always the Elite; UNSC follows the class
    const charKey = team === TEAM.RED ? 'elite' : (CLASSES[p.cls].model || 'marine');
    const char = this.assets.characters[charKey];
    if (char) p.setCharacter(char);
    this.joinSquad(this.teams[team].squads[0]);
    return true;
  }

  // Join a squad (or null to go lone wolf). The joined squad escorts the
  // player; the departed squad returns to team-brain control.
  joinSquad(squad) {
    if (squad === this.playerSquad) return;
    const p = this.playerSoldier;
    if (this.playerSquad) {
      const arr = this.playerSquad.members;
      const i = arr.indexOf(p);
      if (i >= 0) arr.splice(i, 1);
      this.playerSquad.followPlayer = false;
    }
    this.playerSquad = squad || null;
    p.squad = this.playerSquad;
    if (squad) {
      squad.members.push(p);
      squad.followPlayer = true;
    }
  }

  _initialDeploy() {
    for (const t of this.teams) {
      const hq = this.world.hqDefs[t.id];
      t.soldiers.forEach((s, i) => {
        const a = (i / t.soldiers.length) * Math.PI * 2;
        const r = 8 + (i % 5) * 3.5;
        s.spawnAt(hq.x + Math.cos(a) * r, hq.z + Math.sin(a) * r);
      });
      t.brain?.replan();
    }
    // Player starts undeployed — they enter via the deploy map screen.
    this.playerSoldier.alive = false;
    if (this.playerSoldier.mesh) this.playerSoldier.mesh.visible = false;
    this.playerDead = true;
    this.playerRespawnTimer = 0;
    this.teams[TEAM.BLUE].brain.replan();
    this.teams[TEAM.RED].brain.replan();
  }

  // A soldier hit the ground but is not gone. No ticket, no kill feed entry and
  // no respawn timer — all three are paid in onKill if the bleedout runs out.
  // For the player specifically: the deploy screen must NOT open and the
  // pointer lock must NOT be dropped. Being downed is still being in the match.
  onDown(victim, attacker) {
    this.hud.setPrompt(null);
    if (victim.isPlayer) {
      this.player.firing = false;
      this.player.ads = false;
      this.player.reviving = false;
      this.player.giveUpHeld = 0;
      this.player.viewmodel.visible = false;
      // Same reason as onKill: a casualty is on the ground, not in the seat.
      // It also has to come out here or `updateDowned` and the seat camera
      // would both be writing the camera on the same frame.
      if (this.player.vehicle) this.player.exitVehicle();
      // The key prompts live in the persistent prompt line while downed (see
      // player.updateDowned), so this only has to name the state.
      this.hud.message('DOWNED', 2.5);
    } else if (attacker && attacker.isPlayer) {
      this.hud.message(`${victim.name} DOWN`, 1.2);
    }
  }

  onRevive(victim, by) {
    if (victim.isPlayer) {
      const p = this.player;
      p.viewmodel.visible = !p.freecam && !p.thirdPerson;
      p.eye = CFG.player.eyeHeight;
      p.giveUpHeld = 0;
      this.hud.setDowned(0, false);
      this.hud.setPrompt(null);
      this.hud.message(by ? `PICKED UP BY ${by.name}` : 'PICKED UP', 2.5);
      this.audio.playUI('revived');
    } else if (by && by.isPlayer) {
      this.hud.message(`${victim.name} BACK UP`, 1.5);
      this.audio.playUI('revived');
    }
  }

  onKill(attacker, victim) {
    this.hud.addKill(attacker, victim);
    // AXIS: death cost. In SECTOR CONTROL a body is a ticket; in a territorial
    // mode this is 0 and the death is paid for in position and materiel
    // instead. Nothing else about dying changes between the modes.
    this.teams[victim.team].tickets -= this.rules.deathCost;
    if (victim.isPlayer) {
      this.hud.setDowned(0, false);
      this.hud.setPrompt(null);
      this.playerDead = true;
      this.playerRespawnTimer = CFG.player.respawnDelay;
      this.player.firing = false;
      // Dying in a hog has to give the seat back. It was survivable while the
      // body was hidden in a vehicle; now that a rider is drawn, skipping this
      // leaves a corpse sitting in the passenger seat holding the slot shut.
      if (this.player.vehicle) this.player.exitVehicle();
      document.exitPointerLock();
      if (this.deployScreen) this.deployScreen.show('dead', attacker ? attacker.name : null);
    }
  }

  onPlayerDamaged(shooter) {
    this.hud.showDamage();
    // Plate gone, whichever kind it was. For a Spartan it means "wait four
    // seconds"; for a marine it means "that is not coming back" — the same cue
    // for two very different pieces of news, which is worth splitting once there
    // is a second sound to split it with.
    if (this.playerSoldier.plate <= 0) this.audio.playUI('shieldLow');
    this.hud.notePlayerAwareShot(shooter);
  }

  // A beacon took a hit. Only the destruction is worth saying, and only to the
  // two people it means something to: the squad whose spawn just went away, and
  // whoever took it away. Routed through here rather than messaged from
  // combat.js so the "who cares about this" question lives with the rest of the
  // match state and not in the bullet path.
  onBeaconHit(beacon, attacker, destroyed) {
    if (!destroyed) return;
    if (beacon.squad && beacon.squad === this.playerSquad) {
      this.hud.message('RALLY BEACON DESTROYED', 3);
    } else if (attacker && attacker.isPlayer) {
      this.hud.message('ENEMY RALLY BEACON DESTROYED', 2.5);
    }
  }

  // Spawn the player at an exact point (the deploy screen owns spawn choice + jitter).
  deployPlayerAt(x, z) {
    if (this.playerRespawnTimer > 0 || !this.playerDead || this.gameOver) return false;
    this.playerDead = false;
    this.player.spawnAt(x, z);
    return true;
  }

  // Walk off the field on purpose: the ESC menu's REDEPLOY. A real death, not a
  // teleport — the deaths column, the ticket and the respawn timer are all paid,
  // because a free trip back to the spawn menu would be the cheapest way to
  // cross the map. `die` does the rest, including opening the deploy screen.
  redeploy() {
    if (this.gameOver || this.playerDead) return false;
    const p = this.playerSoldier;
    // Giving up while DOWNED is a kill for whoever put you there — that is what
    // the SPACE hold already does, and `die` credits `downedBy` for it. Walking
    // off under your own power is nobody's kill, and `downedBy` survives a
    // revive, so it has to be cleared or a redeploy an hour later still pays out
    // to the soldier who once knocked you over.
    if (!p.downed) p.downedBy = null;
    p.die(p.downed ? p.downedBy : null);
    return true;
  }

  // Tear the match down. After this the Game is dead: `update` must never run
  // again and the caller drops the reference (see main.js teardownMatch).
  //
  // ORDER MATTERS. The deploy screen goes first because its tactical-map style
  // MUTATES shared asset materials — left dimmed, half the armoury would follow
  // the player back to the lobby at 50% opacity. Then the subsystems that own
  // scene objects, so their own disposals run; the scene sweep is the backstop
  // for everything nobody claimed.
  dispose() {
    this.gameOver = true;   // anything still holding a reference stops simulating
    if (this._unsubSettings) this._unsubSettings();
    if (this.deployScreen) this.deployScreen.dispose();
    if (this.hud) this.hud.dispose();
    if (this.player) this.player.dispose();
    if (this.beams) this.beams.dispose();
    if (this.vehicles) this.vehicles.dispose();
    if (this.structures) this.structures.dispose();
    if (this.supply) this.supply.dispose();
    if (this.audio) this.audio.dispose();

    const keep = collectShared(this.assets);
    for (const child of [...this.scene.children]) {
      if (this._sceneBaseline.has(child)) continue;
      this.scene.remove(child);
      disposeTree(child, keep);
    }
    // Both are the World's, and whatever comes next (lobby, armoury, the next
    // match) sets its own. `scene.environment` is main.js's and stays.
    this.scene.fog = null;
    this.scene.background = null;

    this.deployScreen = null;
    this.armory = null;
    this.pauseMenu = null;
    if (this.session && this.session.deployScreen) this.session.deployScreen = null;
  }

  // Menu-open state lives on the session so the armory works pre-game too.
  get menuOpen() {
    return this.session ? this.session.menuOpen : this._menuOpen || false;
  }
  set menuOpen(v) {
    if (this.session) this.session.menuOpen = v;
    else this._menuOpen = v;
  }

  // "Is any screen holding the keyboard?", derived rather than remembered.
  //
  // Each screen used to recompute the flag from the OTHER one on the way out —
  // deploy.hide asked the armoury, menu.hide asked deploy. That works for
  // exactly two screens and silently breaks at three: whichever one closed last
  // would clear a flag the third still needs. Asking all of them, in one place,
  // is the version that survives a fourth.
  // The session owns `menuOpen` (see above), outlives every match, and holds the
  // same three screens — and it needs this method in its own right, because the
  // armoury is handed the session as its host before a Game exists. So when
  // there is a session it owns the derivation too: one copy, not two to drift.
  refreshMenuOpen() {
    if (this.session) { this.session.refreshMenuOpen(); return; }
    this.menuOpen = !!(
      (this.armory && this.armory.visible)
      || (this.deployScreen && this.deployScreen.visible)
      || (this.pauseMenu && this.pauseMenu.visible)
    );
  }

  // True when the player's soldier is an active combatant on the field. A
  // downed player is on the field but is not a combatant — squads should not
  // form up on a casualty, so this has to say no.
  playerActive() {
    return !this.playerDead && !this.spectating && !this.playerSoldier.downed;
  }

  setPaused(p) {
    this.paused = p;
    this.hud.setTimeControls(this.paused, this.timeScale);
  }
  setTimeScale(s) {
    this.timeScale = s;
    if (this.paused) this.paused = false;
    this.hud.setTimeControls(this.paused, this.timeScale);
  }
  togglePause() { this.setPaused(!this.paused); }

  // Off-screen passes that must run before the main render.
  renderScopes(renderer) {
    this.player.renderScope(renderer, this.scene);
  }

  // Compile and upload everything the first FPS frame would otherwise pay for.
  // Call this LAST in match setup: three keys programs on the scene's light
  // counts, so anything that adds a light afterwards (the deploy screen) throws
  // the whole cache away.
  async prewarm(renderer) {
    // Mount the kit the player actually spawns with, so its materials — and a
    // scope screen's driven variant — are the ones that get compiled.
    this.player.applyLoadout(this.playerLoadout);
    // The 64 soldiers and the map are already in the scene and draw themselves;
    // the clones cover weapons and characters nobody happens to be holding or
    // wearing yet. `offscreen` because a match renders through render targets
    // as well as to the canvas (scope screens, the deploy map's outline pass),
    // and those need their own program set — see prewarm's header.
    await prewarm(renderer, this.scene, this.camera,
      [...weaponClones(this.assets), ...characterClones(this.assets)],
      { offscreen: true });
    // The scope pass renders through its own target, so warm that path too.
    this.player.renderScope(renderer, this.scene);
    // The deploy map is a third render path again (dimmed materials), and it is
    // the first thing the player ever sees of a match.
    if (this.deployScreen) await this.deployScreen.prewarm(renderer);
  }

  cycleTimeScale() {
    const seq = [1, 2, 4, 8];
    this.setTimeScale(seq[(seq.indexOf(this.timeScale) + 1) % seq.length]);
  }

  // The live tactical map (M): the deploy screen again, in a mode where nothing
  // is being chosen. The sim keeps running underneath — you are standing on the
  // field with your hands off the controls, which is the cost of looking.
  //
  // `show()` BEFORE `exitPointerLock()` is load-bearing. show sets `menuOpen`,
  // and that flag is the whole reason pausemenu does not read the dropped lock
  // as a request for the settings menu (see pausemenu._onLockChange).
  toggleMap() {
    const d = this.deployScreen;
    if (!d) return false;
    if (d.visible) return this.closeMap();
    // Downed is excluded on purpose: the bleedout bar and the give-up prompt
    // live in the FPS chrome that map mode hides, so this would take away the
    // only readout that matters while it is running.
    if (this.gameOver || this.playerDead || this.menuOpen || this.playerSoldier.downed) return false;
    d.show('live');
    document.exitPointerLock();
    return true;
  }

  // No-op unless the LIVE map is up. The dead/undeployed map is not dismissible
  // — there is nowhere to dismiss it to — so ESC has to fall through it.
  closeMap() {
    const d = this.deployScreen;
    if (!d || !d.visible || d.mode !== 'live' || d.transition) return false;
    d.returnToFps();
    return true;
  }

  toggleFreecam() {
    if (this.gameOver || this.playerDead) return; // the map screen is the dead/undeployed view
    this.spectating = !this.spectating;
    this.player.setFreecam(this.spectating);
    this.hud.setModeTag(this.spectating ? 'FREECAM — F TO EXIT' : null);
  }

  update(dtReal) {
    if (this.gameOver) return;
    const dt = Math.min(dtReal, 0.05);
    this.audio.update();
    this.world.updateAmbient(dt);

    // Player / camera. Downed is its own branch: `playerDead` is false — the
    // player is not dead — but the full controller must not run, because
    // `player.update` owns movement, firing and the eye height.
    if (this.spectating) {
      this.player.updateFreecam(dt);
    } else if (!this.paused) {
      if (this.playerSoldier.downed) this.player.updateDowned(dt);
      else if (!this.playerDead) this.player.update(dt);
    }
    this.hud.setDowned(
      this.playerSoldier.downed ? this.playerSoldier.downTimer / CFG.downed.bleedout : 0,
      this.playerSoldier.downed,
    );
    if (this.playerDead) {
      this.playerRespawnTimer -= dtReal;
      if (this.deployScreen) this.deployScreen.setTimer(this.playerRespawnTimer);
    }

    // Simulation (substepped so 8x stays numerically identical to 8 real frames)
    if (!this.paused) {
      for (let i = 0; i < this.timeScale; i++) this._simStep(dt);
    }

    // A driver's camera is placed HERE, after the step, not in `player.update`
    // with every other camera. It reads the chassis transform, and in
    // `player.update` that transform is a frame stale — at 25 m/s, 40 cm of
    // visible judder. Input still goes in above; only the eye waits.
    if (!this.spectating && this.player.vehicle) this.player.updateVehicleCamera(dt);

    // Every beam requested this frame, drawn at once. After the sim, because a
    // welder's position is only final once it has moved; once per RENDERED
    // frame, not per sim substep, which is why requests are keyed by welder and
    // an 8x substep still produces one beam per soldier.
    this.beams.commit(dt, this.camera.position);

    // HUD (real-time, even when paused)
    this.hud.setVitals(this.playerSoldier.plate, this.playerSoldier.health,
      this.playerSoldier.plateMax, this.playerSoldier.plateKind);
    this.hud.setStamina(this.playerSoldier.stamina, this.playerSoldier.maxStamina,
      this.playerSoldier.staminaUnlimited, this.playerSoldier.exhausted);
    this.hud.updateSectors(this.world.sectors);
    // One readout, whatever the mode actually counts. A mode won by taking the
    // map counts SECTORS — a frozen ticket pair that can never move would be
    // two numbers pretending to be a scoreboard.
    if (this.rules.victory === 'chain') {
      let blue = 0, red = 0;
      for (const s of this.world.sectors) {
        if (s.owner === TEAM.BLUE) blue++; else if (s.owner === TEAM.RED) red++;
      }
      this.hud.setTickets(blue, red);
    } else {
      this.hud.setTickets(this.teams[0].tickets, this.teams[1].tickets);
    }
    if (this.logistics) {
      const p = this.playerSoldier;
      const at = this.player.vehicle || p;
      const depot = this.logistics.supplyAt(this.playerTeam, at.pos.x, at.pos.z);
      this.hud.setSupply(depot ? depot.stock : null, at.cargo || 0);
    }
    this.hud.updateSquadList(this.playerSquad);
    const sq = this.playerSquad;
    const nearest = this._nearestObjectiveText();
    this.hud.setOrder(!sq || (sq.followPlayer && this.playerActive())
      ? nearest
      : `${sq.orderType} ${sq.objective ? sq.objective.id : ''}`);
    this.hud.update(dtReal);

    this._checkWin();
  }

  _simStep(dt) {
    this.elapsed += dt;

    // Team brains + squads
    const followPos = this.playerActive() ? this.player.pos : null;
    const wasLeader = this.playerSquad && this.playerSquad.leader === this.playerSoldier;
    for (const t of this.teams) {
      t.brain.update(dt);
      for (const sq of t.squads) {
        sq.refreshLeader();
        // Before the beacon and the follow rules: a squad on a supply run owns
        // its own objective, and the two below both read it.
        sq.updateSupply(this, dt);
        sq.updateBeacon(dt, this);
        sq.updateFollow(followPos);
        sq.updateVehicleFollow(this);
        sq.updateVehicleUse(this, dt);
      }
    }
    // Told once, on the edge. The player inherits the job silently otherwise —
    // usually the moment the bot ahead of them in the list goes down — and an
    // ability you were never told you had is one nobody presses.
    if (this.playerSquad && !wasLeader && this.playerSquad.leader === this.playerSoldier) {
      this.hud.message('YOU ARE SQUAD LEADER — B TO PLANT A RALLY BEACON', 4);
    }

    // Soldiers (player's body vitals are simulated in its update too)
    for (const s of this.allSoldiers) {
      s.update(dt);
      // `downed` is the one case where a soldier is not alive and must not be
      // recycled — the body is still recoverable, and its `deadTimer` has not
      // started (die() resets it, so the respawn clock runs from the death).
      if (!s.alive && !s.downed && !s.isPlayer && s.deadTimer > CFG.soldier.respawnDelay) {
        this._respawnAI(s);
      }
    }

    this._updateCapture(dt);
    this._updateEconomy(dt);
    this.combat.update(dt);
    if (this.logistics) this.logistics.update(dt);
    this.supply.update(dt);
    this.structures.update(dt);
    this.vehicles.update(dt);
  }

  _nearestObjectiveText() {
    // With nothing to take, every verb below is a lie — and the order line is
    // the one piece of HUD that tells the player what the mode IS. Point them
    // at the fight instead, which is the only thing a skirmish asks of them.
    if (this.rules.objectives === 'none') {
      let near = null, nearD = Infinity;
      for (const s of this.world.sectors) {
        if (!s.contested) continue;
        const d = Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z);
        if (d < nearD) { nearD = d; near = s; }
      }
      return near ? `ENGAGE ${near.id}` : 'ENGAGE';
    }
    // Suggest the closest non-friendly or contested sector as the player's objective
    let best = null, bestD = Infinity;
    for (const s of this.world.sectors) {
      // Under a chain, a nearer enemy sector the player is not allowed to take
      // is the wrong place to send them — the order line is the one piece of
      // HUD that says what the mode wants from you.
      if (s.owner !== this.playerTeam && !this.capturable(s, this.playerTeam)) continue;
      const score = (s.owner !== this.playerTeam ? 0 : s.contested ? 200 : 100000);
      const d = Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z) + score;
      if (d < bestD) { bestD = d; best = s; }
    }
    if (!best) return 'HOLD';
    return best.owner !== this.playerTeam ? `CAPTURE ${best.id}` : best.contested ? `DEFEND ${best.id}` : `HOLD ${best.id}`;
  }

  // Everywhere a soldier of this team can come back WITHOUT a rally: HQ, plus
  // any sector they hold uncontested. Shared, because the squad beacon rule in
  // ai.js measures a rally's worth against exactly this list — if the two ever
  // disagreed, squads would plant rallies to shorten walks they were not
  // actually making.
  //
  // AXIS: spawn set. `id` is carried on every option because the deploy screen
  // builds its marker list from this same call — the player's spawn rules and
  // the AI's were written out twice before, which meant every future mode would
  // have had to state its topology twice and keep the two honest.
  spawnOptionsFor(team) {
    const R = this.rules.spawn;
    const hq = this.world.hqDefs[team];
    const opts = [];
    if (R.hq) opts.push({ id: 'hq', x: hq.x, z: hq.z });
    if (R.sectors === 'held') {
      for (const sec of this.world.sectors) {
        if (sec.owner === team && !sec.contested) opts.push(sec);
      }
    } else if (R.sectors === 'frontmost') {
      // The tip of this team's run down the chain, and only that — spawning
      // three sectors back is the distance tax that replaces the ticket in a
      // mode where dying costs no score. If the tip is CONTESTED it is skipped
      // for the next one back: a spawn you are currently losing a fight over
      // is a meat grinder, and the existing 'held' rule refuses those for the
      // same reason.
      const c = this.world.chain;
      const f = this.front();
      const step = team === TEAM.BLUE ? -1 : 1;
      for (let i = team === TEAM.BLUE ? f.bIdx : f.rIdx; i >= 0 && i < c.length; i += step) {
        if (c[i].owner === team && !c[i].contested) { opts.push(c[i]); break; }
      }
    }
    // A team with nowhere to come back is a soft-locked match, not a hard mode.
    // Whatever a rule set says, HQ is the floor — `deploy.js` also falls back to
    // the literal id 'hq' when a selection goes stale, and that has to resolve.
    if (!opts.length) opts.push({ id: 'hq', x: hq.x, z: hq.z });
    return opts;
  }

  // Distance from a point to the nearest of those. The squad beacon rule reads
  // this against the OBJECTIVE, not against the leader: a dead bot respawns at
  // whichever spawn is closest to where the squad is going.
  nearestSpawnDist(team, x, z) {
    let best = Infinity;
    for (const o of this.spawnOptionsFor(team)) {
      const d = Math.hypot(o.x - x, o.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  _respawnAI(s) {
    // The squad's rally outranks every sector, and outranks them absolutely
    // rather than by distance. That IS the ability: a leader planting one is
    // saying "come back HERE", and a beacon the AI weighed against a nearer
    // sector would be a rally that only ever worked for the player — 31 of the
    // 32 soldiers on a side would keep trickling in from the rear.
    const rally = s.squad && s.squad.beacon;
    if (rally) {
      const a = Math.random() * Math.PI * 2;
      const r = CFG.beacon.spawnRadius * (0.45 + Math.random() * 0.55);
      s.spawnAt(rally.pos.x + Math.cos(a) * r, rally.pos.z + Math.sin(a) * r);
      const obj = s.squad.objective;
      if (obj) { s.waypoint.set(obj.x, obj.y, obj.z); s.hasWaypoint = true; }
      return;
    }

    // Spawn at HQ or a safely-held sector nearest the squad objective
    const options = this.spawnOptionsFor(s.team);
    let pick = options[0];
    const obj = s.squad.objective;
    if (obj) {
      let bestD = Infinity;
      for (const o of options) {
        const d = Math.hypot(o.x - obj.x, o.z - obj.z);
        if (d < bestD) { bestD = d; pick = o; }
      }
    }
    const a = Math.random() * Math.PI * 2;
    s.spawnAt(pick.x + Math.cos(a) * 10, pick.z + Math.sin(a) * 10);
    if (obj) { s.waypoint.set(obj.x, obj.y, obj.z); s.hasWaypoint = true; }
  }

  // AXIS: objective topology. Whether the rules let this sector change hands at
  // all, right now. 'open' is every sector always — five points live at once,
  // which is what makes the current game read as Battlefield. A chain lattice
  // answers from adjacency and produces a frontline instead; when it lands, it
  // lands HERE and nowhere else. Consulted by `_updateCapture` and by the team
  // brain in ai.js, which must not send squads at a point nobody can take.
  // `team` omitted asks "can ANYONE take this", which is what a sector ring
  // wants to know. Passing it asks "can THIS team", which is what the team
  // brain wants — and the two are different questions under a chain, where
  // blue's next target and red's are opposite ends of the same map. Answering
  // the loose question for both would march blue squads at red's front, where
  // they can stand forever without the bar moving.
  capturable(sec, team) {
    if (this.rules.objectives !== 'capture') return false;
    if (this.rules.lattice === 'open') return true;
    const f = this.front();
    if (team === TEAM.BLUE) return sec === f.blueNext;
    if (team === TEAM.RED) return sec === f.redNext;
    return sec === f.blueNext || sec === f.redNext;
  }

  // Where each team's unbroken run down the chain ends, and therefore the one
  // sector each may push into. Everything the chain lattice does is read off
  // this: what is capturable, where you may spawn, and whether someone has run
  // out of map.
  //
  // CONTIGUITY, not "highest index owned", and the difference is the whole
  // correctness of the thing. A team that has had a sector taken from BEHIND
  // its front must retake that one — the naive version lets them leapfrog it
  // and the front silently becomes two fronts, which is the mode's one
  // premise gone.
  //
  // Recomputed per call rather than cached: it is a walk over five sectors,
  // and a cache would need invalidating on every capture, on respawn and on
  // the deploy screen's per-frame revalidation. Measure before optimising.
  front() {
    const c = this.world.chain;
    let b = -1;
    while (b + 1 < c.length && c[b + 1].owner === TEAM.BLUE) b++;
    let r = c.length;
    while (r - 1 >= 0 && c[r - 1].owner === TEAM.RED) r--;
    return {
      bIdx: b, rIdx: r,
      blueNext: b + 1 < c.length ? c[b + 1] : null,
      redNext: r - 1 >= 0 ? c[r - 1] : null,
      // Nowhere left for the other side to stand. Not a score condition — a
      // team with no ground left is not owed a countdown.
      blueAll: c.length > 0 && b === c.length - 1,
      redAll: c.length > 0 && r === 0,
    };
  }

  _updateCapture(dt) {
    for (const sec of this.world.sectors) {
      let blue = 0, red = 0;
      for (const s of this.allSoldiers) {
        if (!s.alive) continue;
        if (s.isPlayer && this.spectating) continue;
        if (Math.hypot(s.pos.x - sec.x, s.pos.z - sec.z) <= sec.r) {
          if (s.team === TEAM.BLUE) blue++; else red++;
        }
      }
      // Contested is reported whether or not the sector is takeable: people ARE
      // fighting in it, and a locked point that reads as calm would be a lie
      // the HUD tells. Only the progress bar is gated.
      sec.contested = blue > 0 && red > 0;
      const net = Math.max(-3, Math.min(3, blue - red));
      if (net !== 0) {
        const dir = net > 0 ? 1 : -1; // + toward blue
        const attackingTeam = dir > 0 ? TEAM.BLUE : TEAM.RED;
        if (sec.owner !== attackingTeam) {
          // AXIS: objective topology. Asked of the team actually pushing, not
          // of the sector in the abstract — a chain sector that is red's next
          // target is not thereby blue's, and letting blue bank progress in it
          // would let them skip the sector in between and break the front into
          // two. Under 'open' this is always true and the branch vanishes.
          if (!this.capturable(sec, attackingTeam)) { this._tintSector(sec); continue; }
          sec.progress += dir * Math.abs(net) * CFG.captureRate * dt;
          if (sec.progress >= 100) this._captureSector(sec, TEAM.BLUE);
          else if (sec.progress <= -100) this._captureSector(sec, TEAM.RED);
        } else {
          // owner reinforcing pushes progress back to their pole
          sec.progress = Math.max(-100, Math.min(100, sec.progress + dir * Math.abs(net) * CFG.captureRate * dt));
        }
      } else if (blue === 0 && red === 0 && sec.owner === null) {
        sec.progress *= Math.max(0, 1 - dt * 0.15); // slow decay toward neutral
      }
      this._tintSector(sec);
    }
  }

  _captureSector(sec, team) {
    if (sec.owner === team) return;
    sec.owner = team;
    sec.progress = team === TEAM.BLUE ? 100 : -100;
    const name = team === TEAM.BLUE ? 'UNSC' : 'COVENANT';
    this.hud.message(`${name} CAPTURED SECTOR ${sec.id}`, 3);
    // captures prompt both brains to react soon
    this.teams[0].brain.timer = Math.min(this.teams[0].brain.timer, 1.5);
    this.teams[1].brain.timer = Math.min(this.teams[1].brain.timer, 1.5);
  }

  _tintSector(sec) {
    const c = sec.owner === TEAM.BLUE ? CFG.colors.blue : sec.owner === TEAM.RED ? CFG.colors.red : 0xcccccc;
    sec.ringMat.color.setHex(sec.contested ? 0xffd66e : c);
    sec.beamMat.color.setHex(c);
  }

  // AXIS: economy — what the counter measures. Attrition is the only currency
  // implemented; a territorial mode adds its accrual as a sibling branch here
  // rather than as a second rate on this one, because the two count different
  // things in different directions (see GAME_TYPE_PLAN.md → "Two economies").
  _updateEconomy(dt) {
    if (this.rules.economy === 'attrition') this._bleedTickets(dt);
  }

  // What a placement costs, and whether it can be paid for FROM HERE. The
  // position arguments are the whole difference between this and a team pool:
  // materiel is somewhere, and a build reaches for the nearest depot that has
  // it. A mode with no `resources` block answers 0 / true / true rather than
  // making every call site check first, which is what keeps the gate in
  // structures.js and supply.js to one line each and free everywhere else.
  costOf(key) {
    const R = this.rules.resources;
    return (R && R.cost[key]) || 0;
  }

  canAfford(team, key, x, z) {
    if (!this.logistics) return true;
    return this.logistics.canDraw(team, x, z, this.costOf(key));
  }

  spend(team, key, x, z) {
    if (!this.logistics) return true;
    return this.logistics.draw(team, x, z, this.costOf(key));
  }

  _bleedTickets(dt) {
    this.bleedAccum += dt;
    if (this.bleedAccum >= CFG.bleedInterval) {
      this.bleedAccum -= CFG.bleedInterval;
      let blueHeld = 0, redHeld = 0;
      for (const s of this.world.sectors) {
        if (s.owner === TEAM.BLUE) blueHeld++;
        else if (s.owner === TEAM.RED) redHeld++;
      }
      const majority = Math.ceil(this.world.sectors.length / 2);
      if (blueHeld >= majority) this.teams[TEAM.RED].tickets -= (blueHeld - majority + 1);
      if (redHeld >= majority) this.teams[TEAM.BLUE].tickets -= (redHeld - majority + 1);
    }
  }

  // AXIS: victory. Only the CONDITION is per-mode; the end screen below is not,
  // which is why the two are split — a score target or a full-chain capture
  // should arrive at the same place by a different route.
  _checkWin() {
    if (this.gameOver) return;
    if (this.rules.victory === 'ticketsZero') {
      if (this.teams[0].tickets <= 0 || this.teams[1].tickets <= 0) {
        this._endMatch(this.teams[1 - this.playerTeam].tickets <= 0);
      }
      return;
    }
    if (this.rules.victory === 'chain') {
      // The map is the scoreboard. Take every sector or the match does not end
      // — no clock, no counter, no tiebreak. Owner's call; two sides dug in
      // with neither advancing has no resolution, and a clock is the smallest
      // fix if that turns out to be the common case.
      const f = this.front();
      if (f.blueAll) this._endMatch(this.playerTeam === TEAM.BLUE);
      else if (f.redAll) this._endMatch(this.playerTeam === TEAM.RED);
    }
  }

  _endMatch(win) {
    this.gameOver = true;
    const p = this.playerSoldier;
    const mins = Math.floor(this.elapsed / 60);
    const secs = Math.floor(this.elapsed % 60);
    this.hud.showEnd(win, `${p.kills} kills · ${p.deaths} deaths · match time ${mins}:${String(secs).padStart(2, '0')}`);
  }
}
