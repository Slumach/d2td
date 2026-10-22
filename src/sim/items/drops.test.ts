import { describe, expect, it } from 'vitest';

import { FIXTURE_TABLES } from '../fixture.ts';
import { createRng } from '../rng.ts';
import { step } from '../sim.ts';
import { addMonster, freeze, placeTower, testSim, ticks } from '../testkit.ts';
import { buildItemData } from './data.ts';
import { MAX_DROPS, rollKillDrops, rollQuality, rollTreasure, upgraded, type DropContext } from './drops.ts';
import { freeSpot, INV_H, INV_W, stow } from './loot.ts';
import type { Item } from './item.ts';

const data = buildItemData(FIXTURE_TABLES);
const ctx = (over: Partial<DropContext> = {}): DropContext => ({ mlvl: 5, magicFind: 0, runePct: 100, noDropPct: 100, ...over });
const codes = (tc: string, c = ctx(), seed = 1) => rollTreasure(data, createRng(seed), tc, c).map((d) => d.base.code);
const BESIDE = 3000;

describe('treasure classes', () => {
  it('drops an item code, an automatic class and nested classes', () => {
    expect(codes('Runes 1')).toEqual(['r01']);
    expect(['tsw', 'tst', 'tob']).toContain(codes('Test Equip')[0]);
    for (let seed = 1; seed < 20; seed++) expect(['r01', 'tsw']).toContain(codes('Test Mixed', ctx(), seed)[0]);
  });

  it('drops each entry its Prob times in order for negative picks', () => {
    expect(codes('Test Negative')).toEqual(['gsr', 'gsr', 'r01']);
  });

  it('upgrades a class within its group to the monster level', () => {
    const low = data.treasureClasses['Test Group Low']!;
    expect(upgraded(data, low, 5).name).toBe('Test Group Low');
    expect(upgraded(data, low, 12).name).toBe('Test Group High');
    expect(codes('Test Group Low', ctx({ mlvl: 12 }))).toEqual(['r02']);
  });

  it('leaves gold and potions out, and stops at six items', () => {
    expect(codes('Test Nothing')).toEqual([]);
    expect(codes('Test Many')).toHaveLength(MAX_DROPS);
  });

  it('weighs rune entries by the rune multiplier', () => {
    const runes = (pct: number) => {
      let n = 0;
      for (let seed = 1; seed <= 400; seed++) if (codes('Test Mixed', ctx({ runePct: pct }), seed)[0] === 'r01') n++;
      return n;
    };
    expect(runes(500)).toBeGreaterThan(runes(100) + 100);
  });

  it('drops more often when NoDrop shrinks (endless Tiers)', () => {
    const count = (noDropPct: number) => {
      let n = 0;
      for (let seed = 1; seed <= 300; seed++) n += codes('Test Kill', ctx({ noDropPct }), seed).length;
      return n;
    };
    expect(count(10)).toBeGreaterThan(count(100));
  });
});

describe('quality', () => {
  it('finds more uniques with magic find, and keeps gems and runes plain', () => {
    const uniques = (mf: number) => {
      const rng = createRng(9);
      let n = 0;
      for (let i = 0; i < 3000; i++) if (rollQuality(data, rng, data.bases['tsw']!, 30, mf, { unique: 0, set: 0, rare: 0, magic: 0 }) === 'unique') n++;
      return n;
    };
    expect(uniques(300)).toBeGreaterThan(uniques(0));
    expect(rollQuality(data, createRng(1), data.bases['r01']!, 90, 1000, { unique: 1024, set: 0, rare: 0, magic: 0 })).toBe('normal');
  });

  it('never drops a white ring', () => {
    const rng = createRng(4);
    for (let i = 0; i < 200; i++) expect(rollQuality(data, rng, data.bases['rin']!, 10, 0, { unique: 0, set: 0, rare: 0, magic: 0 })).not.toBe('normal');
  });

  it('rolls whole items with unique ids', () => {
    const items = rollKillDrops(data, createRng(3), { tc: 'Test Negative', ctx: ctx(), hammerPpm: 0, uid: 'k' });
    expect(items.map((i) => i.uid)).toEqual(['k.0', 'k.1', 'k.2']);
    // The keep share thins items and gems separately: with items at 0 only the gem falls, and at 100 everything
    const thinned = rollKillDrops(data, createRng(3), { tc: 'Test Negative', ctx: ctx(), keep: { itemPct: 0, gemRunePct: 100 }, hammerPpm: 0, uid: 'k' });
    expect(thinned.map((i) => i.code)).toEqual(['gsr', 'gsr', 'r01']);
    const none = rollKillDrops(data, createRng(3), { tc: 'Test Equip', ctx: ctx(), keep: { itemPct: 0, gemRunePct: 100 }, hammerPpm: 0, uid: 'k' });
    expect(none).toEqual([]);
    const hammer = rollKillDrops(data, createRng(3), { tc: 'Test Nothing', ctx: ctx(), hammerPpm: 1_000_000, uid: 'h' });
    expect(hammer.map((i) => i.code)).toEqual(['xsh']);
  });
});

describe('loot in the sim', () => {
  const kill = () => {
    const sim = testSim();
    placeTower(sim, 6, 4, 'sacrifice');
    const m = addMonster(sim, 'quillrat1', BESIDE, { hp: 256, rank: 'champion' });
    freeze(m);
    for (let i = 0; i < 10 && sim.state.drops.length === 0 && sim.state.inventories[0]!.length === 0; i++) step(sim, []);
    return sim;
  };

  it("drops on the kill spot for the killer, and the wave's clear collects it", () => {
    const sim = kill();
    // The champion's class drops one rune; the wave cleared with the kill, so it is already stowed
    expect(sim.state.drops).toEqual([]);
    expect(sim.state.inventories[0]!.map((i) => i.item.code)).toEqual(['r01']);
  });

  it('lets the owner pick a drop up while its wave is still out', () => {
    const sim = testSim();
    placeTower(sim, 6, 4, 'sacrifice');
    const m = addMonster(sim, 'quillrat1', BESIDE, { hp: 256, rank: 'champion' });
    addMonster(sim, 'zombie1', 90_000, { hp: 1_000_000 });
    freeze(m);
    ticks(sim, 10);
    expect(sim.state.drops).toHaveLength(1);
    const drop = sim.state.drops[0]!;
    expect(drop.owner).toBe(0);
    step(sim, [{ type: 'pickup', dropId: drop.id, player: 1 }]);
    expect(sim.state.drops).toHaveLength(1);
    step(sim, [{ type: 'pickup', dropId: drop.id }]);
    expect(sim.state.drops).toHaveLength(0);
    expect(sim.state.inventories[0]![0]!.item.code).toBe('r01');
  });

  it('places items column by column and stacks consumables', () => {
    const sim = testSim();
    const item = (code: string, uid: string): Item => ({ uid, code, quality: 'normal', ilvl: 1, sockets: 0, socketed: [], stats: [] });
    expect(stow(sim, 0, item('tsw', 'a'))).toBe(true);
    expect(stow(sim, 0, item('r01', 'b'))).toBe(true);
    expect(sim.state.inventories[0]!.map((i) => [i.x, i.y])).toEqual([[0, 0], [0, 3]]);
    stow(sim, 0, { ...item('xsh', 'c'), quantity: 1 });
    stow(sim, 0, { ...item('xsh', 'd'), quantity: 2 });
    expect(sim.state.inventories[0]!.filter((i) => i.item.code === 'xsh').map((i) => i.item.quantity)).toEqual([3]);
    // Full: forty one-cell runes fill it
    const full = Array.from({ length: INV_W * INV_H }, (_, k) => ({ item: item('r01', `f${k}`), x: k % INV_W, y: Math.floor(k / INV_W) }));
    expect(freeSpot(sim.data.items, full, item('r01', 'z'))).toBeUndefined();
  });

  it('is the same loot for the same seed', () => {
    expect(JSON.stringify(kill().state.inventories)).toBe(JSON.stringify(kill().state.inventories));
  });
});
