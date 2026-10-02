import { prefersReducedMotion } from './config.js';
import { noise, lerp3, pixelBrightness, zoomOf, localRect } from './pixelfx.js';

// pixel glow around the player. It is drawn on a canvas, one canvas pixel = PX screen px
const PX = 5;
// how far the glow reaches, in glow pixels
const REACH = 5;
const REACHPX = REACH * PX;
const FPS = 24;
const INSET = 6;
// glow strength when idle and when a track is playing
const IDLE = 0.05;
const ACTIVE = 0.55;

const player = document.getElementById('player');
if (player) init();

function init() {
  const cv = document.createElement('canvas');
  cv.className = 'player-glow';
  cv.setAttribute('aria-hidden', 'true');
  player.prepend(cv);
  const ctx = cv.getContext('2d');

  const artLink = document.getElementById('player-link');
  const silenceEl = document.getElementById('player-silence');
  const buttons = [document.getElementById('player-play'), document.getElementById('player-vol-btn')];

  // hover "heat" of each button (0..1), eased towards the target h.t
  const heat = new Map(buttons.map(b => [b, { v: 0, t: 0 }]));
  for (const b of buttons) {
    const h = heat.get(b);
    b.addEventListener('pointerenter', () => { h.t = 1; });
    b.addEventListener('pointerleave', () => { h.t = 0; });
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) h.t = 1; });
    b.addEventListener('blur', () => { h.t = 0; });
  }
  const cool = () => heat.forEach(h => { h.t = 0; });
  window.addEventListener('blur', cool);
  document.documentElement.addEventListener('mouseleave', cool);

  // a 1x1 canvas turns any css colour into rgb values
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  probe.canvas.width = probe.canvas.height = 1;
  let colorStr = '', rgb = [203, 166, 247], lastRead = 0;
  const readColor = now => {
    if (now - lastRead < 40) return;
    lastRead = now;
    const v = getComputedStyle(player).getPropertyValue('--art-c').trim();
    if (!v || v === colorStr) return;
    colorStr = v;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = v;
    probe.fillRect(0, 0, 1, 1);
    const p = probe.getImageData(0, 0, 1, 1).data;
    rgb = [p[0], p[1], p[2]];
  };

  // the album art is 24x24, the glow takes its colours from it
  const ART = 24;
  let artPx = null;
  window.addEventListener('player:art', e => { artPx = e.detail; });
  const artColor = (T, cx, cy) => {
    const ax = Math.max(0, Math.min(ART - 1, Math.floor((cx - T.cl) / (T.cr - T.cl) * ART)));
    const ay = Math.max(0, Math.min(ART - 1, Math.floor((cy - T.ct) / (T.cb - T.ct) * ART)));
    const i = (ay * ART + ax) * 4;
    return [artPx[i], artPx[i + 1], artPx[i + 2]];
  };

  let cols = 0, rows = 0, img = null;
  let zm = 1;
  let strength = IDLE;
  let open = 0;
  let clock = 0;
  let prev = { l: 0, t: 0, w: 0, h: 0 };
  let vis = 1, visT = 1, visRate = 6;
  let glowSince = 0;
  window.addEventListener('player:glow', e => {
    visT = e.detail.v;
    visRate = e.detail.rate;
    glowSince = performance.now();
  });
  let lastChange = -1e9;
  let pillW = 216, rowW = 372;

  // how open the player is: 0 = small pill, 1 = full row. Used to fade the glow in step with the width animation
  const openness = (w, now) => {
    if (now - lastChange > 400) {
      if (player.classList.contains('has-track')) rowW = w; else pillW = w;
    }
    return rowW - pillW < 8
      ? (player.classList.contains('has-track') ? 1 : 0)
      : Math.max(0, Math.min(1, (w - pillW) / (rowW - pillW)));
  };

  // shapes the glow comes from: the art square and the round buttons (or the pill when nothing plays)
  function targets(pr) {
    const list = [];
    if (!player.classList.contains('has-track')) {
      const s = silenceEl ? localRect(silenceEl, zm) : pr;
      if (s.width > 1) list.push({ rect: true, l: s.left - 8, t: s.top - 6, r: s.right + 8, b: s.bottom + 6, pad: 3 * PX, k: 0.21 });
      return list;
    }
    if (artLink && !artLink.hidden) {
      const r = localRect(artLink, zm);

      if (r.width > 1) list.push({
        rect: true, art: true,
        l: r.left + INSET, t: r.top + INSET, r: r.right - INSET, b: r.bottom - INSET,
        cl: r.left, ct: r.top, cr: r.right, cb: r.bottom,
        pad: REACHPX + INSET, k: strength * 1.35,
      });
    }
    for (const b of buttons) {
      const r = localRect(b, zm);
      if (r.width < 1) continue;
      const h = heat.get(b).v;
      list.push({
        rect: false,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,
        R: 21 + 6 * h,
        k: b.disabled ? 0.14 * open : open * (0.6 + 0.4 * h),
      });
    }
    return list;
  }

  function draw(t, now) {
    zm = zoomOf(player);
    const pr = localRect(player, zm);
    if (Math.abs(pr.left - prev.l) + Math.abs(pr.top - prev.t) + Math.abs(pr.width - prev.w) + Math.abs(pr.height - prev.h) > 0.01) {
      lastChange = now;
      prev = { l: pr.left, t: pr.top, w: pr.width, h: pr.height };
    }
    if (pr.width < 1 || pr.height < 1) return;

    const gx = Math.floor((pr.left - REACHPX) / PX);
    const gy = Math.floor((pr.top - REACHPX) / PX);
    const c = Math.ceil((pr.right + REACHPX) / PX) - gx;
    const rw = Math.ceil((pr.bottom + REACHPX) / PX) - gy;
    if (c !== cols || rw !== rows || !img) {
      cols = c; rows = rw;
      cv.width = cols;
      cv.height = rows;
      cv.style.width = `${cols * PX}px`;
      cv.style.height = `${rows * PX}px`;
      img = ctx.createImageData(cols, rows);
    }
    cv.style.left = `${gx * PX - pr.left}px`;
    cv.style.top = `${gy * PX - pr.top}px`;

    const list = targets(pr);
    const d = img.data;
    d.fill(0);
    // for every pixel: find the strongest source nearby, then flicker it a bit
    const busy = (strength - IDLE) / (ACTIVE - IDLE);
    for (let y = 0; y < rows; y++) {
      const wy = gy + y;
      const cy = (wy + 0.5) * PX;
      for (let x = 0; x < cols; x++) {
        const wx = gx + x;
        const cx = (wx + 0.5) * PX;
        let dens = 0, base = rgb;
        for (const T of list) {
          let u;
          if (T.rect) {
            const dx = Math.max(T.l - cx, 0, cx - T.r);
            const dy = Math.max(T.t - cy, 0, cy - T.b);
            if (dx === 0 && dy === 0) continue;
            u = Math.hypot(dx, dy) / T.pad;
          } else {
            u = Math.hypot(cx - T.cx, cy - T.cy) / T.R;
          }
          if (u >= 1) continue;
          const v = T.k * vis * (1 - u) ** 1.3;
          if (v > dens) {
            dens = v;
            base = T.art && artPx ? artColor(T, cx, cy) : rgb;
          }
        }
        if (dens < 0.004) continue;
        const k = wx * 12.9898 + wy * 78.233;
        const wave = 0.8 + 0.4 * noise(wx * 0.11 - t * 0.4 + wy * 0.09);
        const b = pixelBrightness(k, t, dens) * wave * (1 + 0.3 * busy);
        if (b < 0.04) continue;
        const col = b > 0.85 ? lerp3(base, lerp3(base, [255, 255, 255], 0.45), Math.min(1, (b - 0.85) / 0.4)) : base;
        const i = (y * cols + x) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
        d[i + 3] = Math.round(255 * Math.min(1, b * 0.9));
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // redraw at FPS, or every frame while something is moving
  let last = 0, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (Math.abs(player.offsetWidth - prev.w) > 1.5 || Math.abs(player.offsetHeight - prev.h) > 1.5) lastChange = now;
    const moving = now - lastChange < 250;
    const hovering = [...heat.values()].some(h => Math.abs(h.t - h.v) > 0.01);
    if (visT === 0 && now - glowSince > 3000) visT = 1;
    const fading = Math.abs(visT - vis) > 0.005;
    if (!moving && !hovering && !fading && now - last < 1000 / FPS) return;
    const dt = last ? Math.min((now - last) / 1000, 0.2) : 0;
    last = now;
    open = openness(player.offsetWidth, now);
    const target = IDLE + (ACTIVE - IDLE) * open;
    strength += (target - strength) * Math.min(1, dt * 12);
    for (const h of heat.values()) h.v += (h.t - h.v) * Math.min(1, dt * 6);
    vis += (visT - vis) * Math.min(1, dt * visRate);
    if (Math.abs(visT - vis) < 0.005) vis = visT;
    clock += dt * (1 + 1.6 * ((strength - IDLE) / (ACTIVE - IDLE)));
    readColor(now);
    draw(clock, now);
  }

  const start = () => {
    cancelAnimationFrame(raf);
    last = 0;
    // static picture instead of the animation
    if (prefersReducedMotion.matches) {
      vis = visT = 1;
      open = player.classList.contains('has-track') ? 1 : 0;
      strength = IDLE + (ACTIVE - IDLE) * open;
      readColor(performance.now() + 1000);
      draw(3, performance.now());
    } else {
      raf = requestAnimationFrame(frame);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf); else start();
  });
  prefersReducedMotion.addEventListener('change', start);
  window.addEventListener('resize', () => { if (prefersReducedMotion.matches) start(); });

  start();
}
