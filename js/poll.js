// fetch + JSON with a time limit. Throws on a network error, a timeout or a non-2xx answer
export async function getJSON(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// calls fn right away and then every `seconds`, but only while the tab is visible
export function poll(fn, seconds) {
  let id = null;

  const start = () => {
    if (id !== null) return;
    fn();
    id = setInterval(fn, seconds * 1000);
  };
  const stop = () => {
    clearInterval(id);
    id = null;
  };

  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  if (!document.hidden) start();
}
