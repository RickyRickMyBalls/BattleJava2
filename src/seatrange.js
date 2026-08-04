// The seat fitting bay — the SEAT tab of /chartest.html.
//
// Same argument as `vehiclerange.js`: build the instrument, do not guess the
// numbers. Phase 5 put bodies in the Warthog's seats and two of the five landed
// correctly; the other three are wrong because the DATA behind them is a guess
// (the tailgate riders have no authored empties at all — VEHICLE_PLAN.md open
// question 3), not because the seating code is wrong. Guessing replacement
// offsets in config.js would just move the guess.
//
// Two things make this an instrument rather than a preview:
//
// 1. IT SHARES THE GAME'S CODE. Bodies are placed by `seating.js`, the exact
//    functions `Soldier.seatIn` calls. If this file did its own arithmetic the
//    numbers it produced would not transfer, and a tuner you cannot trust is
//    worse than none.
//
// 2. IT REPORTS CLEARANCE. The failure everyone actually hits is a boot through
//    the floor pan, and you cannot see it from outside the hog — the bodywork
//    hides it at every angle a player will ever have. So the floor under each
//    seat is probed and the gap is printed, negative when the foot is through
//    it. "Looks fine" is exactly how the 18 cm error survived.

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { CFG } from './config.js';
import { measureHipsRise, seatMeshOn, forcePose, poseFor, findBone, DEFAULT_POSE } from './seating.js';

const _v = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
// How far above the seat marker the floor probe starts — only needs to clear
// the tallest thing in the column (the seat back and the roll cage).
const PROBE_LIFT = 2.5;
const f = (n) => (Math.round(n * 1000) / 1000).toString();
const pad = (s, n) => String(s).padEnd(n);

// Give every seat its own pose object up front, so the inputs always have a
// real array to bind to and editing one seat never writes another's. Same
// idempotent shape as `ensureGrip`/`ensureFp` in chartest.js — identity is kept
// across rebuilds so live bindings stay valid.
export function ensureSeatPose(def) {
  const base = CFG.vehicle.seatPose || DEFAULT_POSE;
  if (!def.pose || !def.pose.pos || !def.pose.rot) {
    def.pose = { pos: [...base.pos], rot: [...base.rot] };
  }
  return def.pose;
}

export function createSeatRange(assets, range) {
  const seats = CFG.vehicle.seats;
  // Sorted, so seat N always gets the same rig. `Object.keys` order follows
  // however the loads resolved, which shuffled elite and spartan between the
  // tailgate seats from one reload to the next — and since the two have
  // different leg lengths, the toe and gap columns moved with them. Numbers
  // that change when you reload are numbers you end up chasing.
  const charKeys = Object.keys(assets.characters || {}).sort();
  // One body per seat, all five at once. Seeing them together is the point:
  // the tailgate riders only read as wrong NEXT to a passenger who is right.
  const bodies = [];
  let sel = 0;
  let active = false;

  const raycaster = new THREE.Raycaster();
  raycaster.far = 4;

  function hog() { return range.vehicle; }

  function build() {
    const v = hog();
    if (!v || !charKeys.length || bodies.length) return;
    for (let i = 0; i < seats.length; i++) {
      // Cycle the available characters rather than using one five times — a
      // pose that only fits the marine is a pose that breaks on the next rig,
      // and this is where that should be visible.
      const character = assets.characters[charKeys[i % charKeys.length]];
      if (!character) continue;
      const mesh = cloneSkeleton(character.template);
      const mixer = new THREE.AnimationMixer(mesh);
      const actions = {};
      for (const [key, clip] of Object.entries(character.clips)) {
        actions[key] = mixer.clipAction(clip);
      }
      const anim = seats[i].anim || 'sit';
      const act = actions[anim] || actions.idle;
      if (act) act.play();
      forcePose(actions, actions[anim] ? anim : 'idle');
      bodies.push({ i, mesh, mixer, actions, anim, charKey: charKeys[i % charKeys.length] });
      ensureSeatPose(seats[i]);
    }
    reseatAll();
  }

  // Re-run the game's placement for one seat. Called on every slider edit,
  // which is what makes the tab live.
  function reseat(b) {
    const v = hog();
    if (!v) return;
    const rise = measureHipsRise(b.mesh, b.mixer, b.actions[b.anim]);
    seatMeshOn(v, b.i, b.mesh, rise, poseFor(seats[b.i], CFG.vehicle.seatPose));
  }

  function reseatAll() { for (const b of bodies) reseat(b); }

  // The floor under a seat, probed rather than assumed. Cast down from just
  // below the hips against the hog's own geometry; the first thing hit is what
  // a boot would go through. Bodies are excluded (a marine's own legs are not
  // a floor) and so is the collision hull, which is not rendered and is not
  // where the feet visually land.
  // The footwell floor under a seated body's foot.
  //
  // Cast the whole column ONCE from above the hull, down the toe's XZ, and pick
  // from the full list rather than taking the first hit. Two shorter probes
  // were tried and both lied:
  //
  //   - from the hips: hits the seat cushion the marine is sitting ON, which is
  //     not a surface any boot goes through. Reported the driver's floor as
  //     0.937 when the real footwell is 0.65.
  //   - from just above the toe: the seat's front lip overhangs the foot, so it
  //     hit that instead — 1.024, above the seat marker itself.
  //
  // The floor is the topmost surface BELOW the seat marker: everything above
  // the marker is seat, dash and wheel, and everything below it in that column
  // is what a foot is over. Taking it from a sorted full list means no probe
  // origin has to be guessed.
  //
  // Returns a CHASSIS-LOCAL height, the frame every other number in the report
  // is in — printing a raw world Y beside local ones compares two frames the
  // moment the hog is pitched at all.
  function floorUnder(b, markerWorldY) {
    const v = hog();
    if (!v) return null;
    v.group.updateMatrixWorld(true);
    const toe = findBone(b.mesh, 'lefttoebase');
    if (!toe) return null;
    toe.getWorldPosition(_v);
    _v.y = markerWorldY + PROBE_LIFT;      // clear of the hull, straight down
    raycaster.set(_v, _down);
    const hit = raycaster.intersectObject(v.group, true)
      .find((h) => h.point.y < markerWorldY - 0.02
        && !isBody(h.object) && !/^collision_/i.test(h.object.name || ''));
    if (!hit) return null;
    return v.group.worldToLocal(_v.copy(hit.point)).y;
  }

  function isBody(obj) {
    for (const b of bodies) {
      let n = obj;
      while (n) { if (n === b.mesh) return true; n = n.parent; }
    }
    return false;
  }

  // Chassis-frame Y of a bone, which is the frame every seat number is in.
  function localY(b, bone) {
    const v = hog();
    const node = findBone(b.mesh, bone);
    if (!v || !node) return null;
    node.getWorldPosition(_v);
    v.group.worldToLocal(_v);
    return _v.y;
  }

  function report() {
    const v = hog();
    if (!v || !bodies.length) return 'no vehicle';
    const rows = [
      pad('seat', 11) + pad('char', 9) + pad('marker', 8) + pad('hips', 8)
        + pad('toe', 8) + pad('floor', 8) + 'gap',
    ];
    for (const b of bodies) {
      const def = seats[b.i];
      const markerWorld = v.group.localToWorld(v.seatLocal(b.i, new THREE.Vector3()));
      const marker = v.seatLocal(b.i, new THREE.Vector3()).y;
      const hips = localY(b, 'hips');
      const toe = localY(b, 'lefttoebase');
      const fl = floorUnder(b, markerWorld.y);
      const gap = (fl === null || toe === null) ? null : toe - fl;
      rows.push(
        pad((sel === b.i ? '>' : ' ') + def.id, 11)
        + pad(b.charKey, 9)
        + pad(f(marker), 8)
        + pad(hips === null ? '-' : f(hips), 8)
        + pad(toe === null ? '-' : f(toe), 8)
        + pad(fl === null ? 'none' : f(fl), 8)
        + (gap === null ? '-' : (gap >= 0 ? '+' : '') + f(gap))
      );
    }
    rows.push('');
    rows.push('gap = toe above the floor it is over. NEGATIVE is a boot');
    rows.push('through the bodywork — invisible from outside the hog.');
    rows.push('floor = topmost hull surface below the seat marker, in the');
    rows.push('toe\'s own column. Seats differ by CHAR: a pose that only');
    rows.push('fits one rig is a pose that breaks on the next one.');
    return rows.join('\n');
  }

  // The paste block. Emits the WHOLE seats array, because `offset` and `pose`
  // are edited together here and splitting them across two blocks is how one
  // of them gets pasted and the other forgotten.
  function dump() {
    const lines = seats.map((d) => {
      const p = d.pose || CFG.vehicle.seatPose || DEFAULT_POSE;
      const loc = d.ref ? `ref: '${d.ref}'` : `ref: null, offset: [${d.offset.map(f).join(', ')}]`;
      const cam = d.camera ? `camera: '${d.camera}'` : 'camera: null';
      return `      { id: '${d.id}', label: '${d.label}', role: '${d.role}', anim: '${d.anim}',\n`
        + `        ${loc}, ${cam},\n`
        + `        pose: { pos: [${p.pos.map(f).join(', ')}], rot: [${p.rot.map(f).join(', ')}] } },`;
    });
    return `// SEAT tab -> replace CFG.vehicle.seats in config.js\n    seats: [\n${lines.join('\n')}\n    ],`;
  }

  // Frame the selected seat. Orbit is handled by the host's OrbitControls; this
  // only moves the target and pulls the camera in to something that can
  // actually see a lap.
  function focus(camera, controls) {
    const v = hog();
    if (!v) return;
    v.group.updateMatrixWorld(true);
    v.seatLocal(sel, _v);
    const local = _v.clone();
    v.group.localToWorld(_v);
    controls.target.copy(_v);
    // Stand off on the side the seat is on (+X is chassis left), high enough to
    // see into the footwell rather than across the door top.
    const side = local.x >= 0 ? 1 : -1;
    const eye = new THREE.Vector3(local.x + 2.6 * side, local.y + 1.5, local.z + 2.2);
    v.group.localToWorld(eye);
    camera.position.copy(eye);
    controls.update();
  }

  function buildInputs(container, onChange) {
    container.innerHTML = '';
    const v = hog();
    if (!v) { container.textContent = 'no warthog loaded'; return; }

    const btns = document.createElement('div');
    btns.className = 'btns';
    seats.forEach((d, i) => {
      const b = document.createElement('button');
      b.textContent = d.id.toUpperCase();
      b.classList.toggle('sel', i === sel);
      b.onclick = () => { sel = i; buildInputs(container, onChange); onChange(); };
      btns.appendChild(b);
    });
    container.appendChild(btns);

    const def = seats[sel];
    const pose = ensureSeatPose(def);

    // Where the seat IS. Authored seats are read off the GLB and are not
    // editable here on purpose: overriding an empty that exists would silently
    // put config and the rig into disagreement, and the fix for a wrong empty
    // is in Blender. Derived seats have no empty to disagree with, so those are
    // exactly the ones this can move.
    const anchor = document.createElement('fieldset');
    if (def.ref) {
      anchor.innerHTML = `<legend>ANCHOR</legend>`
        + `<div class="hint" style="margin:0">authored: ${def.ref}<br>edit in Blender, not here</div>`;
    } else {
      anchor.innerHTML = `<legend>ANCHOR (derived — no empty in the GLB)</legend>`;
      addRows(anchor, [['off x', 0], ['off y', 1], ['off z', 2]], def.offset, 0.01, () => {
        reseatAll(); onChange();
      });
    }
    container.appendChild(anchor);

    const ps = document.createElement('fieldset');
    ps.innerHTML = `<legend>POSE — ${def.id} (${def.anim})</legend>`;
    addRows(ps, [['pos x', 0], ['pos y', 1], ['pos z', 2]], pose.pos, 0.01, () => {
      reseat(bodies.find((b) => b.i === sel)); onChange();
    });
    addRows(ps, [['rot x', 0], ['rot y', 1], ['rot z', 2]], pose.rot, 0.05, () => {
      reseat(bodies.find((b) => b.i === sel)); onChange();
    });
    container.appendChild(ps);
  }

  function addRows(parent, fields, arr, step, after) {
    for (const [label, idx] of fields) {
      const row = document.createElement('div');
      row.className = 'row';
      const lab = document.createElement('label');
      lab.textContent = label;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = step;
      input.value = arr[idx];
      input.oninput = () => {
        const n = Number(input.value);
        if (!Number.isFinite(n)) return;
        arr[idx] = n;
        after();
      };
      row.appendChild(lab);
      row.appendChild(input);
      parent.appendChild(row);
    }
  }

  return {
    get seat() { return sel; },
    get seatId() { return seats[sel] ? seats[sel].id : '-'; },
    setActive(on) {
      active = on;
      if (on) build();
      for (const b of bodies) b.mesh.visible = on;
    },
    update(dt) {
      if (!active) return;
      for (const b of bodies) b.mixer.update(dt);
    },
    focus,
    report,
    dump,
    buildInputs,
    reseatAll,
  };
}
