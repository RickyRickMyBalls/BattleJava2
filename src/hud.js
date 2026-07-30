// DOM HUD: vitals, ammo, tickets, sector pips, minimap, kill feed, death/end screens.

import { CFG, TEAM } from './config.js';

const BLUE = '#3aa0ff', RED = '#ff5a4d', NEUTRAL = '#9ab4c4';

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
      ammoMag: document.getElementById('ammoMag'),
      ammoRes: document.getElementById('ammoRes'),
      reloadingTxt: document.getElementById('reloadingTxt'),
      hitmarker: document.getElementById('hitmarker'),
      damageVignette: document.getElementById('damageVignette'),
      crosshair: document.getElementById('crosshair'),
      vitals: document.getElementById('vitals'),
      ammo: document.getElementById('ammo'),
      squad: document.getElementById('squad'),
      order: document.getElementById('order'),
      minimapWrap: document.getElementById('minimapWrap'),
      hint: document.getElementById('hint'),
      endScreen: document.getElementById('endScreen'),
      endTitle: document.getElementById('endTitle'),
      endStats: document.getElementById('endStats'),
      tcPause: document.getElementById('tcPause'),
      timeCtrl: document.getElementById('timeCtrl'),
      modeTag: document.getElementById('modeTag'),
    };
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

    for (const s of this.game.world.sectors) {
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

  setAmmo(mag, res) {
    this.el.ammoMag.textContent = mag;
    this.el.ammoRes.textContent = `| ${res}`;
  }
  setReloading(on) { this.el.reloadingTxt.style.display = on ? 'block' : 'none'; }

  setVitals(shield, health, maxShield = CFG.soldier.shield) {
    this.el.shieldbar.firstElementChild.style.width = `${Math.max(0, (shield / maxShield) * 100)}%`;
    this.el.healthbar.firstElementChild.style.width = `${Math.max(0, (health / CFG.soldier.health) * 100)}%`;
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
    if (label) label.textContent = squad ? `${squad.name.toUpperCase()} SQUAD` : 'NO SQUAD';
    if (!squad) {
      this.el.squadList.innerHTML = '<div class="mate dead"><span>lone wolf</span></div>';
      return;
    }
    const rows = [];
    for (const m of squad.members) {
      if (m.isPlayer) continue;
      const hpPct = m.alive ? ((m.shield + m.health) / (m.maxShield + CFG.soldier.health)) * 100 : 0;
      rows.push(`<div class="mate${m.alive ? '' : ' dead'}"><span>${m.name}</span><span class="hp"><div style="width:${hpPct}%"></div></span></div>`);
    }
    this.el.squadList.innerHTML = rows.join('');
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

  // Toggle between map-hub chrome and first-person chrome.
  setMode(mode) {
    const fps = mode === 'fps';
    const set = (el, on) => { if (el) el.style.display = on ? '' : 'none'; };
    set(this.el.crosshair, fps);
    set(this.el.vitals, fps);
    set(this.el.ammo, fps);
    set(this.el.squad, fps);
    set(this.el.order, fps);
    set(this.el.minimapWrap, fps);
    set(this.el.hint, fps);
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
    this.mmTimer -= dt;
    if (this.mmTimer <= 0) {
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
