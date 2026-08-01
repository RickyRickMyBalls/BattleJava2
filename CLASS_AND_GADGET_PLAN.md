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
| Assault | Marathon — a larger stamina pool | **Locked** |
| Engineer | Combat Engineer — free repair tool, exclusive blueprint placement, faster build and repair | **Locked** |
| Support | Combat Lifesaver — picks up a downed soldier in a third of the normal time | **Locked** |
| Spartan | MJOLNIR — 70 shield, 3 m jump, unlimited stamina, any weapon in slot 2 | **Locked** (shield/jump already implemented) |
| Recon | — | **Open** |

Candidates for Recon, to react to rather than proposals: enemies it fires on stay
marked on the minimap far longer — which would give the class a job on day one,
since the spotting drone is the most expensive gadget on this page and will land
last. `spottedShooters` in `hud.js` already tracks exactly this with a 3 s TTL.
Alternatively a squad spawn beacon, which owns the reinforcement system outright
and is meaningfully more work.

### Two notes on the perk set

**Assault and Spartan now share an axis.** A larger stamina pool is a weaker
version of never running out, so as written the Spartan strictly dominates the
Assault on the perk that defines it. Worth differentiating: the cleanest split is
that Assault's perk is about *recovery* — stamina regenerates faster, and keeps
regenerating while still moving — while the Spartan's is about *capacity*. Then
the Assault is the class that keeps going all match and the Spartan is the one who
never has to think about it.

**Sector capture is still unowned.** It is the system that decides the match, and
no class touches it. Not an argument against stamina; just the largest remaining
gap in the roster.

---

## Stamina

**Locked:** A stamina system exists, and two perks are defined in terms of it.
Nothing of it is built — sprinting is currently unlimited.

**Working — what drains it:**

- **Sprinting.** The primary and obvious drain.
- **Carrying a downed soldier.** See casualty recovery below. This is what stops
  a body being hauled across the whole map for free.
- **Melee, and possibly jumping.** Open.

**Working — the shape:** a pool that depletes while sprinting and refills when
not. Emptying it drops the sprint multiplier rather than stopping movement, so
running out slows you down instead of freezing you.

| Class | Stamina |
| --- | --- |
| Spartan | Unlimited — never depletes |
| Assault | Larger pool, and faster recovery |
| Everyone else | Baseline |

**Open — do bots model stamina?** Sixty-three of the sixty-four combatants are
bots. If they sprint without limit while the player cannot, the player is the only
one paying for a system everyone appears to share. Either bots respect it, or the
difference has to be small enough not to read.

**Open — how visible is it?** A stamina bar is another permanent HUD element. The
alternative is making it audible and felt (breathing, a slowing camera) with no
readout, which suits the tone but makes it harder to play around.

Interaction worth noting: if carrying drains stamina, the Spartan becomes the
best evacuator on the field while Support is the fastest at the pickup itself.
That is a clean division — **Support gets them up, Spartan gets them out** — but
it is emergent rather than designed, so it should be a deliberate decision rather
than a surprise.

## Armor — the third layer

**Locked:** Soldiers carry an **armor** layer in addition to shields and health.
It behaves like a shield in that it absorbs damage as a pool, and unlike a shield
in the way that matters: **it does not regenerate.** The only way to restore it is
for someone to work on it with a repair tool.

**Working — the damage order,** outermost inward:

```
shield  ──>  armor  ──>  health
```

### Why this is the strongest idea in the plan so far

Each layer is now owned by a different class, and none of them overlap:

| Layer | Regenerates | Restored by | Class |
| --- | --- | --- | --- |
| Shield | Yes, after a delay | Itself | Nobody |
| Armor | **No** | Repair tool | **Engineer** |
| Health | **No** | Biofoam, medical crate | **Assault**, Support |

That solves a problem the Engineer had and this plan had not yet named: the class
was anti-vehicle plus construction, with **nothing to offer a squad of infantry in
a firefight**. Now an Engineer at the front line is repairing people's plating
between engagements. The repair tool goes from two jobs to three — build, repair
vehicles, repair armor — and becomes the most useful object in the game, which is
a good reason it is a global gadget rather than a class-locked one.

It is also the third system to follow the house pattern: anyone with a repair tool
can patch armor, and the Engineer does it markedly faster.

### The attrition curve this creates

Because armor never comes back on its own, a soldier who has been fighting for ten
minutes is progressively more fragile even at full shields. A push that goes long
gets genuinely more dangerous rather than resetting to full strength every time
shields recharge. That is a real attrition model, and it creates standing demand
for Engineers forward rather than parked on vehicles.

### The tuning warning

**Working, and important:** every weapon in `config.js` is tuned against 100
effective HP — 45 shield plus 55 health. Adding armor *on top* of that inflates
every time-to-kill in the game proportionally. Armor of 40 would be a 40% TTK
increase across the entire armory, which is not a tuning tweak but a full re-tune.

**Strong recommendation: carve armor out of the existing budget rather than adding
to it.** For example 35 shield / 25 armor / 40 health, keeping the total at 100.
The whole weapon table stays valid, and the change is about *how* damage is
absorbed and who restores it — which is the interesting part — rather than about
soldiers becoming spongier.

### Per class

**Working:** Armor is a natural per-class stat, following the same pattern
`maxShield` already uses. Spartans should carry noticeably more of it — MJOLNIR is
literally the armor — and it is a better expression of the Spartan's durability
than simply raising the shield number again.

### Open

- Does a soldier respawn with full armor? Presumed yes, making armor a per-life
  resource that degrades across that life.
- Does damaged armor show on the character model? The parent design plan already
  parks "dynamic battle damage" as an idea; this would be a reason to build it.
- The HUD carries two bars today. A third needs a place, or armor and shield need
  to share one bar in two tones.
- Do bots repair each other's armor? If not, bot armor is only a flat TTK increase
  and none of the interesting attrition applies to 63 of the 64 combatants.
- Does the repair tool need a supply or charge, now that it does three jobs? This
  connects to the build-limiter question.

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

The repair tool now does three jobs — build blueprints, repair vehicles, and
restore armor — which makes it the most broadly useful object in the game and is
the clearest argument for it being global rather than class-locked. The Engineer
is faster at all three.

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

## Downed state and casualty recovery

**Locked:** Soldiers do not die instantly. A soldier who runs out of health goes
**down** — collapsing to the ground, out of the fight but not gone — and any
teammate carrying biofoam can pick them up.

**Locked:** Any *teammate*, not any squadmate. Squads are four, the window is
sixty seconds, and tying recovery to three specific people would leave most
downs unanswerable on a field of thirty-two. It also gives the bot policy a
simpler question to ask: nearest downed friendly, not nearest downed friendly in
my squad.

| | |
| --- | --- |
| Bleedout | 60 s |
| Pickup time | 5 s · **1.67 s** for Support |
| Charge cost | 1, spent **on completion** |
| Recovered health | 50% |
| Give up | Any time |

This is the largest unbuilt feature in the plan. It touches the damage model, the
animation set, the HUD, the ticket economy and the AI, so it is closer to a
system than a feature and may deserve its own document once it is real.

### The state machine

```
alive ──damage──> downed ──60 s bleedout──> dead
                    │   │
                    │   └──give up, any time──> dead
                    └──picked up──> alive (partial health)
```

**Locked:** The bleedout window is **60 seconds**, as `CFG.downed.bleedout` — a
number to re-tune after the first fast-forward battle rather than before it.

### Biofoam is the currency

**Locked:** A pickup **spends one biofoam charge**, taken from the soldier doing
the picking up. Every soldier carries 3, Support carries 15. Both numbers already
exist in `BIOFOAM` in `config.js`; what is new is that revives draw on them.

This is the decision that makes the rest of the system pay for itself, and it is
worth being explicit about why, because the plan previously only implied it:

- **Three charges is a budget, not a formality.** Picking someone up competes
  directly with patching yourself, out of the same small pool. Every pickup is a
  bet that you will not need that charge in the next minute.
- **Support's 15 is a logistical identity rather than a stat line.** Support is
  the class that can keep saying yes.
- **The ammo crate becomes the revive economy's refill,** which points Support's
  two pieces of kit at the same job from two directions.

Support therefore holds two *orthogonal* advantages — faster by perk, richer by
ration — rather than one advantage counted twice.

**Locked:** The charge is spent **on completion**, not on starting. An attempt
broken off — by gunfire, by moving away, by the casualty bleeding out under your
hands — costs nothing but the time.

That makes time-under-fire the real currency of a contested pickup, and the
charge the currency of a successful one. Trying twice is free; the danger is
that you spent ten seconds kneeling in the open to do it. It is the softer of the
two options, and it is the right one to ship first: spend-on-start punishes
exactly the brave, doomed attempt the system exists to create, and it is far
easier to tighten a rule after watching people play than to loosen one they have
already learned to fear.

The consequence to watch is that three charges now bound how many people you
*save*, not how many times you try. If pickups turn out to be near-guaranteed in
practice, the ration stops being a budget and the tension this section is built
on goes quiet.

### The two recovery actions

**Locked as design, deferred in build.** A squadmate can either drag a downed
soldier or carry them, and the choice is a real one because the two differ in
what your hands are doing.

| | Drag | Carry |
| --- | --- | --- |
| Speed | Slow | Faster |
| Hands | One free | Both busy |
| Can heal while moving | **Yes** | No |
| Can shoot | No | No |

**Drag** is committing to the spot: you pull them a few metres into cover and heal
them where they lie, still in the fight's radius. **Carry** is committing to
leaving: you get them out fast and you are defenceless the whole way.

That asymmetry is the mechanic. Anything that blurs it — letting a carrier heal,
or making dragging fast — collapses the decision.

Neither ships first. Both need animation at both ends of an attachment between
two soldiers, and none of those clips exist. See the build order below: phase 1
is the stationary pickup, which needs no new authoring at all and proves the loop
that drag and carry are variations on.

### Class involvement

**Locked:** Recovery is universal. Any soldier holding a charge can pick a downed
teammate up, and it takes **5 seconds**. Support's perk is that they do it in **a
third of the normal time** — 1.67 seconds. Three times faster, not 30% faster.

Note the wording, because the plan carried both readings for a while and they are
not the same number. `PERKS.combatLifesaver` declares `reviveRate: 3` and its own
description already said "a third of the normal time", so a third is what the code
does: 5 / 3 = 1.67, not the 1.5 that "30%" implies. Keeping the perk's single
constant and quoting the number it actually produces is worth more than the 0.17 s
— the alternative is a second constant that has to be kept in agreement with the
first, which is exactly what deriving Support's figure was meant to avoid.

Five seconds is long enough that where you kneel is a decision. Support's 1.67 is
short enough to attempt in the open, which is the whole difference between a
class that can recover people and a class that can recover people *now*.

This is the second appearance of a pattern worth naming, because it is becoming
the plan's house style:

> **Universal action, class-boosted.** Everyone can do the thing; one class does
> it markedly better. Construction works this way — anyone builds, the Engineer
> builds faster and alone places blueprints. Casualty recovery works this way —
> anyone revives, Support is far quicker.

It keeps every player able to participate in a system, while still making the
specialist worth a squad slot. Worth applying deliberately to the next system
rather than rediscovering it.

### Bleeding out, and giving up

**Locked:** A downed soldier may give up at any moment and take the normal
respawn.

That release valve is not a convenience, it is what makes 60 seconds legible.
`CFG.soldier.respawnDelay` is 5 and `CFG.player.respawnDelay` is 6, so a down
that nobody answers is a *strictly worse* outcome than a clean death — 66 seconds
back into the fight instead of six. With the give-up key live from the first
frame, the 60 seconds stops being a punishment and becomes a ceiling on hope: you
hold on as long as you believe someone is coming, and you let go when you don't.

Take the give-up key away and the number has to come down to somewhere near the
respawn delay, which would delete the drama the system exists to create.

### Being downed, from the inside

**Locked:** A downed soldier can **look around** — the camera on the ground, free
to turn — and the bleedout is shown as a **vignette that closes in** as the timer
runs down.

This is the best idea in the section, because it collapses two problems into one
image. Looking around is what makes the sixty seconds playable rather than a
loading screen: you watch the fight continue without you, you see whether anyone
is coming, and the give-up key becomes a judgement about what you can actually
see rather than a guess against a number.

And the vignette *is* the timer. No countdown, no bar — the world narrowing until
it closes is a readout you feel instead of read, and it does the thing a numeral
cannot, which is make the last ten seconds worse than the first ten. It also
means the HUD gains a shader effect rather than a widget, and the downed state
needs no new HUD chrome at all.

Two things fall out of it worth writing down now:

- **The vignette must lift the moment a pickup completes,** not fade on its own
  schedule. It is the state readout, so it has to be as truthful about being
  saved as it is about dying.
- **It should not close fully to black before the timer ends.** Leaving a small
  aperture keeps the last seconds legible — the point is dread, not blindness,
  and a player who cannot see the teammate sprinting toward them has lost the
  only thing the state has to offer.

**Locked:** A downed soldier can **call for help**, and it is not a cosmetic
shout — a live call makes bots travel `callRangeMult` further to answer it, so a
casualty who calls genuinely improves their own odds. It is the only agency the
state has, and without a mechanical payload it would be a button that plays a
noise.

Calls expire after 8 seconds. That is deliberate: bots call out automatically a
beat after they go down, so a busy field sorts itself into fresh casualties who
are shouting and older ones who are not, and the loudest marker on screen is
always the most recent. A permanent call would make every body shout equally,
which is the same as none of them shouting.

### Finding the casualties

**Locked:** Recovery being open to the whole team is worth nothing if you cannot
tell who is down. The pickup prompt only reaches `reviveRange` — 2.4 m — so
without this a player finds a casualty by tripping over one, and the generosity
of "any teammate" is theoretical.

Three readouts, each answering a different question:

| Readout | Answers |
| --- | --- |
| World marker, drawn through geometry | *Where do I go?* |
| Minimap cross, ringed while calling | *Is anyone down near me at all?* |
| Squad row, bar showing bleedout | *Do I have time, and who is it?* |

The markers deliberately ignore line of sight. A marker you can only see when
you already have eyes on the body tells you nothing you did not know, and the
entire job here is finding people you *cannot* see. They clamp to the screen
edge when off-view, so a marker degrades into a direction rather than vanishing,
and cap at `markerMax` — with 25 bodies on the ground in a heavy push, drawing
every one of them would be wallpaper rather than information. Calls sort above
distance for that cap, so a soldier shouting is never the one culled for a
silent body two metres nearer.

**Locked:** A recovered soldier stands up on **50% health**, no shield, and keeps
whatever biofoam charges they were carrying. Half a bar is enough to fight with
and thin enough that the reviver's next instinct is to spend a second charge
patching them — which is the pairing this whole economy is built to produce.

### Tickets

**Locked:** A ticket is spent **only when a soldier actually dies** — bleeding
out, giving up, or being finished. Going down costs nothing, and a pickup refunds
nothing, because nothing was taken.

Going down is not a loss yet, and the ticket count should not claim it is. This
also keeps the existing code honest: `onKill` in `game.js` already does
`tickets -= 1` in one place, and that line simply moves to the death path rather
than being split across a deduction and a refund that have to stay in agreement.
No limbo state, no double-refund bug, no reconciliation when a body is recovered
after the match-end check has already run.

The cost is that the ticket counter now reads **confirmed losses**, not current
casualties, and with a 60-second window it can trail the fight by up to a minute.
A team can be losing badly for a minute before the scoreboard admits it. That is
worth watching once the system runs — if the readout feels unresponsive in a
heavy push, the fix is a second HUD number for downed-but-not-dead rather than
touching the ticket rule.

### What bypasses the downed state

**Working:** One rule rather than a list of damage types — an **overkill margin**.
If the killing blow carries health past zero by more than about half the health
bar, the soldier dies outright. `CFG.downed.gibMargin`.

That single number covers headshots, rockets and point-blank shotguns without
special-casing any of them, and `takeDamage` already computes the overflow it
needs. Tune the margin up if downs feel too rare, down if every kill feels
provisional.

**Enemies finishing a downed soldier** then needs no mechanic of its own: further
damage kills, because the overkill margin is trivially exceeded against a soldier
already at zero. Going down inside an enemy push should almost never survive, and
this gets that for free.

**Locked:** Biofoam does **not** work on yourself while downed. Three charges
would otherwise be three free self-revives and the pickup would never fire — the
charge is what you spend on other people.

### Bots

**Working:** Bots go down, and bots pick each other up.

Anything else makes this a player-only novelty across 63 of the 64 combatants,
and — as the Bots section below argues — a bot that dies outright while players
go down and get recovered is not running the same game the player is.

The policy is cheaper than it sounds, because the template already exists.
`_updateBiofoam` in `soldier.js` uses `shieldTimer` as its "am I under fire"
signal to decide when to spend a charge on itself; the revive decision is the
same shape with a different target — nearest downed *teammate* inside a radius,
calm for a couple of seconds, holding a charge, so go stand over them.

### Build order

**Phase 1 — the stationary pickup. No new animation.** Hold a key over a downed
teammate for 5 seconds, pay a charge, and they stand back up on half health.

Nothing in that needs a new clip. The downed idle is `death1`/`death2` frozen at
its last frame, which is already how bodies lie; the first-person treatment is
the camera dropped to roughly 0.4 m with a limited yaw; the reviver plays its
normal idle. Every animation this section originally called for belongs to drag
and carry, which is exactly why they are phase 2.

What phase 1 touches:

- **`config.js`** — a `CFG.downed` block: `bleedout: 60`, `reviveTime: 5`,
  `reviveHealth: 0.5`, `gibMargin`, `camHeight`, and an `enabled` flag. `BIOFOAM`
  gains the pickup cost and the AI's revive radius. Support's 1.67 s is not a
  second constant — it is `reviveTime` divided by the existing
  `PERKS.combatLifesaver.stats.reviveRate`, which is already 3.
- **`soldier.js`** — `die()` branches into `goDown()`; `downed` and `downTimer`
  fields; the existing `!alive` early-return in `update()` runs the bleedout; an
  `_updateRevive` sitting alongside `_updateBiofoam`.
- **The `alive` audit** — the one thing to get exactly right, and it is small:
  45 reads of `.alive` across 7 files. Downed soldiers keep `alive === false`, so
  every "is this a live combatant" check — targeting, capture counts, HUD — stays
  correct untouched. Then opt them back in at the four places that should see
  them: the three filters in `combat.js` so they can be finished, and the AI
  respawn check in `game.js` so a body that is still recoverable is not recycled.
- **`game.js`** — `onKill` splits into `onDown`, which touches neither tickets nor
  the respawn timer, and `onDeath`, which keeps the existing `tickets -= 1` and
  the respawn path unchanged. A `revive()` that stands the soldier back up.
- **`player.js`** — the downed camera: dropped to the ground, free to look, no
  weapon, no movement. Plus the give-up key.
- **The deploy screen** — the one place phase 1 touches existing screen flow, and
  the easiest thing to get wrong. `onKill` currently sets `playerDead` and calls
  `deployScreen.show('dead')` in the same breath. A downed player is not dead:
  the deploy screen must stay shut, the pointer lock must stay held, and both
  only happen when the player gives up or bleeds out.
- **`hud.js`** — the bleedout vignette, and a prompt over nearby downed friendlies.
  No countdown widget; the vignette is the readout.

**Phase 2 — drag and carry.** The attachment between two soldiers, coupled
movement, healing while dragging, and the clips at both ends of both actions.
This is a larger authoring job than any single feature in this plan so far, and
it should not gate the loop.

Ship phase 1 behind `CFG.downed.enabled` specifically so the same battle can be
fast-forwarded both ways and the ticket curves compared. Whether bot pickups are
common or rare is not predictable on paper, and it is the difference between
match length doubling and nothing changing.

### First measurements

Phase 1 is built. Demo map, 150 simulated seconds, **three runs per condition**,
means with the spread across runs:

| | off | on |
| --- | --- | --- |
| Live combatants at the end | 53 (51–56) | **37** (31–41) |
| Deaths | 172 (130–204) | **130** (123–140) |
| Tickets lost | 215 (159–254) | 180 (173–190) |
| Downs | — | 129 |
| Pickups | — | 28 (**22%** of downs) |

**Read the spread before the means.** This sim is stochastic and the run-to-run
variation is large — a single run per condition says almost nothing, which an
earlier draft of this table learned the hard way by reporting a 31% ticket drop
that three runs will not support. State ranges here, always.

**The one clean result: the field runs about 30% emptier.** 37 live combatants
against 53, and the two ranges do not overlap. A casualty occupies a body for up
to 60 seconds where a death recycled it in 5, so at any moment a third of each
army is on the ground. That is the real change this system makes, and it is a
change to what a firefight *feels* like, not just to arithmetic.

**Tickets: directionally down, not yet separable.** The means say −16%, but the
off-condition range (159–254) swallows the on-condition range (173–190). What
can be said is that the bleed does not *rise*, and that it is far steadier with
the system on — which makes sense, since downs put a 60-second buffer between a
firefight and the ticket it eventually costs. Worth re-measuring over more runs
before any match-length re-tune leans on it.

**One down in five gets answered**, and that held steady at 22% before and after
calling for help was added — calls change *who* gets picked up, not how many. The
ceiling is that a bot needs no target and two calm seconds before it will go, and
in a 32v32 grind a bot nearly always has a target. `BIOFOAM.aiReviveCalm` and the
"fighting outranks first aid" rule in `_think` are the two knobs. Loosening
either is a balance decision rather than a bug fix.

### Open questions, in order of how much they change

**1. Can a downed soldier crawl?** Looking around is locked; moving is not.
Crawling is the one that changes tactics — it lets a casualty close half the gap
to cover and makes the pickup safer to attempt — and it is also the one that
needs a clip, which is why it sits closer to phase 2 than the rest of the downed
treatment.

**2. Does carrying drain stamina?** Assumed yes in the stamina section above,
which is what makes the Spartan the natural evacuator. Needs confirming, since it
is the main link between the two new systems. Phase 2.

**3. Does a downed body still contest a sector?** Sector counts read `alive`
today, so the default answer is no, and it is worth confirming that a squad wiped
inside a capture zone loses the point before its bleedout runs out.

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
| Perk | Marathon — larger stamina pool, faster recovery |

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

The free repair tool is effectively a **third gadget**: every other class spends a
utility slot to carry one, and the Engineer does not. That is the perk stated in
its most useful form.

With armor as a repairable layer, the Engineer finally has a reason to be forward
with the infantry rather than parked on a vehicle or a wall. Between engagements
they are the class that puts everyone's plating back on.

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
| Perk | Combat Lifesaver — picks a downed soldier up in a third of the normal time |

Support owns the casualty system. Recovery is universal, but Support picks someone
up in 1.67 seconds against everyone else's 5, and carries 15 biofoam charges
against everyone else's 3. Fast enough to do it in the open, and rich enough to
keep saying yes — which is what makes a squad want one when people start going
down.

**Open:** Both gadget slots are fixed, so Support has no loadout decision at all.
It wants a third option to choose between. If construction supply comes from the
ammo crate, that alone may be enough to make the class interesting.

### Spartan — the elite

| Slot | Options |
| --- | --- |
| Primary | Standard pool |
| Secondary | Any weapon in the armory, free |
| Gadget 1 | Grapple |
| Gadget 2 | Jetpack |
| Grenade | Frag |
| Melee | Rifle bash — *energy sword is a long-term candidate* |
| Perk | MJOLNIR — 70 shield, 3 m jump, unlimited stamina, free specialist access in slot 2 |

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
- **Bots must be decided on, not deferred:** stamina and casualty recovery. These
  two differ from the gadgets above because they are not optional equipment — they
  change the movement and death rules for every combatant. A bot that sprints
  forever while the player tires, or that dies outright while players go down and
  get revived, is not running the same game the player is. Casualty recovery is
  now answered — bots go down and pick each other up, on a policy shaped like the
  biofoam one they already run. Stamina is still open.

The plan should say which systems the simulation genuinely runs on and which are
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

**Landed** — casualty recovery, phase 1. `CFG.downed`, the third soldier state
with its bleedout, the stationary pickup on both sides (player holds E, bots walk
to their nearest casualty), the ground camera and closing vignette, give-up on a
held SPACE, and finishing a casualty with any further damage. Behind
`CFG.downed.enabled`. No new animation clips: the downed pose is the existing
death clip held at its last frame.

**Not started** — every gadget behaviour, grenades, melee, construction, perks,
stamina, armor, drag and carry (casualty recovery phase 2), and the four
unmigrated classes.

Three of those are new *systems* rather than content, and they are what will move
the schedule: stamina changes the movement rules for all 64 combatants, armor
changes the damage model and the weapon tuning, and casualty recovery changes the
death rules, the ticket economy and the animation set at once.

Of the three, **armor is the cheapest by a wide margin** — a third pool on the
soldier, a subtraction in the damage path, one HUD bar and a repair verb. It has
no new animations and no AI decisions. If you want one of these systems in early
to prove the direction, it is that one.

Casualty recovery is no longer all-or-nothing, though. Splitting it into a
stationary phase-1 pickup and a phase-2 drag-and-carry moves the animation set —
the expensive half — out of the first pass entirely, which puts phase 1 much
closer to armor's cost than to the system's. The ticket economy still re-tunes
around it, which is what the `enabled` flag is for.

---

## Open decisions

Ordered by how much each one changes if answered differently.

**Match-shaping**

1. Is armor carved out of the existing 100 EHP budget, or added on top? Added on
   top means re-tuning every weapon in the armory.
2. Measured: the field runs ~30% emptier, and ticket bleed is directionally down
   but not separable from run-to-run noise at three runs — see First
   measurements. Two things left: re-measure tickets over more runs, and decide
   whether a thinner firefight is the game you want. If not, the levers are the
   bleedout length, the AI's willingness to answer, and the ticket count.
3. Do bots repair each other's armor, and do bots model stamina?
4. What limits blueprint placement — sector budget, Engineer cooldown, or Support
   supply? Now also: does the repair tool need a supply at all, given three jobs?

**System detail**

5. Can a downed soldier crawl? (Calling for help is answered — it is built.)
6. Does a downed body still contest a sector?
7. Does carrying drain stamina? It is the main link between the two new systems.
8. How ineffective is a non-Engineer repairing a vehicle?
9. Do blueprints decay if never built? Can enemies destroy them?
10. Is stamina shown as a bar, or only felt?

**Roster gaps**

11. What is Recon's perk?
12. What is Assault's second utility gadget, so webbing is a choice rather than a
    default? Without it, Assault never carries the Magnum.
13. What is Engineer's utility gadget, now that construction has left the slot?
14. Does Support get a third gadget so it has a loadout decision at all?
15. Does anything own sector capture?
16. Does the Spartan ship with overshield first, deferring grapple and jetpack?
17. Is one in five too frequent for the Spartan, now that its perk includes
    unlimited stamina on top of shield, jump and free specialist access?
18. Does the second-primary gadget stay Assault-only, or extend to other classes?

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
- Added stamina as a system, with Assault (larger pool) and Spartan (unlimited)
  perks defined against it.
- Added the downed state and casualty recovery: soldiers go down rather than dying
  outright, and a squadmate can drag them — slow, one hand free, can heal — or
  carry them — faster, both hands busy. Support recovers them in 30% of the normal
  time.
- Named the house pattern construction and casualty recovery follow: universal
  action, class-boosted.
- Made biofoam the currency of casualty recovery: a pickup spends one charge, out
  of the same 3 every soldier carries and the 15 Support carries. Reviving now
  competes with healing yourself, and Support's advantage is two orthogonal
  things — faster by perk, richer by ration — rather than one counted twice.
- Locked the bleedout window at 60 seconds, with give-up available from the first
  frame. Against a 5-6 second respawn, an unanswered down has to be something you
  can choose to end, or the number is a punishment rather than a ceiling on hope.
- Locked out self-revive: biofoam does not work on yourself while downed, or three
  charges become three free self-revives and the pickup never fires.
- Locked tickets: one is spent only when a soldier actually dies. Going down costs
  nothing and a pickup refunds nothing, which keeps `tickets -= 1` in the single
  place it already lives instead of splitting it into a deduction and a refund
  that must stay in agreement. The counter now reads confirmed losses rather than
  current casualties, and may trail a heavy push by up to a minute.
- Answered the other two of the section's six open questions. One overkill margin
  replaces a list of damage types that bypass the down, and it gives finishing a
  downed enemy for free. Bots go down and pick each other up, on a policy shaped
  like the biofoam one they already run.
- Split the build in two: a phase-1 stationary pickup that needs no new animation
  clips at all, and a phase-2 drag-and-carry that carries the whole authoring
  cost. The first pass is now nearer armor's price than the system's.
- Locked the recovery numbers: 5 seconds to pick someone up, 1.67 for Support,
  50% health on standing back up. Support's figure is not a second constant —
  it falls out of `reviveTime` over the `reviveRate: 3` the perk already declares,
  which is also why the perk is now quoted as "a third" everywhere rather than
  "30%". The two are not the same number, and the code does the former.
- Locked the charge as spent **on completion**. A broken-off attempt costs only
  time, which makes time-under-fire the currency of a contested pickup and the
  charge the currency of a successful one. The softer of the two rules, chosen
  deliberately: spend-on-start punishes exactly the brave doomed attempt the
  system exists to create, and tightening later is easier than loosening.
- Locked recovery as open to **any teammate**, not any squadmate. Squads are four
  and the window is sixty seconds; most downs would otherwise be unanswerable.
- Locked the downed player's view: free to look around, with the bleedout shown
  as a vignette closing in rather than a countdown. The vignette *is* the timer,
  so the state needs no new HUD chrome — and it makes the last ten seconds feel
  worse than the first ten, which a numeral cannot do.
- Noted the deploy screen as the one place phase 1 touches existing screen flow:
  `onKill` currently sets `playerDead` and opens the deploy screen together, and
  a downed player is not dead.
- Added findability, without which "any teammate can pick you up" was theory: a
  world marker drawn through geometry, a minimap cross, and a squad row showing
  bleedout rather than health. Markers clamp to the screen edge so an off-view
  casualty degrades into a direction, and cap at `markerMax` so 25 bodies do not
  become wallpaper.
- Locked calling for help, with a mechanical payload rather than a noise: a live
  call makes bots travel `callRangeMult` further, and sorts that casualty above
  nearer silent ones. Calls expire after 8 s and bots raise one automatically a
  beat after going down, so a busy field sorts into fresh casualties shouting and
  older ones quiet.
- Re-measured over three runs per condition and corrected the First measurements
  table. The single-run 31% ticket drop reported earlier does not survive; the
  clean result is that the field runs ~30% emptier. Record ranges, not points.
- Added armor as a third damage layer between shields and health. It does not
  regenerate and is restored only by a repair tool, which gives each of the three
  layers a distinct owner — shields regenerate themselves, Engineers restore armor,
  Assault and Support restore health — and finally gives the Engineer a reason to
  be forward with the infantry.
