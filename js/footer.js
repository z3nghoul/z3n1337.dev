import { debugLine } from './debug.js';

// the footer wraps on phones. Every part has a dot in front of it, and the last part of each
// line also gets one behind it (class "trail"), so every line starts and ends with a dot
const footer = document.querySelector('.footer');
const info = debugLine('footer');
if (footer) {
  const items = [...footer.querySelectorAll('.footer-item')];
  const mark = () => {
    items.forEach((el, i) => {
      const next = items[i + 1];
      el.classList.toggle('trail', !next || next.offsetTop > el.offsetTop + 2);
    });

    // readout for the ?debug panel
    info(items.map(el => `${Math.round(el.offsetTop)}${el.classList.contains('trail') ? ' trail' : ''} w${Math.round(el.getBoundingClientRect().width)}`).join(' | ') + `
footer w${Math.round(footer.getBoundingClientRect().width)} of ${window.innerWidth}`);
  };
  mark();
  window.addEventListener('resize', mark);
  document.fonts?.ready.then(mark);
  new ResizeObserver(mark).observe(footer);
}
