# Game Type and Match Rules Plan

Companion to `GAME_DESIGN_PLAN.md` (the whole-game document) and
`CLASS_AND_GADGET_PLAN.md` (what a soldier is and carries). This one covers only
**what the match is** — objectives, spawning, economy and victory — so it can be
read on its own.

It exists to settle a question that has been sitting under the project: does this
play like Battlefield or like Squad?

## Decision labels

Same vocabulary as the sibling docs.

- **Locked:** Owner-decided. Treat as a project requirement until deliberately revised.
- **Working:** Proposed and not yet owner-approved, or approved but unvalidated by play.
- **Open:** A decision is still required.
- **Long-term:** Intended future, not required for the first playable.

---

## The question, and why it was already answered

**Locked:** The chassis is Battlefield. The structure is borrowed from Squad. The
economy of the territorial mode is borrowed from Foxhole.

Mechanically the prototype has been Battlefield for some time, and not by
accident — every one of these was a deliberate call:

| Built | Points at |
| --- | --- |
| Regenerating shields, 45/55 pools, high TTK | Battlefield |
| 6 s individual respawn, no wave | Battlefield |
| Deploy map, click any held sector to spawn | Battlefield |
| Five sectors all simultaneously cappable | Battlefield |
| Majority-count continuous ticket bleed | Battlefield |
| 63 bots | Not Squad, at any price |

The last row is the one that closes the argument. Squad's identity is not its
rules — it is a hundred humans on voice who walk eight hundred metres because
dying wastes *other people's* time. Bots cannot supply that. Chasing Squad
wholesale buys the friction (long walks, punishing lethality, dead time) and
none of the payoff, because there is nobody on the other end of the radio.

But the last five commits shipped quick-wall cover placement, engineer
crouch-behind-cover, rally beacons the AI genuinely respawn on, and a 60-second
bleedout with team-wide recovery. That is **Squad's structure on a Battlefield
chassis**, and it is the right synthesis. This plan makes it explicit.

**Locked — the rule that decides borderline cases:**

> Borrow Squad's **structure**. Never borrow Squad's **friction**.
>
> Take: linear frontline, rally-driven forward spawning, a downed state that
> matters, buildable cover, logistics that shape tempo.
>
> Leave: two-shot lethality, wave respawn timers, dead time as a design goal,
> squad-locked spawning as the *only* spawn.

---

## Two economies, not one dial

This is the core of the plan and the thing that changed most in review.

The first instinct was that the modes differ by *tuning* — same ticket counter,
different rates. That is wrong. **Deaths do not cost tickets in the territorial
mode at all.** Once that is true, the two modes are not two settings of one
system; they are two different currencies, and each mode's counter measures a
different thing.

| | **Sector Control** | **Frontline** |
| --- | --- | --- |
| Reference | Battlefield Conquest | Foxhole / Hell Let Loose |
| Currency | **Lives** | **Materiel** |
| Counter | tickets, moving **down** as you die | sectors held — **the map is the scoreboard** |
| Death costs | 1 ticket + respawn time | Respawn time + what you were carrying |
| You lose by | Running out of lives | Running out of map |
| Victory | Drain the enemy counter to zero | Capture the entire chain |

**Locked:** In Frontline, a death costs no score of any kind — not to the dier,
not to their team.

**Superseded, and worth recording because it was wrong twice.** This section
used to read "in Sector Control the counter goes *down* when you die; in
Frontline it goes *up* when you hold," with score accruing in sector-seconds
against a target and a match clock. That was built and removed. Two problems:

1. **It measured the wrong thing.** The point of Frontline is to take ground.
   A second counter measuring how long you had already been sitting on ground
   you took was answering a question nobody asked, and it let a team win without
   ever advancing.
2. **Materiel is not a counter at all.** It is a *thing in a place* that has to
   be carried — see the resources section. Listing it as Frontline's "currency"
   in the sense that tickets are Sector Control's currency confused a scoreboard
   with an economy.

The surviving one-line statement is simpler:

> Sector Control asks how many lives you have left.
> Frontline asks how much of the map you hold — and makes you drive the tools
> for taking it up from your own HQ.

The known cost of dropping the score is that a 2–2 stalemate has no resolution
and nothing inching. A clock is the smallest fix if that turns out to be common.

### Why death is still expensive without costing score

**This is the risk in the whole plan, and it needs naming.** With no ticket cost,
a 6-second respawn and a forward rally beacon, dying in Frontline is nearly free.
Free death produces the exact behaviour the mode is meant to prevent: soldiers
trickling forward one at a time and trading themselves for nothing, because
nothing is what it costs.

**Working:** Three costs replace the ticket, none of them a counter:

1. **Position.** You respawn at the rally, not at the fight. Distance is the
   tax, and it is self-balancing — the further the front has pushed from the
   rally, the more a death costs.
2. **Materiel.** You come back with the base kit. Gadget charges, placed
   structures and anything the resource system says you were carrying do not
   come back with you. See the resource section below.
3. **Your squad's rally.** Beacons cost resources to plant. A squad that dies
   repeatedly loses its forward spawn and has to walk — which is Squad's
   friction applied *as a consequence*, rather than as a baseline everyone pays.

**Locked:** Resource exhaustion is **never** a loss condition. Resources throttle
tempo; they must not decide the match. Losing because you ran out of materiel
with twenty minutes left and no route back is a miserable game, and no amount of
tuning fixes it.

### What this does to the downed state

Worth flagging because it is easy to miss: `CLASS_AND_GADGET_PLAN.md` justifies
casualty recovery partly in tickets — a revive is a ticket unspent. **In
Frontline that justification evaporates**, because there was no ticket.

The system does not become worthless; its value changes. A pickup in Frontline
saves *time and position* — the two things that actually cost there. That is
still a strong reason to run a Support, and it needs no rule change. But the HUD
framing and any tutorial text that says "revives save tickets" has to be mode
aware or simply not say it.

---

## The axes, and where each one lives in code

The good news: this is not a rewrite. Six call sites carry the entire
distinction between the modes.

**Built.** All six now read `game.rules`; the table below is the map of where.

| Axis | Sector Control | Frontline | Code site |
| --- | --- | --- | --- |
| **Objective topology** | all points open | chain lattice, one front | `game.capturable(sec)`, consulted in `_updateCapture` |
| **AI objective gate** | scores every sector | must skip locked sectors | `replan` `ai.js` |
| **Spawn set** | any held sector | frontmost held + rallies | `spawnOptionsFor` `game.js` |
| **Economy** | ticket bleed on majority | none — nothing drains, nothing accrues | `_updateEconomy` `game.js` |
| **Death cost** | `tickets -= 1` | **no-op** | `onKill` `game.js` |
| **Victory** | a counter hit zero | the full chain | `_checkWin` → `_endMatch` `game.js` |

Line numbers are deliberately absent: the previous revision of this table carried
them and every one had drifted ~100 lines by the time anyone read it. Grep the
method name.

Two things the build changed about this table:

- **Spawn topology is written once now.** `deploy.js:_spawnPoints` used to
  re-derive the player's spawn list independently of `spawnOptionsFor`; it now
  reads through it, so a mode states its topology in one place. The rally beacon
  stays out of `spawnOptionsFor` on purpose — for a bot a rally OUTRANKS every
  sector rather than joining them, which is that method's whole shape.
- **Topology split in two.** `capturable` turned out to answer two questions,
  not one, and SKIRMISH is what forced them apart:

  | Rule | Question |
  | --- | --- |
  | `objectives` | Are sectors PRIZES at all? `capture` \| `none` |
  | `lattice` | If they are, which ones are live? `open` \| *chain, unbuilt* |

  `capturable(sec)` is the AND of the two. Worth keeping separate: a mode with
  no objectives is not a mode with a degenerate lattice, and collapsing them
  would have made SKIRMISH claim a topology it does not have.

**Working — topology is the big one.** Bigger than spawn rules, bigger than the
economy. Open-lattice conquest feels like Battlefield because the fight is
everywhere at once; a chain lattice feels like Squad because there is a
*frontline*. And a frontline is what finally makes the cover-placement and rally
work pay off — cover only matters when the enemy has one direction to come from.

It is also cheap: one `_capturable(sec)` predicate consulted in three places.

---

## Architecture

**Working:** Four decisions, in the order they need making.

### 1. Game types carry a rules *delta*, not a config

**Built.** `GAME_TYPES` was one entry with a name and a description. Each entry
now carries a `rules` block holding only what differs from the defaults in
`rules.js` — as shipped:

```js
frontline: {
  id: 'frontline', name: 'FRONTLINE', desc: '…',
  rules: {
    objectives: 'capture',
    lattice:    'chain',                        // vs 'open'
    economy:    'none',                         // vs 'attrition'
    victory:    'chain',                        // vs 'ticketsZero'
    deathCost:  0,
    spawn:      { hq: true, sectors: 'frontmost', beacon: true },
    resources:  { produce: 4, hqMax: 1500, sectorMax: 600, /* … */
                  cost: { beacon: 60, wall: 25, crate: 40 } },
  },
}
```

`maps: [...]` is **not** built — no type restricts which maps it runs on yet,
and nothing needs it while all three types work everywhere.

### 2. Resolve once per match into `game.rules`

**Built** — `src/rules.js`, resolved in the `Game` constructor from
`session.gameType`, which the lobby had been writing and nothing had been
reading.

**One deviation from this plan as written, and it matters.** The instruction was
"deep-merge the delta over `CFG`". The build merges over a `DEFAULT_RULES`
object instead, and never snapshots `CFG` at all — because a frozen copy of
`CFG` hanging on the game would have silently killed `FC.cfg.bleedInterval = 2`
live editing for exactly the six sites the modes care about most, which is the
thing the very next paragraph of this plan locks. So the split is:

> `rules` answers WHICH RULE applies. `CFG` answers WHAT THE NUMBER IS.

A mode decides the counter measures attrition rather than territory. It does not
decide that the bleed interval is 4 seconds — that stays in `CFG`, read live at
the call site.

**The one exception, and why it is one:** `rules.tickets` (null = take
`CFG.tickets`). What a counter starts at only means something alongside what
drains it, so 400 under a ticket bleed and 400 under kills-only are not the same
match length. It is read once at construction, so it was never live-editable
through `FC.cfg` anyway — the property this split exists to protect is intact.
`rules.resources` arrived on the same terms and for the same reason: a supply
network's rates only mean something against its costs, so they travel together
as one mode-owned block rather than scattering into `CFG`.

Then migrate **only the six call sites in the table above** to read
`game.rules.*`.

**Locked:** Do *not* sweep `CFG` → `rules` across the codebase. Modules capture
it at import scope (`const C = CFG.crate` in `supply.js:17`), and a broad rewrite
would break `FC.cfg` live-editing — which is the A/B testing path the project
already relies on (`main.js:192`, and the `downed.enabled` note at
`config.js:75`). Six sites, deliberately, and `CFG` stays the default truth.

### 3. The lattice is map data, not type data

A chain mode needs an *order*. `CFG.sectors` (`config.js:16`) is five scattered
points with no adjacency. Each map gains a `chain: ['A','B','C','D','E']`.

GLB maps get this nearly free — the `FC_SECTOR_A..` marker convention already
sorts. The procedural demo map can derive it by x-coordinate.

`MAPS[x]` then declares which types it supports, and the lobby filters the
combination. Without that filter, picking Frontline on a chainless map sends 32
bots to a sector that cannot be captured.

### 4. The AI must respect the gate

`replan` (`ai.js:117`) scores every sector unconditionally. Under a lattice,
locked sectors must score zero or the team brain masses squads on a point nobody
can take. This is a small change and a mandatory one.

---

## Resources

**Built as a SUPPLY NETWORK.** `rules.resources`, `src/logistics.js`; null in
every mode that does not want one, which is how SECTOR CONTROL and SKIRMISH
stay free.

> **HQ is a SOURCE. A sector is a DEPOT. Nothing moves between them by itself.**

**This section previously described a team-level pool earned by holding
territory, and that was built and then torn out.** It is worth recording why,
because the two designs look similar in config and are opposites in play:

| | Pool (wrong) | Network (right) |
| --- | --- | --- |
| Where materiel is | one number per team | in a specific place |
| How you get it | hold ground | produce at HQ, then **carry it** |
| What it rewards | standing still | running the supply line |
| Supply line | never has to exist | is the game |

A team-wide pool lets a squad at the front spend materiel sitting in a warehouse
eighty seconds' drive away — which deletes the single decision the economy
exists to create. The counter you spend at the front has to be the one somebody
drove there.

**For a bot, which way materiel flows is decided by where it is standing** — at
its HQ it LOADS, at its sector it UNLOADS. No UI, no state to get stuck in,
which matters when 63 of the 64 soldiers on the field will never be told what a
load button is.

**The player uses the supply wheel instead** (`src/supplywheel.js`, hold Z), and
is deliberately excluded from the automatic path in BOTH directions. The reason
the wheel had to exist: position can only imply direction while each place has
one legal action, and that rule made a sector depot a one-way sink. There was no
way to take materiel *out* of a sector — no lateral redistribution, and a
captured enemy stockpile could be spent where it stood but never moved. The
wheel replaces inference with intent, and TAKE falls out of it for free.

It is the only radial in the game and should stay that way. Everywhere else, one
contextual key with a priority chain (`player._updateInteract`) is better,
because everywhere else there IS a single sensible action — a bleeding squadmate
wants reviving, and making you spin a wheel for that would be strictly worse.
A depot is the one place where take, drop and neither are all legal at once.

Three properties worth not breaking:

- **It never releases pointer lock.** You open it in the field with people
  shooting at you. It reads raw `movementX/Y` and the camera is suppressed while
  it is up, or choosing a wedge would spin you on the spot.
- **The gesture is one key.** Hold Z, push toward a wedge, materiel flows for as
  long as you hold. The dead zone in the centre IS the "do nothing" option and
  how long you hold is the amount — so there is no confirm press and no quantity
  to pick.
- **Spent wedges grey out, they do not disappear.** A wheel that changes shape
  under your hand mid-gesture is a wheel you cannot aim.

**Two rules that had to be discovered by measurement, not reasoning:**

1. **Who may LOAD is not who may UNLOAD.** Letting every bot top up a backpack
   simply by respawning at HQ drained 1500 materiel out of a home stockpile in
   two minutes on reinforcement traffic alone, and not one unit of it was a
   decision anybody made. A bot now loads only while its squad is on a run; the
   player always may, because standing at your own HQ is a choice. Unloading
   stays open to everyone always, so materiel on the wrong person still reaches
   a depot when they walk past one.
2. **A cancelled run must RETARGET, not abandon.** When a delivery's destination
   fell to the enemy mid-run the squad dropped the job, and since a squad only
   unloads where it is being sent, the loaded Warthog stayed parked in a field
   for the rest of the match — 750 materiel in three hogs on one measured run.

**Capturing a stocked sector captures its supplies.** Deliberate: it makes a
well-fed front worth *taking* rather than merely worth killing, and it punishes
banking at a sector you cannot hold. Burning it on capture is one line in
`Logistics.teamOf` if that plays better.

**The gate is three methods on `Game`** — `costOf`, `canAfford`, `spend` — and
the reason it is that and not more: a mode with no `resources` block answers
`0 / true / true`, so no call site has to check first. That keeps the gate to
one line each in `structures.canPlaceAt` and `supply.place`.

**Where the check lives is the whole trick.** It goes in
`structures.canPlaceAt`, not in `place`, because the player, the AI and any
future placement ghost all ask that one method whether a spot is legal. All
three inherit the cost rule and the same `NO MATERIEL` reason string, through a
channel `player.js` already surfaces to the HUD. `place` re-checks and charges —
not redundant, since `canPlaceAt` is also called speculatively and two squads on
one team can spend between a check and its commit.

What it gates today:

- Rally beacon placement — 60 (was free; `CFG.beacon`, "the cooldown IS the cost")
- Wall placement — 25 (the `structure.maxPerTeam: 12` cap still stands *as well*)
- Supply crate placement — 40
- **Not yet:** vehicle spawning, better classes, better weapons — the things this
  economy is ultimately for. All three are now a cost lookup and a call to
  `game.spend(team, key, x, z)` away.

### Bots must run supply, or the economy is decorative

**This is the load-bearing half of the mode, not a polish item.** A player
cannot feed 31 AI squadmates, and if only the player hauls then the front dries
up everywhere they are not standing.

`Squad.supplyRun` + `TeamBrain._planSupply`. A run is expressed as nothing but a
**moving objective** — leg `load` points the squad at its own HQ, leg `deliver`
points it at the depot that needs it — so `updateVehicleUse` drives it by road
and `_move` walks it, and no new kind of order had to exist. One change was
needed in the vehicle code: a crew must NOT dismount on arrival during a run,
because arriving at HQ is the halfway point and a crew that piles out to watch
the hog load cannot drive it back.

Dispatch is **need-driven, not a fixed detail**: a team whose forward depots are
full sends nobody, a team that just pushed into an empty sector sends someone.
Capped at a third of the team. The threshold is written as what it buys — four
walls' worth — so retuning the costs retunes dispatch with them.

Losing a loaded truck to a squad wipe is a real and correct cost; the materiel
is not destroyed, and a later squad reclaiming that hog resumes the delivery
immediately because its cargo already reads as loaded.

**Untuned, all of it.** The ratio that matters is `produce` against the costs.
Measured on `map3` (8 Warthogs): forward depots settle around 300–450 with runs
dispatching and standing down as the front demands, which is the right shape.
The demo map has **no vehicle spawns at all**, so it exercises the backpack path
only — worth knowing when a change looks fine there and not on map3.

**This answers an open question that was already blocking other work.**
`CLASS_AND_GADGET_PLAN.md` → "The limiter problem" asks how to throttle
construction once the repair tool is global, and lists a per-sector build budget
(safest) and supply-drawn-from-Support (most interesting) as candidates. **The
supply network is literally the first one** — a per-sector build budget is
exactly what a sector depot is — and it reaches the second's intent by a better
route, since the budget is refilled by players rather than by a timer.
Construction's limiter and the Frontline economy are one system, as required.

A team being pushed back does still build less, but for a sharper reason than
income: its depots are further from HQ, its runs take longer, and the depot it
just lost took its stockpile with it.

Open questions. The build answered the first three **by assumption, not by
decision** — they were assumed so FRONTLINE could ship whole, and every one is a
line of config away from the other answer:

1. **One pool per team, or per squad?** **Neither — per PLACE.** One stockpile
   at each HQ and one at each sector. The question turned out to be wrong: the
   interesting unit of ownership is geography, not org chart.
2. **Is materiel transported (Foxhole, Squad logistics trucks) or does it
   accrue?** **Transported — owner-decided, and the point of the whole
   economy.** Warthog cargo (250, ~10 walls a run) plus a soldier backpack (30,
   at 0.8× move speed) so a team with no vehicle nearby is slowed rather than
   locked out.
3. **Does Sector Control use resources at all?** *Assumed no* — it is
   deliberately the simple mode. `resources: null`.
4. **Does losing a sector destroy the structures inside it?** *Still open, and
   untouched.* Walls currently outlive the ground they were built on.

---

## The type roster and build order

**Working:** Four types, built in this order. Each one is useful before the next
exists.

### 1. SKIRMISH — the plumbing test

**Built.** No objectives. Kills only. `objectives: 'none'`, `economy: 'none'`,
HQ and rally spawns, 150 tickets.

Worthless as a mode; **invaluable as proof the rules resolver works** before it
touches capture logic. It is also genuinely useful for tuning combat without
capture noise in the way, which `/chartest.html` cannot give you — that is a
range, this is 64 soldiers actually fighting.

It earned that keep twice over, because it found the one thing this plan had
missed. **A mode with no objectives leaves the AI with nothing to walk toward.**
Every sector filtered out of the gate in `replan`, and 64 soldiers stood at
their spawns waiting for an order that could not come. So a mode without
objectives gets the other reason to move: the sectors remain the map's
landmarks, and the best one is wherever the enemy already is. Squads converge,
fight, and re-converge when the crowd moves. The greedy assignment split out of
`replan` into `_assign` at the same time — how a team WEIGHS the map is
per-mode, how it hands out the work is not.

The proof it produced is worth recording as the acceptance test for any future
mode: over 240 s of `setTimeScale(8)`, the two teams' ticket losses summed to
*exactly* the death count (45 + 39 = 84), so `deathCost` was the only drain and
`economy: 'none'` genuinely stopped the bleed. The same run under SECTOR CONTROL
drained 61 tickets that no kill accounts for. **A game type gates behaviour, not
merely constants** — and that is a measurement, not an assertion.

**Untuned:** 150 tickets is a first guess. Under kills-only, 400 runs well past
half an hour.

### 2. SECTOR CONTROL — the Battlefield preset

**Built.** What existed already, reframed as a preset rather than the hardcoded
truth. `objectives: 'capture'`, `lattice: 'open'`, `economy: 'attrition'`. Zero
new gameplay; the work was entirely in moving the existing behaviour behind the
rules object, verified unchanged by a scripted battle before and after.

### 3. FRONTLINE — the territorial mode

**Built.** Chain lattice, no death cost, spawning restricted to the frontmost
held sector plus rally beacons, and the supply network from the resources
section below.

**Won by capturing the whole chain, and by nothing else** — owner-decided.
No ticket bleed, no clock, no score: the map is the scoreboard, and the HUD
counter reads SECTORS. Sector-second scoring was built here first and removed;
the point of the mode is to take ground, and a second counter measuring how long
you sat on it was answering a question nobody asked. The known cost of the pure
rule is that two sides dug in with neither advancing has no resolution. A clock
is the smallest fix if that turns out to be the common case rather than the rare
one.

It reuses the beacon system already built, gives the cover and construction work
a reason to exist, and it is where the Battlefield-versus-Squad question stops
being an argument and becomes something that can be felt in a match.

**The chain is derived, not authored.** `world._buildChain` projects each sector
onto the blue-HQ → red-HQ axis and sorts. That covers the procedural map and
marker-authored GLB maps without either declaring anything, and it degrades
predictably rather than sanely: the order stays monotone along the axis the two
bases define, which is the axis a frontline runs across. `MAPS[x].chain` is the
override, and a declared chain that does not name every sector is refused with a
warning rather than run — sectors it left out could never be captured by anyone.

**Open, and map3 is the reason:** its four sectors are not in a line, so the
derived order comes out A → C → B → D with C sitting ~500 units off the axis.
That is defensible and it plays, but it is not obviously the order a person
would pick. Whoever authored those markers should decide, and say so:

```js
map3: { …, chain: ['A', 'B', 'C', 'D'] },
```

**Correctness note worth keeping.** Two things about the lattice were wrong in
the obvious implementation and are worth not rediscovering:

1. **The front is the end of a CONTIGUOUS run, not the highest index owned.**
   A team that loses a sector *behind* its front must retake that one. The
   naive version lets them leapfrog it, and the single front silently becomes
   two — the mode's one premise gone.
2. **`capturable` needs to know which team is asking.** Blue's next target and
   red's are opposite ends of the same map. Answering the loose "can anyone take
   this" for both marches blue squads at red's front, where they can stand
   forever without the bar moving, and lets a team bank progress in a sector it
   is not allowed to take. `capturable(sec, team)`; the team-less form is for
   the sector ring, which genuinely wants the loose question.

**Untuned:** every resource number. See the resources section.

### 4. BREAKTHROUGH — asymmetric attack and defend

**Long-term.** One team defends the chain; the other pushes it. Cheap once
Frontline exists, because it is the same lattice with an asymmetric economy —
attackers get a pool that only drains on death and refunds on capture, which is
the one place a death *should* cost, because that is the mode's entire tension.

---

## Two decisions needed before implementation

### Squadmate spawning

**Open.** Not implemented at all today — the deploy screen offers sectors only.
It is the single loudest tell between the two references: having it pushes hard
toward Battlefield, leaving it out makes the rally beacon the *only* forward
spawn.

**Recommendation: leave it out.** The beacon is the more interesting system, it
is already built, and it already has AI support. Adding spawn-on-squadmate would
make the beacon redundant in the mode designed around it.

### Per-mode lethality

**Open.** Should Frontline lower TTK to sell its slower, more deliberate feel?

**Recommendation: no.** One weapon balance, one feel. If lethality varies by
mode, the `/chartest.html` tuning workflow stops transferring 1:1 into config —
which is the thing that makes hand-tuning weapons practical at all. Modes should
differ in **shape**, never in how a rifle behaves.
