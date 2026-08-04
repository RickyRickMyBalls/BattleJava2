// The supply wheel: hold Z, push the mouse at what you want, materiel flows
// while you hold. Release and it stops.
//
// WHY A WHEEL HERE AND NOWHERE ELSE. The rest of this game interacts with one
// contextual key — E — and a priority chain in `player._updateInteract` picks
// the single sensible action for where you are standing. That works because
// almost everywhere there IS a single sensible action: a bleeding squadmate
// wants reviving, a door wants opening. A depot breaks the assumption. Standing
// at a stocked sector you might want to take, to drop, or to do neither, and no
// amount of context-guessing can know which. That is the case a radial exists
// for, and it is the only case in this game that has it — so the wheel is
// scoped to supply rather than swallowing E.
//
// THE GESTURE IS ONE KEY. Hold Z and the wheel opens. Push the mouse toward a
// wedge and that action runs, continuously, for as long as you hold. Come back
// to the middle and it stops; release and the wheel closes. There is no confirm
// press and no amount to choose — the dead zone in the centre IS the "do
// nothing" option, and how long you hold is the amount.
//
// IT MUST NOT BREAK POINTER LOCK. Every other panel in this game can afford to
// free the cursor; this one cannot, because you open it in the field with
// people shooting at you. So it reads raw `movementX/Y` deltas the same way the
// camera does, and the camera is suppressed while it is open — otherwise
// choosing a wedge would spin you on the spot.

// How far the mouse must travel from centre before a wedge is live. In the same
// arbitrary units the accumulator uses (raw pixel deltas), and generous: a
// twitch while holding the key must not deliver 60 materiel you did not mean.
const DEADZONE = 55;
// Ceiling on the accumulator so a long push does not park the pointer miles
// off-screen and make coming back to the dead zone a chore.
const REACH = 130;

export class SupplyWheel {
  constructor(game) {
    this.game = game;
    this.el = {
      root: document.getElementById('supplyWheel'),
      hub: document.getElementById('swHub'),
      hubLabel: document.getElementById('swHubLabel'),
      hubVal: document.getElementById('swHubVal'),
      cargo: document.getElementById('swCargo'),
      opts: document.getElementById('swOpts'),
      dot: document.getElementById('swDot'),
    };
    this.open = false;
    this.mx = 0;              // accumulated mouse offset from centre
    this.my = 0;
    this.options = [];        // [{ act, label, el, enabled }]
    this.active = null;       // the option the pointer is currently on
    this.depot = null;
    this._sig = '';           // last option set built, so we rebuild only on change
  }

  get enabled() {
    return !!this.game.logistics;
  }

  setOpen(on) {
    if (on === this.open) return;
    // A mode with no supply network has nothing to put on it. Silently doing
    // nothing is right here — there is no feature to advertise.
    if (on && !this.enabled) return;
    this.open = on;
    this.mx = this.my = 0;
    this.active = null;
    if (this.el.root) this.el.root.style.display = on ? 'block' : 'none';
    if (!on) { this._sig = ''; this.depot = null; }
  }

  // Raw mouse delta, handed over by player.js INSTEAD of the camera while the
  // wheel is up. Same numbers the look code would have used.
  onMouse(dx, dy) {
    if (!this.open) return;
    this.mx += dx;
    this.my += dy;
    const d = Math.hypot(this.mx, this.my);
    if (d > REACH) { this.mx = (this.mx / d) * REACH; this.my = (this.my / d) * REACH; }
  }

  // The thing doing the carrying: the hog if you are in one, else your body.
  // Deliberately the same rule the HUD readout uses — what the wheel moves and
  // what the HUD reports must never be two different containers.
  _carrier() {
    const p = this.game.player;
    return p.vehicle || this.game.playerSoldier;
  }

  _cap() {
    const R = this.game.rules.resources;
    return this.game.player.vehicle ? R.vehicleCargo : R.backpack;
  }

  update(dt) {
    if (!this.open || !this.enabled) return;
    const logi = this.game.logistics;
    const team = this.game.playerTeam;
    const carrier = this._carrier();
    this.depot = carrier
      ? logi.nearest(team, carrier.pos.x, carrier.pos.z, logi.cfg.transferRadius)
      : null;

    this._buildOptions();
    this._pick();
    this._paint();

    if (!this.active || !this.active.enabled || !this.depot) return;
    const amt = logi.cfg.transferRate * dt;
    logi.transfer(carrier, this._cap(), this.depot,
      this.active.act === 'take' ? amt : -amt);
  }

  // What is on the wheel depends on what you are standing at, and the wedge set
  // is rebuilt only when that changes — this runs every frame while the wheel
  // is up, and rebuilding six DOM nodes per frame to say the same thing would
  // be silly.
  _buildOptions() {
    const d = this.depot;
    const sig = !d ? 'none' : d.kind;
    if (sig === this._sig) return;
    this._sig = sig;
    this.options = [];
    if (!this.el.opts) return;
    this.el.opts.innerHTML = '';

    // HQ is a source and only a source, which is the rule the whole economy
    // rests on — there is no DROP wedge here because putting materiel back in
    // the warehouse it came from is not a decision anyone needs to make.
    const acts = d && d.kind === 'hq' ? [{ act: 'take', label: 'LOAD UP' }]
      : d ? [{ act: 'take', label: 'TAKE' }, { act: 'drop', label: 'DROP OFF' }]
        : [];

    acts.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = 'sw-opt';
      el.textContent = a.label;
      // Two wedges sit left and right; one sits at the top. Angles are laid out
      // so the natural flick is never straight down, where the hand is worst.
      const ang = acts.length === 1 ? -Math.PI / 2
        : -Math.PI / 2 + (i === 0 ? -0.62 : 0.62);
      el.style.left = `${50 + Math.cos(ang) * 34}%`;
      el.style.top = `${50 + Math.sin(ang) * 34}%`;
      this.el.opts.appendChild(el);
      this.options.push({ ...a, el, ang, enabled: true });
    });
  }

  // Which wedge the pointer is on: nearest by ANGLE once outside the dead zone,
  // rather than by proximity to the label. Angle is what the hand is actually
  // controlling — a flick has a direction long before it has a destination.
  _pick() {
    const d = Math.hypot(this.mx, this.my);
    if (d < DEADZONE || !this.options.length) { this.active = null; return; }
    const a = Math.atan2(this.my, this.mx);
    let best = null, bestD = Infinity;
    for (const o of this.options) {
      let diff = Math.abs(((a - o.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff < bestD) { bestD = diff; best = o; }
    }
    // Beyond a quadrant away from every wedge is a push at nothing, not a
    // sloppy push at the nearest thing.
    this.active = bestD < Math.PI / 2.2 ? best : null;
  }

  _paint() {
    const carrier = this._carrier();
    const cap = this._cap();
    const cargo = carrier ? carrier.cargo : 0;

    if (this.el.dot) {
      this.el.dot.style.transform =
        `translate(-50%, -50%) translate(${this.mx * 0.62}px, ${this.my * 0.62}px)`;
    }
    if (this.el.hubLabel && this.el.hubVal) {
      // The hub answers the question you opened the wheel to ask, and it
      // answers it BEFORE you commit: what is here, and what am I carrying.
      const d = this.depot;
      this.el.hubLabel.textContent = !d ? 'NO DEPOT IN RANGE'
        : d.kind === 'hq' ? 'HQ STOCKPILE' : `SECTOR ${d.sec.id}`;
      this.el.hubVal.textContent = d ? Math.floor(d.stock) : '—';
    }
    if (this.el.cargo) this.el.cargo.textContent = `${Math.floor(cargo)} / ${cap}`;

    for (const o of this.options) {
      // A wedge that cannot do anything right now says so by looking spent —
      // TAKE at an empty depot, DROP with an empty pack. Better than letting
      // you push at it and watch nothing happen.
      const dead = o.act === 'take'
        ? (!this.depot || this.depot.stock <= 0 || cargo >= cap)
        : (cargo <= 0 || !this.depot || this.depot.stock >= this.depot.cap);
      o.enabled = !dead;
      o.el.className = 'sw-opt'
        + (o === this.active ? ' active' : '')
        + (dead ? ' dead' : '');
    }
  }
}
