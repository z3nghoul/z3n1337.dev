import { prefersReducedMotion } from './config.js';
import { debugToggle, debugLine } from './debug.js';
import { setSplash, splashEl, spendSplash } from './splashes.js';
import { hash } from './pixelfx.js';

// easter eggs. Clicking the splash gives a riddle, solving it turns on an effect in the sky (see bg.js)
const EGGS = {
  shower:   { label: 'meteor shower',     text: 'if only i could CATCH a star~' },
  darkmoon: { label: 'dark moon',         text: 'the moon is magnificent... i want to TOUCH it...' },
  aurora:   { label: 'northern lights',   text: 'he-he KONAMI... what a silly word~' },
  milky:    { label: 'milky way',         text: 'if you stand STILL long enough... the cosmos reveals itself~' },
};
const KEYS = Object.keys(EGGS);

// STAR_COOLDOWN: delay between shooting stars. IDLE_MS: how long you must stay still for the milky way
const STAR_COOLDOWN = 6000;
const IDLE_MS = 10000;
const REVERT_MS = 900;

// the classic: up up down down left right left right B A
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

const FADE_OUT = 550, FADE_IN = 800;

const hint = document.getElementById('egg-hint');
let offered = null;
let activeKey = null;
let revertTimer = 0;
let used = false;
let busy = false;

const setEgg = (key, on) => window.dispatchEvent(new CustomEvent('egg:set', { detail: { key, on } }));

function placeHint() {
  const s = splashEl();
  if (!hint || !s || hint.hidden) return;
  const box = hint.offsetParent.getBoundingClientRect();
  const r = s.getBoundingClientRect();
  const z = hint.offsetParent.currentCSSZoom || 1;
  hint.style.left = `${(r.left - box.left + r.width * 0.42) / z - 2.4}px`;
  hint.style.top = `${(r.top - box.top) / z - 35}px`;
}

const noise = hint?.querySelector('feTurbulence');
let boilTimer = 0;
let hintGone = false;

function showHint() {
  if (!hint || hintGone) return;
  clearInterval(boilTimer);
  hint.hidden = false;
  placeHint();
  if (prefersReducedMotion.matches || !noise) return;
  let n = 0;
  boilTimer = setInterval(() => noise.setAttribute('seed', String(1 + (n++ * 5) % 13)), 125);
}

function dismissHint() {
  if (!hint || hintGone) return;
  hintGone = true;
  hint.style.opacity = '0';
  setTimeout(() => { clearInterval(boilTimer); hint.hidden = true; }, 320);
}

document.fonts?.load("30px 'Pangolin'");

// overlay for the shooting stars and the moon hitbox
const layer = document.createElement('div');
layer.className = 'egg-layer';
layer.setAttribute('aria-hidden', 'true');
document.body.append(layer);

const ART = window.matchMedia('(max-width: 600px)').matches ? 3 : 5;
// ordered dithering matrix for the stars, it gives the pixel-art look
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SEGS = 16;
const COARSE = window.matchMedia('(pointer: coarse)');
// bigger hitbox for fingers
const starR = () => (COARSE.matches ? 32 : 16);
let sky = null, skyCtx = null, skyImg = null, skyW = 0, skyH = 0, skyRaf = 0;
const stars = [];
let starTimer = 0, starFirst = 0;
let goneAt = -1e9;

function sizeSky() {
  if (!sky) return;
  skyW = Math.ceil(window.innerWidth / ART);

  const foot = document.querySelector('.footer')?.getBoundingClientRect().top ?? window.innerHeight;
  skyH = Math.max(4, Math.floor(Math.min(foot, window.innerHeight) / ART));
  sky.width = skyW; sky.height = skyH;
  sky.style.width = `${skyW * ART}px`; sky.style.height = `${skyH * ART}px`;
  skyImg = skyCtx.createImageData(skyW, skyH);
}

const starPos = (st, t) => [
  st.x0 + st.vx * t + 0.5 * st.ax * t * t + 0.5,
  st.y0 + st.vy * t + 0.5 * st.ay * t * t + 0.5,
];

function drawStar(d, st, now) {
  const age = (now - st.t0) / 1000;
  const cage = st.caught ? (now - st.caught) / 1000 : 0;
  const fade = st.caught ? Math.max(0, 1 - cage / 0.32) : Math.min(1, age * 2.5);
  if (fade <= 0) return false;
  const head = starPos(st, age);
  const sc = st.scale * (1 + cage * 6);
  const speed = Math.hypot(st.vx + st.ax * age, st.vy + st.ay * age) || 1;
  const tailLen = 84 * st.scale * (st.caught ? Math.max(0, 1 - cage / 0.2) : 1);
  const tailT = Math.min(tailLen / speed, age);
  const P = [];
  for (let k = 0; k <= SEGS; k++) P.push(starPos(st, age - tailT * k / SEGS));

  const pad = 12 * sc + 2;
  let x0 = head[0] - pad, x1 = head[0] + pad, y0 = head[1] - pad, y1 = head[1] + pad;
  for (const p of P) { x0 = Math.min(x0, p[0] - 3); x1 = Math.max(x1, p[0] + 3); y0 = Math.min(y0, p[1] - 3); y1 = Math.max(y1, p[1] + 3); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(skyW - 1, Math.ceil(x1)); y1 = Math.min(skyH - 1, Math.ceil(y1));

  const shimmer = 0.5 + 0.5 * Math.sin(age * 20);
  const hs = sc * 1.5;
  for (let iy = y0; iy <= y1; iy++) {
    for (let ix = x0; ix <= x1; ix++) {
      const qx = ix + 0.5, qy = iy + 0.5;
      let R = 0, G = 0, B = 0, A = 0;
      const over = (cr, cg, cb, ca) => {
        if (ca <= 0) return;
        const oa = ca + A * (1 - ca);
        R = (cr * ca + R * A * (1 - ca)) / oa; G = (cg * ca + G * A * (1 - ca)) / oa; B = (cb * ca + B * A * (1 - ca)) / oa;
        A = oa;
      };

      const rx = (qx - head[0]) / hs, ry = (qy - head[1]) / hs;
      const rr = rx * rx + ry * ry;
      let hg = Math.exp(-rr / 7) * 0.55 * fade;
      hg = Math.floor(hg * 6 + BAYER[(iy & 3) * 4 + (ix & 3)] / 16) / 6;
      over(0.42, 0.6, 0.98, hg);

      let best = 1e9, bestF = 0;
      for (let k = 0; k < SEGS; k++) {
        const ax = P[k][0], ay = P[k][1], bx = P[k + 1][0] - ax, by = P[k + 1][1] - ay;
        const h = Math.max(0, Math.min(1, ((qx - ax) * bx + (qy - ay) * by) / Math.max(bx * bx + by * by, 1e-4)));
        const dd = Math.hypot(qx - ax - bx * h, qy - ay - by * h);
        if (dd < best) { best = dd; bestF = (k + h) / SEGS; }
      }
      const side = best / st.scale;
      if (tailT > 0 && bestF < 1) {
        const f = bestF;

        const hw = 0.45 + Math.round(0.9 * (1 - f) ** 1.15 * 2) / 2;
        let tc, cc, ta;
        if (f < 0.07)      { tc = [0.80, 0.90, 1.00]; cc = [1, 1, 1];          ta = 1.0;  }
        else if (f < 0.20) { tc = [0.66, 0.82, 1.00]; cc = [0.92, 0.96, 1];    ta = 1.0;  }
        else if (f < 0.36) { tc = [0.54, 0.71, 0.98]; cc = [0.82, 0.92, 1];    ta = 0.95; }
        else if (f < 0.54) { tc = [0.44, 0.58, 0.92]; cc = [0.70, 0.84, 1];    ta = 0.85; }
        else if (f < 0.74) { tc = [0.40, 0.44, 0.82]; cc = [0.60, 0.72, 0.98]; ta = 0.7;  }
        else               { tc = [0.44, 0.34, 0.72]; cc = [0.66, 0.56, 0.94]; ta = 0.5;  }
        const fa = Math.floor(fade * 4 + 0.5) / 4;

        const run = 0.85 + 0.15 * Math.sin(f * 22 - age * 9);
        if (side < hw * 0.4) over(cc[0], cc[1], cc[2], ta * fa * run);
        else if (side < hw) over(tc[0], tc[1], tc[2], ta * fa * run);
        else if (side < hw + 0.75 && f < 0.6) over(0.2, 0.26, 0.52, 0.55 * fa);

        if (side < hw + 3.2 && side > hw * 0.5) {
          const gk = ix * 7.13 + iy * 13.37 + Math.floor(age * 7 + hash(ix * 3.1 + iy * 1.7) * 3) * 5.11;
          if (hash(gk) < 0.06 * (1 - f) ** 0.8) over(0.85, 0.92, 1, 0.8 * fa);
        }
      }

      const core = Math.exp(-rr / 1.8);
      const rays = Math.max(Math.exp(-ry * ry * 10) * Math.max(0, 1 - Math.abs(rx) / 4.5),
                            Math.exp(-rx * rx * 10) * Math.max(0, 1 - Math.abs(ry) / 4.5));
      const a = Math.floor(Math.max(0, Math.min(1, Math.max(core, rays) * fade)) * 4 + 0.3) / 4;
      if (a > 0) {
        const m = 0.5 + 0.5 * shimmer;
        over(0.72 + (1 - 0.72) * m, 0.85 + (1 - 0.85) * m, 1, a);
      }
      if (A <= 0) continue;
      const i = (iy * skyW + ix) * 4;
      d[i] = R * 255; d[i + 1] = G * 255; d[i + 2] = B * 255; d[i + 3] = A * 255;
    }
  }
  return true;
}

function skyFrame(now) {
  skyRaf = requestAnimationFrame(skyFrame);
  const d = skyImg.data;
  d.fill(0);
  for (let i = stars.length - 1; i >= 0; i--) {
    const st = stars[i];
    const age = (now - st.t0) / 1000;
    const [hx, hy] = starPos(st, age);
    const gone = hx < -30 || hx > skyW + 30 || hy > skyH + 45 || (st.caught && now - st.caught > 340);
    if (gone || !drawStar(d, st, now)) { stars.splice(i, 1); goneAt = now; }
  }
  skyCtx.putImageData(skyImg, 0, 0);
  if (!stars.length && !starTimer && !starFirst) stopSky();
}

function startSky() {
  if (sky) return;
  sky = document.createElement('canvas');
  sky.className = 'egg-sky';
  layer.append(sky);
  skyCtx = sky.getContext('2d');
  sizeSky();
  skyRaf = requestAnimationFrame(skyFrame);
}
function stopSky() {
  cancelAnimationFrame(skyRaf);
  sky?.remove();
  sky = skyCtx = skyImg = null;
}
window.addEventListener('resize', () => { sizeSky(); placeMoon(); });

function spawnStar(now = performance.now()) {
  if (stars.some(st => !st.caught)) return;
  startSky();
  const still = prefersReducedMotion.matches;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const bend = Math.random() < 0.5 ? -1 : 1;
  stars.push({
    x0: dir < 0 ? skyW * (0.5 + Math.random() * 0.45) : skyW * (0.05 + Math.random() * 0.45),
    y0: still ? skyH * (0.15 + Math.random() * 0.4) : -8,

    vx: still ? 0 : dir * Math.min(60, skyW * 0.2), vy: still ? 0 : skyH / (COARSE.matches ? 4.5 : 2.5),
    ax: still ? 0 : bend * Math.min(14, skyW * 0.06), ay: still ? 0 : 3,
    t0: now, scale: 0.7, caught: 0,
  });
}

function startStars() {
  stopStars();

  starFirst = setTimeout(() => {
    starFirst = 0;
    goneAt = -1e9;
    const tick = () => {
      const now = performance.now();
      if (now - goneAt < STAR_COOLDOWN || stars.some(st => !st.caught)) return;
      spawnStar(now);
    };
    tick();
    starTimer = setInterval(tick, 250);
  }, 1200);
  window.addEventListener('pointerdown', catchStar, true);
  window.addEventListener('pointermove', hoverStar, true);
}
function stopStars() {
  clearTimeout(starFirst); starFirst = 0;
  clearInterval(starTimer); starTimer = 0;
  window.removeEventListener('pointerdown', catchStar, true);
  window.removeEventListener('pointermove', hoverStar, true);
  document.documentElement.classList.remove('egg-hover');
  const now = performance.now();
  for (const st of stars) if (!st.caught) st.caught = now - 200;
}

// the star under the pointer, if any
function starAt(x, y) {
  const now = performance.now();
  for (const st of stars) {
    if (st.caught) continue;
    const [hx, hy] = starPos(st, (now - st.t0) / 1000);
    if (hy * ART < skyH * ART && Math.hypot(x - hx * ART, y - hy * ART) < starR()) return st;
  }
  return null;
}
function hoverStar(e) { document.documentElement.classList.toggle('egg-hover', !!starAt(e.clientX, e.clientY)); }
function catchStar(e) {
  const st = starAt(e.clientX, e.clientY);
  if (!st) return;
  e.stopPropagation();
  e.preventDefault();
  st.caught = performance.now();
  wake('shower');
}

let moonHit = null;
function placeMoon() {
  if (!moonHit) return;
  // the moon in the shader has a radius of 9 art pixels, plus a bit of margin
  const R = 9 * ART + 11;
  moonHit.style.left = `${window.innerWidth * 0.84 - R}px`;
  moonHit.style.top = `${window.innerHeight * 0.2 - R}px`;
  moonHit.style.width = moonHit.style.height = `${R * 2}px`;
}
function startMoon() {
  stopMoon();
  moonHit = document.createElement('div');
  moonHit.className = 'egg-moon';
  moonHit.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); wake('darkmoon'); });
  layer.append(moonHit);
  placeMoon();
}
function stopMoon() { moonHit?.remove(); moonHit = null; }

// the same code for touch screens: swipes and two taps (left half, right half)
const TOUCH_CODE = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'tapL', 'tapR'];
const SWIPE_MIN = 40;
let touchAt = 0;

let konamiAt = 0;
const konamiInfo = debugLine('konami');
const showKonami = (note = '') => konamiInfo(
  `${offered === 'aurora' ? 'armed' : `NOT armed (riddle: ${offered ?? 'none'})`}
` +
  `progress ${konamiAt}/${KONAMI.length}, next: ${konamiAt < KONAMI.length ? KONAMI[konamiAt] : '-'}
touch ${touchAt}/${TOUCH_CODE.length}, next: ${TOUCH_CODE[touchAt]}${note ? `
${note}` : ''}`);
showKonami();
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.code;
  if (offered !== 'aurora') { konamiAt = 0; showKonami(`key: ${k} (ignored)`); return; }
  if (k === KONAMI[konamiAt]) {
    if (++konamiAt === KONAMI.length) { konamiAt = 0; showKonami(`key: ${k}
DONE`); wake('aurora'); return; }
    showKonami(`key: ${k} ok`);
  } else {
    showKonami(`key: ${k} WRONG (wanted ${KONAMI[konamiAt]})`);
    konamiAt = k === KONAMI[0] ? 1 : 0;
  }
});
function touchStep(step) {
  if (step === TOUCH_CODE[touchAt]) {
    if (++touchAt === TOUCH_CODE.length) { touchAt = 0; showKonami(`touch: ${step}
DONE`); wake('aurora'); return; }
    showKonami(`touch: ${step} ok`);
  } else {
    showKonami(`touch: ${step} WRONG (wanted ${TOUCH_CODE[touchAt]})`);
    touchAt = step === TOUCH_CODE[0] ? 1 : 0;
  }
}

let finger = null;
function fingerDown(x, y) {
  finger = { x, y };
  if (offered === 'aurora') showKonami('touch: down');
}
function fingerUp(x, y) {
  if (!finger) return;
  const dx = x - finger.x, dy = y - finger.y;
  finger = null;
  if (offered !== 'aurora') return;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (Math.max(ax, ay) >= SWIPE_MIN) touchStep(ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  else if (Math.max(ax, ay) < 12) touchStep(x < window.innerWidth / 2 ? 'tapL' : 'tapR');
  else showKonami('touch: too short');
}
if ('ontouchstart' in window) {
  window.addEventListener('touchstart', e => { const t = e.changedTouches[0]; fingerDown(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('touchmove', e => { if (offered === 'aurora' && e.cancelable) e.preventDefault(); }, { passive: false });
  window.addEventListener('touchend', e => { const t = e.changedTouches[0]; fingerUp(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('touchcancel', () => { finger = null; if (offered === 'aurora') showKonami('touch: cancelled'); }, { passive: true });
} else {
  window.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') fingerDown(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') fingerUp(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener('pointercancel', () => { finger = null; }, { passive: true });
}

window.addEventListener('egg:riddle', () => showKonami());

let idleTimer = 0;
// milky way: any activity restarts the idle timer
const resetIdle = () => {
  if (offered !== 'milky') return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => wake('milky'), IDLE_MS);
};
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
  window.addEventListener(ev, resetIdle, { passive: true });
}

function stopActions() {
  stopStars();
  stopMoon();
  touchAt = 0;
  document.documentElement.style.touchAction = '';
  clearTimeout(idleTimer);
  konamiAt = 0;
}

// fade the splash text out, change it, fade it in
async function swapSplash(text, egg) {
  const el = splashEl();
  if (!el) return;
  busy = true;
  if (prefersReducedMotion.matches) {
    setSplash(text, egg, false);
  } else {
    const out = el.animate({ opacity: [1, 0] }, { duration: FADE_OUT, easing: 'ease-in-out', fill: 'forwards' });
    await Promise.race([out.finished.catch(() => {}), new Promise(r => setTimeout(r, FADE_OUT + 80))]);
    setSplash(text, egg, false);
    out.cancel();
    el.animate({ opacity: [0, 1] }, { duration: FADE_IN, easing: 'ease-in-out' });
  }
  busy = false;
}

// show the riddle and start listening for its solution
export async function offerEgg(key) {
  if (!EGGS[key]) return;
  clearTimeout(revertTimer);
  stopActions();
  offered = key;
  window.dispatchEvent(new Event('egg:riddle'));
  if (key === 'shower') startStars();
  else if (key === 'darkmoon') startMoon();
  else if (key === 'milky') resetIdle();
  else if (key === 'aurora' && COARSE.matches) document.documentElement.style.touchAction = 'none';
  await swapSplash(EGGS[key].text, true);
}

// riddle solved: turn the effect on, switch the splash back after a short pause
function wake(key) {
  if (offered !== key) return;
  stopActions();
  activeKey = key;
  setEgg(key, true);
  clearTimeout(revertTimer);
  revertTimer = setTimeout(async () => {
    offered = null;
    window.dispatchEvent(new Event('egg:riddle'));
    while (busy) await new Promise(r => setTimeout(r, 100));
    swapSplash(null, false);
  }, REVERT_MS);
}

export function withdrawEgg() {
  if (!offered) return;
  clearTimeout(revertTimer);
  stopActions();
  setEgg(offered, false);
  if (activeKey === offered) activeKey = null;
  offered = null;
  window.dispatchEvent(new Event('egg:riddle'));
  swapSplash(null, false);
}

// one riddle per visit, picked at random
function click() {
  if (used || busy || offered) return;
  used = true;
  dismissHint();
  spendSplash();
  offerEgg(KEYS[Math.floor(Math.random() * KEYS.length)]);
}

const s = document.getElementById('splash');
s?.addEventListener('click', click);
s?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); }
});
let shown = false;
window.addEventListener('splash:fit', () => {
  if (!shown) { shown = true; showHint(); }
  placeHint();
});

window.addEventListener('egg:set', e => {
  const { key, on } = e.detail;
  if (on) activeKey = key; else if (activeKey === key) activeKey = null;
});

for (const [key, { label }] of Object.entries(EGGS)) {
  debugToggle(`offer-${key}`, `riddle: ${label}`, false, on => (on ? offerEgg(key) : withdrawEgg()), 'offer');
}
