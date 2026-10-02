// random lines for the page title / the text next to the nickname
const SPLASHES = [
  "tactical reload",
  "why do you hate the future?",
  "niko, let's go bowling",
  "war... war never changes",
  "the cake is a lie",
  "do a barrel roll",
  "stay a while and listen",
  "all your base are belong to us",
  "wake me... when you need me",
  "i used to be an adventurer like you",
  "it's dangerous to go alone",
  "the floor is lava (literally)",
  "you died",
  "Try again",
  "press F to pay respects",
  "git gud",
  "a man chooses, a slave obeys",
  "would you kindly",
  "the numbers mason, what do they mean",
  "keep your friends close",
  "don't make a girl a promise",
  "remember, no russian",
  "follow the damn train cj",
  "wasted",
  "what is a man? a miserable little pile of secrets",
  "perfectly balanced as all things should be",
  "respawn in 3... 2... 1...",
  "zero fall damage, all skill",
  "saving private me",
  "my kda is a work of art",
  "softlocked in real life",
  "skill ceiling: the sky",
  "uninstalling feelings",
  "catboy / vibes",
  "now with 20% more nya",
  "certified catboy moment",
  "my pronouns are nya/meow",
  "actual femboy detected",
  "caffeine speedrun any%",
  "i have a type: fictional",
  "they were roommates",
  "he's actually sleep-deprived btw",
  "i simp therefore i am",
  "i am the moment (trust me bro)",
  "there is a gamer soul in me",
  "sleep deprivation",
  "sleep is a myth",
  "my timezone is 4am",
  "404: sleep not found",
  "will sleep when i'm dead",
  "running on fumes and spite",
  "5am is just early morning right",
  "went to bed yesterday (this week)",
  "sleep schedule: nonexistent",
  "i'll fix it tomorrow (i won't)",
  "catboy / femboy",
  "catboy rights",
  "paws up",
  "femboy adjacent",
  "not a phase (it's a lifestyle choice)",
  "catboys are valid actually",
  "built like a catboy, plays like a gremlin",
  "nyaing internally",
  "tail goes swish",
  "gamer with cat ears, what of it",
  "hoodie + cat ears is a personality",
  "chronically online",
  "no skill issue here",
  "touch grass? in this economy?",
  "top fragging professionally",
  "built different (not really)",
  "currently winning ranked",
  "probably crying rn",
  "monster energy is a personality",
  "in my flop era",
  "W rizz, L sleep schedule",
  "running on monsters and delusion",
  "i use arch btw",
  "certified brainrot moment",
  "crying in 144hz",
  "my damage output is legendary",
  "living rent free in my head",
  "it's not a phase mom it's a lifestyle",
  "gamer fuel: monsters and anxiety",
  "buffering...",
  "high on mana, low on cope",
  "main character syndrome (self-diagnosed)",
  "this is fine",
  "new phone who dis",
  "i am speed (i am not)",
  "i carry the whole team",
  "one more game (it's 4am)",
  "alt+f4 yourself",
  "ragequit prevention: successful",
  "loading... please wait",
  "out of stamina irl",
  "pressing W in real life",
  "my build is broken (in a good way)",
  "disconnected from reality",
  "currently in my villain arc",
  "i eat lag for breakfast",
  "not a bug, a feature",
  "dopamine deficiency",
  "it's fine",
  "no home, no life",
  "i ran out of slots",
  "went for water and never came back",
  "don't worry, everything will be fine",
  "a python-free environment!",
  "have you finished your homework?",
  "currently vibecoding",
  "such good vibes",
  "ai engineering"
];

// alternative nicknames, picked 1 time out of 10
const SPLASHES_AKA = [
  "aka z3n1337",
  "aka z3n_ghoul",
  "aka yamielfy",
  "aka thedarkelfy",
];

export function applyRandomTitle() {
  const pool = Math.random() < 0.1 ? SPLASHES_AKA : SPLASHES;
  document.title = pool[Math.floor(Math.random() * pool.length)];
}

// the splash shrinks to fit the free space, EGG_SCALE makes egg riddles a bit bigger
const BASE_FONT = 17;
const EGG_SCALE = 1.2;

// on phones the splash may wrap to two lines, on desktop it stays on one line and shrinks
const PHONE = window.matchMedia('(max-width: 600px)');
let el = null, fit = () => {}, regular = '';

export function initSplash() {
  el = document.getElementById('splash');
  const nick = el?.parentElement;
  if (!el) return;
  fit = () => {
    const z = nick.currentCSSZoom || 1;
    const nr = nick.getBoundingClientRect();
    if (PHONE.matches) {
      const k = el.classList.contains('egg') ? EGG_SCALE : 1;
      const room = Math.max(120, (window.innerWidth - (nr.right + 34 * z) - 30) / z);
      el.style.maxWidth = `${room}px`;
      el.style.whiteSpace = 'normal';
      let fs = BASE_FONT * k;
      el.style.fontSize = `${fs}px`;
      while (fs > 11 && el.offsetHeight > fs * 1.1 * 2.3) { fs -= 0.5; el.style.fontSize = `${fs}px`; }
      window.dispatchEvent(new Event('splash:fit'));
      return;
    }
    // desktop: shrink the font until the text fits on one line
    const room = (window.innerWidth - (nr.right + 10) - 16) / z;

    el.style.maxWidth = 'none';
    el.style.whiteSpace = 'nowrap';
    const k = el.classList.contains('egg') ? EGG_SCALE : 1;
    const base = BASE_FONT * k;
    el.style.fontSize = `${base}px`;
    const w = el.scrollWidth * 0.97;
    const fs = Math.min(base, Math.max(8, base * room / w));
    el.style.fontSize = `${fs.toFixed(1)}px`;
    window.dispatchEvent(new Event('splash:fit'));
  };

  regular = document.title;
  el.textContent = regular;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  fit();
  window.addEventListener('resize', fit);
  PHONE.addEventListener('change', fit);
  document.fonts.ready.then(fit);
}

export const splashEl = () => el;

// ALL-CAPS words in egg riddles get underlined (class "kw")
export function setSplash(text, egg = false, animate = true) {
  if (!el) return;
  const t = text ?? regular;
  el.textContent = '';
  if (egg) {
    for (const part of t.split(/(\b[A-Z]{2,}\b)/)) {
      if (!part) continue;
      if (/^[A-Z]{2,}$/.test(part)) el.append(Object.assign(document.createElement('span'), { className: 'kw', textContent: part }));
      else el.append(part);
    }
  } else {
    el.textContent = t;
  }
  el.classList.toggle('egg', egg);
  fit();
  if (animate) el.animate({ opacity: [0, 1] }, { duration: 350, easing: 'ease-out' });
}

// the egg has been found: the splash is plain text again, not clickable
export function spendSplash() {
  el?.classList.add('spent');
  el?.removeAttribute('tabindex');
  el?.removeAttribute('role');
}
