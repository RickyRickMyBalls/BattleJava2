// The in-match ESC menu: tab rows down the left, the selected tab's content on
// the right. A foundation rather than a finished screen — the tab list and the
// rows inside each tab are built by walking SETTING_DEFS, so adding a setting is
// a config entry and adding a tab is one line in SETTING_TABS.
//
// IT DOES NOT PAUSE. The sim keeps running behind it, deliberately: the game is
// 63 bots fighting a battle, and freezing that to change a volume slider makes
// the menu a tool for studying a firefight rather than for leaving one.
//
// ---------------------------------------------------------------------------
// The one thing that makes this harder than it looks: you cannot listen for
// Escape while pointer-locked. The browser consumes the key to exit lock and
// never delivers the keydown, so a `keydown` handler for 'Escape' is dead code
// in the state that matters. The menu therefore opens on POINTER LOCK LOSS, not
// on a key. Escape is only bound for the reverse trip — once the menu is up the
// pointer is free, and the key arrives normally.
//
// The consequence is that anything releasing the mouse opens the menu, M
// included. That is the right behaviour anyway: "give me my cursor back" and
// "show me the menu" are the same intent from the player's side.
// ---------------------------------------------------------------------------
//
// The footer carries the three ways OUT of a match — redeploy, restart, exit.
// Only the first is the menu's own (it is one call on the match); the other two
// tear a match down and stand a screen back up, which is main.js's job, so they
// arrive as host callbacks. A host that does not supply them (a scripted or
// headless one) simply has those buttons hidden rather than dead.

import { SETTING_DEFS, SETTING_TABS, getSetting, setSetting } from './settings.js';

// Buttons that end something get a second click before they do it. The cost of
// a misclick here is a match, and the menu sits one keypress away from the
// fight — "are you sure" as a state on the button itself, rather than a dialog
// stacked on a dialog.
const CONFIRM_HOLD = 4;   // seconds a primed button stays primed

export class PauseMenu {
  // `host` supplies the game through a getter rather than as a value: the menu
  // outlives any single match, and a captured reference would go stale the
  // moment a second one is launched.
  constructor(host) {
    this.host = host;
    this.visible = false;
    this.tab = SETTING_TABS[0].id;
    this._build();
    // Bound on `document` and never removed — this object lives for the page.
    document.addEventListener('pointerlockchange', () => this._onLockChange());
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.visible) { e.preventDefault(); this.hide(); }
    });
  }

  get game() { return this.host.game; }

  // Open only when the player is actually IN the match and nothing else already
  // owns the screen. Losing the lock because the armoury or the deploy map just
  // opened is not a request for this menu, and `menuOpen` is exactly the flag
  // those two set.
  _onLockChange() {
    if (document.pointerLockElement) { this.hide(); return; }
    const g = this.game;
    if (!g || this.visible) return;
    if (g.menuOpen || g.gameOver) return;
    if (g.deployScreen && g.deployScreen.visible) return;
    this.show();
  }

  _build() {
    const ov = document.createElement('div');
    ov.id = 'pause';
    ov.innerHTML = `
      <div class="pm-panel">
        <div class="pm-head">
          <span class="pm-title">SETTINGS</span>
          <span class="pm-sub">ESC TO RESUME</span>
        </div>
        <div class="pm-body">
          <div class="pm-tabs"></div>
          <div class="pm-content"></div>
        </div>
        <div class="pm-foot">
          <div class="pm-actions">
            <button class="pm-act" data-act="redeploy">REDEPLOY</button>
            <button class="pm-act danger" data-act="restart">RESTART MATCH</button>
            <button class="pm-act danger" data-act="exit">EXIT TO MENU</button>
          </div>
          <button class="pm-resume">RESUME</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    this.el = {
      root: ov,
      tabs: ov.querySelector('.pm-tabs'),
      content: ov.querySelector('.pm-content'),
      actions: ov.querySelector('.pm-actions'),
    };
    ov.querySelector('.pm-resume').onclick = () => this.hide();
    // Clicking the backdrop resumes. Clicking the panel must not, or every
    // slider drag that ends outside the thumb would close the menu.
    ov.onclick = (e) => { if (e.target === ov) this.hide(); };

    this.act = {};
    this._primed = null;      // which action is one click from happening
    for (const b of this.el.actions.querySelectorAll('.pm-act')) {
      this.act[b.dataset.act] = b;
      b.onclick = () => this._onAction(b.dataset.act, b);
    }

    for (const t of SETTING_TABS) {
      const b = document.createElement('button');
      b.className = 'pm-tab';
      b.dataset.tab = t.id;
      b.textContent = t.label;
      b.onclick = () => { this.tab = t.id; this._renderTabs(); this._renderContent(); };
      this.el.tabs.appendChild(b);
    }
    this._renderTabs();
    this._renderContent();
  }

  // A destructive action arms on the first click and fires on the second.
  // REDEPLOY is not destructive — trading a life for a spawn point is an
  // ordinary thing to do mid-match — so it goes straight through.
  _onAction(act, btn) {
    if (btn.disabled) return;
    if (btn.classList.contains('danger') && this._primed !== act) { this._prime(act); return; }
    this._unprime();
    // Close WITHOUT re-grabbing the mouse, and close before acting. `hide()`
    // normally requests pointer lock on the way out; a lock request that
    // resolves after `redeploy` has released it would re-lock the cursor on top
    // of the deploy map, and after a restart it would grab the loading screen.
    const g = this.game;
    this.hide(false);
    if (act === 'redeploy') { if (g) g.redeploy(); return; }
    if (act === 'restart' && this.host.restartMatch) this.host.restartMatch();
    else if (act === 'exit' && this.host.exitToMenu) this.host.exitToMenu();
  }

  _prime(act) {
    this._primed = act;
    this._paintActions();
    clearTimeout(this._primeTimer);
    // Un-arms itself: a button left reading CONFIRM? while the player reads a
    // settings tab is a button that fires on a click they meant for something
    // else three minutes later.
    this._primeTimer = setTimeout(() => this._unprime(), CONFIRM_HOLD * 1000);
  }

  _unprime() {
    clearTimeout(this._primeTimer);
    this._primed = null;
    this._paintActions();
  }

  // Labels and availability. Redeploy only means something while the player is
  // fielded — dead, undeployed or game over there is no life to spend, and the
  // deploy map they would be sent to is already up. Restart and exit are hidden
  // outright for a host that cannot perform them rather than shown dead.
  _paintActions() {
    const g = this.game;
    this.act.redeploy.disabled = !g || g.gameOver || g.playerDead;
    for (const [act, label, fn] of [
      ['restart', 'RESTART MATCH', this.host.restartMatch],
      ['exit', 'EXIT TO MENU', this.host.exitToMenu],
    ]) {
      const b = this.act[act];
      b.style.display = fn ? '' : 'none';
      b.classList.toggle('armed', this._primed === act);
      b.textContent = this._primed === act ? 'CONFIRM?' : label;
    }
  }

  _renderTabs() {
    for (const b of this.el.tabs.children) {
      b.classList.toggle('sel', b.dataset.tab === this.tab);
    }
  }

  // Rebuilt on tab change only, not per frame — these are DOM controls holding
  // their own state, and blowing them away under a drag would break the drag.
  _renderContent() {
    const c = this.el.content;
    c.innerHTML = '';
    const rows = Object.entries(SETTING_DEFS).filter(([, d]) => d.tab === this.tab);
    if (!rows.length) {
      c.innerHTML = '<div class="pm-empty">NOTHING HERE YET</div>';
      return;
    }
    for (const [key, def] of rows) {
      c.appendChild(def.kind === 'choice' ? this._choiceRow(key, def) : this._sliderRow(key, def));
    }
  }

  _row(def) {
    const row = document.createElement('div');
    row.className = 'pm-row';
    row.innerHTML = `<div class="pm-label">${def.label}</div>`
      + (def.hint ? `<div class="pm-hint">${def.hint}</div>` : '');
    return row;
  }

  // Segmented buttons rather than a <select>: three options that each need a
  // sentence of explanation are a choice to be read, not a list to be picked
  // from blind, and the note under the row changes with the selection.
  _choiceRow(key, def) {
    const row = this._row(def);
    const seg = document.createElement('div');
    seg.className = 'pm-seg';
    const note = document.createElement('div');
    note.className = 'pm-note';

    const paint = () => {
      const cur = getSetting(key);
      for (const b of seg.children) b.classList.toggle('sel', Number(b.dataset.v) === cur);
      const opt = def.options.find((o) => o.v === cur);
      note.textContent = (opt && opt.note) || '';
    };

    for (const o of def.options) {
      const b = document.createElement('button');
      b.className = 'pm-opt';
      b.dataset.v = o.v;
      b.textContent = o.label;
      b.onclick = () => { setSetting(key, o.v); paint(); };
      seg.appendChild(b);
    }
    row.appendChild(seg);
    row.appendChild(note);
    paint();
    return row;
  }

  _sliderRow(key, def) {
    const row = this._row(def);
    const wrap = document.createElement('div');
    wrap.className = 'pm-slider';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = def.min; input.max = def.max; input.step = def.step;
    input.value = getSetting(key);
    const val = document.createElement('span');
    val.className = 'pm-val';
    const paint = () => { val.textContent = def.fmt ? def.fmt(Number(input.value)) : input.value; };
    // `input`, not `change`: the whole point of a volume slider is that you hear
    // the result while dragging it.
    input.oninput = () => { setSetting(key, Number(input.value)); paint(); };
    paint();
    wrap.appendChild(input);
    wrap.appendChild(val);
    row.appendChild(wrap);
    return row;
  }

  show() {
    if (this.visible) return;
    this.visible = true;
    this.el.root.style.display = 'flex';
    this._unprime();   // nothing stays armed across an open
    // The sim does not stop for this menu (see the header), so the player can be
    // shot while reading a settings tab — and REDEPLOY has to stop offering a
    // life they no longer have. This menu has no frame hook of its own, so it
    // borrows a slow timer rather than being driven from the match: at four
    // repaints a second it is free, and it stops the moment the menu closes.
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => this._paintActions(), 250);
    const g = this.game;
    if (g) {
      g.refreshMenuOpen();
      // Drop any key still held at the moment the menu opened, or a soldier
      // walks into a wall for as long as the player reads a slider — `keyup`
      // fires for the real key, but the player never released it.
      if (g.player) g.player.keys = {};
    }
  }

  // `relock` false is for the footer actions: they close this menu on their way
  // to somewhere that owns the mouse itself (the deploy map, the lobby), and a
  // lock request racing that hand-off wins it back a frame too late.
  hide(relock = true) {
    if (!this.visible) return;
    this.visible = false;
    this.el.root.style.display = 'none';
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    this._unprime();
    const g = this.game;
    if (!g) return;
    g.refreshMenuOpen();
    // Back to the fight. Guarded inside requestLock — dead, spectating and
    // game-over states all refuse it, so this cannot re-grab the mouse at a
    // moment the player is meant to have it.
    if (relock && g.player && !g.menuOpen) g.player.requestLock();
  }
}
