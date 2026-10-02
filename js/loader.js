const root = document.getElementById('loader');
const bar = root?.querySelector('.lb');

// sparks that fly off both ends of the loading bar
const SPARK_COLORS = ['#fffaf0', '#f5c2e7', '#cba6f7', '#f9e2af', '#b4befe'];
for (const box of root ? root.querySelectorAll('.lb-sparks') : []) {
  for (let i = 0; i < 12; i++) {
    const s = document.createElement('i');
    const snap = v => Math.round(v);
    s.style.setProperty('--dx', `${snap(-6 - Math.random() * 40)}px`);
    s.style.setProperty('--dy', `${snap((Math.random() - 0.5) * 18)}px`);
    s.style.setProperty('--t', `${(0.8 + Math.random() * 0.9).toFixed(2)}s`);
    s.style.setProperty('--d', `${(-Math.random() * 1.7).toFixed(2)}s`);
    s.style.setProperty('--c', SPARK_COLORS[i % SPARK_COLORS.length]);
    box.append(s);
  }
}

let target = 0.05;
let finished = false;
// the loader goes away when everything in this set has reported ready()
const waits = new Set(['bg', 'fonts']);

const apply = p => bar?.style.setProperty('--p', p.toFixed(3));

// the bar only moves forward and never reaches 100% before ready()
export function progress(p) {
  if (finished) return;
  target = Math.max(target, Math.min(0.95, p));
  apply(target);
}

export function ready(key) {
  waits.delete(key);
  if (waits.size || finished) return;
  finished = true;
  apply(1);
  setTimeout(() => root?.classList.add('done'), 450);
  setTimeout(() => root?.remove(), 1500);
}

if (root) {
  apply(target);

  // crawl forward a bit so the bar never looks stuck
  const creep = setInterval(() => {
    if (finished) { clearInterval(creep); return; }
    progress(target + (0.95 - target) * 0.04);
  }, 250);
  document.fonts.ready.then(() => { progress(target + 0.1); ready('fonts'); });

  // give up waiting after 7 s
  setTimeout(() => { waits.clear(); ready('timeout'); }, 7000);
} else {
  waits.clear();
}
