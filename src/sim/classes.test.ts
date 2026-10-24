import { describe, expect, it } from 'vitest';

import { DESIGN } from '../data/design.ts';
import { hasTables, loadTables } from '../../tools/lib/load-tables.ts';
import type { DebuffDef } from './archetypes/types.ts';
import { buildGameData, MAX_TOWER_LEVEL, type GameData } from './data.ts';
import { isAura, standardDps } from './dps.ts';
import { TICKS_PER_SECOND } from './fixed.ts';
import { createSim, step } from './sim.ts';
import { addMonster, freeze, placeTower, ticks } from './testkit.ts';

const BESIDE = 3000;
let cached: GameData | undefined;
const real = () => (cached ??= buildGameData(loadTables(), DESIGN, 30));
const sim = () => createSim(real(), 1);

/** The lowest and highest level-5 standard DPS of every other measured attack skill at a tier. */
function band(tier: number, except: string): [number, number] {
  const data = real();
  const top = MAX_TOWER_LEVEL - 1;
  const values = Object.values(data.classes)
    .flatMap((c) => Object.values(c.lines).flatMap((l) => l.tiers[tier - 1] ?? []))
    .filter((id) => id !== except && !isAura(data.skills[id]!))
    .map((id) => standardDps(data.skills[id]!, top))
    .filter((v) => v > 0);
  return [Math.min(...values), Math.max(...values)];
}

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

describe.skipIf(!hasTables())('the Amazon and the Druid (real tables)', () => {
  it('the Javelin line climbs as D2 does: Poison Javelin, Plague Javelin, Lightning Fury', () => {
    expect(real().classes['amazon']!.lines['javelin']!.tiers).toEqual([['poison-javelin'], ['plague-javelin'], ['lightning-fury']]);
    const fury = standardDps(real().skills['lightning-fury']!, MAX_TOWER_LEVEL - 1);
    const [lo, hi] = band(3, 'lightning-fury');
    expect(fury).toBeGreaterThanOrEqual(lo);
    expect(fury).toBeLessThanOrEqual(hi);
  });

  it('a poison skill measures one dose over its length, since a new dose replaces the old', () => {
    const javelin = real().skills['poison-javelin']!;
    const top = MAX_TOWER_LEVEL - 1;
    const l = (javelin as { levels: { min: number; max: number }[] }).levels[top]!;
    expect(standardDps(javelin, top)).toBe(Math.trunc(((l.min + l.max) >> 1) * 1000 / javelin.poisonTicks[top]!));
  });

  it("Firestorm's flames burn every tick they touch, and a level 5 T1 Firestorm sits in the T1 band", () => {
    const firestorm = real().skills['firestorm']!;
    expect(firestorm.archetype).toBe('zone');
    const top = MAX_TOWER_LEVEL - 1;
    const dps = standardDps(firestorm, top);
    const [lo, hi] = band(1, 'firestorm');
    expect(dps).toBeGreaterThanOrEqual(lo);
    expect(dps).toBeLessThanOrEqual(hi);
    // In the sim: a frozen target in the flames loses about that much a second
    const s = sim();
    placeTower(s, 6, 5, 'firestorm', { level: MAX_TOWER_LEVEL });
    const m = addMonster(s, 'zombie1', BESIDE, { hp: 100_000_000 });
    freeze(m);
    ticks(s, 40);
    const before = m.hp;
    const seconds = 20;
    ticks(s, seconds * TICKS_PER_SECOND);
    const measured = (before - m.hp) / seconds;
    const expected = (dps * TICKS_PER_SECOND) / 1000;
    expect(measured).toBeGreaterThan(expected * 0.8);
    expect(measured).toBeLessThan(expected * 1.2);
  });

  it("a bow's crushing blow rides on its arrows, halved for a ranged attack", () => {
    const firstHit = (crush: number) => {
      const s = sim();
      const bow = placeTower(s, 6, 5, 'magic-arrow');
      if (crush) bow.gear = { gloves: { uid: 'g', code: 'thl', quality: 'magic', ilvl: 30, sockets: 0, socketed: [], stats: [{ stat: 'item_crushingblow', value: crush }] } };
      const m = addMonster(s, 'zombie1', BESIDE, { hp: 100_000 });
      freeze(m);
      for (let i = 0; i < 100 && m.hp === 100_000; i++) step(s, []);
      return 100_000 - m.hp;
    };
    expect(firstHit(100) - firstHit(0)).toBe(12_500);
  });
});
