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
    shield: 45,
    health: 55,
    shieldRegenDelay: 4.5,
    shieldRegenRate: 12,
    runSpeed: 6.2,
    walkSpeed: 3.4,
    // Jump is authored as a HEIGHT IN METRES — the single number to tune. Every
    // other jump quantity is derived from it and CFG.gravity: takeoff velocity
    // is sqrt(2*g*h), airtime is 2*v/g, and the jump clip is stretched to span
    // that airtime. Per-class overrides live on CLASSES; this is the default,
    // and it applies to every soldier, AI included.
    jumpHeight: 1.17,
    respawnDelay: 6,
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
  // The default occupant of the second weapon slot. Every class starts with it
  // and the ones that spend a gadget slot trade UP out of it (Assault's webbing,
  // Engineer's launcher, Recon's long gun), so it has to be worth carrying on
  // its own rather than being a consolation prize.
  //
  // Balanced deliberately BELOW the rifles on sustained output — 7 shots to
  // clear 100 EHP at 330 rpm is ~1.05 s, a hair slower than the MA5 — and above
  // them on one axis only: `swapTime`. Its niche is the dry-mag moment, not the
  // stand-up fight.
  magnum: {
    // len matches the GLB's authored longest axis (0.26 m), so the model keeps
    // the scale it was built at — an M6 is ~0.27 m, so it was already right.
    name: 'M6 MAGNUM', model: '/UNSC/weapons/Magnum/Magnum_2.1.glb', len: 0.26,
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
export const STANDARD_POOL = ['ar', 'br', 'smg', 'shotgun'];
export const SPECIALIST_POOL = ['dmr', 'sniper', 'rocket', 'laser'];
export const SIDEARM_POOL = ['magnum'];

// Let a weapon def know its own key (used for held-weapon attachment) and its
// tier. `swapTime` falls back to the player default so only weapons that mean
// to be different carry the number.
for (const [k, def] of Object.entries(WEAPONS)) {
  def.key = k;
  def.slot = SIDEARM_POOL.includes(k) ? 'sidearm'
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

// LEGACY. The flat global primary list, still read by game.js (AI rolls) and
// menu.js (armoury PRIMARY row). Superseded by per-class `primaries` below —
// deliberately left at its old value so this config pass changes no behaviour;
// it goes away when those two consumers migrate.
export const PRIMARIES = ['ar', 'br'];

// ---------------------------------------------------------------------------
// Loadout schema. Every soldier, player or AI, carries exactly:
//
//   2 weapons  — `primary` + `secondary`
//   2 gadgets  — one from the class's gadgetA pool, one from gadgetB
//   1 grenade
//   1 melee
//
// The second weapon slot is the interesting one. It holds the class sidearm by
// default, and certain gadgets (kind: 'weaponSlot') OVERRIDE it with something
// better — that is the single mechanic behind Assault's second rifle, and later
// Engineer's launcher and Recon's long gun. So "2 weapons" is never violated;
// what changes is what earned the right to sit in slot two.
//
// This shape is not read anywhere yet — player.js still builds its own two-slot
// array from {cls, primary, secondary}. It lands here first so the migration has
// something to migrate TO.
// ---------------------------------------------------------------------------
export const DEFAULT_LOADOUT = {
  cls: 'assault',
  primary: 'ar',
  secondary: 'br',        // webbing is in the gadget list, so slot 2 is a rifle
  gadgets: ['biofoam', 'webbing'],
  grenade: 'frag',
  melee: 'bash',
};

// `shield` overrides the default soldier shield; `model` picks the character
// mesh for the class (blue team) — Spartans are the only class in MJOLNIR.
// `jumpHeight` overrides CFG.soldier.jumpHeight for the class, in METRES — the
// only jump number to touch. Takeoff velocity, airtime and the jump clip's
// playback speed all follow from it. Note height goes with the SQUARE of
// takeoff speed, so doubling the height is only 1.41x the velocity and airtime.
//
// New-shape fields: `primaries` / `sidearms` are weapon-key lists, `gadgetA` and
// `gadgetB` are two SEPARATE pools rather than one list of four — that is what
// stops a build taking two of the same kind of thing, and it gives each class a
// slot for its identity (A) and a slot for its utility (B).
//
// `secondaries` / `gadgets` are the LEGACY fields. Assault carries both shapes
// during the migration; the other four are untouched and move over class by
// class once Assault proves the system end to end.
export const CLASSES = {
  assault: {
    name: 'Assault', model: 'marine2',
    primaries: ['ar', 'br', 'smg'],
    sidearms: ['magnum'],
    gadgetA: ['biofoam'],
    gadgetB: ['webbing'],
    grenades: ['frag'],
    melees: ['bash'],
    // legacy shape — still what game.js/menu.js/deploy.js read today
    secondaries: ['smg', 'shotgun'], gadgets: ['frag', 'medkit'],
  },
  engineer: { name: 'Engineer', secondaries: ['rocket', 'laser'], model: 'marine3', gadgets: ['repair', 'mines'] },
  recon: { name: 'Recon', secondaries: ['sniper', 'dmr'], model: 'marine', gadgets: ['sensor', 'frag'] },
  support: { name: 'Support', secondaries: ['shotgun'], model: 'marine', gadgets: ['ammo', 'medkit'] },
  spartan: { name: 'Spartan', secondaries: ['shotgun', 'sniper', 'rocket', 'laser'], model: 'spartan', shield: 70, jumpHeight: 3, gadgets: ['frag', 'shield'] },
};

// Gadget registry: line-art slot icons (stroke uses currentColor).
//
// `kind` is what the code branches on, and there are only a few:
//   consumable  — a charge you spend on yourself (biofoam)
//   weaponSlot  — replaces the sidearm with a pick from `pool` (webbing)
//   placeable   — a prop you put in the world (crates, turret, wall)
//   passive     — always-on (overshield)
// Entries without a `kind` are pre-migration stubs: icon art and nothing else.
export const GADGETS = {
  // --- Assault -------------------------------------------------------------
  // Health does not regenerate (CFG.soldier: shield 45 does, health 55 does
  // not), so restoring it is a real resource and this is the whole reason the
  // class exists. The injection LOCKS you for `useTime` — that is the cost —
  // and the heal then flows over `heal / healRate` seconds while you are free to
  // move and shoot again. A snap-heal would make the commitment invisible.
  biofoam: {
    name: 'BIOFOAM', kind: 'consumable',
    svg: '<rect x="9" y="7" width="6" height="10" rx="1"/><path d="M12 3v4M9.5 5h5M12 17v4"/>',
    heal: 55,           // full health bar
    healRate: 22,       // HP per second once the injection lands (~2.5 s to full)
    useTime: 1.2,       // locked out of firing for this long
    charges: 2,
    cooldown: 1.0,      // between charges
    // --- AI use policy -----------------------------------------------------
    // When an AI decides it is worth a charge. These were originally the health
    // threshold below and CFG.soldier.shieldRegenDelay, and that pairing made
    // the gadget nearly inert: sampling 120 s of a live 32v32, carriers were
    // hurt below 80% in 97 alive-samples, and of those exactly ONE had gone
    // 4.5 s without being hit. 71 had gone 2-4.5 s. A hurt soldier in this game
    // either dies or gets a short lull — it does not get five quiet seconds.
    //
    // So `aiCalmTime` is its own number rather than borrowed from shield regen:
    // the two are answering different questions ("have my shields had time to
    // come back" vs "am I being shot at right now").
    aiUseBelow: 0.7,    // fraction of max health under which a charge is worth it
    aiCalmTime: 2.0,    // seconds since last damage before injecting
  },
  // Trades the sidearm for a second weapon out of the class's own primary pool.
  // Costs no new machinery — player.weapons is already a 2-array of arbitrary
  // weapon keys — so the expensive part of this gadget is the balancing, not the
  // building. `reserveMult` is that balance: two long guns means less spare ammo
  // for each, which is legible, and it makes the webbing build genuinely want
  // Support's ammo crate instead of being self-sufficient.
  webbing: {
    name: 'COMBAT WEBBING', kind: 'weaponSlot',
    svg: '<path d="M7.5 4l4.5 4 4.5-4"/><path d="M7.5 4 6 6v14h12V6l-1.5-2"/><path d="M12 8v12"/>',
    pool: 'primaries',  // which CLASSES[cls] list the second slot may draw from
    reserveMult: 0.6,   // applied to BOTH weapons' reserve ammo
  },

  // --- Pre-migration stubs (other classes) ---------------------------------
  frag: { name: 'M9 FRAG', svg: '<circle cx="12" cy="14" r="6"/><rect x="10" y="4" width="4" height="3.4"/><circle cx="16.4" cy="5" r="1.8"/>' },
  medkit: { name: 'MED KIT', svg: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M12 9.5v6M9 12.5h6"/>' },
  repair: { name: 'REPAIR TOOL', svg: '<path d="M15 4a5 5 0 0 0-6 6.5L4.5 15 9 19.5l4.5-4.5A5 5 0 0 0 20 9l-3 3-4-4z"/>' },
  mines: { name: 'AT MINES', svg: '<path d="M12 5l8 14H4z"/><path d="M12 11v4.5"/>' },
  sensor: { name: 'MOTION SENSOR', svg: '<circle cx="12" cy="13" r="2"/><path d="M7.5 13a4.5 4.5 0 0 1 9 0M4.5 13a7.5 7.5 0 0 1 15 0"/>' },
  ammo: { name: 'AMMO PACK', svg: '<rect x="6" y="9" width="3" height="9"/><rect x="10.5" y="6.5" width="3" height="11.5"/><rect x="15" y="9" width="3" height="9"/>' },
  shield: { name: 'OVERSHIELD', svg: '<path d="M12 3.5l7.5 2.8V12c0 4.6-3.2 7.4-7.5 8.5C7.7 19.4 4.5 16.6 4.5 12V6.3z"/>' },
};

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
    name: 'M9 FRAG', model: '/UNSC/weapons/Gernade/Frag.glb',
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
    arc: 0.7,           // radians of forgiveness either side of the crosshair
    useTime: 0.45,      // locked out of firing
    cooldown: 0.9,
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
  },
  audio: {
    shot: '/UNSC/weapons/battle-rifle/audio/battle-rifle-shot-1.mp3',
    dmrShot: '/UNSC/weapons/DMR/DMR_shot.wav',
    sniperShot: '/UNSC/weapons/sniper/Sniper_shot.wav',
    rocketShot: '/UNSC/weapons/rocket-launcher/Rocket-Launcher_shot.wav',
    // The Magnum model ships without audio of its own; these come from the
    // neighbouring `pistol/` folder, which is the same weapon's sound set.
    pistolShot: '/UNSC/weapons/pistol/Pistol_shot1.mp3',
    pistolReload: '/UNSC/weapons/pistol/Pistol_reload.mp3',
    reload: '/UNSC/weapons/assault rifle/audio/assault-rifle-reload-1.mp3',
    empty: '/UNSC/weapons/pistol/empty_sound.mp3',
  },
};
