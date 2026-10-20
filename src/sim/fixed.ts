// Integer helpers. Every sim value is an integer; these keep it that way.

export const TICKS_PER_SECOND = 20;
/** Fixed-point position units per tile. */
export const UNITS_PER_TILE = 1000;
/**
 * monstats Velocity and missiles Vel are both D2 speed units. One unit is this many
 * sim position units per tick, so a Zombie (Velocity 1) walks 0.6 tiles per second.
 * A TD tuning constant, not a D2 number.
 */
export const VELOCITY_TO_UNITS_PER_TICK = 30;
/** D2 animates and times missiles at 25 frames per second. */
export const D2_FRAMES_PER_SECOND = 25;

/**
 * Integer division truncating toward zero. Exact for safe integers: the double quotient
 * is off by at most q * 2^-53, which stays below the 1/b gap to the next integer while
 * |a| < 2^53.
 */
export function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Floor of the square root of a non-negative integer, by Newton's method in integers. */
export function isqrt(n: number): number {
  if (n < 0) throw new Error(`isqrt of negative ${n}`);
  if (n < 2) return n;
  let x = n;
  let y = idiv(x + 1, 2);
  while (y < x) {
    x = y;
    y = idiv(x + idiv(n, x), 2);
  }
  return x;
}

/** D2 frame count to sim ticks, rounded down. */
export function d2FramesToTicks(frames: number): number {
  return idiv(frames * TICKS_PER_SECOND, D2_FRAMES_PER_SECOND);
}
