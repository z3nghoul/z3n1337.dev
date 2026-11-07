import { prefersReducedMotion } from './config.js';
import {
  PALETTE, PIXEL_SIZE, DARKEN, COLOR_STEPS, STAR_COUNT, STAR_LIFE, STAR_SCALE,
  MOON_R, SHOOT_LIFE, SHOOT_BEND, SHOOT_SCALE,
} from './sky-config.js';

// fallback sky for browsers without WebGL: a lighter Canvas 2D port of the shader in bg.js.
// Only loaded by bg.js through import() when WebGL is missing or the shader fails.
// Same night sky, moon, twinkling stars and shooting stars; no easter eggs (eggs.js turns them off,
// see 'bg:no-webgl' below), ripples or finger trail.
// Devices without WebGL are usually slow, so the soft gradient is computed on a coarse grid and
// interpolated, only dithering and the small sprites are done per pixel, and it runs at ~30 fps.
//
// All coordinates are in art pixels with y pointing up, like gl_FragCoord in the shader.
// The image is flipped when it is copied to the canvas.

const GRID = 4;          // gradient grid step, in art pixels
const FRAME_MS = 1000 / 30;
const SHOOT_SLOTS = 2;   // the base shader draws 2 shooting stars at most
const STEPS = COLOR_STEPS - 1;

let canvas = document.getElementById('bg');
let ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) {
  // the canvas already holds another context type: swap in a clean one
  const fresh = canvas.cloneNode(false);
  canvas.replaceWith(fresh);
  canvas = fresh;
  ctx = canvas.getContext('2d', { alpha: false });
}
canvas.className = 'sky2d';

// tell the page there is no WebGL: eggs.js turns the easter eggs off and the hint says "no webgl :("
document.documentElement.classList.add('no-webgl');
window.dispatchEvent(new Event('bg:no-webgl'));

const hexToRgb01 = hex => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// palette(x) from the shader, baked into a lookup table
const PAL_N = PALETTE.length;
const PAL_RGB = PALETTE.map(hexToRgb01);
const LUT_SIZE = 512;
const LUT = new Float32Array((LUT_SIZE + 1) * 3);
for (let k = 0; k <= LUT_SIZE; k++) {
  const x = (k / LUT_SIZE) * PAL_N;
  let r = 0, g = 0, b = 0, sum = 0;
  for (let i = 0; i < PAL_N; i++) {
    const m = x - i + PAL_N * 0.5;
    const d = Math.abs(m - PAL_N * Math.floor(m / PAL_N) - PAL_N * 0.5);
    let w = Math.max(0, 1 - d);
    w = w * w * (3 - 2 * w);
    r += PAL_RGB[i][0] * w; g += PAL_RGB[i][1] * w; b += PAL_RGB[i][2] * w;
    sum += w;
  }
  LUT[k * 3] = r / sum; LUT[k * 3 + 1] = g / sum; LUT[k * 3 + 2] = b / sum;
}

// ordered 4x4 dithering, same values as bayer4() in the shader
const BAYER = new Float32Array(16);
for (let y = 0; y < 4; y++) {
  for (let x = 0; x < 4; x++) {
    const b2 = (px, py) => 2 * Math.abs(px - py) + py;
    BAYER[y * 4 + x] = (4 * b2(x & 1, y & 1) + b2(x >> 1, y >> 1) + 0.5) / 16;
  }
}
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let W = 0, H = 0;
let img, out, buf;            // ImageData, its bytes, float rgb buffer (W*H*3)
let gw = 0, gh = 0, grid;     // gradient grid (gw*gh*3)
let rowLerp;                  // one vertically interpolated grid row (gw*3)
const rowDx = new Float32Array(4096);
const rowShift = new Int8Array(4096);

const resize = () => {
  W = Math.max(2, Math.ceil(window.innerWidth / PIXEL_SIZE));
  H = Math.min(4096, Math.max(2, Math.ceil(window.innerHeight / PIXEL_SIZE)));
  canvas.width = W;
  canvas.height = H;
  img = ctx.createImageData(W, H);
  out = img.data;
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  buf = new Float32Array(W * H * 3);
  // nodes cover x from -GRID to W + GRID, so the shifted rows never fall off the edge
  gw = Math.ceil((W + 2 * GRID) / GRID) + 1;
  gh = Math.ceil((H + 2 * GRID) / GRID) + 1;
  grid = new Float32Array(gw * gh * 3);
  rowLerp = new Float32Array(gw * 3);
  if (prefersReducedMotion.matches) draw();
};

// soft moving gradient (domain warp + palette), evaluated once per grid node
const fillGrid = time => {
  const t = time * 0.8;
  const asp = W / H;
  const sx = asp * 2.4, sy = 2.4;
  for (let j = 0; j < gh; j++) {
    const ay = j * GRID - GRID;
    const uy = (ay + 0.5) / H;
    for (let i = 0; i < gw; i++) {
      const ax = i * GRID - GRID;
      const ux = (ax + 0.5) / W;
      let qx = (ux - 0.5) * sx, qy = (uy - 0.5) * sy;
      for (let k = 0; k < 4; k++) {
        const nx = qx + 0.5 * Math.sin(qy * 1.6 + t * 0.55 + k * 1.7);
        qy += 0.5 * Math.cos(qx * 1.4 - t * 0.45 + k * 2.3);
        qx = nx;
      }
      const phase = 0.17 * (qx + qy * 0.8) + 0.16 * Math.sin(qx * 1.1 - qy * 0.9 + t * 0.35) + t * 0.02;
      const f = (phase - Math.floor(phase)) * LUT_SIZE;
      const li = f | 0, lt = f - li, l0 = li * 3, l1 = l0 + 3;
      const pr = LUT[l0] + (LUT[l1] - LUT[l0]) * lt;
      const pg = LUT[l0 + 1] + (LUT[l1 + 1] - LUT[l0 + 1]) * lt;
      const pb = LUT[l0 + 2] + (LUT[l1 + 2] - LUT[l0 + 2]) * lt;

      const lum = smooth(0.05, 0.95, 0.5 + 0.5 * Math.sin(qx * 1.25 - qy * 1.05 + t * 0.4));
      const m = 0.58 + 0.22 * lum;
      let r = 0.16 + (pr - 0.16) * m;
      let g = 0.16 + (pg - 0.16) * m;
      let b = 0.23 + (pb - 0.23) * m;
      const gray = r * 0.299 + g * 0.587 + b * 0.114;
      const vx = ux - 0.5, vy = uy - 0.5;
      const k = (1 - 0.14 * (vx * vx + vy * vy) * 2) * DARKEN;
      const o = (j * gw + i) * 3;
      grid[o]     = (gray + (r - gray) * 0.72) * k;
      grid[o + 1] = (gray + (g - gray) * 0.72) * k;
      grid[o + 2] = (gray + (b - gray) * 0.72) * k;
    }
  }
};

// blend colour (r,g,b) into the pixel at buffer offset o by a
const mixAt = (o, r, g, b, a) => {
  buf[o]     += (r - buf[o]) * a;
  buf[o + 1] += (g - buf[o + 1]) * a;
  buf[o + 2] += (b - buf[o + 2]) * a;
};
const offs = (x, y) => (y * W + x) * 3;

// sprites
const stars = Array.from({ length: STAR_COUNT }, () => ({ x: 0, y: 0, s: 1, at: -1e9 }));
const shoots = Array.from({ length: SHOOT_SLOTS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, s: 1, at: -1e9 }));
let time = 0, last = 0, lastDraw = 0, raf = 0;
let nextStar = 0.5;
let nextShoot = 0.5 + Math.random();

const launch = (side, ang, speedMul, top) => {
  const sh = shoots.find(x => time - x.at >= SHOOT_LIFE);
  if (!sh) return;
  const w = W, h = H;
  const dist = (Math.min(w, h) * 0.5 + 30) * (0.7 + Math.random() * 0.6);
  const speed = dist / 0.9 * speedMul;
  sh.x = top < 0.7 ? Math.random() * w * 1.2 - w * 0.1 * side
       : side > 0 ? Math.random() * w * 0.7 : w - Math.random() * w * 0.7;
  sh.y = h * (top + Math.random() * (0.98 - top));
  sh.vx = side * speed * Math.cos(ang);
  sh.vy = -speed * Math.sin(ang);

  const turn = SHOOT_BEND * (1 + Math.random() ** 2);
  const bend = turn * speed / SHOOT_LIFE;
  let px = -sh.vy / speed, py = sh.vx / speed;
  if (py > 0) { px = -px; py = -py; }
  sh.ax = px * bend; sh.ay = py * bend;
  sh.s = SHOOT_SCALE * Math.pow(1.5, Math.random() * 2 - 1);
  sh.at = time;
};

const drawStars = () => {
  for (let i = 0; i < STAR_COUNT; i++) {
    const st = stars[i];
    const age = time - st.at;
    if (age < 0 || age >= STAR_LIFE) continue;
    const life = 1 - age / STAR_LIFE;
    const size = Math.sin(Math.PI * (1 - life));
    const L = 0.5 + size * 2;
    const coreK = 0.26 * (0.33 + size * 0.67);
    const glowK = 1.2 + size * 4;
    const fadeIn = Math.min(1, age * 6);
    const fade = fadeIn * Math.min(1, life * 2.5);
    const glowA = 0.45 * size * fadeIn;
    const sp = 0.5 + 0.5 * Math.sin(age * 16 + i * 2.1);
    const cr = 1, cg = 0.84 + 0.13 * sp, cb = 0.2 + 0.65 * sp;
    const cx = st.x + 0.5, cy = st.y + 0.5;
    const R = Math.ceil(5 * st.s) + 1;
    const y0 = Math.max(0, st.y - R), y1 = Math.min(H - 1, st.y + R);
    for (let y = y0; y <= y1; y++) {
      const ry = (y + 0.5 - cy) / st.s;
      const x0 = Math.max(0, st.x - R - 1), x1 = Math.min(W - 1, st.x + R + 1);
      for (let x = x0; x <= x1; x++) {
        const rx = (x + 0.5 + rowDx[y] - cx) / st.s;
        const rr = rx * rx + ry * ry;
        const o = offs(x, y);
        let glow = Math.exp(-rr / glowK) * glowA;
        glow = Math.floor(glow * 6 + bayer(x + rowShift[y], y)) / 6;
        if (glow > 0) mixAt(o, 0.62, 0.45, 0.92, glow);
        const core = Math.exp(-rr / coreK);
        const rays = Math.max(Math.exp(-ry * ry / 0.03) * Math.max(0, 1 - Math.abs(rx) / L),
                              Math.exp(-rx * rx / 0.03) * Math.max(0, 1 - Math.abs(ry) / L));
        let a = Math.min(1, Math.max(core, rays) * fade);
        a = Math.floor(a * 4 + 0.3) / 4;
        if (a > 0) mixAt(o, cr, cg, cb, a);
      }
    }
  }
};

// colours of the tail segments, from the head backwards: [limit, tail rgb, core rgb, alpha]
const TAIL = [
  [0.1, [0.961, 0.761, 0.906], [1.0, 0.98, 0.94], 1.0],
  [0.4, [0.796, 0.651, 0.969], [0.98, 0.86, 0.95], 1.0],
  [0.7, [0.6, 0.47, 0.82], [0.961, 0.761, 0.906], 0.8],
  [1.0, [0.45, 0.34, 0.66], [0.796, 0.651, 0.969], 0.55],
];
const pts = new Float32Array(18);

const drawShoots = () => {
  for (const sh of shoots) {
    const age = time - sh.at;
    if (age < 0 || age >= SHOOT_LIFE) continue;
    const s = sh.s;
    const life = 1 - age / SHOOT_LIFE;
    const fade = Math.min(1, life * 3);
    const fa = Math.floor(fade * 4 + 0.5) / 4;
    const vlen = Math.hypot(sh.vx, sh.vy);
    const pos = (tt, k) => {
      pts[k * 2]     = sh.x + sh.vx * tt + 0.5 * sh.ax * tt * tt + 0.5;
      pts[k * 2 + 1] = sh.y + sh.vy * tt + 0.5 * sh.ay * tt * tt + 0.5;
    };

    // tail: 8 segments along the curved path, pixel colour depends on distance from it
    const tailLen = 65 * Math.min(1, age * 3) * s;
    const tailT = Math.min(tailLen / vlen, age);
    if (tailT > 0) {
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (let k = 0; k <= 8; k++) {
        pos(age - tailT * k / 8, k);
        minX = Math.min(minX, pts[k * 2]); maxX = Math.max(maxX, pts[k * 2]);
        minY = Math.min(minY, pts[k * 2 + 1]); maxY = Math.max(maxY, pts[k * 2 + 1]);
      }
      const pad = (1.3 + 0.75) * s + 2;
      const x0 = Math.max(0, Math.floor(minX - pad)), x1 = Math.min(W - 1, Math.ceil(maxX + pad));
      const y0 = Math.max(0, Math.floor(minY - pad)), y1 = Math.min(H - 1, Math.ceil(maxY + pad));
      const toF = tailT * vlen / Math.max(tailLen, 1e-3);
      for (let y = y0; y <= y1; y++) {
        const qy = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const qx = x + rowShift[y] + 0.5;
          let best = 1e9, bestF = 0;
          for (let k = 0; k < 8; k++) {
            const ax = pts[k * 2], ay = pts[k * 2 + 1];
            const bx = pts[k * 2 + 2] - ax, by = pts[k * 2 + 3] - ay;
            const h = Math.min(1, Math.max(0, ((qx - ax) * bx + (qy - ay) * by) / Math.max(bx * bx + by * by, 1e-4)));
            const dx = qx - ax - bx * h, dy = qy - ay - by * h;
            const dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < best) { best = dd; bestF = (k + h) / 8; }
          }
          const side = best / s;
          const f = bestF * toF;
          if (f >= 1) continue;
          const hw = f < 0.3 ? 1.3 : (f < 0.65 ? 0.9 : 0.55);
          const seg = TAIL[f < 0.1 ? 0 : f < 0.4 ? 1 : f < 0.7 ? 2 : 3];
          const o = offs(x, y);
          if (side < hw * 0.4) mixAt(o, seg[2][0], seg[2][1], seg[2][2], seg[3] * fa);
          else if (side < hw) mixAt(o, seg[1][0], seg[1][1], seg[1][2], seg[3] * fa);
          else if (side < hw + 0.75 && f < 0.65) mixAt(o, 0.42, 0.28, 0.58, 0.6 * fa);
        }
      }
    }

    // head: a star with a purple glow
    pos(age, 0);
    const hx = pts[0], hy = pts[1];
    const hs = s * 1.5;
    const sp = 0.5 + 0.5 * Math.sin(age * 20);
    const R = Math.ceil(5 * hs) + 1;
    const x0 = Math.max(0, Math.floor(hx - R)), x1 = Math.min(W - 1, Math.ceil(hx + R));
    const y0 = Math.max(0, Math.floor(hy - R)), y1 = Math.min(H - 1, Math.ceil(hy + R));
    for (let y = y0; y <= y1; y++) {
      const ry = (y + 0.5 - hy) / hs;
      for (let x = x0; x <= x1; x++) {
        const rx = (x + 0.5 + rowDx[y] - hx) / hs;
        const rr = rx * rx + ry * ry;
        const o = offs(x, y);
        let hg = Math.exp(-rr / 5.2) * 0.45 * fade;
        hg = Math.floor(hg * 6 + bayer(x + rowShift[y], y)) / 6;
        if (hg > 0) mixAt(o, 0.62, 0.45, 0.92, hg);
        const core = Math.exp(-rr / 1.8);
        const rays = Math.max(Math.exp(-ry * ry * 10) * Math.max(0, 1 - Math.abs(rx) / 4.5),
                              Math.exp(-rx * rx * 10) * Math.max(0, 1 - Math.abs(ry) / 4.5));
        const a = Math.floor(Math.min(1, Math.max(core, rays) * fade) * 4 + 0.3) / 4;
        if (a > 0) mixAt(o, 1, 0.84 + 0.13 * sp, 0.2 + 0.65 * sp, a);
      }
    }
  }
};

// stats for ?debug: average draw time in ms
const stats = { sum: 0, n: 0, since: 0 };
const debugStats = /[?&]debug\b/.test(location.search);

const draw = () => {
  const t0 = performance.now();

  // the shader wobbles each row sideways a little; per row here (the tiny vertical wobble is skipped)
  for (let y = 0; y < H; y++) {
    const fy = y + 0.5;
    const dx = Math.sin(fy * 0.45 + time * 1.3) * 0.35 + Math.sin(fy * 0.13 - time * 0.6) * 0.3;
    rowDx[y] = dx;
    rowShift[y] = Math.floor(0.5 + dx);
  }

  // 1. background: bilinear from the grid
  fillGrid(time);
  for (let y = 0; y < H; y++) {
    const gy = (y + GRID) / GRID;
    const j = gy | 0, ty = gy - j;
    const r0 = j * gw * 3, r1 = r0 + gw * 3;
    for (let k = 0; k < gw * 3; k++) rowLerp[k] = grid[r0 + k] + (grid[r1 + k] - grid[r0 + k]) * ty;
    const sh = rowShift[y];
    let o = y * W * 3;
    for (let x = 0; x < W; x++, o += 3) {
      const gx = (x + sh + GRID) / GRID;
      const i = gx | 0, tx = gx - i, a = i * 3;
      buf[o]     = rowLerp[a]     + (rowLerp[a + 3] - rowLerp[a])     * tx;
      buf[o + 1] = rowLerp[a + 1] + (rowLerp[a + 4] - rowLerp[a + 1]) * tx;
      buf[o + 2] = rowLerp[a + 2] + (rowLerp[a + 5] - rowLerp[a + 2]) * tx;
    }
  }

  // 2. moon glow (only near the moon, where it is visible)
  const mcx = Math.floor(W * 0.84), mcy = Math.floor(H * 0.8) + Math.sin(time * 0.7) * 1.5;
  const pulse = 0.62 + 0.1 * Math.sin(time * 1.1);
  const GR = Math.ceil(MOON_R + MOON_R * 2.6 * Math.log(0.3 * 255));
  {
    const y0 = Math.max(0, Math.floor(mcy - GR)), y1 = Math.min(H - 1, Math.ceil(mcy + GR));
    const x0 = Math.max(0, mcx - GR - 1), x1 = Math.min(W - 1, mcx + GR + 1);
    for (let y = y0; y <= y1; y++) {
      const oy = y + 0.5 - mcy;
      for (let x = x0; x <= x1; x++) {
        const ox = x + rowShift[y] + 0.5 - mcx;
        const md = Math.sqrt(ox * ox + oy * oy);
        const mOut = Math.max(md - MOON_R, 0);
        const o = offs(x, y);
        mixAt(o, 0.62, 0.52, 1.0, 0.3 * Math.exp(-mOut / (MOON_R * 2.6)));
        mixAt(o, 0.84, 0.78, 1.0, pulse * Math.exp(-mOut / (MOON_R * 1.05)));
        const e = md - MOON_R - 0.6;
        mixAt(o, 0.97, 0.95, 1.0, 0.85 * Math.exp(-e * e / 0.9));
      }
    }
  }

  // 3. quantize to COLOR_STEPS levels with ordered dithering
  for (let y = 0; y < H; y++) {
    const sh = rowShift[y];
    let o = y * W * 3;
    for (let x = 0; x < W; x++, o += 3) {
      const d = bayer(x + sh, y);
      buf[o]     = Math.floor(buf[o]     * STEPS + d) / STEPS;
      buf[o + 1] = Math.floor(buf[o + 1] * STEPS + d) / STEPS;
      buf[o + 2] = Math.floor(buf[o + 2] * STEPS + d) / STEPS;
    }
  }

  // 4. twinkling stars
  drawStars();

  // 5. moon disc with a dithered shadow edge and craters
  {
    const lx = -2 + 0.7 * Math.sin(time * 0.25), ly = 1.5;
    const y0 = Math.max(0, Math.floor(mcy - MOON_R - 1)), y1 = Math.min(H - 1, Math.ceil(mcy + MOON_R + 1));
    const x0 = Math.max(0, mcx - MOON_R - 2), x1 = Math.min(W - 1, mcx + MOON_R + 2);
    const crater = (ox, oy, cx, cy, r) => (ox - cx) ** 2 + (oy - cy) ** 2 < r * r;
    for (let y = y0; y <= y1; y++) {
      const oy = y + 0.5 - mcy;
      for (let x = x0; x <= x1; x++) {
        const ax = x + rowShift[y];
        const ox = ax + 0.5 - mcx;
        if (Math.sqrt(ox * ox + oy * oy) > MOON_R) continue;
        let r = 1, g = 1, b = 1;
        if (Math.hypot(ox - lx, oy - ly) - MOON_R > (bayer(ax, y) - 0.5) * 2) { r = 0.82; g = 0.85; b = 1; }
        if (crater(ox, oy, -3, 3, 2.2) || crater(ox, oy, 3, -2, 1.6) ||
            crater(ox, oy, 2, 4, 1.1) || crater(ox, oy, -4, -3, 1.0)) { r = 0.9; g = 0.92; b = 1; }
        const o = offs(x, y);
        buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
      }
    }
  }

  // 6. shooting stars
  drawShoots();

  // float buffer -> bytes, flipping y so that up is up
  for (let y = 0; y < H; y++) {
    let o = y * W * 3, p = (H - 1 - y) * W * 4;
    for (let x = 0; x < W; x++, o += 3, p += 4) {
      out[p] = buf[o] * 255; out[p + 1] = buf[o + 1] * 255; out[p + 2] = buf[o + 2] * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (!canvas.classList.contains('ready')) canvas.classList.add('ready');

  if (debugStats) {
    stats.sum += performance.now() - t0;
    stats.n++;
    if (t0 - stats.since > 5000) {
      console.info(`[bg-sky2d] ${W}x${H}, avg draw ${(stats.sum / stats.n).toFixed(2)} ms over ${stats.n} frames`);
      stats.sum = 0; stats.n = 0; stats.since = t0;
    }
  }
};

const frame = now => {
  raf = requestAnimationFrame(frame);
  if (lastDraw && now - lastDraw < FRAME_MS - 2) return;
  lastDraw = now;
  const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
  last = now;
  time += dt;

  if (time >= nextStar) {
    const st = stars.find(s => time - s.at >= STAR_LIFE);
    if (st) {
      st.x = Math.floor(Math.random() * W);
      st.y = Math.floor(Math.random() * H);
      st.s = STAR_SCALE * Math.pow(1.5, Math.random() * 2 - 1);
      st.at = time;
    }
    nextStar = time + 0.04 + Math.random() * 0.25;
  }
  if (time >= nextShoot) {
    const side = Math.random() < 0.5 ? -1 : 1;
    launch(side, (15 + Math.random() * 50) * Math.PI / 180, 1, 0.75);
    nextShoot = time + SHOOT_LIFE + Math.random() * 1.0;
  }
  draw();
};

const start = () => {
  cancelAnimationFrame(raf);
  last = 0;
  lastDraw = 0;
  if (prefersReducedMotion.matches) {
    // one still frame, like the shader's reduced-motion mode
    time = 25;
    draw();
  } else {
    raf = requestAnimationFrame(frame);
  }
};

window.addEventListener('resize', resize);
prefersReducedMotion.addEventListener('change', start);
resize();
start();
