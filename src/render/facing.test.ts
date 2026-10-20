import { describe, expect, it } from 'vitest';

import { facingFromVector } from './facing.ts';

describe('facingFromVector', () => {
  it('maps the four axes', () => {
    expect(facingFromVector(1, 0)).toBe('e');
    expect(facingFromVector(0, 1)).toBe('s');
    expect(facingFromVector(-1, 0)).toBe('w');
    expect(facingFromVector(0, -1)).toBe('n');
  });

  it('maps the diagonals with y pointing down', () => {
    expect(facingFromVector(1, 1)).toBe('se');
    expect(facingFromVector(-1, 1)).toBe('sw');
    expect(facingFromVector(-1, -1)).toBe('nw');
    expect(facingFromVector(1, -1)).toBe('ne');
  });

  it('snaps to the nearest sector', () => {
    expect(facingFromVector(10, 3)).toBe('e');
    expect(facingFromVector(10, 6)).toBe('se');
  });
});
