// The loadout bar: class tabs, the class's three editable kits, and the six
// equipped slots. Mounted by BOTH the deploy screen and the lobby.
//
// It exists as a component rather than as markup in each screen because there
// would otherwise be three places that know how to draw a loadout — the armoury
// grid, the deploy strip and the lobby strip — and a change to a card would
// have to be remembered in all three. That is the same drift `validateLoadout`
// was written to prevent, one layer up.
//
// The host supplies `session` and `armory` through getters rather than as
// values: the lobby builds its bar before a match exists and the deploy screen
// before the armoury has finished prewarming, so both are read fresh on every
// refresh.

import { CLASSES, GADGETS } from './config.js';
import {
  SLOTS, slotValue, slotDef, validateLoadout, matchingPreset,
  SLOTS_PER_CLASS, selectClass, selectSlot, resetSlot, saveBook,
} from './loadout.js';

export class LoadoutBar {
  // host: { session, armory, onChange }  — all read live, never cached
  constructor(host) {
    this.host = host;
    this.el = document.createElement('div');
    this.el.className = 'kb';
    this.el.innerHTML = '<div class="kb-tabs"></div>'
      + '<div class="kb-panel"><div class="kb-kits"></div><div class="kb-slots"></div></div>';
    this.tabs = this.el.querySelector('.kb-tabs');
    this.kits = this.el.querySelector('.kb-kits');
    this.slots = this.el.querySelector('.kb-slots');
  }

  mount(parent) { parent.appendChild(this.el); return this; }

  // Publish the bar's measured height so the screens around it can clear it.
  // It used to be a hardcoded 186px in the lobby's CSS, which was correct for
  // exactly one font size — the moment the bar started scaling with the
  // viewport, the hint and the class label were back inside it. Anything that
  // needs to sit above the bar reads --kb-h rather than guessing.
  _publishHeight() {
    const h = this.el.offsetHeight;
    if (h > 0 && h !== this._lastH) {
      this._lastH = h;
      document.documentElement.style.setProperty('--kb-h', `${h}px`);
    }
  }

  _changed() {
    const s = this.host.session;
    if (s) saveBook(s.loadouts);
    this.refresh();
    if (this.host.onChange) this.host.onChange();
  }

  _openArmoury() {
    const a = this.host.armory;
    if (a) a.show('apply');
  }

  refresh() {
    const sess = this.host.session;
    const lo = validateLoadout(sess ? sess.playerLoadout : this.host.loadout);
    if (!lo) return;

    // ---- class tabs ----
    this.tabs.innerHTML = '';
    for (const [key, def] of Object.entries(CLASSES)) {
      const b = document.createElement('button');
      b.textContent = def.name.toUpperCase();
      b.classList.toggle('sel', lo.cls === key);
      b.onclick = () => { if (sess) selectClass(sess, key); this._changed(); };
      this.tabs.appendChild(b);
    }

    // ---- the class's three kits ----
    const cls = lo.cls;
    const activeIdx = (sess && sess.activeSlot[cls]) || 0;
    this.kits.innerHTML = '';
    for (let i = 0; i < SLOTS_PER_CLASS; i++) {
      const kit = sess ? sess.loadouts[cls][i] : lo;
      const preset = matchingPreset(kit);
      const b = document.createElement('button');
      b.className = 'kb-kit' + (i === activeIdx ? ' sel' : '');
      // What the slot HOLDS leads; the number is only its address.
      b.innerHTML = `<span class="n">${preset ? preset.name : 'CUSTOM'}</span>`
        + `<span class="s">LOADOUT ${i + 1}</span>`;
      b.title = preset ? preset.desc : 'Edited loadout';
      b.onclick = () => { if (sess) selectSlot(sess, i); this._changed(); };
      this.kits.appendChild(b);
    }
    const reset = document.createElement('button');
    reset.className = 'kb-reset';
    reset.textContent = 'RESET SLOT';
    reset.title = 'Put this slot back to the kit it shipped with';
    reset.onclick = () => {
      if (sess) { resetSlot(sess.loadouts, cls, activeIdx); selectSlot(sess, activeIdx); }
      this._changed();
    };
    this.kits.appendChild(reset);

    // ---- the six equipped slots ----
    this.slots.innerHTML = '';
    for (const slot of SLOTS) {
      this.slots.appendChild(this._card(slot, lo));
      // Weapons and kit are different kinds of thing; the rule says so without
      // needing a heading over each group.
      if (slot.id === 'secondary') {
        const sep = document.createElement('div');
        sep.className = 'kb-sep';
        this.slots.appendChild(sep);
      }
    }
    const cust = document.createElement('button');
    cust.className = 'kb-card kb-customize';
    cust.innerHTML = '<span class="kb-slotname">CUSTOMIZE</span><span class="kb-plus">+</span>';
    cust.title = 'Open the armoury';
    cust.onclick = () => this._openArmoury();
    this.slots.appendChild(cust);

    this._publishHeight();
  }

  // One card per slot, built to the same rules as the armoury grid: the SLOT
  // name on top, the item's art in the middle, its name underneath. The strip
  // used to show the item name alone, which meant you could not tell which slot
  // a gadget was in without knowing the order.
  _card(slot, lo) {
    const key = slotValue(lo, slot);
    const def = slotDef(slot, key);
    const armory = this.host.armory;
    const card = document.createElement('button');
    const gadget = GADGETS[key];
    card.className = 'kb-card'
      // Weapon cards are wider than gadget cards. A baked weapon thumbnail is
      // about 3:1, so on a square-ish card the gun is limited by width and ends
      // up tiny, while a gadget glyph is square and wastes the same space. The
      // armoury already splits them this way for the same reason.
      + (slot.art === 'weapon' ? ' weapon' : ' glyph')
      // Declared-but-unbuilt gadgets are marked here as well as in the armoury.
      // With most of the roster still inert, a card that looks exactly as real
      // as a working one is actively misleading.
      + (gadget && gadget.built === false ? ' wip' : '');
    card.dataset.slot = slot.id;
    card.title = def ? `${slot.label} — ${def.name}` : slot.label;
    card.onclick = () => this._openArmoury();

    const name = document.createElement('span');
    name.className = 'kb-slotname';
    name.textContent = slot.label;
    card.appendChild(name);

    const art = document.createElement('span');
    art.className = 'kb-art';
    if (slot.art === 'weapon') {
      // Baked 3D thumbnail first, hand-drawn SVG behind it — the same order the
      // armoury uses, so the same weapon does not read as two different guns on
      // two different screens.
      const thumb = armory && armory.thumbs && armory.thumbs[key];
      const icon = armory && armory.icons && armory.icons[key];
      if (thumb || icon) {
        const img = document.createElement('img');
        img.src = thumb || icon;
        img.className = thumb ? 'kb-thumb' : 'kb-line';
        img.draggable = false;
        art.appendChild(img);
      } else if (def) {
        art.textContent = def.name.split(' ')[0];
        art.classList.add('kb-fallback');
      }
    } else {
      art.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${(def && def.svg) || ''}</svg>`;
    }
    card.appendChild(art);

    const label = document.createElement('span');
    label.className = 'kb-itemname';
    label.textContent = (def && def.name) || '—';
    card.appendChild(label);
    return card;
  }
}
