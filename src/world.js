// Battlefield: procedural terrain, cover objects, sector beacons, HQ bases.
// Terrain height is an analytic function so AI/physics never needs raycasts for grounding.

import * as THREE from 'three';
import { fbm } from './noise.js';
import { CFG, TEAM } from './config.js';

const FLAT_SPOTS = []; // {x, z, r0, r1, h}

function baseHeight(x, z) {
  const rolling = (fbm(x * 0.008 + 13.7, z * 0.008 + 4.2) - 0.5) * 26;
  const detail = (fbm(x * 0.05, z * 0.05, 3) - 0.5) * 2.2;
  // Gentle valley through the middle so the sector lane reads as the front line
  const valley = Math.abs(z) * 0.02;
  return rolling + detail + valley * valley * 0.4;
}

function proceduralHeight(x, z) {
  let h = baseHeight(x, z);
  for (const f of FLAT_SPOTS) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r1) {
      const t = d < f.r0 ? 0 : (d - f.r0) / (f.r1 - f.r0);
      const s = t * t * (3 - 2 * t);
      h = f.h * (1 - s) + h * s;
    }
  }
  return h;
}

// Active terrain provider — procedural function or a baked GLB heightfield.
let _provider = proceduralHeight;
export function terrainHeight(x, z) {
  return _provider(x, z);
}

export class World {
  constructor(scene, mapDef, mapData) {
    this.scene = scene;
    this.def = mapDef || { id: 'demo', name: 'Demo Map', type: 'procedural' };
    this.coverBoxes = []; // {minX,minY,minZ,maxX,maxY,maxZ}
    this.sectors = [];
    this.hqs = [];
    this.collision = null; // authored mesh collision; GLB maps only

    if (this.def.type === 'glb' && mapData) {
      this.mapW = mapData.w;
      this.mapD = mapData.d;
      _provider = mapData.sample;
      scene.add(mapData.group);
      // Marker-authored layout when the map provides it, else scale the demo pattern
      if (mapData.hqDefs && mapData.sectorDefs) {
        this.hqDefs = mapData.hqDefs;
        this.sectorDefs = mapData.sectorDefs;
        this.vehicleSpawns = mapData.vehicleSpawns || [];
      } else {
        const sx = this.mapW / CFG.map.w, sz = this.mapD / CFG.map.d;
        this.hqDefs = CFG.hq.map((h) => ({ team: h.team, x: h.x * sx, z: h.z * sz }));
        this.sectorDefs = CFG.sectors.map((s) => ({ id: s.id, x: s.x * sx, z: s.z * sz, r: s.r }));
      }
      this.ambient = mapData.ambient || null;
      this.collision = mapData.collision || null;
      if (this.collision && this.collision.coverBoxes) {
        this.coverBoxes.push(...this.collision.coverBoxes);
      }
      this._buildLights();
      this._buildSectors();
      this._buildHQs();
      this._buildBounds();
    } else {
      this.mapW = CFG.map.w;
      this.mapD = CFG.map.d;
      this.hqDefs = CFG.hq;
      this.sectorDefs = CFG.sectors;
      _provider = proceduralHeight;
      FLAT_SPOTS.length = 0;
      // Register flat pads before terrain mesh is built
      for (const hq of this.hqDefs) FLAT_SPOTS.push({ x: hq.x, z: hq.z, r0: 30, r1: 60, h: baseHeight(hq.x, hq.z) });
      for (const s of this.sectorDefs) FLAT_SPOTS.push({ x: s.x, z: s.z, r0: s.r * 0.9, r1: s.r * 1.8, h: baseHeight(s.x, s.z) });
      this._buildLights();
      this._buildTerrain();
      this._buildSectors();
      this._buildHQs();
      this._buildCover();
      this._buildBounds();
    }
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x54604a, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(-180, 260, 120);
    this.scene.add(sun);
    // Imported maps are vista-driven — fog reaches further so cliffs stay readable
    this.scene.fog = this.def.type === 'glb'
      ? new THREE.Fog(0xbcd2e2, 500, 2400)
      : new THREE.Fog(0xbcd2e2, 260, 950);
    this.scene.background = new THREE.Color(0xa8c6dd);
  }

  _buildTerrain() {
    const w = this.mapW, d = this.mapD;
    const segX = 150, segZ = 96;
    const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(0x5e7c4a);
    const cDry = new THREE.Color(0x8a8a62);
    const cRock = new THREE.Color(0x6d6f72);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      pos.setY(i, h);
      const slope = Math.abs(terrainHeight(x + 2, z) - h) + Math.abs(terrainHeight(x, z + 2) - h);
      const n = fbm(x * 0.03 + 50, z * 0.03);
      tmp.copy(cGrass).lerp(cDry, Math.min(1, Math.max(0, n * 1.4 - 0.2)));
      if (slope > 1.4) tmp.lerp(cRock, Math.min(1, (slope - 1.4) / 2));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(mesh);
  }

  _buildSectors() {
    for (const def of this.sectorDefs) {
      const y = terrainHeight(def.x, def.z);
      const group = new THREE.Group();
      group.position.set(def.x, y, def.z);

      const ringGeo = new THREE.RingGeometry(def.r - 1.2, def.r, 48);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.5, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.25;
      group.add(ring);

      const beamGeo = new THREE.CylinderGeometry(1.1, 1.6, 60, 10, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 30;
      group.add(beam);

      const sprite = makeTextSprite(def.id);
      sprite.position.y = 26;
      sprite.scale.set(14, 14, 1);
      group.add(sprite);

      this.scene.add(group);
      this.sectors.push({
        id: def.id, x: def.x, z: def.z, r: def.r, y,
        owner: null, progress: 0, contested: false,
        ringMat, beamMat, sprite,
      });
    }
  }

  _buildHQs() {
    for (const def of this.hqDefs) {
      const y = terrainHeight(def.x, def.z);
      const color = def.team === TEAM.BLUE ? CFG.colors.blue : CFG.colors.red;
      const g = new THREE.Group();
      g.position.set(def.x, y, def.z);

      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(26, 26, 0.3, 24),
        new THREE.MeshLambertMaterial({ color: 0x4a545e })
      );
      pad.position.y = 0.15;
      g.add(pad);

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 26, 8),
        new THREE.MeshLambertMaterial({ color: 0x99a3ad })
      );
      pole.position.y = 13;
      g.add(pole);

      const banner = new THREE.Mesh(
        new THREE.BoxGeometry(9, 5.5, 0.25),
        new THREE.MeshBasicMaterial({ color })
      );
      banner.position.set(4.8, 22, 0);
      g.add(banner);

      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
      const dome = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 18, 24, 1, true), glowMat);
      dome.position.y = 9;
      g.add(dome);

      // A few barricades ringing the pad
      const wallMat = new THREE.MeshLambertMaterial({ color: 0x55606a });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.3;
        const wx = Math.cos(a) * 32, wz = Math.sin(a) * 32;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(7, 2.4, 1.2), wallMat);
        wall.position.set(wx, terrainHeight(def.x + wx, def.z + wz) - y + 1.2, wz);
        wall.rotation.y = -a + Math.PI / 2;
        g.add(wall);
        this._addCoverAABB(def.x + wx, def.z + wz, 3.6, 1.2, 2.4, terrainHeight(def.x + wx, def.z + wz));
      }

      this.scene.add(g);
      this.hqs.push({ team: def.team, x: def.x, z: def.z, y, r: 26 });
    }
  }

  _addCoverAABB(cx, cz, halfX, halfZ, height, groundY) {
    this.coverBoxes.push({
      minX: cx - halfX, maxX: cx + halfX,
      minZ: cz - halfZ, maxZ: cz + halfZ,
      minY: groundY - 0.5, maxY: groundY + height,
    });
  }

  _buildCover() {
    const crateGeo = new THREE.BoxGeometry(1, 1, 1);
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x6d7a5e });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x74767a, flatShading: true });

    const cratePlacements = [];
    const rockPlacements = [];
    const rand = mulberry(12345);

    // Cover clusters around each sector
    for (const s of this.sectorDefs) {
      const clusters = 10;
      for (let i = 0; i < clusters; i++) {
        const a = rand() * Math.PI * 2;
        const dist = s.r * (0.35 + rand() * 0.85);
        const cx = s.x + Math.cos(a) * dist;
        const cz = s.z + Math.sin(a) * dist;
        const w = 2 + rand() * 2.6, h = 1.6 + rand() * 1.3, dep = 1.2 + rand() * 2;
        cratePlacements.push({ x: cx, z: cz, w, h, d: dep, rot: rand() * Math.PI });
      }
    }
    // Scattered rocks across the whole field
    for (let i = 0; i < 130; i++) {
      const x = (rand() - 0.5) * (this.mapW - 80);
      const z = (rand() - 0.5) * (this.mapD - 40);
      let near = false;
      for (const hq of this.hqDefs) if (Math.hypot(x - hq.x, z - hq.z) < 45) near = true;
      if (near) continue;
      const s = 1.2 + rand() * 2.8;
      rockPlacements.push({ x, z, s });
    }

    const crates = new THREE.InstancedMesh(crateGeo, crateMat, cratePlacements.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    cratePlacements.forEach((c, i) => {
      const gy = terrainHeight(c.x, c.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.rot);
      v.set(c.x, gy + c.h / 2, c.z);
      sc.set(c.w, c.h, c.d);
      m.compose(v, q, sc);
      crates.setMatrixAt(i, m);
      // AABB ignores rotation; use the max extent so LOS errs toward "blocked"
      const half = Math.max(c.w, c.d) / 2;
      this._addCoverAABB(c.x, c.z, half, half, c.h, gy);
    });
    this.scene.add(crates);

    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockPlacements.length);
    rockPlacements.forEach((r, i) => {
      const gy = terrainHeight(r.x, r.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.x * 0.7);
      v.set(r.x, gy + r.s * 0.35, r.z);
      sc.set(r.s, r.s, r.s);
      m.compose(v, q, sc);
      rocks.setMatrixAt(i, m);
      this._addCoverAABB(r.x, r.z, r.s * 0.75, r.s * 0.75, r.s * 0.9, gy);
    });
    this.scene.add(rocks);
  }

  _buildBounds() {
    // Visual edge markers so players notice the map limit
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false });
    const w = this.mapW, d = this.mapD;
    const wallN = new THREE.Mesh(new THREE.PlaneGeometry(w, 40), mat);
    wallN.position.set(0, 20, -d / 2);
    this.scene.add(wallN);
    const wallS = wallN.clone(); wallS.position.z = d / 2; this.scene.add(wallS);
    const wallE = new THREE.Mesh(new THREE.PlaneGeometry(d, 40), mat);
    wallE.rotation.y = Math.PI / 2; wallE.position.set(w / 2, 20, 0); this.scene.add(wallE);
    const wallW = wallE.clone(); wallW.position.x = -w / 2; this.scene.add(wallW);
  }

  // Skybox flavor: clouds rotate, capital ships drift +X. Runs on real time.
  updateAmbient(dt) {
    if (!this.ambient) return;
    for (const r of this.ambient.rotators) r.rotation.y += dt * 0.005;
    const localSpeed = 20 / this.ambient.scale;
    const wrap = (this.mapW * 4) / this.ambient.scale;
    for (const m of this.ambient.movers) {
      m.position.x += dt * localSpeed;
      if (m.position.x - m.userData.startX > wrap) m.position.x = m.userData.startX - wrap * 0.5;
    }
  }

  // Ground height under (x, z). Entities go through their host's world rather
  // than importing terrainHeight() directly: that module global is stomped by
  // whichever World was constructed last, so a second host (the lobby) sharing
  // the same process would silently retarget everyone's grounding.
  heightAt(x, z) {
    return terrainHeight(x, z);
  }

  clampToMap(v) {
    v.x = Math.max(-this.mapW / 2 + 3, Math.min(this.mapW / 2 - 3, v.x));
    v.z = Math.max(-this.mapD / 2 + 3, Math.min(this.mapD / 2 - 3, v.z));
  }

  // Segment vs cover AABBs (slab method). Returns t in [0,1] of nearest hit or Infinity.
  raycastCover(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    let best = Infinity;
    for (const b of this.coverBoxes) {
      let tmin = 0, tmax = 1;
      // X slab
      if (Math.abs(dx) < 1e-9) { if (ax < b.minX || ax > b.maxX) continue; }
      else {
        let t1 = (b.minX - ax) / dx, t2 = (b.maxX - ax) / dx;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Y slab
      if (Math.abs(dy) < 1e-9) { if (ay < b.minY || ay > b.maxY) continue; }
      else {
        let t1 = (b.minY - ay) / dy, t2 = (b.maxY - ay) / dy;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      // Z slab
      if (Math.abs(dz) < 1e-9) { if (az < b.minZ || az > b.maxZ) continue; }
      else {
        let t1 = (b.minZ - az) / dz, t2 = (b.maxZ - az) / dz;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) continue;
      }
      if (tmin < best) best = tmin;
    }
    return best;
  }

  // Terrain intersection along a segment; returns t or Infinity. Sampled march.
  raycastTerrain(ax, ay, az, bx, by, bz) {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const steps = Math.max(4, Math.min(60, Math.floor(len / 5)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = az + (bz - az) * t;
      if (y < terrainHeight(x, z)) return t;
    }
    return Infinity;
  }

  // True if an unobstructed line exists between two points.
  hasLOS(ax, ay, az, bx, by, bz) {
    if (this.raycastTerrain(ax, ay, az, bx, by, bz) < 1) return false;
    if (this.raycastCover(ax, ay, az, bx, by, bz) < 0.995) return false;
    return true;
  }

  // Resolve a moving capsule (circle in XZ) against cover boxes; mutates pos.
  collideCircle(pos, radius) {
    for (const b of this.coverBoxes) {
      if (pos.y > b.maxY || pos.y + 1.6 < b.minY) continue;
      const cx = Math.max(b.minX, Math.min(b.maxX, pos.x));
      const cz = Math.max(b.minZ, Math.min(b.maxZ, pos.z));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = (radius - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else if (d2 <= 1e-9) {
        pos.x += radius; // degenerate: standing exactly on a box face
      }
    }
  }
}

function makeTextSprite(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 84px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 10;
  ctx.strokeText(text, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 5;
  return sprite;
}

function mulberry(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
