// The visor: the helmet frame drawn across the top of the screen.
//
// The art is authored in CAD and lives at `source/UI/hud4-top.svg`, served out
// of the Vite publicDir at `/UI/...`. This module owns how that file is MOUNTED
// and driven, never how it looks — re-export the SVG and the game picks the new
// one up with no code change. That is the whole reason it is fetched at runtime
// instead of pasted into index.html.
//
// Two rewrites happen on the way in, both defending against the file being a
// foreign export we do not control:
//
//   ids  — every id is prefixed. The SVG ships `<g id="ammo">`, index.html ships
//          `<div id="ammo">`, and hud.js caches its elements by id in its
//          constructor. Without the prefix whichever mounts first wins, and the
//          HUD silently binds its ammo readout to a path in the visor.
//   css  — the `<style>` block inside the SVG becomes GLOBAL document CSS once
//          inlined, under names like `.cls-1`. Every CAD export numbers its
//          classes from 1, so a second exported panel would restyle this one.
//          Selectors get scoped to the host element.

import { CFG } from './config.js';

const V = CFG.visor;

// One fetch and one parse for the life of the page. `new Hud()` runs per match,
// and the second match must not go back to the network for a file that cannot
// have changed since the first.
let _template = null;

function loadTemplate() {
  if (!_template) {
    _template = fetch(V.src)
      .then((r) => {
        if (!r.ok) throw new Error(`${V.src}: ${r.status} ${r.statusText}`);
        return r.text();
      })
      .then(prepare);
  }
  return _template;
}

// Prefix every selector in an inlined <style> so the SVG's generic class names
// cannot reach the rest of the document. Deliberately simple: CAD exports emit
// a flat list of rules, and an @-rule is left alone rather than mangled.
function scopeCss(styleEl, scope) {
  styleEl.textContent = styleEl.textContent.replace(
    /(^|\})([^{}]+)\{/g,
    (whole, close, sel) => {
      if (sel.trim().startsWith('@')) return whole;
      const scoped = sel.split(',').map((s) => `${scope} ${s.trim()}`).join(', ');
      return `${close}${scoped}{`;
    },
  );
}

function prepare(text) {
  const p = V.idPrefix;
  const rewritten = text
    .replace(/\bid="([^"]+)"/g, `id="${p}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${p}$1)`);

  const doc = new DOMParser().parseFromString(rewritten, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`parse failed: ${err.textContent.trim().slice(0, 140)}`);
  const svg = doc.documentElement;

  // Crop to the art band, and stretch to it rather than fit. As authored the
  // file is `xMidYMid meet` on a 16:9 box, which letterboxes the whole frame
  // away from the screen edges on any other aspect ratio — and a visor that
  // does not touch both edges is not a visor. Stretching is safe here because
  // every stroke class carries `vector-effect: non-scaling-stroke`: a wider box
  // does not fatten the lines, it only shifts diagonals by a degree nobody sees.
  svg.setAttribute('viewBox', V.band.join(' '));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.removeAttribute('width');
  svg.removeAttribute('height');

  for (const style of svg.querySelectorAll('style')) scopeCss(style, `#${V.host}`);
  return svg;
}

export class Visor {
  constructor() {
    this.svg = null;
    this.g = null;      // { shield, health, ammo, boost } — the meter groups
  }

  // Fire-and-forget: a HUD blocked on the network is worse than one that comes
  // up a frame late, so this is never awaited on the match path and every setter
  // no-ops until `svg` exists.
  mount(host) {
    if (!host || !V.enabled) return Promise.resolve(this);
    return loadTemplate()
      .then((template) => {
        const svg = document.importNode(template, true);
        svg.style.maxHeight = `${V.heightVh}vh`;
        host.replaceChildren(svg);
        this.svg = svg;
        this.g = {};
        for (const key of ['shield', 'health', 'ammo', 'boost']) {
          this.g[key] = svg.querySelector(`#${V.idPrefix}${key}`);
        }
        return this;
      })
      .catch((err) => {
        // The DOM vitals stack is still up. A missing frame is a cosmetic loss,
        // not a reason to take the match down with it.
        console.warn('[visor] not mounted —', err.message);
        return this;
      });
  }
}
