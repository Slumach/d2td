import { describe, expect, it } from 'vitest';

import { missingRunes } from './itemtext.ts';

describe('runeword progress', () => {
  it('lists the runes still missing, a rune taken twice needing two', () => {
    // Infinity: Ber Mal Ber Ist
    const infinity = ['r30', 'r23', 'r30', 'r24'];
    expect(missingRunes(infinity, new Map([['r30', 2], ['r23', 1], ['r24', 1]]))).toEqual([]);
    expect(missingRunes(infinity, new Map([['r30', 1], ['r23', 1]]))).toEqual(['r30', 'r24']);
    expect(missingRunes(infinity, undefined)).toEqual(infinity);
  });
});
