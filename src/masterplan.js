import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import buildings from './buildings.json';
import trees from './trees.json';
import { PLACES } from './data.js';
import { makeVillas, makeApartments } from './villas.js';

gsap.registerPlugin(ScrollTrigger);

const S = 20; // plan width in world units
const MIST = new THREE.Color('#e7e8d6');
const SKY = new THREE.Color('#cddbe4');
const OVERVIEW_WIDE = { pos: new THREE.Vector3(12.6, 16.5, 13.4), target: new THREE.Vector3(2.0, 0.6, -0.5) };
// portrait screens look up the valley from behind the gate so the village runs top-to-bottom
const OVERVIEW_TALL = { pos: new THREE.Vector3(-10.5, 19, 15.5), target: new THREE.Vector3(1.2, 0.6, -1.6) };
const TOP_DOWN = new THREE.Vector3(0.01, 27, 0.6);

// The plan draws a valley running SW (gate) → NE (Japanese garden); lift the slopes around it.
const AXIS_A = new THREE.Vector2(0.2, 0.9);
const AXIS_B = new THREE.Vector2(0.82, 0.12);
const AXIS = AXIS_B.clone().sub(AXIS_A);
const AXIS_LEN = AXIS.length();
AXIS.normalize();
const acrossAxis = (u, v) => (u - AXIS_A.x) * -AXIS.y + (v - AXIS_A.y) * AXIS.x;
function groundHeight(u, v) {
  const rx = u - AXIS_A.x;
  const ry = v - AXIS_A.y;
  const along = THREE.MathUtils.clamp((rx * AXIS.x + ry * AXIS.y) / AXIS_LEN, -0.3, 1.3);
  const across = Math.abs(acrossAxis(u, v));
  const slopes = THREE.MathUtils.smoothstep(across, 0.13, 0.55) * 2.4;
  const ripple = Math.sin(u * 23 + v * 7) * Math.cos(v * 19 - u * 5) * 0.06 * (0.3 + slopes);
  return slopes + along * 0.7 + ripple;
}
const toWorld = (u, v) => new THREE.Vector3((u - 0.5) * S, groundHeight(u, v), (v - 0.5) * S);

const hash = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
// cheap value noise for forest density
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a, b) => hash(a * 57 + b * 131);
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(xi, yi), h(xi + 1, yi), sx), THREE.MathUtils.lerp(h(xi, yi + 1), h(xi + 1, yi + 1), sx), sy);
}

function makeGround(planTex, realTex) {
  const geo = new THREE.PlaneGeometry(S * 2.2, S * 2.2, 400, 400);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / S + 0.5;
    const v = pos.getZ(i) / S + 0.5;
    pos.setY(i, groundHeight(u, v));
    uv.setXY(i, u, 1 - v);
  }
  geo.computeVertexNormals();
  for (const t of [planTex, realTex]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const uniforms = { uReal: { value: 0 }, uReal2: { value: realTex } };
  const mat = new THREE.MeshStandardMaterial({ map: planTex, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uReal;
         uniform sampler2D uReal2;
         float mgHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
         float mgNoise(vec2 p){
           vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
           return mix(mix(mgHash(i), mgHash(i + vec2(1, 0)), u.x), mix(mgHash(i + vec2(0, 1)), mgHash(i + vec2(1, 1)), u.x), u.y);
         }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         vec2 e2 = smoothstep(vec2(0.0), vec2(0.07), vMapUv) * smoothstep(vec2(1.0), vec2(0.93), vMapUv);
         float inside = e2.x * e2.y;
         // painted plan, fading into mist outside the drawing
         vec3 planCol = mix(vec3(0.86, 0.87, 0.78), diffuseColor.rgb, inside);
         // realistic aerial: traced roads + grass, with procedural meadow beyond the drawing
         vec3 realCol = texture2D(uReal2, vMapUv).rgb;
         float n1 = mgNoise(vMapUv * 9.0), n2 = mgNoise(vMapUv * 60.0), n3 = mgNoise(vMapUv * 420.0);
         vec3 meadow = mix(vec3(0.10, 0.20, 0.045), vec3(0.22, 0.31, 0.08), n1 * 0.7 + n2 * 0.3);
         realCol = mix(meadow, realCol, inside);
         realCol *= 0.88 + 0.24 * n3;
         diffuseColor.rgb = mix(planCol, realCol, uReal);`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return { mesh, uniforms };
}

// layered spruce/larch and rounded birch, trunk via vertex colours so instance colour only tints foliage
function treeGeometries() {
  const paint = (src, c) => {
    const g = src.index ? src.toNonIndexed() : src; // icosahedron is non-indexed; merge needs all alike
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set(c, i);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const trunkC = [0.32, 0.22, 0.15];
  const trunk = () => paint(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 5).translate(0, 0.15, 0), trunkC);
  const tiers = [0.5, 0.38, 0.26].map((r, i) => paint(new THREE.ConeGeometry(r, 0.5, 7).translate(0, 0.42 + i * 0.25, 0), [1, 1, 1]));
  const conifer = mergeGeometries([trunk(), ...tiers]);
  const crown = paint(new THREE.IcosahedronGeometry(0.42, 1).scale(1, 1.15, 1).translate(0, 0.62, 0), [1, 1, 1]);
  const round = mergeGeometries([trunk(), crown]);
  return { conifer, round };
}

function makeTrees() {
  const { conifer, round } = treeGeometries();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, vertexColors: true });
  const items = [];
  // trees painted on the plan
  trees.forEach((t, i) => {
    const [u, v] = t;
    items.push({ u, v, kind: hash(i) < 0.55 ? 'c' : 'r', size: 0.75 + hash(i + 5) * 0.55, forest: false });
  });
  // the surrounding taiga: dense on the north-west slope, scattered on the sunny south-east slope
  for (let i = 0; i < 9000; i++) {
    const u = -0.55 + hash(i * 3 + 1) * 2.1;
    const v = -0.55 + hash(i * 3 + 2) * 2.1;
    const ac = acrossAxis(u, v);
    if (Math.abs(ac) < 0.2 && u > 0.05 && u < 0.95 && v > 0.05 && v < 0.98) continue; // keep the village clear
    const density = (ac < 0 ? 0.92 : 0.05) * THREE.MathUtils.smoothstep(vnoise(u * 7, v * 7), 0.3, 0.7);
    if (hash(i * 3 + 3) > density) continue;
    items.push({ u, v, kind: hash(i + 11) < 0.8 ? 'c' : 'r', size: 0.8 + hash(i + 17) * 0.6, forest: true });
  }
  const meshes = {};
  for (const [kind, geo] of [
    ['c', conifer],
    ['r', round],
  ]) {
    const list = items.filter((it) => it.kind === kind);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((it, j) => {
      it.mesh = mesh;
      it.j = j;
      it.p = toWorld(it.u, it.v);
      it.rot = hash(j + 3) * Math.PI * 2;
      it.delay = it.forest ? 0.2 + hash(j) * 0.8 : hash(j + 1);
      const tint = kind === 'c'
        ? new THREE.Color().setHSL(0.3 + hash(j) * 0.05, 0.42, 0.075 + hash(j + 2) * 0.045)
        : new THREE.Color().setHSL(0.22 + hash(j) * 0.05, 0.45, 0.14 + hash(j + 2) * 0.06);
      mesh.setColorAt(j, tint);
    });
    meshes[kind] = mesh;
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  // surrounding forest only grows in the realistic view; the painted plan floats in mist
  function update(rise, real) {
    for (const it of items) {
      const k = THREE.MathUtils.clamp((rise * 2 - it.delay) / 0.8, 0, 1);
      const e = Math.max((1 - Math.pow(1 - k, 3)) * (it.forest ? real : 1), 0.0001);
      const s = it.size * (it.kind === 'c' ? 0.18 : 0.15);
      q.setFromAxisAngle(up, it.rot);
      m.compose(it.p, q, sc.set(s, s * e, s));
      it.mesh.setMatrixAt(it.j, m);
    }
    Object.values(meshes).forEach((mm) => (mm.instanceMatrix.needsUpdate = true));
  }
  update(0, 0);
  return { group: new THREE.Group().add(...Object.values(meshes)), update };
}

export async function initMasterplan({ stage, canvas, hotspotLayer, legend, panel }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = MIST.clone();
  scene.fog = new THREE.Fog(MIST.clone(), 24, 56);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.copy(TOP_DOWN);

  const loader = new THREE.TextureLoader();
  const [planTex, realTex] = await Promise.all([loader.loadAsync('/assets/masterplan.jpg'), loader.loadAsync('/assets/ground-real.jpg')]);
  for (const t of [planTex, realTex]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  }
  const ground = makeGround(planTex, realTex);
  scene.add(ground.mesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const clubSpots = PLACES.filter((p) => p.id === 'clubhouse' || p.id === 'sport-complex').map((p) => [p.x, p.y]);
  // apartment blocks beside the entrance road replace the plan's villa footprints there
  const towerSpots = [
    [0.252, 0.962, -0.75],
    [0.29, 0.978, -0.6],
  ];
  const freeLots = buildings.filter((b) => towerSpots.every(([u, v]) => Math.hypot(b.x - u, b.y - v) > 0.03));
  const villas = makeVillas(freeLots, toWorld, S, clubSpots);
  const apartments = makeApartments(towerSpots, toWorld);
  scene.add(apartments.group);
  const forest = makeTrees();
  scene.add(villas.group, forest.group);

  scene.add(new THREE.HemisphereLight('#fffaf0', '#a7a58a', 1.5));
  const sun = new THREE.DirectionalLight('#fff0d8', 2.6);
  sun.position.set(-9, 14, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enableZoom = false; // the wheel scrolls the page; zoom via buttons or ctrl+wheel
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.22;
  controls.minDistance = 2.2;
  controls.maxDistance = 30;
  controls.screenSpacePanning = false;
  controls.target.set(0, 0, 0);
  controls.enabled = false;
  controls.addEventListener('change', () => {
    controls.target.x = THREE.MathUtils.clamp(controls.target.x, -S / 2, S / 2);
    controls.target.z = THREE.MathUtils.clamp(controls.target.z, -S / 2, S / 2);
  });

  // ---- hotspots + legend ----
  const spots = PLACES.map((pl, i) => {
    const anchor = toWorld(pl.x, pl.y).add(new THREE.Vector3(0, 0.35, 0));
    const el = document.createElement('button');
    el.className = 'hotspot';
    el.innerHTML = `<span class="hotspot__dot">${i + 1}</span><span class="hotspot__label">${pl.title}</span>`;
    el.addEventListener('click', () => focus(i));
    hotspotLayer.appendChild(el);
    const li = document.createElement('li');
    li.innerHTML = `<button><span>${String(i + 1).padStart(2, '0')}</span>${pl.title}</button>`;
    li.firstChild.addEventListener('click', () => focus(i));
    legend.appendChild(li);
    return { ...pl, anchor, el, legendBtn: li.firstChild };
  });

  let active = -1;
  const overview = () => (stage.clientWidth / stage.clientHeight < 0.8 ? OVERVIEW_TALL : OVERVIEW_WIDE);
  function flyTo(pos, target, duration = 1.8) {
    gsap.to(camera.position, { ...pos, duration, ease: 'power3.inOut', overwrite: true });
    gsap.to(controls.target, { ...target, duration, ease: 'power3.inOut', overwrite: true });
  }
  function focus(i) {
    active = i;
    const s = spots[i];
    spots.forEach((o, j) => {
      o.el.classList.toggle('is-active', j === i);
      o.legendBtn.classList.toggle('is-active', j === i);
    });
    const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
    const pos = s.anchor.clone().addScaledVector(dir, 3.4).setY(s.anchor.y + 2.8);
    flyTo({ x: pos.x, y: pos.y, z: pos.z }, { x: s.anchor.x, y: s.anchor.y - 0.3, z: s.anchor.z });
    panel.index.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(spots.length).padStart(2, '0');
    panel.title.textContent = s.title;
    panel.text.textContent = s.text;
    panel.link.hidden = !s.link;
    if (s.link) {
      panel.link.href = s.link.href;
      panel.link.textContent = s.link.label;
    }
    panel.img.hidden = !s.img;
    if (s.img) panel.img.src = s.img;
    panel.root.classList.add('is-open');
  }
  function reset() {
    active = -1;
    spots.forEach((o) => {
      o.el.classList.remove('is-active');
      o.legendBtn.classList.remove('is-active');
    });
    panel.root.classList.remove('is-open');
    flyTo(overview().pos, overview().target);
  }
  panel.close.addEventListener('click', reset);
  document.getElementById('planReset').addEventListener('click', reset);

  function zoom(f) {
    const off = camera.position.clone().sub(controls.target);
    const len = THREE.MathUtils.clamp(off.length() * f, controls.minDistance, controls.maxDistance);
    const p = controls.target.clone().add(off.setLength(len));
    gsap.to(camera.position, { x: p.x, y: p.y, z: p.z, duration: 0.7, ease: 'power2.out', overwrite: true });
  }
  document.getElementById('zoomIn').addEventListener('click', () => zoom(0.7));
  document.getElementById('zoomOut').addEventListener('click', () => zoom(1.4));
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.12 : 0.89);
    },
    { passive: false },
  );

  // touch screens: don't hijack page scroll until the visitor opts in
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const activateBtn = document.getElementById('planActivate');
  let touchEnabled = !coarse;
  activateBtn.addEventListener('click', () => {
    touchEnabled = !touchEnabled;
    stage.classList.toggle('is-interactive', touchEnabled);
    activateBtn.textContent = touchEnabled ? 'Гүйлгэх горим' : 'Хүрч удирдах';
    controls.enabled = touchEnabled;
    canvas.style.touchAction = touchEnabled ? 'none' : 'pan-y';
  });
  if (coarse) canvas.style.touchAction = 'pan-y';

  // ---- intro: the flat plan lifts into 3D as the section arrives ----
  // ---- view mode: painted master plan ↔ realistic aerial ----
  const intro = { rise: 0, real: 0 };
  const modeBtns = document.querySelectorAll('[data-mode]');
  function setMode(mode, duration = 1.6) {
    modeBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
    gsap.to(intro, { real: mode === 'real' ? 1 : 0, duration, ease: 'power2.inOut', overwrite: true });
  }
  modeBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  ScrollTrigger.create({
    trigger: stage,
    start: 'top 65%',
    once: true,
    onEnter: () => {
      const tl = gsap.timeline({ onComplete: () => (controls.enabled = touchEnabled) });
      tl.to(intro, { rise: 1, duration: 3.2, ease: 'power2.out' }, 0.3);
      tl.to(camera.position, { ...overview().pos, duration: 3.4, ease: 'power3.inOut' }, 0);
      tl.to(controls.target, { ...overview().target, duration: 3.4, ease: 'power3.inOut' }, 0);
    },
  });

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 55 : 38;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let visible = false;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '200px' }).observe(stage);

  const v = new THREE.Vector3();
  let lastRise = -1;
  let lastReal = -1;
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    if (intro.rise !== lastRise || intro.real !== lastReal) {
      villas.update(intro.rise);
      apartments.update(intro.rise);
      forest.update(intro.rise, intro.real);
      ground.uniforms.uReal.value = intro.real;
      scene.background.lerpColors(MIST, SKY, intro.real);
      scene.fog.color.copy(scene.background);
      lastRise = intro.rise;
      lastReal = intro.real;
    }
    controls.update();
    renderer.render(scene, camera);

    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const showSpots = intro.rise > 0.6;
    for (const s of spots) {
      v.copy(s.anchor).project(camera);
      const hidden = !showSpots || v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      s.el.classList.toggle('is-hidden', hidden);
      if (!hidden) s.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w - 13}px, ${(-v.y * 0.5 + 0.5) * h - 13}px)`;
    }
  }
  frame();

  return { focus, reset, get active() { return active; } };
}
