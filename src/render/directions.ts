// D2 direction lookup. A 64-step angle starts facing south and turns clockwise on screen
// (south, south-west, west...). Sprites store 4 to 64 directions in the game's own order;
// these tables map a 64-step angle to that order.
// Ported from OpenDiablo2 (commit 7f92c57): d2common/d2fileformats/d2dcc/dcc_dir_lookup.go.

const DIR8 = [
  4, 4, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 1, 1, 1, 1, 1, 1, 1, 1, 6, 6, 6, 6,
  6, 6, 6, 6, 2, 2, 2, 2, 2, 2, 2, 2, 7, 7, 7, 7, 7, 7, 7, 7, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4,
];
const DIR16 = [
  4, 4, 8, 8, 8, 8, 0, 0, 0, 0, 9, 9, 9, 9, 5, 5, 5, 5, 10, 10, 10, 10, 1, 1, 1, 1, 11, 11, 11, 11, 6, 6,
  6, 6, 12, 12, 12, 12, 2, 2, 2, 2, 13, 13, 13, 13, 7, 7, 7, 7, 14, 14, 14, 14, 3, 3, 3, 3, 15, 15, 15, 15, 4, 4,
];
const DIR32 = [
  4, 16, 16, 8, 8, 17, 17, 0, 0, 18, 18, 9, 9, 19, 19, 5, 5, 20, 20, 10, 10, 21, 21, 1, 1, 22, 22, 11, 11, 23, 23, 6,
  6, 24, 24, 12, 12, 25, 25, 2, 2, 26, 26, 13, 13, 27, 27, 7, 7, 28, 28, 14, 14, 29, 29, 3, 3, 30, 30, 15, 15, 31, 31, 4,
];
const DIR64 = [
  4, 32, 16, 33, 8, 34, 17, 35, 0, 36, 18, 37, 9, 38, 19, 39, 5, 40, 20, 41, 10, 42, 21, 43, 1, 44, 22, 45, 11, 46, 23, 47,
  6, 48, 24, 49, 12, 50, 25, 51, 2, 52, 26, 53, 13, 54, 27, 55, 7, 56, 28, 57, 14, 58, 29, 59, 3, 60, 30, 61, 15, 62, 31, 63,
];

/** The 64-step D2 angle of a screen-space vector (y grows downward). */
export function angle64(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const steps = Math.round((Math.atan2(-dx, dy) / (2 * Math.PI)) * 64);
  return ((steps % 64) + 64) % 64;
}

/** The sprite direction index for a 64-step angle in a sprite with `count` directions. */
export function spriteDirection(angle: number, count: number): number {
  switch (count) {
    case 1:
      return 0;
    case 4:
      return [0, 1, 2, 3][Math.floor(((angle + 8) % 64) / 16)]!;
    case 8:
      return DIR8[angle]!;
    case 16:
      return DIR16[angle]!;
    case 32:
      return DIR32[angle]!;
    default:
      return DIR64[angle]! % count;
  }
}
