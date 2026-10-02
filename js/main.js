// entry point: every module sets itself up when it is imported
import './loader.js';
import './mail.js';
import './debug.js';
import { applyRandomTitle, initSplash } from './splashes.js';
import './bg.js';
import './eggs.js';
import './ears.js';
import './footer.js';
import './flames.js';
import './copy.js';
import './steam.js';
import './player.js';
import './player-glow.js';

// footer year and the random title / splash text
document.getElementById('footer-year').textContent = new Date().getFullYear();
applyRandomTitle();
initSplash();
