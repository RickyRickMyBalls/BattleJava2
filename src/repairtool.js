// Repair beams — every one on the field, player and bot alike, drawn from a
// single pool.
//
// A pool rather than a beam per welder, and the reason is not draw calls. Scene
// light COUNT is part of three's program cache key: the moment the number of
// visible lights changes, every material compiled against the old count is
// invalidated and recompiles. Measured on the demo map, one beam light cost 60
// new shader programs. Three caches a variant per count, so the second time you
// see that count it is free — but with N welders coming and going, every new
// simultaneous total is a fresh count and a fresh compile, arriving mid-fight.
//
// So the lights here are allocated ONCE, stay in the scene, stay `visible`, and
// are driven by INTENSITY. The count never moves, which means after the match's
// prewarm there is no recompile, ever — not when one bot starts welding, not
// when six do. `budget` is the player's setting; changing it rebuilds the pool
// and pays the compile while the settings menu is still open.
//
// The beam GEOMETRY is uncapped on purpose. Meshes sharing one material cost a
// handful of draw calls and no new programs, so every welder always draws — the
// budget decides who LIGHTS the work, not who is visible. A bot welding with an
// unlit torch reads fine; a repair happening with no beam at all reads as a bug.

import * as THREE from 'three';

// Authored running 0..1 along +Y so placing a beam is one quaternion and one
// scale — no midpoint maths, no re-centering per frame. +Y is the FAR end, which
// is why the wide radius is `radiusTop`.
//
// The taper is perspective correction, not style. The near end sits ~0.5 m from
// the eye and the far end up to `range` away, so a constant-radius beam is
// twelve times wider on screen at the nozzle than at the target — it renders as
// a cone, or a sword. Widening the far end by roughly that ratio holds it at a
// near-constant SCREEN width along its length.
const BEAM_TAPER = 0.12;
const BEAM_GEO = new THREE.CylinderGeometry(1, BEAM_TAPER, 1, 8, 1, true).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

// Soft round falloff for the impact glow. White at the core so the beam's own
// colour tints it rather than fighting it.
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBeamPool(scene, cfg = {}, budget = 1) {
  const color = cfg.color ?? 0x5ad1ff;
  const radius = cfg.radius ?? 0.03;   // the FAR end; the near end is tapered off it

  // Materials are SHARED across every beam. Two reasons: a clone per beam would
  // be a second program cache entry to keep warm for no visual gain, and the
  // only thing that varies per beam is its transform, which lives on the mesh.
  // The flicker is therefore global — invisible at the handful of beams that are
  // ever alight at once, and the width jitter is still computed per beam.
  const beamMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const glowTex = makeGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // Fixed, and never hidden. `visible = false` would drop it out of the light
  // count and put us straight back into recompile territory — intensity 0 is a
  // light that costs a little per fragment and nothing in shader churn.
  const lights = [];
  for (let i = 0; i < budget; i++) {
    const l = new THREE.PointLight(color, 0, 4.5);
    scene.add(l);
    lights.push(l);
  }

  const visuals = [];   // grown on demand; index-matched beam + glow
  function visual(i) {
    if (visuals[i]) return visuals[i];
    const beam = new THREE.Mesh(BEAM_GEO, beamMat);
    beam.frustumCulled = false;
    beam.visible = false;
    scene.add(beam);
    const glow = new THREE.Sprite(glowMat);
    glow.frustumCulled = false;
    glow.visible = false;
    scene.add(glow);
    visuals[i] = { beam, glow };
    return visuals[i];
  }

  // One entry per welder per frame, keyed by the welder so the sim's substepping
  // (timeScale 2/4/8 runs `_simStep` several times per rendered frame) cannot
  // queue the same bot four times. Last write wins, which is the newest position.
  const pending = new Map();
  let flicker = 0;

  return {
    lightBudget: budget,

    // `from`/`to` are world-space and are COPIED — callers hand over module
    // scratch vectors, which are rewritten before this pool ever draws.
    request(owner, from, to) {
      let e = pending.get(owner);
      if (!e) {
        e = { from: new THREE.Vector3(), to: new THREE.Vector3(), player: false };
        pending.set(owner, e);
      }
      e.from.copy(from);
      e.to.copy(to);
      e.player = !!(owner && owner.isPlayer);
    },

    // Draw everything requested this frame and hand the lights to whoever most
    // deserves them. Called once per rendered frame, after the sim has run.
    commit(dt, camPos) {
      flicker += dt * 30;
      const list = [...pending.values()];
      // The player's own beam always outranks a bot's — it is the one the player
      // is looking at, and it is the one whose absence they would read as broken.
      // Everyone else sorts by distance to the eye, so the lights that do exist
      // land where they can actually be seen.
      list.sort((a, b) => {
        if (a.player !== b.player) return a.player ? -1 : 1;
        return a.to.distanceToSquared(camPos) - b.to.distanceToSquared(camPos);
      });

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const v = visual(i);
        _dir.subVectors(e.to, e.from);
        const len = _dir.length();
        if (len < 1e-4) { v.beam.visible = false; v.glow.visible = false; continue; }
        _dir.divideScalar(len);

        // Welding light is not steady — a constant width reads as a laser
        // pointer. Per beam, so two welders side by side are not in lockstep.
        const jitter = 0.85 + Math.sin(flicker + i * 1.7) * 0.1 + Math.random() * 0.12;
        v.beam.visible = true;
        v.beam.position.copy(e.from);
        v.beam.quaternion.setFromUnitVectors(UP, _dir);
        v.beam.scale.set(radius * jitter, len, radius * jitter);
        v.glow.visible = true;
        v.glow.position.copy(e.to);
        v.glow.scale.setScalar(0.22 * jitter);

        const light = lights[i];
        if (light) {
          light.position.copy(e.to);
          light.intensity = 5 + Math.random() * 3;
        }
      }

      beamMat.opacity = 0.45 + Math.random() * 0.2;
      glowMat.opacity = 0.6 + Math.random() * 0.3;

      // Retire what nobody asked for. Lights go dark by intensity, never by
      // visibility — see the note at the top.
      for (let i = list.length; i < visuals.length; i++) {
        visuals[i].beam.visible = false;
        visuals[i].glow.visible = false;
      }
      for (let i = list.length; i < lights.length; i++) lights[i].intensity = 0;
      pending.clear();
    },

    dispose() {
      for (const l of lights) scene.remove(l);
      for (const v of visuals) { scene.remove(v.beam); scene.remove(v.glow); }
      lights.length = 0;
      visuals.length = 0;
      pending.clear();
      beamMat.dispose();
      glowMat.dispose();
      glowTex.dispose();
    },
  };
}
