import { describe, expect, it } from 'vitest';

import { DESIGN } from '../../data/design.ts';
import { hasTables, loadTables } from '../../../tools/lib/load-tables.ts';
import { buildGameData, type GameData } from '../data.ts';
import { placeTower, testSim } from '../testkit.ts';
import { canWear, wearProblem, type Item } from './item.ts';
import { geared } from './tower.ts';

let cached: GameData | undefined;
const real = () => (cached ??= buildGameData(loadTables(), DESIGN, 30));
const plain = (code: string): Item => ({ uid: `b-${code}`, code, quality: 'normal', ilvl: 30, sockets: 0, socketed: [], stats: [] });

describe.skipIf(!hasTables())('bows on Amazon towers (real tables)', () => {
  const codeOf = (name: string) => Object.values(real().items.bases).find((b) => b.name === name)!.code;

  it('an Amazon tower wears a bow with no shield on; no other class can', () => {
    const bow = plain(codeOf('Long War Bow'));
    expect(canWear(real().items, bow, 'weapon', 'amazon', {})).toBe(true);
    expect(wearProblem(real().items, bow, 'weapon', 'paladin', {})).toBe('bow');
    expect(wearProblem(real().items, bow, 'weapon', 'amazon', { shield: plain(codeOf('Buckler')) })).toBe('shieldWorn');
    // Javelins are hers too; knives and axes are nobody's
    expect(canWear(real().items, plain(codeOf('Javelin')), 'weapon', 'amazon', {})).toBe(true);
    expect(wearProblem(real().items, plain(codeOf('Javelin')), 'weapon', 'paladin', {})).toBe('javelin');
    expect(wearProblem(real().items, plain(codeOf('Throwing Knife')), 'weapon', 'amazon', {})).toBe('thrown');
  });

  it('a worn javelin lends its stats and nothing else: a bow skill keeps the class bow', () => {
    const sim = testSim(real());
    const tower = placeTower(sim, 19, 10, 'poison-javelin');
    tower.gear = { weapon: plain(codeOf('Javelin')) };
    const bow = sim.data.skills['magic-arrow']!;
    const kept = geared(sim, tower, bow);
    expect(kept.archetype === 'projectile' && kept.weapon).toEqual(bow.archetype === 'projectile' && bow.weapon);
  });

  it("a bow skill fires the worn bow instead of the class bow; a worn sword leaves it the class bow", () => {
    const sim = testSim(real());
    const tower = placeTower(sim, 19, 10, 'magic-arrow');
    const skill = sim.data.skills['magic-arrow']!;
    const base = real().items.bases[codeOf('Long War Bow')]!;
    tower.gear = { weapon: plain(base.code) };
    const fired = geared(sim, tower, skill);
    expect(fired.archetype === 'projectile' && fired.weapon).toEqual({ min: base.minDamage * 256, max: base.maxDamage * 256 });
    tower.gear = { weapon: plain(codeOf('Short Sword')) };
    const kept = geared(sim, tower, skill);
    expect(kept.archetype === 'projectile' && kept.weapon).toEqual(skill.archetype === 'projectile' && skill.weapon);
  });
});

describe('missile weapons on the fixture', () => {
  it('refuse a bow on a tower that has no bow skills', () => {
    expect(wearProblem(testSim().data.items, plain('tbw'), 'weapon', 'paladin', {})).toBe('bow');
  });
});
