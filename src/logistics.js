// The supply network: HQs make materiel, somebody carries it forward, the
// front spends what actually arrived.
//
// The rule the whole system turns on:
//
//   HQ is a SOURCE. A sector is a DEPOT. Nothing moves between them by itself.
//
// So a wall at the front costs 25 materiel *that somebody drove there*, and a
// team whose supply line is cut still holds its ground but stops being able to
// improve it. That is the Foxhole / Hell Let Loose shape, and it is why this is
// a network of stockpiles rather than one number per team: a team-wide pool
// would let a squad at the front spend materiel sitting in a warehouse eighty
// seconds' drive away, which is exactly the decision the mode exists to make.
//
// WHICH WAY MATERIEL FLOWS IS DECIDED BY WHERE YOU ARE STANDING, not by a key
// press or a menu:
//
//   at your HQ        -> you LOAD   (stockpile -> your cargo)
//   at your sector    -> you UNLOAD (your cargo -> that sector's depot)
//
// That is the entire interface. Drive to HQ, wait, drive to the front, wait.
// It needs no UI, it reads identically for a player and for a bot, and there is
// no state to get stuck in — which matters when 63 of the 64 soldiers on the
// field are AI who will never be told what a load button is.

export class Logistics {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;                     // rules.resources, never null here
    this.depots = [];

    const world = game.world;
    for (const hq of world.hqDefs) {
      // HQs start FULL. A mode whose first ninety seconds are everyone standing
      // around an empty warehouse teaches the wrong lesson about itself.
      this.depots.push({
        kind: 'hq', team: hq.team, sec: null,
        x: hq.x, z: hq.z, stock: cfg.hqMax, cap: cfg.hqMax,
      });
    }
    for (const sec of world.sectors) {
      // Sectors start EMPTY and are not owned yet. Everything a front has, it
      // was given.
      this.depots.push({
        kind: 'sector', team: null, sec,
        x: sec.x, z: sec.z, stock: 0, cap: cfg.sectorMax,
      });
    }
  }

  // A sector depot belongs to whoever holds the sector — which means capturing
  // a stocked sector CAPTURES ITS SUPPLIES. Deliberate: it makes a well-fed
  // front worth taking rather than merely worth killing, and it punishes
  // stockpiling at a sector you cannot hold. The alternative (burn it on
  // capture) is one line here if it plays better.
  teamOf(d) {
    return d.kind === 'hq' ? d.team : d.sec.owner;
  }

  // Nearest friendly depot to a point, within `radius`. Used with the small
  // `transferRadius` for loading and the larger `supplyRadius` for building.
  nearest(team, x, z, radius, needStock = 0) {
    let best = null, bestD = radius;
    for (const d of this.depots) {
      if (this.teamOf(d) !== team) continue;
      if (d.stock < needStock) continue;
      const dist = Math.hypot(d.x - x, d.z - z);
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  // Can a build at this spot be paid for out of something nearby, and then:
  // take it. Split so a placement can be TESTED without being charged — see the
  // note on structures.canPlaceAt, which asks the first and never the second.
  canDraw(team, x, z, amount) {
    if (amount <= 0) return true;
    return !!this.nearest(team, x, z, this.cfg.supplyRadius, amount);
  }

  draw(team, x, z, amount) {
    if (amount <= 0) return true;
    const d = this.nearest(team, x, z, this.cfg.supplyRadius, amount);
    if (!d) return false;
    d.stock -= amount;
    return true;
  }

  update(dt) {
    const R = this.cfg;
    for (const d of this.depots) {
      if (d.kind === 'hq') d.stock = Math.min(d.cap, d.stock + R.produce * dt);
    }

    const amt = R.transferRate * dt;
    // Vehicles before soldiers, and riders skipped below: a marine in the back
    // of a hog must not be filling their own backpack out of the same depot the
    // hog is drinking from, or a full crew multiplies a run by five.
    const vlist = this.game.vehicles ? this.game.vehicles.vehicles : null;
    if (vlist) for (const v of vlist) this._serve(v, v.team, R.vehicleCargo, amt, true);
    for (const s of this.game.allSoldiers) {
      if (!s.alive || s.vehicle) continue;
      // WHO MAY LOAD is not the same question as who may unload. Letting every
      // bot top up a backpack just by respawning at HQ drained 1500 out of a
      // home stockpile in two minutes on reinforcement traffic alone, and none
      // of it was a decision anybody made. So: a bot loads only while its squad
      // is actually on a run. The player always may — standing at your own HQ
      // is a choice, and it is the one piece of this the player performs by
      // hand. Unloading stays open to everyone, always, so materiel that ended
      // up on the wrong person still reaches a depot when they walk past one.
      const mayLoad = s.isPlayer || !!(s.squad && s.squad.supplyRun);
      this._serve(s, s.team, R.backpack, amt, mayLoad);
    }
  }

  // One carrier, one tick. `carrier` is anything with `.pos` and a `.cargo`
  // number — a Soldier or a Vehicle; neither knows this file exists.
  _serve(carrier, team, cap, amt, mayLoad) {
    if (team === null || team === undefined) return;
    const d = this.nearest(team, carrier.pos.x, carrier.pos.z, this.cfg.transferRadius);
    if (!d) return;
    if (d.kind === 'hq') {
      if (!mayLoad) return;
      const take = Math.min(amt, cap - carrier.cargo, d.stock);
      if (take > 0) { d.stock -= take; carrier.cargo += take; }
    } else {
      const give = Math.min(amt, carrier.cargo, d.cap - d.stock);
      if (give > 0) { carrier.cargo -= give; d.stock += give; }
    }
  }

  // --------------------------------------------------------------- queries --

  // The depot a build here would draw from, for the HUD to report BEFORE the
  // player commits. Nothing else should need this.
  supplyAt(team, x, z) {
    return this.nearest(team, x, z, this.cfg.supplyRadius);
  }

  stockOf(sec) {
    for (const d of this.depots) if (d.sec === sec) return d.stock;
    return 0;
  }

  hqDepot(team) {
    return this.depots.find((d) => d.kind === 'hq' && d.team === team) || null;
  }

  // The friendly sector depot most in need of a run: held, and hungriest.
  // `front` biases toward the sector nearest the fighting, since a full depot
  // three sectors back is not what anyone is short of.
  neediestDepot(team, front) {
    let best = null, bestScore = Infinity;
    for (const d of this.depots) {
      if (d.kind !== 'sector' || this.teamOf(d) !== team) continue;
      let score = d.stock;
      if (front) score += Math.hypot(d.x - front.x, d.z - front.z) * 0.5;
      if (score < bestScore) { bestScore = score; best = d; }
    }
    return best;
  }
}

// A carrier's speed while hand-carrying. Vehicles are unaffected — a Warthog
// with 250 in the back drives like a Warthog, because the interesting cost of a
// vehicle run is the exposure, not the handling.
export function carryScale(soldier) {
  const R = soldier.game.rules.resources;
  if (!R || !soldier.cargo) return 1;
  return R.carryPenalty ?? 1;
}
