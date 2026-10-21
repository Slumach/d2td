import { describe, expect, it } from 'vitest';

import type { HitFilter } from './archetypes/types.ts';
import { damageAgainst, effectiveResist, findTarget } from './combat.ts';
import { addMonster, freeze, placeTower, testSim } from './testkit.ts';

const ALL: HitFilter = { fullDamageTo: 'all', otherDamagePct: 100, bonusVsUndeadPct: 0, bonusVsDemonPct: 0 };

describe('damage and resistance', () => {
  it('Holy Bolt keeps the house rule: full damage to undead, the balance.json share to the rest', () => {
    const sim = testSim();
    const bolt = sim.data.skills['holy-bolt']!;
    if (bolt.archetype !== 'projectile') throw new Error('holy-bolt should be a projectile');
    expect(bolt.filter).toMatchObject({ fullDamageTo: 'undead', otherDamagePct: 40 });
    expect(damageAgainst(sim, addMonster(sim, 'zombie1', 0), 1000, 'mag', bolt.filter)).toBe(1000);
    expect(damageAgainst(sim, addMonster(sim, 'fallen1', 0), 1000, 'mag', bolt.filter)).toBe(400);
    // Corrupt Rogue: the 40% share, then its 20% magic resistance
    expect(damageAgainst(sim, addMonster(sim, 'corruptrogue1', 0), 1000, 'mag', bolt.filter)).toBe(320);
  });

  it('adds the missile bonus against undead and demons (Blessed Hammer)', () => {
    const sim = testSim();
    const hammer = sim.data.skills['blessed-hammer']!;
    if (hammer.archetype !== 'splash') throw new Error('blessed-hammer should be splash');
    expect(damageAgainst(sim, addMonster(sim, 'zombie1', 0), 1000, 'mag', hammer.filter)).toBe(1500);
    expect(damageAgainst(sim, addMonster(sim, 'quillrat1', 0), 1000, 'mag', hammer.filter)).toBe(1000);
  });

  it('treats 100% resistance as immunity and negative resistance as extra damage', () => {
    const sim = testSim();
    const andariel = addMonster(sim, 'andariel', 0);
    expect(damageAgainst(sim, andariel, 1000, 'pois', ALL)).toBe(0);
    expect(damageAgainst(sim, andariel, 1000, 'fire', ALL)).toBe(1500);
  });

  it('lets reductions break immunity only by a fifth, and never below -100', () => {
    const sim = testSim();
    const andariel = addMonster(sim, 'andariel', 0);
    sim.fx = { towers: {}, emitters: [], monsters: { [andariel.id]: { slowPct: 0, resistDown: { pois: 50, fire: 100 }, damageDownPct: 0 } } };
    // Poison 100 is an immunity: 50 of reduction only takes 10 off
    expect(effectiveResist(sim, andariel, 'pois')).toBe(90);
    expect(damageAgainst(sim, andariel, 1000, 'pois', ALL)).toBe(100);
    // Fire -50 minus 100 would be -150; the floor is -100
    expect(effectiveResist(sim, andariel, 'fire')).toBe(-100);
    expect(damageAgainst(sim, andariel, 1000, 'fire', ALL)).toBe(2000);
  });

  it('adds mod resistances from balance.json', () => {
    const sim = testSim();
    const stone = addMonster(sim, 'zombie1', 0, { mods: ['stoneSkin'] });
    const magic = addMonster(sim, 'zombie1', 0, { mods: ['magicResistant'] });
    const mods = sim.data.rules.mods;
    expect(effectiveResist(sim, stone, 'phys')).toBe(mods.stoneSkin.resist[0]!.add.phys);
    expect(effectiveResist(sim, magic, 'fire')).toBe(mods.magicResistant.resist[0]!.add.fire);
    // House rule: Magic Resistant also resists magic
    expect(effectiveResist(sim, magic, 'mag')).toBe(75);
    expect(effectiveResist(sim, stone, 'mag')).toBe(0);
  });
});

describe('targeting', () => {
  it('picks First, Last, Strongest, Weakest and Closest', () => {
    const sim = testSim();
    // Tower beside the first path segment (row 3), which runs along x from the left edge
    const tower = placeTower(sim, 2, 4, 'holy-bolt');
    const a = addMonster(sim, 'zombie1', 1500, { hp: 5000 }); // x 1000, furthest back
    const b = addMonster(sim, 'zombie1', 3000, { hp: 9000 }); // x 2500, right above the tower
    const c = addMonster(sim, 'zombie1', 4500, { hp: 1000 }); // x 4000, furthest along
    [a, b, c].forEach(freeze);
    const pick = (mode: Parameters<typeof findTarget>[4]) => findTarget(sim, tower, 5000, () => true, mode)?.id;
    expect(pick('first')).toBe(c.id);
    expect(pick('last')).toBe(a.id);
    expect(pick('strongest')).toBe(b.id);
    expect(pick('weakest')).toBe(c.id);
    expect(pick('closest')).toBe(b.id);
  });

  it('only considers monsters in range and breaks ties by lowest id', () => {
    const sim = testSim();
    const tower = placeTower(sim, 2, 4, 'holy-bolt');
    const near1 = addMonster(sim, 'zombie1', 3000, { hp: 2000 });
    addMonster(sim, 'zombie1', 3000, { hp: 2000 });
    addMonster(sim, 'zombie1', 20_000, { hp: 9000 });
    expect(findTarget(sim, tower, 2000, () => true, 'strongest')?.id).toBe(near1.id);
  });
});
