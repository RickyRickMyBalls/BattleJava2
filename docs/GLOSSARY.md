# Glossary

Companion to the four plan docs. This one defines **the words**, so the others
can use them without re-explaining. It is a lookup table, not a design document:
nothing is decided here.

Two rules keep it useful:

- **Point at the knob, not the number.** Where a value defines a concept it is
  quoted, but the authority is the named `CFG` / `rules` key. Numbers drift;
  keys do not.
- **No line numbers.** The previous revision of a table in `GAME_TYPE_PLAN.md`
  carried them and every one had rotted by the time anyone read it. Grep the
  method name.

Terms are grouped by domain and alphabetical within each group. The last
section — **[Pairs that get confused](#pairs-that-get-confused)** — is the one
worth reading front to back.

---

## Document conventions

Every plan doc labels its decisions. The label is part of the claim; check it
before treating anything as a requirement.

| Label | Means |
| --- | --- |
| **Locked** | Owner-decided, or built and verified. A project requirement until deliberately revised. |
| **Working** | Proposed but not owner-approved, or approved but unvalidated by play. |
| **Open** | A decision is still required. Nobody has made it. |
| **Long-term** | Intended future. Not required for the first playable. |

**Built / Landed** — shipped in the codebase. Distinct from *Locked*: a thing
can be Locked as design and unbuilt (drag and carry), or Built and still
untuned (every Frontline number).

**Measured** — a figure that came out of the running sim or the engine, not off
a whiteboard. The docs flag these deliberately, because the project's habit is
to measure rather than assert. Treat an unlabelled number as a guess.

**Owner** — the human who authors assets in Blender, hand-tunes values, and
approves each incremental step. Where a doc says "owner approves", that is a
gate, not a courtesy.

**First playable** — the milestone target: one human plus 63 bots in a complete
32v32 match with a valid result. Defined in `GAME_DESIGN_PLAN.md`; it is the
line that separates *required* from *Long-term* everywhere else.

---

## Match and game type

**Attrition** — the `economy` value where the ticket counter *bleeds* from
whoever holds fewer sectors. Sector Control's economy. Contrast **territory**
(accrue on hold) and **none** (nothing drains, nothing accrues).

**Breakthrough** — **Long-term** asymmetric mode: one team defends the chain,
one pushes it. The same lattice as Frontline with an asymmetric economy.

**CFG** — the global tuning object in `config.js`. Answers **what the number
is**. Read live at the call site, which is what makes `FC.cfg.x = y` editing
work mid-match. See `rules` for the other half of the split.

**Death cost** — `rules.deathCost`: tickets charged to the dead soldier's team
per death. `1` in Sector Control and Skirmish, `0` in Frontline.

**Economy** — `rules.economy`: what the match counter measures. `attrition` |
`territory` | `none`.

**Frontline** — the territorial mode. Chain lattice, one moving front, spawning
restricted to the frontmost held sector plus rally beacons, no death cost, and
the materiel supply network. **Won by taking the whole chain** — no bleed, no
clock, no score.

> Note: `GAME_TYPE_PLAN.md` still describes Frontline scoring in **sector-seconds**
> against a `target` with `perSectorSecond` income. The build has since moved to
> `economy: 'none'`, `victory: 'chain'`, and HQ-produced materiel that has to be
> hauled. Where the two disagree, `config.js` and `src/logistics.js` are current.

**Game type** — an entry in `GAME_TYPES` (`config.js`). Carries a **rules
delta**, not a config: only what differs from `DEFAULT_RULES`. Four exist:
`conquest` (SECTOR CONTROL), `skirmish`, `frontline`, and Breakthrough as
Long-term.

**Lattice** — `rules.lattice`: which sectors may change hands. `open` (all of
them, always) or `chain` (only at the ends of each team's contiguous run).
The single biggest lever between the Battlefield and Squad feels.

**Objectives** — `rules.objectives`: whether sectors are prizes at all.
`capture` | `none`. Deliberately separate from `lattice` — a mode with no
objectives is not a mode with a degenerate lattice.

**rules** — the frozen per-match object resolved by `src/rules.js` from the
chosen game type. Answers **which rule applies**. Hangs on `game.rules`, and
exactly six call sites read it. Never swept across the codebase; see the pairs
section.

**Sector Control** (`conquest`) — the Battlefield preset. All sectors open,
ticket bleed on majority, one ticket per death. What the prototype was before
game types existed, reframed as a preset rather than the hardcoded truth.

**Skirmish** — no objectives, kills only. Worthless as a mode, kept as proof
that a game type gates *behaviour* and not merely constants, and as the only way
to watch 64 soldiers fight without capture traffic deciding where they go.

**Ticket** — the reinforcement counter. Spent **only when a soldier actually
dies** — bleeding out, giving up, or being finished. Going down costs nothing
and a pickup refunds nothing. The counter therefore reads *confirmed losses*,
not current casualties, and can trail a heavy push by up to a bleedout.

**Victory** — `rules.victory`: how the match ends. `ticketsZero` (a counter hit
the floor) | `chain` (one team owns every sector).

---

## Map and territory

**Capture ring** — the radius around a sector marker inside which live soldiers
count toward capture. Downed bodies do not (`alive` is false while downed).

**`capturable(sec, team)`** — the predicate that answers whether a sector is
live. The AND of `objectives` and `lattice`. **Takes the asking team**: blue's
next target and red's are opposite ends of the same map. The team-less form
exists for the sector ring, which genuinely wants the loose question.

**Chain** — the ordered sector sequence a lattice mode runs along. **Derived,
not authored**, by `world._buildChain`: each sector is projected onto the
blue-HQ → red-HQ axis and sorted. `MAPS[x].chain` is the override, and a
declared chain that does not name every sector is refused rather than run.

**Contested** — a sector with both teams inside the ring. A contested sector
still pays and still belongs to its current owner until the moment it flips.

**Cover box** — an AABB from `Collision_cover_parent`, used for AI cover
selection and vehicle hull push-out.

**Depot** — a stockpile of materiel at a fixed place. Two kinds: an **HQ
depot** (a source, produces) and a **sector depot** (a sink, only ever holds
what was carried in). Capturing a stocked sector captures its supplies.

**Front / frontmost** — the far end of a team's **contiguous** run down the
chain, not the highest index it happens to own. A team that loses a sector
*behind* its front has to retake it; the naive version lets them leapfrog and
the single front silently becomes two.

**Graybox** — untextured placeholder level geometry, built to prove layout and
rules before art exists.

**Heightfield** — the GPU-baked terrain height function (`world.heightAt`). Fast,
analytic, and **wrong in places on GLB maps** — see Known problems in
`VEHICLE_PLAN.md`. Never the sole grounding authority; see the two-tier rule.

**HQ** — a team's home spawn, always a valid spawn option, and in Frontline the
only place materiel is produced.

**Marker empty** — a named empty in a GLB that the code resolves by name:
`FC_HQ_BLUE/RED`, `FC_SECTOR_A..`, `FC_VEHICLE_*`, `FC_CHAR`, `FC_CAM`,
`FC_PROP_VEHICLE`. These define scale, centre and bounds — **never trust a GLB's
own bbox**, the sky nodes inflate it.

**Sector** — a capturable location. Five on the demo map, four on map3. The unit
of territory in every mode; in Skirmish they persist as landmarks the AI fights
over even though nobody can take one.

**Two-tier grounding** — the house rule for "where is the ground": authored
floor shell first (`collision.groundAt`), heightfield as fallback
(`world.heightAt`). Every entity grounds this way. A vehicle that grounds by a
different rule than the infantry parks in its own private world.

---

## Team, squad and control

**Bot** — an AI-controlled combatant. 63 of the 64 on the field. The plans' most
load-bearing constraint: a system bots cannot use does not exist for most of a
match.

**Combatant seat** — the design-level slot a team is made of. 32 per team, each
filled by either a human controller or an AI controller. Character, class,
inventory, team, squad and score belong to the **seat**, not to the controller —
which is what lets a human take over a bot without creating two kinds of
soldier. **Not a vehicle seat.**

**Fireteam** — half of an eight-person squad. **Working**, and not required for
the first playable.

**Squad** — the small team inside the battle. **Working:** four eight-person
squads per team; eight four-person squads remains a comparison candidate.

**Squad leader** — coordinates the squad, issues contextual orders, and enables
the rally point. In a crewed Warthog the leader takes the gun.

**TeamBrain** — the team-level AI in `ai.js` that decides which squad goes
where. `replan` **weighs** the map (per-mode, and must skip locked sectors under
a lattice); `_assign` **hands out** the work (not per-mode). The split exists
because those are two different questions.

---

## Soldier state

**Alive** — `soldier.alive`. **A downed soldier is `alive === false`**, which is
why 45 reads of the flag across 7 files stayed correct when the downed state
landed. Four places opt casualties back in deliberately.

**Armor** — the middle damage layer. Behaves like a shield in absorbing a pool,
and unlike one in that **it does not regenerate** — only a repair tool restores
it. **Locked** as design, not built. Gives the Engineer a reason to be forward
with the infantry.

**Bleedout** — the 60-second window a downed soldier has before dying.
`CFG.downed.bleedout`. Shown as a **vignette** closing in, not a countdown.

**Call for help** — a downed soldier's only agency, and not cosmetic: a live
call makes bots travel `callRangeMult` further to answer it and sorts that
casualty above nearer silent ones. Expires after 8 s so the loudest marker on
screen is always the freshest casualty.

**Damage order** — `shield → armor → health`, outermost inward.

**Dead** — the terminal state. Costs a ticket (at `rules.deathCost`), starts the
respawn timer, opens the deploy screen for the player.

**Downed** — the state between alive and dead. Collapsed, out of the fight, free
to look around and to call for help, recoverable by any teammate holding a
biofoam charge. Ends in a pickup, a bleedout, a give-up, or being finished.

**EHP** — effective hit points. Currently 100: 45 regenerating shield plus 55
non-regenerating health. **Every weapon in the armory is tuned against that
number** — which is why the armor plan recommends carving armor out of the 100
rather than adding on top.

**Give up** — the downed soldier's release valve, available from the first
frame. Without it, 60 seconds against a 5–6 second respawn is a punishment
rather than a ceiling on hope.

**Overkill margin** — `CFG.downed.gibMargin`. One number instead of a list of
damage types that bypass the down: carry health past zero by more than the
margin and the soldier dies outright. Covers headshots, rockets and point-blank
shotguns, and gives *finishing a downed enemy* for free.

**Pickup** — the stationary recovery action. Hold the interact key over a
downed teammate for `CFG.downed.reviveTime` (5 s; Support does it in a third,
via `PERKS.combatLifesaver.reviveRate`), spend one biofoam charge **on
completion**, and they stand up on 50% health with no shield. Phase 1 of
casualty recovery, and the only phase built.

**Drag / carry** — phase 2 of casualty recovery. Drag is slow with one hand free
(can heal while moving); carry is faster with both hands busy. **Locked** as
design, deferred in build — both need animation at both ends of an attachment
between two soldiers.

**Stamina** — **Locked** as a system, entirely unbuilt; sprinting is currently
unlimited. Drains on sprint and on carrying a casualty. Two perks are already
defined in terms of it.

---

## Loadout, classes and gadgets

**Class** — an individual combatant's equipment and responsibility. Five
planned: Assault, Engineer, Recon, Support, Spartan. Only Assault exists in
config with the six-slot schema; the rest keep a legacy shape.

**Gadget kind** — `GADGETS[x].kind`, which the code branches on rather than on
the gadget's identity: `consumable` (biofoam) | `weaponSlot` (webbing) | `tool`
(repair tool) | `placeable` (crates) | `passive` (overshield).

**Global gadget** — a gadget available to every class rather than class-locked.
The repair tool is the first. Globals join the **utility slot only** — the
identity slot is what makes a class that class.

**Identity slot / utility slot** — gadget slots 3 and 4, drawn from two
*separate* pools so a build cannot double up. Slot 3 is the class's reason to
exist; slot 4 is what it chose to bring.

**Perk** — a fixed per-class capability that costs no slot and is not chosen.
Two kinds: **grant** (a free item or access) and **stat** (a passive modifier).
The rule that keeps them from becoming the balance problem: *perks grant
utility, never lethality.*

| Perk | Class | Grants |
| --- | --- | --- |
| Marathon | Assault | larger stamina pool, faster recovery |
| Combat Engineer | Engineer | free repair tool, exclusive blueprints, faster build and repair |
| Combat Lifesaver | Support | picks a casualty up in a third of the normal time |
| MJOLNIR | Spartan | 70 shield, 3 m jump, unlimited stamina, any weapon in slot 2 |

**Sidearm** — the default occupant of slot 2. Distinguished by **draw speed**
(`swapTime`, 0.2 s for the Magnum against 0.4 s for everything else), not by
damage or capacity: it is what you reach for when a primary runs dry, and it
should lose a stand-up fight against any rifle.

**Six slots** — the **Locked** loadout shape: primary, secondary, identity
gadget, utility gadget, grenade, melee — plus one perk that is not a slot.

**Specialist pool** — weapons that may never be a primary and are reachable only
by spending a gadget slot on the class that owns them, or by being a Spartan:
sniper, DMR, rocket launcher, Spartan laser. Contrast **standard pool** (AR, BR,
SMG, shotgun), which any class may take as a primary.

**Universal action, class-boosted** — the plan's named house pattern: everyone
can do the thing, one class does it markedly better. Anyone builds, the Engineer
builds faster and alone places blueprints. Anyone revives, Support is three
times quicker. Anyone repairs armor, the Engineer is faster. Apply it
deliberately to the next system rather than rediscovering it.

**Webbing** — Assault's utility gadget: trades the sidearm for a second weapon
from the class's own primary pool, at 0.6× reserve ammo on both. The reserve
penalty is what makes the build want Support's crate.

---

## Combat

**Biofoam** — the healing consumable, and the **currency of casualty recovery**.
Every soldier carries 3, Support carries 15 (`BIOFOAM` in `config.js`). Locks
the user briefly then heals over time. **Does not work on yourself while
downed** — otherwise three charges are three free self-revives and the pickup
never fires.

**fp** — a weapon's first-person viewmodel offset, `WEAPONS[k].fp`. Tuned in
`/chartest.html`'s VIEWMODEL tab. **Not `grip`.**

**grip** — a weapon's third-person hand-mount transform, `WEAPONS[k].grip`,
applied to a scale-compensated holder on the hand bone. Tuned in the GRIP tab.

**Hitscan** — the combat model: shots resolve instantly along a ray
(`combat.traceHit`) rather than as travelling projectiles. Rockets are the
exception.

**`mounted`** — a `WEAPONS` flag meaning the geometry belongs to a vehicle.
`assets.js` loads no model, the GRIP and VIEWMODEL tabs skip it, and it is in no
armoury pool — what puts it in your hands is the *seat*. `hogturret` is the
first.

**Suppression** — affects awareness and weapon handling without removing player
control. **Open** in detail.

**Tracer** — the visual for a shot, pooled, in one of the per-weapon styles in
`WEAPONS[k].tracer`: a moving **bolt**, or a static fading **vapor** / **beam**.

**TTK** — time to kill. The reason armor is a re-tune rather than a tweak, and
the reason lethality is deliberately **not** per-mode: modes differ in shape,
never in how a rifle behaves.

---

## Logistics and construction

**Backpack** — what one soldier can hand-carry (`resources.backpack`), at a
move-speed cost (`carryPenalty`). The stopgap against a vehicle run.

**Blueprint** — a ghost of a structure, positioned and rotated. **Engineer-
exclusive.** Stage one of construction; anyone with a repair tool builds it.
The Engineer is the architect, not the bricklayer.

**Buildable** — an entry in the buildables registry the blueprint tool draws
from. Wall and turret are entries rather than separate gadgets, so a fifth
structure is a config entry and not a new gadget competing for a slot.

**Cargo** — materiel currently being carried by a soldier or a vehicle.
`vehicleCargo` is the per-vehicle ceiling.

**Draw** — one interaction with a supply crate. Takes a fixed amount and drops
the crate's pool by it; when the pool is empty the crate is scrap.

**Load / unload** — how materiel moves, decided by **where you are standing**,
not by a key or a menu: at your HQ you load, at your sector you unload. The
whole interface, and it reads identically for a player and a bot.

**Materiel** — the Frontline currency. **Produced at HQ and carried forward.**
Never earned by holding ground — holding ground is what gives you somewhere to
carry it *to*, and what shortens the drive. Spent on things that persist in the
world: rally beacons, walls, crates. **Never a loss condition** — resources
throttle tempo, they must not decide the match.

**Rally beacon** — a squad's forward spawn, placed at a materiel cost, that the
AI genuinely respawns on. In Frontline it is the *only* forward spawn besides
the frontmost sector, and losing it is one of the three costs that replace the
ticket.

**Repair tool** — the global gadget that does three jobs: build blueprints,
repair vehicles, restore armor. The most broadly useful object in the game,
which is the argument for it being global. The Engineer is faster at all three.

**Supply crate** — Support's placed objects, ammunition and medical, each a
**finite pool** rather than a radiating station. `pool ÷ per draw` is what a
Support is worth to a squad, and it is the number to tune.

**`supplyRadius` / `transferRadius`** — how far a *build* may reach for a
stocked depot, versus how close a *carrier* must park to move materiel. Two
radii, deliberately different sizes.

---

## Vehicles

**Autopilot** — the VEHICLE tab toggle that drives the range hog through the
real `vehicledriver.js`, with no Game, squad or soldier involved. Keeps "does
the controller work" and "does the AI decide to drive" as separate questions.

**Bump stop** — a second, much stiffer spring acting only on suspension
overshoot. Without it a 4 m drop puts the floor pan through the rock.

**Claim** — a squad's reservation of an uncrewed vehicle. **Binds bots only** —
the player can still take a claimed hog, because a reservation the player cannot
override reads as a bug.

**COM** — centre of mass, `CFG.vehicle.warthog.com`. Tuned, *not* taken from
`ref_body_rotation` — that empty sits 1.457 m up, which rolls the hog in every
turn.

**Contact hardpoint** — `ref_contact_*`, the suspension ray's origin. Sits
**5.9 cm above** where the tyre actually meets the ground, so the ray's rest
length is measured from the empty while the wheel's visual position is measured
from the tyre. Not the same thing as a contact patch.

**Pure pursuit** — the bot driver's model: handed a point, closes on it.
Deliberately not a path follower — anything smarter belongs in whatever chooses
the point.

**Raycast vehicle** — the hand-rolled physics model: a chassis rigid body plus
four independent suspension rays, no physics engine. Roughly 200 lines, and it
keeps one source of truth for "where is the ground" and one substepping model.

**Ring** — the turret's yaw node, `ref_turret_base_rotate_yaw`. **The gunner's
aim frame is the ring's, not the chassis's** — a gunner holding a target keeps
holding it while the driver swerves underneath. The gunner's body parents to the
ring too, so they turn with the gun they are holding.

**Seat (vehicle)** — an entry in `CFG.vehicle.seats`, keyed to the rig's own
empties, declaring where the body sits, where the camera goes, and what the
occupant may do. Five on the Warthog: driver, gunner, passenger, two tailgate
riders. **Which seat you get is decided by which one you are standing nearest** —
no menu, no cycle key.

**Slip angle** — the input to the lateral tyre force, which **saturates at
μ·Fz**. The line between a vehicle and a sliding box: grip running out has to be
a consequence of load, not of a speed threshold.

**`retune()`** — re-derives the suspension constants *and* moves the strut top,
because ride height is a function of `travel` and `sag`. Exists so mass and ride
height stay independent knobs, which is the only reason they are hand-tunable.

---

## AI

**Calm** — the "am I under fire" test a bot uses before committing to an errand.
`shieldTimer` is the signal; `BIOFOAM.aiReviveCalm` is the window. A bot will
not kneel over a casualty in a firefight.

**Errand priority** — the fixed order a bot resolves non-combat work in:
**fight > pick someone up > resupply**. Fighting outranks first aid, which is
the ceiling on how many downs get answered.

**Fidelity tier** — how much simulation a combatant gets, by relevance: near the
human, near an active battle, distant active sector, or far/hidden. Transitions
must preserve position, health, objective state and credible outcomes — distant
AI must not become an unrelated spreadsheet.

**`replan`** — the TeamBrain's per-mode map weighting. Must score locked sectors
zero under a lattice, or the team masses squads on a point nobody can take.

---

## Repo and asset conventions

**`__save`** — the dev-server endpoint that writes a data-URL body to
`debug/X.jpg`. The headless screenshot loop: position the camera, **stop calling
`game.update()`** (the player controller owns the camera every frame), save,
read the file back.

**`FC`** — the debug handle on `window`: `{ game, deploy, renderer, launchMap(id) }`.
`FC.launchMap('demo'|'map3')` skips the menus.

**`npm run assets`** — sync then compress. Copies `source/` files the code
actually references into `public/`, then re-encodes textures to WebP and
quantizes geometry in place. Run it after every Blender export; skipping it
re-inflates the repo, and GitHub rejects anything over 100 MB.

**`public/`** — the Vite publicDir. Only what the code references, compressed.
**This is what ships.**

**Retarget** — the Mixamo animation remap in `assets.js`: strips `mixamorig`
prefixes, drops scale tracks, keeps hips-Y-only position. Tracks are cached by
bone-name signature, so marine variants off one rig cost a download rather than
a retarget.

**`source/`** — the local master kit. Everything ever exported, ~1.9 GB,
**excluded from git**, never compressed in place. The thing you re-derive
`public/` from.

**Tuning tab** — a live-slider page in `/chartest.html` that emits a paste-ready
config block. BACK (stowed gun), GRIP, VIEWMODEL, VEHICLE, SEAT, and DOOR when
it exists. **Locked as the project's method: build the UI, do not guess the
numbers.**

**`setTimeScale(n)`** — the fast-forward harness. `game.setTimeScale(8)` plus a
loop of `game.update(1/60)` makes 8× numerically identical to 8 real frames,
which is how every sim claim in the docs was measured.

---

## Pairs that get confused

These are the ones that have already caused a wrong reading, in a doc or in
code.

| | vs | |
| --- | --- | --- |
| **Combatant seat** — the slot a team is made of, 32 per side, holds class and score | | **Vehicle seat** — a place to sit in a Warthog |
| **Ticket** — a life, spent on death, counts *down* | | **Materiel** — a resource, made at HQ and hauled, spends on structures, **never a loss condition** |
| **`rules`** — which rule applies, frozen at match start, six call sites | | **`CFG`** — what the number is, read live, editable through `FC.cfg` mid-match |
| **Downed** — `alive === false`, recoverable, costs nothing yet | | **Dead** — costs a ticket, starts respawn |
| **Armor** — never regenerates, repair tool only, Engineer's layer | | **Shield** — regenerates itself after a delay, nobody's job |
| **`grip`** — third-person hand mount | | **`fp`** — first-person viewmodel offset |
| **Blueprint** — the Engineer-only ghost | | **Buildable** — the registry entry it instantiates | 
| **Locked** (decision label) — owner-decided | | **Locked sector** (lattice) — not currently capturable |
| **`ref_contact_*`** — the ray's hardpoint, 5.9 cm high | | **Contact patch** — where the tyre actually touches |
| **Front** — the end of a *contiguous* run | | **Highest sector owned** — the naive version, which silently creates two fronts |
| **`source/`** — the master kit, 1.9 GB, not in git | | **`public/`** — what ships, compressed |
| **Objectives: none** (Skirmish) | | **A degenerate lattice** — not the same thing, which is why they are two rules |

---

## Change log

### 2026-08-04

- Created. Terms pulled from `GAME_DESIGN_PLAN.md`, `CLASS_AND_GADGET_PLAN.md`,
  `GAME_TYPE_PLAN.md` and `VEHICLE_PLAN.md`, checked against `config.js`,
  `rules.js` and `logistics.js` rather than taken from the docs alone.
- Flagged the one place the docs and the build disagree: Frontline's economy is
  HQ-produced hauled materiel with a chain victory, not sector-second scoring.
