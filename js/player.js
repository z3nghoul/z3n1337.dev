import { WORKER_URL, LASTFM_POLL_S, prefersReducedMotion } from './config.js';
import { poll, getJSON } from './poll.js';
import { debugToggle } from './debug.js';

const playerEl   = document.getElementById('player');
const linkEl     = document.getElementById('player-link');
const artEl      = document.getElementById('player-art');
const titleEl    = document.getElementById('player-title');
const artistEl   = document.getElementById('player-artist');
const progressEl = document.getElementById('player-progress');
const playBtn    = document.getElementById('player-play');
const playIcon   = document.getElementById('player-play-icon');
const volBtn     = document.getElementById('player-vol-btn');
const volIcon    = document.getElementById('player-vol-icon');
const slider     = document.getElementById('player-slider');

const artCtx = artEl.getContext('2d', { willReadFrequently: true });

// the 30 s preview comes from iTunes, the "now playing" info from Last.fm via the worker
const audio = new Audio();
audio.crossOrigin = 'anonymous';
let isPlaying       = false;
let previewUrl      = null;
let currentTrackKey = null;

function setPlayIcon(playing) {
  playIcon.className = `ico ${playing ? 'ico-pause' : 'ico-play'}`;
  playBtn.setAttribute('aria-label', playing ? 'pause preview' : 'play preview');
}

// progress bar made of small blocks (one every 6px)
const blocks = [];
let progressRatio = 0;
let litCount = -1;

function paintProgress() {
  const lit = Math.floor(progressRatio * blocks.length);
  if (lit === litCount) return;
  litCount = lit;
  blocks.forEach((b, i) => b.classList.toggle('on', i < lit));
}

function layoutBlocks() {
  const n = Math.round(progressEl.clientWidth / 6);
  if (n < 1 || n === blocks.length) return;
  while (blocks.length < n) {
    const b = document.createElement('i');
    progressEl.append(b);
    blocks.push(b);
  }
  while (blocks.length > n) blocks.pop().remove();
  litCount = -1;
  paintProgress();
}
new ResizeObserver(layoutBlocks).observe(progressEl);

function setProgress(p) {
  progressRatio = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
  paintProgress();
  progressEl.setAttribute('aria-valuenow', String(Math.round(progressRatio * 100)));
}

let scrubbing = false;

function trackPlayback() {
  if (!isPlaying) return;
  if (!scrubbing && audio.duration) setProgress(audio.currentTime / audio.duration);
  requestAnimationFrame(trackPlayback);
}

audio.addEventListener('timeupdate', () => {
  if (!scrubbing && audio.duration) setProgress(audio.currentTime / audio.duration);
});
audio.addEventListener('ended', () => { isPlaying = false; setPlayIcon(false); setProgress(0); });

const canSeek = () => previewUrl && audio.duration && audio.src === previewUrl;
const ratioFromPointer = e => {
  const r = progressEl.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
};
let lastSeek = 0;
function scrubTo(ratio, force = false) {
  setProgress(ratio);
  const now = performance.now();
  if (force || now - lastSeek > 70) {
    audio.currentTime = ratio * audio.duration;
    lastSeek = now;
  }
}

progressEl.addEventListener('pointerdown', e => {
  if (!canSeek()) return;
  scrubbing = true;
  try { progressEl.setPointerCapture(e.pointerId); } catch { }
  scrubTo(ratioFromPointer(e), true);
});
progressEl.addEventListener('pointermove', e => {
  if (scrubbing) scrubTo(ratioFromPointer(e));
});
const endScrub = e => {
  if (!scrubbing) return;
  scrubbing = false;
  if (e.type === 'pointerup') scrubTo(ratioFromPointer(e), true);
};
progressEl.addEventListener('pointerup', endScrub);
progressEl.addEventListener('pointercancel', endScrub);
progressEl.addEventListener('keydown', e => {
  if (!canSeek()) return;
  const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key];
  if (step === undefined) return;
  scrubTo(Math.max(0, Math.min(1, audio.currentTime / audio.duration + step)), true);
  e.preventDefault();
});

// volume is 10 steps, saved in localStorage
const STEPS = 10;
const VOL_KEY = 'z3n-volume';
const bars = Array.from({ length: STEPS }, (_, i) => {
  const b = document.createElement('i');
  b.style.setProperty('--i', String(i));
  slider.append(b);
  return b;
});

let volume = 0.3;
let lastAudible = 0.3;
try {
  const saved = parseFloat(localStorage.getItem(VOL_KEY));
  if (Number.isFinite(saved)) volume = saved;
} catch { }

function setVolume(v) {
  volume = Math.max(0, Math.min(1, Math.round(v * STEPS) / STEPS));
  audio.volume = volume;
  if (volume > 0) lastAudible = volume;
  bars.forEach((b, i) => b.classList.toggle('on', i < volume * STEPS - 0.001));
  slider.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
  volIcon.className = `ico ${volume === 0 ? 'ico-mute' : 'ico-volume'}`;
  volBtn.setAttribute('aria-label', volume === 0 ? 'unmute' : 'mute');
  try { localStorage.setItem(VOL_KEY, String(volume)); } catch { }
}

const stepFromPointer = e => {
  const r = slider.getBoundingClientRect();
  const ratio = (e.clientX - r.left) / r.width;
  return Math.max(0, Math.min(STEPS, Math.ceil(ratio * STEPS - 0.2))) / STEPS;
};

slider.addEventListener('pointerdown', e => {
  slider.setPointerCapture(e.pointerId);
  setVolume(stepFromPointer(e));
});
slider.addEventListener('pointermove', e => {
  if (slider.hasPointerCapture(e.pointerId)) setVolume(stepFromPointer(e));
});
slider.addEventListener('keydown', e => {
  const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 2, PageDown: -2 }[e.key];
  if (d) setVolume(volume + d / STEPS);
  else if (e.key === 'Home') setVolume(0);
  else if (e.key === 'End') setVolume(1);
  else return;
  e.preventDefault();
});
slider.addEventListener('wheel', e => {
  e.preventDefault();
  setVolume(volume + (e.deltaY < 0 ? 1 : -1) / STEPS);
}, { passive: false });

volBtn.addEventListener('click', () => setVolume(volume > 0 ? 0 : lastAudible));

playBtn.addEventListener('click', () => {
  if (!previewUrl) return;
  if (isPlaying) {
    audio.pause();
    isPlaying = false;
    setPlayIcon(false);
  } else {
    if (audio.src !== previewUrl) audio.src = previewUrl;
    audio.play().then(() => { isPlaying = true; setPlayIcon(true); trackPlayback(); }).catch(() => {});
  }
});

// the cover is drawn big (ART_PX) for display and small (ART) for colours and the glow
const ART = 24;
const ART_PX = 192;
artEl.width = artEl.height = ART_PX;
const smallCtx = Object.assign(document.createElement('canvas'), { width: ART, height: ART }).getContext('2d', { willReadFrequently: true });
let artToken = 0;

const loadImage = (url, cors) => new Promise((resolve, reject) => {
  const img = new Image();
  if (cors) img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = url;
});

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// average colour of the cover, weighted towards saturated mid-tone pixels. null if the cover is grey
function pickAccent(d) {
  let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const weight = s * s * (1 - Math.abs(2 * l - 1) * 0.7);
    r += d[i] * weight; g += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
  }
  if (w < 0.6) return null;
  const [h, s] = rgbToHsl(r / w, g / w, b / w);
  return hslToHex(h, Math.max(0.5, Math.min(0.85, s)), 0.72);
}

function setAccent(hex) {
  if (hex) playerEl.style.setProperty('--art-c', hex);
  else playerEl.style.removeProperty('--art-c');
}

const publishArt = px => window.dispatchEvent(new CustomEvent('player:art', { detail: px }));

// if the image has no CORS headers it is still drawn, only the colours are skipped
async function drawArt(url) {
  const token = ++artToken;
  publishArt(null);
  let img, readable = true;
  try {
    img = await loadImage(url, true);
  } catch {
    try { img = await loadImage(url, false); readable = false; }
    catch { return; }
  }
  if (token !== artToken) return;

  artCtx.imageSmoothingEnabled = true;
  artCtx.imageSmoothingQuality = 'high';
  artCtx.drawImage(img, 0, 0, ART_PX, ART_PX);

  let accent = null;
  if (readable) {
    try {
      smallCtx.imageSmoothingEnabled = true;
      smallCtx.imageSmoothingQuality = 'high';
      smallCtx.drawImage(img, 0, 0, ART, ART);
      const data = smallCtx.getImageData(0, 0, ART, ART);
      accent = pickAccent(data.data);
      for (let i = 0; i < data.data.length; i += 4) {
        for (let c = 0; c < 3; c++) data.data[i + c] = Math.round(data.data[i + c] / 255 * 7) / 7 * 255;
      }
      publishArt(new Uint8ClampedArray(data.data));
    } catch { }
  }
  setAccent(accent);
  artEl.classList.add('loaded');
}

const silenceEl = document.getElementById('player-silence');
const bodyEl    = document.getElementById('player-body');
let morphToken = 0;

// fade times of the swap between the silence pill and the track row, and how fast the glow follows
const OUT_MS = 400, IN_MS = 500, GLOW_OUT = 8, GLOW_IN = 2.2;
const wait = ms => new Promise(r => setTimeout(r, ms));
const glowTo = (v, rate) => window.dispatchEvent(new CustomEvent('player:glow', { detail: { v, rate } }));
const fadeEl = (el, from, to, ms) => el.animate({ opacity: [from, to] }, { duration: ms, easing: 'ease-in-out', fill: 'forwards' });

// cross-fade between "silence" and "track". A newer call cancels an older one (morphToken)
async function setHasTrack(on, onSwap) {
  if (playerEl.classList.contains('has-track') === on) {
    morphToken++;
    glowTo(1, 3);
    onSwap?.();
    return;
  }
  const token = ++morphToken;

  if (prefersReducedMotion.matches) {
    playerEl.classList.toggle('has-track', on);
    onSwap?.();
    glowTo(1, 40);
    return;
  }

  const leaving = on ? [silenceEl] : [linkEl, bodyEl];
  const entering = on ? [linkEl, bodyEl] : [silenceEl];

  glowTo(0, GLOW_OUT);
  const fades = leaving.map(el => fadeEl(el, 1, 0, OUT_MS));
  await wait(OUT_MS + 20);
  if (token !== morphToken) { fades.forEach(a => a.cancel()); return; }

  playerEl.classList.toggle('has-track', on);
  fades.forEach(a => a.cancel());
  onSwap?.();
  for (const el of entering) el.animate({ opacity: [0, 1] }, { duration: IN_MS, easing: 'ease-in-out', fill: 'backwards' });
  glowTo(1, GLOW_IN);
}

function stopAudio() {
  audio.pause();
  isPlaying = false;
  setPlayIcon(false);
  setProgress(0);
}

function showSilence() {
  artToken++;
  previewUrl = null;
  stopAudio();

  setHasTrack(false, () => {
    publishArt(null);
    artEl.classList.remove('loaded');
    setAccent(null);
    linkEl.hidden = true;
    linkEl.removeAttribute('href');
  });
}

// looks up a preview url and a cover. Both can be missing
async function fetchItunes(title, artist) {
  try {
    const q    = encodeURIComponent(`${artist} ${title}`);
    const data = await getJSON(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`);
    const item = data?.results?.[0];
    return {
      previewUrl: item?.previewUrl ?? null,
      artworkUrl: item?.artworkUrl100?.replace('100x100bb', '200x200bb') ?? null,
    };
  } catch {
    return { previewUrl: null, artworkUrl: null };
  }
}

async function showTrack({ title, artist, image }) {
  const q = encodeURIComponent(`${title} ${artist}`);
  linkEl.href = `https://open.spotify.com/search/${q}`;
  linkEl.setAttribute('aria-label', `search "${title}" by ${artist} on Spotify`);
  linkEl.hidden = false;
  setHasTrack(true);

  titleEl.textContent  = title  || '—';
  artistEl.textContent = artist || '';
  titleEl.title = title || '';

  stopAudio();
  previewUrl = null;
  playBtn.disabled = true;
  artEl.classList.remove('loaded');

  const key = currentTrackKey;
  const { previewUrl: pUrl, artworkUrl } = await fetchItunes(title, artist);
  if (key !== currentTrackKey) return;

  previewUrl = pUrl;
  playBtn.disabled = !pUrl;

  const src = artworkUrl || image;
  if (src) drawArt(src);
}

// ?debug: pretend a track is playing
let fake = false;
debugToggle('track', 'fake track', false, on => {
  fake = on;
  if (on) { currentTrackKey = 'fake'; showTrack({ title: 'Sleep Paralysis', artist: 'middt', image: 'img/pfp.jpg' }); }
  else { currentTrackKey = null; showSilence(); }
});

// a new track only when artist or title changed
async function pollLastfm() {
  if (fake) return;
  try {
    const data = await getJSON(`${WORKER_URL}/lastfm`);
    if (data.nowplaying) {
      const key = `${data.artist}||${data.title}`;
      if (key !== currentTrackKey) {
        currentTrackKey = key;
        showTrack(data);
      }
    } else {
      if (currentTrackKey !== null) {
        currentTrackKey = null;
        showSilence();
      }
    }
  } catch {
    // worker down or slow: keep showing what we had, the next poll tries again
  }
}

setVolume(volume);
setPlayIcon(false);
showSilence();
poll(pollLastfm, LASTFM_POLL_S);
