import { WORKER_URL, STEAM_REFRESH_S } from './config.js';
import { poll, getJSON } from './poll.js';

// Steam status next to the label: a coloured dot plus the text for the tooltip
const dot      = document.getElementById('steam-dot');
const statusEl = document.getElementById('steam-status');
const stateEl  = document.getElementById('steam-state');
const handleEl = document.querySelector('#steam-link .link-handle');

function setStatus(text) {
  statusEl.dataset.status = text;
  stateEl.textContent = text;
}

function render({ personastate, gameextrainfo, personaname }) {
  // personastate: 1 online, 3 away, 4 snooze, 6 looking to play (shown like in-game)
  const inGame = personastate === 6 || Boolean(gameextrainfo);
  if (handleEl && personaname) handleEl.textContent = personaname;

  if (inGame) {
    dot.className = 'steam-dot steam-dot--ingame';
    setStatus(gameextrainfo || 'in-game');
  } else if (personastate === 3 || personastate === 4) {
    dot.className = 'steam-dot steam-dot--away';
    setStatus(personastate === 4 ? 'snooze' : 'away');
  } else if (personastate >= 1) {
    dot.className = 'steam-dot steam-dot--online';
    setStatus('online');
  } else {
    dot.className = 'steam-dot steam-dot--offline';
    setStatus('offline');
  }
}

// if the worker is down the dot just shows offline
async function fetchStatus() {
  try {
    render(await getJSON(`${WORKER_URL}/steam`));
  } catch {
    dot.className = 'steam-dot steam-dot--offline';
    setStatus('offline');
  }
}

poll(fetchStatus, STEAM_REFRESH_S);
