// settings shared by the WebGL sky (bg.js) and its Canvas 2D fallback (bg-sky2d.js)
export const PALETTE = [
  '#5b4a8a',
  '#8b6bc0',
  '#cba6f7',
  '#8a95dc',
  '#6a5aa8',
  '#a98bd9',
  '#7287c8',
  '#6a4fa3',
];

// size of one art pixel on screen (smaller on phones)
export const PIXEL_SIZE = window.matchMedia('(max-width: 600px)').matches ? 3 : 5;
export const DARKEN = 0.6;
export const COLOR_STEPS = 9;
// sizes and lifetimes (in seconds) of the stars, the moon and shooting stars
export const STAR_COUNT = 24;
export const STAR_LIFE = 1.4;
export const STAR_SCALE = 1.04;
export const MOON_R = 9;
export const SHOOT_LIFE = 1.6;
export const SHOOT_BEND = 0.35;
export const SHOOT_SCALE = 0.77;
