# Air Vehicle Plan — the Pelican

Companion to `VEHICLE_PLAN.md`, which covers the Warthog and says of this
subject only that "air is a different problem and gets its own pass". This is
that pass. It assumes the Warthog doc has been read: everything here about the
rigid body, the seat table, the fixed substep and the tuning-range discipline is
inherited rather than restated.

Where the two docs disagree about a *number*, this one is talking about a
30 m aircraft and that one about a 5.6 m jeep. Where they disagree about a
*rule*, the Warthog doc wins — it was written against shipped code.

## Decision labels

Same vocabulary as the sibling docs.

- **Locked:** Owner-decided, or built and verified. Treat as a project requirement until deliberately revised.
- **Working:** Proposed and not yet owner-approved, or approved but unvalidated by play.
- **Open:** A decision is still required.
- **Long-term:** Intended future, not required for the first playable.

---

## The thing being built

**Locked — the rule that decides borderline cases:**

> The Pelican is a **rigid body you point and push**, not a camera that flies.
> Attitude and velocity are separate state, and the only thing that changes
> velocity is thrust along the hull's own axes.
>
> Take: mass, momentum, a nose that lags the look, thrust that pushes where the
> ship is pointing and not where the player is looking, a slide that has to be
> flown out of.
>
> Leave: velocity written directly from the camera vector, a turn rate that is
> whatever the mouse did, "arcade" as an excuse for a camera on a spline.

That separation *is* the Halo feel, and it is worth being precise about why,
because the cheap version looks identical in a screenshot. In the cheap version
the ship's velocity is the look direction times a speed, so the vehicle has no
state — it is a camera with a mesh attached, it stops the instant you stop
asking, and it can never overshoot. In this version the look direction
commands a **torque**, the torque turns the **hull**, the hull's engines push
along the **hull**, and where you end up is the integral of all three. Momentum
is not a damping constant anyone tunes. It is what you get by refusing to write
velocity.

The corollary is that Phase 2 is the phase that matters, exactly as Phase 2 was
for the Warthog. If the airframe does not feel like it weighs twenty tonnes,
nothing built on top of it rescues that.

---

## What is already true

**Locked.** These are measurements taken off `Pelican.glb` by composing the
glTF node hierarchy's world transforms and reading accessor bounds — not
inspection by eye, and not the file's own bounding box, which the sky and the
thrust-effect cards inflate.

### The model is authored in metres, at canon scale

| Quantity | Measured | Canon (D77-TC Pelican) |
| --- | --- | --- |
| Fuselage length (`Pelican_Main_body`) | **30.45 m** along −X | 30.5 m |
| Wingspan (front wings, Z extent) | **24.17 m** | 23.7 m |
| Height above the gear plane | **12.11 m** | 10.3 m |
| Whole-model extent incl. thrust cards | 33.16 × 13.86 × 24.28 m | — |
| Bay interior (`Interior_Hull`) | 16.75 L × 4.83 W × 3.96 H m | — |
| **Bay deck height** | **y = 2.51** above the gear plane | — |
| Belly (`Pelican_Main_body` min Y) | y = 1.31 | — |
| Geometry | 70 meshes, 98 primitives, 53,976 verts | — |
| Materials / images | 24 / 26 | — |
| Source file | 20.9 MB → **13.0 MB** shipped | — |

Confirmed in-engine at intake. After `prepareVehicle`'s facing correction the
wrapper measures **24.278 W × 13.859 H × 33.161 L m** against the Warthog's
**3.072 × 3.472 × 6.264** — the hog's figures matching `VEHICLE_PLAN.md`'s own
table to the centimetre, which is what says the two were measured the same way.
That is **5.29× the Warthog's length and 7.90× its width**.

**The model needs no scale normalization**, which is the same call
`prepareVehicle` already makes for every vehicle and for the same reason: a
vehicle's real-world size is a fact about the model, not a design number we own.
Landing within 2% of canon on two independent axes is the evidence that the
export is honest.

It is **5.4× the Warthog's length and 7.9× its wingspan**, and that ratio is the
thing to keep in mind everywhere below. Numbers that are correct for the hog —
the 11 m chase boom, the 8-corner hull, the 10.6 m motor-pool spacing — are not
merely mistuned at this size, they are the wrong shape.

### The map has room; the motor pool does not

map-3 normalizes to 1 unit = 1 m across 2592 m, with the HQs 2578 m apart
(`maps.js`). A 30 m aircraft is unremarkable in that world, and a flight ceiling
is available from the heightfield bake's own `maxY`.

What does not fit is the parking. `FC_VEHICLE_` slots sit 10.6 m apart —
"sane Warthog parking", as `maps.js` puts it, and a third of a Pelican.

**Working:** air vehicles get their own marker prefix, `FC_AIR_*`, rather than a
slot in the hog park. A shared prefix with a size test in code would be the
version that silently parks a Pelican through a hangar wall.

### The model is −X forward, +Y up

Same convention as the Warthog, and as the Pelican's own `asset.json` claims.
Confirmed by geometry rather than taken on trust: the windshield, the chin gun
barrel and both cockpit camera empties all sit at x ≈ −13 to −15, while the tail
engines sit at x ≈ +11 to +17.

`prepareVehicle` therefore turns it onto the **+Z-forward, +Y-up** convention
the soldiers and the AI already use, inside the same nested group, so
`wrapper.rotation.y` stays a plain world yaw. After correction the chassis
frame is +Z forward (nose), +X left, +Y up: 30.45 m along Z, 24.17 m along X.

**Verified in-engine rather than assumed**, and the left-handedness is the part
worth having checked. After correction `ref_camera_pilot` reads z = +12.83 and
`ref_contact_front_middle` z = +10.49 — nose on +Z — while
`ref_contact_back_left` reads **x = +3.535** against `back_right` at
**x = −3.535**. So **+X is left**, exactly as `forward × up` gives for a +Z/+Y
rig, and every `ref_*` name in this file can be trusted the way the Warthog's
could. A rig whose own left/right naming disagreed with its geometry would have
mirrored every seat, exit and gun on the aircraft.

### The gear contacts sit exactly on the ground plane

All three `ref_contact_*` empties read y ≈ 0.0 — `back_left` and `back_right` at
y = 0.024, `front_middle` at y = 0.000. Their mean is (−0.70, 0.008, 0.00).

This is a **better** rig than the Warthog's on this specific point. The hog's
`ref_contact_*` sit 5.9 cm above where the tyre actually meets the ground, which
is why `prepareVehicle` grounds off the wheel meshes instead. Here the empties
are the truth.

**One consequence, and it is a trap in the loader rather than in the rig:**
`prepareVehicle` looks for meshes matching `/^wheel_/` to ground off, and the
Pelican's are named `LandingGear_back_left_wheel` and
`landing gear_3 bottom middle_wheel`. That pass finds nothing, warns, and falls
back to the contact mean — which is correct here, but correct by accident. Fix
it in the loader or rename in Blender; do not leave it resting on the warning.

**Measured at intake**, parked on authored floor: the rear contacts stand
**+7.9 mm** above the ground and the nose contact **−15.7 mm** below it — the
whole gear plane lands on the surface within **2.4 cm across a 15.7 m gear
base**, with no correction of any kind. This rig grounds itself.

---

## The rig contract

**Locked.** `Pelican.glb` carries **no animation clips** — the same contract the
Warthog holds to, and the reason a vehicle is cheap to add once the system
exists. Every moving part is a named node and code drives all of it.

This is a well-authored rig. More is present at intake than the Warthog had at
the same stage.

| Purpose | Nodes | Phase |
| --- | --- | --- |
| Chassis pivot | `ref_pelican_root` (y = 3.788) | 0 |
| Gear contacts | `ref_contact_{back_left,back_right,front_middle}` | 1 |
| Gear legs | `LandingGear_{back_left,back_right,front_middle}`, wheel + axle children | 5 |
| Gear bay doors | `LandingGear_front_middle_door_{left,right}` — authored **open** (baked ±0.8755 X-quat) | 5 |
| Cockpit eyes | `ref_camera_pilot`, `ref_camera_copilot` | 2 (pilot), 6 (rest) |
| Exit / prompt | `ref_exit_pilot`, `ref_exit_pilot.001`, `ref_exit_copilot`, `ref_prompt_{pilot,copilot}` | 6 |
| Rear hatch | `door_rear_top`, `door_rear_bottom`, with **`collision_door_rear_bottom` parented under the ramp** | 5 |
| Bulkhead | `door_interior` (2.15 m tall, cockpit↔bay) | 5 |
| Buttons | `Button_RearRamp_{Exterior,Interior,Pilot,Copilot}`, `Button_EngineStart_{Pilot,Copilot}`, `Button_Landinggear.001/.002` | 5 |
| Engine nacelles | `Wing_{front,rear}_{left,right}_root` | 4 |
| Thrust FX | `Wing_*_ThrustEffect_{down,forward}`; materials `thrustglow_{left,right}_{down,forward}`, `hover_thrusters` | 4 |
| Chin gun | `gun_copilot_base` → `Gun_copilot_barel` | 6 |
| Rear turret | `Turret_read_base` → `turret_arm_rotate` → `turret_Handle` → `turret_Part2..7` | 6 |
| Warthog hookup | `ref_warthog_attach_location` (6.30, 6.31, 0) | Long-term |
| Collision hull | `collision_pelican` (visual-only today — see below) | 2, 7 |

### The nacelle hinge axis is measurable, and it is local Z

Each `Wing_*_root` is a flat disc with **zero thickness in Z** — a hinge collar,
whose axis is therefore its own local Z. The node origin is the disc centre, so
the rotation needs no pivot correction. Front collars sit at
x = −6.82, z = ±3.34; rear collars at x = +10.75, y = 9.35, z = ±1.9.

This is the one piece of the rig that had to be *derived* rather than read, and
it is worth stating explicitly because the obvious guess (a wing rotates about
the fore-aft axis, like a control surface) is wrong for a nacelle and would tilt
the engines sideways.

### The thrust FX are already split by mode

`Wing_*_ThrustEffect_down` and `Wing_*_ThrustEffect_forward` are separate meshes
with separate glow materials, per side. This is the best thing in the file. It
means **the wing rotation, the plume crossfade and the engine-audio crossfade
are all the same parameter** (`vector`, below), and the entire VTOL read comes
almost free. Nothing here needs a new authoring pass.

### Two traps in the rig

**Locked — `collision_pelican` cannot be used as it stands.** Its measured
extent is 30.63 × 10.91 × 24.28 m, i.e. the whole aircraft. `Vehicle._measureRig`
turns the collision shell into **eight AABB corner points**, which for a
Warthog is a defensible convex approximation and for a Pelican is a box the size
of a building with the airframe rattling around inside it. Its `asset.json` also
records unapplied scale and rotation and describes it as visual-only.

**Locked — after `npm run assets`, a named rig node is an `Object3D`, not a
`Mesh`.** This one is not in the rig, it is in the pipeline, and it is not in any
other doc.

`KHR_mesh_quantization` cannot put a mesh and a dequantization scale on the same
node when that node already has children, so the compressor moves the geometry
onto an inserted child which `GLTFLoader` then auto-names after the mesh.
Measured on the shipped Pelican:

| Named node | Runtime type | Where its geometry went |
| --- | --- | --- |
| `collision_pelican` | `Mesh` | stayed — it has no children |
| `Wing_front_left_root` | `Object3D` | child `Mesh004` |
| `door_rear_bottom` | `Object3D` | child `door_rear_bottom001` |
| `gun_copilot_base` | `Object3D` | child `Mesh046` |
| `Turret_read_base` | `Object3D` | child `Mesh065` |
| `Interior_Hull` | `Object3D` | child `Mesh048` |

**Rotating these is unaffected** — an `Object3D` rotates identically, so every
wing, gear, door and turret hinge below works as designed. What breaks, and
breaks *silently*, is any code that reads `node.geometry` or tests `node.isMesh`
on a named ref. The button meshes are the immediate exposure: Phase 5 needs
bounds off `Button_RearRamp_Exterior`, and that node carries no geometry.

The correct idiom is the one `_measureDoors` already uses — **traverse for the
mesh, never assume the named node is one.** `_measureLinkage`'s steering-wheel
branch (`/^steering_wheel$/i.test(o.name) && o.isMesh`) does assume it, and is a
latent break on the Warthog the moment that rig is re-exported with children on
the steering node.

**Locked — the door nodes do not match the discovery pattern.** The door system
discovers on `/^ref_door/i`. `door_rear_top`, `door_rear_bottom` and
`door_interior` will not be found. Renaming them in Blender to `ref_door_*`
inherits the outline, the ALT highlight and the hold-open-while-seated logic
with zero code, which is strictly cheaper than widening the pattern.

---

## What the rig still needs (the Blender asks)

Ordered by how much each one blocks.

### Blocking

1. **`ref_seat_*` — there are none at all.** Not even pilot and copilot; the
   cameras exist and the seats do not. The seat table parks a body on `ref` and
   falls back to a chassis-frame `offset`, so every seat on this aircraft would
   be a derived offset — which is the state `VEHICLE_PLAN.md` open question 3
   already calls out as unsatisfactory for *two* tailgate riders, let alone ten.
   Wanted: `ref_seat_pilot`, `ref_seat_copilot`, `ref_seat_gunner_rear`, and
   **6–8 troop-bay seats**. The benches are modelled (`Interior_Seats`,
   x −14.41…−0.56, z ±2.3) — the empties just have to land on them.

2. **A collision split for the bay.** One hull cannot both block the airframe
   from the outside and be walked on from the inside. Wanted, following the map
   convention exactly: **`collision_floor_pelican`** (bay deck, ramp, and the
   wing tops if riding them is wanted) and **`collision_wall_pelican`** (bay
   sides, bulkhead, and the exterior hull for impacts). `splitBySlope` then
   applies unchanged. `collision_door_rear_bottom` already parented under the
   ramp shows the pattern is understood.

3. **Apply the scale and rotation on `collision_pelican`** before anything
   raycasts against it.

### Cheap and high-value

4. `ref_muzzle_chin` on the chin barrel tip, `ref_muzzle_rear` on the turret
   tip. The barrel axis will be **derived** at load regardless — the Warthog's
   `ref_muzzle_gunner` carried a baked −90° Y and put rounds out of the side of
   the gun at exactly 90°, twice — but an authored empty gives the derivation
   something to be checked against.
5. Rename the three door nodes to `ref_door_*` (above).
6. `ref_camera_gunner_rear`, `ref_camera_chin`.
7. `ref_LandingGear_back_left`, to match the existing `ref_LandingGear_back_right`.
   The left counterpart today is an empty named literally `Empty`.

### Wanted, not blocking

8. **A gear-retracted pose.** There is no clip and no second set of empties, so
   gear-up needs either authored target rotations or a tuner. The project's own
   rule says build the tuner (Phase 5).

---

## What the current code cannot do

**Locked.** The first three were real refactors rather than adaptations, and are
done — kept here because the *reasons* outlast the fix and the next vehicle will
meet the same seams.

| Blocker | Where | Status |
| --- | --- | --- |
| **Seats were global, not per-vehicle.** `this.seats = V.seats.map(...)` read `CFG.vehicle.seats` — the Warthog's five — so a Pelican spawned with a jeep's seat list. | `vehicle.js` | ✅ `Vehicle.rig`, an overlay. Globals stay as the fallback. |
| **Suspension corners were hardcoded to four**, named `front_left/…/rear_right`, warning per corner if absent. A tricycle was not a different vehicle, it was four warnings and no suspension. | `vehicle.js` | ✅ `rig.corners`. `Wheel` itself needed no change — a gear strut IS a spring corner with steering and spin switched off. |
| **The spring divisor was a hardcoded 4** — a 33% error on any vehicle that is not a car. | `vehicle.js` | ✅ derived from `wheels.length`. |
| **`settleAt` bailed below four contacts**, putting a three-point vehicle down LEVEL on sloped ground. | `vehicle.js` | ✅ three points define a plane exactly; that is now the exact case, not the degraded one. |
| **`VehicleManager._spawnAll` hardcoded `'warthog'`**, and `maps.js` dropped every non-`FC_VEHICLE_` marker along with the Y on the ones it kept. | `vehicle.js`, `maps.js` | ✅ `CFG.vehicle.markers` prefix table; `maps.js` no longer knows what a vehicle is. |
| **Bots claim anything uncrewed**, including an aircraft they cannot fly. | `ai.js` | ✅ `rig.aiCanUse`, default true so a ground vehicle opts in for free. |
| **No Y clamp on the world.** `clampToMap` is XZ-only. | `world.js:364` | Open — phase 2 needs a ceiling; the bake's `maxY` is the natural one. |
| **`audio.js` has no looping source.** `_play` is one-shot. | `audio.js:64` | Open — phase 4 needs it for the engine/hover crossfade. |

**A gear strut is a spring corner with steering and spin switched off**, and
that is why the corner-count refactor is a table change rather than a new class.
`Wheel` holds a hardpoint, a ray, a spring, a damper and a contact patch. The
Pelican needs exactly those three times. Settling on the gear, weight transfer
onto the nose strut when the brakes bite, and a hard landing bottoming the
struts against the bump stop all come for free from code that already shipped.

### What ports unchanged

The reason to build this on `Vehicle` rather than as a parallel `AirVehicle`:
`_applyForce`, `_integrateRotation`, `_effectiveMass`, `_resolveContact`,
`_collideGround`, `_collideHull`, the fixed-substep accumulator, `_sleepCheck`,
`settleAt`, and the whole seat / camera / occupant / `syncOccupants` layer. That
is roughly 40% of `vehicle.js` and none of it knows what a wheel is.

A forked class would duplicate all of it, and the two copies would drift — the
same argument `VEHICLE_PLAN.md` makes for `Player.update` branching rather than
subclassing.

---

## The flight model — mode 1

**Working.** Halo-style: point the camera, the ship goes there, with weight.

Per substep, in order:

1. **Attitude command.** The camera's look direction becomes a desired
   quaternion. A PD controller drives angular velocity toward it —
   `torque = kP·axisError − kD·angVel` — clamped to `maxTorque`.

   **The clamp is where the weight lives.** A twenty-tonne airframe cannot snap
   through 90°, and the lag between where you are looking and where the nose
   has got to *is* the heft. Target peak pitch/yaw rates around 0.7–1.0 rad/s.
   This is the first number to turn in the tuning tab and the last one to be
   satisfied with.

2. **Roll.** Auto-bank into yaw, bank angle proportional to yaw rate, with A/D
   as manual override. Six lines, and it is most of what stops the aircraft
   reading as a floating brick.

3. **Collective.** Space and Ctrl trim a hover term against `CFG.gravity`
   (18 m/s² — nearly double real gravity, and a world constant every jump and
   fall already uses; do not reach for real aircraft numbers here). Neutral
   collective ≈ 1.0 g so it holds altitude hands-off; full ≈ 1.5 g climb.

4. **Thrust.** W/S along **hull forward**, through a falloff curve to nothing at
   `topSpeed` — the same shape as `_driveCurve` and for the same reason: top
   speed emerges from the curve and there is no speed clamp anywhere.

5. **Anisotropic drag.** Longitudinal low, **lateral and vertical high**. This
   is the second most important line after the attitude clamp, and it is the
   cheapest honest model of a wing: whip the nose sideways and the ship slides,
   then the slide bleeds off and it carves. Skidding stays possible and costs
   you speed, which is the trade that makes flying it a skill.

6. **Ground effect and gear.** Below roughly 1.5× gear height, blend the three
   suspension struts back in. Landing is then the existing spring solver doing
   its job.

7. **Hull collision.** Unchanged in mechanism, wrong in inputs — see the
   `collision_pelican` trap. Until the collision split exists, a hand-authored
   sample-point list in config (nose, tail, four nacelles, belly, fins) is the
   honest stopgap, and it should be *labelled* as one.

### Mode 2 — Star Citizen-style

**Long-term**, and deliberately not designed here. Decoupled attitude, per-axis
strafe thrusters, an IFCS-style velocity hold, cruise/precision modes.

What Phase 2 owes it is only a **seam**: a `flightMode` on the vehicle and one
branch in the controller. Because mode 1 already separates attitude from
velocity, mode 2 is a different controller over the same rigid body rather than
a rewrite. Building anything else for it now would be speculative.

---

## One parameter drives the machinery

**Working.** Define `vector ∈ [0, 1]`: 0 is full hover (nozzles down), 1 is full
cruise (nozzles aft). It is a function of forward airspeed over `cruiseSpeed`,
forced to 0 while the gear is down, and eased at a limited rate so it reads as
machinery rather than as a slider.

That single number drives three things:

- **The nacelles.** `Wing_*_root` rotation about local Z, mapped through
  authored angle triples at [hover, transition, cruise] — the piecewise-linear
  `_travelMap` pattern the suspension linkage already uses, and for the same
  reason: the two halves of the sweep do not move at the same rate.
- **The plumes.** Emissive crossfade `thrustglow_*_down` ↔ `thrustglow_*_forward`,
  plus `hover_thrusters`.
- **The engines.** `Pelican_hover_loop.wav` ↔ `Pelican_engine_loop.wav`.

Plus a **differential** term: nacelle angle nudged asymmetrically by the roll
and yaw command, so the engines are visibly doing the thing that is turning you.
Small, and it is most of what sells thrust vectoring.

**Locked — clone the glow materials per vehicle.** `clone(true)` shares
materials, so animating them in place lights up every Pelican on the map
together. This is the third time the project has met this trap: `ammodisplay.js`
documents it for the digit atlas and `_measureLinkage` documents it for the
Warthog's brake lamps.

---

## Walking on and in it

**Working**, and the largest single piece of work in this document. It deserves
its own honest accounting because it is not a variation on anything that exists.

`MapCollision` bakes geometry into **world space at load** — the whole design
assumes the ground never moves, and says so in its header. A 30 m aircraft doing
40 m/s breaks that assumption completely rather than stretching it.

What it needs:

1. **A per-vehicle BVH in the vehicle's LOCAL frame**, built once from
   `collision_floor_pelican` / `collision_wall_pelican`. Queries transform the
   point into local space, raycast, transform the answer back. `splitBySlope`
   applies unchanged: the deck holds you up, the flanks stop you.

2. **A carry frame, not a delta.** When a soldier grounds on a vehicle surface,
   store `(vehicle, localPos)`. Each frame: apply the walk input in local space,
   then recompute the world position from the vehicle's *current* transform.

   **Adding the platform's per-frame delta to a world position is the obvious
   implementation and it is wrong.** It drifts under rotation — the error is
   second-order in the rotation per frame and does not cancel — and it fails
   outright at speed. The local-frame version is exact, and it is also what
   makes standing on the ramp *while it lowers* work without a special case.

3. **Grounding gains a tier.** The two-tier rule everything uses (floor shell,
   then heightfield) becomes three: nearest vehicle deck first. Both the player
   path and `soldier._move`, or a bot walks through a deck the player is
   standing on.

**Realistic cost: 300–400 lines plus authoring, and it is the phase most likely
to overrun.** It is therefore staged last among the player-facing phases. The
existing `nearestFreeSeat` proximity entry makes the Pelican boardable from
outside on day one, and nothing in the flight model depends on the deck
existing.

---

## Getting in

**Working.** The described flow is: press the rear gate button, the gate opens,
walk in, sit down. That needs one genuinely new system.

The Warthog aims at **door meshes** via `doorAtReticle`. Generalise it to an
`interactableAtReticle` over anything named `Button_*`, with a config table
mapping button node to action:

| Button | Action |
| --- | --- |
| `Button_RearRamp_{Exterior,Interior,Pilot,Copilot}` | toggle `door_rear_top` + `door_rear_bottom` together |
| `Button_EngineStart_{Pilot,Copilot}` | engines on/off — gates flight, spins up the audio |
| `Button_Landinggear.001/.002` | gear up/down |

The same ALT-outline treatment the doors already have, and it costs very little
because each button is already a separate named mesh with sane bounds
(~0.15 m across).

It also gives the copilot something to do, which is what makes a two-seat
cockpit worth authoring seats for.

---

## Build order

**Working.** Each phase ends in something that can be *looked at* rather than
reasoned about, which is the same test `VEHICLE_PLAN.md` applies.

### Phase 0 — Intake ✅ DONE

`ASSET_PATHS.vehicles.pelican`, `npm run assets`, park one beside a Warthog and
a marine, screenshot.

**Built:** one `ASSET_PATHS.vehicles` entry. Nothing else — no new module, no
loader change, no `CFG.vehicle.pelican` block. That is the result: the intake
half of the vehicle system took a 30 m aircraft with no code at all.

**Measured, not asserted:**

| Check | Result |
| --- | --- |
| Compression | 20.0 → **13.0 MB**, all 85 authored node names intact |
| Size after facing correction | 24.278 × 13.859 × **33.161 m** (W × H × L) |
| Warthog, same method | 3.072 × 3.472 × 6.264 — matches `VEHICLE_PLAN.md` exactly |
| Facing | nose on +Z, **+X is left** (contacts at x = ±3.535) |
| Gear grounding | +7.9 / +7.9 / −15.7 mm across a 15.7 m gear base |
| Hull shell | `collision_pelican` found, hidden, `isMesh` true |
| Rig nodes | every wing root, door, button, turret and gun node resolves by name |
| Render | PBR correct under the RoomEnvironment PMREM — no black armour |

**Three predictions confirmed live**, which is what makes the blocker table
above measurements rather than a reading of the source:

- `pel.seats` came back as `['driver','gunner','passenger','rearLeft','rearRight']`
  — **the Pelican inherited the Warthog's five seats**, because `V.seats` is global.
- `pel.wheels.length === 0` — none of the four hardcoded corner names exist on
  a tricycle gear, and it warns four times and carries on with no suspension.
- `pel.hullPoints.length === 8` — eight corners of a 30 × 11 × 24 m box, which
  is the whole aircraft and then some.

**One thing found that was not predicted:** the quantization / `Object3D` trap
above. It cost nothing here and will cost Phase 5 an afternoon if it is not
known going in.

**Deliberately not done: anything that moves.** The aircraft is parked with
`asleep = true` for the screenshots — with no suspension corners it has nothing
holding it up, and gravity would sink it 1.5 m to its AABB hull before
`_collideGround` caught it. That is Phase 1's job, not a bug.

### Phase 1 — Per-vehicle config, and it sits on its gear ✅ DONE

**Built:** `Vehicle.rig` (the overlay), a config-driven corner table, marker-key
lookup, spawn drop, `CFG.vehicle.pelican`, and the `aiCanUse` gate.

**Measured** at both HQ markers, after 60 s of live 8x battle:

| Check | Result |
| --- | --- |
| Struts resolved | 3 — `front_middle`, `back_left`, `back_right` |
| Spring rate | 528,000 N/m = `mass*g / (3 * sag)` — the strut COUNT is honoured |
| Contacts at rest | **0.0000 m** above the ground, all three |
| Total load | −0.388% against `mass * gravity` |
| Nose share | **10.4%** — the load split `com.z = -3.6` was placed for |
| Mean compression | 0.2494 against a predicted sag of 0.2500 |
| Peak compression | 0.392 of 0.5 travel — **never bottomed** |
| Drop | 0.499 m, arriving at 2.4 m/s |
| Drift from spawn | **0.4994 m**, i.e. the drop and nothing else |
| Attitude | 0.93-0.98 degrees nose-up, and correct — that IS a tricycle sitting on 10/90 |
| Sleeps | yes |

**The Warthog is unregressed**, and that was the point of overlaying rather than
moving: 5 seats, 4 corners, 17 doors, turret measured, 16 arms, 4 springs,
steering wheel, `springK` 54,000 unchanged. `v.rig.seats === CFG.vehicle.seats`
is true by identity for the hog, so the SEAT tab's paste target never moved.

**Three bugs, all found by measuring rather than by looking:**

1. **The spring divisor was a hardcoded 4.** Invisible while every vehicle is a
   car; a 33% error the first time one is not. A three-strut aircraft would have
   been given springs sized for four corners and sagged past its ride height —
   and it would have read as "the Pelican tuning is wrong" rather than as a bug.

2. **Honouring the marker height literally turned every spawn into a crash.**
   The markers stand 3-7 m above the floor and `CFG.gravity` is 18, so that is an
   arrival at 11-15 m/s: measured on a Warthog, **12.8x more energy than its four
   springs can store over their entire travel**. Every vehicle on the map bottomed
   its stops and skated. The fall is now capped at what the gear can actually
   absorb, `travel * (1 - sag) / sag`, derived rather than picked — see the
   `dropMin` note in config. `settleAt` runs FIRST to fix the attitude to the
   ground it is going to land on, and the lift happens along world Y afterwards,
   so the aircraft falls parallel to the slope and lands on all three struts at
   once instead of on one corner.

3. **A bot squad claimed the Pelican and tried to fly it by driving.** Two bots
   in the cockpit holding `throttle -1 / steer -1` into an airframe with no wheel
   drive. It went nowhere — but "somebody is asking it to move" is exactly the
   condition that releases the park brake, and with the brake off a second effect
   took over: the suspension pushes along the CHASSIS up-axis, and a 0.97 degree
   static nose-up attitude tips 395,944 N of strut load into a **6,698 N**
   horizontal component, balanced almost exactly by **6,626 N** of rolling
   resistance at 0.3 m/s. The result was a perfectly constant 0.3 m/s creep that
   never triggered the sleep threshold and walked the aircraft off its pad
   forever. `aiCanUse: false` fixes the cause; phase 8 flips it.

   **The strut-axis term is still there and phase 2 should know it.** It is held
   only by the park brake. Any vehicle with a static pitch has it, the Warthog
   included — the hog's is invisible because its load split is even, so its
   attitude is flat.

**Deliberately not done:** anything that flies. `driveForce` is 0, so W does
nothing on the ground, which is the correct behaviour for an aircraft that does
not taxi.

### Phase 2 — Flight, mode 1 ✅ DONE

`Vehicle._flight` plus a flight branch in `Player._updateDriving`. Runs INSIDE
`step()`, after the suspension pass and before gravity, so an aircraft on its
gear is held up by its struts and one in the air is not. **There is no takeoff
state and no mode flag** — the ground/air transition is simply whether a strut
found ground this substep.

**The invariant, and the only thing worth defending:** nothing writes velocity
from the look direction. The look builds a desired ORIENTATION, a rate-limited
controller turns the HULL toward it, and thrust is applied along the HULL'S
forward. Where you end up is the integral of all three.

**Measured**, flying it through the real player path (deployed, seated, keys
held) rather than by driving the vehicle object directly:

| Check | Result |
| --- | --- |
| Engines on, no input, 4 s | stays parked — 3 struts down, zero rotation |
| Liftoff | 27 m in 2.5 s on collective alone |
| Hands off | holds, bleeding the climb through vertical drag |
| Cruise | **58.6 m/s**, dead level, heading held |
| 90° turn | arrives at −51.0° against −51.2° commanded, in ~3 s |
| Cost of the turn | 58.6 → 47.1 m/s, recovering to 57.3 |
| Dive at −25° look | hull tracks to −17.7°, recovers to −0.1° |
| Ceiling | clamps at **412.8 m** against 420, never exceeded |
| 30 s at full throttle | every quantity finite — no NaN |
| Warthog | unaffected: 0-20 m/s in 1.48 s, steers, 18.2° cornering lean |

**The drift is real and measurable**, which is the whole point of the model. On
a hard 90° demand at cruise:

| | peak |
| --- | --- |
| Velocity lagging the nose | **37.1°** |
| Sideways speed in the hull frame | **21.4 m/s** |
| Bank, auto-rolled into the turn | 43°, recovering to 1.1° |

**Four bugs, all found by measuring — and the last one only because the owner
said third person "works pretty good", which is a sentence with a shape.**

1. **The attitude controller fought the landing gear.** It torqued a PARKED
   aircraft, which rolled it off its own struts; going airborne then engaged the
   hover, and the Pelican took off purely by rotating — 4.4 m up, 26° nose-up,
   21° of bank, with nobody touching the collective. Fixed by making
   `hoverBlend` double as CONTROL AUTHORITY, which is the same physical fact
   twice: these are thrusters, so an airframe with its weight on its gear has
   neither lift nor control. It also makes the hand-off smooth in both
   directions rather than a hard `if (airborne)`.

2. **It could not take off.** `collective` is authority ABOUT the hover point,
   not total thrust, so gating the hover baseline on already being airborne was
   circular: the pilot was asking for 13 m/s² against a gravity of 18 and the
   struts held it down. Measured, full collective for 3 s moved it 0.2 m.
   Commanding lift now spools the engines to at least hover — which is what a
   VTOL does — while neutral on the ground still commands nothing at all.

3. **Auto-bank was coupling into pitch.** At `bankPerYaw` 1.1 a routine 90°
   turn commanded 48° of bank, and chasing a banked target from a level hull
   puts a genuine pitch component in the body-frame error: 19° of nose-up nobody
   asked for, plus a roll oscillation, because the bank command is itself a
   function of the yaw rate it helps produce. 0.8 keeps the lean without closing
   that loop as hard.

4. **First person was pointing the wrong way entirely**, and third person was
   fine — which is why it survived every measurement above. The ground-vehicle
   first-person frame is `v.quat * R_y(PI + yaw)`, correct while `yaw` is an
   offset from the chassis heading and a **double-count of the hull** once it is
   absolute. Measured in level cruise: the cockpit sat a constant **51 degrees
   off the nose and 141 degrees off where the pilot was looking**. Third person
   never showed it because `tiltTP` is 0 and that path uses the level frame.

   The fix is not to bolt the view to the hull. **What a cockpit should inherit
   is ROLL and nothing else** — roll is the one part of the hull's attitude that
   does not change where you are looking, so taking it costs no aim and buys the
   entire cue. Pitch and yaw are already the pilot's by construction, because
   the hull is chasing them. Verified: camera roll now tracks hull bank exactly
   (−14.2/−14.2, −25.4/−25.4) while the view stays **0.00 degrees** off the aim
   at every point in a turn. The 7-9 degrees between the camera's up and the
   hull's up mid-turn is the honest residual — the nose is lagging your look, so
   the two cannot coincide while the forwards differ.

   *The sign was wrong first time*, and it read as 33.7 degrees of head tilt on
   a 14.2 degree bank: the camera rolls about its own view axis, which points
   the opposite way to the hull's forward.

5. **A and D were swapped.** `roll` carries the same handedness as a ground
   vehicle's `steer` — positive is left, because +X is chassis left and A means
   left everywhere else in the game — but the negation that turns that into a
   bank angle was missing, so A rolled right and D rolled left.

   Two things made it findable rather than a matter of opinion. The auto-bank
   term was already correct, and the two are **summed into one angle**, so the
   model contained two terms disagreeing about which way left is. And the
   result was **asymmetric** — −30.2° holding A against +41.7° holding D —
   because the manual term subtracted from the auto term on one side and added
   on the other. It is ±41.7° now, with the automatic behaviour unchanged.

   The pod differential had the same error: `roll − angVel.y`, where both terms
   mean left when positive, so it cancelled in exactly the case it exists for.

**Two integration notes worth keeping:**

**In an aircraft the pilot's `yaw` is ABSOLUTE**, where in a ground vehicle it
is an offset from the chassis heading. A look measured against a hull that is
chasing that same look is a feedback loop. Pinning `vCamYaw` to 0 rather than
easing it makes the existing camera expression `R_y(PI + vCamYaw + yaw)`
collapse to a plain world heading — which is why the boom, the first-person eye
and `exitVehicle`'s hand-back to the on-foot convention all kept working
untouched.

**An aircraft's drag is anisotropic and lives in the flight pass**, so the
chassis's isotropic `airDrag` is skipped for one. Applying both would quietly
halve the wing: the whole point is that sideways costs far more than forwards,
and a term that does not care which way you are moving averages exactly that
distinction away.

**Deliberately not done:** the gear does not retract, the wings do not rotate,
the plumes do not light and the engines make no sound — phases 4 and 5. `E` at
altitude is refused rather than dropping the pilot out, because `exitPoint` puts
you on the ground beside the hull and from 300 m that is a teleport.

### Phase 3 — The AIR tab in `/chartest.html` ✅ DONE

`src/airrange.js`. 28 live fields across ATTITUDE, BANK, THRUST, LIFT, DRAG and
BODY & GEAR, four cameras (CHASE / COCKPIT / SIDE / TOP), free flight on the
arrow keys, and a paste-ready `CFG.vehicle.pelican` block.

**Locked — the manoeuvres are SCRIPTED, from seeded initial conditions.** This
is the air equivalent of the ground range's flat centre lane, and it matters
more here rather than less.

A hog can be driven down the same straight twice. **Nobody can hand-fly the same
90° turn twice.** Numbers taken off a hand-flown turn are not comparable between
two tunings, which makes them *worse than no numbers*, because they look like
evidence. So every measurement places the aircraft at a known altitude, attitude
and speed, and then flies it with a script. Free flight exists to feel a change
between two runs, not to measure it.

Six manoeuvres, each answering one question. Measured on the phase 2 values:

| | Result |
| --- | --- |
| **TAKEOFF** — does it get off the pad, and how hard | to 20 m in **2.03 s**, peak climb 14.9 m/s |
| **TOPSPEED** — what does it actually do, vs what is configured | **59.6 m/s** (215 km/h) against a configured 70; 0-40 in 2.9 s |
| **TURN90** — the signature manoeuvre | 90° in **3.18 s**, drift **31.3°**, slide 22.0 m/s, bank 25°, radius 91 m, 60→44 m/s |
| **TURN180** — the same, past the airframe's comfort | 180° in **5.08 s**, drift **52.2°**, slide 25.9 m/s, bank 38°, 60→34 m/s |
| **HOVER** — does hands-off hold altitude | drift **−0.06 m over 10 s** |
| **STOP** — what does letting go actually cost | half speed in 18.7 s / 770 m; **still 17.4 m/s after 45 s / 1363 m** |

**Top speed emerging 15% below the configured `topSpeed` is the model working
as designed** — thrust falls off toward that figure and drag finishes the job,
so there is no speed clamp anywhere and the real number has to be measured.

**Drift is the number this tab exists for.** If it ever reads near zero the
model has started writing velocity from the look direction, which is the exact
failure this whole design is built to avoid — and it is invisible from the
cockpit, because a ship that turns instantly and a ship that drifts look the
same from inside one.

**Two instrument bugs, both caught by distrusting the instrument:**

1. **`STOP` reported a result when it had actually hit its own time cap.** A cap
   reported as a measurement is precisely the "looks like evidence" failure the
   scripted design exists to prevent, so it now leads with time-to-half-speed
   (which always completes) and says **DID NOT STOP** in as many words when it
   times out.
2. **The range was too small for its own test.** `STOP` reported 880 m, which
   was exactly `R − 20` — the aircraft was pinned against `clampToMap`, and a
   wall does not fail loudly, it just stops the aircraft and reads as drag it
   does not have. The range went to 1400 m and the straight-line runs now start
   at the far edge. Every other figure was unchanged, which is what says the
   wall had not been contaminating them.

**What the numbers say about the model, for whoever tunes it next:** the
Pelican coasts almost forever. `dragLong` is deliberately an order of magnitude
under the lateral and vertical terms — that is the wing — but the consequence is
that releasing the throttle at cruise costs 770 m to shed half your speed. That
may be exactly the heavy, spacecraft-like feel wanted, or it may be too much;
it is now a number on a panel rather than a thing nobody had looked at.

### Phase 4 — Wings, plumes and engines ✅ DONE

`Vehicle._measureVectorRig` / `updateVector`, `GameAudio.loop`, and the engine
crossfade in `player.js`. One parameter — `vector`, 0 hover to 1 cruise — drives
the pod tilt, the plume crossfade and the engine note together, so the aircraft
can never sound like it is in a configuration it does not look like it is in.
It comes from FORWARD airspeed (an aircraft sliding sideways at 30 m/s is not
cruising), is forced to hover by weight on the gear, and is rate-limited so it
reads as machinery.

Pods and materials are **discovered, not listed** — anything matching
`Wing_<family>_<side>_root` is a hinge — so a fifth pod costs an export and no
code.

**What the rig actually turned out to be, and it changed the design twice:**

1. **The pods' two nozzles are perpendicular** — 89.5° apart on the front pods,
   98° on the rear — so a SINGLE rotation points the VTOL nozzle straight down
   *and* the rear exhaust straight aft. On the front pods that angle is −24.7°,
   and the two independent solutions agree to within half a degree (24.7 and
   24.2), which is what says it is real and not a coincidence. **The pods
   therefore do not need to rotate at all for the nozzles to be correct.** One
   authored pose serves both configurations, so the plume crossfade is what
   actually sells hover-versus-cruise and the tilt is a flourish on top.

2. **`Wing_*_root` is the parent of the whole wing, not just the nacelle**, so
   rotating it rotates the AEROFOIL. Swept across 0 / −12 / −25 / −35°, the
   25° pose stops reading as "the pods are vectoring" and starts reading as
   "the wing is drooping". The swing is therefore small and centred on the
   AUTHORED pose rather than on the computed alignment — the authored pose is
   the one the artist composed to look right, and the plume cards are glowing
   quads whose exact aim nobody can see.

   **This is the Blender ask if a real VTOL pod rotation is wanted:** a
   `ref_pod_*` node authored BETWEEN the wing and the engine. Until that exists,
   ±10° is the honest amount.

**Two bugs, and the second is the kind that hides:**

1. **Glow materials must be cloned per vehicle.** `template.clone(true)` shares
   them, so animating in place would light every Pelican on the map together.
   The third time this project has met the same trap, after `ammodisplay.js`'s
   digit atlas and the Warthog's brake lamps. Verified: zero materials shared
   between the two spawned Pelicans.

2. **`hover_thrusters` has emissive `#000000`.** It is a transparent
   `MeshPhysicalMaterial`, so writing `emissiveIntensity` to it changed a number
   and rendered *nothing at all* — a silent no-op that looked exactly like a
   working crossfade. Which knob a material responds to is now decided per
   material at clone time: `thrustglow_*` carry a real emissive (`#bdffff`) and
   take intensity, `hover_thrusters` takes opacity.

**Measured**, engines off → all cold; at hover → down nozzles 3.0, hover card
0.85 opacity, rear exhaust 0; at cruise → rear exhaust 4.0, everything else 0;
at 0.5 → all mid. In-game the parameter reached 1 at 58.7 m/s against a
`cruiseSpeed` of 32, and both audio loops started on entry, crossfaded with the
parameter and were released on exit.

**Audio is owned by the controller, not by `Vehicle`** — deliberately.
`Vehicle` takes a `world` and nothing else, and that narrow surface is what lets
the physics be lifted onto the AIR tab with no Game in sight; handing it an
audio system would cost that for one crossfade. `GameAudio.loop` is the one
non-fire-and-forget path in that file, and it returns a handle because an engine
runs for as long as the pilot is aboard. Live loops are tracked so a match
teardown can stop them: a loop never ends on its own, and one left running
across a RESTART MATCH is an engine nobody can find to switch off.

**Still not voiced:** every Pelican except the one the player is in. Positional
engine audio for the whole map is a different feature and wants a pooled,
distance-attenuated path like `playShotAt`, not two more loops per airframe.

### Phase 5 — Gear, hatch and buttons ✅ DONE

**The tuner this phase was supposed to need does not exist, and that is the
owner's doing rather than a shortcut.** The plan called for a GEAR tab because
the rig had no retracted pose. The owner authored it the other way round: every
leg carries its DEPLOYED rotation, so **retracted is identity** and raising the
gear is a slerp toward zero. Nothing to tune, nothing to guess.

Measured deployed angles: 60.8° and 62.2° on the main legs, 122.2° on each nose
bay door.

**The node list is config, not discovery**, and that is load-bearing:
`LandingGear_*` also matches the wheels and axles hanging under each leg, and
rotating those would spin the tyres into the bodywork.

**The hatch** works because the owner also re-authored it — `ref_door_rear_top`
and `ref_door_rear_bottom` are now parent empties with the meshes at identity
underneath, so the existing `/^ref_door/i` discovery finds them with no code.
Both hinge axes were **measured, not guessed**: with the refs at identity inside
the raw model frame a node's local Z is the chassis's X, so both halves swing
about local Z and both want a NEGATIVE angle. Probing 0/45/90 about all three
axes showed +90 swinging the ramp down and *forward into the hull*, which is
what says the sign is the other way.

The ramp stops near horizontal because the hinge geometry says so — it is
2.39 m long on a hinge 2.58 m up, so it was never going to reach the ground.
Troops step down.

**Buttons** are discovered off `Button_*` and mapped to an action by config, so
the rig names what exists and config says what it does — which is why four ramp
buttons scattered across the aircraft cost one entry's worth of behaviour.
`pressButton` lives on the vehicle rather than the controller so the same switch
works from the cockpit, from inside the bay and from the ground without three
copies of the mapping. A switch under the crosshair **outranks the seat offer**:
standing at the tail looking at the ramp control and pressing E must work the
ramp, not sit you down.

**This is the phase the intake trap was waiting for.** `npm run assets`
quantizes geometry, which moves a named node's mesh onto an auto-named child —
so `Button_RearRamp_Exterior` is an `Object3D` carrying no geometry, and reading
`node.geometry` for its bounds gets `undefined`. Traversing for the mesh is the
only correct idiom. Flagged at intake in phase 0; it would have cost an
afternoon here.

**Verified:** all 8 buttons mapped; gear retracts to exactly 0° and returns to
its authored angles; the ramp drives both halves together and closes; engines
toggle.

**`N` toggles the gear**, as a shortcut rather than a replacement — the in-world
switches still work. Gear earns a key where the ramp does not, and the
difference is *when* you use them: the ramp is a deliberate action taken on foot
with time to look at what you are pressing, and the gear comes up seconds after
takeoff while you are looking where you are going. A switch you have to aim at
is the wrong shape for that. Any seat, because a copilot raising the gear is a
normal division of labour.

**The interaction ray starts at the SEAT'S EYE, not the camera**, and this was
found the only way it could be — by the owner trying to raise the gear and not
being able to. The ray was built from `camera.position`, which in third person
is 38 m behind the hull, so every cockpit switch sat outside the 4.5 m reach and
E fell straight through to "get out". Third person is a choice about where the
CAMERA is, not about where you are sitting. Measured with the camera 48.1 m out:
the old ray found `nothing`, the seat-eye ray finds the switch. It had killed
the ramp and engine switches too, in the exact camera mode the aircraft is most
often flown in.

**Two things it does NOT do, both deliberate:**

**Gear is cosmetic.** The suspension's contact points are measured once at
construction in the chassis frame, so retracting the gear does not move them —
an aircraft landed gear-up still lands on its invisible struts. Making that hurt
is a damage-model question, not an animation one.

**Engines start on entry and the button toggles them**, rather than the button
being the only way to start. A pilot who sits down and cannot work out why the
aircraft will not fly is a worse problem than a switch that is merely useful.

**The rig has TWO retraction mechanisms, not one**, and reading the nose leg's
identity rotation as a missing pose was wrong. The main legs and the bay doors
*swing* — they carry a deployed rotation and fold to identity. The nose leg is a
strut that *slides*: it has no rotation because it only ever translates straight
up into its bay. A part with no rotation is not always a gap; sometimes it is a
different machine.

So a gear part declares `lift` (translate) or nothing (rotate), and the nose leg
lifts 1.55 m — enough to carry the wheel from y −0.03 to **1.52**, clear of the
closed door line at 1.32. Its wheel and its `ref_contact_front_middle` are both
children of that one node, so a single translation takes the whole assembly.

**`phase` sequences the nose bay**, and without it the doors close through the
wheel. Retracting (1 → 0) the leg lifts over 1.0 → 0.4 and only then do the
doors swing shut over 0.4 → 0; deploying runs the same order backwards, doors
first. Measured through a full cycle: at pos 0.58 the leg is at y 0.96 with the
doors still at their full 122.2°, and the doors do not begin moving until the
leg has stopped.

**Still open, one small Blender ask:** `door_interior` was not renamed, so the
cockpit bulkhead is not discovered and does not open. `ref_door_interior` is the
whole fix.

### Phase 6 — Seats and guns

Pilot, copilot, rear gunner, chin gun, troop bay. Needs the seat empties. Turret
axes derived off the rig and aim closed-loop on the **measured barrel
direction** — this rig carries the same baked-rotation risk that caught the
Warthog out twice, and the closed loop needs to know none of it.

### Phase 7 — The walkable deck

The local-frame BVH and the carry frame, for player and soldier both.

### Phase 8 — Bots fly

Squad-level transport decision, LZ selection, drop-off. Reuses
`vehicledriver.js`'s narrow contract — write `input`, read `pos`/`quat`/`speed`,
nothing else — which is what made the ground driver testable in isolation.

**Phases 0–4 give a Pelican that flies well and looks alive. 5–7 give the one
described above. 8 makes it matter to the match.**

---

## Open questions

### 1. Does the Pelican spawn, or does it arrive?

A 30 m aircraft parked at an HQ is a 30 m aircraft the enemy can walk up to.
Spawning it on a pad is the cheap answer; flying it in on request is the
interesting one, and it is also the answer that makes `FC_AIR_*` a landing zone
rather than a parking space. Affects Phase 8 and the game-type economy equally.

### 2. Do the wings carry riders?

The wing tops are large, flat and reachable from the ground when the aircraft is
parked. Including them in `collision_floor_pelican` is one authoring decision
and no code. It is also how people end up riding into battle on the outside of
an aircraft, which may be exactly right or exactly wrong.

### 3. What happens to occupants when it dies?

The Warthog has no damage model yet, so this has never had to be answered. A
Pelican with ten people in it makes the answer matter much more: everyone dies,
everyone is ejected, or the wreck falls with them still aboard. This is a
game-feel call, not a code one.

### 4. Does the Warthog hookup happen?

`ref_warthog_attach_location` exists and `VEHICLE_PLAN.md` already lists the
hog's tow hooks against "towing, or Pelican pickup". It is **Long-term**, but
the empty is authored, so nothing in the seat or physics design should exclude a
vehicle being a passenger.

### 5. Does a Pelican cost resources?

Same question `VEHICLE_PLAN.md` open question 5 asks of the Warthog, with a much
larger number attached. **Working:** it inherits whatever the ground vehicles
settle on, and this document does not pre-empt that.
