// Match orchestrator: teams, squads, spawning, capture logic, tickets, win state.

import * as THREE from 'three';
import { CFG, TEAM, CLASSES } from './config.js';
import { makeLoadout, randomLoadout, validateLoadout } from './loadout.js';
import { World } from './world.js';
import { Soldier } from './soldier.js';
import { Squad, TeamBrain, squadNames } from './ai.js';
import { Combat } from './combat.js';
import { Player } from './player.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
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
    this.hud = new Hud(this);

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
      this.hud.message('DOWNED — HOLD SPACE TO GIVE UP', 4);
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
      this.hud.message(by ? `PICKED UP BY ${by.name}` : 'PICKED UP', 2.5);
    } else if (by && by.isPlayer) {
      this.hud.message(`${victim.name} BACK UP`, 1.5);
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
      document.exitPointerLock();
      if (this.deployScreen) this.deployScreen.show('dead', attacker ? attacker.name : null);
    }
  }

  onPlayerDamaged(shooter) {
    this.hud.showDamage();
    if (this.playerSoldier.shield <= 0) this.audio.playUI('shieldLow');
    this.hud.notePlayerAwareShot(shooter);
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
    // wearing yet.
    await prewarm(renderer, this.scene, this.camera,
      [...weaponClones(this.assets), ...characterClones(this.assets)]);
    // The scope pass renders through its own target, so warm that path too.
    this.player.renderScope(renderer, this.scene);
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

    // HUD (real-time, even when paused)
    this.hud.setVitals(this.playerSoldier.shield, this.playerSoldier.health, this.playerSoldier.maxShield);
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
    for (const t of this.teams) {
      t.brain.update(dt);
      for (const sq of t.squads) sq.updateFollow(followPos);
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

  _respawnAI(s) {
    // Spawn at HQ or a safely-held sector nearest the squad objective
    const options = [{ x: this.world.hqDefs[s.team].x, z: this.world.hqDefs[s.team].z }];
    for (const sec of this.world.sectors) {
      if (sec.owner === s.team && !sec.contested) options.push(sec);
    }
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
