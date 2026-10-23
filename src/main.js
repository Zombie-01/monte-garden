import './style.css';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { initHero } from './hero.js';
import { initMasterplan } from './masterplan.js';

gsap.registerPlugin(ScrollTrigger);
document.body.classList.add('is-loading');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lenis = new Lenis({ lerp: reduceMotion ? 1 : 0.085 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
lenis.stop();

document.querySelectorAll('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    lenis.scrollTo(a.getAttribute('href'), { duration: 2 });
  }),
);

const bar = document.getElementById('loaderBar');
let loaded = 0;
const progress = (p) => {
  loaded = Math.min(1, loaded + p);
  bar.style.width = `${loaded * 100}%`;
};

const heroP = initHero(document.getElementById('heroCanvas'), progress);
const planP = initMasterplan({
  stage: document.getElementById('planStage'),
  canvas: document.getElementById('planCanvas'),
  hotspotLayer: document.getElementById('planHotspots'),
  legend: document.getElementById('planLegend'),
  panel: {
    root: document.getElementById('planPanel'),
    index: document.getElementById('panelIndex'),
    title: document.getElementById('panelTitle'),
    text: document.getElementById('panelText'),
    img: document.getElementById('panelImg'),
    link: document.getElementById('panelLink'),
    close: document.getElementById('planClose'),
  },
}).then((r) => (progress(0.2), r));

const hero = await heroP;
await planP;
bar.style.width = '100%';

// ---- opening sequence ----
await new Promise((r) => setTimeout(r, 350));
document.getElementById('loader').classList.add('is-done');
document.body.classList.remove('is-loading');
const open = gsap.timeline({ onComplete: () => lenis.start() });
open
  .to(hero.state, { reveal: 1, duration: 3, ease: 'power2.inOut' }, 0)
  .to(hero.state, { form: 1, duration: 4.2, ease: 'power2.inOut' }, 0.6)
  .to('#heroCopy > *', { opacity: 1, y: 0, duration: 1.6, stagger: 0.18, ease: 'power3.out' }, 3)
  .to('#heroScroll', { opacity: 1, duration: 1 }, 4);

// ---- hero scroll: deer dissolves into embers, camera dives into the valley ----
ScrollTrigger.create({
  trigger: '.hero',
  start: 'top top',
  end: 'bottom bottom',
  scrub: true,
  onUpdate: (st) => hero.setScroll(st.progress),
});
gsap.to('#heroCopy', {
  opacity: 0,
  y: -60,
  ease: 'none',
  scrollTrigger: { trigger: '.hero', start: 'top top', end: '18% top', scrub: true },
});
gsap
  .timeline({ scrollTrigger: { trigger: '.hero', start: '45% top', end: 'bottom bottom', scrub: true } })
  .fromTo('#heroEnd', { opacity: 0, y: 40 }, { opacity: 1, y: 0, ease: 'power2.out', duration: 1 })
  .to('#heroEnd', { opacity: 0, y: -30, duration: 0.6 }, 1.4);
gsap.to('#heroScroll', {
  opacity: 0,
  scrollTrigger: { trigger: '.hero', start: 'top top', end: '6% top', scrub: true },
});

// ---- lifestyle gallery: vertical scroll drives a horizontal track ----
const track = document.getElementById('galleryTrack');
const galleryDistance = () => Math.max(0, track.scrollWidth - window.innerWidth);
gsap.to(track, {
  x: () => -galleryDistance(),
  ease: 'none',
  scrollTrigger: {
    trigger: '.gallery',
    start: 'top top',
    end: () => `+=${galleryDistance()}`,
    pin: '.gallery__pin',
    scrub: 0.6,
    invalidateOnRefresh: true,
  },
});
gsap.utils.toArray('.gcard img').forEach((img) =>
  gsap.fromTo(img, { xPercent: -6 }, { xPercent: 6, ease: 'none', scrollTrigger: { trigger: '.gallery', start: 'top top', end: () => `+=${galleryDistance()}`, scrub: true } }),
);

// ---- nature parallax ----
gsap.utils.toArray('.nature [data-speed]').forEach((el) =>
  gsap.fromTo(
    el,
    { yPercent: -100 * Number(el.dataset.speed) },
    { yPercent: 100 * Number(el.dataset.speed), ease: 'none', scrollTrigger: { trigger: '.nature', start: 'top bottom', end: 'bottom top', scrub: true } },
  ),
);

// ---- intro reveals + counters ----
gsap.utils.toArray('.reveal').forEach((el, i) =>
  gsap.to(el, {
    opacity: 1,
    y: 0,
    duration: 1.4,
    delay: (i % 4) * 0.08,
    ease: 'power3.out',
    scrollTrigger: { trigger: el, start: 'top 85%' },
  }),
);
document.querySelectorAll('[data-count]').forEach((el) => {
  const target = Number(el.dataset.count);
  const fmt = (n) => (el.dataset.format === 'space' ? Math.round(n).toLocaleString('en-US').replace(/,/g, ' ') : Math.round(n));
  const o = { n: 0 };
  gsap.to(o, {
    n: target,
    duration: 2.2,
    ease: 'power2.out',
    scrollTrigger: { trigger: el, start: 'top 85%' },
    onUpdate: () => (el.textContent = fmt(o.n)),
  });
});

ScrollTrigger.refresh();
