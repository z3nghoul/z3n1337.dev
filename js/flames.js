import { prefersReducedMotion } from './config.js';
import { hash, noise, lerp3, level, zoomOf, localRect } from './pixelfx.js';

// pixel flames behind the links. One canvas pixel = PX screen px
const PX = 5;
const FPS = 30;
// TAIL: extra room to the right of the link for the flame on hover. PAD: extra rows above and below
const TAIL = 160;
const PAD = 4;

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// a link that gets focus from clicking should not light up, only keyboard focus (Tab) does
let ignoreFocus = false;
window.addEventListener('blur', () => { ignoreFocus = true; });
window.addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey) ignoreFocus = false;
}, true);

// one flame per link, coloured by the link's --c variable
const flames = [...document.querySelectorAll('.link-item')].map((link, idx) => {
  const rgb = getComputedStyle(link).getPropertyValue('--c').split(',').map(Number);
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    const canvas = document.createElement('canvas');
  canvas.className = 'flame';
  canvas.setAttribute('aria-hidden', 'true');
  link.prepend(canvas);
  const f = {
    link, canvas, ctx: canvas.getContext('2d'), seed: idx * 17.31,
    heat: 0, hot: false,
    // bright colours are dimmed a little so they do not glare
    dim: 1 - 0.3 * lum,
    textCap: 0.5 - 0.2 * lum,

    mid:  rgb,
    tip:  mix(rgb, [255, 255, 255], 0.55),
  };
  const on = () => { f.hot = true; };
  const off = () => { f.hot = false; };
  link.addEventListener('pointerenter', on);
  link.addEventListener('pointerleave', off);

  link.addEventListener('focus', () => { if (!ignoreFocus && link.matches(':focus-visible')) on(); });
  link.addEventListener('blur', off);
  return f;
});

// turn all flames off when the mouse or the tab goes away
const cool = () => { for (const f of flames) f.hot = false; };
window.addEventListener('blur', cool);
document.addEventListener('visibilitychange', () => { if (document.hidden) cool(); });
document.documentElement.addEventListener('mouseleave', cool);

// size each canvas to its link and find where the icon and the text end
function resize() {
  for (const f of flames) {
    const z = zoomOf(f.link);
    const r = localRect(f.link, z);

    const span = Math.max(r.width, localRect(f.link.parentElement, z).width);
    f.cols = Math.max(4, Math.ceil((span + TAIL) / PX));
    f.rows = Math.max(3, Math.round(r.height / PX)) + PAD * 2;
    f.canvas.style.top = `${-PAD * PX}px`;
    f.canvas.width = f.cols;
    f.canvas.height = f.rows;
    f.canvas.style.width = `${f.cols * PX}px`;
    f.canvas.style.height = `${f.rows * PX}px`;
    f.img = f.ctx.createImageData(f.cols, f.rows);

    let right = r.left;
    for (const el of f.link.querySelectorAll('.link-label, .link-handle')) {
      const range = document.createRange();
      range.selectNodeContents(el);
      right = Math.max(right, range.getBoundingClientRect().right / z);
    }
    f.textCols = Math.ceil((right - r.left) / PX) + 2;
    const icon = f.link.querySelector('.link-icon');
    f.iconCols = icon ? Math.ceil((localRect(icon, z).right - r.left) / PX) + 1 : 0;
    f.textStart = f.iconCols + 1;

    const gEl = icon?.querySelector('i') || icon;
    const g = gEl ? localRect(gEl, z) : null;
    f.cx = g ? (g.left + g.width / 2 - r.left) / PX : f.iconCols / 2;
    f.cy = g ? (g.top + g.height / 2 - r.top) / PX + PAD : f.rows / 2;
    f.half = (f.rows - PAD * 2) / 2;
  }
}

function put(d, i, c, a) {
  d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a;
}

// every pixel flickers on its own clock between random brightness levels. heat (0..1) is the hover amount
function draw(f, t) {
  const { cols, rows, img } = f;
  const d = img.data;
  d.fill(0);

  const h = f.heat * f.heat * (3 - 2 * f.heat);
  const R = (6.9 + 0.8 * h) * (1 + 0.05 * Math.sin(t * 0.9 + f.seed));
  const bandEnd = f.cx + (f.textCols + (cols - f.textCols) * 0.55 - f.cx) * h;
  const gain = 0.9 + 0.35 * f.heat;
  for (let y = 0; y < rows; y++) {
    const dy = y + 0.5 - f.cy;
    const vert = Math.max(0, 1 - Math.max(0, Math.abs(dy) - f.half * 0.55) / (f.half * 0.6));
    for (let x = 0; x < cols; x++) {
      const k = x * 12.9898 + y * 78.233 + f.seed;
      const dx = x + 0.5 - f.cx;
      const dist = Math.hypot(dx, dy);
      const q = Math.min(1, Math.max(0, (dist - R * 0.3) / (R * 0.7)));
      let dens = 1 - q * q * (3 - 2 * q);
      if (h > 0.001 && dx > 0 && x < bandEnd) {
        const along = dx / Math.max(1, bandEnd - f.cx);
        dens = Math.max(dens, (1 - along) ** 1.3 * vert);
      }
      if (dens <= 0.01) continue;

      const period = 1.6 + hash(k * 1.7) * 3.4;
      const tt = t / period + hash(k * 2.3);
      const e = Math.floor(tt), fr = tt - e;
      const sm = fr * fr * (3 - 2 * fr);
      const s0 = hash(k + e * 91.7), s1 = hash(k + (e + 1) * 91.7);
      const v0 = hash(k * 3.1 + e * 57.3) < dens ? level(s0) : 0;
      const v1 = hash(k * 3.1 + (e + 1) * 57.3) < dens ? level(s1) : 0;

      const wave = 0.8 + 0.4 * noise(x * 0.09 - t * 0.45 + y * 0.07 + f.seed);
      let b = (v0 + (v1 - v0) * sm) * gain * wave;
      if (x >= f.textStart && x < f.textCols) b = Math.min(b, f.textCap);
      if (b < 0.04) continue;

      const c = b > 0.85 ? lerp3(f.mid, f.tip, Math.min(1, (b - 0.85) / 0.4)) : f.mid.map(v => v * f.dim);
      put(d, (y * cols + x) * 4, c, Math.round(255 * Math.min(1, b * 0.85)));
    }
  }
  f.ctx.putImageData(img, 0, 0);
  f.canvas.style.setProperty('--heat', f.heat.toFixed(3));
}

// draw at FPS, not at the full refresh rate
let last = 0, raf = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  if (now - last < 1000 / FPS) return;
  const dt = last ? Math.min((now - last) / 1000, 0.2) : 0;
  last = now;
  const t = now / 1000;
  for (const f of flames) {
    f.heat += ((f.hot ? 1 : 0) - f.heat) * Math.min(1, dt * 2);
    draw(f, t);
  }
}

function start() {
  cancelAnimationFrame(raf);
  last = 0;
  // static picture instead of the animation
  if (prefersReducedMotion.matches) {
    for (const f of flames) draw(f, 3);
  } else {
    raf = requestAnimationFrame(frame);
  }
}

if (flames.length) {
  resize();
  new ResizeObserver(() => { resize(); if (prefersReducedMotion.matches) start(); })
    .observe(document.querySelector('.links'));
  prefersReducedMotion.addEventListener('change', start);
  start();
}
