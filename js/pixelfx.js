// small helpers shared by the pixel effects (link halos, player glow)
//
// pseudo-random number in [0, 1) for any input
export const hash = n => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// smooth 1D value noise
export const noise = x => {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
};

export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// brightness steps a pixel can have, 0 means off
const LEVELS = [0, 0.18, 0.3, 0.45, 0.6, 0.78, 1];
export const level = h => LEVELS[Math.min(LEVELS.length - 1, Math.floor(Math.pow(h, 1.25) * LEVELS.length))];

// brightness of one pixel at time t. It drifts between random levels on its own clock
// and is lit at all only with probability `dens`. `k` is a number unique to the pixel
export function pixelBrightness(k, t, dens) {
  const period = 1.6 + hash(k * 1.7) * 3.4;
  const tt = t / period + hash(k * 2.3);
  const e = Math.floor(tt), fr = tt - e;
  const sm = fr * fr * (3 - 2 * fr);
  const v0 = hash(k * 3.1 + e * 57.3) < dens ? level(hash(k + e * 91.7)) : 0;
  const v1 = hash(k * 3.1 + (e + 1) * 57.3) < dens ? level(hash(k + (e + 1) * 91.7)) : 0;
  return v0 + (v1 - v0) * sm;
}

// with css zoom on a parent, getBoundingClientRect() returns zoomed px but the sizes we set are
// not zoomed. localRect() converts a rect back so both agree
export const zoomOf = el => el?.currentCSSZoom || 1;
export function localRect(el, z = zoomOf(el)) {
  const r = el.getBoundingClientRect();
  return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z };
}
