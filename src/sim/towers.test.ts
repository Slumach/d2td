import { describe, expect, it } from 'vitest';

import { activeSkill } from './auras.ts';
import { EVOLVED_LEVEL_INDEX, MAX_TOWER_LEVEL } from './data.ts';
import { buildCostFor, step } from './sim.ts';
import type { Command, Sim, Tower } from './state.ts';
import { canBuild, evolutionFor, pendingChoices, sellValue, towerAt } from './towers.ts';
import { placeTower, testSim } from './testkit.ts';

function run(sim: Sim, ...commands: Command[]): void {
  step(sim, commands);
}

function built(sim: Sim, x: number, y: number, skill: string): Tower {
  run(sim, { type: 'build', x, y, cls: 'paladin' }, { type: 'pickSkill', towerId: sim.state.nextId, skill });
  return towerAt(sim, x, y)!;
}

/** Levels a tower to 5 in its current tier, paying the real costs. */
function maxLevel(sim: Sim, tower: Tower): void {
  while (tower.level < MAX_TOWER_LEVEL) run(sim, { type: 'upgrade', towerId: tower.id });
}

describe('tower model', () => {
  it('builds an inert tower, then the T1 pick fixes its line', () => {
    const sim = testSim();
    run(sim, { type: 'build', x: 7, y: 6, cls: 'paladin' });
    const tower = towerAt(sim, 7, 6)!;
    expect(tower.line).toBe('');
    expect(activeSkill(sim, tower)).toBeUndefined();
    expect(pendingChoices(sim, tower)).toEqual(['sacrifice', 'holy-bolt', 'might']);
    expect(sim.state.gold[0]!).toBe(sim.data.economy.startingGold - sim.data.economy.buildCost);

    run(sim, { type: 'pickSkill', towerId: tower.id, skill: 'zeal' }); // not a T1 skill
    expect(tower.line).toBe('');
    run(sim, { type: 'pickSkill', towerId: tower.id, skill: 'holy-bolt' });
    expect(tower.line).toBe('holy');
    run(sim, { type: 'pickSkill', towerId: tower.id, skill: 'might' }); // line is fixed for good
    expect(tower.picks).toEqual(['holy-bolt']);
  });

  it('refuses path tiles, occupied tiles and unknown classes', () => {
    const sim = testSim();
    run(sim, { type: 'build', x: 4, y: 3, cls: 'paladin' }, { type: 'build', x: 7, y: 6, cls: 'druid' });
    expect(sim.state.towers).toHaveLength(0);
    built(sim, 7, 6, 'holy-bolt');
    expect(canBuild(sim, 7, 6)).toBe(false);
  });

  it('charges level costs per tier and stops at level 5', () => {
    const sim = testSim();
    sim.state.gold[0] = 100_000;
    const tower = built(sim, 7, 6, 'holy-bolt');
    const before = sim.state.gold[0]!;
    maxLevel(sim, tower);
    const costs = sim.data.economy.levelCosts[0]!;
    expect(before - sim.state.gold[0]!).toBe(costs.reduce((a, b) => a + b, 0));
    run(sim, { type: 'upgrade', towerId: tower.id });
    expect(tower.level).toBe(MAX_TOWER_LEVEL);
  });

  it('unlocks the next tier only at level 5, at the balance.json tier cost', () => {
    const sim = testSim();
    sim.state.gold[0] = 100_000;
    const tower = built(sim, 7, 6, 'holy-bolt');
    run(sim, { type: 'upgradeTier', towerId: tower.id });
    expect(tower.tier).toBe(1);
    maxLevel(sim, tower);
    const before = sim.state.gold[0]!;
    run(sim, { type: 'upgradeTier', towerId: tower.id });
    expect(tower.tier).toBe(2);
    expect(tower.level).toBe(1);
    expect(before - sim.state.gold[0]!).toBe(sim.data.economy.tierCosts[0]);
    // The Holy line has one T2 skill, taken at once
    expect(activeSkill(sim, tower)?.skill.id).toBe('blessed-hammer');
  });

  it('waits for pickBranch on a branching tier and only accepts that tier options', () => {
    const sim = testSim();
    sim.state.gold[0] = 100_000;
    const tower = built(sim, 9, 6, 'might');
    maxLevel(sim, tower);
    run(sim, { type: 'upgradeTier', towerId: tower.id });
    expect(tower.tier).toBe(2);
    expect(activeSkill(sim, tower)).toBeUndefined();
    expect(pendingChoices(sim, tower)).toEqual(['concentration', 'holy-freeze']);
    run(sim, { type: 'pickBranch', towerId: tower.id, skill: 'fanaticism' });
    expect(activeSkill(sim, tower)).toBeUndefined();
    run(sim, { type: 'pickBranch', towerId: tower.id, skill: 'holy-freeze' });
    expect(activeSkill(sim, tower)?.skill.id).toBe('holy-freeze');
    run(sim, { type: 'pickBranch', towerId: tower.id, skill: 'concentration' });
    expect(tower.picks).toEqual(['might', 'holy-freeze']);
  });

  it('switches targeting modes and ignores unknown ones', () => {
    const sim = testSim();
    const tower = built(sim, 7, 6, 'holy-bolt');
    run(sim, { type: 'setTargeting', towerId: tower.id, mode: 'strongest' });
    expect(tower.targeting).toBe('strongest');
    run(sim, { type: 'setTargeting', towerId: tower.id, mode: 'random' as never });
    expect(tower.targeting).toBe('strongest');
  });

  it('sells for 60% of everything spent', () => {
    const sim = testSim();
    const tower = built(sim, 7, 6, 'holy-bolt');
    run(sim, { type: 'upgrade', towerId: tower.id });
    const value = sellValue(sim, tower);
    expect(value).toBe(Math.trunc(((150 + sim.data.economy.levelCosts[0]![0]!) * 60) / 100));
    const before = sim.state.gold[0]!;
    run(sim, { type: 'sell', towerId: tower.id });
    expect(sim.state.gold[0]!).toBe(before + value);
    expect(sim.state.towers).toHaveLength(0);
  });
});

describe('evolution', () => {
  /** A T2 Blessed Hammer tower and a T2 Concentration tower, built and paid for. */
  function hammerdinPair(sim: Sim, partnerAt: { x: number; y: number }) {
    sim.state.gold[0] = 100_000;
    const holy = built(sim, 14, 6, 'holy-bolt');
    maxLevel(sim, holy);
    run(sim, { type: 'upgradeTier', towerId: holy.id });
    const aura = built(sim, partnerAt.x, partnerAt.y, 'might');
    maxLevel(sim, aura);
    run(sim, { type: 'upgradeTier', towerId: aura.id }, { type: 'pickBranch', towerId: aura.id, skill: 'concentration' });
    return { holy, aura };
  }

  it('needs the two towers adjacent, diagonals included', () => {
    const sim = testSim();
    const { holy, aura } = hammerdinPair(sim, { x: 15, y: 7 });
    expect(evolutionFor(sim, holy, aura)?.recipe.id).toBe('hammerdin');
    const other = testSim();
    const far = hammerdinPair(other, { x: 16, y: 6 });
    expect(evolutionFor(other, far.holy, far.aura)).toBeUndefined();
  });

  it('consumes both towers and lands on the attack tower tile with the partner aura built in', () => {
    const sim = testSim();
    const { holy, aura } = hammerdinPair(sim, { x: 15, y: 6 });
    const spent = holy.spent + aura.spent;
    const gold = sim.state.gold[0]!;
    // Partner listed first: the recipe still finds which tower attacks
    run(sim, { type: 'evolve', towerA: aura.id, towerB: holy.id });
    expect(sim.state.towers).toHaveLength(1);
    const evolved = sim.state.towers[0]!;
    expect([evolved.tileX, evolved.tileY]).toEqual([14, 6]);
    expect(evolved.evolved).toBe('hammerdin');
    expect(evolved.partnerSkill).toBe('concentration');
    expect(evolved.partnerLevel).toBe(aura.level - 1);
    // The attack at its top level with the recipe's bonus, so the evolved tower is worth 2.5x the pair
    const recipe = sim.data.evolutions.find((r) => r.id === 'hammerdin')!;
    const active = activeSkill(sim, evolved)!;
    expect(active.lvl).toBe(EVOLVED_LEVEL_INDEX);
    expect(active.skill.id).toBe(`blessed-hammer+0*${recipe.bonus}`);
    expect(recipe.bonus).toBeGreaterThanOrEqual(2500);
    const plain = sim.data.skills['blessed-hammer']!;
    if (plain.archetype !== 'splash' || active.skill.archetype !== 'splash') throw new Error('blessed-hammer should be splash');
    expect(active.skill.levels[EVOLVED_LEVEL_INDEX]!.max).toBe(Math.trunc((plain.levels[EVOLVED_LEVEL_INDEX]!.max * recipe.bonus) / 1000));
    expect(evolved.spent).toBe(spent + sim.data.economy.evolveCost);
    expect(sim.state.gold[0]!).toBe(gold - sim.data.economy.evolveCost);
    // The partner's tile is free again
    expect(canBuild(sim, 15, 6)).toBe(true);
  });

  it('rejects the wrong partner, a missing tier and too little gold', () => {
    const sim = testSim();
    sim.state.gold[0] = 100_000;
    const holy = placeTower(sim, 14, 6, 'blessed-hammer', { tier: 2, level: 5 });
    const freezeTower = placeTower(sim, 15, 6, 'holy-freeze', { tier: 2, level: 5 });
    run(sim, { type: 'evolve', towerA: holy.id, towerB: freezeTower.id });
    expect(sim.state.towers).toHaveLength(2);

    // Zealdin wants Fanaticism at T3; a T2 Concentration aura is not enough
    const zeal = placeTower(sim, 9, 6, 'zeal', { tier: 2 });
    const conc = placeTower(sim, 9, 7, 'concentration', { tier: 2 });
    expect(evolutionFor(sim, zeal, conc)).toBeUndefined();

    const poor = testSim();
    const a = placeTower(poor, 14, 6, 'blessed-hammer', { tier: 2 });
    const b = placeTower(poor, 15, 6, 'concentration', { tier: 2 });
    poor.state.gold[0] = poor.data.economy.evolveCost - 1;
    run(poor, { type: 'evolve', towerA: a.id, towerB: b.id });
    expect(poor.state.towers).toHaveLength(2);
  });

  it('accepts a partner that has tiered past the recipe skill', () => {
    const sim = testSim();
    const hammer = placeTower(sim, 14, 6, 'fist-of-the-heavens', { tier: 3 });
    // Placed as a T3 holy tower: picks are holy-bolt, blessed-hammer, fist-of-the-heavens
    const aura = placeTower(sim, 15, 6, 'fanaticism', { tier: 3 });
    aura.picks = ['might', 'concentration', 'fanaticism'];
    const match = evolutionFor(sim, hammer, aura);
    expect(match?.recipe.id).toBe('hammerdin');
  });

  it('evolved towers cannot level, tier or evolve again, and sell for 60% of both parents', () => {
    const sim = testSim();
    const { holy, aura } = hammerdinPair(sim, { x: 15, y: 6 });
    run(sim, { type: 'evolve', towerA: holy.id, towerB: aura.id });
    const evolved = sim.state.towers[0]!;
    const before = { ...evolved };
    run(sim, { type: 'upgrade', towerId: evolved.id }, { type: 'upgradeTier', towerId: evolved.id });
    expect(evolved.level).toBe(before.level);
    expect(evolved.tier).toBe(before.tier);
    expect(sellValue(sim, evolved)).toBe(Math.trunc((evolved.spent * 60) / 100));
  });

  it('raises the price of each build by buildCostGrowthPct for every tower the player owns', () => {
    const sim = testSim();
    const e = sim.data.economy;
    sim.state.gold[0] = 1_000_000;
    const prices: number[] = [];
    for (const [x, y] of [[2, 4], [4, 4], [6, 4]] as const) {
      prices.push(buildCostFor(sim, 0));
      step(sim, [{ type: 'build', x, y, cls: 'paladin', skill: 'holy-bolt' }]);
    }
    expect(prices).toEqual([e.buildCost, Math.trunc((e.buildCost * e.buildCostGrowthPct) / 100), Math.trunc((Math.trunc((e.buildCost * e.buildCostGrowthPct) / 100) * e.buildCostGrowthPct) / 100)]);
    expect(sim.state.towers.map((t) => t.spent)).toEqual(prices);
  });
});
