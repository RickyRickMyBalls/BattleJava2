// Live scope screens: a second camera renders the scene into a render target
// that becomes the screen material's emissiveMap, so the glass shows a
// magnified view of whatever you are aiming at.
//
// Authoring convention: a material whose name matches WEAPONS[k].scope.material
// (case-insensitively) on any mesh of the weapon. Both screens in the kit are
// authored emissive white, which is what makes emissiveMap the right slot —
// the render then displays at full brightness regardless of scene lighting,
// like a lit panel, instead of being shaded as if it were paint.
//
// Boresighting: the screen quad's normal faces the shooter's eye, so its own
// orientation is useless as a view direction. The scope is instead aimed along
// the MAIN camera's forward — the same ray the crosshair and Player's hitscan
// use — which is what makes it show what you are about to hit. pos/rot in
// config are nudges on top of that, not the primary aim.
//
// Only the player's mounted gun gets one. The material is a driven clone (see
// drivenmaterial.js) so the 63 AI rifles sharing the cached model keep their
// baked screens instead of all displaying the player's view.

import * as THREE from 'three';
import { deriveDrivenMaterial } from './drivenmaterial.js';

// The viewmodel lives on this layer so the scope camera cannot see the gun it
// is mounted on. The main camera enables it; the scope camera does not.
export const VIEWMODEL_LAYER = 1;

const _pos = new THREE.Vector3();
const _off = new THREE.Vector3();
const _q = new THREE.Quaternion();

export function createScopeDisplay(gunModel, def) {
  const cfg = def && def.scope;
  if (!cfg || !cfg.material) return null;

  const want = cfg.material.toLowerCase();
  let screen = null;
  gunModel.traverse((o) => {
    if (screen || !o.isMesh || !o.material || Array.isArray(o.material)) return;
    if ((o.material.name || '').toLowerCase() === want) screen = o;
  });
  if (!screen) return null;

  // The screen quad is wider than it is tall, and its UVs stretch a square
  // texture across it. Rendering square would squash everything horizontally,
  // so the camera and the target both take the quad's own aspect — measured
  // from its geometry (drop the smallest extent, which is its thickness)
  // rather than asked for in config.
  screen.geometry.computeBoundingBox();
  const bb = screen.geometry.boundingBox;
  const ext = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].sort((a, b) => b - a);
  const aspect = cfg.aspect || (ext[1] > 1e-6 ? ext[0] / ext[1] : 1);

  const size = cfg.size || 256;
  const rt = new THREE.WebGLRenderTarget(Math.round(size * aspect), size, {
    depthBuffer: true,
    // Written as sRGB so sampling it as an emissiveMap (which decodes sRGB)
    // round-trips to the colours the main pass produced.
    colorSpace: THREE.SRGBColorSpace,
  });

  // Render targets are filled bottom-up, so a texture sampled with ordinary
  // UVs comes out vertically mirrored. Flip in the texture transform rather
  // than asking the owner to re-author the quad's UVs.
  rt.texture.repeat.set(1, -1);
  rt.texture.offset.set(0, 1);

  const camera = new THREE.PerspectiveCamera(cfg.fov || 12, aspect, 0.1, 4000);
  camera.layers.set(0); // never the viewmodel layer

  // Emissive white + emissiveMap = the render shows at full brightness. Keep
  // the authored map as the base colour so the glass keeps its tint/frame.
  //
  // This MUST be a driven clone. The player holds the shared cached model and
  // Object3D.clone() shares materials by reference, so mutating in place puts
  // the player's scope feed on all 63 AI rifles.
  const mat = deriveDrivenMaterial(screen);
  if (!mat) return null;
  mat.emissiveMap = rt.texture;
  mat.emissive = new THREE.Color(0xffffff);
  mat.emissiveIntensity = 1;
  mat.needsUpdate = true;

  const offset = cfg.pos || [0, 0, 0];
  const rot = cfg.rot || [0, 0, 0];
  const rotQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ'));

  return {
    screen,
    camera,
    rt,

    // Called once per frame, before the main pass.
    render(renderer, scene, mainCamera) {
      if (!screen.visible) return;
      screen.updateMatrixWorld();
      screen.getWorldPosition(_pos);

      // Aim with the crosshair, then apply the per-weapon nudge.
      mainCamera.getWorldQuaternion(_q);
      _q.multiply(rotQ);
      camera.quaternion.copy(_q);
      camera.position.copy(_pos).add(_off.set(offset[0], offset[1], offset[2]).applyQuaternion(_q));
      camera.updateMatrixWorld();

      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prevTarget);
    },

    dispose() {
      rt.dispose();
    },
  };
}

// Put the whole viewmodel on the viewmodel layer so scope cameras skip it.
// Lights are left on both layers: the muzzle light is parented to the viewmodel
// but is meant to throw light onto the WORLD, and a light restricted to layer 1
// would stop lighting anything.
export function tagViewmodelLayer(viewmodel) {
  viewmodel.traverse((o) => {
    if (o.isLight) {
      o.layers.enable(0);
      o.layers.enable(VIEWMODEL_LAYER);
    } else {
      o.layers.set(VIEWMODEL_LAYER);
    }
  });
}
