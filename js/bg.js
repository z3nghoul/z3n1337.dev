import { prefersReducedMotion } from './config.js';
import { debugToggle } from './debug.js';
import { progress, ready } from './loader.js';

// night sky drawn by a WebGL fragment shader on a small canvas, scaled up so it looks like pixel art.
// If WebGL is not available, bg-orbs.js draws simple moving blobs instead
const PALETTE = [
  '#5b4a8a',
  '#8b6bc0',
  '#cba6f7',
  '#8a95dc',
  '#6a5aa8',
  '#a98bd9',
  '#7287c8',
  '#6a4fa3',
];

// size of one art pixel on screen (smaller on phones). SUB is how many canvas pixels make one art pixel
const PIXEL_SIZE = window.matchMedia('(max-width: 600px)').matches ? 3 : 5;
const DARKEN = 0.6;
const STAR_COUNT = 24;
const STAR_LIFE = 1.4;
// sizes and lifetimes (in seconds) of the stars, shooting stars, trails and ripples
const MOON_R = 9;
const SHOOT_LIFE = 1.6;
const SHOOTS = 10;
const SUB = 4;
const RIPPLES = 8;
const TRAIL = 24;
const TRAIL_LIFE = 2.2;
const RIPPLE_LIFE = 5;
// period of the noise texture, tiles seamlessly
const NOISE_P = 16;
const COLOR_STEPS = 9;
const STAR_SCALE = 1.04;
const SHOOT_BEND = 0.35;
const SHOOT_SCALE = 0.77;

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// the shader. The easter eggs are compiled in only when needed (see EGG_DEFS) to keep the base sky cheap
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

#define N ${PALETTE.length}

uniform vec2  u_res;
uniform float u_time;
uniform float u_milky;
uniform vec4  u_trail[${TRAIL}];
uniform float u_trailEnd;
uniform vec4  u_rip[${RIPPLES}];
uniform vec3  u_col[N];
uniform vec4  u_star[${STAR_COUNT}];
uniform vec4  u_shootA[${SHOOTS}];
uniform vec4  u_shootB[${SHOOTS}];
uniform float u_shower;
uniform float u_aurora;
uniform float u_dark;

// smooth looping blend through the colours of the palette
vec3 palette(float x) {
  x = fract(x) * float(N);
  vec3 c = vec3(0.0);
  float sum = 0.0;
  for (int i = 0; i < N; i++) {
    float d = abs(mod(x - float(i) + float(N) * 0.5, float(N)) - float(N) * 0.5);
    float w = max(0.0, 1.0 - d);
    w = w * w * (3.0 - 2.0 * w);
    c += u_col[i] * w;
    sum += w;
  }
  return c / sum;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

uniform sampler2D u_noise;
float vnoise(vec2 p) { return texture2D(u_noise, p / ${NOISE_P}.0).g; }
float fbm(vec2 p)    { return texture2D(u_noise, p / ${NOISE_P}.0).r; }

float bayer2(vec2 p) { return 2.0 * abs(p.x - p.y) + p.y; }
// ordered dithering, turns smooth values into pixel-art steps
float bayer4(vec2 p) {
  p = mod(floor(p), 4.0);
  vec2 lo = mod(p, 2.0);
  vec2 hi = floor(p / 2.0);
  return (4.0 * bayer2(lo) + bayer2(hi) + 0.5) / 16.0;
}

void main() {
  vec2 fc  = gl_FragCoord.xy / ${SUB}.0;

  vec2 disp = vec2(sin(fc.y * 0.45 + u_time * 1.3) * 0.35 + sin(fc.y * 0.13 - u_time * 0.6) * 0.3,
                   sin(fc.x * 0.09 + fc.y * 0.2 + u_time * 0.8) * 0.15);
  float crest = 0.0;
  for (int i = 0; i < ${RIPPLES}; i++) {
    float age = u_rip[i].z;
    if (age < 0.0) continue;
    float st = u_rip[i].w;
    vec2 d = fc + disp - u_rip[i].xy;
    float rr = length(d);
    float x = rr - age * 55.0 * st;
    float spread = (90.0 + age * 260.0) * st * st;
    float env = exp(-x * x / spread) * exp(-age * 0.7) / sqrt(1.0 + rr * 0.05);
    float w = sin(x * 0.5 / st - age * 2.0) * env;
    disp += d / (rr + 1e-3) * w * 2.2 * st;
    crest += w * min(st, 1.2);
  }

  if (u_trailEnd > 0.0) {
    vec2 q = fc + disp;
    float best = 1e9, bAge = 0.0;
    vec2 bDir = vec2(0.0);
    for (int k = 1; k < ${TRAIL}; k++) {
      vec4 A = u_trail[k - 1], B = u_trail[k];
      if (B.w < 0.5 || A.z < 0.0 || B.z < 0.0) continue;
      vec2 ab = B.xy - A.xy;
      float h = clamp(dot(q - A.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
      vec2 cp = A.xy + ab * h;
      float dd = length(q - cp);
      if (dd < best) { best = dd; bAge = mix(A.z, B.z, h); bDir = (q - cp) / (dd + 1e-3); }
    }
    if (best < 1e8) {
      float R = 4.0 * exp(-bAge * 2.0);
      float inside = 1.0 - clamp(best / max(R, 1e-3), 0.0, 1.0);
      disp += bDir * inside * 1.4;
      crest -= inside * inside * 0.6;
      float x = max(best - R, 0.0) - bAge * 24.0;
      float env = exp(-x * x / (10.0 + bAge * 70.0)) * exp(-bAge * 1.5)
                * smoothstep(u_trailEnd, u_trailEnd * 0.6, bAge);
      float w = sin(x * 0.8 - bAge * 2.5) * env;
      disp += bDir * w * 1.5;
      crest += w * 0.7;
    }
  }
  fc += disp;
  vec2 ap  = floor(fc);
  vec2 uv  = (ap + 0.5) / u_res;
  float asp = u_res.x / u_res.y;
  vec2 scale = vec2(asp, 1.0) * 2.4;
  vec2 p = (uv - 0.5) * scale;
  float t = u_time * 0.8;

  vec2 q = p;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    q += 0.5 * vec2(sin(q.y * 1.6 + t * 0.55 + fi * 1.7),
                    cos(q.x * 1.4 - t * 0.45 + fi * 2.3));
  }

  float phase = 0.17 * (q.x + q.y * 0.8) + 0.16 * sin(q.x * 1.1 - q.y * 0.9 + t * 0.35)
              + t * 0.02;
  vec3 col = palette(phase);

  float lum = 0.5 + 0.5 * sin(q.x * 1.25 - q.y * 1.05 + t * 0.4);
  lum = smoothstep(0.05, 0.95, lum);
  vec3 base = vec3(0.16, 0.16, 0.23);
  vec3 c = mix(base, col, 0.58 + 0.22 * lum);

  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(g), c, 0.72);
  c *= 1.0 - 0.14 * dot(uv - 0.5, uv - 0.5) * 2.0;
  c *= ${DARKEN.toFixed(2)};

  // milky way
  float milkyBand = 0.0;
#ifdef EGG_MILKY
  if (u_milky > 0.001) {
    vec2 mp = (ap + 0.5) / u_res.y;
    vec2 axis = normalize(vec2(1.0, -0.5));
    vec2 rel = mp - vec2(0.5 * asp, 0.52);
    float along = dot(rel, axis);
    float across = dot(rel, vec2(-axis.y, axis.x));
    across += 0.035 * sin(along * 3.1 + 0.8) + 0.03 * (fbm(vec2(along * 2.0, 3.0)) - 0.5);
    float width = 0.17 + 0.06 * fbm(vec2(along * 2.5, 7.0)) + 0.05 * smoothstep(-0.2, 0.5, along);
    float band = exp(-across * across / (width * width));
    float bulge = exp(-across * across / (width * width * 0.3)) * exp(-pow(along - 0.45, 2.0) / 0.08);
    vec2 np = vec2(along * 5.0, across * 9.0);

    float cloud = fbm(np + vec2(u_time * 0.05, u_time * 0.006));
    cloud = mix(cloud, fbm(np * 1.7 + vec2(-u_time * 0.09, 5.0)), 0.35);
    float grain = fbm(np * 3.3 + vec2(4.0 + u_time * 0.12, 4.0));
    float neb = band * (0.35 + 1.1 * cloud * cloud) * (0.65 + 0.6 * grain) + bulge * (0.5 + 0.7 * cloud);

    neb *= 1.0 + 0.22 * sin(along * 7.0 - u_time * 0.5 + cloud * 4.0) * band;
    neb *= 1.0 + 0.12 * sin(u_time * 0.4) * bulge;

    float riftC = across - 0.012 + 0.03 * (fbm(np * 0.8 + 11.0) - 0.5);
    float rift = exp(-riftC * riftC / (width * width * 0.05)) * smoothstep(0.35, 0.65, fbm(np * 1.3 + 3.0));
    float lanes = smoothstep(0.5, 0.78, fbm(np * 2.1 + 20.0)) * band;
    float dark = clamp(rift * 0.8 + lanes * 0.6, 0.0, 0.9);
    vec3 tint = mix(vec3(0.706, 0.745, 0.996), vec3(0.85, 0.82, 0.98), grain);
    tint = mix(tint, vec3(0.796, 0.651, 0.969), 0.35 * (1.0 - cloud));
    tint = mix(tint, vec3(0.98, 0.88, 0.8), clamp(bulge, 0.0, 1.0) * 0.7);
    vec3 mw = tint * neb * 0.7 * (1.0 - dark);
    c = c * (1.0 - dark * 0.55 * band * u_milky) + mw * u_milky;
    milkyBand = band * (1.0 - dark * 0.7) + bulge * 0.5;
  }
#endif

  vec2 px = ap;
  const float MR = ${MOON_R}.0;
  vec2 mc = floor(u_res * vec2(0.84, 0.8)) + vec2(0.0, sin(u_time * 0.7) * 1.5);
  vec2 mo = px + 0.5 - mc;
  float md = length(mo);
  float mVis = 1.0 - clamp(u_dark * 2.0, 0.0, 1.0);
  float mPulse = 0.62 + 0.1 * sin(u_time * 1.1);
  float mOut = max(md - MR, 0.0);
  c = mix(c, vec3(0.62, 0.52, 1.0), mVis * 0.3 * exp(-mOut / (MR * 2.6)));
  c = mix(c, vec3(0.84, 0.78, 1.0), mVis * mPulse * exp(-mOut / (MR * 1.05)));
  c = mix(c, vec3(0.97, 0.95, 1.0), mVis * 0.85 * exp(-pow(md - MR - 0.6, 2.0) / 0.9));

  c *= 1.0 + 0.14 * crest;

  const float STEPS = ${COLOR_STEPS}.0;

#ifdef EGG_SHOWER
  if (u_shower > 0.001) {
    float g = smoothstep(0.15, 0.95, uv.y);
    float fl = fbm(vec2(uv.x * 2.5 + u_time * 0.08, uv.y * 1.5 - u_time * 0.05));
    g *= 0.6 + 0.8 * fl;
    vec3 gc = mix(vec3(0.706, 0.745, 0.996), vec3(0.796, 0.651, 0.969), 0.3 + 0.4 * fl);
    gc = mix(gc, vec3(0.537, 0.706, 0.98), (1.0 - fl) * 0.25);
    c = mix(c, gc * 0.95, clamp(g * 0.85, 0.0, 1.0) * u_shower);
    c += gc * g * g * 0.12 * u_shower;
  }
#endif

#ifdef EGG_AURORA
  // northern lights
  if (u_aurora > 0.001) {
    float g = smoothstep(0.35, 1.0, uv.y);
    float gf = fbm(vec2(uv.x * 2.0 + u_time * 0.06, uv.y * 1.5 - u_time * 0.04));
    vec3 gcol = mix(vec3(0.3, 0.5, 0.95), vec3(0.35, 0.72, 0.95), gf);
    c = mix(c, gcol * 0.85, clamp(g * (0.35 + 0.35 * gf), 0.0, 1.0) * u_aurora);
    float x = uv.x * asp;
    float ta = u_time;
    vec3 aur = vec3(0.0);
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float seed = fk * 17.3;

      float wob = fbm(vec2(x * 0.55 + seed, ta * 0.045 + seed));
      float yc = 0.52 + fk * 0.1 + (wob - 0.5) * 0.45
               + 0.08 * (fbm(vec2(x * 1.6, ta * 0.07 + seed + 3.0)) - 0.5);

      float px = x * 2.3 + seed;
      float str = 0.0, bendSum = 0.0, wSum = 0.0;
      for (int j = -2; j <= 2; j++) {
        float cid = floor(px) + float(j);
        float h1 = hash12(vec2(cid, seed)), h2 = hash12(vec2(cid, seed + 1.0)), h3 = hash12(vec2(cid, seed + 2.0));
        float d = (px - (cid + 0.5 + (h1 - 0.5) * 0.5)) / (0.75 + 0.55 * h2);
        float w = max(0.0, 1.0 - d * d);
        float life = clamp(sin(6.2832 * (ta / (4.0 + 4.5 * h3) + h1)) * 0.9 + 0.3, 0.0, 1.0);
        life = life * life * (3.0 - 2.0 * life);
        str += w * w * life;

        float h4 = hash12(vec2(cid, seed + 3.0));
        float bend = (h4 - 0.5) * 0.22 * sin(ta * (0.25 + 0.3 * h2) + h3 * 6.28 + d * (1.5 + 2.0 * h1));
        bendSum += w * w * bend;
        wSum += w * w;
      }
      str = clamp(str, 0.0, 1.0);
      float dy = uv.y - (yc + bendSum / max(wSum, 1e-3));
      float hgt = 0.18 + 0.2 * fbm(vec2(x * 2.0, ta * 0.05 + seed + 9.0));
      float edge = smoothstep(-0.02, 0.012, dy);
      float curtain = edge * exp(-max(dy, 0.0) / hgt);

      float rx = x * 30.0 + dy * 6.0 + seed;
      float rn = fbm(vec2(rx, dy * 0.8 - ta * 0.35));
      float rays = 0.2 + 2.4 * rn * rn;

      float halo = exp(-abs(dy) / 0.09) * 0.35;
      float hcol = clamp(dy / hgt, 0.0, 1.5);
      float hue = fbm(vec2(x * 0.8, ta * 0.03 + seed + 5.0));
      vec3 green = mix(vec3(0.3, 1.0, 0.55), vec3(0.6, 1.0, 0.4), hue);
      vec3 teal  = mix(vec3(0.2, 0.9, 0.8), vec3(0.3, 0.75, 1.0), hue);
      vec3 upper = mix(vec3(0.62, 0.4, 1.0), vec3(0.3, 0.45, 1.0), hue);
      vec3 col = mix(green, teal, smoothstep(0.05, 0.4, hcol));
      col = mix(col, upper, smoothstep(0.35, 1.0, hcol));
      col = mix(col, vec3(0.85, 1.0, 0.9), exp(-max(dy, 0.0) / 0.015) * edge * 0.5);

      float pk = smoothstep(0.52, 0.75, fbm(vec2(x * 2.6 + seed * 2.0, dy * 3.0 + ta * 0.08)));
      col = mix(col, vec3(1.0, 0.28, 0.72), pk * (0.45 + 0.55 * smoothstep(0.1, 0.6, hcol)));
      aur += col * (curtain * rays + halo * edge + halo * 0.3) * str;
    }

    float ai = max(aur.r, max(aur.g, aur.b));
    vec3 ac = aur / max(ai, 1e-3);
    c = mix(c, ac * min(0.35 + ai * 0.5, 1.0), clamp(ai * 0.75, 0.0, 0.92) * u_aurora);
  }
#endif

  float darkIn = 0.0;
#ifdef EGG_DARK
  // dark moon: the moon turns into a dark disc with a glowing rim
  if (u_dark > 0.001) {
    float e = u_dark;
    e = e * e * (3.0 - 2.0 * e);

    float lumS = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, lumS * vec3(0.55, 0.7, 1.25), 0.8 * e);
    c = mix(c, vec3(0.03, 0.045, 0.12), 0.45 * e);
    vec2 mp2 = (ap + 0.5) / u_res.y;

    const float HZ = 0.0;
    float R = 0.86 * clamp(asp, 0.45, 1.0);
    float zk = R / 0.86;
    vec2 cen = vec2(0.5 * asp, HZ);
    vec2 dv = mp2 - cen;
    dv.x /= 1.1;
    float r = length(dv);
    vec2 dz = dv / zk;

    float out_ = max(r - R, 0.0);
    float halo = exp(-out_ / 0.05) * 0.95 + exp(-out_ / 0.2) * 0.5 + exp(-out_ / 0.55) * 0.18;
    c = mix(c, vec3(0.74, 0.82, 1.0), clamp(halo, 0.0, 1.0) * step(R, r) * step(HZ, mp2.y) * e);
    if (r < R && mp2.y > HZ) {
      float rn = r / R;
      float ang = atan(dv.y, dv.x);

      float neb = smoothstep(0.45, 0.85, fbm(dz * 4.0 + vec2(0.0, u_time * 0.02)));
      float wisp = fbm(vec2(ang * 6.0, rn * 3.0 - u_time * 0.03));
      float streak = pow(vnoise(vec2(ang * 140.0, rn * 2.0 - u_time * 0.05)), 6.0) * smoothstep(0.3, 0.9, rn);
      vec3 inner = vec3(0.025, 0.035, 0.1) + vec3(0.45, 0.55, 0.95) * neb * wisp * 0.6
                 + vec3(0.6, 0.7, 1.0) * streak * 0.55;
      vec2 g1 = dz - vec2(0.42, 0.62);
      g1 = vec2(g1.x * 0.92 + g1.y * 0.38, -g1.x * 0.38 + g1.y * 0.92) * vec2(1.0, 3.2);
      vec2 g2 = dz - vec2(-0.34, 0.8);
      g2 = vec2(g2.x * 0.9 - g2.y * 0.44, g2.x * 0.44 + g2.y * 0.9) * vec2(1.0, 2.6);
      inner += vec3(0.95, 0.85, 1.0) * (exp(-dot(g1, g1) / 0.0012) + exp(-dot(g2, g2) / 0.0008) * 0.8);

      float rimW = (0.035 + 0.035 * fbm(vec2(ang * 3.0, 2.0)) + 0.09 * pow(max(0.0, cos(ang - 0.75)), 2.0)) * zk;
      float into = (r - (R - rimW)) / rimW;

      float crustM = smoothstep(-1.6, 1.0, into + (fbm(dz * 7.0 + 3.0) - 0.5) * 1.6);
      crustM *= crustM;
      float cr = fbm(dz * 22.0);
      float cr2 = vnoise(dz * 60.0);
      vec3 crust = vec3(0.88, 0.92, 1.0) * (0.78 + 0.5 * cr) * (0.9 + 0.3 * cr2);
      crust *= mix(0.4, 1.35, smoothstep(-0.5, 1.0, into));
      crust += vec3(0.22, 0.27, 0.34) * smoothstep(0.3, 1.0, into) * cr;
      vec3 moonC = mix(inner, crust, clamp(crustM, 0.0, 1.0));
      c = mix(c, moonC, e);
      darkIn = e * (1.0 - clamp(crustM, 0.0, 1.0));
    }

    vec2 sd = dv / max(r, 1e-3);
    vec2 sp = mp2 * 4.0 - sd * u_time * 0.12 + vec2(0.0, -u_time * 0.05);
    sp += 0.8 * vec2(fbm(sp + 1.3 + u_time * 0.03), fbm(sp + 7.1 - u_time * 0.03));
    float smoke = fbm(sp * 1.3);
    float around = exp(-max(r - R, 0.0) / 0.13) * smoothstep(R - 0.12, R - 0.02, r);
    around *= 0.55 + 0.45 * smoothstep(0.6, 0.1, mp2.y / max(R, 1e-3));
    float horizon = exp(-abs(mp2.y - HZ) / 0.07);
    float sm = smoothstep(0.35, 0.8, smoke) * (around * 1.1 + horizon * 0.9);
    c = mix(c, vec3(0.62, 0.67, 0.95), clamp(sm, 0.0, 0.85) * e);
  }
#endif

  c = floor(c * (STEPS - 1.0) + bayer4(ap)) / (STEPS - 1.0);

#ifdef EGG_DARK
  if (darkIn > 0.01) {
    float h = hash12(ap * 2.13 + 91.0);
    if (h < 0.09 * darkIn) {
      float b = hash12(ap + 44.0);
      float tw = 0.6 + 0.4 * sin(u_time * (1.5 + b * 4.0) + b * 50.0);
      vec3 dc = mix(vec3(0.7, 0.78, 1.0), vec3(1.0, 1.0, 1.0), b);
      if (hash12(ap + 7.7) > 0.9) dc = vec3(0.58, 0.886, 0.835);
      c = mix(c, dc, (0.35 + 0.65 * b * b * b) * tw * darkIn);
    }
  }
#endif

#ifdef EGG_SHOWER
  if (u_shower > 0.001) {
    float gs = smoothstep(0.2, 0.95, uv.y);
    if (hash12(ap * 1.91 + 53.0) < gs * 0.08 * u_shower) {
      float b = hash12(ap + 21.3);
      float tw = 0.5 + 0.5 * sin(u_time * (2.0 + b * 4.0) + b * 60.0);
      vec3 sc3 = mix(vec3(0.796, 0.651, 0.969), vec3(0.95, 0.94, 1.0), b);
      c = mix(c, sc3, (0.35 + 0.6 * b * b) * tw * u_shower);
    }
  }
#endif

#ifdef EGG_MILKY
  if (u_milky > 0.001) {
    float h = hash12(ap * 1.37 + 17.0);
    float dens = 0.035 + 0.3 * clamp(milkyBand, 0.0, 1.0);
    if (h < dens * u_milky) {
      float b = hash12(ap + 3.1);
      float tw = 0.55 + 0.45 * sin(u_time * (1.5 + b * 4.0) + b * 40.0);
      float hue = hash12(ap + 9.7);
      vec3 dc = mix(vec3(0.706, 0.745, 0.996), vec3(1.0, 0.97, 0.92), b);
      dc = mix(dc, hue < 0.5 ? vec3(0.537, 0.706, 0.98) : vec3(0.98, 0.702, 0.529), step(0.8, abs(hue - 0.5) * 2.0) * 0.7);
      c = mix(c, dc, (0.25 + 0.65 * b * b * b) * tw * u_milky);
    }
  }
#endif

  for (int i = 0; i < ${STAR_COUNT}; i++) {
    float age = u_star[i].z;
    if (age < 0.0) continue;
    float life = 1.0 - age / ${STAR_LIFE.toFixed(2)};
    if (life <= 0.0) continue;
    vec2 r = (fc - (u_star[i].xy + 0.5)) / u_star[i].w;
    float size = sin(3.14159 * (1.0 - life));
    float L = 0.5 + size * 2.0;
    float core = exp(-dot(r, r) / (0.26 * (0.33 + size * 0.67)));
    float rays = max(exp(-r.y * r.y / 0.03) * max(0.0, 1.0 - abs(r.x) / L),
                     exp(-r.x * r.x / 0.03) * max(0.0, 1.0 - abs(r.y) / L));
    float a = clamp(max(core, rays) * min(1.0, age * 6.0) * min(1.0, life * 2.5), 0.0, 1.0);
    a = floor(a * 4.0 + 0.3) / 4.0;

    float glow = exp(-dot(r, r) / (1.2 + size * 4.0)) * 0.45 * size * min(1.0, age * 6.0);
    glow = floor(glow * 6.0 + bayer4(ap)) / 6.0;
    c = mix(c, vec3(0.62, 0.45, 0.92), glow);
    vec3 sc = mix(vec3(1.0, 0.84, 0.2), vec3(1.0, 0.97, 0.85), 0.5 + 0.5 * sin(age * 16.0 + float(i) * 2.1));
    c = mix(c, sc, a);
  }

  if (md <= MR) {
    vec3 m = vec3(1.0, 1.0, 1.0);
    vec2 lightOff = vec2(-2.0 + 0.7 * sin(u_time * 0.25), 1.5);
    if (length(mo - lightOff) - MR > (bayer4(ap) - 0.5) * 2.0)
      m = vec3(0.82, 0.85, 1.0);
    if (length(mo - vec2(-3.0, 3.0)) < 2.2 ||
        length(mo - vec2(3.0, -2.0)) < 1.6 ||
        length(mo - vec2(2.0, 4.0)) < 1.1 ||
        length(mo - vec2(-4.0, -3.0)) < 1.0) m = vec3(0.9, 0.92, 1.0);
    c = mix(c, m, mVis);
  }

  for (int si = 0; si < SHOOT_N; si++) {
    float u_shootAge = u_shootB[si].x;
    if (u_shootAge < 0.0) continue;
    float u_shootScale = u_shootB[si].y;
    vec2 p0 = u_shootA[si].xy;
    float life = 1.0 - u_shootAge / ${SHOOT_LIFE.toFixed(2)};
    float fade = min(1.0, life * 3.0);
    vec2 v = u_shootA[si].zw;
    vec2 dir = normalize(v);
    vec2 acc = u_shootB[si].zw;
    #define SHOOT_POS(tt) (p0 + v * (tt) + 0.5 * acc * (tt) * (tt) + 0.5)
    vec2 head = SHOOT_POS(u_shootAge);
    float shimmer = 0.5 + 0.5 * sin(u_shootAge * 20.0);

    vec2 q = ap + 0.5;
    float tailLen = 65.0 * min(1.0, u_shootAge * 3.0) * u_shootScale;
    float tailT = min(tailLen / length(v), u_shootAge);
    float best = 1e9, bestF = 0.0;
    for (int k = 0; k < 8; k++) {
      float fk = float(k);
      vec2 pa = SHOOT_POS(u_shootAge - tailT * fk / 8.0);
      vec2 pb = SHOOT_POS(u_shootAge - tailT * (fk + 1.0) / 8.0);
      vec2 ab = pb - pa;
      float h = clamp(dot(q - pa, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
      float dd = length(q - pa - ab * h);
      if (dd < best) { best = dd; bestF = (fk + h) / 8.0; }
    }
    float side = best / u_shootScale;
    float f = bestF * tailT * length(v) / max(tailLen, 1e-3);
    if (f < 1.0 && tailT > 0.0) {
      float hw = f < 0.3 ? 1.3 : (f < 0.65 ? 0.9 : 0.55);
      vec3 tc, cc; float ta;
      if (f < 0.1)       { tc = vec3(0.961, 0.761, 0.906); cc = vec3(1.0, 0.98, 0.94); ta = 1.0;  }
      else if (f < 0.4)  { tc = vec3(0.796, 0.651, 0.969); cc = vec3(0.98, 0.86, 0.95); ta = 1.0;  }
      else if (f < 0.7)  { tc = vec3(0.6, 0.47, 0.82);     cc = vec3(0.961, 0.761, 0.906); ta = 0.8; }
      else               { tc = vec3(0.45, 0.34, 0.66);    cc = vec3(0.796, 0.651, 0.969); ta = 0.55; }
      float fa = floor(fade * 4.0 + 0.5) / 4.0;
      if (side < hw * 0.4) {
        c = mix(c, cc, ta * fa);
      } else if (side < hw) {
        c = mix(c, tc, ta * fa);
      } else if (side < hw + 0.75 && f < 0.65) {
        c = mix(c, vec3(0.42, 0.28, 0.58), 0.6 * fa);
      }
    }

    vec2 r = (fc - head) / (u_shootScale * 1.5);

    float hg = exp(-dot(r, r) / 5.2) * 0.45 * fade;
    hg = floor(hg * 6.0 + bayer4(ap)) / 6.0;
    c = mix(c, vec3(0.62, 0.45, 0.92), hg);
    float L = 4.5;
    float core = exp(-dot(r, r) / 1.8);
    float rays = max(exp(-r.y * r.y * 10.0) * max(0.0, 1.0 - abs(r.x) / L),
                     exp(-r.x * r.x * 10.0) * max(0.0, 1.0 - abs(r.y) / L));
    float a = floor(clamp(max(core, rays) * fade, 0.0, 1.0) * 4.0 + 0.3) / 4.0;
    c = mix(c, mix(vec3(1.0, 0.84, 0.2), vec3(1.0, 0.97, 0.85), shimmer), a);
  }

  gl_FragColor = vec4(c, 1.0);
}`;

const canvas = document.getElementById('bg');

function hexToRgb01(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function makeNoise(gl) {
  const N = 256, P = NOISE_P;
  const data = new Uint8Array(N * N * 4);
  const rnd = (x, y, o) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + o * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const octave = (u, v, cells, o) => {
    const x = u * cells, y = v * cells;
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = xi % cells, y0 = yi % cells, x1 = (xi + 1) % cells, y1 = (yi + 1) % cells;
    const a = rnd(x0, y0, o), b = rnd(x1, y0, o), c = rnd(x0, y1, o), d = rnd(x1, y1, o);
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      let f = 0, amp = 0.5;
      for (let o = 0; o < 5; o++) { f += amp * octave(u, v, P << o, o); amp *= 0.5; }
      const k = (j * N + i) * 4;
      data[k] = Math.round(f * 255);
      data[k + 1] = Math.round(octave(u, v, P, 9) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
  }
  return sh;
}

function initWebGL() {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('no webgl');

  const par = gl.getExtension('KHR_parallel_shader_compile');
  // values passed from js to the shader every frame
  const UNIFORMS = ['u_res', 'u_time', 'u_milky', 'u_rip', 'u_trail', 'u_trailEnd', 'u_star',
                    'u_shootA', 'u_shootB', 'u_shower', 'u_aurora', 'u_dark'];
  const EGG_DEFS = { milky: 'EGG_MILKY', shower: 'EGG_SHOWER', aurora: 'EGG_AURORA', dark: 'EGG_DARK' };
  const programs = new Map();
  const ALL = Object.keys(EGG_DEFS);
  let buf, cur = null;

  // shader variants are compiled on demand and cached by key
  const request = eggs => {
    const key = eggs.slice().sort().join('+') || 'base';
    let p = programs.get(key);
    if (p) return p;
    const defs = eggs.map(e => `#define ${EGG_DEFS[e]}
`).join('')
               + `#define SHOOT_N ${eggs.includes('shower') ? SHOOTS : 2}
`;
    const prog = gl.createProgram();
    const vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vs, VERT);
    gl.shaderSource(fs, defs + FRAG);
    gl.compileShader(vs);
    gl.compileShader(fs);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    p = { key, prog, vs, fs, loc: null, ready: false, failed: false };
    programs.set(key, p);
    return p;
  };

  const poll = p => {
    if (p.ready || p.failed) return p.ready;
    if (par && !gl.getProgramParameter(p.prog, par.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(p.prog, gl.LINK_STATUS)) {
      p.failed = true;
      console.warn('[bg] shader failed:', gl.getShaderInfoLog(p.fs) || gl.getProgramInfoLog(p.prog));
      return false;
    }
    p.loc = {};
    for (const n of UNIFORMS) p.loc[n] = gl.getUniformLocation(p.prog, n);
    p.aPos = gl.getAttribLocation(p.prog, 'a_pos');
    gl.useProgram(p.prog);
    gl.uniform3fv(gl.getUniformLocation(p.prog, 'u_col'), new Float32Array(PALETTE.flatMap(hexToRgb01)));
    p.ready = true;
    return true;
  };

  const use = p => {
    if (cur === p) return;
    cur = p;
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(p.aPos);
    gl.vertexAttribPointer(p.aPos, 2, gl.FLOAT, false, 0, 0);
  };

  const setup = () => {
    programs.clear();
    cur = null;

    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    makeNoise(gl);

    request(ALL);
    progress(0.35);
  };
  setup();

  // accent colour of each egg. It is also used by the page css (--glow, --egg-accent)
  const GLOW = { milky: '#eef0ff', shower: '#fab387', aurora: '#a6e3a1', darkmoon: '#74c7ec' };
  const activeEggs = [];
  const setEgg = (key, on) => {
    const i = activeEggs.indexOf(key);
    if (i >= 0) activeEggs.splice(i, 1);
    if (on) activeEggs.push(key);
    const top = activeEggs[activeEggs.length - 1];
    const root = document.documentElement;
    if (top) root.style.setProperty('--glow', GLOW[top]);
    else root.style.removeProperty('--glow');

    if (top) root.style.setProperty('--egg-accent', GLOW[top]);
    else root.style.removeProperty('--egg-accent');
    root.classList.toggle('egg-accent', !!top);
  };

  // only one egg can be on at a time. eggs.js sends egg:set events
  const eggSwitch = {};
  const egg = (key, label, apply) => {
    const t = debugToggle(key, label, false, apply, 'egg');
    eggSwitch[key] = on => (t.set ? t.set(on) : apply(on));
  };
  window.addEventListener('egg:set', e => {
    const { key, on } = e.detail;
    if (!eggSwitch[key]) return;
    if (on) for (const k in eggSwitch) if (k !== key) eggSwitch[k](false);
    eggSwitch[key](on);
  });

  const milky = { v: 0, target: 0 };
  egg('milky', 'milky way', on => {
    milky.target = on ? 1 : 0;
    setEgg('milky', on);
    if (prefersReducedMotion.matches) { milky.v = milky.target; still(); }
  });
  const aurora = { v: 0, target: 0 };
  egg('aurora', 'northern lights', on => {
    aurora.target = on ? 1 : 0;
    setEgg('aurora', on);
    if (prefersReducedMotion.matches) { aurora.v = aurora.target; still(); }
  });
  const dark = { v: 0, target: 0 };
  egg('darkmoon', 'dark moon (elden ring)', on => {
    dark.target = on ? 1 : 0;
    setEgg('darkmoon', on);
    document.documentElement.classList.toggle('dark-moon', on);
    if (prefersReducedMotion.matches) { dark.v = dark.target; still(); }
  });
  const trail = [];
  const ripples = Array.from({ length: RIPPLES }, () => ({ x: 0, y: 0, s: 1, at: -1e9 }));
  const stars = Array.from({ length: STAR_COUNT }, () => ({ x: 0, y: 0, s: 1, at: -1e9 }));
  const shoots = Array.from({ length: SHOOTS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, s: 1, at: -1e9 }));
  let nextShoot = 0.5 + Math.random();

  const shower = { on: false, v: 0, side: 1, ang: 0.6, next: 0 };
  egg('shower', 'meteor shower', on => {
    shower.on = on;
    setEgg('shower', on);
    if (on) {
      shower.side = Math.random() < 0.5 ? -1 : 1;
      shower.ang = (25 + Math.random() * 25) * Math.PI / 180;
      shower.next = time;
    }
  });
  let nextStar = 0.5;
  let time = 0, last = 0, raf = 0;

  const wanted = () => ALL;
  let eggReady = false;

  const render = () => {
    const want = request(wanted());
    let p = poll(want) ? want : null;
    if (!p) {
      if (want.failed) { fail(); return false; }
      p = cur && cur.ready ? cur : null;
    }
    eggReady = p === want;
    if (!p) return false;
    use(p);
    const loc = p.loc;
    gl.uniform2f(loc.u_res, canvas.width / SUB, canvas.height / SUB);
    gl.uniform1f(loc.u_time, time);
    gl.uniform1f(loc.u_milky, milky.v);
    const rd = new Float32Array(RIPPLES * 4);
    ripples.forEach((rp, i) => {
      const age = time - rp.at;
      rd[i * 4] = rp.x; rd[i * 4 + 1] = rp.y; rd[i * 4 + 2] = age < RIPPLE_LIFE ? age : -1; rd[i * 4 + 3] = rp.s;
    });
    gl.uniform4fv(loc.u_rip, rd);
    const td = new Float32Array(TRAIL * 4);
    let end = 0;
    trail.forEach((tp, i) => {
      const age = time - tp.at;
      const ok = age < TRAIL_LIFE;
      td[i * 4] = tp.x; td[i * 4 + 1] = tp.y; td[i * 4 + 2] = ok ? age : -1; td[i * 4 + 3] = tp.link;
      if (ok) end = Math.max(end, age);
    });
    for (let i = trail.length; i < TRAIL; i++) td[i * 4 + 2] = -1;
    gl.uniform4fv(loc.u_trail, td);
    gl.uniform1f(loc.u_trailEnd, end);
    const sd = new Float32Array(STAR_COUNT * 4);
    stars.forEach((st, i) => {
      const age = time - st.at;
      sd[i * 4] = st.x; sd[i * 4 + 1] = st.y; sd[i * 4 + 2] = age < STAR_LIFE ? age : -1; sd[i * 4 + 3] = st.s;
    });
    gl.uniform4fv(loc.u_star, sd);
    const sA = new Float32Array(SHOOTS * 4), sB = new Float32Array(SHOOTS * 4);
    shoots.forEach((sh, i) => {
      const age = time - sh.at;
      sA.set([sh.x, sh.y, sh.vx, sh.vy], i * 4);
      sB.set([age < SHOOT_LIFE ? age : -1, sh.s, sh.ax, sh.ay], i * 4);
    });
    gl.uniform4fv(loc.u_shootA, sA);
    gl.uniform4fv(loc.u_shootB, sB);
    gl.uniform1f(loc.u_shower, shower.v);
    gl.uniform1f(loc.u_aurora, aurora.v);
    gl.uniform1f(loc.u_dark, dark.v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!canvas.classList.contains('ready')) {
      canvas.classList.add('ready');
      ready('bg');
    }
    return true;
  };

  // WebGL died (context lost etc.): fall back to the 2D orbs
  const fail = () => {
    cancelAnimationFrame(raf);
    raf = -1;
    ready('bg');
    const fresh = canvas.cloneNode(false);
    fresh.className = '';
    canvas.replaceWith(fresh);
    import('./bg-orbs.js');
  };

  const resize = () => {
    canvas.width  = Math.max(2, Math.ceil(window.innerWidth  / PIXEL_SIZE)) * SUB;
    canvas.height = Math.max(2, Math.ceil(window.innerHeight / PIXEL_SIZE)) * SUB;
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (prefersReducedMotion.matches) still();
  };

  const launch = (side, ang, speedMul, top, slots = 2) => {
    const sh = shoots.slice(0, slots).find(x => time - x.at >= SHOOT_LIFE);
    if (!sh) return;
    const w = canvas.width / SUB, h = canvas.height / SUB;
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

  const frame = now => {
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    time += dt;
    if (dark.target === 0 && time >= nextStar) {
      const st = stars.find(s => time - s.at >= STAR_LIFE);
      if (st) {
        st.x = Math.floor(Math.random() * canvas.width / SUB);
        st.y = Math.floor(Math.random() * canvas.height / SUB);
        st.s = STAR_SCALE * Math.pow(1.5, Math.random() * 2 - 1);
        st.at = time;
      }
      nextStar = time + 0.04 + Math.random() * 0.25;
    }
    if (!shower.on && aurora.target === 0 && dark.target === 0 && time >= nextShoot) {
      const side = Math.random() < 0.5 ? -1 : 1;
      launch(side, (15 + Math.random() * 50) * Math.PI / 180, 1, 0.75);
      nextShoot = time + SHOOT_LIFE + Math.random() * 1.0;
    }
    if (shower.on && eggReady && dark.target === 0 && time >= shower.next) {
      const jitter = (Math.random() - 0.5) * 0.12;
      launch(shower.side, shower.ang + jitter, 1.25, 0.5, SHOOTS);
      shower.next = time + 0.08 + Math.random() * 0.22;
    }

    // values fade towards their targets, so effects blend in and out smoothly
    const ease = (o, tgt, rate) => { if (tgt < o.v || eggReady) o.v += (tgt - o.v) * Math.min(1, dt * rate); };
    ease(shower, shower.on ? 1 : 0, 0.8);
    ease(dark, dark.target, dark.target ? 0.35 : 0.7);
    ease(aurora, aurora.target, 0.8);
    ease(milky, milky.target, 1.5);
    fingerStep();
    render();
    if (raf !== -1) raf = requestAnimationFrame(frame);
  };

  const still = () => {
    if (!render() || !eggReady) setTimeout(still, 120);
  };

  const start = () => {
    cancelAnimationFrame(raf);
    last = 0;
    if (prefersReducedMotion.matches) {
      time = 25;
      still();
    } else {
      raf = requestAnimationFrame(frame);
    }
  };

  const addRipple = (cx, cy, strength) => {
    const rp = ripples.reduce((a, b) => (a.at < b.at ? a : b));
    rp.x = cx / PIXEL_SIZE;
    rp.y = (window.innerHeight - cy) / PIXEL_SIZE;
    rp.s = strength;
    rp.at = time;
  };

  const finger = { down: false, x: 0, y: 0, lastX: 0, lastY: 0, lastAt: 0 };
  const onBackground = el => !el.closest('.glass, .footer');

  document.addEventListener('pointerdown', e => {
    if (prefersReducedMotion.matches || e.button !== 0) return;
    addRipple(e.clientX, e.clientY, 0.7 + Math.random() ** 1.5 * 0.9);
    if (!onBackground(e.target)) return;
    e.preventDefault();
    Object.assign(finger, { down: true, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, lastAt: time });
    addTrail(e.clientX, e.clientY, 0);
  });
  document.addEventListener('pointermove', e => {
    if (!finger.down) return;
    finger.x = e.clientX; finger.y = e.clientY;
  });
  const lift = () => { finger.down = false; };
  document.addEventListener('pointerup', lift);
  document.addEventListener('pointercancel', lift);
  window.addEventListener('blur', lift);

  const addTrail = (cx, cy, link) => {
    trail.push({ x: cx / PIXEL_SIZE, y: (window.innerHeight - cy) / PIXEL_SIZE, at: time, link });
    while (trail.length > TRAIL || (trail.length && time - trail[0].at > TRAIL_LIFE)) trail.shift();
  };

  const fingerStep = () => {
    if (!finger.down) return;
    const moved = Math.hypot(finger.x - finger.lastX, finger.y - finger.lastY);
    if (moved > PIXEL_SIZE * 5) {
      addTrail(finger.x, finger.y, 1);
      finger.lastX = finger.x; finger.lastY = finger.y; finger.lastAt = time;
    } else if (time - finger.lastAt > 0.6) {
      addRipple(finger.x, finger.y, 0.4 + Math.random() * 0.1);
      finger.lastAt = time;
    }
  };

  window.addEventListener('resize', resize);
  prefersReducedMotion.addEventListener('change', start);

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); cancelAnimationFrame(raf); });
  canvas.addEventListener('webglcontextrestored', () => { setup(); resize(); start(); });

  resize();
  start();
}

try {
  initWebGL();
  canvas.classList.add('gl');
} catch (err) {
  console.warn('[bg] WebGL unavailable, using 2D orbs:', err.message);
  ready('bg');
  import('./bg-orbs.js');
}
