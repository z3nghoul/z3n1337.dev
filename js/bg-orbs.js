import { prefersReducedMotion } from './config.js';

// fallback background for browsers without WebGL: soft colour blobs that drift around
// and run away from the mouse. Colours are Catppuccin Mocha
const MOCHA = {
  mauve:    '#cba6f7',
  blue:     '#89b4fa',
  sapphire: '#74c7ec',
  teal:     '#94e2d5',
  peach:    '#fab387',
  pink:     '#f38ba8',
  green:    '#a6e3a1',
  lavender: '#b4befe',
  yellow:   '#f9e2af',
  sky:      '#89dceb',
};

const ORB_COLORS = Object.values(MOCHA);

const canvas = document.getElementById('bg');
const ctx    = canvas.getContext('2d');

let W, H, orbs = [];
let mouse = { x: -9999, y: -9999 };
let rafId = 0;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rand(a, b) { return a + Math.random() * (b - a); }

// where each blob starts, as fractions of the screen
const ANCHORS = [
  [0.0, 0.0], [0.5, 0.0], [1.0, 0.0],
  [0.0, 0.5], [0.5, 0.5], [1.0, 0.5],
  [0.0, 1.0], [0.5, 1.0], [1.0, 1.0],
  [0.25, 0.25], [0.75, 0.25],
];

function init() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;

  const n = ORB_COLORS.length;
  const half = Math.floor(n / 2);
  orbs = ORB_COLORS.map((color, i) => {
    const [ax, ay] = ANCHORS[i % ANCHORS.length];
    const nextColor = ORB_COLORS[(i + half) % n];
    return {
      x:  ax * W + rand(-50, 50),
      y:  ay * H + rand(-50, 50),
      vx: rand(-1, 1),
      vy: rand(-1, 1),
      wx: rand(0, W),
      wy: rand(0, H),
      r:      rand(0.60, 0.80),
      rBase:  rand(0.60, 0.80),
      rPhase: rand(0, Math.PI * 2),
      rSpeed: rand(0.008, 0.016),
      rgb:     hexToRgb(color),
      rgbNext: hexToRgb(nextColor),
      cPhase:  (i / n) * Math.PI * 2,
      cSpeed:  rand(0.012, 0.028),
      aPhase:  rand(0, Math.PI * 2),
      aSpeed:  rand(0.018, 0.040),
    };
  });
}

// tuning of the movement: how strongly the blobs flee, wander and slow down
const FLEE_RADIUS    = 380;
const FLEE_FORCE     = 55;
const REPEL_RADIUS   = 300;
const REPEL_FORCE    = 12;
const WANDER_FORCE   = 0.6;
const WANDER_RESET   = 0.03;
const WANDER_NOISE   = 1.1;
const CAROUSEL_FORCE = 1.7;
const DAMPING        = 0.88;
const MAX_SPEED      = 14;

document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
document.addEventListener('mouseleave', () => { mouse.x = -9999; mouse.y = -9999; });

const COLOR_SNAP_RADIUS = 500;

document.addEventListener('pointerdown', e => {
  if (prefersReducedMotion.matches) return;
  const mx = e.clientX, my = e.clientY;
  orbs.forEach(o => {
    const angle = Math.random() * Math.PI * 2;
    const force = rand(12, MAX_SPEED * 1.8);
    o.vx += Math.cos(angle) * force;
    o.vy += Math.sin(angle) * force;
    o.wx = rand(0.05, 0.95) * W;
    o.wy = rand(0.05, 0.95) * H;

    const dx = o.x - mx, dy = o.y - my;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < COLOR_SNAP_RADIUS) {
      const boost = rand(0.12, 0.18);
      o.cSpeed += boost;
      setTimeout(() => { o.cSpeed -= boost; }, 200);
    }
  });
});

let lastTime = 0;

function step(dt) {
  orbs.forEach(o => {
    o.rPhase += o.rSpeed * dt;
    o.r = o.rBase + Math.sin(o.rPhase) * 0.06;
    o.cPhase += o.cSpeed * dt;
    const t = (Math.sin(o.cPhase) + 1) / 2;
    o._rgb = [
      Math.round(o.rgb[0] + (o.rgbNext[0] - o.rgb[0]) * t),
      Math.round(o.rgb[1] + (o.rgbNext[1] - o.rgb[1]) * t),
      Math.round(o.rgb[2] + (o.rgbNext[2] - o.rgb[2]) * t),
    ];
    o.aPhase += o.aSpeed * dt;
    o._alpha = 0.55 + (Math.sin(o.aPhase) + 1) / 2 * 0.45;
  });

  orbs.forEach((o, i) => {
    if (Math.random() < WANDER_RESET * dt) {
      o.wx = rand(0.05, 0.95) * W;
      o.wy = rand(0.05, 0.95) * H;
    }
    const dwx = o.wx - o.x, dwy = o.wy - o.y;
    const dwd = Math.sqrt(dwx*dwx + dwy*dwy) || 1;
    o.vx += (dwx / dwd) * WANDER_FORCE * dt;
    o.vy += (dwy / dwd) * WANDER_FORCE * dt;

    o.vx += (Math.random() - 0.5) * WANDER_NOISE * dt;
    o.vy += (Math.random() - 0.5) * WANDER_NOISE * dt;

    const rx = o.x - W * 0.5, ry = o.y - H * 0.5;
    const rd = Math.sqrt(rx*rx + ry*ry) || 1;
    o.vx += ( ry / rd) * CAROUSEL_FORCE * dt;
    o.vy += (-rx / rd) * CAROUSEL_FORCE * dt;

    const cx = mouse.x - o.x, cy = mouse.y - o.y;
    const cd = Math.sqrt(cx*cx + cy*cy) || 1;
    if (cd < FLEE_RADIUS && mouse.x > 0) {
      const s = FLEE_FORCE * 0.65 * Math.pow(1 - cd / FLEE_RADIUS, 1.5);
      o.vx += (cx / cd) * s * dt;
      o.vy += (cy / cd) * s * dt;
    }

    for (let j = i + 1; j < orbs.length; j++) {
      const b = orbs[j];
      const dx = o.x - b.x, dy = o.y - b.y;
      const dd = Math.sqrt(dx*dx + dy*dy) || 1;
      if (dd < REPEL_RADIUS) {
        const f = REPEL_FORCE * Math.pow(1 - dd / REPEL_RADIUS, 2) * dt;
        const fx = (dx/dd)*f, fy = (dy/dd)*f;
        o.vx += fx; o.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    const R = o.r * Math.max(W, H) * 0.3;
    if (o.x - R < 0)   o.vx += 3.5 * dt;
    if (o.x + R > W)   o.vx -= 3.5 * dt;
    if (o.y - R < 0)   o.vy += 3.5 * dt;
    if (o.y + R > H)   o.vy -= 3.5 * dt;

    const damping = Math.pow(DAMPING, dt);
    o.vx *= damping;
    o.vy *= damping;
    const spd = Math.sqrt(o.vx*o.vx + o.vy*o.vy);
    if (spd > MAX_SPEED) { o.vx = o.vx/spd*MAX_SPEED; o.vy = o.vy/spd*MAX_SPEED; }

    o.x += o.vx * dt;
    o.y += o.vy * dt;
  });
}

function render() {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f0f17';
  ctx.fillRect(0, 0, W, H);

  orbs.forEach(orb => {
    const r = orb.r * Math.max(W, H);
    const [rr, gg, bb] = orb._rgb;

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    const a = orb._alpha;
    g.addColorStop(0,    `rgba(${rr},${gg},${bb},${(a * 0.90).toFixed(2)})`);
    g.addColorStop(0.30, `rgba(${rr},${gg},${bb},${(a * 0.55).toFixed(2)})`);
    g.addColorStop(0.65, `rgba(${rr},${gg},${bb},${(a * 0.18).toFixed(2)})`);
    g.addColorStop(1,    `rgba(${rr},${gg},${bb},0)`);
    ctx.save();
    ctx.translate(orb.x, orb.y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function draw(now) {
  const dt = lastTime ? Math.min((now - lastTime) / (1000 / 60), 3) : 1;
  lastTime = now;
  step(dt);
  render();
  rafId = requestAnimationFrame(draw);
}

function paintStill() {
  for (let i = 0; i < 240; i++) step(1);
  render();
}

function start() {
  init();
  cancelAnimationFrame(rafId);
  if (prefersReducedMotion.matches) {
    paintStill();
  } else {
    lastTime = 0;
    rafId = requestAnimationFrame(draw);
  }
}

start();
window.addEventListener('resize', start);
prefersReducedMotion.addEventListener('change', start);
