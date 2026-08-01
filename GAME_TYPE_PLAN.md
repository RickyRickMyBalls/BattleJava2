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
| Reference | Battlefield Conquest | Foxhole, not Squad |
| Currency | **Lives** | **Materiel** |
| Counter moves | **Down**, as you die | **Up**, as you hold |
| Death costs | 1 ticket + respawn time | Respawn time + what you were carrying |
| You lose by | Running out of lives | Running out of map |
| Victory | Drain the enemy counter to zero | Reach the score target, or hold more at time |

**Locked:** In Frontline, a death costs no score of any kind — not to the dier,
not to their team. Territory is the only thing the counter reads.

**Working — the one-line statement of the whole difference:**

> In Sector Control the counter goes **down** when you die.
> In Frontline the counter goes **up** when you hold.

That reuses the existing HUD ticket readout unchanged, and it gives Frontline a
monotone progress bar that both sides can read — which a pure "who holds what at
the end" rule does not have. A 2–2 stalemate for twenty minutes needs to show
*someone* inching ahead, or it reads as nothing happening.

### Frontline scoring

**Working:** Score accrues in **sector-seconds**. Each sector a team holds pays
its team a point per second, per sector. First to the target wins; if the timer
expires first, the higher score wins.

Consequences worth stating up front:

- Holding early is worth as much as holding late. No sudden-death swing, no
  reason to turtle for twenty minutes and lunge at the end.
- The centre sector can be worth more than a flank simply by carrying a higher
  rate. That is a per-sector knob, not a new system.
- Capturing the **entire chain** should end the match immediately regardless of
  score. A team with nowhere left to spawn is not owed a countdown.

**Open:** The score target and match length. These have to be felt, not
calculated — but the scripted fast-forward harness (`setTimeScale(8)`) can
produce the curve for a first guess before anyone plays it.

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

| Axis | Sector Control | Frontline | Code site |
| --- | --- | --- | --- |
| **Objective topology** | all points open | chain lattice, one front | `_updateCapture` `game.js:429` |
| **AI objective gate** | scores every sector | must skip locked sectors | `replan` `ai.js:117` |
| **Spawn set** | any held sector | frontmost held + rallies | `_spawnPoints` `deploy.js:217`, `_respawnAI` `game.js:394` |
| **Economy** | ticket bleed on majority | sector-seconds accrual | `_updateTickets` `game.js:476` |
| **Death cost** | `tickets -= 1` | **no-op** | `onKill` `game.js:211` |
| **Victory** | a counter hit zero | target, timer, or full chain | `_checkWin` `game.js:491` |

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

`GAME_TYPES` in `config.js:1716` is currently one entry with a name and a
description. Each entry grows a `rules` block holding only what differs from
`CFG`:

```js
frontline: {
  id: 'frontline', name: 'FRONTLINE', desc: '…',
  rules: {
    lattice:  'chain',                          // vs 'open'
    spawn:    { sectors: 'frontmost', beacon: true, hq: true },
    economy:  'territory',                      // vs 'attrition'
    score:    { target: 1200, perSectorSecond: 1, matchLength: 1500 },
    deathCost: 0,
    maps:     ['demo', 'map3'],
  },
}
```

### 2. Resolve once per match into `game.rules`

Deep-merge the delta over `CFG`, freeze the result, hang it on the game. Then
migrate **only the six call sites in the table above** to read `game.rules.*`.

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

**Open — the system is not designed here.** This section defines only the *seam*,
so the rules work does not have to be redone when resources land.

**Working:** Resources are a **team-level materiel pool**, spent on things that
persist in the world, earned by holding territory.

What it must gate, at minimum:

- Rally beacon placement (currently free — `CFG.beacon`, "the cooldown IS the cost")
- Structure placement (currently capped by `structure.maxPerTeam: 12`)
- Vehicle spawning, when vehicles exist
- Gadget resupply beyond the base kit

**This answers an open question that is already blocking other work.**
`CLASS_AND_GADGET_PLAN.md` → "The limiter problem" asks how to throttle
construction once the repair tool is global, and lists a per-sector build budget
(safest) and supply-drawn-from-Support (most interesting) as candidates. A team
materiel pool is both of those, generalised. **Construction's limiter and the
Frontline economy should be one system, not two.** If they are built separately
they will be reconciled later at a cost.

**Working:** Income is territorial. Sectors pay materiel per second the same way
they pay score, which means the same held-sector loop drives both the win
condition and the ability to keep fighting — and a team being pushed back
naturally builds less, without a rule saying so.

Open questions, in order of how much they change:

1. One pool per team, or per squad? Per team is simpler and makes hoarding a
   real problem; per squad is more interesting and much more UI.
2. Is materiel *transported* (Foxhole, Squad logistics trucks) or does it simply
   accrue? Transport is the deepest version and by far the most work; it also
   needs vehicles, which do not exist yet.
3. Does Sector Control use resources at all, or is it deliberately the simple
   mode with none?
4. Does losing a sector destroy the structures inside it?

---

## The type roster and build order

**Working:** Four types, built in this order. Each one is useful before the next
exists.

### 1. SKIRMISH — the plumbing test

No objectives. Kills only. Roughly twenty lines of rules.

Worthless as a mode; **invaluable as proof the rules resolver works** before it
touches capture logic. It is also genuinely useful for tuning combat without
capture noise in the way, which `/chartest.html` cannot give you — that is a
range, this is 64 soldiers actually fighting.

### 2. SECTOR CONTROL — the Battlefield preset

What exists today, reframed as a preset rather than the hardcoded truth.
`economy: 'attrition'`, `lattice: 'open'`. Zero new gameplay; the work is
entirely in moving the existing behaviour behind the rules object so it can be
verified unchanged.

### 3. FRONTLINE — the territorial mode

**The highest-value item on this list.** Chain lattice, sector-second scoring, no
death cost, spawning restricted to the frontmost held sector plus rally beacons.

It reuses the beacon system already built, gives the cover and construction work
a reason to exist, and it is where the Battlefield-versus-Squad question stops
being an argument and becomes something that can be felt in a match.

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
