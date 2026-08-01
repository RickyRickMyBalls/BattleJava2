// Cover volumes — the boxes that stop bullets, break line of sight and push
// bodies aside. ONE implementation, shared by the battlefield (world.js) and
// the lobby stage (lobbyworld.js). Both carried near-identical private copies
// of this math until a turned box had to exist in both, and two copies of a
// test this load-bearing is a drift waiting to happen.
//
// A cover box is an AABB by default and an ORIENTED box when it carries a
// `yaw`. That split is deliberate rather than making everything oriented:
// authored Blender cover and the procedurally scattered rocks are world-aligned
// or near enough, and the axis-aligned path is the cheaper one on a test that
// runs per bullet, per grenade step, and per soldier per frame.
//
// Orientation exists for the things a player PLACES, which are long, thin and
// aimed. A 3.2 m wall dropped at 45 degrees and bounded by an axis-aligned box
// becomes a 3.2 m SQUARE — it would stop rounds that visibly sail past the end
// of it and shove players aside two metres from anything solid. The existing
// max-extent compromise (see the crate note in world._buildCover) is invisible
// on a one-metre crate and unacceptable on the one object players deliberately
// stand behind.
//
// Every box carries a world AABB whatever its yaw, so anything that only wants
// a bound — a broad-phase reject, a debug draw — reads min/max and never has to
// know the difference.

const EPS = 1e-9;

// A cover volume centred on (cx, cz), `hx`/`hz` half-extents in its OWN frame,
// spanning minY..maxY in world Y. `yaw` turns it about the vertical axis, using
// the same convention as everything else in the game: forward is
// (sin yaw, cos yaw), which is what THREE's `rotation.y` gives a mesh, so a box
// and the mesh drawn for it can share one angle.
export function makeCoverBox(cx, cz, hx, hz, minY, maxY, yaw = 0) {
  const b = { minY, maxY };
  if (yaw) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    b.yaw = yaw;
    b.cx = cx; b.cz = cz;
    b.hx = hx; b.hz = hz;
    b.cos = cos; b.sin = sin;
    // World bound OF the turned box — the projection of both half-extents onto
    // each world axis. Not the box itself; just what contains it.
    const ex = hx * Math.abs(cos) + hz * Math.abs(sin);
    const ez = hx * Math.abs(sin) + hz * Math.abs(cos);
    b.minX = cx - ex; b.maxX = cx + ex;
    b.minZ = cz - ez; b.maxZ = cz + ez;
  } else {
    b.minX = cx - hx; b.maxX = cx + hx;
    b.minZ = cz - hz; b.maxZ = cz + hz;
  }
  return b;
}

// Segment vs a list of cover boxes (slab method). Returns t in [0,1] of the
// nearest hit, or Infinity. Y is never rotated — a yaw about the vertical axis
// leaves world Y alone — so only the XZ pair moves into the box's frame.
export function raycastCoverBoxes(boxes, ax, ay, az, bx, by, bz) {
  const dy = by - ay;
  let best = Infinity;

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let ox, oz, dx, dz, loX, hiX, loZ, hiZ;

    if (b.yaw) {
      // Both endpoints into the box's frame, then the identical slab test on
      // half-extents about the origin.
      const px = ax - b.cx, pz = az - b.cz;
      const qx = bx - b.cx, qz = bz - b.cz;
      ox = px * b.cos - pz * b.sin;
      oz = px * b.sin + pz * b.cos;
      dx = (qx * b.cos - qz * b.sin) - ox;
      dz = (qx * b.sin + qz * b.cos) - oz;
      loX = -b.hx; hiX = b.hx;
      loZ = -b.hz; hiZ = b.hz;
    } else {
      ox = ax; oz = az;
      dx = bx - ax; dz = bz - az;
      loX = b.minX; hiX = b.maxX;
      loZ = b.minZ; hiZ = b.maxZ;
    }

    let tmin = 0, tmax = 1;

    // X slab. A near-zero component means the segment is parallel to the slab:
    // it either starts inside it or can never enter.
    if (dx > -EPS && dx < EPS) { if (ox < loX || ox > hiX) continue; }
    else {
      let t1 = (loX - ox) / dx, t2 = (hiX - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }

    // Y slab
    if (dy > -EPS && dy < EPS) { if (ay < b.minY || ay > b.maxY) continue; }
    else {
      let t1 = (b.minY - ay) / dy, t2 = (b.maxY - ay) / dy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }

    // Z slab
    if (dz > -EPS && dz < EPS) { if (oz < loZ || oz > hiZ) continue; }
    else {
      let t1 = (loZ - oz) / dz, t2 = (hiZ - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }

    if (tmin < best) best = tmin;
  }

  return best;
}

// Resolve a moving capsule (a circle in XZ) against cover boxes; mutates `pos`.
// `height` is how tall the mover is, used only to skip boxes it is entirely
// above or below — which is also why a box has no lid: nothing here can stand
// ON a cover volume, and grounding is the floor system's job.
export function pushOutCoverBoxes(boxes, pos, radius, height = 1.6) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (pos.y > b.maxY || pos.y + height < b.minY) continue;

    // Circle centre into the box's frame, so the clamp below is a plain
    // axis-aligned one whatever the box's angle.
    let px, pz, hx, hz;
    if (b.yaw) {
      const dx = pos.x - b.cx, dz = pos.z - b.cz;
      px = dx * b.cos - dz * b.sin;
      pz = dx * b.sin + dz * b.cos;
      hx = b.hx; hz = b.hz;
    } else {
      px = pos.x - (b.minX + b.maxX) * 0.5;
      pz = pos.z - (b.minZ + b.maxZ) * 0.5;
      hx = (b.maxX - b.minX) * 0.5;
      hz = (b.maxZ - b.minZ) * 0.5;
    }

    const nx = px < -hx ? -hx : (px > hx ? hx : px);
    const nz = pz < -hz ? -hz : (pz > hz ? hz : pz);
    let ox = px - nx, oz = pz - nz;
    const d2 = ox * ox + oz * oz;

    if (d2 > EPS) {
      if (d2 >= radius * radius) continue;   // outside reach, nothing to do
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      ox *= push; oz *= push;
    } else {
      // Standing exactly on a face, or inside. Arbitrary but stable: shove out
      // along the box's own +X. Same choice World.collideCircle always made,
      // now applied in the box's frame so a turned box pushes off its face
      // rather than off world +X.
      ox = radius; oz = 0;
    }

    if (b.yaw) {
      pos.x += ox * b.cos + oz * b.sin;
      pos.z += -ox * b.sin + oz * b.cos;
    } else {
      pos.x += ox;
      pos.z += oz;
    }
  }
}
