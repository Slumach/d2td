/** Names of the 8 facings, matching the direction names the pipeline writes into atlases. */
export type Facing8 = 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' | 'n' | 'ne';

/** Clockwise from east, in screen space where y grows downward. */
const SECTORS: readonly Facing8[] = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];

/** The 8-way facing closest to a screen-space movement vector. */
export function facingFromVector(dx: number, dy: number): Facing8 {
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return SECTORS[((sector % 8) + 8) % 8]!;
}
