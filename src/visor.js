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
const ST = CFG.stamina;

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

    // The other three are continuous sweeps, so they wipe under a clip rather
    // than lighting in steps.
    this.m = {};
    for (const key of ['shield', 'ammo', 'boost']) this.m[key] = this._meter(key, defs);
    this._buildTick(defs);

    this._ready = true;
    return true;
  }

  // A wiping meter: a filled copy of the outline under a clip rect whose width
  // is the whole readout.
  _meter(key, defs) {
    const p = V.idPrefix;
    const group = this.g[key];
    const bb = group.getBBox();

    const rect = el('rect');
    rect.setAttribute('x', bb.x);
    rect.setAttribute('y', bb.y - 4);
    rect.setAttribute('height', bb.height + 8);
    rect.setAttribute('width', 0);
    const clip = el('clipPath');
    clip.setAttribute('id', `${p}clip-${key}`);
    clip.appendChild(rect);
    defs.appendChild(clip);

    const g = el('g');
    g.setAttribute('class', `v-fill v-${key}`);
    g.setAttribute('clip-path', `url(#${p}clip-${key})`);
    for (const path of group.querySelectorAll('path')) g.appendChild(filled(path, `${p}fill-${key}`));
    group.parentNode.insertBefore(g, group);

    return { g, rect, x0: bb.x, span: bb.width, anchor: V.anchor[key] || 'left', f: -1 };
  }

  // The exhaust mark on the boost bar. Clipped to the bar's own silhouette
  // because the bar is a slanted parallelogram — a plain vertical rule would
  // hang out above and below it. It sits OUTSIDE the wipe clip on purpose: the
  // threshold does not stop existing because the pool has drained past it.
  _buildTick(defs) {
    const p = V.idPrefix;
    const group = this.g.boost;
    const bb = group.getBBox();

    const shape = el('clipPath');
    shape.setAttribute('id', `${p}shape-boost`);
    for (const path of group.querySelectorAll('path')) shape.appendChild(path.cloneNode(false));
    defs.appendChild(shape);

    const holder = el('g');
    holder.setAttribute('class', 'v-tickmark');
    holder.setAttribute('clip-path', `url(#${p}shape-boost)`);
    const line = el('line');
    line.setAttribute('class', 'v-tick');
    line.setAttribute('y1', bb.y - 4);
    line.setAttribute('y2', bb.y + bb.height + 4);
    holder.appendChild(line);
    group.parentNode.insertBefore(holder, group);
    this.tick = line;
    this.tickHolder = holder;
  }

  // Where the fill edge would sit at `frac` of full.
  _edgeX(m, frac) {
    return m.anchor === 'right' ? m.x0 + m.span * (1 - frac) : m.x0 + m.span * frac;
  }

  // Drive a meter to `f` of full. The anchor decides which end stays put.
  _wipe(m, f) {
    f = clamp01(f);
    if (Math.abs(f - m.f) < 0.002) return;
    m.f = f;
    const w = m.span * f;
    m.rect.x.baseVal.value = m.anchor === 'right' ? m.x0 + m.span - w : m.x0;
    m.rect.width.baseVal.value = w;
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

    this._wipe(this.m.shield, shield / maxShield);
  }

  // `capacity` is the magazine size. Without it there is no fraction to draw,
  // so the bar holds rather than guessing at a denominator.
  setAmmo(mag, capacity) {
    if (!capacity || !this._init()) return;
    this._wipe(this.m.ammo, mag / capacity);
  }

  // The sprint pool. Three states the fill has to carry beyond its level:
  //
  //   full       the fill goes, the outline stays. A meter that cannot move is
  //              noise -- but blanking the whole group would leave a hole on
  //              the left of a visor that is lit on the right, and asymmetry
  //              reads as breakage. The outline is frame; the fill is the news.
  //   limitless  MJOLNIR. Flat and dim at full rather than an empty socket:
  //              "always there", not "nothing there".
  //   spent      the exhaust latch is closed. Amber, same as #stambar.
  setStamina(stamina, maxStamina, unlimited, spent) {
    if (!this._init()) return;
    const m = this.m.boost;
    const limitless = !!unlimited || !isFinite(maxStamina);

    // The mark is an absolute pool value (CFG.stamina.resprintAt), not a share
    // of the bar — perks resize the pool, so where it lands moves with class.
    if (maxStamina !== this._maxStam) {
      this._maxStam = maxStamina;
      const frac = limitless ? 0 : clamp01(ST.resprintAt / maxStamina);
      this.tick.style.display = frac > 0 ? '' : 'none';
      if (frac > 0) {
        const x = this._edgeX(m, frac);
        this.tick.x1.baseVal.value = x;
        this.tick.x2.baseVal.value = x;
      }
    }

    const full = !limitless && stamina >= maxStamina - 0.01;
    const cls = `v-fill v-boost${full ? ' full' : ''}${spent ? ' spent' : ''}${limitless ? ' limitless' : ''}`;
    if (cls !== m.g.getAttribute('class')) {
      m.g.setAttribute('class', cls);
      // The mark goes with the fill. A threshold line alone in an empty socket
      // is a fact about a meter that is deliberately saying nothing.
      this.tickHolder.classList.toggle('full', full);
    }
    this._wipe(m, limitless ? 1 : stamina / maxStamina);
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
