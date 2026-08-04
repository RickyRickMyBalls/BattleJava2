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

const BLUE_NAMES = ['Reyes', 'Okafor', 'Tanaka', 'Silva', 'Novak', 'Baptiste', 'Kowalski', 'Iversen', 'Mbeki', 'Duarte', 'Halvorsen', 'Cross', 'Vega', 'Antar', 'Riley', 'Song', 'Petrov', 'Lindqvist', 'Moreau', 'Adeyemi', 'Castillo', 'Brandt', 'Oyelaran', 'Whitaker', 'Nakamura', 'Sorenson', 'Blake', 'Ferreira', 'Zhou', 'Kaminski', 'Dubois'];
const RED_NAMES = ['Zar\'Kul', 'Vestam', 'Ontar', 'Krellus', 'Sar\'Vek', 'Molvane', 'Teth', 'Uzek', 'Rathkar', 'Volsun', 'Ekar', 'Themos', 'Drax', 'Onvelu', 'Kaidon', 'Serevu', 'Tulkar', 'Wren', 'Ossek', 'Varn', 'Ilmar', 'Zetes', 'Korag', 'Mendu', 'Sulvan', 'Orrek', 'Talvu', 'Nezar', 'Ukam', 'Rhoss', 'Ventar', 'Ghelan'];

export class Game {
  constructor(scene, camera, assets, dom, mapDef, mapData, session) {
    this.scene = scene;
    this.camera = camera;
    this.assets = assets;
    this.session = session || null;
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
    this.supply = new Supply(this);
    this.structures = new Structures(this);
    // Before `prewarm`, for the same reason the beam pool below is: the hogs
    // are in the scene when the match compiles, so their 26 textures upload
    // behind the loading bar instead of hitching the first frame one is in view.
    this.vehicles = new VehicleManager(this);
    this.hud = new Hud(this);
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

    this.teams = [
      { id: TEAM.BLUE, soldiers: [], squads: [], tickets: CFG.tickets, brain: null },
      { id: TEAM.RED, soldiers: [], squads: [], tickets: CFG.tickets, brain: null },
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
    this.teams[victim.team].tickets -= 1;
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
    this.hud.setTickets(this.teams[0].tickets, this.teams[1].tickets);
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
    this._updateTickets(dt);
    this.combat.update(dt);
    this.supply.update(dt);
    this.structures.update(dt);
    this.vehicles.update(dt);
  }

  _nearestObjectiveText() {
    // Suggest the closest non-friendly or contested sector as the player's objective
    let best = null, bestD = Infinity;
    for (const s of this.world.sectors) {
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
  spawnOptionsFor(team) {
    const opts = [{ x: this.world.hqDefs[team].x, z: this.world.hqDefs[team].z }];
    for (const sec of this.world.sectors) {
      if (sec.owner === team && !sec.contested) opts.push(sec);
    }
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
      sec.contested = blue > 0 && red > 0;
      const net = Math.max(-3, Math.min(3, blue - red));
      if (net !== 0) {
        const dir = net > 0 ? 1 : -1; // + toward blue
        const attackingTeam = dir > 0 ? TEAM.BLUE : TEAM.RED;
        if (sec.owner !== attackingTeam) {
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

  _updateTickets(dt) {
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

  _checkWin() {
    if (this.teams[0].tickets <= 0 || this.teams[1].tickets <= 0) {
      this.gameOver = true;
      const win = this.teams[1 - this.playerTeam].tickets <= 0;
      const p = this.playerSoldier;
      const mins = Math.floor(this.elapsed / 60);
      const secs = Math.floor(this.elapsed % 60);
      this.hud.showEnd(win, `${p.kills} kills · ${p.deaths} deaths · match time ${mins}:${String(secs).padStart(2, '0')}`);
    }
  }
}
