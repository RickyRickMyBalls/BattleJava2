// Team brain + squads. The squad is the strategic unit: the team brain assigns
// squads to sectors; soldiers do their own local combat (soldier.js).

import * as THREE from 'three';
import { CFG, TEAM, BEACON } from './config.js';

const SQUAD_NAMES_BLUE = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
const SQUAD_NAMES_RED = ['Zealot', 'Vanguard', 'Talon', 'Fury', 'Havoc', 'Wrath', 'Umbra', 'Sable'];

const FORMATION = [
  [0, 0], [-3, -2.5], [3, -2.5], [0, -5], [-5, -4.5], [5, -4.5], [0, -8],
];

const A = CFG.beacon.ai;

export class Squad {
  constructor(team, name) {
    this.team = team;
    this.name = name;
    this.members = [];
    this.objective = null;   // sector ref
    this.orderType = 'MOVE';
    this.followPlayer = false;
    this.leader = null;      // see refreshLeader — a position, never a class
    this.beacon = null;      // live rally beacon, or null. structures.js owns it
    // Both on the SQUAD rather than on the leader: leadership moves when a
    // leader goes down, and a cooldown carried on the man would reset with him
    // — a squad could re-plant every time it lost someone.
    this.beaconCooldown = 0;
    this.beaconTimer = Math.random() * CFG.beacon.ai.checkInterval; // stagger
  }

  addMember(soldier) {
    const idx = this.members.length;
    this.members.push(soldier);
    const f = FORMATION[idx % FORMATION.length];
    soldier.formationOffset.set(f[0], 0, f[1]);
    if (!this.leader) this.leader = soldier;
  }

  // Who leads. A POSITION, not a class and not a loadout: the leader is whoever
  // holds the job this frame, and it moves the instant its holder cannot do it.
  // Two rules, in order:
  //   1. A living player leads any squad they are in. They joined it to command
  //      it — `followPlayer` already makes the squad move on them — so a bot
  //      nominally outranking the player would be a lie the HUD has to tell.
  //   2. Otherwise the senior survivor: first in `members`, which is spawn
  //      order, so leadership walks down a stable list rather than jittering
  //      between bots as they trade damage.
  //
  // A DOWNED leader is not a leader, and that is the rule that earns its keep:
  // bleeding out is precisely when a squad most needs someone able to plant a
  // rally, and a casualty cannot. Same reason a dead one is not, which also
  // covers the player sitting on the deploy screen — a bot leads until they
  // are back on the field.
  //
  // Cheap enough to run every frame (16 squads x 4), and running it every frame
  // is what makes it truthful: no promotion event to forget to fire.
  refreshLeader() {
    const fit = (m) => !!m && m.alive && !m.downed;
    let next = null;
    for (const m of this.members) {
      if (m.isPlayer && fit(m)) { next = m; break; }
      if (!next && fit(m)) next = m;
    }
    // Assigned unconditionally from `members`, never patched from the old
    // value: a player who left this squad is no longer a candidate, so the
    // stale leader cannot survive the switch.
    this.leader = next;
    return next;
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

  // Should the leader plant a rally, and if so, do it. Squad-level rather than
  // soldier-level on purpose: this is the one decision in the game that is
  // about where the SQUAD comes back to, and no individual bot has the standing
  // to make it.
  //
  // One quantity decides it — how much of the walk a rally here would save:
  //     d(nearest spawn -> objective) - d(leader -> objective)
  // because `game._respawnAI` sends a dead bot to the spawn nearest the
  // OBJECTIVE and walks it in from there. When that number is large the squad
  // is fighting somewhere its own reinforcements cannot reach quickly, which is
  // the entire problem a rally exists to solve. See CFG.beacon.ai for why the
  // obvious "plant when near the objective" rule was measured and discarded.
  updateBeacon(dt, game) {
    if (this.beaconCooldown > 0) this.beaconCooldown = Math.max(0, this.beaconCooldown - dt);
    this.beaconTimer -= dt;
    if (this.beaconTimer > 0) return;
    this.beaconTimer = A.checkInterval;
    if (this.beaconCooldown > 0) return;

    const leader = this.leader;
    // The player's own rally is the player's call. A bot planting one for the
    // squad they are leading would spend the ability out from under them.
    if (!leader || leader.isPlayer) return;
    // A squad following the player has no objective of its own to measure
    // against — the player IS the objective.
    if (this.followPlayer && game.playerActive()) return;
    const obj = this.objective;
    if (!obj) return;

    // The team's rally slots. Checked before the geometry because it is the
    // cheaper question, and because a squad that already holds one is only ever
    // replacing it — that is net-zero and must not be blocked by a full board.
    if (!this.beacon && game.structures.count(this.team, 'beacon') >= A.maxPerTeam) return;

    const spawnToObj = game.nearestSpawnDist(this.team, obj.x, obj.z);
    const saved = spawnToObj - Math.hypot(leader.pos.x - obj.x, leader.pos.z - obj.z);
    if (saved < A.minSaved) return;

    // An existing rally is replaced only once it has stopped earning its keep,
    // not whenever the leader could do marginally better — otherwise a squad
    // re-plants on every advance and the beacon never means anything.
    if (this.beacon) {
      const held = spawnToObj - Math.hypot(this.beacon.pos.x - obj.x, this.beacon.pos.z - obj.z);
      if (held >= A.staleSaved) return;
    }

    // `place` owns legality — ground, overlap, and the enemy-proximity rule
    // that stops a rally going down in the middle of a firefight. A refusal is
    // a short retry rather than a full cooldown, because "enemies too close" is
    // a temporary fact about a place the squad still wants to hold.
    const made = game.structures.place(leader, BEACON);
    this.beaconCooldown = made ? A.cooldown : A.retry;
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
