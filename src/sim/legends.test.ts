import { describe, expect, it } from 'vitest';

import { DESIGN } from '../data/design.ts';
import { hasTables, loadTables } from '../../tools/lib/load-tables.ts';
import { checkLegend } from '../../tools/legends.ts';
import { buildGameData, type GameData } from './data.ts';
import { createSim, legendFor, legendOptions, sellValue, step } from './sim.ts';
import type { Tower } from './state.ts';

let cached: GameData | undefined;
const real = () => (cached ??= buildGameData(loadTables(), DESIGN, 30));

describe.skipIf(!hasTables())('T5 legends (real tables)', () => {
  it('every class reaches its legend through the commands, worth at least 2.5x its three evolutions', () => {
    for (const cls of Object.keys(real().classes)) {
      const r = checkLegend(real(), cls);
      expect(r.reachable, `${cls}: ${r.why}`).toBe(true);
      // 2.5x the damage, and its larger reach step on top (more swings count here)
      expect(r.legendDps / r.parentsDps).toBeGreaterThanOrEqual(real().economy.legend.dpsPct / 100 - 0.02);
    }
  });

  it('needs three different evolutions of one class, each beside the other two; selling it sells all three', () => {
    const sim = createSim(real(), 1);
    const evolved = (id: number, x: number, y: number, recipe: string): Tower => ({
      id, owner: 0, cls: 'paladin', tileX: x, tileY: y, x: x * 1000 + 500, y: y * 1000 + 500, line: 'zealot', tier: 4, level: 5,
      picks: ['sacrifice'], spent: 100, cooldown: 0, targeting: 'first', evolved: recipe, partnerSkill: 'fanaticism', partnerLevel: 4,
      summonCooldown: 0, partnerCooldown: 0,
    });
    // In a row the two ends are not beside each other
    const row = [evolved(1, 6, 4, 'zealdin'), evolved(2, 7, 4, 'hammerdin'), evolved(3, 8, 4, 'avenger')];
    expect(legendFor(sim, row[0]!, row[1]!, row[2]!)).toBeUndefined();
    // Two of the same recipe do not count
    const same = [evolved(1, 6, 4, 'zealdin'), evolved(2, 7, 4, 'zealdin'), evolved(3, 6, 5, 'avenger')];
    expect(legendFor(sim, same[0]!, same[1]!, same[2]!)).toBeUndefined();
    const [a, b, c] = [evolved(1, 6, 4, 'zealdin'), evolved(2, 7, 4, 'hammerdin'), evolved(3, 6, 5, 'avenger')];
    sim.state.towers.push(a, b, c);
    sim.state.nextId = 10;
    // Two evolved towers alone offer nothing: the legend stays hidden
    expect(legendOptions(sim, evolved(9, 20, 20, 'zealdin'))).toEqual([]);
    expect(legendOptions(sim, a).map((o) => o.legend.name)).toEqual(['Tyrael']);
    sim.state.gold[0] = 10_000_000;
    step(sim, [{ type: 'ascend', towerA: a.id, towerB: b.id, towerC: c.id }]);
    expect(a.legend).toBe('tyrael');
    expect([b.legendOf, c.legendOf]).toEqual([a.id, a.id]);
    expect([b.tileX, b.tileY]).toEqual([a.tileX, a.tileY]);
    const refund = sellValue(sim, a);
    expect(refund).toBe(Math.trunc(((300 + real().economy.legend.cost) * 60) / 100));
    const gold = sim.state.gold[0]!;
    step(sim, [{ type: 'sell', towerId: a.id }]);
    expect(sim.state.towers).toEqual([]);
    expect(sim.state.gold[0]! - gold).toBeGreaterThanOrEqual(refund);
  });
});
