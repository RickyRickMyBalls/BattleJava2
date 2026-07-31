# Class, Loadout and Gadget Plan

Companion to `GAME_DESIGN_PLAN.md`, which stays the whole-game document. This one
covers only what a soldier *is* and what they *carry*, so it can be read on its
own.

## Decision labels

Same vocabulary as the parent doc, with one clarification that matters while this
plan is young:

- **Locked:** Owner-decided. Treat as a project requirement until deliberately revised.
- **Working:** Proposed and not yet owner-approved, or approved but unvalidated by play.
- **Open:** A decision is still required.
- **Long-term:** Intended future, not required for the first playable.

---

## The loadout

**Locked:** Every soldier, human or bot, carries exactly six selectable slots plus
one class perk that is not chosen:

| # | Slot | Chosen from |
| --- | --- | --- |
| 1 | Primary weapon | Class primary pool |
| 2 | Secondary weapon | Class sidearm pool, or overridden — see below |
| 3 | Gadget 1 — identity | Class identity pool |
| 4 | Gadget 2 — utility | Class utility pool + global gadgets |
| 5 | Grenade | Class grenade pool |
| 6 | Melee | Class melee pool |
| — | **Perk** | Fixed by class. Not a slot. |

**Locked:** Class identity comes from gadgets, perks and team responsibility — not
from primary weapon exclusivity.

**Working:** Gadgets are drawn from two *separate* pools rather than two picks
from one list. This is what stops a build doubling up, and it gives every class a
slot for its identity and a slot for its utility.

### The second weapon slot

**Locked:** Slot 2 holds the class sidearm by default. Certain gadgets replace it
with something better. This is one mechanic, not a set of per-class exceptions.

| Class | Slot 2 holds | Cost |
| --- | --- | --- |
| Any | M6 Magnum | Nothing |
| Assault | A second primary | Gadget 2 |
| Engineer | Rocket launcher or Spartan laser | Gadget 1 |
| Recon | Sniper rifle or DMR | Gadget 1 |
| Spartan | Any weapon in the armory | Free, by perk |

"Two weapons" is therefore never violated. What varies between classes is what
earned the right to sit in the second slot.

### Weapon tiering

**Working:** The armory is two tiers.

- **Standard** — any class may take one as its primary: assault rifle, battle
  rifle, SMG, shotgun.
- **Specialist** — never a primary. Reachable only by spending a gadget slot on
  the class that owns it, or by being a Spartan: sniper rifle, DMR, rocket
  launcher, Spartan laser.

The split is what allows broad primary access without erasing Recon. If the
sniper were a standard primary, every class would be a sniper and Recon's
identity gadget would be a downgrade rather than an upgrade.

### The sidearm

**Working:** The pistol is the default occupant of slot 2, not a guarantee.

Its distinguishing axis is **draw speed**, not damage or capacity — it is what you
reach for when a primary runs dry mid-fight, and it should lose a stand-up fight
against any rifle. Implemented as a per-weapon `swapTime`: 0.2 s for the Magnum
against 0.4 s for everything else.

**Open:** Only one sidearm exists, and Assault's only utility gadget is currently
a second primary — so Assault never carries a pistol in practice. The slot needs
either more classes that keep it, or more competing utility gadgets.

---

## Perks

**Locked:** Every class has one. A perk is fixed, not chosen, and does not consume
a slot.

Perks already exist in the codebase unnamed — the Spartan's `shield: 70` and
`jumpHeight: 3` are perks in everything but the label. Formalizing the concept
gives those ad-hoc class fields a home instead of letting one-off keys accrete.

**Working:** Two kinds.

- **Grant** — a free item or access that costs no slot. The Engineer's repair
  tool. The Spartan's slot-2 reach into specialist weapons.
- **Stat** — a passive modifier. Shield, jump height, build rate, and so on.

**Working — the rule that keeps this from becoming the balance problem:** *perks
grant utility, never lethality.* A free repair tool is fine because it kills
nobody. A free rocket would make "free" the strongest word in the game, and every
balance argument afterward becomes an argument about perks.

| Class | Perk | Status |
| --- | --- | --- |
| Engineer | Combat Engineer — free repair tool, exclusive blueprint placement, faster build and repair | **Locked** |
| Spartan | MJOLNIR — 70 shield, 3 m jump, any weapon in slot 2 | **Locked** (shield/jump already implemented) |
| Assault | — | **Open** |
| Support | — | **Open** |
| Recon | — | **Open** |

Candidates to react to, not proposals: Assault — faster biofoam, or a third
grenade. Support — larger reserve ammo, or self-resupply. Recon — faster ADS, or
invisibility to motion sensors.

---

## Gadgets

**Working:** Each gadget declares a `kind`, and the code branches on it rather
than on the gadget's identity:

- `consumable` — a charge spent on yourself (biofoam)
- `weaponSlot` — replaces the sidearm with a pick from a named pool (webbing)
- `tool` — a held device with a sustained effect (repair tool)
- `placeable` — a prop put into the world (crates)
- `passive` — always on (overshield)

### Global gadgets

**Locked:** Some gadgets are available to *every* class rather than being
class-locked. The repair tool is the first, so that any squad member can
contribute to fortifications.

**Working:** Globals join the **utility pool (slot 4) only.** Slot 3 is the class
identity slot — biofoam, launcher, long gun, grapple. If a global could go there,
an Engineer could drop the launcher for a repair tool and become a worse Assault.
Globals are utility by definition, so utility is where they belong.

**Working:** A class whose perk already grants a global gadget does not see it in
their pool. The Engineer carries the repair tool free, so it is removed from their
slot-4 options rather than offered as a pickable duplicate. Stated plainly, that
*is* the perk: everyone else spends a slot on the repair tool; the Engineer
doesn't.

---

## Construction

**Locked:** Building is a two-stage system with a hard split of authority.

1. **The Engineer places a blueprint.** A ghost of the structure, positioned and
   rotated. Engineer-exclusive — no other class can place one.
2. **Anyone with a repair tool builds it.** Build progress accumulates while the
   tool is applied. Multiple soldiers stack.

This is why globalizing the repair tool costs the Engineer nothing. They remain
the only class that decides *what* gets built and *where*; everyone else is
labor. The Engineer is the architect, not the bricklayer.

**Locked:** The Engineer builds faster than a non-Engineer, via the perk's build
multiplier.

### Repairing vehicles

**Locked:** The repair tool also repairs vehicles, and the Engineer is again
boosted. A regular soldier repairing a vehicle is deliberately *ineffective* —
enough to matter in a pinch, not enough to make Engineers optional.

**Open:** How ineffective? The gap has to be wide enough that a squad still wants
a real Engineer, and narrow enough that a soldier with a tool isn't wasting their
slot. A first guess of 0.3× the Engineer's rate is a number to test, not a
decision.

### Buildables

**Working:** Wall and turret stop being separate gadgets and become entries in a
`BUILDABLES` registry that the blueprint tool draws from. One tool with a menu,
rather than one gadget per structure.

This is strictly better than the earlier "buildable wall / buildable turret as two
gadget options" plan: adding a fifth structure later is a config entry rather than
a new gadget competing for a slot, and it frees the Engineer's utility slot for
something that isn't construction.

Starting set: barrier/wall, auto turret. `Turret_2.1.glb` and its loop/end audio
already exist in `source/`.

### The limiter problem

**Open — and this one needs an answer before construction is built, not after.**

With the repair tool global, all 64 combatants can build instead of the dozen or
so Engineers. That is roughly a 5× jump in worst-case runtime structures, and
runtime collision is the expensive kind here: the BVH in `collision.js` is baked
over static meshes, so every completed structure is a live cost rather than a free
one.

Blueprint placement is the natural throttle, since it is already Engineer-only.
Candidate limiters:

1. **Per-sector build budget** — a pool of points shared by the team, spent on
   placement, refunded on destruction.
2. **Personal cooldown per Engineer** — simplest, least interesting.
3. **Supply drawn from Support's ammo crate** — most interesting, because it makes
   two classes need each other, and it gives Support a job beyond ammunition.

Option 3 is the most attractive design and the most work. Option 1 is the safest
first implementation.

---

## Class roster

**Working:** Five classes. Only Assault exists in config today.

### Assault — take ground and hold it

| Slot | Options |
| --- | --- |
| Primary | AR, BR, SMG |
| Secondary | Magnum, or a second primary via webbing |
| Gadget 1 | Biofoam injector |
| Gadget 2 | Combat webbing · *needs more options* |
| Grenade | Frag |
| Melee | Rifle bash |
| Perk | **Open** |

Health does not regenerate while shields do — 45 shield regenerating, 55 health
not. That asymmetry is the entire reason this class exists: restoring health is a
scarce resource in a 32v32 grind, and no revive mechanic is needed to make the
role matter.

**Biofoam** locks the user for 1.2 s, then heals the full 55 at 22 HP/s while they
are free to move and shoot again. The lockout is the cost; a snap-heal would make
the commitment invisible.

**Combat webbing** trades the sidearm for a second weapon from the class's own
primary pool, at 0.6× reserve ammo on both. The reserve penalty is what makes the
webbing build want Support's ammo crate instead of being self-sufficient.

### Engineer — anti-vehicle, and the architect

| Slot | Options |
| --- | --- |
| Primary | Standard pool |
| Secondary | Rocket launcher or Spartan laser, via gadget 1 |
| Gadget 1 | Rocket launcher · Spartan laser |
| Gadget 2 | **Open** — freed by the buildables reframe |
| Grenade | Frag |
| Melee | Rifle bash |
| Perk | Combat Engineer — free repair tool, exclusive blueprints, faster build and repair |

Engineers *spawn with* heavy weapons rather than scavenging them. The gadget slot
is the cost: an Engineer carrying a launcher has given up their utility slot and
cannot also snipe.

### Recon — the only long range in the game

| Slot | Options |
| --- | --- |
| Primary | Standard pool |
| Secondary | Sniper rifle or DMR, via gadget 1 |
| Gadget 1 | Sniper · DMR |
| Gadget 2 | Spotting drone |
| Grenade | Smoke *(proposed)* |
| Melee | Rifle bash |
| Perk | **Open** |

The spotting drone is the most expensive gadget on this page — a controllable
second entity with its own camera and UI. Build it last.

### Support — logistics and sustain

| Slot | Options |
| --- | --- |
| Primary | Standard pool |
| Secondary | Magnum |
| Gadget 1 | Medical crate |
| Gadget 2 | Ammunition crate |
| Grenade | Frag |
| Melee | Rifle bash |
| Perk | **Open** |

**Open:** Both slots are currently fixed, so Support has no loadout decision at
all. It wants a third option to choose between. If construction supply comes from
the ammo crate, that alone may be enough to make the class interesting.

### Spartan — the elite

| Slot | Options |
| --- | --- |
| Primary | Standard pool |
| Secondary | Any weapon in the armory, free |
| Gadget 1 | Grapple |
| Gadget 2 | Jetpack |
| Grenade | Frag |
| Melee | Rifle bash — *energy sword is a long-term candidate* |
| Perk | MJOLNIR — 70 shield, 3 m jump, free specialist access in slot 2 |

**Open:** Grapple and jetpack are both movement, both expensive, and the jetpack
in particular breaks the heightfield-grounded movement model the whole simulation
rests on. The Spartan is also the most common class on the field at one in five
spawns. Shipping it with **overshield** as gadget 1 — cheap, canon, icon already
authored — would let the class exist in the first pass instead of blocking it,
with grapple and jetpack as v2.

---

## Bots

**Open, and it decides how much of this page is real.** Sixty-three of the
sixty-four combatants are bots. Gadgets they cannot use effectively do not exist
for most of the match.

- **Bots can plausibly use:** biofoam, weapon-gadgets (the range-band picker
  already handles two weapons), crates, repair tools on damaged vehicles.
- **Bots realistically will not use:** grapple, jetpack, spotting drone, and
  blueprint placement, which needs judgment about *where* a wall is useful.

The plan should say which gadgets the simulation genuinely runs on and which are
player-facing spectacle, rather than leaving it to be discovered later.

---

## Implementation status

**Landed** — commit `aaa3561`, config only, nothing consumes it yet:

- Six-slot schema on the Assault class; every other class keeps its legacy shape.
- M6 Magnum as a real weapon, with `swapTime` as the sidearm's distinguishing axis.
- Weapon tiering: `STANDARD_POOL`, `SPECIALIST_POOL`, `SIDEARM_POOL` driving `def.slot`.
- `GADGETS` gained `kind`; biofoam and combat webbing defined.
- `GRENADES` and `MELEE` registries.

**Designed, not built** — the armory panel: a six-card slot grid that drills into
a picker per slot, a `kind`-branching info panel, and one shared `validateLoadout`
replacing the duplicated class-switch check in `menu.js` and `deploy.js`.

**Not started** — every gadget behaviour, grenades, melee, construction, perks,
and the four unmigrated classes.

---

## Open decisions

1. What are the perks for Assault, Support and Recon?
2. What limits blueprint placement — sector budget, Engineer cooldown, or Support supply?
3. How ineffective is a non-Engineer repairing a vehicle?
4. What is Assault's second utility gadget, so webbing is a choice rather than a default?
5. What is Engineer's utility gadget, now that construction has left the slot?
6. Does Support get a third gadget so it has a decision to make?
7. Does the Spartan ship with overshield first, deferring grapple and jetpack?
8. Is one in five too frequent for the Spartan given its perk?
9. Which gadgets must bots be able to use?
10. Do blueprints decay if never built? Can they be destroyed by the enemy?
11. Does the second-primary gadget stay Assault-only, or extend to other classes?

---

## Change log

### 2026-07-31

- Split class, loadout and gadget design out of `GAME_DESIGN_PLAN.md`.
- Locked the six-slot loadout plus a class perk.
- Locked slot 2 as sidearm-by-default, overridable by gadgets.
- Locked heavy weapon access as loadout selection, reversing the earlier
  battlefield-pickup direction. Engineers spawn with launchers.
- Added melee as a universal slot; it had no prior entry anywhere.
- Added perks as a formal concept, absorbing the Spartan's existing shield and
  jump overrides.
- Added global gadgets, with the repair tool as the first.
- Defined construction as blueprint placement (Engineer-exclusive) plus repair-tool
  building (universal), and folded wall and turret from gadgets into a buildables
  registry.
