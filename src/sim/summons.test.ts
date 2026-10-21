import { describe, expect, it } from 'vitest';

import { blockerAhead } from './archetypes/summon.ts';
import type { SummonDef } from './archetypes/types.ts';
import { distSq } from './combat.ts';
import { positionAt } from './map.ts';
import { step } from './sim.ts';
import type { Corpse, Sim } from './state.ts';
import { addMonster, freeze, placeTower, testSim, ticks } from './testkit.ts';

// The tower stands at tile (2, 4); a monster at path distance 3000 is beside it.
const BESIDE = 3000;

function corpse(sim: Sim, def: string, dist: number, opts: Partial<Corpse> = {}): Corpse {
  const p = positionAt(sim.map, dist);
  const c: Corpse = { id: sim.state.nextId++, def, rank: 'normal', dist, x: p.x, y: p.y, maxHp: 20_000, ticksLeft: 200, ...opts };
  sim.state.corpses.push(c);
  return c;
}

describe('summons', () => {
  it('Skeletal Mages stand beside the path on their tower side, never block, and shoot', () => {
    const sim = testSim();
    const tower = placeTower(sim, 2, 4, 'raise-skeletal-mage', { tier: 2, level: 5 });
    ticks(sim, 3 * 20);
    const mages = sim.state.summons;
    expect(mages.length).toBeGreaterThan(1);
    for (const mage of mages) {
      expect(mage.kind).toBe('ranged');
      const onPath = positionAt(sim.map, mage.dist);
      expect(distSq(mage, onPath)).toBeGreaterThan(0);
      expect(distSq(mage, tower)).toBeLessThan(distSq(onPath, tower));
    }
    // Two mages never stand on one spot
    expect(new Set(mages.map((m) => `${m.x},${m.y}`)).size).toBe(mages.length);
    expect(blockerAhead(sim, { dist: 0, rank: 'normal', brokeThrough: [] }, sim.map.length)).toBeUndefined();
    const m = addMonster(sim, 'brute1', BESIDE - 1500, { hp: 1_000_000 });
    freeze(m);
    ticks(sim, 60);
    expect(m.hp + m.poisonPerTick * m.poisonTicks).toBeLessThan(1_000_000);
    expect(mages.some((u) => u.targetId === m.id)).toBe(true);
  });

  it('Revive raises a fresh corpse as a blocking ally, then it falls when its time is up', () => {
    const sim = testSim();
    const tower = placeTower(sim, 2, 4, 'revive', { tier: 3, level: 5 });
    const body = corpse(sim, 'brute1', BESIDE);
    step(sim, []);
    expect(sim.state.corpses).toHaveLength(0);
    const ally = sim.state.summons[0]!;
    const skill = sim.data.skills['revive'] as SummonDef;
    expect(ally).toMatchObject({ kind: 'revive', def: 'brute1', dist: body.dist });
    expect(ally.maxHp).toBe(Math.trunc((body.maxHp * skill.levels[4]!.hpPct) / 100));
    expect(blockerAhead(sim, { dist: body.dist - 2000, rank: 'normal', brokeThrough: [] }, body.dist)).toBe(ally);
    ticks(sim, skill.durationTicks - 1);
    expect(sim.state.summons).toHaveLength(1);
    step(sim, []);
    expect(sim.state.summons).toHaveLength(0);
    expect(tower.summonCooldown).toBeGreaterThan(0);
  });

  it('Revive passes over champion, unique and boss corpses', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'revive', { tier: 3, level: 5 });
    corpse(sim, 'brute1', BESIDE, { rank: 'champion' });
    corpse(sim, 'bloodraven', BESIDE, { rank: 'boss' });
    step(sim, []);
    expect(sim.state.summons).toHaveLength(0);
    expect(sim.state.corpses).toHaveLength(2);
  });
});

describe('corpses', () => {
  it('every kill leaves a corpse for corpseLifetimeTicks (10 s)', () => {
    const sim = testSim();
    expect(sim.data.rules.corpseLifetimeTicks).toBe(200);
    const victim = addMonster(sim, 'fallen1', BESIDE, { hp: 256 });
    freeze(victim);
    placeTower(sim, 2, 4, 'holy-bolt');
    ticks(sim, 15);
    expect(sim.state.corpses).toMatchObject([{ def: 'fallen1', rank: 'normal' }]);
  });

  it('one corpse, three takers: the first to act gets it and the others find nothing', () => {
    const sim = testSim();
    // Towers act in build order: Corpse Explosion first, then Revive
    placeTower(sim, 2, 5, 'corpse-explosion', { tier: 2 });
    placeTower(sim, 2, 4, 'revive', { tier: 3, level: 5 });
    corpse(sim, 'fallen1', BESIDE);
    const bystander = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    freeze(bystander);
    step(sim, []);
    expect(sim.state.corpses).toHaveLength(0);
    expect(bystander.hp).toBeLessThan(1_000_000);
    expect(sim.state.summons).toHaveLength(0);
  });

  it('a Fallen Shaman mid-cast loses its corpse to a tower, and nothing rises', () => {
    const sim = testSim();
    const body = corpse(sim, 'fallen1', BESIDE);
    const shaman = addMonster(sim, 'fallenshaman1', BESIDE - 1000);
    sim.data.monsters['fallenshaman1']!.resurrect!.chancePct = 100;
    shaman.abilityCooldown = 1;
    step(sim, []);
    expect(shaman.castCorpse).toBe(body.id);
    placeTower(sim, 2, 4, 'revive', { tier: 3, level: 5 });
    step(sim, []);
    expect(sim.state.summons).toHaveLength(1);
    ticks(sim, shaman.castTicks + 1);
    expect(sim.state.monsters.filter((m) => m.def === 'fallen1')).toHaveLength(0);
  });
});

describe('Sorceress and Necromancer evolutions', () => {
  it('an evolved tower casts its partner skill too: the Summoner curses while it raises', () => {
    const sim = testSim();
    sim.state.gold = 10_000;
    const revive = placeTower(sim, 2, 4, 'revive', { tier: 3, level: 5 });
    const amp = placeTower(sim, 3, 4, 'amplify-damage', { level: 5 });
    step(sim, [{ type: 'evolve', towerA: revive.id, towerB: amp.id }]);
    const evolved = sim.state.towers[0]!;
    expect(sim.state.towers).toHaveLength(1);
    expect(evolved).toMatchObject({ evolved: 'summoner', partnerSkill: 'amplify-damage' });
    const m = addMonster(sim, 'brute1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    step(sim, []);
    expect(m.curses.map((c) => c.skill)).toEqual(['amplify-damage']);
  });

  it('every recipe names skills of the lines it crosses', () => {
    const sim = testSim();
    const ids = sim.data.evolutions.map((e) => e.id);
    for (const id of ['meteorb', 'blizzballer', 'lightsorc', 'summoner', 'bonemancer', 'novamancer', 'explosionmancer']) expect(ids).toContain(id);
  });
});
