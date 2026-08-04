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
    // A hog the PLAYER is driving is theirs to load, by hand, off the wheel —
    // otherwise parking at HQ would silently fill it and driving through a
    // friendly sector would silently empty it again, which is the whole reason
    // the wheel exists.
    const pv = this.game.player ? this.game.player.vehicle : null;
    if (vlist) for (const v of vlist) {
      if (v !== pv) this._serve(v, v.team, R.vehicleCargo, amt, true);
    }
    for (const s of this.game.allSoldiers) {
      if (!s.alive || s.vehicle) continue;
      // THE PLAYER IS NOT SERVED AUTOMATICALLY, IN EITHER DIRECTION. Every
      // transfer they make is one they asked for on the wheel. A bot has no
      // wheel, so it keeps the automatic rule — and loads only while its squad
      // is on a run, because letting every marine top up just by respawning at
      // HQ drained 1500 out of a home stockpile in two minutes on
      // reinforcement traffic alone, none of it a decision anybody made.
      if (s.isPlayer) continue;
      this._serve(s, s.team, R.backpack, amt, !!(s.squad && s.squad.supplyRun));
    }
  }

  // One carrier, one tick. `carrier` is anything with `.pos` and a `.cargo`
  // number — a Soldier or a Vehicle; neither knows this file exists.
  _serve(carrier, team, cap, amt, mayLoad) {
    if (team === null || team === undefined) return;
    const d = this.nearest(team, carrier.pos.x, carrier.pos.z, this.cfg.transferRadius);
    if (!d) return;
    if (d.kind === 'hq' && !mayLoad) return;
    this.transfer(carrier, cap, d, d.kind === 'hq' ? amt : -amt);
  }

  // THE ONE PLACE MATERIEL MOVES. Positive `amt` fills the carrier out of the
  // depot, negative empties it into the depot; the return is what actually
  // moved, signed the same way. Both the automatic bot path above and the
  // player's supply wheel come through here, so a rule about capacity or
  // conservation only has to be right once.
  transfer(carrier, cap, depot, amt) {
    if (amt > 0) {
      const take = Math.min(amt, cap - carrier.cargo, depot.stock);
      if (take <= 0) return 0;
      depot.stock -= take;
      carrier.cargo += take;
      return take;
    }
    const give = Math.min(-amt, carrier.cargo, depot.cap - depot.stock);
    if (give <= 0) return 0;
    carrier.cargo -= give;
    depot.stock += give;
    return -give;
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
