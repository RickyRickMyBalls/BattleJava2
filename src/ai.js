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
    this.vehicle = null;     // the hog this squad has claimed, if any
    this.boardTimer = 0;     // seconds spent walking to a claimed, empty vehicle
    // Both on the SQUAD rather than on the leader: leadership moves when a
    // leader goes down, and a cooldown carried on the man would reset with him
    // — a squad could re-plant every time it lost someone.
    this.beaconCooldown = 0;
    this.beaconTimer = Math.random() * CFG.beacon.ai.checkInterval; // stagger
    // A live supply run: { depot, leg }. `leg` is 'load' while the squad is
    // fetching from HQ and 'deliver' once it has something to drop off. Null
    // for every squad that is simply fighting, which is most of them.
    this.supplyRun = null;
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

  // A squad on a supply run, one tick.
  //
  // THIS IS WHY THE MODE WORKS AT ALL. A player cannot feed 31 AI squadmates,
  // and if only the player hauls then the front dries up everywhere they are
  // not standing. Bots have to run supply or the economy is decorative.
  //
  // The run is deliberately expressed as nothing but a moving objective: leg
  // 'load' points the squad at its own HQ, leg 'deliver' points it at the depot
  // that needs it. `updateVehicleUse` already knows how to get a squad to its
  // objective by road, and `_move` already knows how to walk there — so a
  // supply run is a destination that changes twice, not a new kind of order.
  updateSupply(game, dt) {
    if (!this.supplyRun) return;
    const logi = game.logistics;
    const lead = this.leader;
    if (!logi || !lead || !lead.alive) { this.supplyRun = null; return; }

    // What is doing the carrying: the hog if the squad has one, else the
    // leader's back. The walking case is slow and small and completely valid —
    // it is what keeps a team with no vehicle from being locked out entirely.
    const carrier = this.vehicle || lead;
    const cap = this.vehicle
      ? game.rules.resources.vehicleCargo
      : game.rules.resources.backpack;

    if (this.supplyRun.leg === 'load') {
      // Full enough to be worth the drive back. Not "completely full": the last
      // few units take as long as the first many and the front needs it now.
      if (carrier.cargo >= cap * 0.9) this.supplyRun.leg = 'deliver';
    } else if (carrier.cargo <= 0.01) {
      // Delivered. Ending the run here rather than looping means the brain gets
      // to re-decide whether this squad is still the right one to be doing it —
      // the front may have moved, or this may now be the only squad alive on a
      // sector under attack.
      this.supplyRun = null;
      return;
    }

    // The destination may have fallen to the enemy mid-run, which is an
    // entirely ordinary thing to happen to a supply line. RETARGET rather than
    // abandon: cancelling here left loaded Warthogs parked in fields for the
    // rest of the match — 750 materiel in three hogs on one measured run —
    // because a squad only unloads at a depot it is being sent to.
    if (this.supplyRun.depot.sec && this.supplyRun.depot.sec.owner !== this.team) {
      const next = logi.neediestDepot(this.team, null);
      if (!next) { this.supplyRun = null; return; }
      this.supplyRun.depot = next;
    }
    const dest = this.supplyRun.leg === 'load'
      ? logi.hqDepot(this.team)
      : this.supplyRun.depot;
    if (!dest) { this.supplyRun = null; return; }

    const y = game.world.heightAt(dest.x, dest.z);
    if (!this.objective || this.objective.x !== dest.x || this.objective.z !== dest.z) {
      this.setObjective({ id: dest.kind === 'hq' ? 'HQ' : dest.sec.id, x: dest.x, y, z: dest.z },
        this.supplyRun.leg === 'load' ? 'RESUPPLY' : 'DELIVER');
    }
  }

  // Alpha squad escorts the player when they're alive.
  updateFollow(playerPos) {
    if (!this.followPlayer || !playerPos) return;
    for (const m of this.members) {
      if (m.isPlayer) continue;
      if (m.vehicle) continue;      // riding: the seat owns them, not the waypoint
      m.waypoint.copy(playerPos);
      m.hasWaypoint = true;
    }
  }

  // Mount up with the player.
  //
  // This is the first thing that ever CALLS `Soldier.mount` — 7a built the
  // capability and nothing decided to use it, so squadmates walked to the hog
  // you were sitting in and then stood next to it. `updateFollow` above already
  // brings them, because a seated player's `pos` IS the seat; all that was
  // missing was the last two metres.
  //
  // Deliberately narrow: it boards the squad onto the vehicle THE PLAYER IS IN
  // and nothing else. A bot deciding on its own that a hog across the map is
  // worth walking to is the squad-level call in 7c, and it needs a driver AI to
  // be worth anything.
  updateVehicleFollow(game) {
    if (!this.followPlayer) return;
    const V = CFG.vehicle;
    const veh = game.playerActive() ? game.player.vehicle : null;
    for (const m of this.members) {
      if (m.isPlayer || !m.alive || m.downed) continue;
      // Only ever undo what this method did, which is what `seatReason` marks.
      // Getting this wrong the obvious way — testing "is the member in a
      // vehicle other than the player's" first — silently swallows the case
      // that matters: with the player on foot the player's vehicle is null, so
      // EVERY seated member matched "somewhere else" and the dismount below was
      // unreachable. The squad stayed in the hog after the player walked off.
      if (m.vehicle && m.vehicle !== veh) {
        if (m.seatReason === 'follow') m.dismount();
        continue;
      }
      if (!veh) continue;
      if (m.vehicle === veh) continue;                       // already aboard
      // You cannot jump onto a moving Warthog, and letting a bot do it means
      // squadmates teleporting into a hog doing 20 m/s past them.
      if (veh.speed > V.ai.boardSpeed) continue;
      if (m.pos.distanceTo(veh.pos) > V.ai.boardRange) continue;
      const i = veh.nearestFreeSeat(m.pos, ['drive']);
      if (i >= 0 && m.mount(veh, i)) m.seatReason = 'follow';
    }
  }

  // A squad using a vehicle on its own. This is the squad-level call the plan
  // asks for: whether to DRIVE to the objective rather than walk, decided once
  // for the squad rather than per soldier, because a Warthog with one marine in
  // it and three jogging behind is worse than either.
  //
  // Split from `updateVehicleFollow` on purpose. That one exists to keep a
  // squad with its player, and the player is driving; this one has no player in
  // it and therefore needs a driver, a destination and a reason to get out
  // again. Sharing a method would mean every branch asking which case it was in.
  updateVehicleUse(game, dt) {
    // The player's squad, while the player is on the field, is theirs to lead.
    if (this.followPlayer && game.playerActive()) { this._releaseVehicle(); return; }
    const V = CFG.vehicle;
    const A = V.ai;
    const lead = this.leader;
    if (!lead || !this.objective) { this._releaseVehicle(); return; }

    const objX = this.objective.x, objZ = this.objective.z;

    if (this.vehicle) {
      const v = this.vehicle;
      if (v.flipped) { this._releaseVehicle(); return; }
      // A CLAIMED vehicle is not yet a CREWED one, and conflating the two was
      // a loop: claim it, see no crew, release it, re-claim it next frame,
      // forever, with the squad never given the seconds it needs to walk over.
      // So the empty case gets a grace period instead of an immediate release,
      // and the timeout is what covers a hog nobody can actually reach.
      const aboard = this.members.some((m) => m.vehicle === v);
      if (aboard) this.boardTimer = 0;
      else {
        this.boardTimer += dt || 0;
        if (this.boardTimer > A.boardTimeout) { this._releaseVehicle(); return; }
      }
      const dist = Math.hypot(v.pos.x - objX, v.pos.z - objZ);
      // Arrived. Everyone out — VEHICLE_PLAN.md open question 6 answers this:
      // capturing is done on foot, because dismounting is far more readable
      // than a hog spinning circles on a control point.
      // Arrived — everyone out, because capturing is done on foot. EXCEPT on a
      // supply run: arriving at HQ is the halfway point, not the end, and a
      // crew that piles out to watch the hog load has no way to drive it back.
      // The transfer happens to the vehicle whether or not anyone is sitting
      // in it, so staying aboard costs nothing and keeps the run alive.
      if (dist <= A.dismountRange && !this.supplyRun) { this._releaseVehicle(); return; }
      const driver = v.seats[0].occupant;
      if (driver && driver.driver) {
        if (!driver.driveTarget) driver.driveTarget = new THREE.Vector3();
        driver.driveTarget.set(objX, 0, objZ);
      }
      // Anyone still on foot walks to the vehicle rather than to the objective,
      // and boards when they reach it.
      for (const m of this.members) {
        if (m.isPlayer || !m.alive || m.downed || m.vehicle) continue;
        // The formation offset is CANCELLED here, not merely ignored. `_move`
        // walks to `waypoint + formationOffset`, so aiming the raw vehicle
        // position parks the squad in formation AROUND the hog — the outermost
        // slot is 6.7 m out and stops 2.5 m short of that, so it never comes
        // inside `boardRange` and the squad stands there admiring the vehicle
        // forever. Subtracting the offset puts each marine's own destination on
        // the door instead.
        m.waypoint.set(v.pos.x - m.formationOffset.x, v.pos.y, v.pos.z - m.formationOffset.z);
        m.hasWaypoint = true;
        if (v.speed <= A.boardSpeed && m.pos.distanceTo(v.pos) <= A.boardRange) {
          // THE WHEEL FIRST, always. Nearest-seat is right for the player's
          // squad piling into a hog the player is already driving; here it
          // produced three marines in the back of a stationary Warthog, because
          // they walked up from behind and the tailgate was nearest. A squad
          // that took a vehicle in order to drive somewhere has to fill the one
          // seat that makes that possible before it fills any other.
          const i = v.seats[0].occupant ? v.nearestFreeSeat(m.pos) : 0;
          if (i >= 0 && m.mount(v, i)) m.seatReason = 'squad';
        }
      }
      return;
    }

    // No vehicle yet. Only worth one if the walk is long enough that driving
    // wins even after the detour to reach it.
    const toObj = Math.hypot(lead.pos.x - objX, lead.pos.z - objZ);
    if (toObj < A.driveMinDist) return;
    const v = this._findVehicle(game, lead);
    if (!v) return;
    // Claim it, so two squads converging on the same hog do not each walk their
    // whole strength to it and split across two half-crews.
    this.vehicle = v;
    v.claimedBy = this;
    // Nobody is assigned to the wheel here. The boarding loop above takes the
    // NEAREST free seat, so whoever arrives first drives — which is what you
    // want, because naming a driver in advance strands the squad whenever that
    // one marine is the furthest away or dies on the walk over.
  }

  // The nearest vehicle with nobody in it, within reach and not already spoken
  // for by another squad. Uncrewed rather than "has a free seat": a squad that
  // piles into somebody else's half-full hog leaves both squads split.
  _findVehicle(game, lead) {
    const A = CFG.vehicle.ai;
    const list = game.vehicles ? game.vehicles.vehicles : null;
    if (!list) return null;
    let best = null, bestD = A.seekRange;
    for (const v of list) {
      if (v.crewed || v.flipped) continue;
      // The player's. Left alone even when the player is nowhere near it and
      // even when it is the only thing on the field — a hog that is only
      // sometimes there is worse than one that never is, because you plan
      // around the one you can rely on.
      if (v.reserved) continue;
      if (v.claimedBy && v.claimedBy !== this) continue;
      const d = lead.pos.distanceTo(v.pos);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }

  _releaseVehicle() {
    if (!this.vehicle) return;
    for (const m of this.members) {
      if (!m.isPlayer && m.vehicle === this.vehicle && m.seatReason === 'squad') m.dismount();
    }
    if (this.vehicle.claimedBy === this) this.vehicle.claimedBy = null;
    this.vehicle = null;
    this.boardTimer = 0;
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

    // Squads mid-run keep their orders. Reassigning one to a sector fight
    // halfway through a haul strands its cargo and wastes the whole drive —
    // the run ends itself when the cargo is delivered, and the squad comes back
    // into the pool on the next replan.
    const free = squads.filter((s) => !s.supplyRun);
    this._planSupply(free);
    const fighters = free.filter((s) => !s.supplyRun);
    if (!fighters.length) return;

    // AXIS: objective topology, first half. With no prizes on the map the
    // scoring below has nothing to score — every sector filters out, the bail
    // fires, and 64 soldiers stand at their spawns waiting for an order that
    // cannot come. So a mode without objectives gets the other reason to walk
    // somewhere: the sectors are still the map's landmarks, and the best one
    // is wherever the enemy already is. Squads converge, fight, and re-converge
    // when the crowd moves — which is the whole of a deathmatch's tactics.
    if (this.game.rules.objectives === 'none') {
      const jobs = sectors.map((sec) => ({
        sec, type: 'ENGAGE', weight: 1 + this._enemyPresence(sec), cap: 2,
      }));
      this._assign(fighters, jobs);
      return;
    }

    // Score sectors: defend owned-but-threatened, attack nearest not-owned.
    const jobs = [];
    for (const sec of sectors) {
      // Second half: a sector the rules will not let anyone take is not a job.
      // Under a chain lattice, scoring it anyway masses squads on a point they
      // can stand in forever without the bar moving. Sectors we already OWN
      // stay jobs regardless: holding is not capturing.
      if (sec.owner !== this.team && !this.game.capturable(sec, this.team)) continue;
      if (sec.owner === this.team) {
        const threat = this._enemyPresence(sec);
        if (threat > 0) jobs.push({ sec, type: 'DEFEND', weight: 3 + threat, cap: 2 });
        else jobs.push({ sec, type: 'HOLD', weight: 0.6, cap: 1 });
      } else {
        const defense = this._enemyPresence(sec);
        jobs.push({ sec, type: sec.owner === null ? 'CAPTURE' : 'ATTACK', weight: 2 + (sec.owner !== null ? 0.5 : 1) - defense * 0.15, cap: 3 });
      }
    }
    this._assign(fighters, jobs);
  }

  // How many squads this team should have hauling right now, and who.
  //
  // The rule is deliberately need-driven rather than a fixed detail: a team
  // whose forward depots are full has nothing to haul and every squad should be
  // fighting. A team that has just pushed into a new sector has an empty depot
  // at the front and should send someone. That way the logistics load rises and
  // falls with the front instead of permanently taxing the team a squad.
  _planSupply(squads) {
    const logi = this.game.logistics;
    if (!logi || !squads.length) return;
    const hq = logi.hqDepot(this.team);
    if (!hq || hq.stock < 50) return;                     // nothing to give

    const R = this.game.rules.resources;
    const running = this.game.teams[this.team].squads.filter((s) => s.supplyRun).length;
    // Never more than a third of the team on trucks, and never the last squad —
    // a team that logistics itself to death holds nothing to deliver to.
    const maxRuns = Math.max(1, Math.floor(this.game.teams[this.team].squads.length / 3));
    if (running >= maxRuns) return;

    const front = this.game.rules.lattice === 'chain'
      ? (this.team === TEAM.BLUE ? this.game.front().blueNext : this.game.front().redNext)
      : null;
    const depot = logi.neediestDepot(this.team, front);
    // A depot already holding a comfortable buffer is not worth a squad. The
    // threshold is expressed in what it BUYS — four walls' worth — rather than
    // as a bare number, so retuning the costs retunes this with them.
    if (!depot || depot.stock >= R.cost.wall * 4) return;

    // Nearest free squad to the HQ they will be loading at: the run starts with
    // a drive to HQ, so the squad already closest to it loses the least fight
    // time. Explicitly NOT the squad nearest the depot — that one is usually
    // the one holding the sector the supplies are for.
    let best = null, bestD = Infinity;
    for (const sq of squads) {
      const lead = sq.members.find((m) => m.alive);
      if (!lead) continue;
      const d = Math.hypot(lead.pos.x - hq.x, lead.pos.z - hq.z);
      if (d < bestD) { bestD = d; best = sq; }
    }
    if (!best) return;
    best.supplyRun = { depot, leg: 'load' };
  }

  // Greedy: each squad to the best remaining job, preferring near squads.
  // Split out of `replan` when SKIRMISH arrived — how a team WEIGHS the map is
  // per-mode, how it then hands out the work is not.
  _assign(squads, jobs) {
    // Only reachable if a rule set locked every sector this team does not
    // already own. Bail rather than fall through to `jobs[0]` at the bottom.
    if (!jobs.length) return;
    jobs.sort((a, b) => b.weight - a.weight);

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
