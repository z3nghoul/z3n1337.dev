import { prefersReducedMotion } from './config.js';

// the ears and whiskers wobble like a hand drawing: the seed of their svg noise filter
// changes about 8 times a second
const noises = [...document.querySelectorAll('#ears-boil feTurbulence')];
if (noises.length && !prefersReducedMotion.matches) {
  let n = 0;
  setInterval(() => {
    if (document.hidden) return;
    // a different offset per drawing, so they do not wobble in sync
    noises.forEach((el, i) => el.setAttribute('seed', String(1 + ((n + i * 4) * 5) % 13)));
    n++;
  }, 125);
}
