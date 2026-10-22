import { describe, expect, it } from 'vitest';

import type { DebuffDef, SummonDef } from './archetypes/types.ts';
import { computeAuras } from './auras.ts';
import { damageAgainst, effectiveResist, poison, strike } from './combat.ts';
import { filterFrom } from './archetypes/common.ts';
import { fixtureGameData } from './fixture.ts';
import { speedOf } from './monsters.ts';
import { step } from './sim.ts';
import type { Element, Monster } from './state.ts';
import { addMonster, freeze, monsterIn, placeTower, testSim, ticks } from './testkit.ts';
import { auraMultiplier } from './dps.ts';
import { resolveMods, variantId } from './data.ts';
import { DESIGN } from '../data/design.ts';

const DESIGN_TARGET = DESIGN.balance.tierLadder.debuffTargetResist;

// The tower stands at tile (2, 4); a monster at path distance 3000 is beside it.
const BESIDE = 3000;
const ALL = filterFrom(undefined);
// Every difficulty's monsters are in the campaign's data; these tests use the Hell ones
const hell = () => testSim();

describe('cold', () => {
  it('Ice Bolt chills: the monster walks chillPct slower for the cold length, then recovers', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'ice-bolt');
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
    placeTower(sim, 6, 5, 'glacial-spike', { tier: 2 });
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
    placeTower(sim, 6, 5, 'glacial-spike', { tier: 2 });
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
    placeTower(sim, 6, 5, 'ice-bolt');
    const zombie = addMonster(sim, 'zombie1@hell', BESIDE, { hp: 1_000_000 });
    freeze(zombie);
    ticks(sim, 40);
    expect(sim.state.missiles).toHaveLength(0);
    expect(zombie.hp).toBe(1_000_000);
  });
});

describe('Hell walls', () => {
  const nightmare = () => testSim();
  const fifth = (sim: ReturnType<typeof testSim>, m: Monster, element: Element) => {
    sim.fx = computeAuras(sim);
    return effectiveResist(sim, m, element);
  };

  it('every resistance cut works at a fifth on an immune: Lower Resist, Amplify Damage, Decrepify, Conviction', () => {
    const sim = hell();
    const lr = (sim.data.skills['lower-resist'] as DebuffDef).levels[4]!.resistDown;
    const amp = (sim.data.skills['amplify-damage'] as DebuffDef).levels[4]!.resistDown.phys!;
    const dec = (sim.data.skills['decrepify'] as DebuffDef).levels[4]!.resistDown.phys!;
    // Fire 100 from the (H) column; Physical Immune is physical 100
    const fallen = addMonster(sim, 'fallen1@hell', 0, { hp: 1_000_000 });
    const brute = addMonster(sim, 'brute1@hell', 0, { hp: 1_000_000, mods: ['physicalImmune'] });
    const rat = addMonster(sim, 'quillrat1@hell', 0, { hp: 1_000_000 });
    for (const m of [fallen, brute, rat]) m.curses.push({ skill: 'lower-resist', lvl: 4, ticksLeft: 1000 });
    brute.curses.push({ skill: 'amplify-damage', lvl: 4, ticksLeft: 1000 });
    expect(fifth(sim, fallen, 'fire')).toBe(100 - Math.trunc(lr.fire! / 5));
    expect(fifth(sim, brute, 'phys')).toBe(100 - Math.trunc(amp / 5));
    // A monster under 100 takes the whole cut
    expect(fifth(sim, rat, 'fire')).toBe(-lr.fire!);
    brute.curses = [{ skill: 'decrepify', lvl: 4, ticksLeft: 1000 }];
    expect(fifth(sim, brute, 'phys')).toBe(100 - Math.trunc(dec / 5));
    // Conviction and a curse add up, then the fifth applies to the total
    const tower = placeTower(sim, 6, 5, 'conviction', { tier: 3 });
    const conviction = (sim.data.skills['conviction'] as DebuffDef).levels[0]!.resistDown.fire!;
    fallen.x = tower.x;
    fallen.y = tower.y;
    expect(fifth(sim, fallen, 'fire')).toBe(100 - Math.trunc((lr.fire! + conviction) / 5));
  });

  it('an immune stays immune unless the fifth brings it under 100', () => {
    const sim = hell();
    const m = addMonster(sim, 'zombie1@hell', 0, { hp: 1_000_000 });
    // Cold 120: a cut of 100 takes 20 off, still immune; a cut of 105 takes 21, and it is not
    sim.fx = { towers: {}, emitters: [], monsters: { [m.id]: { slowPct: 0, resistDown: { cold: 100 }, damageDownPct: 0 } } };
    expect(damageAgainst(sim, m, 1000, 'cold', ALL)).toBe(0);
    sim.fx.monsters[m.id]!.resistDown.cold = 105;
    expect(damageAgainst(sim, m, 1000, 'cold', ALL)).toBe(10);
  });

  it('debuffs take no tier bonus: their values are the skills.txt levels the ladder picks', () => {
    const sim = testSim();
    for (const id of ['lower-resist', 'conviction', 'decrepify']) {
      expect(sim.data.ladders.find((l) => l.skill === id)!.tierBonus).toBe(1000);
    }
  });

  it("the walls land on the named monsters and champion packs: Hell's immunities, Nightmare's resistances", () => {
    const sim = testSim();
    const groupsOf = (d: number) => sim.data.waves.filter((w) => w.difficulty === d).flatMap((w) => w.groups);
    // A named monster wherever it walks on a difficulty (Treehead and Griswold only exist where their act 1 waves are)
    const named = (d: number, id: string) => groupsOf(d).find((g) => g.monster === variantId(id, d))?.mods;
    const champions = (d: number) => groupsOf(d).filter((g) => g.rank === 'champion').map((g) => g.mods);
    // Every Hell champion pack: Stone Skin (lifting a champion to physical 100) and Poison Immune
    for (const mods of champions(2)) expect(mods).toEqual(expect.arrayContaining(['stoneSkin', 'poisonImmune']));
    expect(champions(2)[0]).toEqual(['extraFast', 'stoneSkin', 'poisonImmune']);
    expect(named(2, 'griswold')).toEqual(expect.arrayContaining(['magicImmune', 'physicalImmune']));
    // Andariel: Magic Immune in place of Magic Resistant, never both
    expect(named(2, 'andariel')).toEqual(['extraStrong', 'magicImmune', 'poisonImmune', 'physicalImmune']);
    expect(champions(1)[0]).toEqual(['extraFast', 'poisonResistant']);
    expect(named(1, 'treehead')).toContain('magicResistant');
    expect(named(1, 'andariel')).toEqual(['magicResistant', 'extraStrong', 'poisonResistant']);
    expect(champions(0)[0]).toEqual(['extraFast']);
    // Treehead walks on Nightmare only; on Hell the rule would give him Magic Immune
    expect(resolveMods(DESIGN.balance, ['extraStrong', 'extraFast', ...DESIGN.balance.modSchedule.added.hell!.named!['treehead']!])).toContain('magicImmune');
  });

  it("Hell's Andariel is physical, magic and poison immune, with her raw fire, cold and lightning", () => {
    const sim = hell();
    const final = sim.data.waves.find((w) => w.difficulty === 2 && w.act === 1 && w.final)!;
    const mods = final.groups.find((g) => g.rank === 'boss')!.mods;
    const andariel = addMonster(sim, 'andariel@hell', 0, { rank: 'boss', mods });
    for (const e of ['phys', 'mag', 'pois'] as const) expect(damageAgainst(sim, andariel, 1000, e, ALL)).toBe(0);
    const raw = sim.data.monsters['andariel@hell']!.resist;
    for (const e of ['fire', 'cold', 'ltng'] as const) expect(effectiveResist(sim, andariel, e)).toBe(raw[e]);
  });

  it('an immune mod replaces its resistant mod and never stacks with it', () => {
    const sim = hell();
    const both = addMonster(sim, 'quillrat1@hell', 0, { mods: resolveMods(DESIGN.balance, ['magicResistant', 'magicImmune']) });
    expect(both.mods).toEqual(['magicImmune']);
    expect(effectiveResist(sim, both, 'mag')).toBe(100);
    expect(effectiveResist(sim, both, 'fire')).toBe(sim.data.monsters['quillrat1@hell']!.resist.fire);
    expect(resolveMods(DESIGN.balance, ['stoneSkin', 'physicalImmune', 'poisonResistant', 'poisonImmune'])).toEqual(['physicalImmune', 'poisonImmune']);
  });

  it('the immune mods are immunities, the resistant one is not', () => {
    const sim = hell();
    const mi = addMonster(sim, 'quillrat1@hell', 0, { mods: ['magicImmune'] });
    const pi = addMonster(sim, 'quillrat1@hell', 0, { mods: ['poisonImmune'] });
    const pr = addMonster(sim, 'quillrat1@hell', 0, { mods: ['poisonResistant'] });
    expect(damageAgainst(sim, mi, 1000, 'mag', ALL)).toBe(0);
    expect(damageAgainst(sim, pi, 1000, 'pois', ALL)).toBe(0);
    expect(damageAgainst(sim, pr, 1000, 'pois', ALL)).toBeGreaterThan(0);
    expect(damageAgainst(sim, mi, 1000, 'pois', ALL)).toBe(1000);
  });
});

describe('Hell walls, round two', () => {
  const nightmare = () => testSim();

  it('Stone Skin: +50 on Normal, +80 on Nightmare and Hell short of immune, 100 on a Hell champion', () => {
    const normal = testSim();
    expect(effectiveResist(normal, addMonster(normal, 'brute1', 0, { mods: ['stoneSkin'] }), 'phys')).toBe(50);
    const n = nightmare();
    expect(effectiveResist(n, addMonster(n, 'brute1@nightmare', 0, { mods: ['stoneSkin'] }), 'phys')).toBe(80);
    // Twice over still stops at 99: Nightmare's Stone Skin never makes an immune
    expect(effectiveResist(n, addMonster(n, 'brute1@nightmare', 0, { mods: ['stoneSkin', 'stoneSkin'] }), 'phys')).toBe(99);
    expect(effectiveResist(n, addMonster(n, 'brute1@nightmare', 0, { rank: 'champion', mods: ['stoneSkin'] }), 'phys')).toBe(80);
    const h = hell();
    expect(effectiveResist(h, addMonster(h, 'brute1@hell', 0, { rank: 'champion', mods: ['stoneSkin'] }), 'phys')).toBe(100);
    expect(effectiveResist(h, addMonster(h, 'brute1@hell', 0, { rank: 'unique', mods: ['stoneSkin'] }), 'phys')).toBe(80);
    // Physical Immune is immune whatever else the monster carries
    const pi = addMonster(h, 'brute1@hell', 0, { rank: 'unique', mods: ['stoneSkin', 'physicalImmune'] });
    expect(damageAgainst(h, pi, 1000, 'phys', ALL)).toBe(0);
  });

  it('weighs the alive count by rank: regular 1, champion 2, unique 3, act boss 10', () => {
    const weight = (def: string, rank: 'normal' | 'champion' | 'unique' | 'boss') => {
      const sim = testSim();
      addMonster(sim, def, 0, { rank });
      step(sim, []);
      return sim.state.alive;
    };
    expect(weight('zombie1', 'normal')).toBe(1);
    expect(weight('zombie1', 'champion')).toBe(2);
    expect(weight('zombie1', 'unique')).toBe(3);
    expect(weight('andariel', 'boss')).toBe(10);
  });

  it('nothing leaks: a monster laps the ring, and the run is lost when the alive weight reaches the limit', () => {
    const sim = testSim();
    const m = addMonster(sim, 'quillrat1', sim.map.length - 10);
    step(sim, []);
    expect(sim.state.monsters).toContain(m);
    expect(m.dist).toBeLessThan(sim.map.length / 10);
    expect(m.walked).toBeGreaterThan(0);
    const limit = sim.data.rules.aliveLimit;
    for (let i = 0; i < limit - 2; i++) addMonster(sim, 'zombie1', i * 500).stunTicks = 1_000_000;
    step(sim, []);
    expect(sim.state.alive).toBe(limit - 1);
    expect(sim.state.status).toBe('playing');
    addMonster(sim, 'zombie1', 777).stunTicks = 1_000_000;
    step(sim, []);
    expect(sim.state.status).toBe('lost');
  });
});

describe('blocking has a limit', () => {
  /** A skeleton that cannot die standing on the path, with its tower gone so none respawn. */
  const held = (def: string, rank: 'normal' | 'boss' = 'normal') => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 5, 'raise-skeleton', { level: 5 });
    step(sim, []);
    const skeleton = sim.state.summons[0]!;
    skeleton.hp = skeleton.maxHp = 1_000_000;
    sim.state.summons = [skeleton];
    sim.state.towers = sim.state.towers.filter((t) => t.id !== tower.id);
    const m = addMonster(sim, def, Math.max(0, skeleton.dist - 4000), { rank, hp: 1_000_000 });
    // Walk it up to the skeleton
    for (let i = 0; i < 2000 && m.blockedTicks === 0 && m.dist < skeleton.dist; i++) step(sim, []);
    return { sim, skeleton, m };
  };

  it('a held monster breaks through after blockBreakTicks (6 s), shoving the summon aside; the summon survives', () => {
    const { sim, skeleton, m } = held('brute1');
    expect(m.blockedBy).toBe(skeleton.id);
    expect(sim.data.rules.blockBreakTicks).toBe(120);
    const stoppedAt = m.dist;
    ticks(sim, sim.data.rules.blockBreakTicks - 2);
    // Still held, and the skeleton has been taking its hits
    expect(m.dist).toBe(stoppedAt);
    expect(skeleton.hp).toBeLessThan(1_000_000);
    ticks(sim, 3);
    expect(m.dist).toBeGreaterThan(stoppedAt);
    expect(m.brokeThrough).toContain(skeleton.id);
    expect(skeleton.shovedTicks).toBeGreaterThan(0);
    expect(sim.state.summons).toContain(skeleton);
    // It does not stop at that skeleton again
    const hp = skeleton.hp;
    ticks(sim, 40);
    expect(m.dist).toBeGreaterThan(skeleton.dist);
    expect(skeleton.hp).toBe(hp);
  });

  it('bosses are never blocked', () => {
    const { sim, skeleton, m } = held('andariel', 'boss');
    expect(m.blockedTicks).toBe(0);
    ticks(sim, 200);
    expect(m.dist).toBeGreaterThan(skeleton.dist);
    expect(skeleton.hp).toBe(1_000_000);
  });
});

describe('debuffs on the tier ladder', () => {
  it('a resistance cut is valued against a 50% resistant target, still with no tier bonus', () => {
    const sim = testSim();
    const reference = sim.data.skills['holy-bolt']!;
    const target = DESIGN_TARGET;
    expect(target).toBe(50);
    const lr = sim.data.skills['lower-resist'] as DebuffDef;
    const cut = Math.max(...Object.values(lr.levels[4]!.resistDown).map((v) => v ?? 0));
    const after = Math.max(-100, target - cut);
    expect(auraMultiplier(lr, 4, reference, target)).toBe(Math.trunc((1000 * (100 - after)) / (100 - target)));
    // Worth more than against a plain target, which is how a cut past 0% plays
    expect(auraMultiplier(lr, 4, reference, target)).toBeGreaterThan(auraMultiplier(lr, 4, reference, 0));
    expect(sim.data.ladders.find((l) => l.skill === 'lower-resist')!.tierBonus).toBe(1000);
  });
});

describe('summons on harder difficulties', () => {
  it('skeleton HP grows per level by the skill HP percent (calc1)', () => {
    const skeleton = testSim().data.skills['raise-skeleton'] as SummonDef;
    const first = skeleton.levels[0]!;
    const top = skeleton.levels[4]!;
    expect(first.hpPct).toBe(0);
    expect(top.hpPct).toBeGreaterThan(0);
    expect(top.hp).toBe(Math.trunc((first.hp * (100 + top.hpPct)) / 100));
  });

  it("monsters hit summons with their own difficulty's damage", () => {
    const normal = monsterIn(testSim().data, 'brute1');
    const hellBrute = monsterIn(hell().data, 'brute1@hell');
    expect(hellBrute.maxDamage).toBeGreaterThan(normal.maxDamage);
    // A1MaxD(H) percent of monlvl DM(H) at Level(H)
    expect(hellBrute.maxDamage).toBe(Math.trunc((120 * (4 + 30 * 2)) / 100) * 256);
  });
});

describe('poison', () => {
  it('lands its dose over the poison length; a weaker dose never replaces a stronger one', () => {
    const sim = testSim();
    const m = addMonster(sim, 'quillrat1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    poison(sim, m, 4000, 40);
    expect(m.poisonTicks).toBe(40);
    expect(m.poisonPerTick).toBe(100);
    poison(sim, m, 1000, 40);
    expect(m.poisonPerTick).toBe(100);
    ticks(sim, 40);
    expect(m.hp).toBe(1_000_000 - 4000);
    expect(m.poisonTicks).toBe(0);
  });

  it('Poison Nova poisons everything its ring passes, once each', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'poison-nova', { tier: 3 });
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
    placeTower(sim, 6, 5, 'amplify-damage');
    placeTower(sim, 5, 5, 'decrepify', { tier: 2 });
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
    placeTower(sim, 6, 5, 'lower-resist', { tier: 3 });
    placeTower(sim, 5, 5, 'conviction', { tier: 3 });
    const m = addMonster(sim, 'brute1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    step(sim, []);
    const lr = (sim.data.skills['lower-resist'] as DebuffDef).levels[0]!.resistDown.fire!;
    const conviction = (sim.data.skills['conviction'] as DebuffDef).levels[0]!.resistDown.fire!;
    expect(computeAuras(sim).monsters[m.id]!.resistDown.fire).toBe(lr + conviction);
  });

  it('wears off after its duration', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'amplify-damage');
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
      const tower = placeTower(sim, 6, 5, 'raise-skeleton', { level: 5 });
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
    placeTower(sim, 6, 5, 'static-field');
    const m = addMonster(sim, 'brute1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    const pct = (sim.data.skills['static-field'] as DebuffDef).levels[0]!.hpPct;
    step(sim, []);
    expect(m.hp).toBe(1_000_000 - Math.trunc((1_000_000 * pct) / 100));

    const h = hell();
    placeTower(h, 6, 5, 'static-field');
    // The floor is the difficulty of the monster's wave: a Hell one
    const hellWave = h.data.waves.findIndex((w) => w.difficulty === 2);
    const hm = addMonster(h, 'brute1@hell', BESIDE, { hp: 1_000_000, wave: hellWave });
    freeze(hm);
    ticks(h, 2000);
    expect(hm.hp).toBe(Math.trunc((1_000_000 * h.data.rules.staticFloorPct[2]!) / 100));
  });

  it('Enchant adds fire to the hits of towers in its radius', () => {
    const sim = testSim();
    const bolt = placeTower(sim, 6, 5, 'holy-bolt');
    placeTower(sim, 6, 6, 'enchant', { tier: 2 });
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
