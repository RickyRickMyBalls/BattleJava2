// WebAudio: raw buffer-source playback for the player's gun (overlapping shots)
// and a throttled distance-attenuated pool for the 63 AI rifles.

import { CFG } from './config.js';
import { getSetting } from './settings.js';

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this._pending = []; // AI shots queued this frame, spent by update()
  }

  init(buffers) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    // Seeded from the setting rather than a constant. The context is created on
    // the player's first interaction, which is long after the menu could have
    // moved the slider — so this is the second half of the write in main.js,
    // not a duplicate of it.
    this.master.gain.value = getSetting('volume');
    this.master.connect(this.ctx.destination);
    this.buffers = buffers;
    this.noise = this._makeNoiseBuffer();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // The context is per-match, and a browser caps how many one page may hold
  // open — so leaving a match has to hand this one back rather than leak it and
  // let the fourth or fifth restart come up silent. `buffers` is the shared
  // asset library and is only being let go of, not freed.
  dispose() {
    this._pending.length = 0;
    this.buffers = {};
    this.noise = null;
    this.master = null;
    if (this.ctx) {
      const ctx = this.ctx;
      this.ctx = null;
      ctx.close().catch(() => {});   // already closing, or never opened
    }
  }

  _makeNoiseBuffer() {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * 0.7);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    return buf;
  }

  // `lp` is a lowpass cutoff in Hz — 0 (or anything past `lpBypass`) skips the
  // filter node, so the player's own gun and the UI blips cost exactly what they
  // did before. connect() returns its destination, so the chain builds by
  // reassignment and every optional stage is one `if`.
  _play(buffer, volume, rate = 1, pan = 0, lp = 0) {
    if (!this.ctx || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    let node = src.connect(g);
    if (lp > 0 && lp < CFG.audio.lpBypass) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      node = node.connect(f);
    }
    if (pan !== 0) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.master);
    src.start();
  }

  // Cutoff for a sound `d` metres off. See the CFG.audio comment: the ear reads
  // distance off the MISSING top end more than off the level, which is why a
  // 300 m firefight at the same gain still has to sound 300 m away.
  _lpFor(d, near, far, falloff) {
    return far + (near - far) * Math.exp(-d / falloff);
  }

  // Player weapon fire — def.snd selects buffer/rate/volume.
  playShot(def) {
    const s = def.snd;
    this._play(this.buffers[s.key], s.vol, s.rate * (0.96 + Math.random() * 0.08));
  }

  playUI(kind) {
    const b = this.buffers;
    if (kind === 'reload') this._play(b.reload, 0.7);
    else if (kind === 'empty') this._play(b.empty, 0.6);
    else if (kind === 'hit') this._blip(1400, 0.06, 0.12);
    else if (kind === 'kill') this._blip(700, 0.12, 0.2);
    else if (kind === 'shieldLow') this._blip(220, 0.2, 0.15);
    // Two-tone pairs, so casualty cues are audibly a different family from the
    // single-blip combat feedback above. Synthesized — no new audio asset.
    else if (kind === 'callHelp') { this._blip(520, 0.1, 0.16); this._blip(760, 0.13, 0.16, 0.11); }
    else if (kind === 'revived') { this._blip(560, 0.09, 0.15); this._blip(880, 0.15, 0.17, 0.09); }
    else if (kind === 'resupply') { this._blip(660, 0.07, 0.13); this._blip(990, 0.1, 0.13, 0.07); }
  }

  _blip(freq, dur, vol, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  _distPan(pos, maxDist) {
    const cam = this.game.camera.position;
    const d = Math.hypot(pos.x - cam.x, pos.y - cam.y, pos.z - cam.z);
    if (d > maxDist) return null;
    return { d, pan: this._panFor(pos) };
  }

  // AI gunfire. QUEUED, not played: which shots are worth a voice depends on
  // what else fires this frame, and the answer is not known yet. `update()`
  // spends the budget — see _flushShots.
  playShotAt(pos, def) {
    if (!this.ctx) return;
    const A = CFG.audio;
    if (this._pending.length >= A.queueMax) return;
    const dp = this._distPan(pos, A.shotMaxDist);
    if (!dp) return;
    this._pending.push({ d: dp.d, pan: dp.pan, def });
  }

  _playShotNow(c) {
    const A = CFG.audio;
    const s = c.def ? c.def.snd : { key: 'shot', rate: 1, vol: 0.4 };
    // Inverse distance: flat inside shotRef, ref/(ref + rolloff*(d-ref)) beyond.
    const atten = A.shotRef / (A.shotRef + A.shotRolloff * Math.max(0, c.d - A.shotRef));
    this._play(this.buffers[s.key], s.vol * A.shotPeak * atten,
      s.rate * (0.92 + Math.random() * 0.12), c.pan,
      this._lpFor(c.d, A.lpNear, A.lpFar, A.lpFalloff));
  }

  _flushShots() {
    const q = this._pending;
    if (!q.length) return;
    const A = CFG.audio;
    const near = [], far = [];
    for (const c of q) (c.d <= A.farBand ? near : far).push(c);
    near.sort((a, b) => a.d - b.d);
    for (let i = 0; i < A.nearSlots && i < near.length; i++) this._playShotNow(near[i]);
    // The far slots pick at RANDOM rather than nearest-first: with the cull out
    // at 600 m, nearest-first would replay the same mid-range firefight every
    // frame and the far half of the map would never be heard at all.
    for (let i = 0; i < A.farSlots && far.length; i++) {
      this._playShotNow(far.splice(Math.floor(Math.random() * far.length), 1)[0]);
    }
  }

  // Rocket detonation: filtered noise boom, audible far away.
  playExplosionAt(pos) {
    if (!this.ctx || !this.noise) return;
    const A = CFG.audio;
    const dp = this._distPan(pos, A.boomMaxDist);
    if (!dp) return;
    const vol = A.boomPeak * (A.boomRef / (A.boomRef + A.boomRolloff * Math.max(0, dp.d - A.boomRef)));
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.55 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = this._lpFor(dp.d, A.boomLpNear, A.boomLpFar, A.boomLpFalloff);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    const p = this.ctx.createStereoPanner();
    p.pan.value = dp.pan;
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start();
  }

  _panFor(pos) {
    const cam = this.game.camera;
    const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z;
    // right vector from camera yaw
    const e = cam.rotation;
    const rx = Math.cos(e.y), rz = -Math.sin(e.y);
    const len = Math.hypot(dx, dz) || 1;
    return Math.max(-1, Math.min(1, (dx * rx + dz * rz) / len));
  }

  // Per-frame audio tick: spend the budget on the shots queued since the last
  // one, then start over. Whether this runs before or after the sim's own update
  // only decides whether the queue is same-frame or one frame stale — and a
  // frame of latency is 16 ms, which sound covers in 5 m. Any loop driving a
  // GameAudio must call this or nothing positional is ever heard.
  update() {
    this._flushShots();
    this._pending.length = 0;
  }
}
