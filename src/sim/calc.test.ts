import { describe, expect, it } from 'vitest';

import { diminishing, evalCalc, linear } from './calc.ts';

const ctx = (lvl: number, params: number[]) => ({ lvl, params });

describe('evalCalc', () => {
  it('evaluates the linear helpers like the game', () => {
    // Might damage: ln34 with Param3 = 40, Param4 = 10
    expect(evalCalc('ln34', ctx(1, [16, 2, 40, 10]))).toBe(40);
    expect(evalCalc('ln34', ctx(20, [16, 2, 40, 10]))).toBe(230);
    expect(linear(16, 2, 5)).toBe(24);
  });

  it('evaluates the diminishing helpers like the game', () => {
    // Holy Freeze slow: -dm34 with 25 and 60 gives 30% at level 1
    expect(evalCalc('-dm34', ctx(1, [6, 1, 25, 60]))).toBe(-30);
    expect(diminishing(25, 60, 20)).toBe(25 + Math.trunc((110 * 20 * 35) / (100 * 26)));
  });

  it('handles min, max, ternaries, comparisons and quotes', () => {
    expect(evalCalc('"-min(ln34,150)"', ctx(30, [0, 0, 30, 5]))).toBe(-150);
    expect(evalCalc('"min((par5 + lvl -1), par6)"', ctx(2, [0, 0, 0, 0, 2, 5]))).toBe(3);
    expect(evalCalc('((lvl < 5) ? 0 : ((lvl-4) * par4))', ctx(3, [0, 0, 0, 6]))).toBe(0);
    expect(evalCalc('((lvl < 5) ? 0 : ((lvl-4) * par4))', ctx(10, [0, 0, 0, 6]))).toBe(36);
    expect(evalCalc('(lvl < 4) ?lvl:(2+lvl/3)', ctx(10, []))).toBe(5);
  });

  it('treats synergies and character stats as zero', () => {
    expect(evalCalc("ln12+skill('Redemption'.blvl)*par8", ctx(1, [180, 15, 0, 0, 0, 0, 0, 15]))).toBe(180);
    expect(evalCalc("stat('item_pierce_damage_immunity'.accr)", ctx(1, []))).toBe(0);
  });

  it('truncates division toward zero and passes plain numbers through', () => {
    expect(evalCalc('ln56/2', ctx(1, [0, 0, 0, 0, 51, 0]))).toBe(25);
    expect(evalCalc('-7/2', ctx(1, []))).toBe(-3);
    expect(evalCalc(20, ctx(1, []))).toBe(20);
    expect(evalCalc(undefined, ctx(1, []))).toBe(0);
  });

  it('rejects unknown identifiers instead of guessing', () => {
    expect(() => evalCalc('wibble', ctx(1, []))).toThrow(/unknown identifier/);
  });
});
