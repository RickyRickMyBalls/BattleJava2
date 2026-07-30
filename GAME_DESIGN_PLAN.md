# BattleJava2 - Living Game Design Plan

**Document status:** Living pre-production plan  
**Last updated:** 2026-07-29  
**Current phase:** Concept definition and first-playable planning

This document records agreed decisions, working proposals, open questions, and ideas for the game. It should be updated whenever a design decision changes.

## Decision labels

- **Locked:** Treat as a project requirement until deliberately revised.
- **Working:** Current direction, but it must be validated through play.
- **Open:** A decision is still required.
- **Long-term:** Part of the intended future, not required for the first playable.

## High concept

**Working:** A large-scale, squad-focused combined-arms shooter that combines:

- The battlefield structure, teamwork, and sense of consequence associated with *Hell Let Loose*.
- The approachable class/loadout system, large battles, and spectacle associated with *Battlefield*.
- The readable combat sandbox, distinctive weapons, vehicles, and equipment associated with *Halo*.

The game should create the feeling of participating in a much larger war while ensuring that an individual player, their squad, and their chosen role all make meaningful contributions.

The intention is to take high-level inspiration from these games while developing original factions, weapons, maps, rules, presentation, and terminology.

## Visual and world direction

### Science-fiction aesthetic

**Locked:** The game's aesthetic and world are inspired by the military science-fiction feel of *Halo*.

This direction is supported by an existing local library of custom models and assets. The visual language can include:

- Armored science-fiction infantry.
- Readable team colors and silhouettes.
- Large military installations and outdoor battlefields.
- Futuristic conventional firearms.
- Experimental or energy-based battlefield equipment.
- Distinctive ground vehicles and, later, aircraft.
- A clean military HUD with strong tactical readability.

The Halo influence is primarily the **aesthetic, world tone, and combat sandbox**. The game's match structure, classes, squad hierarchy, logistics, AI battlefield, factions, story, terminology, and exact mechanics should develop their own identity.

### Asset rights boundary

**Locked:** Existing assets may be used for local prototyping while their provenance is reviewed. Before any public build, every shipped model, texture, sound, icon, animation, name, and environment must have clear redistribution rights.

The previous prototype's own license notes identify several assets and names as associated with Halo and lacking recorded redistribution permission. Those files are useful for internal development, but their presence does not establish permission to publish them. Any directly derived or unlicensed content must eventually be replaced, relicensed, or confirmed as original and distributable.

## Locked project requirements

### Baseline battle size

- The standard battle is **32 combatants versus 32 combatants**.
- Each team always has 32 occupied combatant slots during normal play.
- Empty player slots are filled by AI-controlled bots.
- A real player joining a match replaces a bot rather than increasing the team's combatant count.
- A player leaving is replaced by a bot so the battle remains 32v32.

### First playable

- The first playable does **not** require multiplayer.
- It must support one local human player and 63 bots.
- The human and bots participate in the same 32v32 battle rules intended for the eventual multiplayer game.
- The first playable is a gameplay, AI, scale, and performance test - not a separate single-player game mode.

### Scaling direction

- **Current canonical scale:** 32v32.
- Combatant counts will only increase after the current target maintains acceptable frame pacing and simulation performance.
- **Long-term goal:** 100v100, for a total of 200 active combatants.
- Scaling will happen in measured steps rather than jumping directly from 64 to 200 combatants.

### Teamplay

- Players are organized into squads.
- Squads function as small teams inside the larger battle.
- Players choose a class and a loadout.
- Classes contribute a recognizable capability to both the squad and the team.

## Design pillars

### 1. The battlefield always feels alive

The battle continues beyond the player's immediate location. AI soldiers contest territory, defend positions, move supplies, use emplacements, and reinforce attacks. Distant gunfire and movement should represent actual activity whenever practical.

### 2. Humans provide judgment; AI provides scale

Bots make the world populated and keep teams complete. Human players should provide the tactical creativity, coordination, leadership, and specialist decisions that change the course of a match.

### 3. Every squad has a job

A squad should understand what it is contributing: assaulting, defending, supporting, scouting, constructing, destroying armor, or operating a vehicle. Team success should require several kinds of contribution.

### 4. Weapons have clear identities

Weapons should be understandable at a glance and serve distinct tactical purposes. New weapons should usually be sidegrades rather than direct statistical upgrades.

### 5. Large-scale without unreadable chaos

Team markers, audio, silhouettes, tracers, objective presentation, and map design must help players understand a busy battlefield. More combatants are only valuable if players can still make informed decisions.

### 6. Performance is a game feature

AI count, effects, map detail, vehicles, physics, and networking must all live within explicit performance budgets. Performance instrumentation is required from the beginning.

## Battle composition

Each team contains exactly 32 combatant seats. A seat can be controlled by either:

- A human player controller.
- An AI controller.

The character, class, inventory, team, squad, score, and objective contribution belong to the combatant seat rather than to the controller. This is important because it allows a human and a bot to exchange control without creating two different kinds of soldier.

### Human joining behavior

**Working proposal:**

1. The server reserves an appropriate bot-controlled seat.
2. The human joins the bot's team and squad.
3. Control transfers at a safe transition, such as the bot's next death, redeployment, or a protected spawn location.
4. The player may select a different class or loadout on the next spawn.

A bot should not visibly disappear during a firefight merely because a human connected.

### Human leaving behavior

**Working proposal:**

- A disconnected player's combatant remains in the match.
- After a short reconnect grace period, AI assumes control.
- The character retains its current team, squad, class, and objective state.
- If safe live takeover is unreliable, bot control begins on the soldier's next respawn.

## Squad organization

The exact squad size is still open because 32 must divide cleanly into the team structure.

### Proposed structure

**Working:** Four squads of eight combatants per team.

Each eight-person squad can operate as two four-person fireteams when it needs to split. This supports a useful variety of roles without requiring too many independent squad leaders.

This structure must be tested against an alternative of eight smaller four-person squads. The test should compare:

- Communication load.
- Squad cohesion.
- Role availability.
- AI command complexity.
- Frequency of orphaned or ineffective squads.
- How easily new players understand the hierarchy.

### Squad type versus class

- **Squad type** describes the squad's overall battlefield purpose.
- **Class** describes an individual combatant's equipment and responsibility.

Possible squad types:

- Assault/line infantry.
- Weapons/support.
- Reconnaissance.
- Engineering/logistics.
- Vehicle crew.

The first playable only needs assault/line infantry squads. Other squad types can initially be represented by limited specialist roles.

## Initial assault squad

The following is the current eight-person working roster:

1. **Squad Leader**
   - Coordinates the squad.
   - Issues contextual orders.
   - Places or enables a squad rally point.
   - Communicates with other leaders.

2. **Assault**
   - Leads close and medium-range attacks.
   - Carries offensive grenades or breaching equipment.

3. **Rifleman**
   - General-purpose fighter.
   - Provides ammunition or another basic squad resource.

4. **Rifleman**
   - General-purpose fighter.
   - May select a different primary weapon profile from the other Rifleman.

5. **Medic**
   - Revives and restores squad members.
   - Uses smoke to recover casualties or cover movement.

6. **Support**
   - Provides ammunition, suppression, or deployable cover.

7. **Engineer**
   - Repairs, builds, breaches, or destroys battlefield equipment.

8. **Flex Specialist**
   - Anti-vehicle, additional Assault, additional Support, or another role selected for the situation.

This roster is a starting point, not a final class lock.

## Class and loadout model

**Working loadout format:**

- One primary weapon.
- One secondary pistol.
- One grenade or tactical throwable.
- One class-defining gadget.
- One selectable utility gadget.

Class identity should come mainly from gadgets, responsibilities, and team contribution. Weapon restrictions should exist for balance and role clarity, not simply because a class name dictates one gun.

### Initial primary weapon families

#### Assault rifle

- General-purpose automatic weapon.
- Dependable at close and medium range.
- The easiest weapon family for a new player to understand.

#### Battle rifle

- More deliberate medium-to-long-range weapon.
- Rewards accuracy and controlled fire.
- Less forgiving in close quarters.

#### Shotgun

- Dominant at very close range.
- Useful in buildings, trenches, and fortifications.
- Limited in open terrain.

#### Dual SMGs

- High mobility and close-range damage output.
- Poor performance at range.
- Cannot aim down sights in the conventional manner.
- Long or vulnerable reload cycle.
- The player may need to lower the weapons before using a grenade or gadget.

Dual SMGs should be a specialist sidegrade and not a superior version of a normal SMG.

### Secondary weapons

- Every standard infantry class receives a pistol.
- Pistols are fallback weapons rather than miniature primary weapons.
- Sidearm variants should emphasize handling, magazine capacity, stopping power, or accuracy without producing one obvious best choice.

### Battlefield equipment

**Working:** Rare or especially powerful weapons and equipment may be acquired on the battlefield instead of selected in a normal loadout. This can create contested sandbox opportunities and prevent heavy weapons from becoming routine.

Possible examples include:

- Rocket launchers.
- Heavy sniper or anti-materiel weapons.
- Experimental energy or electromagnetic weapons, depending on the setting.
- Portable defensive equipment.
- Limited-use target-designation equipment.

## Core match concept

### Primary mode: Frontline

**Working:** Teams fight over a connected sequence of battlefield sectors.

1. Teams deploy from headquarters and forward positions.
2. Squads move toward active sectors.
3. The sides contest several useful locations inside the sector.
4. Capturing the sector moves the frontline.
5. Defenders fall back and reorganize.
6. Attackers establish forward support before pushing again.
7. A team wins by taking the final enemy sector or exhausting enemy reinforcements.

Each sector should contain several tactically meaningful locations rather than one capture circle. Examples include a village, bunker line, bridge, ridge, communications site, or supply route.

### Match duration

**Working target:** 35-50 minutes.

The first playable may use a shorter match for iteration. It must still test the same capture, death, reinforcement, and victory rules.

### Reinforcements

**Working:**

- Teams have a reinforcement or ticket resource.
- Death, destroyed vehicles, and lost strategic assets may consume this resource.
- Forward spawn locations reduce travel time but can be discovered and destroyed.
- A team that loses a sector should have a chance to establish a new defense rather than being spawn-trapped.

## Infantry combat direction

The final lethality model is open. The current intended compromise is:

- Exposed soldiers die quickly enough that cover and positioning matter.
- Clear feedback gives an attentive player a chance to respond.
- Reviving creates squad-level recovery without making every casualty reversible.
- Repeated downs or especially severe damage can prevent revival.
- Medical support remains valuable.
- Suppression affects awareness and weapon handling without removing player control.

### Open combat questions

- Does infantry have conventional health, armor plus health, or a limited regenerating protection layer?
- How lethal should headshots be?
- How long is the revive window?
- Can every class revive slowly, or only the Medic?
- How much weapon spread is acceptable compared with recoil and projectile simulation?
- Should bullets be physical projectiles, hitscan, or a distance-based hybrid?

## AI design

### AI purpose

Bots exist to:

- Keep every combatant seat occupied.
- Create the scale and pressure of a real battle.
- Participate competently in objectives.
- Support human-led plans.
- Provide a useful match even when only one human is present.

Bots do not need to imitate every possible human behavior. They need to be readable, fair, useful, and performant.

### First-playable AI capabilities

Bots should be able to:

- Spawn and select a valid class.
- Form squads and recognize squad leadership.
- Navigate between sectors and tactical locations.
- Attack or defend an assigned objective.
- Detect, engage, and pursue enemies within sensible limits.
- Choose nearby cover.
- Avoid obvious friendly-fire situations.
- Revive allies when their role permits and the area is reasonably safe.
- Use ammunition or medical supplies.
- Throw basic grenades.
- Respond to contextual orders such as follow, move, hold, defend, attack, and suppress.
- Die, respawn, and rejoin their squad.

### Later AI capabilities

- Use transports.
- Crew vehicles.
- Repair and resupply vehicles.
- Construct defenses.
- Coordinate smoke and suppression.
- React to armor and call for anti-vehicle help.
- Flank or retreat based on local battlefield conditions.
- Take over commander or squad-leader responsibilities.

### AI update tiers

To make 64 and eventually 200 combatants practical, AI fidelity should depend on relevance:

- **Near the human:** Full perception, cover choice, combat movement, animation, and frequent decision updates.
- **Nearby active battle:** Normal combat simulation with reduced decision frequency where safe.
- **Distant active sector:** Simplified navigation, target selection, and combat resolution.
- **Far or hidden:** Strategic movement and low-frequency simulation without expensive presentation work.

The game must avoid distant AI behaving like a completely unrelated spreadsheet simulation. Transitions between fidelity tiers should preserve position, health, objective state, and credible battle outcomes.

## First playable definition

The first playable is successful when one person can launch a complete 32v32 battle, join either team, select a squad/class/loadout, fight alongside bots, affect an objective, die, respawn, and reach a valid match result.

### Required content

- One graybox battlefield.
- Two headquarters areas.
- Three connected sectors.
- Several tactical locations per sector.
- One human-controlled infantry character.
- 63 AI-controlled infantry characters.
- Assault rifle, battle rifle, shotgun, dual SMGs, and pistol.
- Squad Leader, Assault, Rifleman, Medic, and Support behavior.
- Basic class gadgets.
- Team and squad assignment.
- Objective capture rules.
- Death, optional downed state, respawn, and reinforcement rules.
- Simple rally point or forward spawn system.
- Minimal HUD, deployment screen, class/loadout screen, tactical map, scoreboard, and end-of-match state.
- Performance and AI debug overlays.

### Explicitly not required

- Online multiplayer.
- Matchmaking.
- Account progression.
- Final art.
- Final animation quality.
- Destructible environments.
- Aircraft.
- Full logistics simulation.
- A large vehicle roster.
- 100v100 support.

### First-playable test questions

- Is fighting with and against bots enjoyable?
- Does 32v32 feel meaningfully larger than a conventional small-team shooter?
- Can the player understand the frontline and current objective?
- Do squads remain together often enough to feel like teams?
- Does the player's chosen class make a noticeable contribution?
- Are AI deaths and kills believable and fair?
- Are there excessive frame-time spikes when many combatants meet?
- Can the full match run without navigation failures or accumulating performance degradation?

## Performance and scale plan

### Required instrumentation

The first playable should display or record:

- Average frame rate.
- CPU and GPU frame time.
- Frame-time spikes and percentile lows.
- Time spent in AI decision-making.
- Time spent in navigation and path requests.
- Active and visible combatant counts.
- Projectile, effect, and sound counts.
- Draw calls and rendered triangle counts.
- Memory use.
- Match simulation tick time.
- Number of AI in each fidelity tier.

### Initial performance gate

**Open:** Target hardware and exact frame-rate requirement must be defined.

Until then, a build should not be considered stable merely because its average frame rate is high. It must maintain consistent frame pacing during the largest expected 32v32 fights and during a full-match soak test.

### Scaling ladder

After 32v32 is stable, experimental builds can test:

1. 40v40 - 80 total combatants.
2. 48v48 - 96 total combatants.
3. 64v64 - 128 total combatants.
4. 80v80 - 160 total combatants.
5. 100v100 - 200 total combatants.

Progress to the next tier only when:

- The current tier meets the chosen frame-time target.
- A complete match can run without worsening performance over time.
- AI still reacts within acceptable time.
- Navigation queues remain controlled.
- Visual density remains readable.
- Battlefield and squad behavior remain fun rather than merely crowded.

The public game should remain 32v32 until a larger scale is both technically stable and demonstrably better.

## Technology direction

### Greenfield implementation

**Locked:** BattleJava2 is a new implementation. The old BattleJava codebase is not the foundation and will not be copied wholesale.

The old project can still contribute:

- Design lessons and known failure modes.
- Behavioral examples for frontline, combat, logistics, and vehicles.
- Test scenarios that can be rewritten against the new architecture.
- Custom assets that pass the asset inventory and rights review.

It will not contribute runtime architecture by default. No old `src`, `dist`, `node_modules`, package lock, or configuration should be imported merely to save setup time.

### Base stack

**Working stack decision:**

- **Language:** TypeScript in strict mode.
- **Runtime output:** JavaScript modules.
- **Build and development tooling:** Vite.
- **3D renderer:** Three.js using `WebGLRenderer` initially.
- **3D asset format:** GLB/glTF 2.0.
- **Physics candidate:** Rapier 3D for collision queries, character capsules, and selected dynamic objects.
- **HUD and menus:** HTML/CSS DOM overlays.
- **Heavy simulation work:** Web Workers with typed-array messages or transferable buffers.
- **Future authoritative server:** A headless TypeScript/JavaScript runtime that imports the same renderer-independent simulation rules.

TypeScript is chosen over untyped JavaScript because the project will have many interacting data contracts: combatant seats, controllers, squads, orders, AI observations, weapons, objectives, physics events, snapshots, and network commands. TypeScript still compiles to JavaScript and keeps the familiar web development foundation.

### What Three.js owns

Three.js should own:

- Scene, camera, renderer, lighting, and post-processing.
- Loading and presenting GLB assets.
- Character and vehicle visual adapters.
- Animation playback.
- Particles, tracers, decals, and visual effects.
- Frustum culling, visual LOD selection, instancing, and batching.
- Render statistics and GPU-facing diagnostics.

### What Three.js does not own

Three.js is a renderer rather than a complete game engine. It must not become the source of truth for:

- Match rules.
- Combatant health or inventory.
- AI decisions.
- Squad and objective state.
- Capture progress and tickets.
- Spawn eligibility.
- Networking authority.
- Saveable state.
- Physics outcomes.

Simulation entities should use plain serializable data and numeric IDs, not `Object3D`, `Mesh`, or Three.js vector instances.

### Runtime boundaries

```text
Main browser thread
  input + DOM UI + audio + Three.js rendering
                    |
          compact state snapshots
                    |
Simulation worker
  match + combatants + squads + AI + objectives + navigation scheduling
                    |
         shared pure TypeScript rules
                    |
Future headless server
  authoritative match + validation + bot controllers + network snapshots
```

The first playable can run the authoritative simulation locally in a worker. Later multiplayer should move authority to a server without replacing the combat rules or changing what a combatant seat means.

### Physics boundary

Rapier is a working choice, but full rigid-body simulation is not required for every soldier.

- Infantry should use lightweight capsule colliders and kinematic movement.
- Static battlefield collision should use simplified authored proxies.
- Ray and shape queries should support weapons, visibility, movement, and cover tests.
- Vehicles and genuinely dynamic objects may use richer physics where it improves play.
- Distant bots should not each run the same expensive collision and movement work as a combatant beside the player.

### Rendering scale strategy

The renderer must be designed around distance and importance tiers:

- **Immediate:** Full character model, animation, shadows, weapon model, and effects.
- **Near battle:** Full silhouette with reduced animation, shadow, and effect cost.
- **Distant visible:** Simplified mesh, animation representation, material, and update rate.
- **Hidden or strategically simulated:** No rendered character until relevant.

Use Three.js instancing or batching for repeated static props, simple effects, projectiles, markers, and suitable distant representations. Do not assume ordinary `InstancedMesh` automatically solves skeletal character animation.

Use visual LODs and explicit draw-call budgets from the first battlefield test. Start with `WebGLRenderer`; keep the render adapter isolated so WebGPU can be evaluated later without changing game rules.

### Worker and data strategy

Heavy AI and battlefield simulation should be able to leave the main browser thread.

- Use dense numeric entity IDs.
- Prefer typed arrays for high-volume transform and state data.
- Send compact changed-state snapshots rather than cloning large object graphs every frame.
- Use transferable `ArrayBuffer` objects when measurement shows messaging copies are expensive.
- Keep DOM, audio presentation, and Three.js scene mutations on the main thread.
- Measure worker time, message size, message frequency, and main-thread apply cost independently.

### Technical references

- [Three.js game manual](https://threejs.org/manual/en/game.html)
- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [Three.js LOD](https://threejs.org/docs/pages/LOD.html)
- [Vite getting started](https://vite.dev/guide/)
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)
- [Rapier JavaScript character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)

## Architecture principles

These principles apply within the chosen Three.js/TypeScript foundation:

- Gameplay simulation must be separate from rendering and visual effects.
- Human and AI controllers must drive the same combatant interface.
- Solo testing should use the same authoritative match rules intended for multiplayer.
- Classes, weapons, gadgets, squads, and objectives should be data-driven.
- AI decisions should not be embedded directly in animation or rendering logic.
- Performance probes and debug displays must be easy to enable.
- Input should be expressed as gameplay actions rather than scattered physical key checks.
- Assets should use stable identifiers and clear categories.
- Visual effects, sounds, decals, and projectiles must be pooled or budgeted where appropriate.
- Multiplayer is not part of the first playable, but architecture must not assume that only one human controller can ever exist.

### Major technical risk

The main risk is not drawing 64 character models. It is the combined cost of:

- AI perception and decision-making.
- Navigation and pathfinding.
- Animation.
- Projectiles and hit detection.
- Physics.
- Effects and audio.
- Rendering a large environment.
- Eventually replicating relevant state over a network.

The first playable must expose these costs early rather than hiding them behind a tiny test map or a low AI count.

## UI surfaces

The initial interface should remain low-chrome so the battlefield stays readable.

### Persistent HUD

- Health and any armor/protection state.
- Ammunition and current fire mode.
- Equipped gadgets.
- Squad member status.
- Current squad order.
- Nearby objective state.
- Minimal directional threat and teammate information.

### Full-screen or expanded interfaces

- Deployment and spawn selection.
- Class and loadout selection.
- Tactical map.
- Squad management.
- Scoreboard.
- Settings and controls.
- Performance/debug display in development builds.

## Vehicles and combined arms

Vehicles are part of the long-term fantasy but are not required for the first playable.

Potential categories:

- Transport trucks or light vehicles.
- Armored personnel carriers.
- Main battle tanks.
- Recon vehicles.
- Aircraft or dropships, depending on the setting.

Vehicle introduction order should be:

1. Unarmed transport.
2. Light armed transport.
3. One armored vehicle archetype per team.
4. Dedicated vehicle crews and repair/resupply loop.
5. Aircraft only after ground combat and performance are stable.

## Previous prototype audit

The first attempt is stored at `H:\sbAPPS\BattleJava`. It was inspected read-only on 2026-07-29 and should remain an intact reference until a deliberate migration begins.

### Verified baseline

The previous prototype is a browser-based Three.js/Vite project named **Frontline Command**. It currently provides:

- A playable local 8v8 match.
- Two four-person squads per team.
- One human soldier and 15 AI soldiers.
- A three-sector frontline.
- Menu, deployment, death, respawn, victory, replay, and after-action flow.
- First-person movement, aim down sights, recoil, weapon switching, reloads, damage feedback, and spatial combat audio.
- AI perception, line of sight, combat, formations, local avoidance, death, and respawning.
- Squad orders for movement, capture, defense, cancellation, and formation changes.
- Frontline adjacency, safe spawns, tickets, capture pressure, and victory rules.
- A Warthog vehicle slice with seats, handling, damage, destruction, respawn, and infantry interaction.
- A focused logistics loop with supplies, rallies, one FOB per team, disruption, resupply, and recovery.
- Debug overlays for AI, world, rendering, and simulation behavior.
- A headless 20 Hz authoritative WebSocket experiment with prediction, interpolation, reconnect, and server-owned combat/objective state.

The codebase contains approximately 8,042 lines of JavaScript source. Its nine automated test suites passed during the audit:

1. Combat smoke.
2. Spatial combat audio.
3. Match lifecycle.
4. Combat feel.
5. Frontline rules.
6. World integration.
7. Vehicle slice.
8. Logistics.
9. Multiplayer experiment.

This is evidence that the old project contains working design knowledge and regression coverage. It is not evidence that the same implementation will scale directly to 64 or 200 combatants.

### Existing asset library

The first attempt has two asset layers:

- **Runtime content:** 34 files totaling approximately 61.4 MiB, including 15 GLB files.
- **Source library:** 198 files totaling approximately 450.3 MiB, including 151 GLB files plus audio, icons, metadata, and two FBX files.

Notable assets include:

- Spartan-style and Elite-style character models.
- A large Valhalla-style battlefield source and an optimized runtime map.
- Assault rifle, battle rifle, DMR, Magnum, pistol, shotgun, SMG, and sniper rifle.
- Rocket launcher, Spartan Laser, and turret source models.
- Warthog, Mongoose, Scorpion, and Grizzly-style vehicle models.
- A substantial library of standing, walking, crouching, prone, aiming, hit, death, and weapon-oriented animation files.

No files should be copied blindly. Each asset needs an inventory entry covering ownership, source, license, runtime size, coordinate system, scale, skeleton, animation compatibility, material requirements, collision needs, LOD status, and intended use.

### Reuse candidates

The following should be treated as strong candidates for reuse or porting:

- Frontline, sector adjacency, capture, ticket, safe-spawn, and victory rules.
- Team, squad, order, sector, weapon-definition, and vehicle-state concepts.
- Multi-rate update scheduling.
- Stable asset manifests and missing-asset fallbacks.
- World preparation and vehicle preparation scripts.
- Separation of durable simulation events from presentation effects.
- Fixed-pool combat effects.
- Debug overlays and performance counters.
- Automated tests as behavioral contracts.
- Server-authority ownership rules and command-validation principles.
- Logistics rules for supplies, rallies, FOB disruption, and recovery.

Reuse does not necessarily mean copying a file unchanged. The tests and contracts may be more valuable than some of the current implementations.

### Required redesign for 32v32

The following old assumptions must not become foundations of the new project:

- `teamSize` is fixed at eight and `squadSize` at four.
- Exactly two named squads per team are hard-coded in spawning.
- The human is hard-coded as a specific Blue-team soldier.
- Soldier state contains an `isPlayer` flag instead of a replaceable controller/seat relationship.
- Deployment accepts only the Blue human soldier.
- Authored formation offsets only cover four members before falling back to a simple column.
- AI soldiers all begin with the assault-rifle loadout.
- Each rendered Spartan owns an independent animation mixer.
- The main game orchestrator and vehicle system have grown into large multi-responsibility classes.
- Local simulation state uses Three.js vector types and stores a visual reference, so it is not yet fully renderer-independent.
- The WebSocket authority experiment is separate from the actual browser match.
- Network snapshots are uncompressed JSON without delta compression or interest management.
- The current world, AI routes, and visual budgets were validated for 8v8, not 32v32.

### Migration strategy

**Locked:** BattleJava is a reference archive, not the code foundation for BattleJava2.

1. Preserve the old project in its currently working state.
2. Record the existing test baseline and asset inventory.
3. Establish a 64-combatant scale harness in BattleJava2.
4. Define a renderer-independent combatant-seat and controller boundary.
5. Rewrite required rules and tests against the new interfaces one system at a time.
6. Import only the minimum assets required by the current milestone.
7. Benchmark each imported presentation system with 64 combatants.
8. Define squads, roles, controllers, and player identity through new data-driven contracts.
9. Copy old code only if a focused review proves that the isolated module already fits the new boundaries.
10. Keep the old playable available for behavior comparisons until the new first playable surpasses it.

### Stack decision

**Working:** Build BattleJava2 with a clean Three.js, TypeScript, and Vite foundation.

This decision should be revisited only if an early measured prototype shows that a critical requirement cannot be met reasonably. Reconsideration must be based on a demonstrated blocker such as:

- Inability to sustain the agreed 32v32 frame-time budget after appropriate LOD and AI tiering.
- Missing tooling that causes asset or level iteration to dominate development time.
- Physics or networking constraints that cannot be isolated behind adapters.
- A target-platform requirement incompatible with the web runtime.

BattleJava failing to meet its goals is not, by itself, evidence that Three.js or JavaScript cannot support the new project. Its architecture and scope assumptions were the problem being replaced.

## Progression philosophy

**Working:**

- Match success comes from teamwork and battlefield decisions, not equipment level.
- Persistent unlocks should primarily add sidegrades, cosmetics, and alternate tools.
- A new player should be combat-capable immediately.
- Class mastery may unlock additional options without increasing base health or raw damage.

Progression is not required for the first playable.

## Implementation start gate

Nothing currently prevents work from beginning. The following defaults define the initial implementation target. They are working assumptions to measure and revise, not permanent promises.

### Initial target platform

**Working:**

- Desktop web browser.
- Chromium-based browser first, including Chrome and Edge.
- Keyboard and mouse input first.
- 1920x1080 reference resolution.
- 60 FPS presentation target.
- WebGL 2 through Three.js `WebGLRenderer`.
- No mobile, controller, touch, VR, or legacy-browser requirement during the scale-harness milestone.

The exact minimum hardware is still open. Until it is defined, every benchmark must record the CPU, GPU, memory, browser version, resolution, and quality settings used. This makes results comparable instead of treating one unrecorded machine as universal.

### Initial performance gates

**Working provisional gates for Milestone 0:**

- 64 combatants remain active for a repeatable ten-minute stress scenario.
- Presentation targets 60 FPS with consistent frame pacing at 1080p.
- A complete stress run has no accumulating memory growth, navigation backlog, or worsening simulation time.
- The simulation worker completes each fixed step before the next step is due.
- Main-thread rendering, simulation-worker time, state-transfer time, and GPU time are reported separately.
- Frame-time percentiles are recorded; average FPS alone is not an acceptance measurement.
- The test reports how many combatants use each AI, animation, and rendering relevance tier.

Exact millisecond budgets will be locked after the first instrumented run on the designated development machine.

### Initial squad assumption

**Working:** Four eight-person squads per team, for 32 combatants per team.

- Each squad may later split into two four-person fireteams.
- The first harness only needs squad membership, a leader ID, and an objective.
- Voice channels, fireteam leaders, and commander hierarchy are not required for the scale harness.
- Eight four-person squads remains a comparison candidate during squad-behavior testing.

### Initial simulation timing

**Working:**

- Rendering: browser animation frame rate.
- Core authoritative simulation: fixed 30 Hz.
- Near-combat AI perception and reactions: approximately 5-10 Hz, subject to measurement.
- Squad-level planning: approximately 1-2 Hz.
- Distant strategic simulation: lower and staggered update rates.
- Renderer interpolation: smooth between authoritative simulation snapshots.

No AI system should perform an expensive global scan every render frame.

### World conventions

**Working:**

- One world unit equals one meter.
- Y is up.
- X and Z form the ground plane.
- Gameplay position, velocity, heading, and bounds use plain numeric simulation data.
- Model-facing corrections live in asset/render adapters rather than changing gameplay coordinates.
- Static collision is authored independently from visual meshes.
- Entity IDs are stable numeric values inside high-volume simulation data.
- Human-readable content IDs remain stable strings in manifests and design data.

### Initial input action map

The project should map physical inputs to named actions in one place.

- Move.
- Look.
- Fire.
- Aim.
- Reload.
- Sprint.
- Crouch.
- Jump.
- Interact.
- Switch primary/secondary weapon.
- Grenade.
- Gadget 1.
- Gadget 2.
- Tactical map.
- Scoreboard.
- Squad command interface.
- Pause/menu.

Milestone 0 only needs movement, look, pause, and debug controls. The remaining actions establish stable names for later systems.

### Initial content slice

The scale harness should begin with:

- A graybox battlefield built from simple geometry.
- Capsule or extremely lightweight placeholder combatants.
- Two team colors.
- Four squads per team.
- One objective.
- One generic rifle behavior.
- Simple hit points, death, respawn, and reinforcement counting.
- No vehicles, final character assets, detailed animation, inventory UI, destruction, or post-processing.

After the scale harness is stable, import:

1. One approved character GLB.
2. One walk, idle, aim, fire, hit, and death animation set.
3. One approved assault-rifle GLB.
4. One small representative environment kit.

Each addition must be benchmarked before the next presentation layer is added.

### Required project scaffolding

The initial repository should include:

- Strict TypeScript configuration.
- Vite development and production builds.
- Three.js renderer shell with resize and context-loss handling.
- A renderer-independent simulation package.
- A simulation Web Worker adapter.
- A deterministic random-seed utility.
- A combatant-seat/controller contract.
- Fixed-step scheduling and render interpolation.
- DOM diagnostics overlay.
- Automated tests for pure simulation rules.
- Repeatable performance scenario and benchmark output.
- Asset manifest and placeholder fallback behavior.
- Formatting, type-check, test, and production-build commands.

### First implementation sequence

1. Scaffold the greenfield TypeScript/Vite project.
2. Implement the combatant-seat, team, squad, transform, health, and controller data contracts.
3. Run a deterministic headless 32v32 simulation without Three.js.
4. Add the simulation worker and compact state-transfer format.
5. Render the 64 placeholder combatants through a thin Three.js adapter.
6. Add the repeatable movement, engagement, death, and respawn stress scenario.
7. Add performance diagnostics and a ten-minute soak test.
8. Add first-person camera and local human control to one combatant seat.
9. Establish the measured baseline.
10. Only then begin importing the first approved character, animation, weapon, and environment assets.

### Information still useful from the user

These answers improve planning but do not need to block the initial scale harness:

- The development PC's CPU, GPU, and memory.
- The weakest computer the game should eventually support.
- Whether the intended release is a normal browser site, an installable desktop wrapper, or both.
- Which existing character and rifle assets are preferred for the first art integration.
- Whether shields are visual flavor, a real regenerating combat layer, or absent.
- Whether four eight-person squads feels right conceptually.

## Development milestones

### Milestone 0 - Scale harness

- Spawn 64 lightweight combatants.
- Move them between representative battlefield locations.
- Exercise perception, targeting, damage, death, and respawning.
- Run authoritative rules separately from Three.js presentation.
- Exercise worker-to-renderer state transfer under representative load.
- Display frame-time, AI, navigation, and rendering costs.
- Establish a repeatable stress-test scenario.

### Milestone 1 - Solo 32v32 first playable

- One human plus 63 bots.
- One graybox map and complete Frontline match.
- Infantry combat and core weapon families.
- Basic classes and gadgets.
- Squad membership and simple orders.
- Capture, death, respawn, tickets, and victory.
- Full-match performance capture.

### Milestone 2 - Squad and AI depth

- Improve squad cohesion and tactical orders.
- Add rally points and specialist behavior.
- Add better cover, suppression, revive, and retreat behavior.
- Tune battle flow and match duration.

### Milestone 3 - Infantry combat slice

- Refine movement, gunplay, feedback, animation, audio, and HUD.
- Validate health, armor, revive, and suppression rules.
- Replace critical graybox assets with a coherent visual target.

### Milestone 4 - First combined-arms slice

- Add transports and one armored vehicle archetype.
- Add anti-vehicle and repair gameplay.
- Test bots around vehicles before asking them to crew every vehicle type.

### Milestone 5 - Multiplayer and bot replacement

- Add authoritative multiplayer hosting.
- Allow human players to occupy bot-controlled seats.
- Handle joining, leaving, reconnecting, team balance, and safe control transfer.
- Test mixed matches with varying human-to-bot ratios.

### Milestone 6 - Scale experiments

- Test the scaling ladder using the same gameplay rules and instrumentation.
- Optimize the demonstrated bottleneck at each tier.
- Do not redesign the public game around a larger count until it is stable and more enjoyable.

## Open foundational decisions

1. Should teams use four eight-person squads or eight four-person squads?
2. Is there a dedicated commander, or is one Squad Leader also the team commander?
3. How lethal should infantry combat be?
4. Does the science-fiction infantry model include shields, armor only, or conventional health?
5. What are the downed, revive, respawn, and reinforcement rules?
6. How much logistics and construction belong in the core mode?
7. Which existing vehicles are essential to the game's identity?
8. What is the target platform and minimum hardware?
9. Which browsers must be supported, and is a desktop wrapper a future target?
10. How large should the first graybox battlefield be?
11. Is 35-50 minutes the right standard match duration?
12. Which existing assets are original and cleared for eventual distribution?

## Idea parking lot

Ideas listed here are possibilities, not commitments:

- Battlefield pickups containing powerful limited weapons.
- Experimental near-future equipment.
- Two fireteams inside each eight-person squad.
- Commander-directed AI platoons.
- Contextual orders that both humans and bots understand.
- Logistics routes that matter without requiring repetitive driving.
- Destructible tactical cover rather than universal destruction.
- Dynamic battle damage that visually records where fighting occurred.
- Bots taking over disconnected players without removing the soldier from the world.

## Change log

### 2026-07-29

- Created the living design plan.
- Established 32v32 as the canonical battle size.
- Established bot-filled combatant seats and human replacement of bots.
- Defined the first playable as one human plus 63 bots.
- Recorded 100v100 as the long-term scaling target.
- Added initial squad, class, loadout, AI, performance, and milestone proposals.
- Locked the military science-fiction aesthetic and use of the existing local asset library for prototyping.
- Audited the first attempt at `H:\sbAPPS\BattleJava`.
- Recorded its verified systems, passing test baseline, asset inventory, reuse candidates, scaling risks, and migration strategy.
- Established BattleJava2 as a greenfield implementation rather than a continuation of BattleJava.
- Selected Three.js, strict TypeScript, Vite, GLB/glTF, DOM UI, worker-capable simulation, and Rapier evaluation as the working technical foundation.
- Defined the ownership boundary between rendering, simulation, physics, workers, and a future authoritative server.
- Added the implementation start gate, provisional platform and performance targets, simulation timing, world conventions, initial content slice, scaffolding requirements, and first implementation sequence.
