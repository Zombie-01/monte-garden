import * as THREE from 'three';

// Real elevation of the Bogd Khan Uul massif (~26 km square), see scripts/heightmap.py.
const SIZE = 40;
const RELIEF = 4.6;
const FOG = new THREE.Color('#203048');
const SUN = new THREE.Vector3(-0.72, 0.16, 0.68).normalize();

const NOISE = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function imageData(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

// Bilinear sampler over the full-resolution packed heightmap (R = coarse, G = fine byte).
function makeHeightField(img) {
  const W = img.width;
  const H = img.height;
  const d = imageData(img, W, H);
  const raw = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) raw[i] = (d[i * 4] * 256 + d[i * 4 + 1]) / 65535;
  // normalized (0..1) height at uv (v = 0 is the north edge)
  const at = (u, v) => {
    const x = THREE.MathUtils.clamp(u, 0, 1) * (W - 1);
    const y = THREE.MathUtils.clamp(v, 0, 1) * (H - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, H - 1);
    const fx = x - x0, fy = y - y0;
    const a = raw[y0 * W + x0] * (1 - fx) + raw[y0 * W + x1] * fx;
    const b = raw[y1 * W + x0] * (1 - fx) + raw[y1 * W + x1] * fx;
    return a * (1 - fy) + b * fy;
  };
  return { at, world: (x, z) => at(x / SIZE + 0.5, z / SIZE + 0.5) * RELIEF };
}

function makeTerrain(field) {
  const SEG = 511;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const hAttr = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const h = field.at(pos.getX(i) / SIZE + 0.5, pos.getZ(i) / SIZE + 0.5);
    hAttr[i] = h;
    pos.setY(i, h * RELIEF);
  }
  geo.setAttribute('aH', new THREE.BufferAttribute(hAttr, 1));
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: SUN },
      uFog: { value: FOG },
      uReveal: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aH;
      varying vec3 vPos;
      varying vec3 vN;
      varying float vH;
      void main(){
        vH = aH;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSun;
      uniform vec3 uFog;
      uniform float uReveal;
      varying vec3 vPos;
      varying vec3 vN;
      varying float vH;
      ${NOISE}
      void main(){
        vec3 n = normalize(vN);
        vec3 viewDir = normalize(cameraPosition - vPos);
        float diff = clamp(dot(n, uSun), 0.0, 1.0);
        float sky = n.y * 0.5 + 0.5;
        float rim = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 4.0);

        // taiga texture: dark larch/pine patches on the slopes of Bogd Khan
        float forest = smoothstep(0.35, 0.65, fbm(vPos.xz * 3.0)) * smoothstep(0.12, 0.35, vH);
        vec3 base = mix(vec3(0.07, 0.09, 0.12), vec3(0.16, 0.16, 0.17), smoothstep(0.1, 0.9, vH));
        base = mix(base, vec3(0.035, 0.06, 0.065), forest * 0.75);

        vec3 col = base * (0.45 + 0.55 * sky);
        col += vec3(1.0, 0.68, 0.36) * pow(diff, 1.3) * 0.75 * (1.0 - forest * 0.5);
        col += vec3(1.0, 0.8, 0.52) * rim * (0.15 + diff) * 0.45;

        // golden contour lines every ~35 m of real elevation
        float lines = vH * 28.0;
        float w = fwidth(lines);
        float line = 1.0 - smoothstep(0.0, w * 1.5, abs(fract(lines - 0.5) - 0.5));
        float dist = length(vPos - cameraPosition);
        float sweep = smoothstep(uReveal * 30.0 - 4.0, uReveal * 30.0, 30.0 - length(vPos.xz));
        col += vec3(0.86, 0.68, 0.42) * line * 0.42 * smoothstep(30.0, 3.0, dist) * (0.3 + 0.7 * sweep);

        col *= 1.3;

        // distance fog, drifting valley mist, and a soft fade at the edge of the data
        float fogD = 1.0 - exp(-dist * 0.055);
        float mistN = fbm(vPos.xz * 0.35 + vec2(uTime * 0.025, uTime * 0.012));
        float mist = smoothstep(0.38, 0.02, vH) * smoothstep(0.2, 0.75, mistN);
        float glow = pow(max(dot(-viewDir, uSun), 0.0), 3.0);
        vec3 mistCol = uFog + vec3(0.3, 0.2, 0.1) * glow;
        float edge = smoothstep(${(SIZE / 2 - 7).toFixed(1)}, ${(SIZE / 2 - 0.5).toFixed(1)}, max(abs(vPos.x), abs(vPos.z)));
        col = mix(col, mistCol, clamp(fogD * 0.85 + mist * 0.7 + edge, 0.0, 1.0));

        col *= uReveal;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

function makeSky() {
  const geo = new THREE.SphereGeometry(90, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: SUN }, uFog: { value: FOG }, uReveal: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform vec3 uFog; uniform float uReveal; uniform float uTime;
      varying vec3 vDir;
      ${NOISE}
      void main(){
        float h = vDir.y;
        vec3 top = vec3(0.025, 0.05, 0.09);
        vec3 col = mix(uFog, top, smoothstep(-0.02, 0.45, h));
        float s = max(dot(vDir, uSun), 0.0);
        col += vec3(0.95, 0.6, 0.3) * pow(s, 4.0) * 0.5 * smoothstep(0.35, -0.05, h);
        col += vec3(1.0, 0.85, 0.6) * pow(s, 90.0) * 0.6;
        // thin high clouds catching the last light
        float c = fbm(vDir.xz / max(h + 0.15, 0.05) * 1.4 + uTime * 0.004);
        col += vec3(0.6, 0.42, 0.28) * smoothstep(0.55, 0.85, c) * smoothstep(0.02, 0.2, h) * 0.18 * (0.3 + s);
        // stars
        vec2 g = floor(vDir.xz / (h + 1.0) * 220.0);
        float star = step(0.9975, hash(g)) * smoothstep(0.25, 0.7, h);
        col += star * 0.7 * (0.6 + 0.4 * sin(uTime * 2.0 + hash(g) * 50.0));
        gl_FragColor = vec4(col * uReveal, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

function makeDust() {
  const count = 900;
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * SIZE * 0.8;
    pos[i * 3 + 1] = Math.random() * 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * SIZE * 0.8;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPR: { value: 1 }, uReveal: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uPR; varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.04 + aSeed * 0.06), 5.0) + 0.6;
        p.x += sin(uTime * 0.3 + aSeed * 20.0) * 0.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.0 + aSeed * 2.0) * uPR * (8.0 / -mv.z);
        vA = (0.25 + 0.75 * sin(uTime * 1.5 + aSeed * 40.0) * 0.5 + 0.5) * smoothstep(30.0, 4.0, -mv.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uReveal; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.8, 0.5), smoothstep(0.5, 0.0, d) * vA * 0.5 * uReveal); }
    `,
  });
  return new THREE.Points(geo, mat);
}

// Gold particles that assemble into the Monte Garden deer, sampled from the brand logo.
function makeDeer(logoImg) {
  const N = 360;
  const d = imageData(logoImg, N, N);
  const candidates = [];
  for (let y = 0; y < N * 0.66; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      if (d[i] > 110 && d[i] - d[i + 2] > 45) candidates.push(x, y);
    }
  }
  const count = 11000;
  const target = new Float32Array(count * 3);
  const start = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const scale = 7.2;
  for (let i = 0; i < count; i++) {
    const k = Math.floor(Math.random() * (candidates.length / 2)) * 2;
    const px = candidates[k] + Math.random() - 0.5;
    const py = candidates[k + 1] + Math.random() - 0.5;
    target[i * 3] = (px / N - 0.507) * scale;
    target[i * 3 + 1] = -(py / N - 0.458) * scale + 0.75;
    target[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
    const r = 6 + Math.random() * 10;
    const a = Math.random() * Math.PI * 2;
    start[i * 3] = Math.cos(a) * r;
    start[i * 3 + 1] = (Math.random() - 0.3) * 8;
    start[i * 3 + 2] = Math.sin(a) * r * 0.5 - 4;
    seed[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(target, 3));
  geo.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uForm: { value: 0 },
      uDisperse: { value: 0 },
      uTime: { value: 0 },
      uPR: { value: 1 },
      uMouse: { value: new THREE.Vector2() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aStart; attribute float aSeed;
      uniform float uForm, uDisperse, uTime, uPR; uniform vec2 uMouse;
      varying float vA; varying float vSeed;
      void main(){
        float t = smoothstep(aSeed * 0.5, aSeed * 0.5 + 0.5, uForm);
        float e = 1.0 - pow(1.0 - t, 3.0);
        vec3 p = mix(aStart, position, e);
        // swirl in
        float ang = (1.0 - e) * 2.5 * (aSeed - 0.5);
        p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p.xz;
        // breathing shimmer once formed
        p += vec3(sin(uTime * 1.3 + aSeed * 40.0), cos(uTime * 1.1 + aSeed * 31.0), sin(uTime + aSeed * 9.0)) * 0.012 * e;
        // mouse repel
        vec2 m = uMouse * vec2(4.5, 2.8);
        vec2 dm = p.xy - m;
        p.xy += normalize(dm + 1e-4) * 0.35 * exp(-dot(dm, dm) * 2.0) * e;
        // disperse into embers rising over the valley
        float dsp = uDisperse * uDisperse;
        p += vec3((aSeed - 0.5) * 6.0, 1.0 + fract(aSeed * 7.3) * 4.0, 2.0 + fract(aSeed * 3.1) * 6.0) * dsp;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.4 + 2.4 * fract(aSeed * 13.7)) * uPR * (10.0 / -mv.z);
        vA = e * (1.0 - uDisperse) * (0.55 + 0.45 * sin(uTime * 2.2 + aSeed * 60.0));
        vSeed = aSeed;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vSeed;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        vec3 c = mix(vec3(0.82, 0.6, 0.32), vec3(1.0, 0.9, 0.7), fract(vSeed * 5.0));
        gl_FragColor = vec4(c, smoothstep(0.5, 0.0, d) * vA);
      }
    `,
  });
  return new THREE.Points(geo, mat);
}

export async function initHero(canvas, onProgress = () => {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const pr = Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(pr);
  renderer.autoClear = false;

  const heightImgP = loadImage('/assets/terrain.png').then((i) => (onProgress(0.5), i));
  const logoP = loadImage('/assets/logo.png').then((i) => (onProgress(0.3), i));
  const [heightImg, logoImg] = await Promise.all([heightImgP, logoP]);
  const field = makeHeightField(heightImg);

  // world
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  const terrain = makeTerrain(field);
  const sky = makeSky();
  const dust = makeDust();
  scene.add(sky, terrain, dust);

  // overlay (deer stays framed while the world camera flies)
  const overlay = new THREE.Scene();
  const ocam = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  ocam.position.set(0, 0, 10);
  const deer = makeDeer(logoImg);
  overlay.add(deer);

  // camera flight: from above the Tuul valley, south across the ridges, down into an eastern side valley
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1, 8.8, -16),
    new THREE.Vector3(-1.6, 6.6, -8.5),
    new THREE.Vector3(-2.2, 4.6, -2),
    new THREE.Vector3(-2.7, 3.15, 2.8),
  ]);
  const look = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-4, 2.4, 9),
    new THREE.Vector3(-4.5, 2.4, 9),
    new THREE.Vector3(-5.5, 2.8, 10),
    new THREE.Vector3(-6.4, 3.3, 11),
  ]);

  const state = { scroll: 0, form: 0, reveal: 0, mouse: new THREE.Vector2(), mouseS: new THREE.Vector2() };
  const tmpP = new THREE.Vector3();
  const tmpL = new THREE.Vector3();

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = ocam.aspect = w / h;
    // keep the deer readable on portrait screens
    ocam.fov = w / h < 0.8 ? 52 : 35;
    camera.updateProjectionMatrix();
    ocam.updateProjectionMatrix();
    deer.material.uniforms.uPR.value = pr * Math.min(1.2, h / 900);
    dust.material.uniforms.uPR.value = pr;
  }
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => {
    state.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  });

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);

  const t0 = performance.now();
  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    const t = (performance.now() - t0) / 1000;
    state.mouseS.lerp(state.mouse, 0.05);

    const p = THREE.MathUtils.smoothstep(state.scroll, 0, 1);
    path.getPoint(p, tmpP);
    look.getPoint(p, tmpL);
    tmpP.x += state.mouseS.x * 0.6;
    tmpP.y += state.mouseS.y * 0.3;
    tmpP.y = Math.max(tmpP.y, field.world(tmpP.x, tmpP.z) + 0.6);
    camera.position.copy(tmpP);
    camera.lookAt(tmpL);
    sky.position.copy(camera.position);

    for (const m of [terrain.material, sky.material, dust.material]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uReveal.value = state.reveal;
    }
    const du = deer.material.uniforms;
    du.uTime.value = t;
    du.uForm.value = state.form;
    du.uDisperse.value = THREE.MathUtils.smoothstep(state.scroll, 0.02, 0.38);
    du.uMouse.value.copy(state.mouseS);
    deer.rotation.y = state.mouseS.x * 0.25;
    deer.rotation.x = -state.mouseS.y * 0.12;

    renderer.clear();
    renderer.render(scene, camera);
    if (du.uDisperse.value < 1) {
      renderer.clearDepth();
      renderer.render(overlay, ocam);
    }
  }
  frame();

  return {
    state,
    setScroll(v) {
      state.scroll = v;
    },
  };
}
