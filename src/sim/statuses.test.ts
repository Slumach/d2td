import { describe, expect, it } from 'vitest';

import type { DebuffDef, SummonDef } from './archetypes/types.ts';
import { computeAuras } from './auras.ts';
import { damageAgainst, poison, strike } from './combat.ts';
import { filterFrom } from './archetypes/common.ts';
import { fixtureGameData } from './fixture.ts';
import { speedOf } from './monsters.ts';
import { step } from './sim.ts';
import { addMonster, freeze, placeTower, testSim, ticks } from './testkit.ts';

// The tower stands at tile (2, 4); a monster at path distance 3000 is beside it.
const BESIDE = 3000;
const ALL = filterFrom(undefined);
const hell = () => testSim(fixtureGameData(30, { difficulty: 2 }));

describe('cold', () => {
  it('Ice Bolt chills: the monster walks chillPct slower for the cold length, then recovers', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'ice-bolt');
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    const free = speedOf(sim, m);
    for (let i = 0; i < 30 && m.chillTicks === 0; i++) step(sim, []);
    expect(m.chillTicks).toBeGreaterThan(0);
    expect(speedOf(sim, m)).toBe(Math.trunc((free * (100 - sim.data.rules.chillPct)) / 100));
    sim.state.towers = [];
    ticks(sim, m.chillTicks);
    expect(speedOf(sim, m)).toBe(free);
  });

  it('Glacial Spike freezes: a frozen monster stands still until it thaws', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'glacial-spike', { tier: 2 });
    const m = addMonster(sim, 'quillrat1', BESIDE - 500, { hp: 1_000_000 });
    for (let i = 0; i < 40 && m.freezeTicks === 0; i++) step(sim, []);
    expect(m.freezeTicks).toBeGreaterThan(0);
    sim.state.towers = [];
    const at = m.dist;
    const thaw = m.freezeTicks;
    ticks(sim, thaw);
    expect(m.dist).toBe(at);
    step(sim, []);
    expect(m.dist).toBeGreaterThan(at);
  });

  it('bosses are chilled instead of frozen', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'glacial-spike', { tier: 2 });
    const boss = addMonster(sim, 'andariel', BESIDE, { rank: 'boss', hp: 1_000_000 });
    freeze(boss);
    for (let i = 0; i < 40 && boss.chillTicks === 0; i++) step(sim, []);
    expect(boss.chillTicks).toBeGreaterThan(0);
    expect(boss.freezeTicks).toBe(0);
  });

  it('a cold immune takes no damage and is neither chilled nor frozen', () => {
    const sim = hell();
    const zombie = addMonster(sim, 'zombie1@hell', BESIDE, { hp: 1_000_000 });
    const skill = sim.data.skills['glacial-spike']!;
    strike(sim, zombie, 50_000, 'cold', ALL, skill, 4);
    expect(zombie.hp).toBe(1_000_000);
    expect(zombie.chillTicks).toBe(0);
    expect(zombie.freezeTicks).toBe(0);
  });
});

describe('immunities', () => {
  it("Hell's resistances come from the (H) columns, and 100% or more takes nothing", () => {
    const normal = testSim();
    const sim = hell();
    expect(normal.data.monsters['zombie1']!.resist.cold).toBe(0);
    expect(sim.data.monsters['zombie1@hell']!.resist.cold).toBe(120);
    const fallen = addMonster(sim, 'fallen1@hell', 0);
    const skeleton = addMonster(sim, 'skeleton1@hell', 0);
    expect(damageAgainst(sim, fallen, 1000, 'fire', ALL)).toBe(0);
    expect(damageAgainst(sim, fallen, 1000, 'cold', ALL)).toBe(1000);
    expect(damageAgainst(sim, skeleton, 1000, 'ltng', ALL)).toBe(0);
  });

  it('a tower whose element cannot hurt anything in range holds its fire', () => {
    const sim = hell();
    placeTower(sim, 2, 4, 'ice-bolt');
    const zombie = addMonster(sim, 'zombie1@hell', BESIDE, { hp: 1_000_000 });
    freeze(zombie);
    ticks(sim, 40);
    expect(sim.state.missiles).toHaveLength(0);
    expect(zombie.hp).toBe(1_000_000);
  });
});

describe('poison', () => {
  it('lands its dose over the poison length; a weaker dose never replaces a stronger one', () => {
    const sim = testSim();
    const m = addMonster(sim, 'quillrat1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    poison(m, 4000, 40);
    expect(m.poisonTicks).toBe(40);
    expect(m.poisonPerTick).toBe(100);
    poison(m, 1000, 40);
    expect(m.poisonPerTick).toBe(100);
    ticks(sim, 40);
    expect(m.hp).toBe(1_000_000 - 4000);
    expect(m.poisonTicks).toBe(0);
  });

  it('Poison Nova poisons everything its ring passes, once each', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'poison-nova', { tier: 3 });
    const a = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    const b = addMonster(sim, 'quillrat1', BESIDE + 600, { hp: 1_000_000 });
    [a, b].forEach(freeze);
    ticks(sim, 12);
    for (const m of [a, b]) expect(m.poisonTicks).toBeGreaterThan(0);
  });
});

describe('curses', () => {
  it('two curses on one monster: the strongest of each effect, never the sum', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'amplify-damage');
    placeTower(sim, 1, 4, 'decrepify', { tier: 2 });
    const m = addMonster(sim, 'brute1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    step(sim, []);
    expect(m.curses.map((c) => c.skill).sort()).toEqual(['amplify-damage', 'decrepify']);
    const amp = (sim.data.skills['amplify-damage'] as DebuffDef).levels[0]!;
    const dec = (sim.data.skills['decrepify'] as DebuffDef).levels[0]!;
    const fx = computeAuras(sim).monsters[m.id]!;
    expect(fx.resistDown.phys).toBe(Math.max(amp.resistDown.phys!, dec.resistDown.phys!));
    expect(fx.slowPct).toBe(dec.slowPct);
    expect(fx.damageDownPct).toBe(dec.damageDownPct);
  });

  it('a curse and an aura do add up', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'lower-resist', { tier: 3 });
    placeTower(sim, 1, 4, 'conviction', { tier: 3 });
    const m = addMonster(sim, 'brute1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    step(sim, []);
    const lr = (sim.data.skills['lower-resist'] as DebuffDef).levels[0]!.resistDown.fire!;
    const conviction = (sim.data.skills['conviction'] as DebuffDef).levels[0]!.resistDown.fire!;
    expect(computeAuras(sim).monsters[m.id]!.resistDown.fire).toBe(lr + conviction);
  });

  it('wears off after its duration', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'amplify-damage');
    const m = addMonster(sim, 'brute1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    step(sim, []);
    sim.state.towers = [];
    const left = m.curses[0]!.ticksLeft;
    ticks(sim, left - 1);
    expect(m.curses).toHaveLength(1);
    step(sim, []);
    expect(m.curses).toHaveLength(0);
  });

  it('Decrepify halves what a cursed monster does to a blocker', () => {
    const lost = (curse: boolean) => {
      const sim = testSim();
      const tower = placeTower(sim, 2, 4, 'raise-skeleton', { level: 5 });
      step(sim, []);
      const skeleton = sim.state.summons[0]!;
      skeleton.hp = skeleton.maxHp = 1_000_000;
      sim.state.towers = sim.state.towers.filter((t) => t.id !== tower.id);
      const m = addMonster(sim, 'brute1', 0, { hp: 1_000_000 });
      if (curse) m.curses.push({ skill: 'decrepify', lvl: 0, ticksLeft: 1_000_000 });
      ticks(sim, 200);
      return 1_000_000 - skeleton.hp;
    };
    const plain = lost(false);
    expect(plain).toBeGreaterThan(0);
    const pct = testSim().data.skills['decrepify'] as DebuffDef;
    expect(lost(true)).toBeLessThan(plain);
    expect(pct.levels[0]!.damageDownPct).toBe(50);
  });
});

describe('Static Field and Enchant', () => {
  it('Static Field takes a percent of current HP, never below the difficulty floor', () => {
    const sim = testSim();
    placeTower(sim, 2, 4, 'static-field');
    const m = addMonster(sim, 'brute1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    const pct = (sim.data.skills['static-field'] as DebuffDef).levels[0]!.hpPct;
    step(sim, []);
    expect(m.hp).toBe(1_000_000 - Math.trunc((1_000_000 * pct) / 100));

    const h = hell();
    placeTower(h, 2, 4, 'static-field');
    const hm = addMonster(h, 'brute1@hell', BESIDE, { hp: 1_000_000 });
    freeze(hm);
    ticks(h, 2000);
    expect(hm.hp).toBe(Math.trunc((1_000_000 * h.data.rules.staticFloorPct[2]!) / 100));
  });

  it('Enchant adds fire to the hits of towers in its radius', () => {
    const sim = testSim();
    const bolt = placeTower(sim, 2, 4, 'holy-bolt');
    placeTower(sim, 2, 5, 'enchant', { tier: 2 });
    const buff = computeAuras(sim).towers[bolt.id]!;
    expect(buff.fireMax).toBeGreaterThan(0);
    const m = addMonster(sim, 'brute1', BESIDE, { hp: 1_000_000 });
    strike(sim, m, 0, 'mag', ALL, sim.data.skills['holy-bolt']!, 0, { fireMin: 256, fireMax: 256 });
    expect(m.hp).toBe(1_000_000 - 256);
  });
});

describe('summon data', () => {
  it('Skeletal Mages shoot fire, cold, lightning or poison from their missiles', () => {
    const mage = testSim().data.skills['raise-skeletal-mage'] as SummonDef;
    expect(mage.kind).toBe('ranged');
    expect(mage.levels[0]!.bolts.map((b) => b.element).sort()).toEqual(['cold', 'fire', 'ltng', 'pois']);
  });
});
