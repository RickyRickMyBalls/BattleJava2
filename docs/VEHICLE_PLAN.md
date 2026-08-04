# Vehicle Plan — the Warthog

Companion to `GAME_DESIGN_PLAN.md` (the whole-game document),
`CLASS_AND_GADGET_PLAN.md` (what a soldier is and carries) and
`GAME_TYPE_PLAN.md` (what the match is). This one covers only **what a vehicle
is** — the physics, the seats, the crew, and how bots use one — so it can be
read on its own.

It is written around the Warthog because the Warthog is first and because it is
the hardest of the wheeled vehicles: four independent suspension corners, three
crewed seats plus riders, a manned turret, and a body that has to feel like it
weighs three tonnes. Anything that can carry the Warthog can carry the Mongoose
and the Scorpion. The doc names the general seam wherever one exists, but it
does not design the Pelican — air is a different problem and gets its own pass.

## Decision labels

Same vocabulary as the sibling docs.

- **Locked:** Owner-decided, or built and verified. Treat as a project requirement until deliberately revised.
- **Working:** Proposed and not yet owner-approved, or approved but unvalidated by play.
- **Open:** A decision is still required.
- **Long-term:** Intended future, not required for the first playable.

---

## The thing being built

**Locked — the rule that decides borderline cases:**

> The Warthog is a **physics object you drive**, not a camera on rails that
> plays a driving animation.
>
> Take: mass, momentum, weight transfer, four independent suspension corners,
> grip that runs out, air time, and a chassis that can end up on its roof.
>
> Leave: fixed-speed waypoint following, snapping to terrain normals,
> "arcade" as an excuse for a box that slides.

This is the expensive call and it is made deliberately. The Warthog's whole
identity in its source material is the *handling* — the slide, the bounce, the
gunner hanging on. A vehicle that merely translates across the map at 20 m/s
would cost a tenth as much and would be worth less than nothing, because it
would make the map smaller without making it more fun.

The corollary is that Phase 2 is the phase that matters. Everything after it is
addition; if the chassis does not feel right, nothing built on top rescues it.

---

## What is already true

**Locked.** Phase 1 shipped and was verified in-engine. These are measurements,
not intentions, and the rest of the plan is built on them.

### The model is authored in metres

| Quantity | Measured | Real-world reference |
| --- | --- | --- |
| Overall extent (incl. turret, hooks) | 3.07 W × 3.47 H × 6.26 L m | — |
| Body mesh alone | 2.86 W × 2.29 H × 5.60 L m | ~3.2 × 2.2 × 5.8 m |
| Wheelbase | 3.948 m | — |
| Track | 2.42 m | — |
| Wheel radius | 0.631 m | — |

Verified against a 1.86 m marine standing beside it: head at the top of the
windshield, hood at chest height. **The model needs no scale normalization, and
map-3's architecture agrees with it.** This is why `prepareVehicle` in
`assets.js` deliberately does *not* normalize vehicles the way it normalizes
characters (to a measured height) and weapons/props (to a measured length) — a
vehicle's real-world size is a fact about the model, not a design number we own,
and normalizing would hide a mis-scaled export instead of showing it.

### The model is -X forward, +Y up

Confirmed three ways: the baked 180° Y rotations that put `headlight` and
`engine_body` at x ≈ −3.1 while `breaklight` sits at x ≈ +2.44; the Pelican's
`asset.json`, which documents the same convention for the air-vehicle intake
lane; and visually, in-engine, after the correction.

The loader turns this onto the **+Z-forward, +Y-up** convention the soldiers and
the AI already use, inside a nested group so that `wrapper.rotation.y` stays a
plain world yaw no caller has to reason about. After correction the contact
refs read:

```
front_left  [ +1.21, 0.059, +1.974 ]     rear_left  [ +1.21, 0.059, -1.974 ]
front_right [ -1.21, 0.059, +1.974 ]     rear_right [ -1.21, 0.059, -1.974 ]
```

Front on +Z and left on +X — exactly what `forward × up` gives for a +Z/+Y rig,
so the rig's naming is internally consistent and every `ref_*` in it can be
trusted.

### The contact empties are hardpoints, not contact points

`ref_contact_*` sits **5.9 cm above** where the tyre geometry actually meets the
ground. Predicted from the GLB (`ref_steer` is 0.572 above `ref_contact`, wheel
radius is 0.631) and confirmed in-engine. The loader therefore grounds off the
**wheel meshes**, not the empties.

Phase 2 must not quietly re-inherit this error: the suspension ray's rest length
is measured from the empty, but the wheel's visual position is measured from the
tyre.

---

## The rig contract

**Locked.** `warthog-v3.glb` carries **no animation clips**. Every moving part is
a named empty and code drives all of it. That is the contract between the
Blender file and the runtime, and it is the reason a vehicle is cheap to add
once the system exists.

| Purpose | Nodes | Driven by |
| --- | --- | --- |
| Chassis root / pivot | `ref_warthog_root` → `ref_body_rotation` | Phase 2 |
| Wheel corners | `ref_contact_*` → `ref_steer_*` → `wheel_*` → `rim_*` | Phase 2 |
| Suspension linkage | `ref_sus_arm_{FL,FR,RL,RR}.001–.004`, `ref_sus_spring_*` | Phase 4 |
| Seats | `ref_seat_driver`, `ref_seat_passenger` | Phase 5 |
| Seat cameras | `ref_camera_driver`, `ref_camera_passenger`, `ref_camera_gunner` | Phase 2 (driver), Phase 5 (rest) |
| Turret | `ref_turret_base_rotate_yaw` → `ref_gun_turret_handle_rotate_pitch` → `ref_muzzle_gunner` | Phase 5 |
| Doors | `ref_door.001`–`.014`, `ref_door_interior.001/.002`, `ref_door_trunk` | Phase 4 |
| Driver controls | `ref_steering_wheel`, `ref_throttle`, `pedal_Gas`, `pedle_Break` | Phase 4 |
| Buttons | `button_engine`, `button_{driver,passenger}_seat_{F,B}` | Open |
| FX emitters | `ref_exhaust.001/.002`, `headlight`, `breaklight`, `light_underglow_right` | Phase 4 |
| Tow hooks | `ref_hook.001`–`.003` | Long-term |
| Collision hull | `collision_warthog` (2486 v) | Phase 2 |

### Two traps in the rig

**Locked — steering must be applied as a quaternion multiply.** The right-side
corners carry a baked ±90° Y pair (`ref_contact_FR` at +90, `ref_steer_FR` at
−90) that nets to identity. Writing `ref_steer.rotation.y = angle` wipes the
authored half and mirrors that wheel. The correct form is
`quaternion = authoredQuat × quatY(angle)`, which is valid on all four corners
because Y rotations commute with Y rotations.

**Locked — wheels spin about their own local Z.** The wheel discs are authored
in the XY plane, thin in Z, on every corner. Not X, and not "whichever axis
points sideways in world space".

---

## The physics model

**Working:** A hand-rolled **raycast vehicle**. No physics engine.

`package.json` carries `three` and `three-mesh-bvh` and nothing else, and the
codebase's whole idiom is analytic-or-BVH: terrain height is a function
(`world.js:34`), collision is BVH raycasts (`collision.js`), nothing anywhere
integrates a rigid body. Pulling in ammo.js or Rapier to drive one jeep would
add a WASM dependency, a second source of truth for "where is the ground", and a
substepping model that has to be reconciled with `game._simStep`'s existing
`timeScale` substepping — which is what makes 8× fast-forward numerically
identical to 8 real frames, and which the project relies on for scripted battle
testing.

A raycast vehicle is roughly 200 lines and is the model that actually produces
the feel we want. The shape:

1. **Chassis** — position, quaternion, linear velocity, angular velocity.
   Diagonal box inertia tensor. Full 3-DOF rotation, not yaw-only: landing
   sideways off a ridge *is* the Warthog, and yaw-only closes that off
   permanently for a saving of about thirty lines.

2. **Four suspension rays** — cast down from each corner's hardpoint using the
   same two-tier grounding rule every other entity uses (`collision.groundAt`
   first so tunnels and bridges work, `world.heightAt` as fallback). See
   "Grounding must match the infantry" below.

3. **Spring force** `k·compression − c·ẏ` at each contact. This alone produces
   the squat under throttle, the dive under braking and the roll in a turn —
   they are not separate features, they fall out of having four independent
   springs and a centre of mass that is not at ground level.

4. **Longitudinal force** from throttle and brake at each contact patch.

5. **Lateral force** from a slip-angle model that **saturates at μ·Fz**. This is
   the line that separates a vehicle from a sliding box, and it is where the
   Warthog's signature drift comes from. Grip running out has to be a
   consequence of load, not a speed threshold.

6. **Hull collision** — sample points derived from `collision_warthog`, pushed
   out against `wallBvh.closestPointToPoint` and `world.coverBoxes`, with
   velocity reflected along the contact normal.

**Working — centre of mass sits at `ref_body_rotation`.** It is 0.355 m forward
of the axle midpoint and 1.235 m above the root, which is a plausible COM for a
front-engine vehicle and is almost certainly what the empty was authored for.
See the Open questions.

### Grounding must match the infantry

**Locked.** A vehicle grounds by the same rule a soldier does — floor shell
first, heightfield fallback — seeded from the heightfield rather than from
somewhere safely high. `groundAt` takes the *first* floor it meets casting down,
so seeding from 200 m finds roofs and bridge decks instead of the surface the
people walking around the vehicle are standing on.

A vehicle that grounds by a different rule than the infantry is a vehicle that
parks in its own private world, and every bug that follows from that is
invisible until something tries to stand on it.

---

## The seat model

**Working.** Seats are a table in config keyed to the rig's ref names, not a
class hierarchy. A seat declares where the body sits, where the camera goes, and
what the occupant may do:

```js
seats: [
  { id: 'driver',    seat: 'ref_seat_driver',    camera: 'ref_camera_driver',    can: ['drive'] },
  { id: 'gunner',    seat: null,                 camera: 'ref_camera_gunner',    can: ['turret'] },
  { id: 'passenger', seat: 'ref_seat_passenger', camera: 'ref_camera_passenger', can: ['weapon'] },
  // tailgate riders — see Open questions, the empties do not exist yet
]
```

**Working:** every seat has both a first-person and a third-person view, and the
toggle is the one the player already has (`O`, `player.js:231`). Third person
reuses the `_applyBoom` shape at `player.js:1629` — the same collision-aware
boom, with its own `CFG` block, boomed off the chassis instead of the eye.

**Locked — the controller branches, it does not fork.** `Player.update` gains a
seat branch exactly the way it already branches to `updateDowned` at
`game.js:343`. A second Player subclass for "in a vehicle" would duplicate
input, aim, weapon and HUD handling and the two copies would drift.

An occupied soldier stays in `game.allSoldiers` — they are still shootable, and
the passenger can still fire. What changes is that `s.vehicle` is set, so
`soldier._move` skips and the body is parked at its seat ref.

---

## Build order

**Working:** Eight phases. Each one is useful before the next exists, and each
one ends in something that can be *looked at* rather than reasoned about.

### Phase 1 — Intake ✅ DONE

Load the GLB, park two hogs at each `FC_VEHICLE_` marker, screenshot next to a
marine.

**Built:** `ASSET_PATHS.vehicles` + `CFG.vehicle` in `config.js`,
`prepareVehicle` in `assets.js`, `src/vehicle.js` (`VehicleManager` + `Vehicle`
with a per-instance `ref_*` index), wiring in `game.js`.

**Proved:** scale, facing, and that the rig's naming is trustworthy. Also
surfaced the blue-HQ collision-floor problem below, which was pre-existing and
had been invisible because nothing had ever needed to agree with the ground to
within a metre.

**Deliberately not done:** anything that moves.

### Phase 2 — Chassis and suspension ✅ DONE

The full raycast vehicle above. Player drives with WASD (S is brake-then-
reverse, Space is the handbrake), E gets in and out, camera on
`ref_camera_driver` in first person and a collision-aware boom in third.

**Built:** `CFG.vehicle.warthog` (the whole tuning block), the `Vehicle` rigid
body + `Wheel` corners in `vehicle.js`, and the driving branch in `player.js`
(`enterVehicle` / `_updateDriving` / `updateVehicleCamera` / `_applyVehicleBoom`).

**Measured, not asserted:**

| Check | Result |
| --- | --- |
| Rest state | Four loads sum to 54,000 N = mass x gravity exactly; compression 0.125 vs 0.129 predicted sag |
| Acceleration | 0 to 20 m/s in 5 s, top speed 22.4 m/s; rear squats to 0.143 while front extends to 0.093 |
| Cornering | 0.85 g sustained, body leans 7.4 degrees and settles, inside front wheel lifts to 0 N while the outside rear takes 17,942 N |
| Lift-off | Body slip angle swings -5.5 to +9.5 degrees — trailing-throttle rotation, unscripted |
| 4 m drop at 11 m/s | Bottoms the springs, rebounds, settles level in 0.75 s |
| 200 frames at 20 fps | Finite, upright, still driving — the fixed substep holds |
| Cost | 0.44 ms/frame for 64 soldiers and 7 vehicles |

**Four bugs worth remembering**, all found by measurement rather than by looking:

1. **Wheel forces must be applied in a second pass.** Applying each corner as it
   was computed meant later corners solved against a body the earlier ones had
   already pushed. It showed as a persistent 0.4 degree roll driving in a
   straight line, leaning toward whichever side came last in the array.
2. **Rolling resistance was viscous, not Coulomb.** Written as `-v * k * load`
   it is a damper worth 14 kN at speed, and it quietly capped the hog at
   13.6 m/s with a 25 m/s top speed configured.
3. **No bump stop.** A 4 m drop put the body 0.45 m below its resting height —
   the floor pan through the rock. A second, much stiffer spring acting only on
   the overshoot fixed it.
4. **A three.js camera looks down its own -Z**, and the chassis frame is +Z
   forward, so handing the camera the chassis orientation aimed it out of the
   tailgate. The infantry path already carries the same offset as
   `s.yaw = this.yaw + Math.PI`.

**Deliberately not done:** seats other than the driver, the turret, damage, any
cosmetic linkage. The body is hidden while driving because it has no seated pose
yet and would stand upright through the roll cage.

**Left for Phase 3 to decide:** the handbrake fully locks the rear axle, which
spins the hog 180 degrees from one tap at 20 m/s. That is what a locked axle
does and the model is behaving; whether it is the *feel* wanted is a tuning
call, not a code one.

### Phase 3 — The tuning range ✅ DONE

A `VEHICLE` tab in `/chartest.html`, built on `src/vehiclerange.js`. WASD to
drive, Space handbrake, R reset, C cycles CHASE / DRIVER / SIDE / FRONT. 25 live
sliders across BODY, SUSPENSION, DRIVE, STEERING and TYRES, and a paste-ready
`CFG.vehicle.warthog` block that updates as you turn them.

**Locked:** this is how the project tunes — build the UI, do not guess the
numbers. It is its own phase rather than polish folded into Phase 2 because it
is the tool that *finishes* Phase 2, and treating it as optional is how Phase 2
ends up hand-tuned badly once and never revisited.

Two decisions make it an instrument rather than a sandbox:

**The ground is analytic.** `rangeHeight(x, z)` is a function; the mesh is
displaced from it and the vehicle's ground query calls it directly, so what you
see is what you drive on to the millimetre. map-3 cannot give that — its
flattest authored ground still steps 0.73 m over 4 m, which is terrain to test
ON and useless to tune AGAINST.

**The centre lane (x = 0) is flat for the full 300 m**, verified in code, and
every feature is placed to keep it that way. The jump originally sat at z = 90
down the middle, so every acceleration run launched off it and the 0-20 time and
braking distance were being measured *through a jump*. Measurements are only
worth having if the surface under them is known.

Features, each answering one question: **JUMP** (does it land on the suspension
or its face — 4 wheels airborne, bump stop 0.138 m, 207 kN peak), **WASHBOARD**
(is the damping right or does it pogo), **CAMBER** dome (how much lean before it
lets go), **STEP** kerb (does the hull climb it — it does not), **BOWL**
(constant-radius, for watching the tyre budget run out). Control run on the flat
lane: 0 airborne, compression 0.091–0.16 around the 0.129 sag, 0.0 degrees lean.

It reports numbers, because suspension is not tunable by vibes — "feels floaty"
is a roll angle and a damper ratio and you cannot see either without being told.
Lateral g, body lean, pitch, body slip angle, per-corner compression bar + load +
slip + AIR/STOP flags, and two stopwatch figures that are impossible to eyeball:
**0-20 m/s** and **braking distance to a stop**.

**The parameterization is the point.** Spring rate is derived, never authored:
`k = mass * g / (4 * travel * sag)`. Verified live — taking the hog from 3000 to
4500 kg moved the spring from 71,053 to 106,579 N/m and left ride height
untouched, settling at 80,999 N against 81,000 expected. Mass and ride height
stay independent knobs, which is the only reason they are tunable by hand.

`Vehicle.retune()` exists for this tab: the strut top's height is a function of
`travel` and `sag`, so re-deriving the constants is not enough on its own —
without moving the hardpoint, changing the spring would change the ride height
as a side effect.

### Phase 4 — The parts that move because the physics moved

Purely cosmetic, and only possible once there is real motion to drive them.

- Suspension linkage: rotate `ref_sus_arm_*` by `k·compression`, aim and stretch
  `ref_sus_spring_*` between their endpoints.
- Doors and the tailgate. **This needs a tuner, not a guess** — there are 14
  `ref_door*` empties with varied baked rotations, no clips, and no way to tell
  from the file which are cab doors, which are engine panels and which way each
  swings. A `DOOR` tab (hinge axis + open angle per ref) is the same shape as
  every other tuning tab in the project.
- Steering wheel, throttle lever, pedals, brake lights, exhaust, headlights.

### Phase 5 — Seats and the turret ✅ DONE

Five seats: driver, gunner, passenger, and two on the tailgate. Enter/exit on
the existing `E`, folded into the priority chain in `_updateInteract`.

**Which seat you get is decided by which one you are standing nearest.** No
menu and no cycle key — walk round to the back and press E and you are on the
tailgate; stand at the door and you are driving. The prompt names the seat it
is offering, so the input is the position of your feet.

| Seat | Can do | Weapon |
| --- | --- | --- |
| driver | drive | none — both hands full |
| gunner | the ring | `WEAPONS.hogturret` (M41 LAAG) |
| passenger, rearLeft, rearRight | ride and shoot | their own carried weapon |

Seats are a **table in config keyed to the rig's own empties**, not a class
hierarchy — adding a seat to a vehicle is an entry in `CFG.vehicle.seats`.
`ref_camera_gunner` hangs off `gun_turret_body` in the GLB and therefore yaws
with the ring, which is why every seat's eye is read live off the hierarchy
rather than computed.

**The gunner's aim frame is the RING's, not the chassis's.** A gunner holding
still on a target keeps holding it while the driver swerves underneath. That is
the whole difference between a manned turret and a gun bolted to a car.

**`mounted: true` is a new WEAPONS convention** — the geometry belongs to a
vehicle, so `assets.js` loads no model for it and `/chartest.html`'s GRIP and
VIEWMODEL tabs skip it. It is in no armoury pool, so it can never be selected
as a loadout weapon; what puts it in front of you is the seat.

**Three axes derived, not assumed**, and the third one earned it: turret yaw,
gun elevation, and *which way the barrel points*. Assuming the muzzle empty's
forward was `+Z` put rounds out of the side of the gun at exactly 90°, because
`ref_muzzle_gunner` carries a baked −90° Y. All three are now measured off the
rig at load — the barrel's true direction is tip-minus-pivot, and the local
axis is whichever best agrees with it.

Verified: seats resolve from every approach angle; ring tracks to a commanded
0.9 rad yaw / 0.25 pitch and holds; 15 rounds in 2 s against 16 expected at
480 rpm; recoil walks the aim up; passenger and tailgate riders fire their own
weapons (15 rounds, magazine counting down); driver fires nothing.

**Seated bodies — done.** `driving.glb` for the driver, `sitting-idle.glb` for
the riders; both were already in `source/` and neither had been synced.

The body is **parented to the chassis frame**, not written from `pos` each
frame. Two measured reasons: the mesh transform is written inside
`_updateAnim`'s distance throttle, so a rider driven from `pos` updates every
other frame past 60 m and visibly swims behind a hog at 20 m/s; and `pos` plus
`yaw` carry a yaw and nothing else, so the 7.4° of cornering roll would lean a
rider out of their own seat. Parenting buys roll, pitch and suspension travel
for free. It mounts on `group` rather than the seat empty because the empties
in this rig carry baked rotations — one clean frame beats five arbitrary ones.

Ride height is **derived, not authored**: the hips are measured off the
retargeted clip on this rig and the body dropped by that much, which lands the
hips on the seat empty to 0 mm in Y and Z on all five seats, repeatably.

Two traps, both found by measuring rather than looking:

1. **A zero-length crossfade is scheduled, not applied.** three.js resolves it
   on the next mixer step with a real dt, so measuring straight after
   `playAnim` reads the OUTGOING pose — a standing marine, 18 cm of error, and
   intermittent because it depended on what had been playing before. The fix is
   to force the action weights before measuring.
2. **Dying in a seat has to give the seat back.** Nothing did, because it cost
   nothing while the body was invisible. A corpse now holds the slot shut and
   rides along, so `onKill` and `onDown` both dismount.

**Still open, and now visible rather than merely suspected:**

| Seat | Reads as | Why |
| --- | --- | --- |
| driver, passenger | correct | the two seats the rig actually authors empties for |
| tailgate ×2 | sunk into the rear bodywork | derived offsets — open question 3 |
| gunner | stands, holds their own rifle | no gunner pose exists (the body now turns with the ring — see below) |

The driver's foot also hangs 0.18 m below the footwell — measured, pan at
y = 0.65 against a toe at 0.471. That is a Mixamo leg drop longer than this cab
is deep, and no single translation fixes both ends of a leg, so it wants an
authored pose or a knee IK rather than a number. It is invisible at the 11 m
chase distance and findable from a low side angle.

### The SEAT tab ✅ DONE

`src/seatrange.js`, riding on the VEHICLE tab's hog rather than loading a
second one. All five seats are occupied at once — the tailgate riders only read
as wrong *next to* a passenger who is right — and each by a different character,
because a pose that only fits the marine is a pose that breaks on the next rig.

**It shares the game's code.** `seating.js` holds `measureHipsRise` /
`seatMeshOn` / `forcePose`, and both `Soldier.seatIn` and the tab call them.
Nothing here owns a private copy of the arithmetic: a tuner that seats a marine
even slightly differently from the match produces numbers that do not transfer,
and that is worse than no tuner, because you would trust it.

**It reports clearance**, which is the whole reason it earns its place. The
failure is a boot through the floor pan and you cannot see it from outside the
hog — the bodywork hides it at every angle a player will ever have. So the tab
prints, per seat, the marker height, the hips, the toe, the floor beneath it and
the signed **gap**. Negative is a boot through the bodywork. "Looks fine" is
exactly how the 18 cm error survived.

Finding that floor took three attempts, and the two failures are worth keeping:
probing down from the **hips** hits the seat cushion the marine is sitting on
(it called the driver's floor 0.937 against a real footwell of 0.65), and
probing from just above the **toe** hits the seat's front lip overhanging the
foot (1.024 — above the seat marker itself). What works is casting the whole
column once from above the hull and taking the topmost surface *below the seat
marker*: everything above the marker is seat, dash and wheel. A tailgate rider
correctly reports **no floor at all** — their feet hang over open air.

Two knobs per seat. **ANCHOR** moves the seat itself and is editable only for
the derived seats; an authored `ref_seat_*` is shown read-only, because
overriding an empty that exists puts config and the rig into silent
disagreement and the fix for a wrong empty is in Blender. **POSE** is a per-seat
`{ pos, rot }` correction on top of the derived hips term, falling back to
`CFG.vehicle.seatPose`. The paste block emits the whole `seats` array rather
than just the poses — the two are edited together, and splitting them is how one
gets pasted and the other forgotten.

`CFG.vehicle.seatPose` stays at zero — it is the fallback a new vehicle's seats
start from, and a non-zero default would be a correction applied to seats nobody
has looked at yet. The real numbers are the per-seat `pose` blocks.

**Tuned, and the seats now read.** Owner-turned in the tab and pasted back:

| Seat | Gap before | Gap after |
| --- | --- | --- |
| driver | −0.422 | −0.145 |
| passenger | −0.381 | −0.065 |
| gunner | −0.957 | **+0.441** — standing clear of the deck |
| tailgate ×2 | (sunk in the bodywork) | seated on the tailgate, feet over open air |

The tailgate riders take a ~3 rad yaw so they face out over the back rather
than forward down the chassis, and a mirrored pose X so each sits over their own
hip instead of both drifting the same way.

**The tab's numbers transfer exactly**, which is the payoff of putting the
arithmetic in `seating.js`: the same five poses measured in the match give hips
at 1.356 / 1.357 / 1.500 / 2.649 against the tab's 1.356 / 1.357 / 1.500 /
2.649. Nothing is re-derived on either side.

Still outstanding, and unchanged by tuning: the gunner holds their own rifle in
a standing idle and does not turn with the ring, and the tailgate seats are
still derived offsets rather than authored empties (open question 3). Both want
art, not numbers.

### Phase 6 — Damage, roadkill and repair

- Vehicle hull into `combat.traceHit` (`combat.js:322`), on the same
  nearest-wins compare the rally beacon already uses at line 371 — so a round
  never passes through a hog to hit the soldier behind it.
- Run-over: relative speed above a threshold does damage scaled by it. **Working:**
  this should hurt the *hog* too. A Warthog that farms infantry with no cost is
  the version of this feature nobody enjoys playing against.
- The repair tool already works on "whatever it is pointed at"
  (`repairtool.js:17`) and should need little more than a target type.
- Destruction, wreck, respawn timer.

### Phase 7 — Bots drive

Split into three, because each is worth looking at before the next exists and
because 7a is the one that de-risks the other two: it puts four AI bodies in
the seats without a line of driving AI, which is where the seating work either
holds up or does not.

#### 7a — Bots can ride ✅ DONE

`Soldier.mount(vehicle, seat)` / `dismount()`. A rider is a soldier who is not
walking, **not** a soldier who is switched off: they still take targets, and the
ones with a free hand still shoot their own weapon through the normal path.
`_move` is the only thing that must not run — the seat owns the body, and
letting the mover write `pos` drags a rider out of the vehicle a metre at a
time. Target acquisition was split out of `_think` into `_updateTarget` so a
rider gets targeting without the errands under it, which all resolve to
somewhere to *walk*.

**`pos` is dragged along by the vehicle, not by the soldier.** The mesh does not
need it (parented, rides for free), but `pos` is what the rest of the sim reads —
who is near an objective, who a squad forms on, and where a bullet has to land.
`Vehicle.syncOccupants` runs after the physics step because the soldier pass
runs *before* vehicles, and reading the seat from there is a frame stale: 40 cm
at 25 m/s. The player is skipped, since their controller already owns `pos`, and
they are identified by `seatIdx` — testing `isPlayer` does **not** work, because
the occupant for the player is the *controller*, which carries no such flag, and
the yaw write would have stamped out their look direction.

Dying, being downed and respawning all dismount. Same bug as the player's, and
the same reason it would have gone unnoticed: a seat held by a body nobody can
revive out of it never reopens.

**Measured:** five bots crewed a hog, it drove 90.9 m, and every one of them
finished **0.000 m** off their seat. 15 s of 8× battle with a crew aboard: all
five still seated, 0.000 m worst error, zero dead-or-downed soldiers holding a
seat. Roles gate firing correctly — a tailgate rider burned 60 rounds to 8 while
the driver and the gunner fired nothing.

*Noticed in passing, pre-existing:* a bot whose active weapon is the `magnum`
does not fire even with a target in range — it behaves the same on foot, so it
is not the mounted path.

#### 7a.2 — The bot gunner mans the ring ✅ DONE

The gunner was the one seat that still fired nothing, which is most of a
Warthog's threat. It reuses `_fire` wholesale rather than growing a parallel
turret path: `_chooseWeapon` returns `WEAPONS.hogturret` for that seat, so burst
cadence, the pause between bursts, target validation and the line-of-sight check
all come for free, and `hogturret.ai` is an ordinary weapon `ai` block anyone can
tune. `muzzlePos` returns the M41's barrel while manning it — that one override
is the whole of "the gunner shoots the vehicle's gun", and kills still attribute
to the gunner because the shooter handed to `combat.fireShot` is unchanged.
Frags and rockets are gated off: both would have been fired *from the turret
muzzle*, because that is what `muzzlePos` now returns.

Range is derived, not stashed: `aiEngageRange` / `aiMaxRange` consult the seat.
A marine holding a magnum still engages at the M41's reach while in the ring,
and there is no saved value anyone has to remember to restore.

**Aim is a CLOSED LOOP on the barrel's measured direction, and that is the whole
lesson here.** Commanding `turretYaw`/`turretPitch` from the bearing to the
target is the obvious implementation and it is wrong — measured, the ring
converged on exactly the commanded 1.486 / 0.779 and the barrel came out at 83°
of elevation. Three independent reasons stack, any one of them fatal:
`ref_muzzle_gunner` carries a baked rotation (already documented in phase 5 for
putting rounds out of the side of the gun), the pitch node's axis is not the
clean elevation axis, and the yaw axis is the CHASSIS vertical — so on a slope,
yawing alone sweeps the barrel through half a radian of world pitch. Feeding
back the observed error needs to know none of it, and costs nothing extra
because `_turretOnTarget` has to read the true barrel direction anyway to decide
whether to fire at all. There is no windup: the barrel is driven straight off
`turretYaw` in the same frame, so the error being corrected is the rig's
distortion, not slew lag.

Firing waits for `hogturret.aimTolerance` (0.09 rad). Without it a gunner
acquiring a target behind them hoses a burst across everything on the way round.
The check sits *above* the burst logic so an interrupted burst resumes rather
than being thrown away and re-rolled.

#### 7a.3 — The gunner's body rides the ring ✅ DONE

`Vehicle.seatMount(i)` returns `turret.yawRef` for the turret seat and the
chassis for every other. The gunner's body therefore turns with the gun they
are holding, which is the same argument `ref_camera_gunner` already makes for
the eye — a man holding a weapon that swings without him is the single most
obviously wrong thing about a crewed hog.

**Measured before committing to the approach, because the rig has form here:**
`yawBase` is identity and `yawAxis` is a clean `+Y`, so unlike the muzzle and
the steer corners this node carries no baked rotation to cancel; scale is unit;
and the pitch node is its CHILD, so the body inherits yaw only — the barrel
elevates and the gunner does not. The gunner also sits **0.351 m** off the yaw
axis, which is a natural shuffle around the mount rather than a swing.

`seatLocal` deliberately still means CHASSIS frame — the SEAT tab's marker
column and its camera framing both read it that way — so the mount frame got
its own accessor, `seatMountLocal`, used only by the mesh parenting.

Verified: in-game the ring slewed 1.531 rad onto a target and the body turned
1.544 rad with it, the 0.013 discrepancy being the chassis settling on its
springs mid-run. Every other seat is unmoved, pixel-identical across ring
angles, and 45 s of 8× battle found zero bodies on the wrong parent.

Pitch is still not represented for any body, seated or on foot, which is the
consistent answer rather than an omission.

**Measured:** aim error converges to 0.000–0.002 rad and holds; a full-health,
full-plate enemy at 70 m goes down in 4.77 s; with no target the ring returns to
exactly 0/0 rather than freezing where the last casualty was. Driving with a
squadmate on the gun against six enemies at 80 m: 598/600 frames with a target,
506/600 on target, one enemy down. 15 s of 8× battle after: 0.000 m worst
off-seat, no seats held by casualties, no errors.

#### 7b — Bots drive ✅ DONE

`src/vehicledriver.js`. The whole module writes `vehicle.input` and reads
`pos/quat/speed`, and nothing else — that narrowness is what makes it testable,
because the **AUTOPILOT** toggle on the VEHICLE tab drives the range hog through
this exact code with no Game, no squad and no soldier in sight. "Does the
controller work" and "does the AI decide to drive" stay separate questions with
separate answers.

Pure pursuit, not a path follower: it is handed a point and closes on it.
Anything smarter belongs above it, in whatever chooses the point.

**Ground is sampled through `vehicle.groundAt`, never `world.heightAt`** — see
the known problem below. Probes against the bake would steer around terrain that
is not there, in exactly the regions where it reads a flat 0, and it would be
diagnosed as an AI bug long before anyone suspected the heightfield.

Proved on the range first: a four-corner circuit whose legs sit at x = +20 and
x = −5 specifically to MISS the jump (x −31..−13) and the camber dome, because a
lap that launches off the jump measures the suspension rather than the driver.
**90 s: two-plus laps, zero unstick events, never flipped, never left the
corridor.**

**Only rises were treated as obstacles at first, and that is the half that does
not hurt.** A wall strands you; a ledge rolls you. Two of four hogs ended an
eight-minute battle upside down before `dropFall` existed. The probe now costs
one pass and returns both a steering bias and a speed factor, and speed also
backs off for a chassis that is already leaning — the one measure that accounts
for what the suspension is doing, and the state a hog is in just before it goes
over.

#### 7c — The squad decides ✅ DONE

`Squad.updateVehicleUse`. A squad whose objective is more than `driveMinDist`
away claims the nearest **uncrewed** vehicle within `seekRange`, walks to it,
drives, and dismounts within `dismountRange` of the objective — open question 6
answered: capture on foot, because a hog spinning circles on a control point is
far less readable than marines getting out.

Three bugs, all of the same family — a state machine that could not tell two
similar situations apart:

1. **A claimed vehicle is not a crewed one.** Releasing on `!crewed` meant
   claim, see it empty, release, re-claim next frame, forever, and the squad
   was never given the seconds it needed to walk over. The empty case gets a
   grace period now, and `boardTimeout` covers a hog nobody can reach.
2. **The formation offset was applied to a vehicle destination.** `_move` walks
   to `waypoint + formationOffset`, so aiming at the hog parked the squad in
   formation AROUND it — the outermost slot stops 2.5 m short of 6.7 m out,
   never reaches `boardRange`, and the squad stands there admiring the vehicle.
   The offset is now cancelled for the approach.
3. **Nearest-seat left the wheel empty.** Right for the player's squad piling
   into a hog the player is already driving; here it produced three marines in
   the back of a stationary Warthog, because they walked up from behind and the
   tailgate was nearest. A squad that took a vehicle in order to drive fills the
   one seat that makes that possible first.

**Measured**, eight minutes of 8× battle: hogs covering 6.4 km, up to 22.6 m/s,
97 frames of crew-without-driver against a constant state before the fix.

**Claims bind bots only.** The player can still take a claimed hog, which is
deliberate — a reservation the player cannot override is a reservation that
reads as a bug.

**Still open, and both are Phase 6's:** nothing rights or respawns a flipped
vehicle, so any flip is permanent and the flip *rate* cannot honestly be
characterised until recovery exists. And with four hogs against sixteen squads
the AI claims the entire motor pool within a few minutes; nothing reserves
anything for the player, and nothing stops a squad taking a vehicle out of the
other team's pool if it is within `seekRange` — which may well be correct, since
stealing vehicles is the genre, but it is a decision nobody has made yet.

**Working:** vehicle use is a **squad-level** decision, not an individual one.
`TeamBrain.replan` (`ai.js:168`) assigns a squad to a vehicle when its objective
is far enough that driving beats walking; the squad's members fill seats by role
(leader gunners, the rest ride).

The driver is a pure-pursuit controller onto the existing objective, with
obstacle avoidance sampled off the heightfield gradient. The gunner reuses
`_acquireTarget` unchanged — it already picks targets off a position and a
facing, and a turret is just a different position and facing.

**Open:** whether bots may capture a sector *from* a vehicle, or must dismount.
Dismounting is more readable and much more likely to be what a player expects.

### Phase 8 — The second vehicle

The Mongoose, because it is the cheapest possible proof: two wheels, one seat,
no turret. If adding it is one `ASSET_PATHS.vehicles` entry plus one `CFG` block,
the abstraction is right. If it needs code, the abstraction is wrong and this is
the cheapest possible moment to find out.

`Scorpion-runtime.glb` and `Grizzly.glb` are already in the kit and are tracked
vehicles — a different steering model, and explicitly **Long-term**.

---

## Open questions

Ordered by how much the answer changes.

### 1. What is `ref_body_rotation` for?

The wheels are parented *under* it, so it cannot be a body-roll node in the usual
sense — rolling it would roll the wheels with it.

**Measured** (chassis frame): it sits at `[0, 1.457, -0.356]`, i.e. 1.457 m above
the ground and 0.356 m behind the axle midpoint. That is far too high to be a
centre of mass on a vehicle 2.29 m tall — a hog with its mass there rolls over in
every turn — so Phase 2 does **not** use it. `CFG.vehicle.warthog.com` is a tuned
`[0, 0.66, -0.10]` instead, and it works. The question is now only whether the
empty means something else that a later phase should honour.

### 2. Should `collision_warthog` be visible?

The loader currently hides it. It ships with a material literally named
`collision`, which reads as intent, but the project's map rule is the
opposite — authored collision parents *render as authored* because they double
as real floors and walls (`CLAUDE.md`). This is one line in `prepareVehicle`.

### 3. Where do the tailgate riders sit?

The rig has `ref_seat_driver` and `ref_seat_passenger` and nothing for the two
riders on the back. Either two more empties get authored, or their positions are
derived from `ref_door_trunk`. Authored is better — everything else about crew
position is authored, and deriving one seat from a door hinge is the kind of
special case that outlives its reason.

### 4. Do the markers ever carry rotation?

`maps.js:47` stores `getWorldPosition` and drops the quaternion, and nothing in
map-3 authors a rotation on `FC_VEHICLE_*` anyway — so Phase 1 derives facing by
pointing at the nearest sector. `lobby.js` already keeps quaternions for
`FC_PROP_VEHICLE`, so the fix is small whenever it is wanted. Until then, motor
pools cannot be aimed.

### 5. Do vehicles cost resources?

`GAME_TYPE_PLAN.md` → "Resources" already lists "Vehicle spawning, when vehicles
exist" as something the materiel pool must gate. **Working:** vehicles spawn free
on a timer for now, and the seam is left where the resource system can take it
over without reshaping this module.

### 6. Can a moving vehicle capture a sector?

Affects Phase 7's driver AI and the capture code equally. **Working:** no —
dismount to capture.

---

## Known problems

**Locked — these are real and measured, and neither is caused by vehicle work.**

### The asset is 38 MB

105 meshes, 26 textures, 34 materials — roughly 105 draw calls per hog, 210 for
a pair. It loads acceptably from the dev server and is not blocking, but a
`warthog-runtime.glb` is the right thing before this ships:
merge *inside* `i_mesh_parts` only (every `ref_*` and wheel node must survive),
resize textures, Draco or meshopt. `Scorpion-runtime.glb` at 5.9 MB is the
precedent and shows the problem has already been solved once.

### The baked heightfield disagrees with the authored floor, map-wide

Phase 1 found this at the blue HQ. Phase 2 found it is not local.

| Location | Heightfield | Collision floor | Δ |
| --- | --- | --- | --- |
| Sector markers A/B/C/D | — | — | 0.00 – 0.18 |
| Red HQ | 26.18 | 26.19 | +0.01 |
| **Blue HQ centre** | 0.01 | −0.58 | **−0.59** |
| **Blue HQ, ~8 m east** | 0.00 | −2.62 | **−2.62** |
| **(315, 190) → (315, 220)** | **0.00 flat** | **+1.04 → −2.50** | **up to −3.5** |

`world.heightAt` returns a flat **0** across large stretches of map-3 where the
authored `Collision_floor_parent` is metres lower and genuinely sloped. The bake
simply has nothing in it there. A marine deployed at the blue HQ settles to
y ≈ −2.41, two and a half metres under the visible surface.

**Consequences already hit, both fixed by using the same two-tier rule everything
else uses** (floor shell first, heightfield as fallback — never the heightfield
alone):

- The third-person boom clamped its camera against `heightAt` and so shoved
  itself *up* into a hillside the hog was driving along (`player.js`).
- Searching for flat ground by sampling `heightAt` returns the void outside the
  map, because the void and the flat-zero regions read identically.

`world.raycastTerrain` and `world.hasLOS` still march against `heightAt` alone,
so **bullets and AI line-of-sight are using the wrong surface in these regions
today.** That is well outside vehicle scope but it is the same root cause, and it
is worth knowing before it is diagnosed as an AI bug.

The real fix is Blender-side: `Collision_floor_parent` and the bake need to agree.
Phase 1 removed the procedural HQ pad on GLB maps (`world.js:171`), which fixes
how the HQ *looks* — the disc was drawn at heightfield height and so hovered
above the real surface — but not the underlying disagreement.

---

## Long-term

Not required for the first playable, listed so the architecture does not
accidentally exclude them.

- **Tow hooks** (`ref_hook.001`–`.003`) — towing, or Pelican pickup. The
  Pelican's `asset.json` already mentions a Warthog attach ref, so this was
  planned on the art side before it was planned here.
- **Tracked vehicles** (Scorpion, Grizzly) — a different steering model on the
  same chassis and suspension core.
- **Air** (Pelican, Wasp, Shortsword) — a genuinely different problem. Gets its
  own doc.
- **Vehicle logistics** — `GAME_TYPE_PLAN.md` raises transported materiel as the
  deepest version of the Frontline economy and notes it "needs vehicles, which do
  not exist yet". They will.
