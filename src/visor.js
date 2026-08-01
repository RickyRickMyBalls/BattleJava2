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

const NS = 'http://www.w3.org/2000/svg';
const el = (name) => document.createElementNS(NS, name);
const clamp01 = (v) => (v > 1 ? 1 : v < 0 ? 0 : v);

// A top-to-bottom gradient over each filled shape's own box, so one definition
// serves both the single shield sweep and ten separate health cells.
function gradient(id, stops) {
  const g = el('linearGradient');
  g.setAttribute('id', id);
  g.setAttribute('x1', 0); g.setAttribute('y1', 0);
  g.setAttribute('x2', 0); g.setAttribute('y2', 1);
  for (const [offset, color] of stops) {
    const s = el('stop');
    s.setAttribute('offset', offset);
    s.setAttribute('stop-color', color);
    g.appendChild(s);
  }
  return g;
}

// A filled copy of an outline path. The class goes because it carries the
// export's stroke — left on, the copy would redraw the outline under the real
// one and every edge would read double-weight.
function filled(path, fillId, cls) {
  const copy = path.cloneNode(false);
  copy.removeAttribute('class');
  copy.setAttribute('fill', `url(#${fillId})`);
  copy.setAttribute('stroke', 'none');
  if (cls) copy.setAttribute('class', cls);
  return copy;
}

export class Visor {
  constructor() {
    this.svg = null;
    this.g = null;      // { shield, health, ammo, boost } — the meter groups
    this.cells = null;  // health, left to right
    this._ready = false;
    this._lit = -1;
    this._shieldF = -1;
  }

  // Geometry has to be measured, and `getBBox` reports zeros inside a
  // display:none subtree — which `#hud` is until the match starts. So this runs
  // on the first setter that arrives after the HUD is actually up, not at mount,
  // and reports false until the numbers are real.
  _init() {
    if (this._ready) return true;
    if (!this.svg || !this.g.health) return false;
    const probe = this.g.health.getBBox();
    if (probe.width < 1) return false;

    const p = V.idPrefix;
    const defs = this.svg.querySelector('defs') || this.svg.insertBefore(el('defs'), this.svg.firstChild);
    for (const [key, stops] of Object.entries(V.fill)) defs.appendChild(gradient(`${p}fill-${key}`, stops));

    // Ten discrete pips, not a bar with ten notches drawn on it. `Z` is what
    // separates a cell from the thin connector stroke sharing the group, and
    // the sort is by geometry because a re-export is under no obligation to
    // keep document order.
    const cells = [...this.g.health.querySelectorAll('path')]
      .filter((n) => /[zZ]\s*$/.test(n.getAttribute('d') || ''))
      .sort((a, b) => a.getBBox().x - b.getBBox().x);
    if (cells.length !== V.healthCells) {
      console.warn(`[visor] health: art has ${cells.length} cells, config says ${V.healthCells}`);
    }
    const healthFill = el('g');
    healthFill.setAttribute('class', 'v-fill');
    for (const c of cells) healthFill.appendChild(filled(c, `${p}fill-health`, 'v-cell'));
    this.g.health.parentNode.insertBefore(healthFill, this.g.health);
    this.cells = [...healthFill.children];

    // The shield is one continuous sweep, so it wipes under a clip rather than
    // lighting in steps. Anchored left and grown rightward.
    const src = this.g.shield.querySelector('path');
    const bb = this.g.shield.getBBox();
    const clip = el('clipPath');
    clip.setAttribute('id', `${p}clip-shield`);
    const rect = el('rect');
    rect.setAttribute('x', bb.x);
    rect.setAttribute('y', bb.y - 4);
    rect.setAttribute('height', bb.height + 8);
    rect.setAttribute('width', 0);
    clip.appendChild(rect);
    defs.appendChild(clip);

    const shieldFill = el('g');
    shieldFill.setAttribute('class', 'v-fill');
    shieldFill.setAttribute('clip-path', `url(#${p}clip-shield)`);
    shieldFill.appendChild(filled(src, `${p}fill-shield`));
    this.g.shield.parentNode.insertBefore(shieldFill, this.g.shield);
    this.shieldRect = rect;
    this.shieldSpan = bb.width;

    this._ready = true;
    return true;
  }

  // Gated on change like the rest of the HUD: this runs every frame, and the
  // pip count moves a handful of times a life.
  setVitals(shield, health, maxShield, maxHealth) {
    if (!this._init()) return;

    // Ceil, with a floor of one while anything is left: a last sliver of health
    // that reads as an empty bar is a lie about whether you are still standing.
    const lit = health <= 0 ? 0
      : Math.max(1, Math.min(this.cells.length, Math.ceil((health / maxHealth) * this.cells.length)));
    if (lit !== this._lit) {
      this._lit = lit;
      this.cells.forEach((c, i) => c.classList.toggle('on', i < lit));
    }

    const f = clamp01(shield / maxShield);
    if (Math.abs(f - this._shieldF) > 0.002) {
      this._shieldF = f;
      this.shieldRect.width.baseVal.value = this.shieldSpan * f;
    }
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
