// Cloudflare Worker: keeps the Steam and Last.fm keys secret and lets the site read the data.
// STEAM_API_KEY, STEAM_ID and LASTFM_API_KEY are set as worker secrets
//
// /steam returns the status, /lastfm the current track
const LASTFM_USER = 'z3n1337';

// only the site itself (and a local dev server) may call the worker
const ALLOWED_ORIGIN = /^(https:\/\/z3n1337\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

// answers are kept for a short time, so many visitors at once don't hit the Steam / Last.fm limits.
// Cache API does not work on *.workers.dev, so this is a plain in-memory cache per worker instance
const CACHE_S = { '/steam': 30, '/lastfm': 10 };
const cache = new Map();

function headers(origin) {
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  return res.json();
}

async function handleSteam(env) {
  const data   = await getJSON(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/`
                             + `?key=${env.STEAM_API_KEY}&steamids=${env.STEAM_ID}`);
  const player = data?.response?.players?.[0];

  if (!player) return { personastate: 0 };

  return {
    personastate:  player.personastate,
    gameextrainfo: player.gameextrainfo ?? null,
    personaname:   player.personaname   ?? null,
  };
}

async function handleLastfm(env) {
  const data = await getJSON(`https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks`
                           + `&user=${LASTFM_USER}&api_key=${env.LASTFM_API_KEY}&format=json&limit=1`);

  const tracks = data?.recenttracks?.track;
  if (!tracks) return { nowplaying: false };

  const latest     = Array.isArray(tracks) ? tracks[0] : tracks;
  const nowplaying = latest['@attr']?.nowplaying === 'true';
  if (!nowplaying) return { nowplaying: false };

  const title  = latest.name            ?? null;
  const artist = latest.artist?.['#text'] ?? null;

  // Last.fm returns a grey placeholder when there is no cover, treat it as none
  const rawImage = latest.image?.[3]?.['#text'] || latest.image?.[2]?.['#text'] || null;
  const isPlaceholder = !rawImage || rawImage.includes('2a96cbd8b46e442fc41c2b86b821562f');
  const image = isPlaceholder ? null : rawImage.replace(/\/u\/\d+x\d+\//, '/u/600x600/');

  return { nowplaying: true, title, artist, image };
}

const ROUTES = { '/steam': handleSteam, '/lastfm': handleLastfm };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (!ALLOWED_ORIGIN.test(origin)) return new Response('forbidden', { status: 403 });

    const h = headers(origin);
    if (request.method === 'OPTIONS') return new Response(null, { headers: h });

    const path = new URL(request.url).pathname;
    const route = ROUTES[path];
    if (!route) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: h });

    const hit = cache.get(path);
    if (hit && Date.now() - hit.at < CACHE_S[path] * 1000) {
      return new Response(hit.body, { headers: h });
    }

    try {
      const body = JSON.stringify(await route(env));
      cache.set(path, { at: Date.now(), body });
      return new Response(body, { headers: h });
    } catch (e) {
      // upstream is down: serve the last good answer if there is one
      if (hit) return new Response(hit.body, { headers: h });
      return new Response(JSON.stringify({ error: 'upstream error' }), { status: 502, headers: h });
    }
  },
};
