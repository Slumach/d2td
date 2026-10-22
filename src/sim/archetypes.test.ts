import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SKILL_JSON } from '../data/design.ts';
import { ARCHETYPES } from './archetypes/index.ts';
import type { ArchetypeId, SummonDef } from './archetypes/types.ts';
import { speedOf } from './monsters.ts';
import { step } from './sim.ts';
import { addMonster, freeze, placeTower, testSim, ticks } from './testkit.ts';

describe('skill data', () => {
  it('registers every JSON file in src/data/skills', () => {
    const files = readdirSync(join('src', 'data', 'skills')).map((f) => f.replace(/\.json$/, ''));
    expect(SKILL_JSON.map((s) => s.id).sort()).toEqual(files.sort());
  });

  it('has at least one skill entry on each of the ten archetypes', () => {
    const used = new Set(SKILL_JSON.map((s) => s.archetype));
    expect([...used].sort()).toEqual((Object.keys(ARCHETYPES) as ArchetypeId[]).sort());
  });
});

// The tower stands at tile (2, 4); the path's first segment runs along row 3, so a
// monster at path distance 3000 is one tile north of it.
const BESIDE = 3000;

describe('archetypes', () => {
  it('projectile: Holy Bolt flies to its target and hits it', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'holy-bolt');
    const zombie = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    freeze(zombie);
    step(sim, []);
    expect(sim.state.missiles).toHaveLength(1);
    ticks(sim, 20);
    expect(zombie.hp).toBeLessThan(1_000_000);
  });

  it('pierce: Bone Spear passes through every monster in its line', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'bone-spear');
    // Two monsters straight north-ish along the same line from the tower
    const a = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    const b = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    [a, b].forEach(freeze);
    ticks(sim, 10);
    expect(a.hp).toBeLessThan(1_000_000);
    expect(b.hp).toBeLessThan(1_000_000);
  });

  it('chain: Chain Lightning jumps between monsters, one hit each', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'chain-lightning');
    const ms = [BESIDE, BESIDE + 800, BESIDE + 1600].map((d) => addMonster(sim, 'quillrat1', d, { hp: 1_000_000 }));
    ms.forEach(freeze);
    step(sim, []);
    for (const m of ms) expect(m.hp).toBeLessThan(1_000_000);
  });

  it('splash orbit: Blessed Hammer spirals out and hits what it passes', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'blessed-hammer', { tier: 2 });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    ticks(sim, 80);
    expect(m.hp).toBeLessThan(1_000_000);
    expect(sim.state.missiles.length).toBeGreaterThan(1);
  });

  it('splash strike: FoH hits its target and sprays bolts only at undead and demons', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'fist-of-the-heavens', { tier: 3 });
    const target = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    const undead = addMonster(sim, 'skeleton1', BESIDE + 1500, { hp: 1_000_000 });
    const rat = addMonster(sim, 'quillrat1', BESIDE - 1500, { hp: 1_000_000 });
    [target, undead, rat].forEach(freeze);
    // Target the zombie: it is furthest along only if we ask for closest
    sim.state.towers[0]!.targeting = 'closest';
    ticks(sim, 12);
    expect(target.hp).toBeLessThan(1_000_000);
    expect(undead.hp).toBeLessThan(1_000_000);
    expect(rat.hp).toBe(1_000_000);
  });

  it('zone: Blizzard keeps hitting monsters inside it', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'blizzard');
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    step(sim, []);
    ticks(sim, 15);
    const after15 = m.hp;
    ticks(sim, 30);
    expect(after15).toBeLessThan(1_000_000);
    expect(m.hp).toBeLessThan(after15);
  });

  it('melee: Sacrifice only reaches monsters touching its tile', () => {
    const sim = testSim();
    placeTower(sim, 6, 4, 'sacrifice');
    const near = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    const far = addMonster(sim, 'zombie1', BESIDE + 4000, { hp: 1_000_000 });
    [near, far].forEach(freeze);
    ticks(sim, 5);
    expect(near.hp).toBeLessThan(1_000_000);
    expect(far.hp).toBe(1_000_000);
  });

  it('melee: Zeal swings several times per attack, spreading over targets', () => {
    const sim = testSim();
    placeTower(sim, 6, 4, 'zeal', { tier: 2, level: 3 });
    const a = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    const b = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    [a, b].forEach(freeze);
    sim.state.towers[0]!.targeting = 'strongest';
    step(sim, []);
    // Strongest re-picks each swing, so the hits alternate between the two
    expect(a.hp).toBeLessThan(1_000_000);
    expect(b.hp).toBeLessThan(1_000_000);
  });

  it('melee: Vengeance adds fire, cold and lightning, so it still hurts physical immunes', () => {
    const sim = testSim();
    placeTower(sim, 6, 4, 'vengeance', { tier: 3 });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000, mods: ['stoneSkin'] });
    freeze(m);
    sim.data.rules.mods.stoneSkin.resist[0]!.add = { phys: 100 };
    step(sim, []);
    expect(m.hp).toBeLessThan(1_000_000);
  });

  it('control: Holy Freeze pulses cold damage on top of its slow', () => {
    const sim = testSim();
    placeTower(sim, 6, 5, 'holy-freeze', { tier: 2, level: 5 });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    const free = speedOf(sim, m);
    step(sim, []);
    expect(speedOf(sim, m)).toBeLessThan(free);
    expect(m.hp).toBeLessThan(1_000_000);
  });

  it('summon: skeletons stand on the path and block monsters until they die', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 5, 'raise-skeleton', { level: 5 });
    step(sim, []);
    expect(sim.state.summons).toHaveLength(1);
    const skeleton = sim.state.summons[0]!;
    // A monster walking up the path stops in front of the skeleton
    const m = addMonster(sim, 'brute1', 0, { hp: 1_000_000 });
    ticks(sim, 60);
    expect(m.dist).toBe(skeleton.dist - sim.data.rules.blockRangeUnits);
    expect(skeleton.hp).toBeLessThan(skeleton.maxHp);
    // Once the skeleton falls the tower waits respawnTicks before raising another
    skeleton.hp = 0;
    step(sim, []);
    const respawn = (sim.data.skills['raise-skeleton'] as SummonDef).respawnTicks;
    expect(tower.summonCooldown).toBeGreaterThan(respawn - 3);
  });

  it('corpse: Corpse Explosion consumes a corpse and damages everything near it', () => {
    const sim = testSim();
    const victim = addMonster(sim, 'fallen1', BESIDE, { hp: 256 });
    freeze(victim);
    const bystander = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    freeze(bystander);
    // A Holy Bolt tower makes the corpse
    placeTower(sim, 6, 5, 'holy-bolt');
    ticks(sim, 15);
    expect(sim.state.corpses).toHaveLength(1);
    sim.state.towers = [];
    placeTower(sim, 6, 6, 'corpse-explosion');
    const before = bystander.hp;
    step(sim, []);
    expect(sim.state.corpses).toHaveLength(0);
    expect(bystander.hp).toBeLessThan(before);
  });
});

describe('monsters', () => {
  it('Fallen Shaman stands still through its resurrect sequence, then the corpse rises into its wave', () => {
    const sim = testSim();
    const fallen = addMonster(sim, 'fallen1', BESIDE, { hp: 256 });
    freeze(fallen);
    placeTower(sim, 6, 5, 'holy-bolt');
    ticks(sim, 15);
    expect(sim.state.corpses.map((c) => c.def)).toEqual(['fallen1']);
    sim.state.towers = [];

    const ability = sim.data.monsters['fallenshaman1']!.resurrect!;
    ability.chancePct = 100;
    const shaman = addMonster(sim, 'fallenshaman1', BESIDE - 1000);
    shaman.abilityCooldown = 1;
    const waveBefore = sim.state.waves[0]!.remaining;
    step(sim, []);
    expect(shaman.castTicks).toBe(ability.castTicks);
    const castingAt = shaman.dist;
    ticks(sim, ability.castTicks - 1);
    expect(shaman.dist).toBe(castingAt);
    expect(sim.state.monsters.filter((m) => m.def === 'fallen1')).toHaveLength(0);
    step(sim, []);
    expect(sim.state.corpses).toHaveLength(0);
    expect(sim.state.monsters.filter((m) => m.def === 'fallen1')).toHaveLength(1);
    expect(sim.state.waves[0]!.remaining).toBe(waveBefore + 1);
  });

  it('Fallen Shaman reads its chance, range and cast time from the tables', () => {
    const sim = testSim();
    // Fixture monstats: aidel 15, aip1 50, aip4 24; monseq: 15 frames
    expect(sim.data.monsters['fallenshaman1']!.resurrect).toEqual({
      monTypes: ['fallen'],
      chancePct: 50,
      radiusUnits: (24 * 1000) / 8,
      castTicks: 12,
    });
    expect(sim.data.monsters['fallenshaman1']!.aiDelayTicks).toBe(12);
  });

  it('Fallen Shaman ignores corpses of other monster types', () => {
    const sim = testSim();
    sim.data.monsters['fallenshaman1']!.resurrect!.chancePct = 100;
    sim.state.corpses.push({ id: 999, def: 'zombie1', rank: 'normal', dist: BESIDE, x: 2500, y: 3500, maxHp: 256, ticksLeft: 100 });
    const shaman = addMonster(sim, 'fallenshaman1', BESIDE);
    shaman.abilityCooldown = 1;
    step(sim, []);
    expect(shaman.castTicks).toBe(0);
    expect(sim.state.corpses).toHaveLength(1);
  });

  it('corpses last corpseLifetimeTicks', () => {
    const sim = testSim();
    sim.state.corpses.push({ id: 999, def: 'zombie1', rank: 'normal', dist: 0, x: 0, y: 0, maxHp: 256, ticksLeft: sim.data.rules.corpseLifetimeTicks });
    ticks(sim, sim.data.rules.corpseLifetimeTicks - 1);
    expect(sim.state.corpses).toHaveLength(1);
    step(sim, []);
    expect(sim.state.corpses).toHaveLength(0);
  });

  it('champions and uniques get the monumod.txt HP bonus; Extra Fast walks faster', () => {
    const sim = testSim();
    const normal = addMonster(sim, 'zombie1', 0);
    const champion = addMonster(sim, 'zombie1', 0, { rank: 'champion' });
    const unique = addMonster(sim, 'zombie1', 0, { rank: 'unique', mods: ['extraFast', 'stoneSkin'] });
    const def = sim.data.monsters['zombie1']!;
    expect(normal.maxHp).toBeLessThanOrEqual(def.maxHp);
    expect(champion.maxHp).toBeGreaterThanOrEqual(def.minHp * (100 + sim.data.rules.championHpPct) / 100 - 1);
    expect(unique.maxHp).toBeGreaterThanOrEqual(def.minHp * (100 + sim.data.rules.uniqueHpPct) / 100 - 1);
    expect(speedOf(sim, unique)).toBeGreaterThan(speedOf(sim, normal));
  });
});
