import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Modern Monte Garden villas, modelled after the developer renders (research/images/renders):
// white render walls, thin white slab overhangs, vertical timber slats, floor-to-ceiling glazing, flat gravel roofs.

const AW = 1024;
const AH = 1280;
// atlas regions in canvas pixels [x0, y0, x1, y1]
const REG = {
  front: [0, 0, 512, 256],
  side: [512, 0, 1024, 256],
  wood: [0, 256, 512, 512],
  base: [512, 256, 1024, 512],
  roof: [0, 512, 512, 768],
  white: [512, 512, 768, 640],
  soffit: [768, 512, 1024, 640],
  stone: [512, 640, 1024, 768],
  town: [0, 768, 1024, 896],
  townG: [0, 896, 1024, 1024],
  clubG: [0, 1024, 512, 1152],
  clubR: [512, 1024, 1024, 1152],
  green: [0, 1152, 512, 1280],
};

// white render villas and charcoal-batten villas both appear in the developer renders
const PALETTES = {
  light: { wall: '#f1eee8', slat: [158, 106, 66], gap: 'rgba(60,35,18,0.85)', woodBg: '#6b4528', soffit: '#9a6a42' },
  dark: { wall: '#4a4b4d', slat: [52, 53, 56], gap: 'rgba(15,15,16,0.9)', woodBg: '#2a2b2d', soffit: '#7c5a3c' },
};


function noiseFill(ctx, [x0, y0, x1, y1], base, amount, size = 2) {
  ctx.fillStyle = base;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (let y = y0; y < y1; y += size) {
    for (let x = x0; x < x1; x += size) {
      const v = (Math.random() - 0.5) * amount;
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      ctx.fillRect(x, y, size, size);
    }
  }
}

let P = PALETTES.light;
function slats(ctx, x0, y0, w, h, pal = P) {
  for (let x = x0; x < x0 + w; x += 6) {
    const l = 0.85 + Math.random() * 0.3;
    ctx.fillStyle = `rgb(${pal.slat[0] * l | 0},${pal.slat[1] * l | 0},${pal.slat[2] * l | 0})`;
    ctx.fillRect(x, y0, 4, h);
    ctx.fillStyle = pal.gap;
    ctx.fillRect(x + 4, y0, 2, h);
  }
}

function glass(ctx, x, y, w, h, mullions = 2) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, '#a9bccb');
  g.addColorStop(0.35, '#5f7484');
  g.addColorStop(1, '#25313a');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(x + w * 0.15, y);
  ctx.lineTo(x + w * 0.45, y);
  ctx.lineTo(x + w * 0.2, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h * 0.6);
  ctx.fill();
  ctx.strokeStyle = '#2d3135';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  for (let i = 1; i <= mullions; i++) {
    const mx = x + (w * i) / (mullions + 1);
    ctx.beginPath();
    ctx.moveTo(mx, y);
    ctx.lineTo(mx, y + h);
    ctx.stroke();
  }
}

function overheadShadow(ctx, x0, y0, w) {
  const g = ctx.createLinearGradient(0, y0, 0, y0 + 28);
  g.addColorStop(0, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, 28);
}

function makeAtlas(palette) {
  P = palette;
  const WALL = palette.wall;
  const c = document.createElement('canvas');
  c.width = AW;
  c.height = AH;
  const ctx = c.getContext('2d');

  // upper floor, street front: big glazing + timber panel
  noiseFill(ctx, REG.front, WALL, 0.03);
  glass(ctx, 30, 40, 300, 200, 3);
  slats(ctx, 350, 20, 70, 236);
  glass(ctx, 440, 60, 50, 180, 0);
  overheadShadow(ctx, 0, 0, 512);

  // side walls: mostly solid render with a slot window and a timber strip
  noiseFill(ctx, REG.side, WALL, 0.03);
  glass(ctx, 600, 50, 60, 190, 0);
  slats(ctx, 820, 0, 90, 256);
  overheadShadow(ctx, 512, 0, 512);

  // pure timber volume
  ctx.fillStyle = palette.woodBg;
  ctx.fillRect(0, 256, 512, 256);
  slats(ctx, 0, 256, 512, 256);
  glass(ctx, 140, 300, 230, 196, 1);
  overheadShadow(ctx, 0, 256, 512);

  // ground floor: glass living room, dark garage door, render piers
  noiseFill(ctx, REG.base, WALL, 0.03);
  glass(ctx, 540, 300, 230, 212, 2);
  ctx.fillStyle = '#4b4f53';
  ctx.fillRect(800, 330, 200, 182);
  for (let y = 340; y < 512; y += 14) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(800, y, 200, 2);
  }
  overheadShadow(ctx, 512, 256, 512);

  // gravel roof with parapet
  noiseFill(ctx, REG.roof, '#cfcbc3', 0.12, 3);
  ctx.strokeStyle = '#efece6';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 519, 498, 242);

  noiseFill(ctx, REG.white, '#f4f2ee', 0.02);
  ctx.fillStyle = palette.soffit;
  ctx.fillRect(768, 512, 256, 128);
  slats(ctx, 768, 512, 256, 128, PALETTES.light);

  // dark stone plinth
  noiseFill(ctx, REG.stone, '#8d8880', 0.18, 4);
  ctx.strokeStyle = 'rgba(40,38,35,0.5)';
  ctx.lineWidth = 2;
  for (let y = 640; y < 768; y += 32) {
    for (let x = 512 + ((y / 32) % 2) * 40; x < 1024; x += 80) ctx.strokeRect(x, y, 80, 32);
  }

  // townhouse rows: four units per tile, timber fins between glazing
  for (const [reg, ground] of [
    [REG.town, false],
    [REG.townG, true],
  ]) {
    noiseFill(ctx, reg, WALL, 0.03);
    const y0 = reg[1];
    for (let u = 0; u < 4; u++) {
      const x = u * 256;
      if (ground) {
        glass(ctx, x + 20, y0 + 26, 120, 102, 1);
        ctx.fillStyle = '#4b4f53';
        ctx.fillRect(x + 150, y0 + 40, 80, 88);
      } else {
        glass(ctx, x + 20, y0 + 20, 150, 100, 2);
        slats(ctx, x + 186, y0, 50, 128);
      }
      ctx.fillStyle = '#e2ded6';
      ctx.fillRect(x + 250, y0, 6, 128);
    }
    overheadShadow(ctx, 0, y0, 1024);
  }

  // club house: glass storefront below, rust-red folded panels above, green roof (clubhouse renders)
  noiseFill(ctx, REG.clubG, '#3a3d40', 0.04);
  for (let x = 0; x < 512; x += 64) glass(ctx, x + 4, 1034, 56, 112, 0);
  noiseFill(ctx, REG.clubR, '#a8402c', 0.06);
  ctx.strokeStyle = 'rgba(60,15,8,0.45)';
  ctx.lineWidth = 2;
  for (let x = 512; x < 1024 + 128; x += 96) {
    ctx.beginPath();
    ctx.moveTo(x, 1024);
    ctx.lineTo(x - 128, 1152);
    ctx.stroke();
  }
  noiseFill(ctx, REG.green, '#5f7d3c', 0.18, 4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const FACE_ORDER = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

// box with per-face atlas regions; y is the bottom of the box
function box(w, h, d, x, y, z, faces) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  FACE_ORDER.forEach((f, fi) => {
    const r = REG[faces[f] || faces.all || 'white'];
    const u0 = r[0] / AW, u1 = r[2] / AW, v0 = 1 - r[3] / AH, v1 = 1 - r[1] / AH;
    for (let k = 0; k < 4; k++) {
      const i = fi * 4 + k;
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  });
  g.translate(x, y + h / 2, z);
  return g;
}

const FH = 0.055; // one storey in world units (plan scale: 1 unit ≈ 75 m)
const SLAB = 0.01;
const slab = (w, d, x, y, z) => box(w, SLAB, d, x, y, z, { all: 'white', py: 'roof', ny: 'soffit' });

const VARIANTS = {
  // cantilevered upper floor over a recessed glass ground floor (developer poster)
  cantilever: () => [
    box(0.86, 0.012, 0.78, 0, -0.012, -0.06, { all: 'stone' }),
    box(0.86, FH, 0.78, 0, 0, -0.06, { all: 'side', pz: 'base', py: 'white' }),
    slab(1.02, 0.98, 0, FH - SLAB, 0.02),
    box(0.98, FH - SLAB, 0.92, 0, FH, 0.03, { all: 'side', pz: 'front', py: 'white' }),
    slab(1.08, 1.04, 0, 2 * FH - SLAB, 0.05),
    box(0.1, 2 * FH, 0.04, 0.44, 0, 0.5, { all: 'wood' }),
    box(0.16, 0.018, 0.12, -0.22, 2 * FH, -0.2, { all: 'white' }),
  ],
  // white box + timber box side by side (open-day render)
  split: () => [
    box(0.58, FH, 0.92, -0.21, 0, 0, { all: 'side', pz: 'base', py: 'white' }),
    box(0.58, FH - SLAB, 0.92, -0.21, FH, 0, { all: 'side', pz: 'front', py: 'white' }),
    slab(0.66, 1.04, -0.21, 2 * FH - SLAB, 0.04),
    box(0.42, FH, 0.84, 0.29, 0, -0.04, { all: 'wood', py: 'white' }),
    box(0.4, FH - SLAB, 0.7, 0.28, FH, -0.11, { all: 'side', pz: 'front', py: 'white' }),
    slab(0.5, 0.92, 0.29, FH - SLAB, 0.0),
    slab(0.46, 0.76, 0.28, 2 * FH - SLAB, -0.1),
  ],
  // three storeys stepping back to a roof terrace
  terrace: () => [
    box(1.0, FH, 0.94, 0, 0, 0, { all: 'side', pz: 'base', py: 'white' }),
    slab(1.04, 1.0, 0, FH - SLAB, 0.02),
    box(0.94, FH - SLAB, 0.86, 0, FH, -0.02, { all: 'side', pz: 'front', py: 'white' }),
    slab(1.0, 0.96, 0, 2 * FH - SLAB, 0.02),
    box(0.56, FH - SLAB, 0.56, -0.17, 2 * FH, -0.14, { all: 'wood', pz: 'front', py: 'white' }),
    slab(0.64, 0.66, -0.17, 3 * FH - SLAB * 2, -0.11),
  ],
  // joined townhouse row
  town: () => [
    box(1.0, FH, 0.86, 0, 0, -0.02, { all: 'side', pz: 'townG', nz: 'townG', py: 'white' }),
    slab(1.02, 0.96, 0, FH - SLAB, 0.02),
    box(1.0, FH - SLAB, 0.9, 0, FH, 0, { all: 'side', pz: 'town', nz: 'town', py: 'white' }),
    slab(1.04, 1.0, 0, 2 * FH - SLAB, 0.02),
  ],
  // club house: glazed ground floor under a cantilevered rust-red volume with a green roof
  club: () => [
    box(0.94, FH * 1.15, 0.86, 0, 0, 0, { all: 'clubG', py: 'white' }),
    box(1.04, FH * 0.95, 0.96, 0, FH * 1.15, 0.02, { all: 'clubR', py: 'green', ny: 'soffit' }),
    box(0.5, FH * 0.7, 0.5, -0.2, FH * 2.1, -0.15, { all: 'clubR', py: 'green' }),
  ],
};

const hash = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// clubSpots: [u, v] of the club house / sports complex on the plan; footprints there get the club house design
export function makeVillas(buildings, toWorld, S, clubSpots = []) {
  const mats = Object.fromEntries(
    Object.entries(PALETTES).map(([k, pal]) => [k, new THREE.MeshStandardMaterial({ map: makeAtlas(pal), roughness: 0.78, envMapIntensity: 0.6 })]),
  );
  const geos = Object.fromEntries(Object.entries(VARIANTS).map(([k, fn]) => [k, mergeGeometries(fn())]));

  const items = buildings.map((b, i) => {
    const w = b.w * S;
    const d = b.d * S;
    let kind;
    if (b.big || clubSpots.some(([u, v]) => Math.hypot(b.x - u, b.y - v) < 0.014)) kind = 'club';
    else if (w / d > 1.9) kind = 'town';
    else kind = ['cantilever', 'split', 'terrace'][Math.floor(hash(i) * 3)];
    const flip = kind !== 'town' && hash(i + 99) > 0.5 ? Math.PI : 0;
    const tone = kind !== 'club' && hash(i + 31) < 0.35 ? 'dark' : 'light';
    // sink slightly into the slope so no footprint floats
    return { kind, tone, p: toWorld(b.x, b.y).setY(toWorld(b.x, b.y).y - 0.015), w, d, a: -b.a + flip, delay: (b.x + (1 - b.y)) * 0.9 + hash(i + 7) * 0.25 };
  });

  const group = new THREE.Group();
  const meshes = {};
  for (const kind of Object.keys(VARIANTS)) {
    for (const tone of Object.keys(PALETTES)) {
      const list = items.filter((it) => it.kind === kind && it.tone === tone);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geos[kind], mats[tone], list.length);
      mesh.castShadow = mesh.receiveShadow = true;
      list.forEach((it, j) => (it.slot = [mesh, j]));
      meshes[kind + tone] = mesh;
      group.add(mesh);
    }
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  function update(rise) {
    for (const it of items) {
      const k = THREE.MathUtils.clamp((rise * 2.6 - it.delay) / 0.6, 0, 1);
      const e = Math.max(k === 1 ? 1 : 1 - Math.pow(1 - k, 3), 0.0001);
      q.setFromAxisAngle(up, it.a);
      // villas are ~15–20 m across; scale height with footprint so small lots don't look like towers
      const hs = THREE.MathUtils.clamp(Math.min(it.w, it.d) / 0.2, 0.75, 1.25);
      m.compose(it.p, q, sc.set(it.w, hs * e, it.d));
      it.slot[0].setMatrixAt(it.slot[1], m);
    }
    Object.values(meshes).forEach((mm) => (mm.instanceMatrix.needsUpdate = true));
  }
  update(0);
  return { group, update };
}

// Apartment blocks at the entrance (developer render research/images/renders/apartments-sustainable.jpg):
// nine storeys of rounded beige balcony bands around dark glazing, with a brown vertical accent and roof plant room.
function roundedSlab(w, d, r, h) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  return g;
}

export function makeApartments(spots, toWorld) {
  const FLOORS = 9;
  const FLOOR = 0.075; // storey height, exaggerated slightly like the villas so the blocks read at overview distance
  const W = 0.5, D = 0.34;
  const band = new THREE.MeshStandardMaterial({ color: '#c7ab88', roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: '#3b4248', roughness: 0.25, metalness: 0.3 });
  const brown = new THREE.MeshStandardMaterial({ color: '#6e4b33', roughness: 0.8 });

  const parts = { band: [], glass: [], brown: [] };
  for (let f = 0; f < FLOORS; f++) {
    const y = f * FLOOR;
    // balcony band swells slightly on alternate floors, like the wavy facade in the render
    const sw = f % 2 ? 0.03 : 0;
    parts.band.push(roundedSlab(W + 0.05 + sw, D + 0.05 + sw, 0.09, FLOOR * 0.16).translate(0, y + FLOOR * 0.84, 0));
  }
  parts.glass.push(new THREE.BoxGeometry(W - 0.04, FLOORS * FLOOR, D - 0.04).translate(0, (FLOORS * FLOOR) / 2, 0));
  parts.brown.push(new THREE.BoxGeometry(0.1, FLOORS * FLOOR + 0.02, D + 0.07).translate(W * 0.16, (FLOORS * FLOOR) / 2, 0));
  parts.band.push(roundedSlab(W + 0.04, D + 0.04, 0.1, 0.012).translate(0, FLOORS * FLOOR, 0));
  parts.brown.push(new THREE.BoxGeometry(0.2, 0.06, 0.14).translate(-0.08, FLOORS * FLOOR + 0.03, 0));
  const geo = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, mergeGeometries(v)]));

  const group = new THREE.Group();
  const towers = spots.map(([u, v, rot]) => {
    const t = new THREE.Group();
    for (const [k, mat] of [['band', band], ['glass', glass], ['brown', brown]]) {
      const m = new THREE.Mesh(geo[k], mat);
      m.castShadow = m.receiveShadow = true;
      t.add(m);
    }
    t.position.copy(toWorld(u, v)).y -= 0.02;
    t.rotation.y = rot;
    t.scale.y = 0.001;
    group.add(t);
    return t;
  });
  return {
    group,
    update(rise) {
      const k = THREE.MathUtils.clamp((rise - 0.15) / 0.6, 0, 1);
      const e = Math.max(1 - Math.pow(1 - k, 3), 0.001);
      towers.forEach((t) => (t.scale.y = e));
    },
  };
}
