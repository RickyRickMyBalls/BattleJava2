// The repair tool's beam — the visible half of the held tool.
//
// This is a WORLD-SPACE object, not a viewmodel one, and that is the whole
// reason it is a module rather than four lines in player.js. The beam has to
// start at the tool the player can see, which is the viewmodel's nozzle in first
// person and the BODY's nozzle in third — two different points, metres apart.
// A beam parented to the viewmodel would be correct in one view and floating in
// front of the camera in the other. Both callers hand this a world-space pair of
// points and it knows nothing else about who is welding what.
//
// The mesh follows the muzzle-flash pattern in player.js: additive, no depth
// write, and never culled. A repair beam is a light source in the fiction, so it
// should wash out over what is behind it rather than sit on top of it as a
// solid.
//
// Scope note: this draws a beam and terminates it where the world stops it. It
// deliberately does NOT know what it is pointed at. Armor, vehicles and
// blueprints are three different target systems, and each will hook in at
// player._updateTool once the thing it repairs exists.

import * as THREE from 'three';

// The cylinder is authored running 0..1 along +Y so the transform below is one
// quaternion and one scale — no midpoint maths, and no re-centering per frame.
// +Y is the FAR end, which is why the wide radius is `radiusTop`.
//
// The taper is perspective correction, not style. The near end sits ~0.5 m from
// the eye and the far end up to `range` (6 m) away, so a constant-radius beam is
// twelve times wider on screen at the nozzle than at the target — it renders as
// a cone, or a sword. Widening the far end by roughly that ratio holds the beam
// at a near-constant SCREEN width along its length, which is what a beam is
// supposed to look like.
const BEAM_TAPER = 0.12;   // near radius as a fraction of the far radius
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

// `lit` decides whether this beam gets a PointLight at all, and it is not a
// cosmetic switch. Scene light COUNT is part of three's program cache key, so a
// beam that adds one costs a full material recompile the first time that count
// is seen — measured at 60 new programs on the demo map. Building the light
// conditionally, rather than adding one and hiding it, is what keeps the count
// at zero for a player who has turned them off.
export function createRepairBeam(scene, cfg = {}, lit = true) {
  const color = cfg.color ?? 0x5ad1ff;
  // Radius of the FAR end — the near end is BEAM_TAPER of it.
  const radius = cfg.radius ?? 0.03;

  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(BEAM_GEO, mat);
  beam.frustumCulled = false;
  beam.visible = false;
  scene.add(beam);

  const glowTex = makeGlowTexture();
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.frustumCulled = false;
  glow.visible = false;
  scene.add(glow);

  // A second light source that actually lights the work. Cheap and short-range:
  // it exists so the surface being welded brightens, which is the only feedback
  // that reads at a distance in third person.
  const light = lit ? new THREE.PointLight(color, 0, 4.5) : null;
  if (light) {
    light.visible = false;
    scene.add(light);
  }

  let flicker = 0;

  return {
    // `from`/`to` are world-space. Called every frame the beam is running; call
    // hide() on any frame it is not.
    set(from, to, dt) {
      flicker += dt * 30;
      // Welding light is not steady — a constant-width beam reads as a laser
      // pointer. The wobble is small enough not to look like a bug and large
      // enough to say "this thing is working".
      const jitter = 0.85 + Math.sin(flicker) * 0.1 + Math.random() * 0.12;

      _dir.subVectors(to, from);
      const len = _dir.length();
      if (len < 1e-4) { this.hide(); return; }
      _dir.divideScalar(len);

      beam.visible = true;
      beam.position.copy(from);
      beam.quaternion.setFromUnitVectors(UP, _dir);
      beam.scale.set(radius * jitter, len, radius * jitter);
      mat.opacity = 0.45 + Math.random() * 0.2;

      glow.visible = true;
      glow.position.copy(to);
      glow.scale.setScalar(0.22 * jitter);
      glowMat.opacity = 0.6 + Math.random() * 0.3;

      if (light) {
        light.visible = true;
        light.position.copy(to);
        light.intensity = 5 + Math.random() * 3;
      }
    },

    hide() {
      beam.visible = false;
      glow.visible = false;
      if (light) light.visible = false;
    },

    dispose() {
      scene.remove(beam);
      scene.remove(glow);
      if (light) scene.remove(light);
      mat.dispose();
      glowMat.dispose();
      glowTex.dispose();
    },
  };
}
