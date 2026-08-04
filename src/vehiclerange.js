// The vehicle proving ground — the VEHICLE tab of /chartest.html.
//
// Phase 3 of VEHICLE_PLAN.md, and it is its own phase rather than polish folded
// into Phase 2 because it is the tool that FINISHES Phase 2. Every number in
// `CFG.vehicle.warthog` was chosen to be roughly right; this is where they are
// made right, by driving, the same way BACK and GRIP are tuned by looking.
//
// Two things make it a tuning instrument rather than a sandbox:
//
// 1. THE GROUND IS ANALYTIC. `rangeHeight` is a function, the mesh is displaced
//    from that same function, and the vehicle's ground query calls it directly.
//    What you see is exactly what you drive on, to the millimetre — no bake, no
//    heightfield resolution, no disagreement between the render and the physics.
//    map-3 cannot give that: its flattest authored ground still steps 0.73 m
//    over 4 m, which is terrain to test ON and useless to tune AGAINST.
//
// 2. IT REPORTS NUMBERS. Lateral g, body lean, per-corner load and slip, 0-20
//    time and braking distance. Suspension is not tunable by vibes: "feels
//    floaty" is a roll angle and a damper ratio, and you cannot see either
//    without being told.
//
// The range owns its own world object. `Vehicle` takes one in its constructor
// and only ever asks it for `heightAt`, `collision`, `coverBoxes` and
// `clampToMap` — that narrow surface is exactly why the physics can be lifted
// out of the match and dropped onto a test rig without a Game existing.

import * as THREE from 'three';
import { CFG } from './config.js';
import { Vehicle } from './vehicle.js';
import { VehicleDriver } from './vehicledriver.js';

const R = 220;              // half-extent of the proving ground, metres
const MESH_STEP = 1.25;     // ground tessellation

const smooth = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

// Angles of the constant-gradient test ramps, in degrees.
export const GRADES = [15, 25, 35, 45];

// ---------------------------------------------------------------------------
// The ground, as a function. Features are placed apart so each can be driven at
// on its own, and every one of them answers a specific tuning question.
// ---------------------------------------------------------------------------
export function rangeHeight(x, z) {
  let h = 0;

  // JUMP — 16 m of ramp to a hard lip. Answers: does it land on the suspension
  // or on its face, and does the bump stop hold? The lip is deliberately sharp
  // in Z (that is the launch) and blended in X so the edges are drivable.
  //
  // Off to one side, NOT down the middle. It started on the centre lane and
  // every acceleration run launched off it at 90 m, so the 0-20 time and the
  // braking distance were being measured through a jump. THE CENTRE LANE
  // (x = 0) IS FLAT FOR THE WHOLE LENGTH OF THE RANGE and every feature below
  // is placed to keep it that way — that is what makes the measurements mean
  // anything.
  const rz = z - 90, rx = Math.abs(x + 22);
  if (rz > -16 && rz < 0.6 && rx < 9) {
    h = Math.max(h, 3.0 * smooth((rz + 16) / 16) * smooth((9 - rx) / 3));
  }

  // WASHBOARD — 60 m of 0.16 m corrugations at 3.5 m pitch. Answers: is the
  // damping right, or does the body pogo and the wheels leave the ground?
  if (x > -78 && x < -42 && z > 20 && z < 110) {
    h += 0.16 * Math.sin(z * (Math.PI * 2 / 3.5))
      * smooth((78 - Math.abs(x + 60) * 2) / 12) * smooth((110 - z) / 10) * smooth((z - 20) / 10);
  }

  // CAMBER DOME — a 40 m hill. Traverse it across the fall line and the answer
  // is the roll question: how much lean, and how close to letting go.
  const d = Math.hypot(x - 70, z - 75);
  if (d < 40) h += 6 * (0.5 + 0.5 * Math.cos(Math.PI * d / 40));

  // STEP — a 0.35 m kerb, square on. Answers: does the hull climb it (wrong) or
  // stop against it (right), and does a wheel find the top cleanly?
  if (x > 30 && x < 55 && z > -60 && z < -40) h += 0.35;

  // BOWL — a shallow dish for doughnuts and for watching the tyre budget run
  // out with a constant steering input.
  const bd = Math.hypot(x + 70, z + 70);
  if (bd < 45) h -= 2.2 * (0.5 + 0.5 * Math.cos(Math.PI * bd / 45));

  // GRADE — four constant-gradient ramps at known angles. There is no
  // max-climb SETTING anywhere in this project: hill climb is emergent from
  // drive force, the torque curve, grip and mass, so the only way to know the
  // number is to drive at a slope you already know the angle of. Well clear of
  // the centre lane and of the camber dome, which reaches x = 110.
  for (let i = 0; i < GRADES.length; i++) {
    const cx = 130 + i * 22;
    const dx = Math.abs(x - cx);
    if (dx < 8 && z > 20) {
      // Capped by HEIGHT, not by length, so a steeper ramp is a shorter one —
      // 22 m of climb is more than enough to show whether the hog pulls through
      // or stalls, and a 45 degree ramp run to full length would be a wall.
      const rise = Math.min((z - 20) * Math.tan(GRADES[i] * Math.PI / 180), 22);
      h = Math.max(h, rise * smooth((8 - dx) / 2.5));
    }
  }

  return h;
}

// ---------------------------------------------------------------------------

function buildGround() {
  const seg = Math.round((R * 2) / MESH_STEP);
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  // Height-tinted, so a feature is legible from across the range without having
  // to drive to it. The flat is deliberately mid-grey rather than dark: this
  // page's lighting is set up for a 7 m character line-up, and a 440 m plane
  // under it goes muddy without the help.
  const cFlat = new THREE.Color(0x5b6675);
  const cHigh = new THREE.Color(0x8a9668);
  const cLow = new THREE.Color(0x3d4657);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = rangeHeight(x, z);
    pos.setY(i, h);
    tmp.copy(cFlat).lerp(h >= 0 ? cHigh : cLow, Math.min(1, Math.abs(h) / 3));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, metalness: 0,
  }));
}

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

// Distance gates down the straight, so speed and braking distance are readable
// off the world instead of only off the panel.
function buildMarkers(group) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.35 });
  // Gates sit to the +X side: the jump lane is at -22 and the posts would be
  // standing on its ramp.
  for (let d = 25; d <= 200; d += 25) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 3, 0.25), mat);
    post.position.set(14, rangeHeight(14, d) + 1.5, d);
    group.add(post);
    const lab = makeLabel(`${d}m`);
    lab.scale.set(6, 1.5, 1);
    lab.position.set(14, rangeHeight(14, d) + 4, d);
    group.add(lab);
  }
  for (let i = 0; i < GRADES.length; i++) {
    const cx = 130 + i * 22;
    const lab = makeLabel(`${GRADES[i]} deg`, '#ff9a5a');
    lab.scale.set(14, 3.5, 1);
    lab.position.set(cx, rangeHeight(cx, 26) + 4, 26);
    group.add(lab);
  }
  for (const [x, z, text] of [
    [-22, 72, 'JUMP'], [-60, 65, 'WASHBOARD'], [70, 75, 'CAMBER'],
    [42, -50, 'STEP'], [-70, -70, 'BOWL'], [174, 14, 'GRADE'],
  ]) {
    const lab = makeLabel(text, '#ffd66e');
    lab.scale.set(18, 4.5, 1);
    lab.position.set(x, rangeHeight(x, z) + 7, z);
    group.add(lab);
  }
}

// Slalom cones. Visual only and deliberately so — they mark a line to steer
// through, and making them solid would turn a steering test into a collision
// test with a different answer.
function buildSlalom(group) {
  const geo = new THREE.ConeGeometry(0.35, 1.1, 10);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff7a3d, roughness: 0.8 });
  const mesh = new THREE.InstancedMesh(geo, mat, 10);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 10; i++) {
    const z = 20 + i * 14;
    const x = (i % 2 === 0 ? 1 : -1) * 5;
    m.makeTranslation(x, rangeHeight(x, z) + 0.55, z);
    mesh.setMatrixAt(i, m);
  }
  group.add(mesh);
}

// ---------------------------------------------------------------------------
// The tunable surface. `path` addresses CFG.vehicle.warthog; an entry with a
// bracket index reaches into an array field. Grouped the way the config block
// is grouped, because the panel and the paste target should read the same.
// ---------------------------------------------------------------------------
const FIELDS = [
  ['BODY', [
    ['mass', 'mass', 25],
    ['com y', 'com[1]', 0.02],
    ['com z', 'com[2]', 0.02],
    ['yaw inertia', 'inertiaScale[1]', 0.05],
  ]],
  ['SUSPENSION', [
    ['travel', 'travel', 0.01],
    ['sag', 'sag', 0.01],
    ['damping', 'damping', 0.02],
    ['rebound', 'dampingRebound', 0.02],
    ['anti-roll', 'antiRoll', 0.02],
    ['bump stop', 'bumpStop', 0.5],
  ]],
  ['DRIVE', [
    ['drive N', 'driveForce', 500],
    ['top m/s', 'topSpeed', 0.5],
    ['brake N', 'brakeForce', 1000],
    ['h-brake N', 'handbrakeForce', 1000],
    ['reverse', 'reverseMult', 0.05],
    ['roll res', 'rollResist', 0.002],
    ['air drag', 'airDrag', 0.5],
  ]],
  ['STEERING', [
    ['lock rad', 'steerMax', 0.02],
    ['fast rad', 'steerMaxFast', 0.01],
    ['rate', 'steerRate', 0.2],
    ['return', 'steerReturn', 0.2],
  ]],
  ['TYRES', [
    ['grip F', 'grip', 0.05],
    ['grip R', 'gripRear', 0.05],
    ['stiffness', 'cornerStiffness', 0.25],
    ['h-brake mu', 'handbrakeGrip', 0.02],
  ]],
];

function readPath(obj, path) {
  const m = path.match(/^(\w+)(?:\[(\d+)\])?$/);
  return m[2] === undefined ? obj[m[1]] : obj[m[1]][Number(m[2])];
}
function writePath(obj, path, v) {
  const m = path.match(/^(\w+)(?:\[(\d+)\])?$/);
  if (m[2] === undefined) obj[m[1]] = v; else obj[m[1]][Number(m[2])] = v;
}

const f2 = (n) => (Math.round(n * 100) / 100).toString();
const f3 = (n) => (Math.round(n * 1000) / 1000).toString();

// The paste block. Field order and comments deliberately mirror config.js so
// the result drops in as a replacement rather than needing to be merged.
export function dumpTune(T) {
  const L = [];
  L.push('    warthog: {');
  L.push(`      mass: ${f2(T.mass)},`);
  L.push(`      com: [${T.com.map(f3).join(', ')}],`);
  L.push(`      inertiaBox: [${T.inertiaBox.map(f2).join(', ')}],`);
  L.push(`      inertiaScale: [${T.inertiaScale.map(f2).join(', ')}],`);
  L.push('');
  L.push(`      wheelRadius: ${f3(T.wheelRadius)},`);
  L.push('');
  L.push(`      travel: ${f3(T.travel)},`);
  L.push(`      sag: ${f2(T.sag)},`);
  L.push(`      damping: ${f2(T.damping)},`);
  L.push(`      dampingRebound: ${f2(T.dampingRebound)},`);
  L.push(`      antiRoll: ${f2(T.antiRoll)},`);
  L.push(`      bumpStop: ${f2(T.bumpStop)},`);
  L.push('');
  L.push(`      driveForce: ${f2(T.driveForce)},`);
  L.push(`      topSpeed: ${f2(T.topSpeed)},`);
  L.push(`      reverseMult: ${f2(T.reverseMult)},`);
  L.push(`      brakeForce: ${f2(T.brakeForce)},`);
  L.push(`      handbrakeForce: ${f2(T.handbrakeForce)},`);
  L.push(`      rollResist: ${f3(T.rollResist)},`);
  L.push(`      airDrag: ${f2(T.airDrag)},`);
  L.push('');
  L.push(`      steerMax: ${f2(T.steerMax)},`);
  L.push(`      steerMaxFast: ${f2(T.steerMaxFast)},`);
  L.push(`      steerRate: ${f2(T.steerRate)},`);
  L.push(`      steerReturn: ${f2(T.steerReturn)},`);
  L.push('');
  L.push(`      grip: ${f2(T.grip)},`);
  L.push(`      gripRear: ${f2(T.gripRear)},`);
  L.push(`      cornerStiffness: ${f2(T.cornerStiffness)},`);
  L.push(`      handbrakeGrip: ${f2(T.handbrakeGrip)},`);
  L.push('');
  L.push(`      hullSkin: ${f2(T.hullSkin)},`);
  L.push(`      restitution: ${f2(T.restitution)},`);
  L.push(`      angularDamping: ${f2(T.angularDamping)},`);
  L.push('');
  L.push(`      sleepSpeed: ${f2(T.sleepSpeed)},`);
  L.push(`      sleepSpin: ${f2(T.sleepSpin)},`);
  L.push(`      sleepDelay: ${f2(T.sleepDelay)},`);
  L.push('    },');
  return `// paste over CFG.vehicle.warthog in config.js\n${L.join('\n')}`;
}

const CAMS = ['CHASE', 'DRIVER', 'SIDE', 'FRONT'];

export function createVehicleRange(assets) {
  const group = new THREE.Group();
  group.visible = false;

  group.add(buildGround());
  const grid = new THREE.GridHelper(R * 2, R / 5, 0x3a5566, 0x232c38);
  grid.position.y = 0.02;
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  group.add(grid);
  buildMarkers(group);
  buildSlalom(group);

  // The world the physics talks to. Four members, which is the entire surface
  // `Vehicle` needs — and the reason it can be tested without a Game.
  const world = {
    heightAt: rangeHeight,
    collision: null,
    coverBoxes: [],
    clampToMap: (v) => {
      v.x = Math.max(-R + 5, Math.min(R - 5, v.x));
      v.z = Math.max(-R + 5, Math.min(R - 5, v.z));
    },
  };

  // AUTOPILOT. A closed circuit rather than a straight line, because the only
  // interesting questions about a driver are the corners: does the governor
  // slow for them, does it overshoot the apex, does it recover.
  //
  // Every leg is placed to MISS the range's features. The jump occupies
  // x -31..-13 and the camber dome reaches x = 30 at z = 75, so the two long
  // legs run at x = +20 and x = -5 — the driver is being measured here, and a
  // lap that launches off the jump measures the suspension instead.
  //
  // Declared ABOVE the hog, because the hog's constructor block builds the
  // driver and `let` in the dead zone is not a hoisted `var`.
  const COURSE = [
    new THREE.Vector3(20, 0, -140),
    new THREE.Vector3(20, 0, 140),
    new THREE.Vector3(-5, 0, 140),
    new THREE.Vector3(-5, 0, -140),
  ];
  let autopilot = false;
  let driver = null;
  let wpIdx = 0;
  let laps = 0;
  const waypoint = COURSE[0].clone();
  function nextWaypoint() {
    wpIdx = (wpIdx + 1) % COURSE.length;
    if (wpIdx === 0) laps++;
    waypoint.copy(COURSE[wpIdx]);
  }

  const template = assets.vehicles && assets.vehicles.warthog;
  let hog = null;
  if (template) {
    hog = new Vehicle('warthog', template.clone(true), null, world);
    group.add(hog.group);
    hog.settleAt(0, 0, 0);
    driver = new VehicleDriver(hog);
  }

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000);
  let camMode = 0;
  const camPos = new THREE.Vector3(0, 6, -14);

  const keys = {};
  let active = false;
  let accum = 0;          // physics time carried between frames — see update()
  // A number field has focus for most of a tuning session, and WASDRC are all
  // real keystrokes there. Without this, nudging a value with the keyboard
  // drives the hog off the range.
  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  const onKeyDown = (e) => {
    if (!active || typing(e)) return;
    keys[e.code] = true;
    if (e.code === 'KeyR') reset();
    if (e.code === 'KeyC') camMode = (camMode + 1) % CAMS.length;
    if (e.code === 'Space') e.preventDefault();
  };
  const onKeyUp = (e) => { keys[e.code] = false; };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // Measurements. Both are the numbers you actually argue about when tuning a
  // car, and both are impossible to eyeball: a stopwatch on 0-20 and a tape on
  // the braking distance.
  const perf = { accelT: null, brakeD: null, _t0: null, _bx: null, _bz: null, top: 0 };

  function reset() {
    if (!hog) return;
    accum = 0;            // no stale time carried into a fresh run
    hog.settleAt(0, 0, 0);   // on its springs, not dropped onto them
    hog.steerAngle = 0;
    for (const w of hog.wheels) { w.spin = 0; w.slip = 0; }
    perf.accelT = null; perf.brakeD = null; perf._t0 = null; perf._bx = null; perf.top = 0;
  }

  const _up = new THREE.Vector3(), _left = new THREE.Vector3(), _fwd = new THREE.Vector3();
  const _flatF = new THREE.Vector3(), _flatL = new THREE.Vector3();
  const _want = new THREE.Vector3(), _tmp = new THREE.Vector3();
  const _level = new THREE.Quaternion(), _full = new THREE.Quaternion();
  const _YA = new THREE.Vector3(0, 1, 0);
  const _PI_Y = new THREE.Quaternion().setFromAxisAngle(_YA, Math.PI);

  function updateCamera(dt) {
    const g = hog.group.position;
    _fwd.set(0, 0, 1).applyQuaternion(hog.quat);
    _left.set(1, 0, 0).applyQuaternion(hog.quat);
    // Flattened onto the horizontal plane. Every camera below is placed from
    // these, so none of them inherits the chassis's pitch or roll as POSITION —
    // an 11 m boom turns a few degrees of attitude into metres of swing.
    _flatF.set(_fwd.x, 0, _fwd.z).normalize();
    _flatL.set(_left.x, 0, _left.z).normalize();
    const mode = CAMS[camMode];

    if (mode === 'DRIVER') {
      hog.group.updateMatrixWorld(true);
      const eye = hog.refWorld('ref_camera_driver', _tmp);
      camera.position.copy(eye || g);
      // Horizon-locked base, blended toward the chassis by tiltFP. The eye is
      // at the pivot here, so attitude costs nothing in stability.
      _level.setFromAxisAngle(_YA, Math.PI + Math.atan2(_flatF.x, _flatF.z));
      _full.copy(hog.quat).multiply(_PI_Y);   // three looks down -Z; chassis is +Z
      camera.quaternion.copy(_level).slerp(_full, CFG.vehicle.camera.tiltFP);
      return;
    }
    if (mode === 'SIDE') {
      // Locked square to the vehicle's side and level. This is the suspension
      // view: lean and per-corner travel are only legible from side-on, and
      // they are only legible at all if the camera itself is not leaning.
      _want.set(g.x - _flatL.x * 11, g.y + 2.2, g.z - _flatL.z * 11);
    } else if (mode === 'FRONT') {
      _want.set(g.x + _flatF.x * 12, g.y + 2.6, g.z + _flatF.z * 12);
    } else {
      _want.set(g.x - _flatF.x * 13, g.y + 5.5, g.z - _flatF.z * 13);
    }
    const floor = rangeHeight(_want.x, _want.z) + 1.2;
    if (_want.y < floor) _want.y = floor;
    camPos.lerp(_want, Math.min(1, dt * 6));
    camera.position.copy(camPos);
    camera.lookAt(g.x, g.y + 1.0, g.z);
  }

  function update(dt) {
    if (!hog) return;
    let fwd = false;                // read by the 0-20 stopwatch further down
    if (autopilot) {
      fwd = hog.input.throttle > 0;
      // The bot driver, driving the range hog through exactly the code a
      // squad's driver uses. Nothing else in here changes: it writes the same
      // four inputs the keys below write, which is the point of keeping
      // `VehicleDriver`'s whole surface down to `vehicle.input`.
      if (driver.drive(dt, waypoint.x, waypoint.z)) nextWaypoint();
    } else {
      fwd = !!keys['KeyW'];
      const back = !!keys['KeyS'];
      const rolling = hog.speed > 0.6;
      hog.input.throttle = fwd ? 1 : (back && !rolling ? -1 : 0);
      hog.input.brake = back && rolling ? 1 : 0;
      hog.input.handbrake = !!keys['Space'];
      hog.input.steer = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
      if (fwd || back || hog.input.steer || hog.input.handbrake) hog.wake();
    }

    // The leftover is CARRIED between frames. It used to be a local, so every
    // frame threw away whatever did not divide evenly into a substep, and the
    // sim ran slow and lumpy: at 60 Hz a frame is 16.7 ms against an 8.3 ms
    // step, so any frame that dipped below two full steps discarded up to
    // 8.3 ms of time. On a 144 Hz display it is worse than slow — the frame
    // (6.9 ms) is SHORTER than one substep, the while loop never runs at all,
    // and the vehicle simply never moves.
    //
    // VehicleManager has always done this correctly; this copy did not, which
    // is exactly why the shared step lives on Vehicle and only the pump differs.
    const h = CFG.vehicle.substep;
    accum = Math.min(accum + dt, h * CFG.vehicle.maxSubsteps);
    let steps = 0;
    while (accum >= h && steps < CFG.vehicle.maxSubsteps) {
      hog.step(h);
      accum -= h;
      steps++;
    }
    hog.syncVisuals();
    // Real frame time, and outside the substep loop — same rule VehicleManager
    // follows in the match. A parked hog still has to be able to work a door,
    // and the SEAT tab can leave the tailgate commanded open on its way out.
    hog.updateDoors(dt);

    // 0 -> 20 m/s, and the distance from full speed to a stop under the brake.
    const s = hog.speed;
    perf.top = Math.max(perf.top, s);
    if (fwd && s < 0.3) perf._t0 = 0;
    else if (perf._t0 !== null && s < 20) perf._t0 += dt;
    else if (perf._t0 !== null && s >= 20) { perf.accelT = perf._t0; perf._t0 = null; }
    if (hog.input.brake && perf._bx === null && s > 5) { perf._bx = hog.pos.x; perf._bz = hog.pos.z; }
    if (perf._bx !== null && s < 0.4) {
      perf.brakeD = Math.hypot(hog.pos.x - perf._bx, hog.pos.z - perf._bz);
      perf._bx = null;
    }
    if (!hog.input.brake && s > 5) perf._bx = null;

    updateCamera(dt);
  }

  function telemetry() {
    if (!hog) return 'no warthog loaded';
    _up.set(0, 1, 0).applyQuaternion(hog.quat);
    _left.set(1, 0, 0).applyQuaternion(hog.quat);
    _fwd.set(0, 0, 1).applyQuaternion(hog.quat);
    const lean = Math.atan2(-_left.y, _up.y) * 57.3;
    const pitch = Math.atan2(_fwd.y, Math.hypot(_fwd.x, _fwd.z)) * 57.3;
    const latG = (hog.speed * hog.angVel.y) / CFG.gravity;
    // Body slip is meaningless when parked — atan2 of two near-zero numbers
    // reports a confident 180 degrees while the vehicle sits perfectly still.
    const moving = hog.vel.lengthSq() > 1;
    const beta = moving ? Math.atan2(hog.vel.dot(_left), hog.vel.dot(_fwd)) * 57.3 : null;
    const air = hog.wheels.filter((w) => !w.grounded).length;
    const bar = (v, max) => {
      const n = Math.max(0, Math.min(10, Math.round((v / max) * 10)));
      return '#'.repeat(n) + '.'.repeat(10 - n);
    };
    const rows = hog.wheels.map((w) => {
      const tag = w.id.replace('front_', 'F').replace('rear_', 'R').replace('left', 'L').replace('right', 'R');
      return `${tag.padEnd(3)} ${bar(w.compression, hog.tune.travel)} ${String(Math.round(w.load)).padStart(6)}N`
        + ` slip ${w.slip.toFixed(2)}${w.grounded ? '' : ' AIR'}${w.bump > 0 ? ' STOP' : ''}`;
    });
    return [
      `speed   ${hog.speed.toFixed(1)} m/s   ${(hog.speed * 3.6).toFixed(0)} km/h   (top ${perf.top.toFixed(1)})`,
      `lat     ${latG.toFixed(2)} g      yaw ${hog.angVel.y.toFixed(2)} rad/s   slip ${beta === null ? '--' : `${beta.toFixed(0)}deg`}`,
      `attitude lean ${lean.toFixed(1)}deg  pitch ${pitch.toFixed(1)}deg  ${air ? `${air} WHEEL${air > 1 ? 'S' : ''} AIRBORNE` : 'planted'}`,
      `steer   ${(hog.steerAngle * 57.3).toFixed(1)}deg${hog.asleep ? '   [asleep]' : ''}`,
      ...(autopilot ? [
        `AUTO    wp ${wpIdx} @ ${waypoint.x.toFixed(0)},${waypoint.z.toFixed(0)}`
          + `  ${hog.pos.distanceTo(waypoint).toFixed(0)}m   laps ${laps}`,
        `        thr ${hog.input.throttle.toFixed(1)}  brk ${hog.input.brake.toFixed(1)}`
          + `  str ${hog.input.steer.toFixed(2)}`
          + `${driver && driver.reverseTimer > 0 ? '   UNSTICK' : ''}`,
      ] : []),
      '',
      ...rows,
      '',
      `0-20 m/s  ${perf.accelT === null ? '--' : `${perf.accelT.toFixed(2)} s`}`
        + `    brake to 0  ${perf.brakeD === null ? '--' : `${perf.brakeD.toFixed(1)} m`}`,
      `spring ${Math.round(hog.springK)} N/m   damper ${Math.round(hog.damperC)} Ns/m   sag ${hog.sagLen.toFixed(3)} m`,
    ].join('\n');
  }

  // Build the slider panel. `onChange` lets the host refresh its paste box.
  function buildInputs(container, onChange) {
    const T = CFG.vehicle.warthog;
    container.innerHTML = '';
    for (const [title, fields] of FIELDS) {
      const fs = document.createElement('fieldset');
      fs.innerHTML = `<legend>${title}</legend>`;
      for (const [label, path, step] of fields) {
        const row = document.createElement('div');
        row.className = 'row';
        const lab = document.createElement('label');
        lab.textContent = label;
        lab.style.width = '68px';
        const input = document.createElement('input');
        input.type = 'number';
        input.step = step;
        input.value = readPath(T, path);
        input.oninput = () => {
          const v = Number(input.value);
          if (!Number.isFinite(v)) return;
          writePath(T, path, v);
          if (hog) hog.retune();
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
    get vehicle() { return hog; },
    get camName() { return CAMS[camMode]; },
    get autopilot() { return autopilot; },
    setAutopilot(on) {
      autopilot = !!on;
      if (driver) driver.release();      // hand the controls back cleanly
      if (autopilot) {
        // Start on the leg the hog is nearest to being able to drive, so
        // switching it on mid-range does not begin with a U-turn.
        let best = 0, bestD = Infinity;
        for (let i = 0; i < COURSE.length; i++) {
          const d = hog.pos.distanceToSquared(COURSE[i]);
          if (d < bestD) { bestD = d; best = i; }
        }
        wpIdx = best;
        waypoint.copy(COURSE[best]);
        laps = 0;
      }
    },
    setActive(on) {
      active = on;
      group.visible = on;
      for (const k of Object.keys(keys)) keys[k] = false;
      if (on) reset();
    },
    // Show the ground and the hog without handing it the keys. The SEAT tab
    // needs the vehicle on screen and standing still — `active` gates both the
    // input listeners and `update`, so a parked hog is just visible-but-not-
    // active rather than a second code path.
    setStatic(on) {
      active = false;
      group.visible = on;
      for (const k of Object.keys(keys)) keys[k] = false;
      if (on) reset();
    },
    update,
    telemetry,
    buildInputs,
    dump: () => dumpTune(CFG.vehicle.warthog),
    reset,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
