import { describe, expect, it } from 'vitest';

import { killMonster } from './combat.ts';
import { fixtureGameData } from './fixture.ts';
import { aliveWeight, step } from './sim.ts';
import type { Command, Sim } from './state.ts';
import { addMonster, freeze, placeTower, testSim, ticks } from './testkit.ts';
import type { Item } from './items/item.ts';

const leg = (quantity = 1): Item => ({ uid: 'leg', code: 'leg', quality: 'normal', ilvl: 85, sockets: 0, socketed: [], stats: [], quantity });

function withLeg(quantity = 1): Sim {
  const data = fixtureGameData();
  // Small packs: the real ones overrun an empty test ring
  const sim = testSim({ ...data, cow: { ...data.cow, kingRuneMin: 'r02', packs: 2, packSize: 3 } });
  step(sim, [{ type: 'loadInventory', items: [{ item: leg(quantity), x: 0, y: 0 }] }]);
  return sim;
}
const open: Command = { type: 'cowPortal', uid: 'leg' };
/** Runs until the next wave timer fires, then one tick more. */
const toNextWave = (sim: Sim) => ticks(sim, Math.max(1, sim.state.nextWaveTick - sim.state.tick + 1));
const cowsQueued = (sim: Sim) => sim.state.spawns.filter((s) => s.cow);

describe('the Secret Cow Level', () => {
  it("opens with one of the player's legs, and not twice at once", () => {
    const sim = withLeg(2);
    step(sim, [open]);
    expect(sim.state.cow).toMatchObject({ opener: 0, started: 0 });
    expect(sim.state.inventories[0]![0]!.item.quantity).toBe(1);
    step(sim, [open]);
    expect(sim.state.inventories[0]![0]!.item.quantity).toBe(1);
    // Without a leg nothing happens
    const bare = testSim();
    step(bare, [open]);
    expect(bare.state.cow).toBeUndefined();
  });

  it('takes the wave timer for three cow waves, the Cow King leading the third, then the campaign resumes', () => {
    const sim = withLeg();
    step(sim, [open]);
    const campaign = sim.state.wave;
    const c = sim.data.cow;
    toNextWave(sim);
    expect(sim.state.cow!.started).toBe(1);
    expect(sim.state.wave).toBe(campaign);
    toNextWave(sim);
    toNextWave(sim);
    expect(sim.state.cow?.started ?? c.waves).toBe(c.waves);
    const kings = [...cowsQueued(sim), ...sim.state.monsters.filter((m) => m.cow)].filter((x) => x.rank === 'unique');
    expect(kings).toHaveLength(1);
    toNextWave(sim);
    expect(sim.state.wave).toBe(campaign + 1);
  });

  it('weighs every cow 1, the Cow King too, and boosts their rune drops', () => {
    const sim = withLeg();
    step(sim, [open]);
    toNextWave(sim);
    toNextWave(sim);
    toNextWave(sim);
    ticks(sim, 400);
    const cows = sim.state.monsters.filter((m) => m.cow && m.hp > 0);
    expect(cows.length).toBeGreaterThan(0);
    expect(cows.some((m) => m.rank === 'unique')).toBe(true);
    expect(cows.every((m) => m.runeBoost === sim.data.cow.runeBoost)).toBe(true);
    const others = sim.state.monsters.filter((m) => !m.cow && m.hp > 0);
    const w = sim.data.rules.aliveWeight;
    expect(aliveWeight(sim)).toBe(cows.length + others.reduce((n, m) => n + w[m.rank], 0));
  });

  it('closes the portal with the last cow, and the Cow King always drops a high rune', () => {
    const sim = withLeg();
    step(sim, [open]);
    for (let k = 0; k < 3; k++) toNextWave(sim);
    // Let every cow walk on, then kill them all where they stand
    ticks(sim, 600);
    expect(sim.state.spawns.filter((s) => s.cow)).toEqual([]);
    const king = sim.state.monsters.find((m) => m.cow && m.rank === 'unique')!;
    expect(king).toBeDefined();
    for (const m of [...sim.state.monsters.filter((x) => x.cow)]) killMonster(sim, m);
    expect(sim.state.cow).toBeUndefined();
    const runes = [...sim.state.inventories[0]!.map((i) => i.item.code), ...sim.state.drops.map((d) => d.item.code)];
    expect(runes).toContain('r02');
  });

  it("drops Wirt's Leg from Griswold's pack in Hell", () => {
    const data = fixtureGameData();
    const sim = testSim({ ...data, cow: { ...data.cow, griswoldLegPpm: 1_000_000 } });
    placeTower(sim, 6, 4, 'sacrifice');
    const m = addMonster(sim, 'zombie1@hell', 3000, { hp: 256 });
    m.pack = sim.data.cow.pack;
    freeze(m);
    ticks(sim, 10);
    const got = [...sim.state.inventories[0]!.map((i) => i.item.code), ...sim.state.drops.map((d) => d.item.code)];
    expect(got).toContain('leg');
  });
});
