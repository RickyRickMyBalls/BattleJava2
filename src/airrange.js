// The air proving ground — the AIR tab of /chartest.html.
//
// Phase 3 of AIR_VEHICLE_PLAN.md, and it is its own phase for the same reason
// the VEHICLE tab was: it is the tool that FINISHES phase 2. Every number in
// `CFG.vehicle.pelican.flight` was chosen to be roughly right, and this is where
// they are made right.
//
// Two things make it an instrument rather than a sandbox, and only the second
// one is inherited from the ground range:
//
// 1. THE MANOEUVRES ARE SCRIPTED, FROM SEEDED INITIAL CONDITIONS. This is the
//    air equivalent of the ground range's flat centre lane, and it matters more
//    here, not less. A hog can be driven down the same straight twice; NOBODY
//    CAN HAND-FLY THE SAME 90 DEGREE TURN TWICE. Numbers taken off a hand-flown
//    turn are not comparable between two tunings, which makes them worse than
//    no numbers at all, because they look like evidence. So every measurement
//    below starts by placing the aircraft at a known altitude, attitude and
//    speed, and then flies it with a script.
//
// 2. IT REPORTS NUMBERS. Top speed, turn completion time, peak drift angle,
//    peak sideslip, bank, turn radius, hover hold. A flight model is not
//    tunable by vibes any more than a suspension is: "feels floaty" is a turn
//    rate and a drag ratio.
//
// Free flight is here too (arrow keys aim, W throttles) but it is for sanity,
// not for measurement. The mouse-look version is the game.
//
// The range owns its own world object — `heightAt`, `collision`, `coverBoxes`
// and `clampToMap` is the whole surface `Vehicle` needs, which is why the
// physics lifts out of the match onto a test rig with no Game in sight.

import * as THREE from 'three';
import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';

const R = 1400;             // half-extent of the air range, metres
// Where the straight-line runs START, so the whole run fits inside the range.
// A coast-down from cruise covers most of a kilometre before it is even at half
// speed — measured — and an aircraft pinned against `clampToMap` reports that
// as drag it does not have.
const RUNWAY = R - 200;
const PAD = 40;             // radius of the landing pad at the origin

// The ground is FLAT and analytic, and here that is a decision rather than a
// convenience: an aircraft's measurements must not depend on what happens to be
// underneath it, and a landing that bottoms the gear should be the gear's fault
// and not a slope's. The ground range earns its terrain because a hog drives on
// it; this one would only be adding a variable.
export function rangeHeight() { return 0; }

function makeLabel(text, color = '#7fd4ff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 40px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.renderOrder = 4;
  return s;
}

function buildGround(group) {
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x4b5666, roughness: 0.95, metalness: 0,
  })));
  const grid = new THREE.GridHelper(R * 2, R / 25, 0x3a5566, 0x232c38);
  grid.position.y = 0.03;
  grid.material.opacity = 0.3;
  grid.material.transparent = true;
  group.add(grid);

  // The landing pad. Marked because takeoff and touchdown are measured from it.
  const pad = new THREE.Mesh(
    new THREE.CircleGeometry(PAD, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2d3a4a, roughness: 0.9 }),
  );
  pad.position.y = 0.05;
  group.add(pad);
}

// ALTITUDE PYLONS. The one reference an open sky does not give you for free:
// without something of known height standing in it, 60 m and 200 m look
// identical and a climb rate is unreadable. Banded every 50 m.
function buildPylons(group) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.3 });
  const H = 300;
  for (const [x, z] of [[-200, 200], [200, 200], [-200, -200], [200, -200], [0, 400]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, H, 8), mat);
    post.position.set(x, H / 2, z);
    group.add(post);
    for (let y = 50; y <= H; y += 50) {
      const lab = makeLabel(`${y}m`);
      lab.scale.set(26, 6.5, 1);
      lab.position.set(x, y, z);
      group.add(lab);
    }
  }
  // Distance gates down +Z, so speed is legible off the world and not only the
  // panel. Same idea as the ground range's 25 m posts, at aircraft scale.
  for (let d = 200; d <= 800; d += 200) {
    const lab = makeLabel(`${d}m`, '#ffd66e');
    lab.scale.set(40, 10, 1);
    lab.position.set(0, 12, d);
    group.add(lab);
  }
}

// ---------------------------------------------------------------------------
// The tunable surface. Paths address CFG.vehicle.pelican; a `flight.` prefix
// reaches into the flight block. Grouped the way the config block is grouped,
// because the panel and the paste target should read the same.
//
// Edits land LIVE with no `retune()` for anything under `flight.` — the rig
// overlay hands `Vehicle` the very same object `CFG.vehicle.pelican.flight`
// points at, so `_flight` reads the new value on the next substep. Only the
// BODY fields need re-deriving, because spring rate is a function of mass.
// ---------------------------------------------------------------------------
const FIELDS = [
  ['ATTITUDE — turnRate IS the weight', [
    ['pitch rad/s', 'flight.turnRate[0]', 0.05],
    ['yaw rad/s', 'flight.turnRate[1]', 0.05],
    ['roll rad/s', 'flight.turnRate[2]', 0.05],
    ['pitch acc', 'flight.turnAccel[0]', 0.1],
    ['yaw acc', 'flight.turnAccel[1]', 0.1],
    ['roll acc', 'flight.turnAccel[2]', 0.1],
    ['kP', 'flight.kP', 0.1],
    ['kD', 'flight.kD', 0.1],
  ]],
  ['BANK', [
    ['per yaw', 'flight.bankPerYaw', 0.05],
    ['max rad', 'flight.bankMax', 0.05],
    ['manual', 'flight.bankManual', 0.05],
  ]],
  ['THRUST', [
    ['accel m/s2', 'flight.thrust', 0.5],
    ['reverse', 'flight.reverse', 0.05],
    ['top m/s', 'flight.topSpeed', 1],
  ]],
  ['LIFT', [
    ['hover x g', 'flight.hover', 0.02],
    ['collective', 'flight.collective', 0.5],
    ['blend 1/s', 'flight.hoverBlend', 0.1],
  ]],
  ['DRAG — the anisotropy is the wing', [
    ['long', 'flight.dragLong', 0.0002],
    ['lateral', 'flight.dragLat', 0.005],
    ['vertical', 'flight.dragVert', 0.005],
  ]],
  ['BODY & GEAR', [
    ['mass', 'mass', 250],
    ['com y', 'com[1]', 0.05],
    ['com z', 'com[2]', 0.05],
    ['ang damp', 'angularDamping', 0.05],
    ['travel', 'travel', 0.01],
    ['sag', 'sag', 0.01],
    ['damping', 'damping', 0.02],
    ['rebound', 'dampingRebound', 0.02],
  ]],
];

// `flight.turnRate[0]` / `com[1]` / `mass`
function resolve(root, path) {
  const dot = path.indexOf('.');
  const obj = dot < 0 ? root : root[path.slice(0, dot)];
  const rest = dot < 0 ? path : path.slice(dot + 1);
  const m = rest.match(/^(\w+)(?:\[(\d+)\])?$/);
  return { obj, key: m[1], idx: m[2] === undefined ? null : Number(m[2]) };
}
function readPath(root, path) {
  const { obj, key, idx } = resolve(root, path);
  return idx === null ? obj[key] : obj[key][idx];
}
function writePath(root, path, v) {
  const { obj, key, idx } = resolve(root, path);
  if (idx === null) obj[key] = v; else obj[key][idx] = v;
}

const f2 = (n) => (Math.round(n * 100) / 100).toString();
const f3 = (n) => (Math.round(n * 1000) / 1000).toString();
const f4 = (n) => (Math.round(n * 10000) / 10000).toString();

// The paste block. Only the parts this tab tunes, in config.js's own order and
// indentation, so it drops in as a replacement rather than needing a merge.
export function dumpFlight(T) {
  const F = T.flight;
  const L = [];
  L.push('      mass: ' + f2(T.mass) + ',');
  L.push(`      com: [${T.com.map(f3).join(', ')}],`);
  L.push('      angularDamping: ' + f2(T.angularDamping) + ',');
  L.push('      travel: ' + f3(T.travel) + ',');
  L.push('      sag: ' + f2(T.sag) + ',');
  L.push('      damping: ' + f2(T.damping) + ',');
  L.push('      dampingRebound: ' + f2(T.dampingRebound) + ',');
  L.push('');
  L.push('      flight: {');
  L.push(`        turnRate: [${F.turnRate.map(f2).join(', ')}],`);
  L.push(`        turnAccel: [${F.turnAccel.map(f2).join(', ')}],`);
  L.push('        kP: ' + f2(F.kP) + ',');
  L.push('        kD: ' + f2(F.kD) + ',');
  L.push('        bankPerYaw: ' + f2(F.bankPerYaw) + ',');
  L.push('        bankMax: ' + f2(F.bankMax) + ',');
  L.push('        bankManual: ' + f2(F.bankManual) + ',');
  L.push('');
  L.push('        thrust: ' + f2(F.thrust) + ',');
  L.push('        reverse: ' + f2(F.reverse) + ',');
  L.push('        topSpeed: ' + f2(F.topSpeed) + ',');
  L.push('');
  L.push('        hover: ' + f2(F.hover) + ',');
  L.push('        collective: ' + f2(F.collective) + ',');
  L.push('        hoverBlend: ' + f2(F.hoverBlend) + ',');
  L.push('');
  L.push('        dragLong: ' + f4(F.dragLong) + ',');
  L.push('        dragLat: ' + f4(F.dragLat) + ',');
  L.push('        dragVert: ' + f4(F.dragVert) + ',');
  L.push('');
  L.push('        ceiling: ' + f2(F.ceiling) + ',');
  L.push('        exitMaxHeight: ' + f2(F.exitMaxHeight) + ',');
  L.push('      },');
  return '// paste into CFG.vehicle.pelican in config.js\n' + L.join('\n');
}

const CAMS = ['CHASE', 'COCKPIT', 'SIDE', 'TOP'];

// The manoeuvre suite. Each one seeds a known state and then flies a script, so
// two tunings produce two comparable numbers. `wrap` is the shortest signed
// heading difference — a turn through the +/-PI seam otherwise reads as 350
// degrees of error and the completion test never fires.
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const MANOEUVRES = ['TAKEOFF', 'TOPSPEED', 'TURN90', 'TURN180', 'HOVER', 'STOP'];

export function createAirRange(assets) {
  const group = new THREE.Group();
  group.visible = false;
  buildGround(group);
  buildPylons(group);

  const world = {
    heightAt: rangeHeight,
    collision: null,
    coverBoxes: [],
    clampToMap: (v) => {
      v.x = Math.max(-R + 20, Math.min(R - 20, v.x));
      v.z = Math.max(-R + 20, Math.min(R - 20, v.z));
    },
  };

  const template = assets.vehicles && assets.vehicles.pelican;
  let pel = null;
  if (template) {
    pel = new Vehicle('pelican', template.clone(true), null, world);
    group.add(pel.group);
    pel.settleAt(0, 0, 0);
  }

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.2, 6000);
  let camMode = 0;
  const camPos = new THREE.Vector3(0, 20, -60);

  // Free-flight look. Arrow keys rather than the mouse: a tuning tab is a
  // keyboard-and-number-field place, and pointer lock here would fight the
  // panel. The MOUSE version is the game — this exists so a change can be felt
  // between two scripted runs, not so the model can be flown properly.
  let cmdYaw = 0, cmdPitch = 0;
  const _dir = new THREE.Vector3();

  const keys = {};
  let active = false;
  let accum = 0;
  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  const onKeyDown = (e) => {
    if (!active || typing(e)) return;
    keys[e.code] = true;
    if (e.code === 'KeyR') reset();
    if (e.code === 'KeyC') camMode = (camMode + 1) % CAMS.length;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  };
  const onKeyUp = (e) => { keys[e.code] = false; };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Last result per manoeuvre, kept so the panel shows the whole suite at once
  // and a change can be read across all of it rather than one run at a time.
  const results = {};
  let run = null;

  function reset() {
    if (!pel) return;
    accum = 0;
    run = null;
    pel.settleAt(0, 0, 0);
    pel.enginesOn = false;
    pel.hoverBlend = 0;
    pel.flightCmd.throttle = 0;
    pel.flightCmd.collective = 0;
    pel.flightCmd.roll = 0;
    cmdYaw = 0; cmdPitch = 0;
    pel.flightCmd.dir.set(0, 0, 1);
  }

  // Place the aircraft in a known cruise. THIS is the flat centre lane: every
  // measured number below starts here, so two tunings are compared from the
  // same state rather than from wherever the last run happened to end.
  function seed(speed, alt, z0 = 0) {
    pel.quat.identity();
    pel.pos.set(0, alt + pel.com.y, z0);
    pel.vel.set(0, 0, speed);
    pel.angVel.set(0, 0, 0);
    pel.hoverBlend = 1;
    pel.enginesOn = true;
    pel.flightCmd.dir.set(0, 0, 1);
    pel.flightCmd.throttle = 0;
    pel.flightCmd.collective = 0;
    pel.flightCmd.roll = 0;
    cmdYaw = 0; cmdPitch = 0;
    pel.wake();
    pel.syncVisuals();
  }

  const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _l = new THREE.Vector3();
  const state = () => {
    _f.set(0, 0, 1).applyQuaternion(pel.quat);
    _u.set(0, 1, 0).applyQuaternion(pel.quat);
    _l.set(1, 0, 0).applyQuaternion(pel.quat);
    const speed = pel.vel.length();
    return {
      speed,
      fwd: pel.vel.dot(_f),
      lat: pel.vel.dot(_l),
      hdg: Math.atan2(_f.x, _f.z),
      velHdg: speed > 1 ? Math.atan2(pel.vel.x, pel.vel.z) : Math.atan2(_f.x, _f.z),
      bank: Math.atan2(_l.y, _u.y),
      pitch: Math.asin(Math.max(-1, Math.min(1, _f.y))),
      alt: pel.group.position.y,
    };
  };

  function start(name) {
    if (!pel) return;
    const cruise = CFG.vehicle.pelican.flight.topSpeed * 0.85;
    const m = { name, t: 0, peak: {}, done: false, note: '' };
    if (name === 'TAKEOFF') {
      pel.settleAt(0, 0, 0);
      pel.enginesOn = true; pel.hoverBlend = 0;
      pel.flightCmd.dir.set(0, 0, 1);
      cmdYaw = 0; cmdPitch = 0;
      m.reach = null;
    } else if (name === 'TOPSPEED') {
      // Started at the far edge, heading up the range. A straight-line run at
      // 60 m/s eats 900 m in fifteen seconds, and `clampToMap` does not fail
      // loudly — it just stops the aircraft moving, which reads as the drag
      // being higher than it is. The measurement has to FIT IN THE RANGE, the
      // same way the ground range's centre lane is flat for its whole length.
      seed(0, 200, -RUNWAY);
    } else if (name === 'TURN90' || name === 'TURN180') {
      seed(cruise, 250);
      m.demand = (name === 'TURN90' ? 90 : 180) * Math.PI / 180;
      m.settleIn = 1.0;          // let the seeded state stabilise before demanding
      m.entrySpeed = cruise;
      m.pathX = 0; m.pathZ = 0;
    } else if (name === 'HOVER') {
      seed(0, 150);
      m.alt0 = pel.group.position.y;
    } else if (name === 'STOP') {
      seed(cruise, 250, -RUNWAY);
      m.x0 = pel.pos.x; m.z0 = pel.pos.z;
      m.entry = cruise;
    }
    run = m;
  }

  // One script step. Returns once the manoeuvre has finished; everything it
  // measures is a peak or a time, because those are the quantities a pilot
  // cannot read off the screen while flying.
  function stepRun(dt) {
    const m = run;
    const s = state();
    const c = pel.flightCmd;
    m.t += dt;
    const P = m.peak;
    const bump = (k, v) => { P[k] = P[k] === undefined ? v : Math.max(P[k], v); };

    if (m.name === 'TAKEOFF') {
      c.collective = 1; c.throttle = 0;
      bump('climb', pel.vel.y);
      if (m.reach === null && s.alt >= 20) m.reach = m.t;
      if (s.alt >= 30 || m.t > 20) {
        m.done = true;
        m.note = `to 20 m ${m.reach === null ? 'NEVER' : `${m.reach.toFixed(2)} s`}`
          + `   peak climb ${(P.climb || 0).toFixed(1)} m/s`;
      }
    } else if (m.name === 'TOPSPEED') {
      c.throttle = 1; c.collective = 0;
      if (m.last === undefined) m.last = 0;
      bump('speed', s.speed);
      if (m.t40 === undefined && s.speed >= 40) m.t40 = m.t;
      const gain = (s.speed - m.last) / dt;
      m.last = s.speed;
      if ((m.t > 4 && gain < 0.05) || m.t > 60) {
        m.done = true;
        m.note = `top ${P.speed.toFixed(1)} m/s (${(P.speed * 3.6).toFixed(0)} km/h)`
          + `   0-40 ${m.t40 === undefined ? '--' : `${m.t40.toFixed(1)} s`}`
          + `   cfg topSpeed ${CFG.vehicle.pelican.flight.topSpeed}`;
      }
    } else if (m.name === 'TURN90' || m.name === 'TURN180') {
      c.throttle = 1; c.collective = 0;
      if (m.t < m.settleIn) {
        m.hdg0 = s.hdg;
      } else {
        if (!m.demanded) {
          m.demanded = true;
          m.target = wrap(m.hdg0 + m.demand);
          m.tStart = m.t;
        }
        cmdYaw = m.target;
        // Drift is THE signature number: how far the velocity lags the nose.
        // If it is near zero the model is writing velocity from the look, which
        // is the failure mode this whole design exists to avoid.
        bump('drift', Math.abs(wrap(s.hdg - s.velHdg)));
        bump('lat', Math.abs(s.lat));
        bump('bank', Math.abs(s.bank));
        bump('yawRate', Math.abs(pel.angVel.y));
        m.minSpeed = m.minSpeed === undefined ? s.speed : Math.min(m.minSpeed, s.speed);
        const err = Math.abs(wrap(s.hdg - m.target));
        if (err < 0.035 && Math.abs(pel.angVel.y) < 0.06) {
          m.hold = (m.hold || 0) + dt;
        } else m.hold = 0;
        if (m.hold > 0.4 || m.t - m.tStart > 25) {
          m.done = true;
          const T = m.t - m.tStart - (m.hold || 0);
          // Radius from the sustained rate: v / omega is the instantaneous turn
          // radius, and the peak is the tightest the airframe actually managed.
          const rad = P.yawRate > 0.01 ? m.entrySpeed / P.yawRate : 0;
          m.note = `${(m.demand * 57.3).toFixed(0)}deg in ${T.toFixed(2)} s`
            + `   drift ${(P.drift * 57.3).toFixed(1)}deg   slide ${P.lat.toFixed(1)} m/s`
            + `\n         bank ${(P.bank * 57.3).toFixed(0)}deg   radius ${rad.toFixed(0)} m`
            + `   speed ${m.entrySpeed.toFixed(0)}->${m.minSpeed.toFixed(0)} m/s`;
        }
      }
    } else if (m.name === 'HOVER') {
      c.throttle = 0; c.collective = 0;
      if (m.t > 10) {
        m.done = true;
        const drift = pel.group.position.y - m.alt0;
        m.note = `altitude drift ${drift >= 0 ? '+' : ''}${drift.toFixed(2)} m over 10 s`
          + `   (${Math.abs(drift) < 1 ? 'holds' : 'DOES NOT HOLD'})`;
      }
    } else if (m.name === 'STOP') {
      c.throttle = 0; c.collective = 0;
      const d = Math.hypot(pel.pos.x - m.x0, pel.pos.z - m.z0);
      // Half-speed is the figure that always completes, and it is the honest
      // one to lead with: longitudinal drag is deliberately low, so a Pelican
      // coasting from cruise takes a very long time to actually stop.
      if (m.tHalf === undefined && s.speed <= m.entry * 0.5) { m.tHalf = m.t; m.dHalf = d; }
      const timedOut = m.t > 45;
      if (s.speed < 5 || timedOut) {
        m.done = true;
        const half = m.tHalf === undefined ? '--'
          : `${m.tHalf.toFixed(1)} s / ${m.dHalf.toFixed(0)} m`;
        // A cap that is reported as a result is worse than no measurement,
        // because it reads as one. Say so.
        m.note = `to half speed ${half}`
          + (timedOut
            ? `   still ${s.speed.toFixed(1)} m/s after ${m.t.toFixed(0)} s / ${d.toFixed(0)} m — DID NOT STOP`
            : `   to 5 m/s ${m.t.toFixed(1)} s / ${d.toFixed(0)} m`);
      }
    }

    // The look command, rebuilt every step from the script's heading.
    const cp = Math.cos(cmdPitch);
    c.dir.set(cp * Math.sin(cmdYaw), Math.sin(cmdPitch), cp * Math.cos(cmdYaw));

    if (m.done) {
      results[m.name] = m.note;
      run = null;
    }
  }

  function freeFlight(dt) {
    const rate = 1.3 * dt;
    if (keys['ArrowLeft']) cmdYaw -= rate;
    if (keys['ArrowRight']) cmdYaw += rate;
    if (keys['ArrowUp']) cmdPitch = Math.min(1.4, cmdPitch + rate);
    if (keys['ArrowDown']) cmdPitch = Math.max(-1.4, cmdPitch - rate);
    const c = pel.flightCmd;
    c.throttle = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    c.collective = (keys['Space'] ? 1 : 0) - (keys['ShiftLeft'] ? 1 : 0);
    c.roll = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
    if (c.throttle || c.collective || c.roll) { pel.enginesOn = true; pel.wake(); }
    const cp = Math.cos(cmdPitch);
    c.dir.set(cp * Math.sin(cmdYaw), Math.sin(cmdPitch), cp * Math.cos(cmdYaw));
  }

  const _want = new THREE.Vector3(), _flatF = new THREE.Vector3(), _flatL = new THREE.Vector3();
  const _level = new THREE.Quaternion(), _roll = new THREE.Quaternion();
  const _YA = new THREE.Vector3(0, 1, 0), _ZA = new THREE.Vector3(0, 0, 1);

  function updateCamera(dt) {
    const g = pel.group.position;
    _f.set(0, 0, 1).applyQuaternion(pel.quat);
    _l.set(1, 0, 0).applyQuaternion(pel.quat);
    _u.set(0, 1, 0).applyQuaternion(pel.quat);
    _flatF.set(_f.x, 0, _f.z);
    if (_flatF.lengthSq() < 1e-6) _flatF.set(0, 0, 1); else _flatF.normalize();
    _flatL.set(_l.x, 0, _l.z);
    if (_flatL.lengthSq() < 1e-6) _flatL.set(1, 0, 0); else _flatL.normalize();
    const mode = CAMS[camMode];

    if (mode === 'COCKPIT') {
      pel.group.updateMatrixWorld(true);
      const eye = pel.refWorld('ref_camera_pilot', _want);
      camera.position.copy(eye || g);
      // Same rule the game's cockpit uses: the view looks where the PILOT is
      // looking and inherits the hull's ROLL only. Duplicating the whole
      // expression would be a second source of truth for the one thing the
      // first-person bug turned on.
      _level.setFromAxisAngle(_YA, Math.PI + cmdYaw);
      _level.multiply(_roll.setFromAxisAngle(new THREE.Vector3(1, 0, 0), cmdPitch));
      _level.multiply(_roll.setFromAxisAngle(_ZA, -Math.atan2(_l.y, _u.y)));
      camera.quaternion.copy(_level);
      return;
    }
    if (mode === 'TOP') {
      // Straight down. This is the turn view — drift and radius are only
      // legible from above, and they are the numbers this tab exists for.
      _want.set(g.x, g.y + 190, g.z + 0.01);
      camPos.lerp(_want, Math.min(1, dt * 4));
      camera.position.copy(camPos);
      camera.lookAt(g.x, g.y, g.z);
      return;
    }
    if (mode === 'SIDE') {
      _want.set(g.x - _flatL.x * 70, g.y + 8, g.z - _flatL.z * 70);
    } else {
      _want.set(g.x - _flatF.x * 60, g.y + 18, g.z - _flatF.z * 60);
    }
    if (_want.y < 6) _want.y = 6;
    camPos.lerp(_want, Math.min(1, dt * 4));
    camera.position.copy(camPos);
    camera.lookAt(g.x, g.y + 2, g.z);
  }

  function update(dt) {
    if (!pel) return;
    if (run) stepRun(dt); else freeFlight(dt);

    // Fixed substep with the leftover carried between frames — the same pump
    // VehicleManager runs, and for the same reason: at 144 Hz a frame is
    // shorter than one substep, and a local accumulator would never step at all.
    const h = CFG.vehicle.substep;
    accum = Math.min(accum + dt, h * CFG.vehicle.maxSubsteps);
    let steps = 0;
    while (accum >= h && steps < CFG.vehicle.maxSubsteps) {
      pel.step(h);
      accum -= h;
      steps++;
    }
    pel.syncVisuals();
    updateCamera(dt);
  }

  function telemetry() {
    if (!pel) return 'no pelican loaded — check ASSET_PATHS.vehicles.pelican';
    const s = state();
    const inv = pel.quat.clone().invert();
    const rate = pel.angVel.clone().applyQuaternion(inv);
    const drift = s.speed > 1 ? wrap(s.hdg - s.velHdg) * 57.3 : 0;
    // Load factor: the lateral acceleration a turn is pulling, in g. The number
    // a pilot would feel, and the one that says whether a turn is violent.
    const latG = (s.speed * pel.angVel.y) / CFG.gravity;
    const grounded = pel.wheels.filter((w) => w.grounded).length;
    const F = CFG.vehicle.pelican.flight;
    return [
      `speed    ${s.speed.toFixed(1)} m/s  ${(s.speed * 3.6).toFixed(0)} km/h`
        + `   fwd ${s.fwd.toFixed(1)}  slide ${s.lat.toFixed(1)}`,
      `attitude bank ${(s.bank * 57.3).toFixed(1)}deg  pitch ${(s.pitch * 57.3).toFixed(1)}deg`
        + `   alt ${s.alt.toFixed(0)} m`,
      `DRIFT    ${drift.toFixed(1)}deg  (velocity vs nose)   lat ${latG.toFixed(2)} g`,
      `rates    pitch ${rate.x.toFixed(2)}  yaw ${rate.y.toFixed(2)}  roll ${rate.z.toFixed(2)} rad/s`,
      `          limits ${F.turnRate.map((v) => v.toFixed(2)).join(' / ')}`,
      `engines  ${pel.enginesOn ? 'ON' : 'off'}   authority ${pel.hoverBlend.toFixed(2)}`
        + `   ${grounded ? `${grounded} STRUT${grounded > 1 ? 'S' : ''} DOWN` : 'airborne'}`,
      run ? `RUNNING  ${run.name}   t ${run.t.toFixed(1)} s` : '',
      '',
      ...MANOEUVRES.map((k) => `${k.padEnd(9)}${results[k] || '--'}`),
    ].filter((l) => l !== '').join('\n');
  }

  function buildInputs(container, onChange) {
    const T = CFG.vehicle.pelican;
    container.innerHTML = '';
    for (const [title, fields] of FIELDS) {
      const fs = document.createElement('fieldset');
      fs.innerHTML = `<legend>${title}</legend>`;
      for (const [label, path, step] of fields) {
        const row = document.createElement('div');
        row.className = 'row';
        const lab = document.createElement('label');
        lab.textContent = label;
        lab.style.width = '78px';
        const input = document.createElement('input');
        input.type = 'number';
        input.step = step;
        input.value = readPath(T, path);
        input.oninput = () => {
          const v = Number(input.value);
          if (!Number.isFinite(v)) return;
          writePath(T, path, v);
          // Only the BODY fields need re-deriving — spring rate is a function
          // of mass, travel and sag. Everything under `flight.` is read live.
          if (!path.startsWith('flight.') && pel) pel.retune();
          onChange();
        };
        row.appendChild(lab);
        row.appendChild(input);
        fs.appendChild(row);
      }
      container.appendChild(fs);
    }
  }

  return {
    group,
    camera,
    get vehicle() { return pel; },
    get camName() { return CAMS[camMode]; },
    get running() { return run ? run.name : null; },
    start,
    // Run the whole suite back to back, so one click re-measures everything
    // after a change instead of six.
    startAll() {
      if (!pel) return;
      let i = 0;
      const next = () => {
        if (i >= MANOEUVRES.length) return;
        start(MANOEUVRES[i++]);
        const watch = setInterval(() => {
          if (!run) { clearInterval(watch); next(); }
        }, 30);
      };
      next();
    },
    setActive(on) {
      active = on;
      group.visible = on;
      for (const k of Object.keys(keys)) keys[k] = false;
      if (on) reset();
    },
    update,
    telemetry,
    buildInputs,
    dump: () => dumpFlight(CFG.vehicle.pelican),
    reset,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
