import { describe, expect, it } from 'vitest';

import { DESIGN } from '../data/design.ts';
import { hasTables, loadTables } from '../../tools/lib/load-tables.ts';
import type { DebuffDef } from './archetypes/types.ts';
import { buildGameData, type GameData } from './data.ts';
import { createSim, step } from './sim.ts';
import { addMonster, freeze, placeTower, ticks } from './testkit.ts';

const BESIDE = 3000;
let cached: GameData | undefined;
const real = () => (cached ??= buildGameData(loadTables(), DESIGN, 30));
const sim = () => createSim(real(), 1);

// The four later classes have no fixture rows: they are tested on the real tables
describe.skipIf(!hasTables())('the Barbarian and the Assassin (real tables)', () => {
  it("Battle Cry cuts damage and, as the physical resistance it is worth, defence", () => {
    const cry = real().skills['battle-cry'] as DebuffDef;
    // Level 1: -50% defence is a cut of 100 x 50 / 150 to physical resistance
    expect(cry.levels[0]!.resistDown.phys).toBe(33);
    expect(cry.levels[0]!.damageDownPct).toBe(25);
  });

  it('Shout gives the towers in reach defence for their summons, Battle Orders damage', () => {
    const s = sim();
    const shout = placeTower(s, 6, 5, 'shout', { tier: 2 });
    const orders = placeTower(s, 8, 5, 'battle-orders', { tier: 3 });
    const beside = placeTower(s, 7, 5, 'raise-skeleton');
    step(s, []);
    expect(s.fx.towers[beside.id]?.defensePct).toBeGreaterThan(0);
    expect(s.fx.towers[beside.id]?.damagePct).toBeGreaterThan(0);
    expect(shout.id).not.toBe(orders.id);
  });

  it('Find Item is a gold aura: kills in its reach, by any tower, pay its chance more, with gold find on top', () => {
    const goldFrom = (findItem: boolean) => {
      const s = sim();
      if (findItem) placeTower(s, 7, 5, 'find-item', { level: 5 });
      const killer = placeTower(s, 6, 4, 'sacrifice');
      killer.gear = { ring1: { uid: 'r', code: 'rin', quality: 'magic', ilvl: 30, sockets: 0, socketed: [], stats: [{ stat: 'item_goldbonus', value: 100 }] } };
      const m = addMonster(s, 'zombie1', BESIDE, { hp: 256 });
      freeze(m);
      const before = s.state.gold[0]!;
      ticks(s, 10);
      expect(m.hp).toBeLessThanOrEqual(0);
      return { gold: s.state.gold[0]! - before, bounty: s.data.monsters[m.def]!.level * s.data.economy.bountyPerLevel };
    };
    const plain = goldFrom(false);
    const found = goldFrom(true);
    const pct = (real().skills['find-item'] as DebuffDef).levels[4]!.goldPct;
    expect(pct).toBe(51);
    expect(plain.gold).toBe(plain.bounty * 2);
    expect(found.gold).toBe(found.bounty + Math.trunc((found.bounty * (100 + pct)) / 100));
  });

  it('Lightning Sentry sets traps on the path that fire their own shots, then are spent', () => {
    const s = sim();
    placeTower(s, 6, 5, 'lightning-sentry', { tier: 2 });
    const m = addMonster(s, 'zombie1', BESIDE, { hp: 100_000_000 });
    freeze(m);
    ticks(s, 400);
    const traps = s.state.summons.filter((u) => u.kind === 'trap');
    expect(traps.length).toBeGreaterThan(1);
    expect(traps.every((u) => (u.shots ?? 0) <= 10)).toBe(true);
    expect(m.hp).toBeLessThan(100_000_000);
  });

  it('Phoenix Strike casts its three charges in turn', () => {
    const s = sim();
    const tower = placeTower(s, 6, 4, 'phoenix-strike', { tier: 3 });
    const m = addMonster(s, 'zombie1', BESIDE, { hp: 100_000_000 });
    freeze(m);
    ticks(s, 200);
    expect(tower.charge).toBeGreaterThanOrEqual(3);
    expect(real().skills['phoenix-strike']!.charges).toEqual(['phoenix-meteor', 'phoenix-lightning', 'phoenix-ice']);
    expect(m.hp).toBeLessThan(100_000_000);
  });
});
