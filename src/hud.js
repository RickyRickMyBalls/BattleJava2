// DOM HUD: vitals, ammo, tickets, sector pips, minimap, kill feed, death/end screens.

import * as THREE from 'three';
import { CFG, TEAM } from './config.js';
import { Visor } from './visor.js';

const BLUE = '#3aa0ff', RED = '#ff5a4d', NEUTRAL = '#9ab4c4';
const DOWN = '#ffd66e';
const D = CFG.downed;
const _p = new THREE.Vector3();

export class Hud {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: document.getElementById('hud'),
      ticketsBlue: document.getElementById('ticketsBlue'),
      ticketsRed: document.getElementById('ticketsRed'),
      sectors: document.getElementById('sectors'),
      minimap: document.getElementById('minimap'),
      killfeed: document.getElementById('killfeed'),
      orderText: document.getElementById('orderText'),
      msg: document.getElementById('msg'),
      squadList: document.getElementById('squadList'),
      shieldbar: document.getElementById('shieldbar'),
      healthbar: document.getElementById('healthbar'),
      stambar: document.getElementById('stambar'),
      ammoMag: document.getElementById('ammoMag'),
      ammoRes: document.getElementById('ammoRes'),
      reloadingTxt: document.getElementById('reloadingTxt'),
      gadgets: document.getElementById('hudGadgets'),
      hitmarker: document.getElementById('hitmarker'),
      casualties: document.getElementById('casualties'),
      damageVignette: document.getElementById('damageVignette'),
      downVignette: document.getElementById('downVignette'),
      prompt: document.getElementById('prompt'),
      promptText: document.getElementById('promptText'),
      promptBar: document.getElementById('promptBar'),
      crosshair: document.getElementById('crosshair'),
      vitals: document.getElementById('vitals'),
      ammo: document.getElementById('ammo'),
      squad: document.getElementById('squad'),
      order: document.getElementById('order'),
      minimapWrap: document.getElementById('minimapWrap'),
      hint: document.getElementById('hint'),
      topbar: document.getElementById('topbar'),
      endScreen: document.getElementById('endScreen'),
      endTitle: document.getElementById('endTitle'),
      endStats: document.getElementById('endStats'),
      tcPause: document.getElementById('tcPause'),
      timeCtrl: document.getElementById('timeCtrl'),
      modeTag: document.getElementById('modeTag'),
      visor: document.getElementById('visor'),
    };
    // Not awaited — see Visor.mount. The DOM vitals stack is the readout until
    // the frame lands, so nothing is missing in the meantime.
    this.visor = new Visor();
    this.visor.mount(this.el.visor);
    this.el.tcPause.onclick = () => this.game.togglePause();
    for (const btn of this.el.timeCtrl.querySelectorAll('[data-speed]')) {
      btn.onclick = () => this.game.setTimeScale(Number(btn.dataset.speed));
    }
    this.ctx = this.el.minimap.getContext('2d');
    this.sectorPips = [];
    this.hitmarkerTimer = 0;
    this.vignetteTimer = 0;
    this.msgTimer = 0;
    this.spottedShooters = new Map(); // soldier -> ttl, for minimap enemy blips
    this.mmTimer = 0;

    // Cleared first: one `#sectors` element outlives every Hud built against
    // it, and a host with no sectors at all (the lobby arena) is legal.
    this.el.sectors.replaceChildren();
    for (const s of this.game.world.sectors || []) {
      const pip = document.createElement('div');
      pip.className = 'sector-pip';
      const fill = document.createElement('div');
      fill.className = 'fill';
      const span = document.createElement('span');
      span.textContent = s.id;
      pip.appendChild(fill);
      pip.appendChild(span);
      this.el.sectors.appendChild(pip);
      this.sectorPips.push({ pip, fill, span });
    }
  }

  show() { this.el.hud.style.display = 'block'; }
  hide() { this.el.hud.style.display = 'none'; }

  setAmmo(mag, res) {
    this.el.ammoMag.textContent = mag;
    this.el.ammoRes.textContent = `| ${res}`;
  }
  setReloading(on) { this.el.reloadingTxt.style.display = on ? 'block' : 'none'; }

  // Consumable gadget charges. Rebuilt only when the readout actually changes —
  // this runs every frame, and blowing away innerHTML each time would restart
  // the SVGs and thrash the layout for no reason.
  setGadgets(biofoam, grenade, gadgets) {
    // The two universal consumables, plus any slot gadget that actually does
    // something. Unbuilt ones stay absent on purpose — a counter for something
    // that does nothing is worse than no counter.
    const shown = [];
    if (biofoam) {
      shown.push({ def: biofoam.def, n: biofoam.charges, busy: biofoam.useTimer > 0, tag: 'key X' });
    }
    if (grenade) {
      shown.push({ def: grenade.def, n: grenade.count, busy: grenade.useTimer > 0, tag: 'key G' });
    }
    (gadgets || []).forEach((g, i) => {
      if (!g || !g.def.built || g.def.kind === 'weaponSlot') return;
      shown.push({ def: g.def, n: g.charges, busy: g.useTimer > 0, tag: `key ${3 + i}` });
    });
    const sig = shown.map((g) => `${g.def.name}:${g.n}:${g.busy ? 1 : 0}`).join('|');
    if (sig === this._gadgetSig) return;
    this._gadgetSig = sig;
    this.el.gadgets.innerHTML = shown.map((g) => {
      const cls = g.busy ? 'busy' : (g.n <= 0 ? 'empty' : '');
      return `<div class="gad ${cls}" title="${g.def.name} — ${g.tag}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${g.def.svg || ''}</svg>
        <span class="n">${g.n}</span>
      </div>`;
    }).join('');
  }

  setVitals(shield, health, maxShield = CFG.soldier.shield) {
    this.el.shieldbar.firstElementChild.style.width = `${Math.max(0, (shield / maxShield) * 100)}%`;
    this.el.healthbar.firstElementChild.style.width = `${Math.max(0, (health / CFG.soldier.health) * 100)}%`;
    this.visor.setVitals(shield, health, maxShield, CFG.soldier.health);
  }

  // Stamina gets its own setter rather than more arguments on setVitals: it is
  // the one vital that is usually full, and being full is the case where it
  // must not be on screen at all. Passing `unlimited` (MJOLNIR) hides it
  // permanently — a bar that can never move is noise, not information.
  setStamina(stamina, maxStamina, unlimited, spent) {
    const el = this.el.stambar;
    if (!el) return;
    const full = unlimited || !isFinite(maxStamina) || stamina >= maxStamina - 0.01;
    el.style.opacity = full ? 0 : 1;
    el.classList.toggle('spent', !!spent);
    if (full) return;   // width under a hidden bar is nobody's business
    el.firstElementChild.style.width = `${Math.max(0, (stamina / maxStamina) * 100)}%`;
  }

  showHitmarker(kill) {
    const hm = this.el.hitmarker;
    hm.classList.toggle('kill', !!kill);
    hm.style.opacity = 1;
    this.hitmarkerTimer = 0.18;
    this.game.audio.playUI(kill ? 'kill' : 'hit');
  }

  showDamage() {
    this.el.damageVignette.style.opacity = 1;
    this.vignetteTimer = 0.4;
  }

  // The bleedout readout. `frac` is time REMAINING, 1 down to 0, and it drives
  // the aperture rather than any number on screen.
  //
  // The aperture floors at 14% instead of closing to black: the point is dread,
  // not blindness, and a player who cannot see the teammate sprinting toward
  // them has lost the only thing this state has to offer. The crosshair goes —
  // there is nothing to aim.
  setDowned(frac, on) {
    if (on === this._downOn && (!on || Math.abs(frac - this._downFrac) < 0.004)) return;
    this._downOn = on;
    this._downFrac = frac;
    const v = this.el.downVignette;
    if (!on) {
      v.style.opacity = 0;
      this.el.crosshair.style.display = '';
      return;
    }
    // Ease so the closing accelerates: the last seconds should feel worse than
    // an even squeeze would make them.
    const t = 1 - Math.max(0, Math.min(1, frac));
    const inner = 55 - 41 * t * t;          // 55% open -> 14% at zero
    v.style.opacity = 1;
    v.style.background =
      `radial-gradient(circle at center, transparent ${inner}%, rgba(2,6,10,0.97) ${inner + 23}%)`;
    this.el.crosshair.style.display = 'none';
  }

  // Centred interaction prompt — "HOLD E — PICK UP <name>" — with an optional
  // 0..1 progress bar under it. Rebuilt only on change: this runs every frame.
  setPrompt(text, progress = 0) {
    if (text !== this._promptText) {
      this._promptText = text;
      this.el.prompt.style.display = text ? 'block' : 'none';
      if (text) this.el.promptText.textContent = text;
    }
    if (!text) return;
    const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
    if (pct !== this._promptPct) {
      this._promptPct = pct;
      this.el.promptBar.style.width = `${pct}%`;
    }
  }

  // Casualty markers. Recovery being open to the whole team is worth nothing if
  // you cannot tell who is down — the pickup prompt only reaches `reviveRange`,
  // so without these a player finds a casualty by tripping over one.
  //
  // A pool of divs reused in place. 26 bodies on the ground at once is a normal
  // reading in a heavy push, and rebuilding innerHTML per frame at that count
  // would restart the pulse animation on every marker every frame.
  updateCasualties() {
    const g = this.game;
    const cam = g.camera;
    const pool = this._casPool || (this._casPool = []);
    const me = g.playerSoldier;
    const team = g.teams && g.teams[g.playerTeam];
    let n = 0;

    if (team && cam && !g.spectating) {
      const found = [];
      for (const s of team.soldiers) {
        if (!s.downed || s === me) continue;
        const d = cam.position.distanceTo(s.pos);
        if (d > D.markerRange) continue;
        found.push({ s, d });
      }
      // Calls first, then nearest. With a cap on how many draw at once, this is
      // what decides who gets dropped — and a soldier shouting should never be
      // the one culled for a silent body two metres closer.
      found.sort((a, b) => (b.s.callTimer > 0) - (a.s.callTimer > 0) || a.d - b.d);
      n = Math.min(found.length, D.markerMax);

      const w = window.innerWidth, h = window.innerHeight;
      for (let i = 0; i < n; i++) {
        const { s, d } = found[i];
        let el = pool[i];
        if (!el) {
          el = document.createElement('div');
          el.innerHTML = '<span class="ico">✚</span><span class="n"></span><span class="d"></span>';
          this.el.casualties.appendChild(el);
          pool[i] = el;
        }
        _p.set(s.pos.x, s.pos.y + 0.7, s.pos.z).project(cam);
        // Behind the camera, `project` mirrors x/y through the origin, so a
        // casualty at your back would draw on the wrong side of the screen.
        const behind = _p.z > 1;
        let x = (behind ? -_p.x : _p.x) * 0.5 + 0.5;
        let y = (behind ? _p.y : -_p.y) * 0.5 + 0.5;
        const edge = behind || x < 0.03 || x > 0.97 || y < 0.06 || y > 0.94;
        if (behind) y = 0.94;               // pin to the bottom: it is behind you
        x = Math.max(0.03, Math.min(0.97, x));
        y = Math.max(0.06, Math.min(0.94, y));
        const cls = `cas${edge ? ' edge' : ''}${s.callTimer > 0 ? ' calling' : ''}`;
        if (el.className !== cls) el.className = cls;
        el.style.left = `${(x * w).toFixed(0)}px`;
        el.style.top = `${(y * h).toFixed(0)}px`;
        const nm = s.callTimer > 0 ? `${s.name} — HELP` : s.name;
        if (el.children[1].textContent !== nm) el.children[1].textContent = nm;
        const dm = ` ${Math.round(d)}m`;
        if (el.children[2].textContent !== dm) el.children[2].textContent = dm;
        el.style.display = '';
      }
    }
    for (let i = n; i < pool.length; i++) pool[i].style.display = 'none';
  }

  message(text, seconds = 3) {
    this.el.msg.textContent = text;
    this.el.msg.style.opacity = 1;
    this.msgTimer = seconds;
  }

  addKill(attacker, victim) {
    const div = document.createElement('div');
    const an = attacker ? `<span class="${attacker.team === TEAM.BLUE ? 'b' : 'r'}">${attacker.name}</span>` : '—';
    const vn = `<span class="${victim.team === TEAM.BLUE ? 'b' : 'r'}">${victim.name}</span>`;
    div.innerHTML = `${an} ✕ ${vn}`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  setOrder(text) { this.el.orderText.textContent = text; }

  setTimeControls(paused, scale) {
    this.el.tcPause.classList.toggle('active', paused);
    this.el.tcPause.textContent = paused ? '▶' : '❚❚';
    for (const btn of this.el.timeCtrl.querySelectorAll('[data-speed]')) {
      btn.classList.toggle('active', !paused && Number(btn.dataset.speed) === scale);
    }
  }

  setModeTag(text) {
    this.el.modeTag.style.display = text ? 'block' : 'none';
    if (text) this.el.modeTag.textContent = text;
  }

  setWeaponName(name) {
    const el = document.getElementById('wpnName');
    if (el) el.textContent = name;
  }

  notePlayerAwareShot(shooter) {
    // enemy fired: reveal briefly on minimap
    if (shooter.team !== this.game.playerTeam) this.spottedShooters.set(shooter, 3);
  }

  updateSquadList(squad) {
    const label = document.getElementById('squadLabel');
    // Whether the player holds the job is the one fact this panel gains by
    // knowing about leadership — it is the only place a player can check
    // without pressing the key and being told no.
    const iLead = !!squad && squad.leader === this.game.playerSoldier;
    if (label) {
      label.textContent = squad
        ? `${squad.name.toUpperCase()} SQUAD${iLead ? ' — YOU LEAD' : ''}`
        : 'NO SQUAD';
    }
    if (!squad) {
      this.el.squadList.innerHTML = '<div class="mate dead"><span>lone wolf</span></div>';
      return;
    }
    const rows = [];
    for (const m of squad.members) {
      if (m.isPlayer) continue;
      const lead = m === squad.leader ? '<i class="lead">&#9650;</i>' : '';
      const hpPct = m.alive ? ((m.shield + m.health) / (m.maxShield + CFG.soldier.health)) * 100 : 0;
      // A downed squadmate is not a dead one — the row has to say so, because
      // this list is where you look to decide whether anyone is worth going to.
      // The bar shows bleedout remaining, which is the only number that matters
      // about them.
      if (m.downed) {
        const left = Math.max(0, m.downTimer / D.bleedout) * 100;
        rows.push(`<div class="mate down"><span>${lead}${m.name} ${m.callTimer > 0 ? '— HELP' : 'DOWN'}</span>`
          + `<span class="hp"><div style="width:${left}%;background:${DOWN}"></div></span></div>`);
        continue;
      }
      rows.push(`<div class="mate${m.alive ? '' : ' dead'}"><span>${lead}${m.name}</span><span class="hp"><div style="width:${hpPct}%"></div></span></div>`);
    }
    const html = rows.join('');
    if (html !== this._squadHtml) { this._squadHtml = html; this.el.squadList.innerHTML = html; }
  }

  updateSectors(sectors) {
    sectors.forEach((s, i) => {
      const { pip, fill } = this.sectorPips[i];
      const col = s.owner === TEAM.BLUE ? BLUE : s.owner === TEAM.RED ? RED : 'transparent';
      fill.style.background = col;
      pip.style.borderColor = s.contested ? '#ffd66e' : 'rgba(127,212,255,0.35)';
    });
  }

  setTickets(blue, red) {
    this.el.ticketsBlue.textContent = Math.max(0, Math.ceil(blue));
    this.el.ticketsRed.textContent = Math.max(0, Math.ceil(red));
  }

  // The crosshair marks where the shot goes, so it has no business being up in
  // a view that cannot shoot (third person).
  setCrosshairVisible(on) {
    if (this.el.crosshair) this.el.crosshair.style.display = on ? '' : 'none';
  }

  // Map-hub chrome, first-person chrome, or the lobby range.
  //
  // 'range' is the lobby roam mode: a real Player on a real arena, but no
  // match behind it. It splits the chrome along the line of what a readout
  // actually depends on — everything you read because you are holding a gun
  // stays, everything that reports on a match goes. Tickets, sectors, squad
  // and the minimap have no data in the lobby; the hint is off because the
  // lobby prints its own ("ESC RETURN TO SETUP").
  setMode(mode) {
    const fps = mode === 'fps';
    const armed = fps || mode === 'range';
    const set = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
    set(this.el.crosshair, armed);
    set(this.el.visor, armed);
    set(this.el.vitals, armed);
    set(this.el.ammo, armed);
    set(this.el.squad, fps);
    set(this.el.order, fps);
    set(this.el.minimapWrap, fps);
    set(this.el.casualties, fps);
    set(this.el.hint, fps);
    set(this.el.topbar, fps); // deploy screen has its own header
  }

  showEnd(win, stats) {
    this.el.endScreen.style.display = 'flex';
    this.el.endTitle.textContent = win ? 'VICTORY' : 'DEFEAT';
    this.el.endTitle.style.color = win ? BLUE : RED;
    this.el.endStats.textContent = stats;
    document.exitPointerLock();
  }

  update(dt) {
    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer -= dt;
      if (this.hitmarkerTimer <= 0) this.el.hitmarker.style.opacity = 0;
    }
    if (this.vignetteTimer > 0) {
      this.vignetteTimer -= dt;
      if (this.vignetteTimer <= 0) this.el.damageVignette.style.opacity = 0;
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.msg.style.opacity = 0;
    }
    for (const [s, ttl] of this.spottedShooters) {
      if (ttl - dt <= 0) this.spottedShooters.delete(s);
      else this.spottedShooters.set(s, ttl - dt);
    }
    // Every frame, unlike the minimap: these are screen-projected, so throttling
    // them would make markers visibly lag the camera when you turn.
    this.updateCasualties();
    // The minimap is a match readout through and through — teams, sector
    // ownership, the HQ list. The lobby arena has none of those, so it has
    // nothing to draw, which is cheaper than guarding every loop inside.
    this.mmTimer -= dt;
    if (this.mmTimer <= 0 && this.game.teams) {
      this.mmTimer = 0.12;
      this._drawMinimap();
    }
  }

  _drawMinimap() {
    const ctx = this.ctx;
    const wpx = this.el.minimap.width, hpx = this.el.minimap.height;
    const w = this.game.world.mapW, d = this.game.world.mapD;
    const sx = wpx / w, sz = hpx / d;
    const X = (x) => (x + w / 2) * sx;
    const Z = (z) => (z + d / 2) * sz;

    ctx.fillStyle = 'rgba(6,14,22,0.92)';
    ctx.fillRect(0, 0, wpx, hpx);

    // HQs
    for (const hq of this.game.world.hqDefs) {
      ctx.fillStyle = hq.team === TEAM.BLUE ? BLUE : RED;
      ctx.fillRect(X(hq.x) - 4, Z(hq.z) - 4, 8, 8);
    }
    // Sectors
    for (const s of this.game.world.sectors) {
      ctx.beginPath();
      ctx.arc(X(s.x), Z(s.z), 9, 0, Math.PI * 2);
      ctx.strokeStyle = s.contested ? '#ffd66e' : NEUTRAL;
      ctx.lineWidth = 1.5;
      if (s.owner !== null) {
        ctx.fillStyle = (s.owner === TEAM.BLUE ? 'rgba(58,160,255,0.45)' : 'rgba(255,90,77,0.45)');
        ctx.fill();
      }
      ctx.stroke();
      ctx.fillStyle = '#cfe6f5';
      ctx.font = '8px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.id, X(s.x), Z(s.z));
    }
    // Friendlies (squadmates in green)
    const mySquad = this.game.playerSquad;
    for (const s of this.game.teams[this.game.playerTeam].soldiers) {
      if (!s.alive || s.isPlayer) continue;
      ctx.fillStyle = mySquad && s.squad === mySquad ? '#3ddc7a' : BLUE;
      ctx.fillRect(X(s.pos.x) - 1.5, Z(s.pos.z) - 1.5, 3, 3);
    }
    // Spotted enemies
    ctx.fillStyle = RED;
    for (const [s] of this.spottedShooters) {
      if (!s.alive) continue;
      ctx.fillRect(X(s.pos.x) - 1.5, Z(s.pos.z) - 1.5, 3, 3);
    }
    // Downed friendlies. Drawn after the living so a casualty is never painted
    // over by a squadmate standing on top of them, and as a cross rather than a
    // dot so it reads at 3 px. A live call gets a ring — findable at a glance
    // is the entire job of this marker.
    for (const s of this.game.teams[this.game.playerTeam].soldiers) {
      if (!s.downed) continue;
      const x = X(s.pos.x), z = Z(s.pos.z);
      ctx.strokeStyle = DOWN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 2.5, z); ctx.lineTo(x + 2.5, z);
      ctx.moveTo(x, z - 2.5); ctx.lineTo(x, z + 2.5);
      ctx.stroke();
      if (s.callTimer > 0) {
        ctx.beginPath();
        ctx.arc(x, z, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Friendly supply crates, in their own contents colour. Squares, so they
    // read as equipment rather than as another soldier blip.
    const sup = this.game.supply;
    if (sup) {
      for (const c of sup.crates) {
        if (c.team !== this.game.playerTeam || c.pool <= 0) continue;
        ctx.fillStyle = `#${c.def.crate.color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(X(c.pos.x) - 2.5, Z(c.pos.z) - 2.5, 5, 5);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(X(c.pos.x) - 2.5, Z(c.pos.z) - 2.5, 5, 5);
      }
    }
    // Player arrow (camera position while spectating)
    const p = this.game.player;
    if (p) {
      const px = this.game.spectating ? this.game.camera.position.x : p.pos.x;
      const pz = this.game.spectating ? this.game.camera.position.z : p.pos.z;
      ctx.save();
      ctx.translate(X(px), Z(pz));
      ctx.rotate(-(this.game.spectating ? p.fcYaw : p.yaw));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -5); ctx.lineTo(3.4, 4); ctx.lineTo(-3.4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
}
