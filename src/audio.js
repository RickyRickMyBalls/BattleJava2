// WebAudio: raw buffer-source playback for the player's gun (overlapping shots)
// and a throttled distance-attenuated pool for the 63 AI rifles.

export class GameAudio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;
    this.buffers = {};
    this.aiShotBudget = 0; // refilled per frame, limits concurrent AI bangs
  }

  init(buffers) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.buffers = buffers;
    this.noise = this._makeNoiseBuffer();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
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

  _play(buffer, volume, rate = 1, pan = 0) {
    if (!this.ctx || !buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    if (pan !== 0) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(g).connect(p).connect(this.master);
    } else {
      src.connect(g).connect(this.master);
    }
    src.start();
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

  // Distance-attenuated AI gunfire, budget-limited.
  playShotAt(pos, def) {
    if (!this.ctx || this.aiShotBudget <= 0) return;
    const dp = this._distPan(pos, 260);
    if (!dp) return;
    this.aiShotBudget--;
    const s = def ? def.snd : { key: 'shot', rate: 1, vol: 0.4 };
    const vol = Math.min(s.vol * 0.8, (9 / Math.max(10, dp.d)) * s.vol * 2);
    this._play(this.buffers[s.key], vol, s.rate * (0.92 + Math.random() * 0.12), dp.pan);
  }

  // Rocket detonation: filtered noise boom, audible far away.
  playExplosionAt(pos) {
    if (!this.ctx || !this.noise) return;
    const dp = this._distPan(pos, 500);
    if (!dp) return;
    const vol = Math.min(0.9, 45 / Math.max(15, dp.d));
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.55 + Math.random() * 0.2;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
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

  update() {
    this.aiShotBudget = 3; // per-frame cap on new AI shot sounds
  }
}
