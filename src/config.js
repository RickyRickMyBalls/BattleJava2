// Central tuning constants for the 32v32 prototype.

export const TEAM = { BLUE: 0, RED: 1 };

export const CFG = {
  teamSize: 32,
  squadSize: 4,

  map: { w: 900, d: 560 },   // world extents: x in [-450,450], z in [-280,280]

  hq: [
    { team: TEAM.BLUE, x: -410, z: 0 },
    { team: TEAM.RED, x: 410, z: 0 },
  ],

  sectors: [
    { id: 'A', x: -250, z: -70, r: 32 },
    { id: 'B', x: -125, z: 105, r: 32 },
    { id: 'C', x: 0, z: -30, r: 36 },
    { id: 'D', x: 125, z: 120, r: 32 },
    { id: 'E', x: 250, z: -60, r: 32 },
  ],

  tickets: 400,
  bleedInterval: 3,      // seconds between bleed applications
  captureRate: 14,       // capture points/sec per net attacker (progress 0..100)
  headshotMult: 1.6,
  gravity: 18,           // world constant: anything that falls, and every jump

  soldier: {
    // THE PLATE LAYER. Every soldier carries one pool in front of health, and
    // the class decides which KIND — they are the same mechanic and differ in
    // exactly one property, whether it comes back on its own:
    //
    //   armor   marines. Never regenerates. A repair tool is the only way back.
    //   shield  Spartans, via MJOLNIR. Regenerates after a lull, as it always did.
    //
    // Mutually exclusive on purpose, so there is ONE pool rather than two with
    // one of them permanently zero on four classes out of five. See
    // soldier.plateKind — nothing branches on the class, only on the kind.
    armor: 50,
    health: 100,
    // A stripped marine sits at exactly 100 EHP, which is what the whole weapon
    // table was tuned against back when it was 45 shield + 55 health. That is
    // the point of these numbers: the WORST case of the new model is the only
    // case of the old one, so no weapon in the armoury ever describes a body
    // weaker than one already tuned for, and armour is pure upside on top.
    //
    //   marine   150 fresh -> 100 stripped
    //   spartan  170, always (70 shield + this health)
    //
    // Health is universal so the Spartan stays the most durable thing on the
    // field. A marine tougher than a Spartan on the opening burst would fight
    // the fiction hard; what marks the Spartan out is that it never degrades.
    shieldRegenDelay: 4.5,
    shieldRegenRate: 12,
    runSpeed: 6.2,
    walkSpeed: 3.4,
    // A tier above `runSpeed`, spent out of the same pool the player spends —
    // see CFG.stamina.ai for when a bot is allowed to ask for it. Its own knob
    // rather than a read of CFG.player.sprintMult: the two movers have different
    // base speeds, and tying them together would make tuning one retune the
    // other for no reason.
    sprintMult: 1.5,
    // Jump is authored as a HEIGHT IN METRES — the single number to tune. Every
    // other jump quantity is derived from it and CFG.gravity: takeoff velocity
    // is sqrt(2*g*h), airtime is 2*v/g, and the jump clip is stretched to span
    // that airtime. Per-class overrides live on CLASSES; this is the default,
    // and it applies to every soldier, AI included.
    jumpHeight: 1.17,
    respawnDelay: 6,
    // Posture. Every height measured up from a soldier's feet — their eye, the
    // point an enemy aims at, the hit spheres — is authored as a STANDING
    // figure, and a crouched soldier is that same silhouette folded toward the
    // ground by this one multiplier. One scale rather than a second set of
    // numbers: the standing values stay the single authored truth, and a height
    // added later cannot forget to handle the crouch.
    //
    // 0.65 is the crouch the CAMERA already does (crouchEye / eyeHeight =
    // 1.15 / 1.78), so the body an enemy shoots at matches the view the player
    // is ducking behind. That agreement is the entire point. With a fixed
    // silhouette there is no cover height that works: anything tall enough to
    // hide a crouched soldier also hides a standing one, so they can shoot over
    // it and never be seen — and anything short enough to leave a standing
    // soldier exposed leaves the crouched one exposed too, so ducking does
    // nothing. Cover only becomes a decision once posture moves the target.
    crouchScale: 0.65,
  },

  // Downed state and casualty recovery — see CLASS_AND_GADGET_PLAN.md. Phase 1
  // is the stationary pickup: no drag, no carry, and no new animation clips.
  //
  // `enabled` is not decoration. Whether bots answering each other's downs
  // halves the ticket bleed or barely moves it is not predictable on paper, so
  // the same battle has to be runnable both ways: FC.game.setTimeScale(8) with
  // this on, then off, and compare the ticket curves.
  downed: {
    enabled: true,
    bleedout: 60,          // seconds on the ground before it becomes a death
    reviveTime: 5,         // base pickup, in seconds. Support divides this by
                           // PERKS.combatLifesaver.stats.reviveRate (3) -> 1.5,
                           // so their figure is derived and never a 2nd constant
    reviveHealth: 0.5,     // fraction of max health to stand back up on
    reviveRange: 2.4,      // metres to reach a casualty
    reviveDecay: 1,        // progress lost per second when nobody is working
    // Overkill past zero, as a fraction of the health bar, that kills outright
    // instead of downing. ONE number covering headshots, rockets and
    // point-blank shotguns without a damage-type list to maintain. Raise it if
    // downs feel too rare, lower it if every kill feels provisional.
    gibMargin: 0.5,
    camHeight: 0.45,       // eye height while lying down
    giveUpHold: 0.8,       // hold SPACE this long to stop waiting

    // Findability. Recovery is open to the whole team, which is worth nothing
    // if nobody can tell who is down — the pickup prompt only fires at
    // `reviveRange`, so without markers a player would never find a casualty
    // except by walking over one.
    markerRange: 90,       // metres a casualty marker carries
    markerMax: 8,          // most markers drawn at once, nearest first
    // Calling for help. The downed soldier's one piece of agency: it does not
    // just brighten a marker, it makes bots come further for you.
    callTime: 8,           // seconds a call stays live
    callRangeMult: 1.6,    // how much further a bot will travel for a call
  },

  // Stamina — see CLASS_AND_GADGET_PLAN.md. Player only for now: bots have no
  // sprint tier at all (soldier._move picks between walkSpeed and runSpeed), so
  // this narrows the player-vs-bot speed gap rather than widening it. Giving
  // bots a sprint is a separate decision about bot movement, not a fairness
  // patch owed to this one.
  //
  // `enabled` follows `downed`: the pool changes how the player crosses ground,
  // and that is worth being able to switch off and re-feel rather than argue
  // about on paper.
  //
  // The pool is denominated in SECONDS OF SPRINT — drain is 1/s by definition,
  // which leaves `max` as the one number that has to be felt out rather than a
  // rate and a capacity that only mean something multiplied together.
  stamina: {
    enabled: true,
    max: 6,                // full pool = 6 s of sprint = ~57 m at 9.6 m/s,
                           // which is a little over one sector radius (32 m)
    regen: 0.5,            // units/sec standing still -> 12 s empty to full
    regenDelay: 1.0,       // seconds after the last sprint frame before refill
    // Regen while moving but not sprinting. Without this the baseline is
    // 6 s of sprint followed by 12 s standing still, which is not a game.
    // MARATHON raises it to 1 — that is the perk's "keeps recovering while
    // still moving", and the axis that stops it being a weaker MJOLNIR.
    moveRegenMult: 0.35,
    // The last N units ramp the sprint bonus down to nothing instead of
    // dropping it. Running out slows you; it never freezes you.
    exhaustBand: 1.5,
    // ...and once empty, recover this much before Shift bites again. Without
    // the latch, tapping Shift at zero buys a tenth of a second of sprint
    // every half second and the whole thing turns into a stutter.
    resprintAt: 1.5,

    // When a BOT is allowed to ask for the boost. Measured over a 150 s battle
    // (3603 alive-samples): 66% of the time a bot has no target, 89% has not
    // been shot at in 2 s, and 93% is more than 25 m from where it is going —
    // 57% satisfies all three at once, so this gate is open for most of a bot's
    // life. It still barely moves the sim, because the pool's duty cycle eats
    // the boost: a bot that always wants to sprint averages 6.53 m/s against a
    // 6.2 run over a long trip, +5.4%. The visible change is the opening burst
    // out of spawn — a full pool is 26% of a median 218 m trip — not the tempo.
    //
    // Retune `resprintAt` and `moveRegenMult` above to change what bots do
    // after that first burst. `max` only sets how long the burst lasts.
    ai: {
      // Seconds since last hit. Matches BIOFOAM.aiReviveCalm, and for the same
      // reason: `takeDamage` zeroes `shieldTimer`, so this is a free and
      // instant "nobody is shooting at me". A bot that stows its rifle and runs
      // while under fire reads as broken, whatever the pool says.
      calm: 2.0,
      // Don't sprint the last stretch. Also keeps a 9.3 m/s approach from
      // slamming into the 2.5 m waypoint stop in `_move`.
      minDist: 25,
    },
  },

  // Placed structures — the shared rules for anything a gadget stands up in the
  // world. What a structure IS lives on its gadget def (see `wall` on
  // GADGETS.quickwall); everything here is true of all of them.
  structure: {
    // Dropped this far ahead, further than a crate's 1.5: you stand BEHIND a
    // wall, and a wall at arm's length is one you cannot shoot over comfortably.
    placeAhead: 2.2,
    // Shorter than a crate's 240. Cover should shape a fight, not a match — and
    // it is also the cheap half of bounding `world.coverBoxes`, since every
    // standing structure is a live cost on a test that runs per bullet.
    life: 180,
    // The expensive half. Two charges times a dozen Engineers is a lot of walls
    // if none of them ever expired, so the cap is what makes the worst case
    // knowable rather than a function of how the match went.
    maxPerTeam: 12,
    // Refuse a spot where the ground under the footprint varies by more than
    // this, in metres. A wall is a rigid box: on a slope steeper than this one
    // end buries itself and the other floats, and a floating wall is a gap
    // bullets pour through at ankle height.
    maxSlope: 0.9,
    // Nobody may be standing inside the footprint plus this margin. Placing a
    // wall through a squadmate would trap them in geometry they cannot see.
    clearRadius: 0.8,
  },

  // The visor — the helmet frame across the top of the screen, drawn from the
  // CAD export at `source/UI/hud4-top.svg` rather than from DOM boxes. What the
  // rewrites on load are defending against is written up in src/visor.js.
  visor: {
    enabled: true,
    src: '/UI/hud-overlay.svg',
    // Host element id, and the prefix stamped onto every id in the file. The
    // SVG and index.html both use `ammo`, and hud.js binds its elements by id.
    host: 'visor',
    idPrefix: 'v-',
    // The art is authored on a 2560x1440 screen and only the top band carries
    // anything, so this crop is that band: the full authored width, and y from
    // the top edge down past the lowest point of the visor wings (237.4). The
    // extra few units are bleed — strokes are centred on their path and do not
    // scale, so a band ending exactly at the geometry shaves the tips in half.
    band: [0, 0, 2560, 242],
    // The band's height as a share of the screen. 238/1440 = 16.5% is what the
    // art was drawn for, and width-driven sizing reproduces that exactly at
    // 16:9. The cap only bites wider than 16:9, where it would otherwise march
    // the frame down the screen instead of leaving it a hat.
    heightVh: 17,

    // How many cells the health strip is cut into. The art draws them; this is
    // the number the readout is quantised to, and the two are checked against
    // each other on load rather than assumed to agree.
    healthCells: 10,

    // Meter fills, as [offset, colour] stops running top to bottom. The export
    // is stroke-only — these are lifted from the older hud4-top.svg, which
    // carried them in its <defs> and never used them, so they are the artist's
    // own values rather than a guess at them.
    fill: {
      shield: [[0, '#d4f7ff'], [0.28, '#83d9f7'], [1, '#2b87ba']],
      // Armour wears the same meter as the shield and must not be mistaken for
      // it — steel rather than energy, because one of them comes back on its own
      // and the other needs somebody with a welder. Deliberately not the amber
      // of `boostSpent`: two warm bars on one visor would read as the same
      // warning twice.
      armor: [[0, '#ffffff'], [0.3, '#cfd8de'], [1, '#5b6a75']],
      health: [[0, '#6fc8e7'], [0.48, '#276e9d'], [1, '#102f50']],
      ammo: [[0, '#d8f8ff'], [0.3, '#7cd9f6'], [1, '#247eac']],
      // Green and amber, carried over from the DOM stamina bar this replaced:
      // both other slots are cyan, and the sprint pool must not read as a
      // damage bar in the corner of the eye, which is the only way it is ever
      // read.
      boost: [[0, '#c8f5da'], [0.35, '#8fe6b0'], [1, '#2f7f56']],
      boostSpent: [[0, '#ffd9ae'], [0.35, '#e6a05e'], [1, '#8a4f1d']],
    },

    // Which end of a wiping meter stays put as it drains. The shield fills from
    // the left; boost and ammo anchor at their INNER ends, so the mirrored pair
    // empties from the screen edges inward and what is left of both sits near
    // the crosshair, where you are already looking.
    anchor: { shield: 'left', boost: 'right', ammo: 'left' },
  },

  // Squad rally beacon — the leader's ability, not a gadget slot. Shared rules
  // live here; what a beacon IS lives on the def in `BEACON` below, the same
  // split `structure` uses.
  //
  // A beacon is the only placeable that DOES NOT EXPIRE. Every other prop in
  // the game is bounded by a timer, and this one deliberately is not: a rally
  // point that quietly evaporates is one nobody trusts, and an untrusted spawn
  // is one nobody uses. What bounds it instead is that the enemy can shoot it,
  // which makes it a thing on the map both sides can act on rather than a
  // clock.
  beacon: {
    placeAhead: 1.8,
    // Measured, not guessed: an AR round lands 8.5 on it at ~20 m, so this is
    // about 21 rounds from a player — a third of the AR's 60-round magazine —
    // or two rockets, or one rocket and a short burst. High enough that a
    // passing shot does not erase a squad's spawn, low enough that finding one
    // is worth stopping for. This is the number to move if beacons feel too
    // hard or too easy to kill; nothing else in the system needs to change.
    hp: 180,
    // No charges — the cooldown IS the cost, since the ability is free and
    // every leader has it. Long enough that losing a beacon hurts for a push.
    cooldown: 45,
    // How far from the beacon a squadmate actually lands. Larger than the
    // deploy screen's 5-11 m HQ jitter would be suicide here: the whole point
    // is arriving where the beacon is, and a beacon is planted in cover.
    spawnRadius: 4,
    // Refuse to plant one within this of a living enemy. A rally point at the
    // feet of the people you are fighting is not a rally point, it is a
    // teleporter, and the counterplay (shoot it) never gets a chance to happen
    // because the spawns arrive faster than the damage.
    enemyClear: 22,
    // Footprint [width, height, depth]. Small — it is a pole, not cover — and
    // it is NOT pushed into world.coverBoxes for exactly that reason. Rounds
    // that meet it hit it; they do not stop at it for anyone standing behind.
    size: [0.34, 1.5, 0.34],
    // The two spheres the hit test uses, as [heightFraction, radius]. A stack
    // of spheres rather than the box, because that is the test combat.js
    // already runs per bullet against every soldier — a second shape in that
    // path would be a second thing to keep honest.
    hitSpheres: [[0.35, 0.42], [0.85, 0.36]],

    // When an AI squad leader decides to plant one. See Squad.updateBeacon.
    //
    // The whole rule turns on ONE measured quantity: how much of the walk a
    // rally here would actually save. Bots respawn at whichever spawn is
    // nearest the OBJECTIVE and walk in from there, so the saving is
    //     d(nearest spawn -> objective) - d(leader -> objective)
    // and a rally is worth planting exactly when that is large.
    //
    // "Near the objective" was the obvious rule and it is the wrong one.
    // Sampled over a live match at 60 s, the median squad sat 251 m from its
    // objective and only 74 m from a spawn — squads are nearly always in
    // transit, so a proximity rule almost never fires, and when it does the
    // squad is usually somewhere a spawn already covers.
    ai: {
      // Measured across 16 squads mid-match: median saving 6 m, max 112 m,
      // with 4 squads over 80.
      //
      // 80 was the first value and it saturated: every squad on both sides had
      // a rally within 30 s and never lost it. The instantaneous distribution
      // badly understates how often the rule fires, and that is the lesson
      // worth keeping — a squad is checked every 2.5 s, so it gets roughly 24
      // chances a minute to catch a moment where it qualifies. "Rare at any
      // instant" turns into "true of everyone, eventually". Any threshold rule
      // sampled this way needs the same correction.
      //
      // So the threshold is high AND the count is capped below; neither alone
      // was enough. Raise for rarer, more deliberate rallies.
      minSaved: 120,
      // Live rallies a side may hold. The real brake, and the same reasoning as
      // CFG.structure.maxPerTeam: it makes the worst case knowable instead of a
      // function of how the match went. It also keeps the enemy's rallies
      // findable — eight of them is not a target, it is weather.
      //
      // Applied to the AI's decision rather than to placement, so bots holding
      // every slot can never stop a player from planting theirs. A squad
      // REPLACING its own beacon is not blocked: that is net-zero.
      maxPerTeam: 3,
      // Don't churn. An existing rally is replaced only once it has stopped
      // earning its keep — the squad has moved on and it now saves less than
      // this — rather than every time the leader finds a marginally better
      // spot, which would have squads re-planting on every advance.
      staleSaved: 30,
      // Per squad, not per soldier: leadership moves when a leader goes down,
      // and a cooldown carried on the man would reset with him.
      cooldown: 60,
      // After a refusal (almost always ENEMY TOO CLOSE — see `enemyClear`).
      // Short, because a refused plant means a fight is happening right there,
      // which is where the squad most wants a rally once it clears.
      retry: 8,
      // How often the rule is even evaluated. The test walks every soldier for
      // the enemy-proximity check, so it is throttled rather than run per
      // frame; a rally is a decision measured in tens of seconds anyway.
      checkInterval: 2.5,
    },
  },

  // Vehicles — intake pass. Nothing here drives physics yet; this is the
  // placement half, which is what the first step needs to answer: does a
  // 5.6 m Warthog read at the right size next to a 1.86 m marine, on a map
  // whose geometry was normalized by MARKER SPAN rather than by architecture
  // (maps.js scales map-3 to ~0.28x). The vehicle is the first object in the
  // game with an unambiguous real-world size, so it is the first thing that
  // can prove the map's scale right or wrong.
  vehicle: {
    // Hogs per FC_VEHICLE_ marker, laid out across the marker's facing. The
    // markers carry position only — no rotation is authored on them — so
    // facing is derived (see VehicleManager._spawnAll) rather than read.
    perSpawn: 2,
    spacing: 5.0,        // metres between neighbours, measured across the line

    // Physics runs on a FIXED substep, not the frame's dt. A 0.05 s frame
    // (game.js clamps there) through a spring stiff enough to hold three tonnes
    // is unconditionally unstable — the hog launches. The accumulator is
    // deterministic under `_simStep`'s repeated same-dt calls, so 8x
    // fast-forward stays numerically identical to 8 real frames, which is the
    // property scripted battle testing depends on.
    substep: 1 / 120,
    maxSubsteps: 8,      // bail out rather than spiral if a frame is very long

    enterRange: 4.0,     // metres from the driver's door to prompt

    // Seats, addressed by the rig's own empties rather than by a class
    // hierarchy — adding a seat to a vehicle is an entry in this list and
    // nothing else. Order matters only for tie-breaks; which seat you get is
    // decided by which one you are STANDING NEAREST, so walking round to the
    // back of the hog and pressing E puts you on the tailgate without a menu.
    //
    //   ref    — where the body is parked. Null means the rig has no empty for
    //            it and `offset` (chassis frame) stands in.
    //   camera — the eye. Null falls back to the seat plus eye height.
    //   role   — 'drive' | 'turret' | 'ride'
    seats: [
      { id: 'driver', label: 'DRIVE', role: 'drive',
        ref: 'ref_seat_driver', camera: 'ref_camera_driver' },
      // The gunner stands in the ring, so there is no seat empty by design —
      // ref_camera_gunner hangs off gun_turret_body and therefore YAWS WITH THE
      // TURRET, which is exactly right and is why the camera is read live off
      // the hierarchy rather than computed.
      { id: 'gunner', label: 'MAN THE TURRET', role: 'turret',
        ref: null, offset: [0, 1.25, -1.55], camera: 'ref_camera_gunner' },
      { id: 'passenger', label: 'RIDE SHOTGUN', role: 'ride',
        ref: 'ref_seat_passenger', camera: 'ref_camera_passenger' },
      // VEHICLE_PLAN.md open question 3: the tailgate riders have no authored
      // empties, so these are derived and deliberately marked. Two more
      // ref_seat_* in the GLB replaces both offsets and this comment.
      { id: 'rearLeft', label: 'RIDE THE TAILGATE', role: 'ride',
        ref: null, offset: [0.8, 1.15, -2.15], camera: null },
      { id: 'rearRight', label: 'RIDE THE TAILGATE', role: 'ride',
        ref: null, offset: [-0.8, 1.15, -2.15], camera: null },
    ],

    // The ring mount. It tracks the gunner's look rather than snapping to it,
    // so a heavy gun reads as heavy and whipping the mouse does not teleport
    // the barrel across the field.
    turret: {
      yawRate: 2.4,        // rad/s
      pitchRate: 2.0,
      pitchMin: -0.30,     // radians below level — the shield stops it going far
      pitchMax: 0.85,
    },

    // Landing on the roof. A flipped hog is a RECOVERABLE situation, not a lost
    // vehicle and not a soft-lock — which is what it was, because the hull had
    // no ground collision and an inverted chassis has its suspension switched
    // off, so it fell out of the world taking the driver with it.
    flip: {
      upThreshold: 0.35,   // chassis up-vector Y below this counts as inverted
      // It has to have STOPPED, not just be inverted. Mid-barrel-roll is
      // airborne, and prompting someone to right a tumbling vehicle is
      // prompting them to walk into it.
      settleTime: 0.8,
      rightTime: 2.0,      // seconds of held E to put one back on its wheels
      rightLift: 0.4,      // clearance it is dropped from, so the springs land it
      groundFriction: 0.6, // mu of hull-on-ground, or a roofed hog skates forever
    },

    // Third-person boom while driving. Further out and higher than the
    // infantry boom (`player.thirdPerson`) because the thing being framed is
    // 6 m long and what you need to see is the ground it is about to hit.
    thirdPerson: { dist: 11, lift: 3.4, minDist: 3, skin: 0.5, lerp: 5 },

    // How much of the chassis's ROLL AND PITCH the view inherits, 0..1.
    //
    // This started at a hard 1.0 — the camera was rigidly bolted to the
    // chassis — on the theory that inheriting the vehicle's attitude is what
    // makes you feel like a driver rather than a spectator. That theory is
    // fine and the implementation was not, for a reason specific to a boom:
    // the camera hangs 11 m behind the car, so it swings through an ARC. A
    // 10 degree chassis pitch became ~1.9 m of camera travel, and map-3's
    // ground steps 0.73 m every 4 m even where it is flattest, so the chassis
    // pitches constantly and the view never stopped moving.
    //
    // The rule that falls out: the further the camera is from the pivot, the
    // less attitude it can afford to inherit — because distance from the pivot
    // is what converts rotation into translation. Third person hangs 11 m out
    // and gets none. FIRST PERSON SITS AT THE PIVOT, so the same coupling that
    // wrecked the chase view costs nothing there: your head rolls with the cab
    // because your head IS in the cab, and the horizon tilting is the correct
    // and only cue that the hog is leaning. Owner's call, and the right one.
    camera: {
      tiltTP: 0,          // third person: 0 = horizon locked, 1 = bolted to the chassis
      tiltFP: 1,          // first person: fully with the body
      // How fast the chase camera's heading catches the car's. Not instant, or
      // a handbrake spin whips the view through 180 degrees faster than anyone
      // can read it.
      followRate: 3.5,
    },

    // ---------------------------------------------------------------------
    // Per-vehicle tuning. Everything below is a number to be found in
    // /chartest.html's VEHICLE tab (Phase 3) rather than reasoned about here;
    // these are the starting values, chosen to be roughly right rather than
    // right. What is NOT arbitrary is the parameterization — see `sag`.
    // ---------------------------------------------------------------------
    warthog: {
      mass: 3000,                  // kg
      // Centre of mass in the chassis frame (origin = ground, centre of the
      // wheelbase; +Z forward, +X left, +Y up).
      //
      // NOT read from `ref_body_rotation`, deliberately. That empty sits
      // 1.457 m above the ground and 0.356 m behind the axle midpoint — far
      // too high to be a centre of mass on a vehicle 2.29 m tall, and a hog
      // with its mass there would roll over in every turn. It is much more
      // likely a modelling pivot. Until that is confirmed (VEHICLE_PLAN.md,
      // Open question 1) the COM is a tuned number, and this is it.
      com: [0, 0.66, -0.10],
      // Box used for the inertia tensor [x=width, y=height, z=length], in
      // metres, and a per-axis multiplier over the uniform-box result.
      // Real vehicles yaw more willingly than a solid box of their dimensions,
      // which is what the 0.8 buys.
      inertiaBox: [2.3, 1.5, 4.8],
      inertiaScale: [1.0, 0.8, 1.0],   // [pitch (X), yaw (Y), roll (Z)]

      wheelRadius: 0.631,          // measured off the tyre mesh

      // --- Suspension -----------------------------------------------------
      // Spring rate is DERIVED, not authored, and that is the important part:
      //     k = (mass * g) / (4 * travel * sag)
      // `sag` is the fraction of total travel the vehicle uses just holding
      // itself up. That is how real suspension is specced, and it means
      // changing the mass does not silently change the ride height — the two
      // knobs stay independent, which is what makes them tunable by hand.
      travel: 0.34,                // total strut travel, metres
      sag: 0.38,                   // fraction of travel used at rest
      damping: 0.55,               // fraction of critical, on compression
      dampingRebound: 0.85,        // higher on the way back out, as on a real damper
      // Load transferred across each axle per metre of compression difference,
      // as a fraction of the spring rate. This is the main "does the body flop"
      // knob. 0 is a hog that leans alarmingly; 1 is a go-kart.
      antiRoll: 0.42,
      // The end of the strut, as a multiple of the spring rate. Only acts on
      // travel PAST the stop, so it is invisible in normal driving and is the
      // thing that stops a hard landing putting the floor pan through the rock.
      bumpStop: 10,

      // --- Drive ----------------------------------------------------------
      // Sized against CFG.gravity, which is 18 — nearly double real gravity,
      // and a world constant every jump and fall in the game already uses. Do
      // NOT reach for real-vehicle numbers here: a tyre's whole force budget is
      // mu * load, load scales with g, and at g = 18 a "1 g" manoeuvre is
      // 18 m/s². Everything below is quoted as a fraction of that budget, which
      // is the only frame in which these numbers mean anything.
      //
      // 36000 N on 3000 kg is 12 m/s² off the line, against a lateral limit of
      // 1.2 * 18 = 21.6. So full throttle spends over half the tyre's budget,
      // and asking for a corner at the same time overdraws it. That ratio is
      // the drift, and it is the number to move if the hog feels planted.
      driveForce: 36000,           // N at a standstill, summed over driven wheels
      topSpeed: 25,                // m/s where drive force has fallen to zero
      // The gearbox. Tractive force at a standstill is `lowGear` x driveForce,
      // decaying to 1.0 by `lowGearSpeed`. Without it there is no torque
      // multiplication where a hill needs it and the measured max sustained
      // climb was 29 degrees — the hog settled into a 5 m/s stall at 30 rather
      // than pulling through.
      //
      // 1.6 is chosen to sit just UNDER the traction limit on the flat
      // (57.6 kN commanded against a ~62 kN grip budget), so pulling away is
      // strong but does not light the tyres up. Raise it and the hog spins its
      // wheels off the line, which is a different and much worse kind of slow.
      lowGear: 1.6,
      lowGearSpeed: 8,             // m/s at which the low-gear boost is gone
      reverseMult: 0.4,
      brakeForce: 60000,           // just past mu*m*g, so the wheels can lock
      handbrakeForce: 40000,       // rear axle only
      rollResist: 0.015,           // Coulomb, as a fraction of wheel load
      airDrag: 5,                  // N per (m/s)^2

      // --- Steering -------------------------------------------------------
      // Speed-sensitive: full lock is available when parking and roughly a
      // quarter of it at top speed. Without this a hog at 25 m/s spins on the
      // spot the instant A is touched.
      steerMax: 0.60,              // radians at a standstill
      steerMaxFast: 0.17,          // radians at topSpeed
      steerRate: 3.6,              // rad/s toward the held direction
      steerReturn: 6.0,            // rad/s back to centre when released

      // --- Tyres ----------------------------------------------------------
      // `grip` is the friction coefficient mu — the tyre's total force budget
      // is mu * (that wheel's current load), and longitudinal and lateral
      // demand SHARE it (the friction circle). That sharing is what produces
      // the Warthog's signature: get greedy with the throttle and the rear
      // spends its budget driving instead of gripping, and the back steps out.
      // It is not a scripted drift; there is no drift code.
      grip: 1.2,
      gripRear: 1.1,               // looser than the front on purpose: the rear
                                   // must run out of grip FIRST, or the hog
                                   // understeers into every corner instead of
                                   // rotating. This gap is the handling.
      cornerStiffness: 8.5,        // force per radian of slip, in units of mu
      // Multiplier on rear mu while held. 0.4 was a full 180 from one tap —
      // spectacular and useless. This is a slide you can hold and steer out of,
      // which is the version that is actually worth having on the key.
      handbrakeGrip: 0.62,

      // --- Hull -----------------------------------------------------------
      hullSkin: 0.35,              // push-out radius on each hull sample point
      restitution: 0.12,           // how much of the impact speed comes back

      angularDamping: 0.6,         // 1/s, keeps a spin from running forever

      // --- Sleep ----------------------------------------------------------
      // A parked hog stops integrating once it has been still for a moment.
      // Without it, four vehicles' worth of springs jitter forever at the
      // bottom of their travel and the motor pool visibly hums.
      sleepSpeed: 0.25,            // m/s below which it may fall asleep
      sleepSpin: 0.25,             // rad/s, same
      sleepDelay: 0.7,             // seconds of stillness before it does
    },
  },

  // Deployed supply crates — the shared rules. What each crate HOLDS and HANDS
  // OUT lives on its gadget def in `GADGETS`, because that is what differs;
  // everything here is true of any crate.
  //
  // A crate is a finite pool, not a station: it serves a number of people and
  // then it is scrap. That is what stops one Support anchoring a position
  // indefinitely, and what makes placing a second one a real decision.
  crate: {
    reach: 2.6,          // metres you must be inside to draw
    drawTime: 0.9,       // hold the interact key this long per draw
    life: 240,           // seconds before an unspent crate despawns
    placeAhead: 1.5,     // dropped this far in front of the placer
    size: [0.92, 0.62, 0.72],
    // Crates are team-coloured by their contents, not by side: you never see an
    // enemy's, so a red/blue split would be information nobody can use.
    markerRange: 70,
    // How far a bot will walk to a crate, and how empty its injector has to be
    // before it bothers. Bots draw from MEDICAL crates only: they carry no
    // reserve-ammo model at all — see the note on `give: 'ammo'` in GADGETS —
    // so an ammunition crate has literally nothing to hand them.
    aiSeekRange: 45,
    // Seek when the injector is this low or worse. ONE, not zero, and the
    // difference is the whole behaviour: measured over 150 s with six crates
    // seeded, a threshold of 0 produced 0 draws and a threshold of 1 produced
    // 7. Bots are killed and respawn on a fresh kit long before they burn all
    // three charges, so "completely empty" is a state they almost never reach.
    aiSeekBelow: 1,
    // Bot placement. One in five soldiers is Support and they respawn all match,
    // so without limits a team would carpet the map — roughly twenty crates a
    // side over a short match. Three rules keep it to a supply line rather than
    // a minefield: a live cap per team, a spacing rule so they do not cluster,
    // and a requirement to be at the objective, which is what makes a dropped
    // crate mean "the squad is holding here".
    aiTeamCap: 5,
    aiMinSpacing: 30,
    // Metres from the nearest SECTOR, not from the squad's objective — see the
    // note in `_tryPlaceCrate`. Sector radii run 32-36, so this is roughly
    // "inside the capture ring or just outside it".
    aiNearObjective: 36,
  },

  player: {
    eyeHeight: 1.78,
    crouchEye: 1.15,
    speed: 6.4,
    sprintMult: 1.5,
    // Hold to walk (Ctrl). Must land the player under the 4 m/s run threshold
    // in soldier._locomotionAnim, or the walk clips are unreachable: 6.4 * 0.5
    // = 3.2, which is also close to the AI's own 3.4 walk speed.
    walkMult: 0.5,
    crouchMult: 0.55,
    respawnDelay: 5,
    // How long after a weapon swap before you may fire, in seconds. Was hardcoded
    // at 0.4 in player.switchWeapon for every gun alike, which left the sidearm
    // with no job — if drawing the Magnum costs the same as drawing a rifle, you
    // may as well carry a rifle. Per-weapon `swapTime` overrides this, and that
    // difference IS the pistol's reason to exist: an empty MA5 is a 2.3 s reload
    // or a 0.2 s draw to something loaded.
    swapTime: 0.4,
    // Third-person view (O). A debug/observation camera for watching the body
    // animate — firing is suppressed while it is on, so these are presentation
    // only. `dist` is the boom length behind the eye, `shoulder` offsets it to
    // the right so the body does not sit dead centre, `lift` raises the pivot,
    // and `minDist` is how close the boom may be pulled in when a wall is in
    // the way before the camera would end up inside the character.
    thirdPerson: {
      dist: 3.2,
      shoulder: 0.75,
      lift: 0.15,
      minDist: 0.8,
      skin: 0.25,          // keep the camera off the wall it collided with
      lerp: 12,            // boom ease, per second
      // Aiming does not zoom. A narrowed fov on a camera parked behind the
      // player reads as a telescope pointed at his back, so the camera moves
      // instead: tighter boom, further over the shoulder, closing the view on
      // the weapon's line. Blended at the weapon's own `ads.speed`, so a sniper
      // still comes up slower than an SMG. `sens` replaces the look-speed
      // slowdown that first person gets for free from the fov change.
      ads: { dist: 1.5, shoulder: 1.0, lift: 0.2, sens: 0.75 },
    },
  },

  // Walking around the lobby stage (TAB). Movement itself is deliberately NOT
  // tuned here — roam reuses the real Player, so it reads CFG.player.speed,
  // eyeHeight and the rest. These are only the transition and presentation.
  // The hangar preview character. He holds a relaxed rifle idle and glances
  // around now and then, rather than sighting down the weapon the whole time
  // the player is picking a loadout.
  lobbyIdle: {
    // Seconds of calm idle between glances. The lookaround clip is itself ~10 s,
    // so these want to be comfortably longer than it or he spends half his time
    // looking around rather than occasionally.
    lookEveryMin: 16,
    lookEveryMax: 34,
    fade: 0.6,             // crossfade; both poses are near-identical at the
  },                       // hips, so a quick cut reads as a twitch

  lobbyRoam: {
    enterTime: 1.0,        // seconds: camera flight from the lobby pose into first person
    exitTime: 0.7,         // and back out
    fov: 75,               // matches the in-game FPS fov (lobby portrait fov is 35)
    fovHold: 0.55,         // fraction of the flight before the fov starts widening
    // Bezier control point, relative to the character: the camera swings behind
    // one shoulder instead of pushing straight through the chest.
    arc: { back: 2.4, side: 1.8, up: 0.8 },
    hideCharAt: 0.8,       // t at which the preview body is hidden (camera is inside it)
    showCharAt: 0.3,       // t on the way out at which it comes back
    fogFar: 120,           // stage fog is tuned tight for the portrait framing
  },

  // Scope screens re-render the world from a second camera. Optics are per
  // weapon (WEAPONS[k].scope); this is the cost policy.
  //
  // Narrowing the fov does NOT reduce cost on its own: three sets
  // frustumCulled = false on every SkinnedMesh, and assets.js does the same for
  // weapons and characters, so all 64 soldiers draw whichever way the scope
  // points. The cull below is done by hand for exactly that reason.
  scopeRender: {
    everyNFrames: 2,   // ~30Hz on the glass; imperceptible, halves the cost
    cullRadius: 2.2,   // soldier bounding sphere for the manual frustum test
  },

  // Combat audio, distance side. Level alone is a weak distance cue: what tells
  // you how far a gun is, is how much of its crack survived the trip. Air eats
  // the top end far faster than it eats the level, so every world-placed sound
  // runs through a lowpass whose cutoff decays with range —
  //   fc = far + (near - far) * exp(-d / falloff)
  // Gunfire and detonations get their own curve: a rifle report is mostly top
  // end and dulls fast, a boom is already bottom end and carries.
  audio: {
    // Distance falloff for AI gunfire: flat inside `shotRef`, then the standard
    // inverse-distance curve, ref / (ref + rolloff * (d - ref)), out to the cull.
    // The old curve went abruptly silent at 260 m — fine on the demo map, whose
    // five sectors sit 185-220 m apart and whose whole battle therefore fits
    // inside that bubble, but map 3's objectives are 320-630 m apart, so the
    // rest of the war was simply switched off. 600 m reaches across map 3
    // without dragging in its far corners.
    shotRef: 12,       // metres. Below this the level stops changing...
    shotRolloff: 0.55, // ...above it, how steeply it falls. 1 = pure ref/d.
    shotMaxDist: 600,
    shotPeak: 0.8,     // loudest an AI shot gets; the player's own gun is 1.0
    // Voice budget, spent per frame by `update()`. Shots are QUEUED as they are
    // fired and picked over a frame later, because a shot cannot know at the
    // moment it fires whether a closer one is about to be queued behind it.
    queueMax: 64,      // one per soldier; a hard stop, never normally reached
    nearSlots: 3,      // nearest-first, inside `farBand`
    farBand: 200,
    farSlots: 2,       // ...and this many RESERVED for everything beyond it, so
                       // a close scrap cannot silence the rest of the battle
    lpNear: 20000,     // cutoff with the shot in your face — past the sample's
    lpFar: 1000,       // own content, so effectively unfiltered. Floor it decays
    lpFalloff: 120,    // toward. Metres of e-folding: smaller dulls off sooner.
    lpBypass: 18000,   // above this, skip building the filter node at all
    // Detonations get the same inverse-distance treatment as gunfire, on a much
    // longer curve: a rocket going off is the one sound on the field that should
    // carry across the whole map, and the 500 m cull cut it off well short of
    // map 3's 723 m HQ-to-HQ. Gentler rolloff too — a boom that halves every
    // time you double the distance stops reading as a boom.
    boomRef: 25,
    boomRolloff: 0.35,
    boomMaxDist: 900,
    boomPeak: 0.9,
    boomLpNear: 900,   // the old fixed 420 Hz now sits around 300 m, with closer
    boomLpFar: 180,    // blasts brighter and far ones pure thud
    boomLpFalloff: 250,
  },

  // One of each weapon, laid out in the hangar for the firing range. Placement
  // prefers authored FC_WEAPON_<KEY> empties; these only drive the fallback
  // layout and the pickup feel.
  armoryRack: {
    autoDistance: 4.5,   // metres behind the character when no markers exist
    spacing: 0.85,       // gap between guns in the fallback row
    height: 1.05,        // rack height off the floor
    radius: 2.6,         // how close you must be to take one
    minDot: 0.55,        // ...and how directly you must be looking at it
    highlightLift: 0.08, // the targeted gun rises and turns; no material or
    highlightSpin: 1.2,  // light changes, both of which would cost a recompile
  },

  // Armory weapon display. The gun stands on a lit deck rather than floating in
  // a void, so every number the camera maths needs lives here instead of being
  // spread through menu.js as magic constants.
  armoryStage: {
    // Degrees the camera looks DOWN at the weapon, and the ONLY thing that sets
    // where the horizon sits relative to the gun: horizon screen fraction works
    // out as 0.5 - tan(pitch)/(2*tan(fov/2)) - lensShift. Everything else
    // (aimBias, shiftY) translates the whole image, horizon included, so if the
    // deck is taking up too much frame this is the knob — at 5 the horizon
    // landed at 0.23 of frame height against the reference's 0.57.
    //
    // It briefly had to be positive: when the deck's gradient came from haze
    // alone, a near-zero eye height left no near field to grade across and the
    // floor read as a flat sheet. The Fresnel reflection supplies that gradient
    // now — it keys off the RATIO of eye height to distance, so it still falls
    // off correctly with the eye only centimetres up — so zero and slightly
    // negative are both fine. The real floor on this value is that the eye must
    // stay above the deck plane; go far enough negative and you are under it,
    // and a plane you are below simply is not there.
    pitch: 0,
    pitchMin: -12,     // drag-to-orbit limits; below 0 you see the underside
    pitchMax: 32,
    pitchSpeed: 0.22,  // degrees per pixel dragged
    infoBand: 384,     // px of viewer width the floating info panel covers.
                       // Tracks `.ar-info { width }` in index.html (356) plus a
                       // little slack — the camera dodges this band, so a panel
                       // wider than the number here overlaps the weapon.
    aimBias: 0.23,     // aim below the gun's centre so deck fills the lower frame
    // Lens shift, exactly like Blender's Camera Data -> Shift Y. Slides the
    // frustum without moving the camera, so perspective and the gun's contact
    // with the deck are both untouched. Fraction of viewport height; POSITIVE
    // moves the weapon DOWN. Stacks on top of the automatic shift that lifts the
    // gun clear of the loadout panel, so 0 keeps the current framing.
    // Use this rather than `aimBias` to reframe vertically: aimBias drags the
    // camera down with the aim point and will put the eye under the deck.
    shiftY: 0.20,
    padX: 1.14,        // horizontal breathing room around the weapon's bounding box
    heightPad: 1.24,   // ...and vertical, which also makes room for the deck
    // How literally relative weapon sizes are shown.
    //   1 = frame every gun against the LONGEST in the arsenal. Honest scale, but
    //       an SMG becomes a speck and even a battle rifle only fills ~2/3.
    //   0 = frame each gun to itself. Everything fills the frame, no scale at all.
    // In between, the framed span is a geometric blend of the two.
    // At 0 the scale cue moves to the deck: the grid is a fixed 0.5 m, so the
    // number of squares a weapon spans reads its true length even though the
    // camera has zoomed to fill the frame with it.
    scaleFidelity: 0,
    floorDrop: 0,      // metres of air under the gun's lowest point; 0 = resting
                       // on the deck, negative sinks it in

    // ---- Painted-room backdrop (master switch over everything below) -------
    //
    // Set `url` and the procedural stage stands down: the deck shader, the deck
    // GLB and the sky gradient all switch off, and this plate becomes the whole
    // environment. `url: null` puts every one of them back — nothing under here
    // was deleted, it is all still wired and tuned.
    //
    // The plate is SCREEN-SPACE, unlike the sky it replaces. The sky shades off
    // the world view ray, so it parallaxes when you drag the pitch; this does
    // not — it is a photograph pinned to the glass. That is the trade for a
    // painted room with its own floor and its own perspective, and it means the
    // gun's reflection slides against a floor that stays put when you orbit.
    //
    // What survives the switch: the lights, the shadow catcher (invisible except
    // where the gun's shadow lands, and now the only thing gluing the weapon to
    // the painted floor) and the mirrored gun.
    plate: {
      url: '/UI/blueroom2.png',
      // The plate goes through ACES like every other material — see the note on
      // `stageColor` in menu.js. So it lands DARKER and flatter than the PNG,
      // and this is the compensation. Expect to want it above 1.
      gain: 1.45,
      // Cover-fit: the plate keeps its aspect and the long axis gets cropped.
      // This is which row of the image survives that crop at screen centre, as a
      // fraction of image height. Raise for more ceiling, lower for more floor.
      // Only bites when the viewer's aspect is not the plate's 16:9.
      anchorY: 0.5,
      // Scene fog reaches the WEAPON, not just the deck, and it is aimed at
      // `fogColor` — a colour picked to match the procedural horizon, not this
      // plate. Off while trying the room; turn it back on once fogColor has been
      // resampled off the painting.
      fog: false,
      // Contact shadow. Off against a plate: the catcher is a real horizontal
      // plane and the painting has its own baked lighting and its own floor
      // perspective, so the two only agree by coincidence. Turning this off also
      // stops the caster, which drops the shadow pass entirely.
      // The procedural stage keeps its shadow either way — this knob is local to
      // plate mode.
      shadow: false,
    },

    // ---- The stage: sky, deck, and the haze that joins them ----------------
    //
    // Sky and deck are BOTH raw shaders authored in FINAL DISPLAY space (they
    // bypass ACES — see the note on `light` below), which is the whole point:
    // the deck fogs toward `sky.horizon`, the sky arrives at the same colour at
    // ray.y == 0, so the join is invisible and there is no plane edge to see.
    // If you change one of the two horizon colours, change the other.
    //
    // The sky is a full-screen quad INSIDE the scene, not a CSS gradient behind
    // the canvas. A CSS backdrop cannot be fogged into, cannot be blurred by
    // depth, and cannot be bloomed.
    // Everything here is measured in ray.y / ray.x — the WORLD DIRECTION the
    // pixel is looking along, not screen UV. Worth knowing how little of that
    // range is on screen: at fov 35 the frame spans only about ±0.30 in ray.y,
    // and the lens shift puts the horizon high, so the top edge is around 0.23.
    // Numbers here are therefore much smaller than they look — `rise: 0.34`
    // would mean the zenith colour is never reached anywhere in frame.
    sky: {
      // These are DARK, and deliberately so: sampled off the reference, its sky
      // sits around #0b1018 and its brightest point on the horizon only reaches
      // #0f1620. The stage reads as lit because of the ratio between the deck
      // and the weapon, not because the backdrop carries any light of its own.
      top: 0x05090f,      // straight up
      horizon: 0x0d131c,  // at the horizon line — must match `floorHorizon`
      rise: 0.10,         // how far up the horizon colour reaches, in ray.y
      band: 0x0d151d,     // extra glow in a tight band hugging the horizon...
      bandWidth: 0.02,    // ...how tight, also in ray.y
      // One soft distant light column behind the weapon. columnX is a view-ray
      // X (roughly -0.5..0.5 across the frame at this fov), columnW its width.
      column: 0x0a1018,
      columnX: 0.10,
      columnW: 0.42,
      vignette: 0.42,     // corner darkening; 0 = off
    },

    // Deck extent in metres. Large on purpose: the deck no longer fades to
    // transparent, it hazes into the sky, so its far edge has to sit past the
    // distance where the haze is total or you see the quad end.
    floorSize: 140,
    gridStep: 0.5,      // minor grid spacing (m) — round, so it reads as a ruler
    gridMajor: 4,       // every Nth minor line is a major line
    floorBase: 0x05080e,    // deck colour right under the camera — nearly black,
                            // as in the reference. The near field is not lit.
    floorHorizon: 0x0d131c, // ...and infinitely far away. Match `sky.horizon`.
    // The pool of light under the weapon is the single easiest thing to
    // overdo: it sits in the near field, which is the part that has to stay
    // dark, and it lifts the whole bottom of the frame off black if you let it.
    floorGlow: 0x060a10,
    glowRadius: 1.4,        // ...how far it reaches
    // Haze is measured in CAMERA distance, not distance from the weapon. That
    // is what makes the deck read as a room: darkest under your feet, brightest
    // at the horizon. Distance-from-origin (what this used to do) brightens the
    // near field too, which is the "lit grid floating in a void" look.
    // Haze per metre of camera distance, and the metres of clear deck before it
    // starts. These look far too aggressive until you measure what is actually
    // on screen: the eye sits ~18 cm above the deck, so the bottom HALF of the
    // frame covers only 1.1 m down to 0.5 m, and everything past ~5 m is
    // crushed into the few pixels above it. The whole gradient therefore has to
    // happen between roughly 0.5 m and 5 m — a gentle per-metre figure spreads
    // the ramp over distances that occupy no pixels and the deck comes out flat.
    // Reduced once the reflection landed: Fresnel brightens toward the horizon
    // for the same geometric reason haze does, so at the old 0.5 the two
    // stacked and the horizon blew out. Haze is now only the atmosphere.
    haze: 0.26,
    hazeStart: 0.4,
    // The deck has to arrive at the sky's horizon glow, not just at its base
    // horizon colour, or there is a visible step in value exactly on the join.
    // Match `sky.band`; `bandRamp` is how much of the haze ramp it occupies
    // (0.6 = the glow only shows over the last 40% of the fade).
    floorBand: 0x0d151d,
    bandRamp: 0.6,
    // ---- Panel seams ------------------------------------------------------
    // OFF by default, and only because the deck MAP now carries its own panel
    // grid — two grids at different pitches read as a mistake, and the map's
    // pitch is irregular so there is nothing to align a procedural grid to.
    // The seam light comes from `grooveGlow` below instead, which lights the
    // map's own grooves and is therefore aligned by construction.
    //
    // Turn this back on (and drop `deckUrl`) if you ever want a deck whose
    // panelling is generated rather than authored. It is NOT a ruled grid:
    // `seamDrop` keeps or drops each minor segment on a hash of (boundary
    // index, cell along it), so runs stop short and T-junctions form the way
    // real panelling does. Major seams never drop.
    proceduralSeams: false,
    seamGroove: 0x02040a,   // the recessed line itself, darker than the plate
    // Groove half-width in METRES, and it has to be a real panel gap — a few
    // millimetres. The deck near the camera covers roughly 1.4 mm per pixel, so
    // 0.010 here is a 14-pixel bar, which is how you end up with Tron instead
    // of a hangar. seamCoverage takes care of the far end going sub-pixel.
    seamWidth: 0.0022,
    seamMajorWidth: 0.004,
    // The light in the seam. This one is NOT authored as a final pixel like the
    // surface colours are — it is a LIGHT, so it lives in scene-linear and its
    // strength runs above 1.0 on purpose. That is what puts it over the bloom
    // threshold and lets ACES roll it off, which is the whole "glowing" read.
    // Cool WHITE, not cyan. A saturated hue here interacts badly with the bloom
    // threshold: only the green and blue channels clear it, so the halo comes
    // out neon regardless of how far the strength is turned down.
    seamGlow: 0xcfe6f7,
    seamGlowStrength: 0.8,
    seamGlowMajor: 1.3,
    // Brightness variation per plate edge, so a run does not read as one
    // uniform strip of light. 0 = every seam identical.
    seamVary: 0.45,
    seamGlowWidth: 0.014,   // how far the light bleeds either side, metres
    seamDrop: 0.45,         // fraction of minor seam segments that are missing
    // Per-plate brightness variation. Keep it small: a plate's tone is hashed
    // per CELL, so where a seam has been dropped and two cells read as one
    // plate, a large value shows the step across a seam that is not there.
    panelTone: 0.07,
    seamNear: 0.6,      // camera distance where seams start to appear...
    seamNearSoft: 3.0,  // ...and where they reach full strength. The near metre
                        // of deck stays clean; the haze kills them far away.
                        // Also gates grooveGlow.

    // Light in the deck map's OWN grooves. Keyed off the map going DARK, so it
    // follows whatever panelling the map has — no alignment problem, and it
    // inherits the map's irregularity for free. Like seamGlow this is a LIGHT:
    // scene-linear, driven past 1.0 so it clears the bloom threshold.
    //
    // OFF, and it stays off for as long as the deck map is an emissive one. This
    // lights the map where it is darkest, which on a lit-grid map is the plate
    // field — the grid itself would get nothing and the glow would come out
    // sprayed over the plates' darkest noise. `deckEmisStrength` below is the
    // same idea keyed the right way round for this kind of map.
    grooveGlow: 0xcfe6f7,
    grooveGlowStrength: 0,
    grooveLo: 0.05,     // map/mean at or below this is fully "groove"...
    grooveHi: 0.42,     // ...and at or above this is fully "plate"
    // Surface detail — the scuffs and polish smears, and the thing doing more
    // work than the grid is. A TEXTURE rather than procedural noise, and not
    // only because it looks better: the deck is seen at a grazing angle, where
    // any procedural pattern drops below one period per pixel and aliases into
    // moire. Mipmaps plus anisotropic filtering are the hardware answer to
    // exactly that, and a shader function cannot have them.
    //
    // ---- authored GLB deck --------------------------------------------------
    // Set this and the whole procedural deck below stands down: the shader quad
    // is still BUILT (everything from _placeStage to the thumbnail bake holds a
    // reference to it) but switched off, so setting this back to null restores
    // the old deck with no other edit. The GLB owns its own material — albedo,
    // emissive, roughness, specular — so it is authored in Blender and nothing
    // here needs re-tuning to follow it.
    //
    // floor_gun.glb is a 20 x 20 m plane at Y=0 with floor_1 wired as baseColor
    // AND emissive (strength 2) AND specular colour, roughness 0.29. Note its
    // metallicFactor is absent, which in glTF means 1.0 — a fully metallic deck
    // with a near-black albedo has almost no diffuse, so what you see is the
    // environment reflection plus the emissive. That is a Blender-side call.
    // null = the deck below. Point it back at '/Maps/floor_gun.glb' to restore
    // the authored GLB deck exactly as it was.
    deckGlb: null,
    deckGlbScale: 1,
    // ---- deck-only haze -----------------------------------------------------
    // The GLB deck's own fog, patched into its material and nothing else's. The
    // scene fog cannot do this job: the weapon shares the scene, it sits 0.6-1.3 m
    // from the eye, and any fog pulled in close enough to fade the deck starts
    // eating the back of the rifle. That is why `fogFar` is out at 16.
    //
    // EXPONENTIAL, not linear like THREE.Fog, and measured from the CAMERA — the
    // same form the procedural deck used before the GLB replaced it. Exponential
    // matters for more than the falloff shape: it never fully arrives, so there
    // is no far plane to tune and the 20 m deck's own EDGE is hazed out of
    // existence at every pitch instead of being something to keep off screen.
    //
    // Applied after three's fog chunk, so it catches the emissive grid too and
    // fogged lines drop back under `bloomThreshold` and stop glowing — which is
    // most of what makes distance read as distance here.
    //
    // Per metre, and the old 0.26 is no guide: that was tuned for a deck meant to
    // reach the horizon. At 0.9 the deck is 78% gone by 2 m and done by 3 m.
    deckHaze: 0.9,
    deckHazeStart: 0.3,  // metres of clear deck before it starts
    deckHazeColor: null, // null = follow `fogColor`, so the deck and the weapon
                         // recede into the same horizon

    // Metres per texture repeat, the same convention as `deckTile`. null = leave
    // the GLB's own UVs exactly as authored, which is the right setting once the
    // tiling is done in Blender. As exported the UVs run 0..1 across the full
    // 20 m plane, so the grid lands on 4 m centres; 2.5 here puts it back on the
    // 0.5 m pitch the stage was built around.
    deckGlbTile: 2.5,
    // `deckUrl` null = a seamless one is generated into a canvas at startup, so
    // this works with no asset. Point it at a real authored map and that wins.
    //
    // The map is read TWICE, on two different curves, split at `deckEmisFloor`:
    //   * BELOW it the map is SURFACE — multiplied into the deck colour against
    //     the map's own mean (measured at load, so any map drops in without
    //     re-tuning uDetail). This is the grain, the tick marks, the panel tone.
    //   * ABOVE it the map is LIGHT — added in scene-linear, past 1.0 on purpose.
    // Reading it once as a multiplier is what a plate-albedo map wants and is
    // exactly wrong for a lit one: a glow line multiplied into a base of
    // `floorBase` is still near-black, and the whole grid goes out.
    //
    // This map is a lit tactical grid on a near-black field: mean luma 0.042,
    // 91% of its pixels under 0.063, and everything above that is the grid and
    // its halo reaching a full 1.0. Hence the floor sitting where it does.
    // null = generate a LOW-FREQUENCY map into a canvas at startup: broad soft
    // buff smears, nothing else. That is the whole point rather than a fallback.
    //
    // Fine detail cannot work at this camera. The eye sits 4.8 cm above the deck,
    // so the texel footprint runs about g^2 x 1.1 mm at ground distance g: ~5 mm
    // of detail survives at 2 m, 27 mm at 5 m, 110 mm at 10 m. Anything small
    // therefore reads for a metre or two and then vanishes, and the line where it
    // vanishes is a visible edge across the middle of the floor — the failure
    // every plate map, grid map and emissive map here has hit in turn.
    //
    // Broad soft shapes have no such line. Averaging a smooth gradient returns
    // the same gradient, so the deck looks identical at 0.3 m and at 5 m, and
    // consistency is what actually reads as a surface.
    //
    // Authoring rule if this is ever replaced by a hand-made map: nothing smaller
    // than ~20 cm, soft edges only. It will look nearly blank in Blender and
    // correct on the stand.
    deckUrl: null,
    deckSeamBlend: 0,    // 0 = already tiles as authored. Leave it there for this
                         // map: it has a grid line sitting ON the border, and
                         // mirror-blending a band would ghost a second one beside
                         // it. Its edge columns already agree to ~0.002 luma.
    deckTile: 2.5,       // metres per repeat — its 5 cells land on `gridStep`
                         // exactly, so the authored grid and the 0.5 m world
                         // ruler are the same lines instead of two beating grids
    deckDetail: 0.85,    // how hard the map modulates the deck as ALBEDO. Note
                         // this multiplies, so against a floorBase this dark it
                         // does much less than `deckNormal` does — the streaks
                         // read because they catch light, not because they are
                         // painted lighter.
    // ---- the generated map's two layers ------------------------------------
    // Broad soft smears: the buffed direction, and the only content here meant to
    // read as form rather than detail.
    deckSmears: 260,
    // Short scratches on top. These are what the reference floor's glints are;
    // 0 leaves only the smears. Higher than it looks like it needs to be, because
    // they are now 3-15% of the map rather than crossing all of it.
    deckScratches: 400,
    // Scratches are grouped rather than scattered — wear happens where something
    // was dragged, not uniformly. Fewer clusters = more obviously worn patches.
    deckScratchClusters: 14,
    deckScratchSpread: 0.18, // cluster radius as a fraction of the map
    // Degrees either side of the buff direction. Both extremes fail: 0 puts every
    // scratch on a line of constant depth where they band into scanlines, and 90
    // (fully random) reads as hatching. See the note in _deckTexture.
    deckScratchAngle: 22,
    deckMapMax: 1.8,     // clamp on map/mean. Applies to the SURFACE read only —
                         // it is what stops a grid line, which is ~24x the mean,
                         // also blowing out as albedo underneath its own glow
    floorAlpha: 1,      // the deck is opaque now; this is a global escape hatch
    // ---- the deck map's emissive grid --------------------------------------
    // Read in RAW luminance, not against the mean, because the levels here are
    // absolute and known. Subtracting a floor and rescaling PRESERVES the falloff
    // the art already carries — the soft halo either side of every line is in the
    // texture, and a smoothstep invented on top of it would only flatten it.
    // Like seamGlow this is a LIGHT: scene-linear, driven past 1.0 so it clears
    // `bloomThreshold` (0.35), ACES rolls it off and bloom widens it.
    deckEmisFloor: 0.06,  // luma at or below this is surface, above it is light
    // Cool WHITE with a blue lean, NOT the map's own saturated blue. A saturated
    // hue interacts badly with the bloom threshold: only the green and blue
    // channels clear it, so the halo comes out neon no matter how far the
    // strength is turned down. The map supplies the SHAPE, this supplies the hue.
    deckEmisColor: 0xa9cdf5,
    // 0, and it MUST be 0 for a smear map. This term lights whatever the map has
    // above `deckEmisFloor`, and a smear map sits around 0.5 luma everywhere —
    // the entire floor would clear the floor value at once and glow white. It is
    // only meaningful against a map that is near-black with bright marks on it.
    deckEmisStrength: 0,
    // Near gate, same idea as `seamNear` but its own knobs and much tighter: the
    // grid is the point here, not a garnish, so it only needs to stay off the
    // half-metre of deck directly under the camera where a hot line would sit at
    // the very bottom of frame and pull the eye off the weapon.
    deckEmisNear: 0.25,
    deckEmisSoft: 1.2,
    // ---- Environment reflection -------------------------------------------
    // What makes the deck read as a polished floor in a room rather than a dark
    // plane with lines on it, and the biggest single thing the stage was
    // missing. The eye sits ~18 cm above the deck, so nearly every floor pixel
    // is seen at a grazing angle — and at grazing angles a dielectric reflects
    // almost everything. That one effect produces all three things the
    // reference has at once: the brightening toward the horizon, the broad soft
    // smears, and the wet look.
    //
    // It is close to free because the sky is already a pure function of ray
    // direction (see SKY_FN in menu.js): reflect the view vector about the
    // floor normal and evaluate that same function. No render target, no
    // second pass, nothing to keep in sync.
    reflectF0: 0.045,      // reflectance looking straight down; ~0.04 dielectric
    reflectStrength: 1.0,  // global multiplier on the mirrored sky
    reflectRough: 0.20,    // blur, as a spread in the reflected ray's Y
    // Broad rough-specular lobes off the existing key and front lights. At a
    // grazing view these stretch along the surface into the long horizontal
    // smears the reference floor has — lower specPower = longer and softer.
    specColor: 0xdcefff,
    specPower: 90,
    specKey: 0.45,
    specFront: 0.9,
    glossVar: 0.9,         // how far the deck map breaks up the polish
    // Strength of the surface normal derived from the deck map (Sobel of its
    // luminance, packed into the map's G/B at load — see _packDeckMap). This is
    // what lets bolts and groove chamfers catch the reflection and the spec
    // lobes; without it the deck is a mathematically flat plane and every piece
    // of relief in the texture is painted-on shading that cannot respond to
    // light. Faded out with haze in the shader, since normal maps alias badly
    // at exactly the grazing angles the far deck is seen at.
    //
    // THE knob for this floor, and the reason its streaks are visible at all.
    // The deck map only MULTIPLIES albedo, and against a floorBase this near
    // black a multiply does nothing — the smears and scratches would be there in
    // the texture and invisible on screen. Tilting the surface instead makes them
    // catch the Fresnel sky reflection and the spec lobes, which at this grazing
    // an angle stretch into exactly the long horizontal glints a buffed floor has.
    //
    // Was 0 while the map was an emissive grid: treating a lit grid as a height
    // field puts a hard bevel down either side of every glow line. A smear map
    // has the opposite problem and wants this ON — its gradients are broad and
    // soft, which is the only kind of relief that survives out here anyway.
    deckNormal: 0,
    // Radius in texels that the height is blurred by BEFORE the gradient is
    // taken. 0 lets the map's film grain become normals, which reads as speckle
    // on the deck rather than as surface relief; the features worth catching
    // light (bolts, chamfers, groove edges) are all much wider than this.
    deckNormalBlur: 0,

    reflect: 0.2,      // mirrored-gun opacity at the contact line...
    reflectFade: 0.13, // ...falling to nothing this many metres below it
    // Blur on the mirrored weapon, with no render target involved: the copy is
    // drawn `reflectBlurTaps` times, each offset in SCREEN space by an amount
    // proportional to how far below the mirror line that vertex sits.
    //
    // Scaling by depth is the whole point. A real reflection is sharp where the
    // object meets the surface and smears as it recedes, so a uniform offset
    // would blur the contact line too and visibly unstick the weapon from the
    // deck. Offsets are mostly vertical because that is the direction a floor
    // reflection actually spreads on screen.
    // Tap count is a SMOOTHNESS knob, not a strength one: too few and the
    // copies read as discrete ghosts instead of a blur. A 2D kernel needs more
    // of them than a 1D one did to cover the same area. Cost is only draw calls
    // of geometry that is already resident.
    reflectBlurTaps: 12,
    reflectBlur: 0.1,       // kernel radius, NDC per metre of depth. The size
                             // of the blur — raise to make the deck rougher.
    reflectBlurAspect: 1, // kernel width / height. 1 = round, lower = the
                             // vertical stretch a floor reflection really has.
                             // Do NOT take this to 0: that collapses the kernel
                             // back to a line and it reads as an offset copy
                             // again rather than as a rough surface.
    reflectBlurMin: 0.03,    // spread still present AT the contact line, in the
                             // same units as depth. 0 makes the reflection
                             // perfectly sharp where it touches the deck.
    shadowAlpha: 0.55,
    shadowSize: 1024,

    // Atmosphere on the weapon itself, so its far end sits back a little.
    // three applies fog AFTER tone mapping and colour-space conversion
    // (fog_fragment sits below tonemapping_fragment in the shader), so this is
    // a FINAL DISPLAY colour like everything else on the stage — see the
    // LinearSRGBColorSpace note where it is built in menu.js.
    // ---- Bloom ------------------------------------------------------------
    // The point of this is the seams: a bright line without bloom is just a
    // bright line, and no amount of tuning the seam colour makes it read as
    // light coming out of the floor. It runs on the LINEAR HDR buffer between
    // the scene render and tone mapping, so `threshold` is a scene radiance and
    // not a display value — the deck sits around 0.02 there and the seams are
    // pushed above 1.0 by seamGlowStrength, which is what separates them.
    bloom: true,
    bloomStrength: 0.35,
    bloomRadius: 0.4,
    bloomThreshold: 0.35,

    fog: true,
    fogColor: 0x0d131c, // match `sky.horizon`
    fogNear: 1.0,       // metres from the camera where haze starts
    fogFar: 16,         // ...and where it would be total. Keep this large: the
                        // weapon spans ~1 m, so it should only pick up a few
                        // percent across its length.

    // Loadout-card art, baked off the real models as blueprint line work.
    // `cardEdgeAngle` is the crease threshold in degrees: only edges where two
    // faces meet at more than this become lines. Low values approach a full
    // wireframe (triangulation noise on these meshes); high values keep only the
    // silhouette and the major panel breaks, which is the reference look.
    cardEdgeAngle: 24,
    cardLineColor: 0xa8c8de,
    // ---- Hidden-line removal -----------------------------------------------
    // Without this the bake draws EVERY edge of every mesh with nothing to
    // occlude them: the far side of the gun and its internals show straight
    // through, which is where the bits of weapon floating in mid-drawing came
    // from. On, the solid model goes into the depth buffer first (colour writes
    // off, so it stays invisible) and the lines depth-test against it.
    cardHiddenLine: true,
    // Polygon offset pushing that depth-only solid AWAY from the camera, so a
    // line lying exactly ON the surface it came from still wins the depth test.
    // Too low and the drawing stipples as lines z-fight with their own surface;
    // too high and edges just behind a near surface start leaking through.
    cardDepthBias: 1,
    // ...and the matching push on the silhouette hull, which must be LARGER
    // than cardDepthBias or a hull face landing on the same surface as the
    // occluder wins the tie and floods the body solid. See the note by hullMat.
    cardSilhouetteBias: 8,
    // ---- Silhouette --------------------------------------------------------
    // Outline width in NDC (roughly a fraction of half the frame height); 0 is
    // off. This is the OTHER half of the floating-pieces problem and hidden-line
    // removal cannot fix it: a smooth cylinder — barrel, scope tube, suppressor
    // — has no crease anywhere along its length, so at any `cardEdgeAngle` it
    // contributes only its two end caps and reads as a pair of rings hanging in
    // space. An inverted-hull pass (back faces, expanded along the normal) draws
    // the true contour of curved parts, which is what joins them up.
    cardSilhouette: 0.0035,
    cardThumbW: 528,   // 2x the card's image box, and matched to its aspect so
    cardThumbH: 168,   // object-fit:contain fills the card instead of letterboxing

    // Hero-shot lighting. Ambient is deliberately LOW and the directionals high:
    // definition comes from the ratio between them, so filling the shadows is
    // exactly what flattens the weapon out. Tone mapping is armory-only — the
    // match, lobby and deploy renderers are still linear, so the same rifle is
    // lit differently here than in your hands. That is deliberate.
    light: {
      exposure: 1.2,          // ACES filmic tone-mapping exposure
      env: 0.25,              // RoomEnvironment PMREM — the specular ambient
      envBlur: 0.25,          // lower = sharper reflections = crisper highlights
      hemi: 0.1,             // sky/ground diffuse ambient
      hemiSky: 0xdfeeff,
      hemiGround: 0x394450,
      // The *Pos entries are DIRECTIONS, not places: these are DirectionalLights,
      // so only the angle from the origin matters and distance is irrelevant. The
      // weapon lies along X with its muzzle at -X; the camera sits at +Z.
      key: 0.25, keyColor: 0xffffff, keyPos: [2, 3, 4],      // front-right, main shaper
      // High and directly BEHIND. A rim has to graze along the silhouette to draw
      // an edge — the old [-3, 1, -2] was nearly level with the gun, so it lit the
      // far side, the side facing away from you, and did essentially nothing.
      rim: 1.0, rimColor: 0x808080, rimPos: [0, 3.6, -3.0],
      top: 5, topColor: 0x808080, topPos: [2, 5, 2], // ALSO the shadow caster
      // Light thrown back UP off the deck. Nothing else lights the underside —
      // key/rim/top are all overhead and the hemisphere's ground term is far too
      // weak on its own. Tinted like the deck, because that is what it is
      // bouncing off. Push it too far and the gun starts to look like it is lit
      // from a floor panel rather than resting on one.
      bounce: 0.5, bounceColor: 0xffffff, bouncePos: [0.5, -3, 1.5],
      // Upper-front-LEFT, on the muzzle side. The reference's read comes from
      // here: it is what puts the highlight along the barrel, the top of the
      // carry handle and the crown of the scope. `key` sits at +X and only lights
      // the stock end; `rim` is on the muzzle side but behind, so between them the
      // front of the weapon got nothing.
      front: 2.0, frontColor: 0xffffff, frontPos: [-3.4, 3.6, 2.8],
    },
  },

  ai: {
    spreadPerMeter: 0.00012,
    damageScale: 0.85,      // AI bullets hit a bit softer, keeps TTK fair at 32v32
    thinkInterval: 0.4,
    squadReplanInterval: 8,
  },

  // Team-wide class rotation (squads end up with varied mixes; ~1 in 5 is a Spartan)
  squadComposition: ['spartan', 'assault', 'engineer', 'recon', 'support'],

  colors: {
    blue: 0x3aa0ff,
    red: 0xff5a4d,
    blueDim: 0x1d5f9e,
    redDim: 0x99342c,
  },
};

// ---------------------------------------------------------------------------
// Weapons. `ai` block: range/aiMin define the usable band for AI weapon choice;
// burst/interval/pause drive the AI trigger discipline; spread is base aim error.
// falloff: [start, end, farFraction-of-damage].
// ---------------------------------------------------------------------------
export const WEAPONS = {
  ar: {
    name: 'MA5 ASSAULT RIFLE', model: '/UNSC/weapons/assault rifle/assault-rifle.glb', len: 0.85,
    icon: '/UNSC/weapons/assault rifle/Assault-Rifle-line.svg',
    grip: { pos: [0.08, 0.25, 0.02], rot: [-1.75, -0.2, -1.57] },
    mode: 'auto', rpm: 620, dmg: 8.5, mag: 60, reserve: 240, reload: 2.3,
    spreadHip: 0.028, spreadAds: 0.007, adsFov: 55,
    ads: { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [35, 150, 0.47], range: 320,
    tracer: { style: 'bolt', color: [1, 0.85, 0.5], len: 2, speed: 420, every: 2, opacity: 0.25 },
    snd: { key: 'shot', rate: 1.05, vol: 0.5 },
    ai: { aiMin: 0, range: 160, burst: [3, 6], interval: 0.11, pause: [0.35, 0.95], spread: 0.008 },
  },
  br: {
    name: 'BR55 BATTLE RIFLE', model: '/UNSC/weapons/battle-rifle/battle-rifle.glb', len: 0.95,
    icon: '/UNSC/weapons/battle-rifle/Battle-Rifle_Icon.svg',
    grip: { pos: [0.04, 0.29, 0.02], rot: [-1.5, -0.2, -1.5] },
    fp: { pos: [0.15, 0.11, -0.31], rot: [0, 0, 0] },
    mode: 'burst', burst: 3, burstInterval: 0.06, rpm: 270, dmg: 11, mag: 36, reserve: 288, reload: 2.4,
    spreadHip: 0.014, spreadAds: 0.004, adsFov: 25,
    ads: { pos: [0.145, -0.235, -0.43], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [60, 230, 0.55], range: 420,
    tracer: { style: 'bolt', color: [0.7, 0.9, 1], len: 5, speed: 500, opacity: 0.5 },
    snd: { key: 'shot', rate: 1.0, vol: 0.5 },
    ai: { aiMin: 0, range: 210, burst: [3, 3], interval: 0.06, pause: [0.55, 1.1], spread: 0.006 },
  },
  smg: {
    name: 'M7 SMG', model: '/UNSC/weapons/SMG/SMG.glb', len: 0.62,
    icon: '/UNSC/weapons/SMG/SMG_icon.svg',
    grip: { pos: [-0.03, 0.28, 0.02], rot: [-1.57, -0.2, -1.5] },
    mode: 'auto', rpm: 900, dmg: 6, mag: 60, reserve: 360, reload: 2.1,
    spreadHip: 0.042, spreadAds: 0.018, adsFov: 60,
    ads: { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [20, 80, 0.35], range: 200,
    tracer: { style: 'bolt', color: [1, 0.8, 0.45], len: 2.8, speed: 380, every: 2, opacity: 0.5 },
    snd: { key: 'shot', rate: 1.35, vol: 0.35 },
    ai: { aiMin: 0, range: 75, burst: [5, 9], interval: 0.067, pause: [0.3, 0.7], spread: 0.014 },
  },
  shotgun: {
    name: 'M90 SHOTGUN', model: '/UNSC/weapons/Shotgun/Shotgun_2.1.glb', len: 0.95,
    icon: '/UNSC/weapons/Shotgun/Shotgun_icon.svg',
    mode: 'pump', rpm: 62, dmg: 6.5, pellets: 8, pelletSpread: 0.045, mag: 8, reserve: 40, reload: 3.0,
    grip: { pos: [0.03, 0.38, 0], rot: [-1.57, -0.25, -1.5] },
    fp: { pos: [0.2, 0.07, -0.36], rot: [0, 0, 0] },
    spreadHip: 0.01, spreadAds: 0.006, adsFov: 60,
    ads: { pos: [0.2, -0.195, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [12, 42, 0.2], range: 90,
    tracer: { style: 'bolt', color: [1, 0.7, 0.4], len: 1.6, speed: 300, every: 3, opacity: 0.5 }, // per pellet -> keep sparse
    snd: { key: 'shot', rate: 0.62, vol: 0.75 },
    ai: { aiMin: 0, range: 32, burst: [1, 1], interval: 1.0, pause: [0.9, 1.5], spread: 0.012 },
  },
  dmr: {
    name: 'M392 DMR', model: '/UNSC/weapons/DMR/DMR.glb', len: 1.0,
    icon: '/UNSC/weapons/DMR/DMR_icon.svg',
    grip: { pos: [0.08, 0.33, 0.02], rot: [-1.57, -0.15, -1.5] },
    fp: { pos: [0.18, 0.12, -0.23], rot: [0, 0, 0] },
    mode: 'semi', rpm: 260, dmg: 20, mag: 15, reserve: 135, reload: 2.4,
    spreadHip: 0.012, spreadAds: 0.0025, adsFov: 15,
    ads: { pos: [0.171, -0.231, -0.43], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [80, 300, 0.6], range: 500,
    tracer: { style: 'bolt', color: [0.75, 0.92, 1], len: 5.5, speed: 520, opacity: 0.5 },
    snd: { key: 'dmrShot', rate: 1.0, vol: 0.55 },
    ai: { aiMin: 40, range: 260, burst: [1, 2], interval: 0.4, pause: [0.9, 1.6], spread: 0.006 },
  },
  sniper: {
    name: 'SRS99 SNIPER', model: '/UNSC/weapons/sniper/sniper.glb', len: 1.35,
    icon: '/UNSC/weapons/sniper/Sniper_icon.svg',
    grip: { pos: [0.08, 0.45, 0.02], rot: [-1.5, -0.25, -1.5] },
    fp: { pos: [0.15, 0.1, 0.02], rot: [0, 0, 0] },
    // Live scope screen. `material` is matched case-insensitively against the
    // authored material name. The camera sits at that mesh and is boresighted
    // to the crosshair (see scopedisplay.js), so pos/rot are nudges from that
    // — both zero is already correct. fov IS the magnification.
    scope: { material: 'sniper_screen', fov: 5, pos: [0, 0, 0], rot: [0, 0, 0], size: 256 },
    mode: 'semi', rpm: 46, dmg: 80, mag: 4, reserve: 20, reload: 3.2,
    spreadHip: 0.03, spreadAds: 0.0012, adsFov: 22,
    ads: { pos: [0.15, -0.195, -0.435], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [200, 500, 0.8], range: 700,
    tracer: { style: 'vapor', color: [1, 0.9, 0.6], life: 0.85, drift: 0.35, opacity: 0.55 }, // lingering smoke trail
    snd: { key: 'sniperShot', rate: 1.0, vol: 0.65 },
    ai: { aiMin: 60, range: 320, burst: [1, 1], interval: 1.5, pause: [2.8, 4.8], spread: 0.005 },
  },
  rocket: {
    name: 'M41 ROCKET LAUNCHER', model: '/UNSC/weapons/rocket-launcher/Rocket-Launcher.glb', len: 1.15,
    icon: '/UNSC/weapons/rocket-launcher/Rocket-Launcher_icon.svg',
    grip: { pos: [0.3, 0.11, 0.04], rot: [-1.5, -0.3, -1.5] },
    fp: { pos: [0.07, 0.21, -0.31], rot: [0, 0, 0] },
    mode: 'projectile', rpm: 50, dmg: 120, splash: 5.5, projSpeed: 55, mag: 2, reserve: 8, reload: 3.4,
    spreadHip: 0.008, spreadAds: 0.004, adsFov: 50,
    ads: { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [50, 200, 1], range: 400,
    snd: { key: 'rocketShot', rate: 1.0, vol: 0.7 },
    ai: { aiMin: 35, range: 130, burst: [1, 1], interval: 1.2, pause: [3, 5], spread: 0.01, cooldown: 12 },
  },
  laser: {
    name: 'SPARTAN LASER', model: '/UNSC/weapons/Spartan-Laser/Spartan-Laser.glb', len: 1.15,
    icon: '/UNSC/weapons/Spartan-Laser/Spartan-Laser_icon.svg',
    grip: { pos: [0.3, 0.11, 0.04], rot: [-1.5, -0.3, -1.5] },
    fp: { pos: [0.12, 0.18, -0.43], rot: [0, 0, 0] },
    // Screen material is authored with emissive black and no base map, unlike
    // the sniper's — scopedisplay.js forces emissive white so the render shows.
    scope: { material: 'Spartan-Laser_screen', fov: 8, pos: [0, 0, 0], rot: [0, 0, 0], size: 256 },
    mode: 'charge', chargeTime: 1.1, rpm: 40, dmg: 150, mag: 5, reserve: 5, reload: 3.0,
    spreadHip: 0.004, spreadAds: 0.0015, adsFov: 30,
    ads: { pos: [0.18, -0.195, -0.405], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 },
    falloff: [400, 800, 1], range: 800,
    tracer: { style: 'beam', color: [1, 0.15, 0.1], life: 0.3, opacity: 0.85 }, // it IS a laser
    snd: { key: 'sniperShot', rate: 0.55, vol: 0.7 },
    ai: { aiMin: 60, range: 240, burst: [1, 1], interval: 1.5, pause: [6, 10], spread: 0.005 },
  },

  // --- Sidearms ------------------------------------------------------------
  // The default occupant of the second weapon slot. Every class starts with one
  // and the ones that spend a gadget slot trade UP out of it (Assault's webbing,
  // Engineer's launcher, Recon's long gun), so a sidearm has to be worth
  // carrying on its own rather than being a consolation prize.
  //
  // Both are balanced deliberately BELOW the rifles on sustained output and
  // above them on one axis only: `swapTime`. The niche is the dry-mag moment,
  // not the stand-up fight.
  //
  // The two differ on volume vs punch, and land within ~0.05 s of each other on
  // time-to-kill against 100 EHP so neither is simply better:
  //   M6C  15 x 7 shots at 330 rpm = 1.09 s, 12 in the magazine
  //   M6G  22 x 5 shots at 210 rpm = 1.14 s,  8 in the magazine
  // The M6G kills in fewer hits and punishes a miss far harder — five of its
  // eight rounds are the kill, so a magazine is one engagement.
  magnum: {
    // len matches the GLB's authored longest axis (0.26 m), so the model keeps
    // the scale it was built at — an M6 is ~0.27 m, so it was already right.
    name: 'M6C MAGNUM', model: '/UNSC/weapons/Magnum/Magnum_2.1.glb', len: 0.26,
    icon: '/UNSC/weapons/Magnum/Pistol_icon.svg',
    // UNTUNED — seeded from the M7's pose because it is the closest thing in the
    // armoury by size, and a pistol is held nothing like an SMG. Wants a pass in
    // /chartest.html: GRIP tab -> `grip`, VIEWMODEL tab -> `fp`, ADS tab -> `ads`.
    grip: { pos: [-0.03, 0.28, 0.02], rot: [-1.57, -0.2, -1.5] },
    fp: { pos: [0.17, 0.02, -0.38], rot: [0, 0, 0] },
    ads: { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 14 },
    mode: 'semi', rpm: 330, dmg: 15, mag: 12, reserve: 60, reload: 1.9,
    swapTime: 0.2,          // the whole point of the weapon — see CFG.player.swapTime
    spreadHip: 0.022, spreadAds: 0.006, adsFov: 50,
    falloff: [18, 65, 0.35], range: 120,
    tracer: { style: 'bolt', color: [1, 0.82, 0.5], len: 3, speed: 440, opacity: 0.45 },
    snd: { key: 'pistolShot', rate: 1.0, vol: 0.5 },
    ai: { aiMin: 0, range: 50, burst: [2, 3], interval: 0.18, pause: [0.5, 1.0], spread: 0.011 },
  },
  m6g: {
    // Same M6 family as the M6C, a different Misriah export: polished chrome
    // where the other is worn gunmetal, so the two read apart instantly on the
    // card and in the hand despite sharing a silhouette.
    // len is the GLB's authored longest axis (0.235 m) — slightly shorter than
    // the M6C's model, which is the export's own proportion, not a mistake.
    name: 'M6G MAGNUM', model: '/UNSC/weapons/pistol/pistol.glb', len: 0.235,
    icon: '/UNSC/weapons/pistol/Pistol_icon.svg',
    // UNTUNED — same seed as the M6C. Both want a /chartest.html pass:
    // GRIP tab -> `grip`, VIEWMODEL tab -> `fp`, ADS tab -> `ads`.
    grip: { pos: [-0.03, 0.28, 0.02], rot: [-1.57, -0.2, -1.5] },
    fp: { pos: [0.17, 0.02, -0.38], rot: [0, 0, 0] },
    ads: { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 13 },
    mode: 'semi', rpm: 210, dmg: 22, mag: 8, reserve: 48, reload: 2.0,
    // Still far faster than a reload, but a beat slower than the M6C — the
    // heavier gun costs you something on the draw as well as in the magazine.
    swapTime: 0.28,
    spreadHip: 0.020, spreadAds: 0.005, adsFov: 45,
    falloff: [22, 80, 0.45], range: 150,
    tracer: { style: 'bolt', color: [1, 0.86, 0.6], len: 3.4, speed: 460, opacity: 0.5 },
    snd: { key: 'pistolShot2', rate: 1.0, vol: 0.55 },
    ai: { aiMin: 0, range: 55, burst: [1, 2], interval: 0.28, pause: [0.6, 1.2], spread: 0.010 },
  },

  // --- Mounted ---------------------------------------------------------------
  // `mounted: true` means the GEOMETRY BELONGS TO A VEHICLE, not to a pair of
  // hands. It is in WEAPONS for the same reason the tools are: this registry is
  // everything that can shoot, and combat.js, the tracer pool and the audio
  // mixer all read a def off it. What `mounted` buys is an exemption from the
  // three systems that assume a def owns a GLB — assets.js does not load a
  // model for it, and /chartest.html's GRIP and VIEWMODEL tabs skip it, because
  // there is no hand pose to tune on something bolted to a roll cage.
  //
  // It is not in any armoury pool, so it can never be selected as a loadout
  // weapon; what puts it in front of you is sitting in the gunner's seat.
  hogturret: {
    name: 'M41 LAAG', mounted: true,
    mode: 'auto', rpm: 480, dmg: 17, mag: 200, reserve: 800, reload: 4.5,
    // No ADS: it is a ring-mounted gun with iron sights you do not lean into.
    // The hip figure is the only spread it has, and it is tight because the
    // mount is doing the stabilising a soldier's arms cannot.
    spreadHip: 0.012, spreadAds: 0.012, adsFov: 55,
    falloff: [90, 320, 0.62], range: 520,
    tracer: { style: 'bolt', color: [1, 0.78, 0.42], len: 7, speed: 560, every: 1, opacity: 0.6 },
    snd: { key: 'shot', rate: 0.72, vol: 0.8 },
  },

  // --- Tools ---------------------------------------------------------------
  // Not a weapon, and in WEAPONS on purpose. This registry is not "guns" — it is
  // everything that mounts in a pair of hands, and four systems already walk it:
  // assets.js loads and length-normalizes it, player._mountGun reads `fp`,
  // soldier._setHeldWeapon reads `grip`, and /chartest.html's GRIP and VIEWMODEL
  // tabs enumerate Object.keys(WEAPONS). A tool defined outside it would need all
  // four written a second time, and — the part that actually matters — its hold
  // pose would have to be GUESSED instead of tuned on the range.
  //
  // Membership grants a MOUNT, not a loadout slot. The armoury pickers read the
  // pools (STANDARD_POOL / SIDEARM_POOL / ALL_WEAPONS), never Object.keys, so
  // nothing here can be selected as a weapon. What puts it in your hands is
  // GADGETS.repairtool naming it in `held`.
  //
  // Everything downstream branches on the `tool` block, never on the key — the
  // same rule structures.js follows with `def.wall` / `def.beacon`.
  repairtool: {
    name: 'REPAIR TOOL', model: '/UNSC/gadgets/repair_tool.glb', len: 0.36,
    // Slower than any sidearm and slower than the rifles. Reaching for the tool
    // is meant to be a decision you make between engagements, not a thing you
    // flick to mid-fight — `swapTime` is the only place that can be stated.
    swapTime: 0.75,
    // `fp` was blocked out on the demo map rather than guessed: the GLB is
    // authored with its nozzle down +X and the canister down -Y, so it needs a
    // yaw of about -90 degrees before it points anywhere near the crosshair, and
    // a scale nudge because a 0.36 m torch seen nose-on barely reads. `grip` is
    // still a seed from the Magnum's. Both want a /chartest.html pass — GRIP tab
    // -> `grip`, VIEWMODEL tab -> `fp`.
    //
    // There is no `ads` block and there never will be: a welder has no sights,
    // and player.js refuses to aim one.
    grip: { pos: [-0.03, 0.28, 0.02], rot: [-1.57, -0.2, -1.5] },
    fp: { pos: [0.12, -0.14, 0.18], rot: [0, -1.271, -0.15], scale: 1.2 },
    tool: {
      // How far the beam reaches. Deliberately short: the tool's cost is that
      // using it puts you next to the thing you are working on.
      range: 6,
      // Armour restored per second, before the Engineer's ×2 from
      // PERKS.combatEngineer.stats.repairRate — the perk stat was declared long
      // before anything read it, and this is what reads it. A full 50-point
      // plate is 4 s for anyone and 2 s for an Engineer, which is the plan's
      // "universal action, class-boosted" without inventing a second constant.
      //
      // It lands against the heat ceiling for free: 4.5 s of continuous beam
      // means an Engineer re-plates TWO soldiers per heat cycle and everyone
      // else barely manages one. That gap was not designed, it is just what the
      // two numbers do together — and it is the size of gap the plan asks for.
      armorRate: 12.5,
      // Bot repair. Without this the whole layer is player-only theatre: 63 of
      // the 64 combatants are bots, and armour that never comes back on a bot
      // means bot marines live at 100 EHP for most of a match while the player
      // lives at 150. That is not the design being tested, it is bots being
      // unable to weld.
      //
      // Shaped like BIOFOAM's ai block deliberately — same signals, same
      // thresholds, so the two errands stay comparable.
      ai: {
        seekRange: 30,   // metres a bot will walk to patch someone up
        reach: 4.5,      // close enough to work — inside `range`, with slack
        below: 0.6,      // only worth crossing ground for a plate this stripped
        calm: 2.5,       // seconds since the WORKER was last hit
        targetCalm: 1.5, // ...and since the PATIENT was, or you are welding bait
      },
      // Fuel is unlimited and HEAT is the limiter instead, which is the right
      // shape for something that does three jobs — a charge pool would have to
      // be split three ways and re-tuned every time a job was added.
      //
      // Stated as DURATIONS rather than rates because that is what they are
      // tuned against: seconds of continuous beam to overheat, seconds from
      // full heat back to cold.
      heatUp: 4.5,
      coolDown: 3.0,
      // Cooling does not start the instant you release. Without this, tapping
      // the trigger is strictly better than holding it, and the limiter stops
      // limiting anything.
      ventDelay: 0.5,
      // Overheating locks the beam until heat reaches ZERO, not until it dips
      // under some threshold. A partial recovery invites you to ride the top of
      // the gauge, which is exactly the behaviour heat exists to punish.
      // `radius` is the beam's FAR end — the near end is tapered down from it,
      // so the beam holds a steady width on screen instead of flaring into a
      // cone at the nozzle. See BEAM_TAPER in repairtool.js.
      beam: { color: 0x5ad1ff, radius: 0.03 },
    },
  },
};

// ---------------------------------------------------------------------------
// Weapon tiering. The armoury is two tiers, and this is the one place that
// decision lives:
//
//   STANDARD    any class may take one in the PRIMARY slot.
//   SPECIALIST  never a primary. Reachable only by spending a gadget slot on
//               the class that owns it (Recon -> sniper/dmr, Engineer ->
//               rocket/laser), or by being a Spartan, who reaches them without
//               paying. This is what stops "every class gets all primaries"
//               from erasing Recon: if the sniper were a standard primary,
//               Recon's gadget would be a downgrade and everyone would be a
//               sniper.
//   SIDEARM     the default second slot.
//
// Membership drives `def.slot` below, so a weapon's tier is stated once.
// ---------------------------------------------------------------------------
// The shotgun moved OUT of standard. It is a committing, close-range weapon and
// should be uncommon on the field, so it is gated behind a gadget slot like the
// rest of the specialists rather than being a free pick for every class.
export const STANDARD_POOL = ['ar', 'br', 'smg'];
export const SPECIALIST_POOL = ['shotgun', 'dmr', 'sniper', 'rocket', 'laser'];
// Two of them, so the second weapon slot is a real decision for every class
// rather than a single default nobody chooses. Volume against punch.
export const SIDEARM_POOL = ['magnum', 'm6g'];
// Everything, for the Spartan's perk — it reaches the whole armoury in slot 2
// without spending a gadget on it. Sidearm FIRST so a Spartan's default slot 2
// is the Magnum like everyone else's: the perk is that they may upgrade out of
// it for free, not that they start somewhere different.
export const ALL_WEAPONS = [...SIDEARM_POOL, ...STANDARD_POOL, ...SPECIALIST_POOL];

// Let a weapon def know its own key (used for held-weapon attachment) and its
// tier. `swapTime` falls back to the player default so only weapons that mean
// to be different carry the number.
for (const [k, def] of Object.entries(WEAPONS)) {
  def.key = k;
  // Tools are in this registry for the mount, not for the armoury, so they get
  // their own tier rather than falling through to 'primary'. Without this line
  // a welder would be labelled a primary weapon by anything that reads `slot`.
  def.slot = def.tool ? 'tool'
    : def.mounted ? 'mounted'
    : SIDEARM_POOL.includes(k) ? 'sidearm'
      : SPECIALIST_POOL.includes(k) ? 'specialist'
        : 'primary';
  if (def.swapTime === undefined) def.swapTime = CFG.player.swapTime;
}

// Default first-person viewmodel offset; per-weapon `fp` in the def overrides.
export const FP_DEFAULT = { pos: [0.15, 0.07, -0.31], rot: [0, 0, 0] };

// Aim-down-sights pose. `fp` positions the gun inside the viewmodel holder;
// this positions the HOLDER itself (same space as the hip base 0.28,-0.24,-0.55
// in player.js) — that is the transform that puts a weapon's optic on the
// crosshair, and it has to be per weapon because every sight sits somewhere
// different on its model. Tuned in /chartest.html ADS tab.
//
//   scale — counteracts the viewmodel blowing up at a narrow adsFov (the gun
//           shares the main camera, so 22° magnifies it ~3.4x)
//   sens  — multiplier on top of automatic zoom-proportional sensitivity
//   speed — how fast the gun comes up; lerp rate, so bigger is snappier
// Seeded from the tuned MA5 pose — a new weapon starts somewhere sane rather
// than at the old hardcoded slide-to-centre, which suited nothing.
export const ADS_DEFAULT = { pos: [0.15, -0.22, -0.555], rot: [0, 0, 0], scale: 1, sens: 1, speed: 12 };

// ---------------------------------------------------------------------------
// Loadout schema. Every soldier, player or AI, carries exactly:
//
//   2 weapons  — `primary` + `secondary`
//   2 gadgets  — both drawn from ONE class pool, no duplicates
//   1 grenade
//   1 melee
//   1 perk     — fixed by class, never chosen, not a slot
//
// Plus biofoam, which every soldier carries and nobody picks (see BIOFOAM).
//
// The weapon slots are the interesting part. Both hold a default — a standard
// primary and the Magnum — and a gadget with kind 'weaponSlot' UPGRADES one of
// them. That is one mechanic covering four cases:
//
//   Assault  shotgun_kit   upgrades PRIMARY   -> shotgun, keeps the Magnum
//   Assault  webbing       upgrades SECONDARY -> a second standard primary
//   Engineer launcher_kit  upgrades SECONDARY -> rocket or laser, keeps the rifle
//   Recon    marksman_kit  upgrades PRIMARY   -> sniper or DMR, keeps the Magnum
//
// A kit that upgrades the PRIMARY is a commitment — you give up your rifle and
// keep the pistol. One that upgrades the SECONDARY is additive — you keep the
// rifle and gain a tool. That split is deliberate: the shotgun and sniper are
// guns you commit to, the launcher is one you swap to.
//
// Only ONE weapon gadget may be carried (see validateLoadout). Without that
// rule an Assault could take shotgun + webbing and cover every range at once,
// which is exactly what upgrading the primary was meant to cost.
// ---------------------------------------------------------------------------
// There is deliberately no DEFAULT_LOADOUT constant. `makeLoadout(cls)` in
// loadout.js builds one by taking the first entry of every pool, so the default
// kit follows the pools automatically and there is no second copy to drift out
// of agreement with them. Order each class's lists with that in mind: whatever
// sits first IS the default, which is why every class leads with its signature
// gadget.

// Biofoam is universal — every soldier has it, nobody spends a slot on it, and
// it is the currency for picking a downed squadmate up as well as for patching
// yourself. Support carries five times the field ration, which is the class's
// logistical identity rather than a gadget choice.
//
// It used to be Assault's identity gadget. Making it universal is what turns
// health from a class privilege into an economy: `perClass` below is the only
// place that ration is set, and the ammo crate is what refills it.
export const BIOFOAM = {
  name: 'BIOFOAM',
  svg: '<rect x="9" y="7" width="6" height="10" rx="1"/><path d="M12 3v4M9.5 5h5M12 17v4"/>',
  // Follows CFG.soldier.health rather than restating it. It was a bare 55 with a
  // note to revisit when armour landed; armour landed, health doubled, and a
  // hardcoded 55 would have quietly become a half-heal without anything saying
  // so. Biofoam restores HEALTH only — the plate is the repair tool's job, and
  // that split is what gives the two classes different work.
  heal: CFG.soldier.health,
  healRate: 22,       // HP per second once the injection lands
  useTime: 1.2,       // locked out of firing for this long
  cooldown: 1.0,      // between charges
  count: 3,           // everyone
  perClass: { support: 15 },
  // AI use policy. Measured, not guessed: over 120 s of live 32v32, carriers
  // were hurt below 80% in 97 alive-samples and exactly ONE had gone 4.5 s
  // without being hit — 71 had gone 2-4.5 s. A hurt soldier here either dies or
  // gets a short lull, never five quiet seconds, so the calm window is its own
  // number rather than CFG.soldier.shieldRegenDelay.
  aiUseBelow: 0.7,
  aiCalmTime: 2.0,
  // Casualty recovery draws on the same ration. The charge is spent ON
  // COMPLETION, not on starting: an attempt broken off by gunfire costs only
  // the time, which makes time-under-fire the currency of a contested pickup
  // and the charge the currency of a successful one.
  reviveCost: 1,
  aiReviveRange: 24,   // how far a bot will walk to answer a down
  aiReviveCalm: 2.0,   // and how long it wants to be out of contact first
};

// ---------------------------------------------------------------------------
// Perks. One per class, fixed, never chosen, and not a slot. This is the home
// for what used to be ad-hoc class fields — the Spartan's `shield: 70` and
// `jumpHeight: 3` were perks in everything but the name, and without somewhere
// to put them every new class trait would have accreted as another loose key on
// CLASSES.
//
// Two kinds of effect, and the rule that keeps perks from becoming the balance
// problem: perks grant UTILITY, never LETHALITY. A free repair tool kills
// nobody. Free access to a rocket launcher would make "free" the strongest word
// in the game.
//
//   grants  — a free item or access that costs no slot
//   stats   — passive modifiers (shield, jumpHeight, stamina, build rate)
//
// Nothing reads `grants`/`stats` beyond shield and jumpHeight yet; the rest are
// declared so the systems that arrive later have a place to look.
// ---------------------------------------------------------------------------
export const PERKS = {
  marathon: {
    name: 'MARATHON',
    svg: '<path d="M13 3 6 13h5l-1 8 7-10h-5z"/>',
    desc: 'Larger stamina pool, and it recovers faster and while still moving.',
    // Three keys, not two, and the third is the important one. Pool and rate
    // alone make MARATHON a strictly weaker MJOLNIR — a bigger tank against a
    // tank that never empties. `staminaMoveRegen: 1` overrides
    // CFG.stamina.moveRegenMult outright, so the Assault is the only class that
    // recovers at full rate on the move: MJOLNIR is capacity, this is recovery,
    // and they stop being the same perk at different strengths.
    stats: { staminaMax: 1.5, staminaRegen: 1.5, staminaMoveRegen: 1 },
  },
  combatEngineer: {
    name: 'COMBAT ENGINEER',
    svg: '<path d="M15 4a5 5 0 0 0-6 6.5L4.5 15 9 19.5l4.5-4.5A5 5 0 0 0 20 9l-3 3-4-4z"/>',
    desc: 'Carries a repair tool free, places blueprints, builds and repairs faster.',
    grants: ['repairtool'],       // removed from their gadget pool — that IS the perk
    stats: { buildRate: 2, repairRate: 2 },
  },
  combatLifesaver: {
    name: 'COMBAT LIFESAVER',
    svg: '<path d="M2.5 12h4l2-5 3 10 2.2-5H21.5"/>',
    desc: 'Picks a downed soldier up in a third of the normal time.',
    stats: { reviveRate: 3 },
  },
  mjolnir: {
    name: 'MJOLNIR',
    svg: '<path d="M12 3.5l7.5 2.8V12c0 4.6-3.2 7.4-7.5 8.5C7.7 19.4 4.5 16.6 4.5 12V6.3z"/><path d="M12 8.5v7"/>',
    desc: 'Powered armour: heavier shields, a three-metre jump, and no stamina limit.',
    // Free reach into the whole armoury in slot 2. This is the one perk that
    // brushes the utility-not-lethality rule, and it is why the Spartan pays
    // for it everywhere else on the sheet rather than getting a gadget too.
    freeSecondary: true,
    stats: { shield: 70, jumpHeight: 3, staminaMax: Infinity },
  },
  // Recon has no perk yet — the one open cell in the roster. Candidates: enemies
  // it fires on stay marked far longer (hud.js `spottedShooters` already tracks
  // exactly this on a 3 s TTL), or a squad spawn beacon.
  recon: {
    name: 'RECON',
    svg: '<path d="M2.5 12s3.6-5.5 9.5-5.5S21.5 12 21.5 12 17.9 17.5 12 17.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.4"/>',
    desc: 'Perk not yet decided.',
    stats: {},
  },
};

// Jump height, in METRES, is the only jump number to touch — takeoff speed,
// hang time and the jump clip's playback rate all derive from it. Note height
// goes with the SQUARE of takeoff speed, so doubling it is only 1.41x the
// velocity and airtime. It lives on the PERK now (MJOLNIR clears 3 m), as does
// shield.
// `model` picks the character mesh for the class (blue team) — Spartans are the
// only class in MJOLNIR. `perk` keys into PERKS, and that is where shield and
// jumpHeight now live.
//
// `gadgets` is ONE pool and you take two from it. The earlier design had two
// separate pools, an identity slot and a utility slot; a single pool is simpler
// to read and it allows builds the split forbade — an Engineer who takes wall
// plus EMP and no launcher at all is a legitimate pure-fortification build.
//
// Everything in `gadgets` below is DECLARED, not implemented. Only `webbing`
// has behaviour behind it. The rest exist so the armoury shows the real shape
// of every class before any of it is built.
export const CLASSES = {
  assault: {
    name: 'Assault', model: 'marine2', perk: 'marathon',
    primaries: STANDARD_POOL,
    sidearms: SIDEARM_POOL,
    // The only class with TWO weapon gadgets, and the only one the
    // one-weapon-gadget rule can bite: shotgun upgrades the primary, webbing
    // upgrades the secondary, and taking both would cover every range.
    gadgets: ['shotgun_kit', 'webbing', 'breach', 'smoke'],
    grenades: ['frag'],
    melees: ['bash'],
  },
  engineer: {
    name: 'Engineer', model: 'marine3', perk: 'combatEngineer',
    primaries: STANDARD_POOL,
    sidearms: SIDEARM_POOL,
    gadgets: ['launcher_kit', 'quickwall', 'emp'],
    grenades: ['frag'],
    melees: ['bash'],
  },
  recon: {
    name: 'Recon', model: 'marine', perk: 'recon',
    primaries: STANDARD_POOL,
    sidearms: SIDEARM_POOL,
    gadgets: ['marksman_kit', 'sensor', 'drone'],
    grenades: ['frag', 'smokenade'],
    melees: ['bash'],
  },
  support: {
    name: 'Support', model: 'marine', perk: 'combatLifesaver',
    primaries: STANDARD_POOL,
    sidearms: SIDEARM_POOL,
    // Both crates are in one pool, so bringing both costs the whole gadget
    // budget and leaves no utility. That is the class's loadout decision.
    gadgets: ['medcrate', 'ammocrate', 'supplypouch', 'ballisticshield'],
    grenades: ['frag'],
    melees: ['bash'],
  },
  spartan: {
    name: 'Spartan', model: 'spartan', perk: 'mjolnir',
    primaries: STANDARD_POOL,
    // Overridden by the MJOLNIR perk's freeSecondary — the whole armoury.
    sidearms: SIDEARM_POOL,
    gadgets: ['overshield', 'camo', 'grapple', 'jetpack'],
    grenades: ['frag'],
    melees: ['bash'],
  },
};

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Preset loadouts. Named kits per class, so picking a class does not drop you
// into whatever `makeLoadout` assembled from the first entry of every pool —
// that is mechanically sensible and says nothing about what a build is FOR.
//
// These are designer-authored and read-only. Applying one copies it onto the
// session loadout and runs it through validateLoadout, so a preset that names
// something illegal — a gadget that was renamed, a pool that changed, a pair
// that breaks the one-weapon-gadget rule — self-repairs instead of breaking.
// That is what makes them safe to hand-author here and safe to persist later.
//
// A preset SEEDS the slots rather than locking them: change anything afterwards
// and you simply stop matching that preset (the deploy screen shows MODIFIED).
// ---------------------------------------------------------------------------
export const LOADOUTS = {
  assault: [
    { id: 'rifleman', name: 'RIFLEMAN', desc: 'The baseline. Rifle, sidearm, and something for a wall and for open ground.',
      primary: 'ar', secondary: 'magnum', gadgets: ['breach', 'smoke'], grenade: 'frag', melee: 'bash' },
    { id: 'breacher', name: 'BREACHER', desc: 'Shotgun and a charge. Nothing past twenty metres, everything inside it.',
      primary: 'shotgun', secondary: 'magnum', gadgets: ['shotgun_kit', 'breach'], grenade: 'frag', melee: 'bash' },
    { id: 'gunslinger', name: 'GUNSLINGER', desc: 'Two rifles and no pistol. Covers every range and carries less ammo for it.',
      primary: 'ar', secondary: 'br', gadgets: ['webbing', 'smoke'], grenade: 'frag', melee: 'bash' },
  ],
  engineer: [
    { id: 'tankhunter', name: 'TANK HUNTER', desc: 'Rifle and a tube. Armour is the job; the EMP is for whatever survives.',
      primary: 'ar', secondary: 'rocket', gadgets: ['launcher_kit', 'emp'], grenade: 'frag', melee: 'bash' },
    { id: 'sapper', name: 'SAPPER', desc: 'No launcher at all. Pure fortification — cover where there was none.',
      primary: 'br', secondary: 'magnum', gadgets: ['quickwall', 'emp'], grenade: 'frag', melee: 'bash' },
    { id: 'fortifier', name: 'FORTIFIER', desc: 'Laser and a wall. Hold the ground you just took and punish what comes for it.',
      primary: 'ar', secondary: 'laser', gadgets: ['launcher_kit', 'quickwall'], grenade: 'frag', melee: 'bash' },
  ],
  recon: [
    { id: 'marksman', name: 'MARKSMAN', desc: 'Sniper and a sensor. Reach, and something watching your flank while you use it.',
      primary: 'sniper', secondary: 'magnum', gadgets: ['marksman_kit', 'sensor'], grenade: 'frag', melee: 'bash' },
    { id: 'scout', name: 'SCOUT', desc: 'No long gun. Close-quarters weapons and both eyes on the map.',
      primary: 'smg', secondary: 'm6g', gadgets: ['sensor', 'drone'], grenade: 'frag', melee: 'bash' },
    { id: 'designator', name: 'DESIGNATOR', desc: 'DMR and a drone. Sees the target, marks it, and can take it itself.',
      primary: 'dmr', secondary: 'magnum', gadgets: ['marksman_kit', 'drone'], grenade: 'frag', melee: 'bash' },
  ],
  support: [
    { id: 'quartermaster', name: 'QUARTERMASTER', desc: 'Both crates, no utility. The squad runs on you and you carry nothing else.',
      primary: 'ar', secondary: 'magnum', gadgets: ['ammocrate', 'medcrate'], grenade: 'frag', melee: 'bash' },
    { id: 'medic', name: 'MEDIC', desc: 'Health forward. A station to hold and a pouch for whoever cannot reach it.',
      primary: 'smg', secondary: 'magnum', gadgets: ['medcrate', 'supplypouch'], grenade: 'frag', melee: 'bash' },
    { id: 'anchor', name: 'ANCHOR', desc: 'Ammunition and a plate. Stands in the doorway and keeps the squad shooting.',
      primary: 'br', secondary: 'm6g', gadgets: ['ammocrate', 'ballisticshield'], grenade: 'frag', melee: 'bash' },
  ],
  spartan: [
    { id: 'juggernaut', name: 'JUGGERNAUT', desc: 'Shotgun in the second slot and a shield to reach it behind.',
      primary: 'ar', secondary: 'shotgun', gadgets: ['overshield', 'grapple'], grenade: 'frag', melee: 'bash' },
    { id: 'ghost', name: 'GHOST', desc: 'Camouflage, a sniper, and the height to use it from.',
      primary: 'smg', secondary: 'sniper', gadgets: ['camo', 'jetpack'], grenade: 'frag', melee: 'bash' },
    { id: 'skirmisher', name: 'SKIRMISHER', desc: 'Grapple and jetpack. Arrives from a direction nobody is watching.',
      primary: 'br', secondary: 'm6g', gadgets: ['grapple', 'jetpack'], grenade: 'frag', melee: 'bash' },
  ],
};

// ---------------------------------------------------------------------------
// Gadget registry. `kind` is what the code branches on — never the gadget's
// identity — so a new gadget of an existing kind is a config entry and nothing
// more:
//
//   weaponSlot  — upgrades one weapon slot with a pick from a pool
//   consumable  — a charge spent on yourself
//   placeable   — a prop put into the world
//   tool        — a held device with a sustained effect
//   passive     — always on
//   movement    — changes how the carrier moves
//   deployable  — a controllable second entity
//
// Most of this list is declared and not yet wired — `built: true` marks the
// ones that are. The rest exist so the armoury shows the true shape of all
// five classes before any of it is built, and the flag is what lets the UI say
// so rather than implying a gadget works.
//
// weaponSlot gadgets carry:
//   upgrades  'primary' | 'secondary' — which slot they replace
//   pool      name of a CLASSES[cls] list, OR
//   weapons   an explicit list of weapon keys
// ---------------------------------------------------------------------------
export const GADGETS = {
  // --- Weapon kits ---------------------------------------------------------
  // Trades the sidearm for a second weapon out of the class's own primary pool.
  // Costs no new machinery — player.weapons is already a 2-array of arbitrary
  // weapon keys — so the expensive part is the balancing, not the building.
  // `reserveMult` is that balance: two long guns means less spare ammo for each,
  // which is legible, and it makes the build want Support's ammo crate rather
  // than being self-sufficient.
  webbing: {
    name: 'COMBAT WEBBING', kind: 'weaponSlot', built: true,
    svg: '<path d="M7.5 4l4.5 4 4.5-4"/><path d="M7.5 4 6 6v14h12V6l-1.5-2"/><path d="M12 8v12"/>',
    upgrades: 'secondary', pool: 'primaries',
    reserveMult: 0.6,
  },
  // Upgrades the PRIMARY, so you keep the Magnum and give up your rifle. The
  // shotgun is gated behind a slot precisely so it stays uncommon.
  shotgun_kit: {
    name: 'BREACHING SHOTGUN', kind: 'weaponSlot', built: false,
    svg: '<path d="M3 11h13l4 2v2h-6l-2-2H3z"/><path d="M6 15v3M16 9V6"/>',
    upgrades: 'primary', weapons: ['shotgun'],
  },
  // Additive rather than committing: the launcher rides in slot 2 and the
  // Engineer keeps a standard rifle, because a rocket is a tool you swap to.
  // No `reserveMult`: the webbing's penalty exists because two rifles cover
  // every range, and a two-round tube covers exactly one situation. Its own
  // 2/8 and the laser's 5/5 are the scarcity.
  launcher_kit: {
    name: 'HEAVY WEAPON', kind: 'weaponSlot', built: true,
    svg: '<path d="M3 13h11l6-3v5l-6 2H3z"/><path d="M7 17v3"/>',
    upgrades: 'secondary', weapons: ['rocket', 'laser'],
  },
  // Committing, like the shotgun — a marksman gives up the mid-range rifle.
  marksman_kit: {
    name: 'MARKSMAN RIFLE', kind: 'weaponSlot', built: false,
    svg: '<path d="M3 12h16"/><path d="M6 12v3M14 9.5V12"/><circle cx="14" cy="8" r="2"/>',
    upgrades: 'primary', weapons: ['sniper', 'dmr'],
  },

  // --- Assault -------------------------------------------------------------
  breach: {
    name: 'BREACHING CHARGE', kind: 'placeable', built: false,
    svg: '<rect x="7" y="8" width="10" height="8" rx="1"/><path d="M12 4v4M9 20l3-4 3 4"/>',
    charges: 2,
  },
  smoke: {
    name: 'SMOKE LAUNCHER', kind: 'placeable', built: false,
    svg: '<path d="M5 17a4 4 0 0 1 1-7 5 5 0 0 1 9-2 4 4 0 0 1 4 9z"/><path d="M8 20h9"/>',
    charges: 2,
  },

  // --- Engineer ------------------------------------------------------------
  // Instant cover, distinct from the blueprint system: a quick wall goes up in
  // half a second and needs no repair tool. Blueprints are the larger, built
  // fortifications. Two verbs on purpose.
  // `wall` is what makes a placeable a STRUCTURE, the way `crate` makes one a
  // supply point: `size` is [length, height, thickness] in metres, laid out
  // broadside to the placer so it goes up across your view rather than pointing
  // away down it.
  //
  // The height is a CONTRACT with CFG.soldier.crouchScale, not a free number.
  // 1.25 sits 10 cm above the player's crouched camera (crouchEye 1.15) so you
  // cannot peek over your own wall, and under the 1.3 m chest that LOS is
  // sampled against in soldier._canSee so standing up puts you back on the
  // menu. Measured against a bot at 10-80 m, 1.0-1.3 all hold that line and
  // 1.4 breaks it — at 1.4 a standing soldier is never seen at all and shoots
  // over the wall with impunity. Retune the two together or not at all.
  quickwall: {
    name: 'QUICK WALL', kind: 'placeable', built: true,
    svg: '<rect x="4" y="8" width="16" height="10"/><path d="M4 13h16M12 8v10"/>',
    charges: 2,
    // Named `useTime` rather than the old `deployTime` because that is what the
    // shared gadget lockout in player.useGadget reads — the previous name was
    // never wired to anything.
    useTime: 0.5,
    wall: { size: [3.2, 1.25, 0.35], color: 0x6f7c86 },
  },
  emp: {
    name: 'EMP CHARGE', kind: 'placeable', built: false,
    svg: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2"/>',
    charges: 2,
  },

  // --- Recon ---------------------------------------------------------------
  sensor: {
    name: 'MOTION SENSOR', kind: 'placeable', built: false,
    svg: '<circle cx="12" cy="13" r="2"/><path d="M7.5 13a4.5 4.5 0 0 1 9 0M4.5 13a7.5 7.5 0 0 1 15 0"/>',
    charges: 2,
  },
  drone: {
    name: 'SPOTTING DRONE', kind: 'deployable', built: false,
    svg: '<circle cx="12" cy="12" r="2.5"/><path d="M6 6l3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5"/><circle cx="5" cy="5" r="1.6"/><circle cx="19" cy="5" r="1.6"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="19" r="1.6"/>',
    charges: 1,
  },

  // --- Support -------------------------------------------------------------
  // `crate` is what makes a placeable real: `pool` is how much the crate holds
  // in the units it hands out, `per` is one draw. Pool divided by per is the
  // number of soldiers it serves before it is scrap — the figure to tune, since
  // it is what a Support is actually worth to a squad.
  medcrate: {
    name: 'MEDICAL CRATE', kind: 'placeable', built: true,
    svg: '<rect x="4" y="7" width="16" height="12" rx="1"/><path d="M12 10v6M9 13h6"/>',
    charges: 1,
    useTime: 0.8,
    crate: {
      give: 'biofoam',
      pool: 8,           // biofoam charges held
      per: 2,            // handed over per draw — four soldiers topped up
      color: 0x37d67a,
      label: 'BIOFOAM',
    },
  },
  // The resupply hub: standing near one regenerates gadget charges, grenades,
  // biofoam and reserve ammo for the whole team. That rule is what makes every
  // "2 charges per life" number in this file a pacing figure rather than a cap.
  ammocrate: {
    name: 'AMMUNITION CRATE', kind: 'placeable', built: true,
    svg: '<rect x="4" y="7" width="16" height="12" rx="1"/><path d="M8 11h2v4H8zM14 11h2v4h-2z"/>',
    charges: 1,
    useTime: 0.8,
    crate: {
      // PLAYER-ONLY, and not by choice: AI soldiers model no magazine and no
      // reserve, so there is nothing for this crate to refill on 63 of the 64
      // combatants. Giving bots an ammo economy is a real balance job — they
      // would start running dry mid-fight, which re-tunes attrition — rather
      // than a wiring job, so it is deliberately not bolted on here.
      give: 'ammo',
      pool: 6,           // resupplies held
      per: 1,            // one draw is one resupply — the crate serves six
      // What one resupply restores. Reserve only: the magazine in the gun is
      // still yours to reload, so a crate never wins a firefight for you, it
      // pays for the next one.
      reserveFrac: 1,    // both weapons' spare ammo back to full
      grenades: 1,       // and one frag
      color: 0xffc44d,
      label: 'AMMO',
    },
  },
  supplypouch: {
    name: 'SUPPLY POUCH', kind: 'placeable', built: false,
    svg: '<path d="M7 9h10l1.5 10H5.5z"/><path d="M9.5 9V6.5a2.5 2.5 0 0 1 5 0V9"/>',
    charges: 3,
  },
  ballisticshield: {
    name: 'BALLISTIC SHIELD', kind: 'tool', built: false,
    svg: '<path d="M12 3.5l7 2.6V12c0 4.3-3 7-7 8-4-1-7-3.7-7-8V6.1z"/><path d="M12 8v7"/>',
  },

  // --- Spartan -------------------------------------------------------------
  overshield: {
    name: 'OVERSHIELD', kind: 'consumable', built: false,
    svg: '<path d="M12 3.5l7.5 2.8V12c0 4.6-3.2 7.4-7.5 8.5C7.7 19.4 4.5 16.6 4.5 12V6.3z"/>',
    charges: 1,
  },
  camo: {
    name: 'ACTIVE CAMOUFLAGE', kind: 'consumable', built: false,
    svg: '<path d="M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2"/>',
    charges: 1,
  },
  grapple: {
    name: 'GRAPPLE', kind: 'movement', built: false,
    svg: '<path d="M5 20l7-7"/><path d="M12 13l3-3 4 4-3 3z"/><path d="M15 6l4 4"/>',
    charges: 2,
  },
  jetpack: {
    name: 'JETPACK', kind: 'movement', built: false,
    svg: '<rect x="7" y="5" width="4" height="9" rx="2"/><rect x="13" y="5" width="4" height="9" rx="2"/><path d="M9 17v3M15 17v3"/>',
  },

  // --- Global --------------------------------------------------------------
  // Available to every class rather than class-locked, so any squad member can
  // contribute to fortifications. The Engineer carries it free via their perk,
  // which is why it is REMOVED from their pool rather than offered twice —
  // stated plainly, that removal is the perk.
  // `held` is the seam between the two registries: a tool gadget names the
  // WEAPONS entry it draws, and player.js mounts that. It is what makes the
  // repair tool a piece of EQUIPMENT rather than a button — pressing its slot
  // key draws and stows it instead of spending a charge, and while it is out it
  // is simply what your hands are holding.
  repairtool: {
    name: 'REPAIR TOOL', kind: 'tool', built: true, global: true, held: 'repairtool',
    svg: '<path d="M15 4a5 5 0 0 0-6 6.5L4.5 15 9 19.5l4.5-4.5A5 5 0 0 0 20 9l-3 3-4-4z"/>',
  },
};

// ---------------------------------------------------------------------------
// The squad leader's rally beacon. Shaped like a gadget def — `name`, `useTime`
// and a kind marker — but deliberately NOT in GADGETS: it costs no slot, no
// class carries it, and it is not chosen in the armoury. Leadership is what
// grants it, so it is a def on its own and `player._placeSystem` recognises it
// by its `beacon` block the same way it recognises a wall by `wall`.
//
// Tuning knobs live on CFG.beacon; this is only what the beacon IS.
// ---------------------------------------------------------------------------
export const BEACON = {
  name: 'RALLY BEACON', kind: 'placeable', built: true,
  svg: '<path d="M12 3v11"/><path d="M8.5 6.5L12 3l3.5 3.5"/><ellipse cx="12" cy="18" rx="6" ry="2.5"/>',
  useTime: 1.1,
  beacon: { color: 0x2fd3a7 },
};

// Gadgets every class sees in its pool, on top of its own list. Globals are
// utility by definition, and a class whose perk already grants one does not see
// it offered again.
export const GLOBAL_GADGETS = Object.entries(GADGETS)
  .filter(([, g]) => g.global).map(([k]) => k);

// ---------------------------------------------------------------------------
// Grenades. Universal slot — every class carries one type, chosen from its
// `grenades` list. A thrown frag is the rocket's projectile with gravity and a
// fuse on it, so combat.js's existing explode path does the damage work.
//
// `dmg`/`splash` are deliberately near the rocket's (120 / 5.5): a frag that
// does not threaten a grouped squad is not worth a slot.
// ---------------------------------------------------------------------------
export const GRENADES = {
  frag: {
    // `len` normalizes the model the way WEAPONS[].len does — the GLB is
    // authored 0.26 m on its longest axis, which is football-sized for
    // something you throw. A real M9 is about a handspan.
    name: 'M9 FRAG', model: '/UNSC/weapons/Gernade/Frag.glb', len: 0.12,
    // Same line art as the GADGETS.frag stub — every slot registry carries an
    // `svg` so the armoury card renderer never has to know which registry an
    // item came from.
    svg: '<circle cx="12" cy="14" r="6"/><rect x="10" y="4" width="4" height="3.4"/><circle cx="16.4" cy="5" r="1.8"/>',
    dmg: 110, splash: 5.5,
    fuse: 3.2,          // seconds from throw to detonation, cooked or not
    throwSpeed: 18,     // m/s at release
    bounce: 0.35,       // restitution off floors and walls
    count: 2,           // carried per spawn
    cooldown: 1.0,      // between throws
    useTime: 0.6,       // wind-up before release; needs a throw animation
    // AI throw policy. The range band is bounded by the physics, not taste:
    // GRENADE_GRAV in combat.js puts a flat throw at ~17 m and a 45-degree lob
    // at 27 m, so asking for a throw past that just drops it short. `cooldown`
    // is per soldier and deliberately long — 15 AI on a side each holding two
    // frags is a lot of explosive, and the sim reads as artillery without it.
    ai: { minRange: 9, maxRange: 22, cluster: 2, cooldown: 16 },
  },
  // DECLARED, NOT BUILT. Recon's alternative. Cheap to throw and expensive to
  // make matter: the cloud itself is a particle effect, but smoke that does not
  // block AI vision is decoration, and `_canSee` in soldier.js runs per AI per
  // fire decision — putting volume tests in that path is a real perf and
  // correctness change, not a visual one. Frag stays first in Recon's pool so
  // the class is complete without it.
  smokenade: {
    name: 'M19 SMOKE', built: false,
    svg: '<path d="M5 17a4 4 0 0 1 1-7 5 5 0 0 1 9-2 4 4 0 0 1 4 9z"/><path d="M8 20h9"/>',
    dmg: 0, splash: 0,
    fuse: 1.6, throwSpeed: 18, bounce: 0.35,
    count: 2, cooldown: 1.0, useTime: 0.6,
    cloudRadius: 7, cloudLife: 14,
  },
};

// ---------------------------------------------------------------------------
// Melee. Also a universal slot. `bash` is the butt-stroke everyone has — no
// model, no held state, just an animation and a short forward sweep, which is
// why it is the cheapest of the four universal slots to ship.
//
// 60 damage against 100 EHP is the Halo two-hit: the first strike takes the
// 45 shield and bites 15 into health, the second finishes. Against someone
// already stripped it is one hit.
// ---------------------------------------------------------------------------
export const MELEE = {
  bash: {
    name: 'RIFLE BASH',
    // A stock coming down, with the impact ticks. The only slot that had no art
    // of its own — weapons have baked thumbnails, everything else has a glyph.
    svg: '<path d="M12 4.5l4.2 4.2-4.2 4.2-4.2-4.2z"/><path d="M8.2 13.2 3.5 20.5"/><path d="M17.8 4.2 19.8 2.2M18.8 8.6l2.4-.9M14.6 2.6l.7-1.4"/>',
    dmg: 60,
    range: 2.2,         // metres from the eye
    arc: 0.7,           // radians of forgiveness either side of the crosshair, HORIZONTAL
    // Vertical tolerance as a FOOT-TO-FOOT height difference, so level ground
    // is 0 and this reads the same up or down. Its own number rather than
    // reusing `range`, because the two do different jobs: `range` is how far
    // you can reach, this is how much height difference a bash still crosses.
    // Generous enough for a slope or a low ledge, tight enough that someone on
    // a roof 2.5 m up does not eat a rifle butt through the ceiling.
    vertical: 1.5,
    useTime: 0.45,      // locked out of firing
    cooldown: 0.9,
    // Third-person body clip, and the window it is compressed into. The clip
    // (`melee` in ASSET_PATHS.animations) is 2.83 s as authored — playing it
    // over `useTime` alone would be a 6.3x twitch. 1.2 s is a ~2.4x speed-up
    // that still reads as a swing, and it deliberately outlasts the 0.45 s
    // lockout: the tail is the recovery, blended out when the flag drops rather
    // than played to its end. Nothing about the hit timing depends on this —
    // the strike still lands at half of `useTime`.
    anim: 'melee',
    animSpan: 1.2,
  },
};

export const GAME_TYPES = {
  conquest: {
    id: 'conquest', name: 'SECTOR CONTROL',
    desc: 'Capture and hold sectors to bleed enemy tickets. 32 v 32 combined arms.',
  },
};

export const MAPS = {
  demo: {
    id: 'demo', name: 'Demo Map', type: 'procedural',
    desc: 'Procedurally generated training valley. Five sectors, open sightlines, scattered cover.',
    tag: 'GENERATED',
  },
  map3: {
    id: 'map3', name: 'Map 3', type: 'glb', url: '/Maps/map-3.glb',
    desc: 'Imported battlefield terrain — first mesh-based map test.',
    tag: 'IMPORTED',
  },
};

export const ASSET_PATHS = {
  // Every character the loader should pull, keyed the way CLASSES[].model and
  // soldier.js BACK key them. Adding a body is ONE entry here plus the `model:`
  // field on the class that wears it — assets.js walks this map, so there is no
  // second list to keep in sync. `height` is the normalized standing height in
  // METRES (see normalizeCharacter: the GLB is scaled to hit it), measured from
  // the union of per-SkinnedMesh bounding boxes — never from the raw GLB bbox.
  characters: {
    spartan: { url: '/UNSC/Characters/Spartan/Spartan_Mark-IV.glb', height: 2.06 },
    elite: { url: '/Covenant/Characters/Elite/Elite_1.glb', height: 2.35 },
    marine: { url: '/UNSC/Characters/Marine/Marine_1.glb', height: 1.86 },
    marine2: { url: '/UNSC/Characters/Marine/Marine_2.glb', height: 1.86 },
    marine3: { url: '/UNSC/Characters/Marine/Marine_3.glb', height: 1.86 },
  },
  // World props that are neither a character nor a held weapon: things the sim
  // spawns copies of. Loaded and length-normalized exactly like weapons, and
  // walked straight off this map, so adding one is a single entry.
  props: {
    frag: { url: '/UNSC/weapons/Gernade/Frag.glb', len: 0.12 },
  },
  // Drivable vehicles. Deliberately NOT length-normalized the way characters,
  // weapons and props are: the Warthog is authored in metres (5.60 m long,
  // 0.63 m wheel radius, 3.95 m wheelbase) and normalizing it would erase the
  // exact quantity the intake pass exists to check. `forward` states the
  // authored facing so the loader can turn the model onto the +Z-forward
  // convention the soldiers already use — both the Warthog and the Pelican are
  // authored -X forward, +Y up (see the Pelican's asset.json).
  //
  // The runtime hierarchy is a contract: every moving part is a named empty
  // (`ref_contact_*`, `ref_steer_*`, `ref_seat_*`, `ref_camera_*`,
  // `ref_turret_base_rotate_yaw`, `ref_door*`…) and there are no animation
  // clips — code drives all of it. `collision_warthog` is the authored hull.
  vehicles: {
    warthog: { url: '/UNSC/Land Vehicles/warthog-v3.glb', forward: '-x' },
  },
  animations: {
    // Two rifle idles, assigned per soldier at spawn so a crowd standing around
    // is not 64 copies of one loop. Both are long (8.6 s / 10.7 s), which is
    // what keeps them from reading as a cycle. These replace the old generic
    // idle.glb, which was an unarmed pose on soldiers who all carry rifles.
    idle: '/animations/idle_rifle_1/idle_rifle_1.glb',
    idleLook: '/animations/idle_rifle_2_lookaround/idle_rifle_2_lookaround.glb',
    // Standing locomotion, 4-way per speed tier. The walk set is cycle-matched
    // at ~1.03 s so the step cadence does not change when you strafe
    // (walking-backwards.glb is the same motion at 1.46 s — it breaks that).
    run: '/animations/run-forward.glb',
    // Sprint (Shift): rifle carried low, the classic head-down run. Its own tier
    // above `run`, so it only shows while the sprint boost is actually applying.
    sprint: '/animations/rifle-down-run.glb',
    // Reloads, played full-body per gait rather than masked over one: legs and
    // arms were authored together, which avoids a reload's torso fighting a
    // separately-authored stride. One per speed tier, each stretched to the
    // carried weapon's reload time (2.1-3.4 s across the armoury). The moving
    // two are shown forward-only, since their legs travel forward.
    idleReload: '/animations/idle_reload/idle_reload.glb',   // 2.97 s
    walkReload: '/animations/walk_reload/walk_reload.glb',   // 4.13 s
    runReload: '/animations/run_reload/run_reload.glb',      // 3.70 s
    runBack: '/animations/run-backwards.glb',
    runLeft: '/animations/run-left.glb',
    runRight: '/animations/run-right.glb',
    walk: '/animations/walk-forward-in-place.glb',
    walkBack: '/animations/walk-backward.glb',
    walkLeft: '/animations/walk-left.glb',
    walkRight: '/animations/walk-right.glb',
    // 0.63 s, stretched at playback to whatever the jumper's airtime works out
    // to, and clamped so the landing frame holds if the fall outlasts the clip.
    jump: '/animations/rifle-jump.glb',
    // Standing rifle-aim: the pose for holding still with a target. Exported
    // from a reduced Mixamo skeleton (42 bones — middle/ring/pinky fingers are
    // absent), so those bones keep whatever the outgoing clip left them at.
    aim: '/animations/Idle_rifle_aim/Idle_rifle_aim.glb',
    // The crouch idle is its own pose now that `aim` stands up.
    crouchIdle: '/animations/idle-crouching-aiming.glb',
    // Crouch locomotion, 4-way. These are re-exports with the mesh stripped
    // (~75 KB vs ~1.9 MB); several carry leftover actions, hence the explicit
    // clip names — see the loader note in assets.js.
    crouchFwd: { url: '/animations/crouch_walk_forward_aim/crouch_walk_forward_aim.glb', clip: 'walk-crouching-forward' },
    crouchBack: { url: '/animations/crouch_walk_backwards_aim/crouch_walk_backwards_aim.glb', clip: 'walk-crouching-backward' },
    crouchLeft: { url: '/animations/crouch_walk_left_aim/crouch_walk_left_aim.glb', clip: 'walk-crouching-left' },
    crouchRight: { url: '/animations/crouch_walk_right_aim/crouch_walk_right_aim.glb', clip: 'walk-crouching-right' },
    death1: '/animations/dying_normal-with-rifle.glb',
    death2: '/animations/death_1.glb',
    // Casualty recovery. Loops for as long as the pickup takes, so its length
    // does not have to match `CFG.downed.reviveTime` — the progress bar is the
    // timing readout, this is the body language. Placeholder: a generic CPR
    // clip standing in until a purpose-authored one exists.
    cpr: '/animations/CPR/CPR.glb',
    // Rifle bash. Mixamo's "Rifle Block" — the rifle comes up and forward off
    // the shoulder, which is the butt-stroke read we want. 2.83 s as authored,
    // played compressed into `MELEE.bash.animSpan`; see the melee block above.
    melee: '/animations/ridle-block.glb',
  },
  audio: {
    shot: '/UNSC/weapons/battle-rifle/audio/battle-rifle-shot-1.mp3',
    dmrShot: '/UNSC/weapons/DMR/DMR_shot.wav',
    sniperShot: '/UNSC/weapons/sniper/Sniper_shot.wav',
    rocketShot: '/UNSC/weapons/rocket-launcher/Rocket-Launcher_shot.wav',
    // The Magnum model ships without audio of its own; these come from the
    // neighbouring `pistol/` folder, which is the same weapon's sound set.
    pistolShot: '/UNSC/weapons/pistol/Pistol_shot1.mp3',
    // The folder ships two shot samples; the heavier M6G takes the second so
    // the two sidearms do not sound identical.
    pistolShot2: '/UNSC/weapons/pistol/Pistol_shot2.mp3',
    pistolReload: '/UNSC/weapons/pistol/Pistol_reload.mp3',
    reload: '/UNSC/weapons/assault rifle/audio/assault-rifle-reload-1.mp3',
    empty: '/UNSC/weapons/pistol/empty_sound.mp3',
  },
};
