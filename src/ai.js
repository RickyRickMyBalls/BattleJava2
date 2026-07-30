// Team brain + squads. The squad is the strategic unit: the team brain assigns
// squads to sectors; soldiers do their own local combat (soldier.js).

import * as THREE from 'three';
import { CFG, TEAM } from './config.js';

const SQUAD_NAMES_BLUE = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
const SQUAD_NAMES_RED = ['Zealot', 'Vanguard', 'Talon', 'Fury', 'Havoc', 'Wrath', 'Umbra', 'Sable'];

const FORMATION = [
  [0, 0], [-3, -2.5], [3, -2.5], [0, -5], [-5, -4.5], [5, -4.5], [0, -8],
];

export class Squad {
  constructor(team, name) {
    this.team = team;
    this.name = name;
    this.members = [];
    this.objective = null;   // sector ref
    this.orderType = 'MOVE';
    this.followPlayer = false;
  }

  addMember(soldier) {
    const idx = this.members.length;
    this.members.push(soldier);
    const f = FORMATION[idx % FORMATION.length];
    soldier.formationOffset.set(f[0], 0, f[1]);
  }

  aliveCount() {
    let n = 0;
    for (const m of this.members) if (m.alive) n++;
    return n;
  }

  setObjective(sector, orderType) {
    this.objective = sector;
    this.orderType = orderType;
    for (const m of this.members) {
      if (m.isPlayer) continue;
      m.waypoint.set(sector.x, sector.y, sector.z);
      m.hasWaypoint = true;
    }
  }

  // Alpha squad escorts the player when they're alive.
  updateFollow(playerPos) {
    if (!this.followPlayer || !playerPos) return;
    for (const m of this.members) {
      if (m.isPlayer) continue;
      m.waypoint.copy(playerPos);
      m.hasWaypoint = true;
    }
  }
}

export class TeamBrain {
  constructor(game, team) {
    this.game = game;
    this.team = team;
    this.timer = 1 + Math.random();
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = CFG.ai.squadReplanInterval * (0.85 + Math.random() * 0.3);
    this.replan();
  }

  replan() {
    const sectors = this.game.world.sectors;
    // A follow-player squad plans for itself only while the player is on the field
    const squads = this.game.teams[this.team].squads.filter(
      (s) => s.aliveCount() > 0 && !(s.followPlayer && this.game.playerActive())
    );
    if (!squads.length) return;

    // Score sectors: defend owned-but-threatened, attack nearest not-owned.
    const jobs = [];
    for (const sec of sectors) {
      if (sec.owner === this.team) {
        const threat = this._enemyPresence(sec);
        if (threat > 0) jobs.push({ sec, type: 'DEFEND', weight: 3 + threat, cap: 2 });
        else jobs.push({ sec, type: 'HOLD', weight: 0.6, cap: 1 });
      } else {
        const defense = this._enemyPresence(sec);
        jobs.push({ sec, type: sec.owner === null ? 'CAPTURE' : 'ATTACK', weight: 2 + (sec.owner !== null ? 0.5 : 1) - defense * 0.15, cap: 3 });
      }
    }
    jobs.sort((a, b) => b.weight - a.weight);

    // Greedy: each squad to best remaining job, preferring near squads.
    const unassigned = new Set(squads);
    for (const job of jobs) {
      let n = 0;
      while (n < job.cap && unassigned.size) {
        let best = null, bestD = Infinity;
        for (const sq of unassigned) {
          const lead = sq.members.find((m) => m.alive);
          if (!lead) { unassigned.delete(sq); continue; }
          const d = Math.hypot(lead.pos.x - job.sec.x, lead.pos.z - job.sec.z);
          if (d < bestD) { bestD = d; best = sq; }
        }
        if (!best) break;
        unassigned.delete(best);
        best.setObjective(job.sec, job.type);
        n++;
      }
      if (!unassigned.size) break;
    }
    // Leftovers pile onto the highest-weight job
    for (const sq of unassigned) sq.setObjective(jobs[0].sec, jobs[0].type);
  }

  _enemyPresence(sector) {
    const enemy = this.game.teams[this.team === TEAM.BLUE ? TEAM.RED : TEAM.BLUE];
    let n = 0;
    for (const s of enemy.soldiers) {
      if (!s.alive) continue;
      if (Math.hypot(s.pos.x - sector.x, s.pos.z - sector.z) < sector.r * 2.2) n++;
    }
    return n;
  }
}

export function squadNames(team) {
  return team === TEAM.BLUE ? SQUAD_NAMES_BLUE : SQUAD_NAMES_RED;
}
