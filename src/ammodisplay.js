// Live ammo counters on weapon models, driven by the authored digit atlas.
//
// Authoring convention (AR / BR / DMR follow it; any future weapon can too):
//  - a material named `numbers_atlas` whose texture is a horizontal strip of
//    the digits 0-9 (ten equal cells)
//  - one quad mesh per digit position, mesh name containing "ones" / "tens",
//    UV-mapped to any single cell of the strip
//
// To show digit d on a quad we clone its material + texture and slide
// offset.x by (d - homeCell) * 0.1 — the home cell is read from the quad's
// own UVs, so quads can be authored into any cell of the strip.
//
// Only the player's mounted gun gets driven clones; AI guns keep the baked
// look and the shared cached model's original materials are never mutated
// beyond the player's own mesh instances. See drivenmaterial.js.

import { deriveDrivenMaterial } from './drivenmaterial.js';

const CELLS = 10;

export function createAmmoDisplay(gunModel) {
  let ones = null, tens = null;
  gunModel.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m.name !== 'numbers_atlas') return;
    const n = o.name.toLowerCase();
    if (n.includes('ones')) ones = o;
    else if (n.includes('tens')) tens = o;
  });
  if (!ones || !tens) return null;

  // per-quad driven texture: clone material + texture so ones/tens (and the
  // AI clones sharing the original material) stay independent
  const mk = (mesh) => {
    const uv = mesh.geometry.attributes.uv;
    let uMin = Infinity;
    for (let i = 0; i < uv.count; i++) uMin = Math.min(uMin, uv.getX(i));
    const homeCell = Math.floor(uMin * CELLS);
    const m = deriveDrivenMaterial(mesh);
    const tex = m.map.clone();
    m.map = tex;
    if (m.emissiveMap) m.emissiveMap = tex;
    return { tex, homeCell };
  };
  const dOnes = mk(ones), dTens = mk(tens);

  let shown = -1;
  return {
    set(mag) {
      const n = Math.max(0, Math.min(99, mag));
      if (n === shown) return;
      shown = n;
      dOnes.tex.offset.x = ((n % 10) - dOnes.homeCell) / CELLS;
      dTens.tex.offset.x = (Math.floor(n / 10) - dTens.homeCell) / CELLS;
    },
  };
}
