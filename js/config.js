// worker that proxies Steam and Last.fm (see cloudflare/steam-worker.js)
export const WORKER_URL     = 'https://steam-status.steamstatusz3n.workers.dev';
// how often the data is refreshed, in seconds
export const STEAM_REFRESH_S = 60;
export const LASTFM_POLL_S   = 15;

// e-mail in two parts, joined in js/mail.js
export const MAIL = ['z3nghoul', 'gmail.com'];

// the OS "reduce motion" setting is ignored on purpose, the animation is the whole page.
// the object keeps the old name so the modules that check it still work
export const prefersReducedMotion = { matches: false, addEventListener() {}, removeEventListener() {} };
