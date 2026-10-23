import { gsap } from 'gsap';
import { APARTMENTS } from './apartments.js';

// 2D floor-plan viewer: the developer's render (public/assets/plans/<id>.webp) with zoom / pan and clickable rooms.
const fmt = (n) => n.toFixed(2).replace(/\.?0+$/, '') + ' м²';

export function initRooms({ stage, viewport, plan, img, list, filters, legend, info, hotspotLayer }) {
  let current = null;
  let spots = [];
  const view = { x: 0, y: 0, s: 1 }; // translate in px, scale
  let base = 1; // scale that fits the plan in the viewport

  function apply(duration = 0) {
    gsap.to(plan, { x: view.x, y: view.y, scale: view.s, duration, ease: 'power3.out', overwrite: true });
    // keep markers a constant screen size
    gsap.to(hotspotLayer, { '--inv': 1 / view.s, duration, overwrite: true });
  }
  function clamp() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const pw = img.naturalWidth * view.s;
    const ph = img.naturalHeight * view.s;
    const mx = Math.max(0, (pw - vw) / 2 + 40);
    const my = Math.max(0, (ph - vh) / 2 + 40);
    view.x = Math.min(mx, Math.max(-mx, view.x));
    view.y = Math.min(my, Math.max(-my, view.y));
  }
  function fit(duration = 0.8) {
    if (!img.naturalWidth) return;
    base = Math.min(viewport.clientWidth / img.naturalWidth, viewport.clientHeight / img.naturalHeight) * 0.9;
    Object.assign(view, { x: 0, y: 0, s: base });
    apply(duration);
    setActive(-1);
  }
  function zoomAt(f, cx = 0, cy = 0, duration = 0.35) {
    const s = Math.min(base * 5, Math.max(base * 0.8, view.s * f));
    const k = s / view.s;
    view.x = cx - (cx - view.x) * k;
    view.y = cy - (cy - view.y) * k;
    view.s = s;
    clamp();
    apply(duration);
  }

  async function show(apt) {
    current = apt;
    list.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.id === apt.id));
    history.replaceState(null, '', `?plan=${apt.id}`);
    gsap.to(plan, { opacity: 0, duration: 0.2, overwrite: true });
    img.src = `/assets/plans/${apt.id}.webp`;
    await img.decode().catch(() => {});
    if (current !== apt) return;
    plan.style.width = `${img.naturalWidth}px`;
    plan.style.height = `${img.naturalHeight}px`;

    hotspotLayer.innerHTML = '';
    legend.innerHTML = '';
    spots = apt.list.map((r, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<button><span class="rooms__n">${r.n}</span><span class="rooms__name">${r.name}</span><span class="rooms__a">${fmt(r.area)}</span></button>`;
      const btn = li.firstChild;
      btn.addEventListener('click', () => focusRoom(i));
      btn.addEventListener('mouseenter', () => spots[i]?.classList.add('is-hover'));
      btn.addEventListener('mouseleave', () => spots[i]?.classList.remove('is-hover'));
      legend.appendChild(li);
      if (r.x == null) return null;
      const el = document.createElement('button');
      el.className = 'room-spot';
      el.style.left = `${r.x * 100}%`;
      el.style.top = `${r.y * 100}%`;
      el.innerHTML = `<span>${r.n}</span><em>${r.name}<b>${fmt(r.area)}</b></em>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        focusRoom(i);
      });
      el.addEventListener('mouseenter', () => btn.classList.add('is-hover'));
      el.addEventListener('mouseleave', () => btn.classList.remove('is-hover'));
      hotspotLayer.appendChild(el);
      return el;
    });
    info.title.textContent = `${apt.rooms} өрөө · ${apt.variant} загвар`;
    info.total.textContent = fmt(apt.total);
    info.count.textContent = `${apt.list.length} хэсэг`;

    fit(0);
    gsap.fromTo(plan, { opacity: 0 }, { opacity: 1, duration: 0.5, ease: 'power2.out' });
  }

  function setActive(i) {
    legend.querySelectorAll('button').forEach((b, j) => b.classList.toggle('is-active', j === i));
    spots.forEach((o, j) => o?.classList.toggle('is-active', j === i));
  }
  function focusRoom(i) {
    setActive(i);
    const r = current.list[i];
    if (r.x == null) return;
    // centre the room and zoom in proportionally to how small it is
    const s = Math.min(base * 3, base * Math.max(1.6, 5 / Math.sqrt(r.area)));
    view.s = s;
    view.x = -(r.x - 0.5) * img.naturalWidth * s;
    view.y = -(r.y - 0.5) * img.naturalHeight * s;
    clamp();
    apply(0.8);
  }

  // ---- pan / zoom input ----
  const pointers = new Map();
  let pinch = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.room-spot')) return;
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.classList.add('is-dragging');
  });
  viewport.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      p.x = e.clientX;
      p.y = e.clientY;
      const [a2, b2] = [...pointers.values()];
      const d2 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
      if (pinch && d) zoomAt(d2 / d, 0, 0, 0);
      pinch = d2;
      return;
    }
    view.x += e.clientX - p.x;
    view.y += e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    clamp();
    apply(0);
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    pinch = null;
    if (!pointers.size) viewport.classList.remove('is-dragging');
  };
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      zoomAt(e.deltaY > 0 ? 0.88 : 1.14, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    },
    { passive: false },
  );
  viewport.addEventListener('dblclick', (e) => {
    const r = viewport.getBoundingClientRect();
    zoomAt(1.8, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, 0.5);
  });

  const q = (k) => stage.querySelector(`[data-rooms="${k}"]`);
  q('fit').addEventListener('click', () => fit());
  q('in').addEventListener('click', () => zoomAt(1.4, 0, 0, 0.4));
  q('out').addEventListener('click', () => zoomAt(0.72, 0, 0, 0.4));
  new ResizeObserver(() => fit(0)).observe(viewport);

  // ---- list + filter ----
  const counts = [...new Set(APARTMENTS.map((a) => a.rooms))];
  let filter = 0;
  function renderList() {
    list.innerHTML = '';
    for (const a of APARTMENTS.filter((a) => !filter || a.rooms === filter)) {
      const b = document.createElement('button');
      b.dataset.id = a.id;
      b.className = current?.id === a.id ? 'is-active' : '';
      b.innerHTML = `<img src="/assets/plans/${a.id}.webp" alt="" loading="lazy" /><span><strong>${a.total.toFixed(2)}<small>м²</small></strong><em>${a.rooms} өрөө · ${a.variant} загвар</em></span>`;
      b.addEventListener('click', () => show(a));
      list.appendChild(b);
    }
  }
  filters.innerHTML = ['<button data-f="0" class="is-active">Бүгд</button>', ...counts.map((c) => `<button data-f="${c}">${c} өрөө</button>`)].join('');
  filters.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      filter = Number(b.dataset.f);
      filters.querySelectorAll('button').forEach((o) => o.classList.toggle('is-active', o === b));
      renderList();
      const first = APARTMENTS.find((a) => !filter || a.rooms === filter);
      if (first && filter && current?.rooms !== filter) show(first);
    }),
  );
  renderList();

  const want = new URLSearchParams(location.search).get('plan');
  show(APARTMENTS.find((a) => a.id === want) || APARTMENTS[0]);
  return { show };
}
