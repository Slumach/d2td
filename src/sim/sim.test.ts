import { describe, expect, it } from 'vitest';

import { DESIGN } from '../data/design.ts';
import { hasTables, loadTables } from '../../tools/lib/load-tables.ts';
import { runBot, type Strategy } from '../../tools/bots.ts';
import { damageAt, elementalAtLevel } from './archetypes/common.ts';
import type { BuffAuraDef, ControlDef, DebuffDef, ProjectileDef } from './archetypes/types.ts';
import { buildGameData, compound, resolveSkill, type GameData } from './data.ts';
import { isqrt } from './fixed.ts';
import { FIXTURE_BUILD, FIXTURE_TABLES, fixtureDesign, fixtureGameData } from './fixture.ts';
import { stateHash } from './hash.ts';
import { createMap, isPathTile } from './map.ts';
import { createRng, nextU32, rollInt } from './rng.ts';
import { createSim, runLog, step } from './sim.ts';
import type { TimedCommand } from './state.ts';

describe('isqrt', () => {
  it('floors square roots exactly', () => {
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 999_999, 1_000_000, 32_000_000]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
  });
});

describe('rng', () => {
  it('replays the same sequence from the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 50 }, () => nextU32(a));
    expect(seqA).toEqual(Array.from({ length: 50 }, () => nextU32(b)));
    expect(seqA.every((n) => Number.isInteger(n) && n >= 0 && n < 2 ** 32)).toBe(true);
  });

  it('rolls inclusive integer ranges', () => {
    const rng = createRng(7);
    expect(new Set(Array.from({ length: 500 }, () => rollInt(rng, 3, 6)))).toEqual(new Set([3, 4, 5, 6]));
  });
});

describe('map', () => {
  it('marks a connected path and leaves the rest buildable', () => {
    const map = createMap();
    expect([map.width, map.height]).toEqual([42, 42]);
    expect(isPathTile(map, 3, 3) && isPathTile(map, 20, 3) && isPathTile(map, 38, 20)).toBe(true);
    expect(isPathTile(map, 0, 0)).toBe(false);
    expect(isPathTile(map, 20, 20)).toBe(false);
  });
});

describe('data', () => {
  it('applies the D2 per-level elemental brackets for skills and missiles', () => {
    const skill = FIXTURE_TABLES.skills.find((r) => r['skill'] === 'Holy Bolt')!;
    expect(elementalAtLevel(skill, 'min', 1, 'skill')).toBe(10);
    expect(elementalAtLevel(skill, 'min', 8, 'skill')).toBe(10 + 7 * 2);
    expect(elementalAtLevel(skill, 'min', 10, 'skill')).toBe(10 + 7 * 2 + 2 * 4);
    const bolt = FIXTURE_TABLES.missiles.find((r) => r['Missile'] === 'fohbolt')!;
    expect(damageAt(bolt, 2, 'missile')).toEqual({ min: (20 + 2) * 256, max: (30 + 2) * 256 });
  });

  it('compounds integer percents per mille', () => {
    expect(compound(112, 3)).toEqual([1000, 1120, 1254]);
  });

  it('lays out the schedule: one monster a wave for streamTicks, act bosses on their own waves', () => {
    const data = fixtureGameData(30);
    const waves = data.waves;
    const b = DESIGN.balance.waves;
    expect(waves.filter((w) => w.kind === 'boss').map((w) => w.groups.find((g) => g.rank === 'boss')!.monster)).toEqual(['bloodraven', 'andariel']);
    waves.forEach((w, i) => {
      const entry = DESIGN.monsters.waves[i]!;
      if (w.kind === 'boss' || !('monster' in entry)) return;
      // One monster type in the stream (its first and last groups), a monster every spacingTicks for streamTicks
      const first = w.groups[0]!;
      const last = w.groups.at(-1)!;
      expect([first.monster, last.monster]).toEqual([entry.monster, entry.monster]);
      const spacing = b[w.kind].spacingTicks;
      expect(first.count + (w.groups.length > 1 ? last.count : 0)).toBe(Math.trunc(b.streamTicks / spacing));
      for (const g of w.groups) expect(g.spacingTicks).toBe(spacing);
      expect(spacing).toBeGreaterThanOrEqual(20);
      expect(spacing).toBeLessThanOrEqual(30);
    });
    // The Fallen Shaman keeps a wave of its own
    expect(waves.some((w) => w.kind !== 'boss' && w.groups[0]!.monster === 'fallenshaman1')).toBe(true);
  });

  it('a superunique walks in the middle of its wave as the unique, with its pack and its superuniques.txt mods', () => {
    const data = fixtureGameData(30);
    const n = DESIGN.monsters.waves.findIndex((w) => 'superunique' in w && w.superunique === 'rakanishu') + 1;
    const groups = data.waves[n - 1]!.groups;
    const at = groups.findIndex((g) => g.monster === 'rakanishu');
    expect(groups[at]).toMatchObject({ rank: 'unique', count: 1, mods: ['lightningEnchanted'] });
    // Its pack walks just before it, the wave's stream on either side
    expect(groups[at - 1]).toMatchObject({ monster: 'fallen2', rank: 'normal', count: 4 });
    expect(groups[0]!.monster).toBe('fallen2');
    expect(groups.at(-1)!.monster).toBe('fallen2');
    expect(data.monsters['rakanishu']).toMatchObject({ base: 'fallen2', name: 'Rakanishu', artVariant: 'su_rakanishu' });
    // An act boss's wave is its pack, then the boss
    const raven = data.waves.find((w) => w.kind === 'boss')!.groups;
    expect(raven.map((g) => [g.monster, g.rank, g.count])).toEqual([['zombie2', 'normal', 3], ['bloodraven', 'boss', 1]]);
    expect(data.monsters['foulcrow1']!.flying).toBe(true);
  });

  it('places champion packs by the fixed schedule, as the wave\'s own monster', () => {
    const waves = fixtureGameData(30).waves;
    const ranked = (n: number, rank: string) => waves[n - 1]!.groups.filter((g) => g.rank === rank);
    const s = DESIGN.balance.modSchedule;
    const specials = (rank: string) => waves.map((_, i) => i + 1).filter((n) => ranked(n, rank).length > 0);
    expect(specials('champion')).toEqual([5, 15, 25]);
    expect(ranked(5, 'champion')).toEqual([expect.objectContaining({ count: DESIGN.balance.waves.championPackSize, mods: s.champions['5'] })]);
    for (const n of [5, 15, 25]) {
      const own = waves[n - 1]!.groups[0]!.monster;
      expect(ranked(n, 'champion')[0]!.monster).toBe(own);
    }
    expect(ranked(30, 'boss')[0]).toMatchObject({ monster: 'andariel', mods: ['magicResistant', 'extraStrong'] });
  });

  it('gives every seed the same specials: mods are scheduled, not rolled', () => {
    const modsOn = (seed: number, wave: number) => {
      const sim = createSim(fixtureGameData(30), seed);
      sim.state.wave = wave - 1;
      sim.state.waves = Array.from({ length: wave - 1 }, () => ({ remaining: 0 }));
      step(sim, [{ type: 'callWave' }]);
      return sim.state.spawns.filter((sp) => sp.rank !== 'normal').map((sp) => `${sp.rank}:${sp.mods.join('+')}`);
    };
    for (const wave of [5, 10, 14, 30]) expect(modsOn(1, wave)).toEqual(modsOn(99, wave));
  });

  it("a boss rolls its own monstats HP on the wave's curve, like any monster", () => {
    const data = fixtureGameData(30);
    const sim = createSim(data, 1);
    sim.state.wave = 29;
    sim.state.waves = Array.from({ length: 29 }, () => ({ remaining: 0 }));
    step(sim, [{ type: 'callWave' }]);
    sim.state.spawns = sim.state.spawns.map((sp) => ({ ...sp, tick: sim.state.tick }));
    step(sim, []);
    const andariel = sim.state.monsters.find((m) => m.def === 'andariel')!;
    const def = data.monsters['andariel']!;
    expect(andariel.maxHp).toBe(Math.trunc((def.maxHp * data.waves[29]!.hpPermille) / 1000));
  });

  it('builds tier ladders: every tier-up reaches the floor, five rising steps to the cap', () => {
    for (const data of [fixtureGameData(), ...(hasTables() ? [buildGameData(loadTables(), DESIGN)] : [])]) {
      const { dpsPct, caps } = DESIGN.balance.tierLadder;
      const laddered = DESIGN.classes.flatMap((c) => Object.values(c.lines).flatMap((l) => l.tiers.slice(1).flat()));
      expect(data.ladders.length).toBe(laddered.length);
      for (const ladder of data.ladders) {
        const cap = caps[String(ladder.tier)]!;
        expect(ladder.levels).toHaveLength(5);
        expect(ladder.levels[4]).toBe(cap);
        for (let i = 1; i < 5; i++) expect(ladder.levels[i]!).toBeGreaterThanOrEqual(ladder.levels[i - 1]!);
        expect(data.skills[ladder.skill]!.skillLevels).toEqual(ladder.levels);
        // A strict upgrade, with or without a tier bonus; unmeasured skills climb the whole range
        if (!ladder.measured) {
          expect(ladder.levels[0]).toBe(1);
          continue;
        }
        // Debuffs keep skills.txt's own values: an unreached floor climbs cap-4 to cap with no bonus
        if (data.skills[ladder.skill]!.archetype === 'debuff') {
          expect(ladder.tierBonus).toBe(1000);
          if (!ladder.reached) expect(ladder.levels).toEqual([cap - 4, cap - 3, cap - 2, cap - 1, cap]);
          continue;
        }
        expect(ladder.start * 100).toBeGreaterThanOrEqual(ladder.previous * dpsPct);
        if (ladder.reached) expect(ladder.tierBonus).toBe(1000);
        else {
          expect(ladder.levels).toEqual([cap - 4, cap - 3, cap - 2, cap - 1, cap]);
          expect(ladder.tierBonus).toBeGreaterThan(1000);
        }
      }
      // T1 skills keep their JSON levels
      expect(data.skills['holy-bolt']!.skillLevels).toEqual([1, 5, 10, 15, 20]);
    }
  });

  it('refuses hand-typed skillLevels on a T2 or T3 skill', () => {
    const bad = { ...DESIGN, skills: DESIGN.skills.map((s) => (s.id === 'zeal' ? { ...s, skillLevels: [1, 5, 10, 15, 20] } : s)) };
    expect(() => buildGameData(FIXTURE_TABLES, fixtureDesign(bad), 30, FIXTURE_BUILD)).toThrow(/computed ladder/);
  });

  it.skipIf(!hasTables())('refuses a skill JSON tierBonus that no longer matches the data', () => {
    const stale = { ...DESIGN, skills: DESIGN.skills.map((s) => (s.id === 'vengeance' ? { ...s, tierBonus: 1000 } : s)) };
    expect(() => buildGameData(loadTables(), stale)).toThrow(/tierBonus/);
  });

  it('prices levels per tier with the compounding multiplier', () => {
    const e = fixtureGameData().economy;
    const pct = DESIGN.balance.levelCostPctPerLevel;
    expect(e.levelCosts[0]![0]).toBe(DESIGN.balance.levelCostBase[0]);
    expect(e.levelCosts[0]![1]).toBe(Math.trunc((DESIGN.balance.levelCostBase[0]! * pct) / 100));
    expect(e.levelCosts[2]![0]).toBe(DESIGN.balance.levelCostBase[2]);
    expect(e.tierCosts).toEqual(DESIGN.balance.tierCosts);
  });
});

/** Long enough for the opening, tiers, branches and an evolve on the rich economy. */
const REPLAY_TICKS = 8000;

/** Plays a bot game recording hashes every 100 ticks, then replays its log twice. */
function replaySuite(name: string, getData: () => GameData, strategies: Strategy[]): void {
  describe(name, () => {
    for (const strategy of strategies) {
      it(`${strategy}: two sims replaying the same seed and command log match the original every 100 ticks`, { timeout: 120_000 }, () => {
        const data = getData();
        const recorded: number[] = [];
        const run = runBot(
          data,
          strategy,
          1234,
          (s) => {
            if (s.state.tick % 100 === 0) recorded.push(stateHash(s.state));
          },
          REPLAY_TICKS,
        );
        const end = recorded.length * 100;
        expect(end).toBeGreaterThan(1000);

        const replay = (log: TimedCommand[], seed: number) => {
          const sim = createSim(data, seed);
          const hashes: number[] = [];
          runLog(sim, log, end + 1, (s) => {
            if (s.state.tick % 100 === 0) hashes.push(stateHash(s.state));
          });
          return hashes;
        };
        const a = replay(run.log, 1234);
        const b = replay(run.log, 1234);
        a.forEach((hash, i) => {
          expect(hash, `client A at tick ${(i + 1) * 100}`).toBe(recorded[i]);
          expect(b[i], `client B at tick ${(i + 1) * 100}`).toBe(hash);
        });

        // A different seed, or a log missing one command, ends up somewhere else
        expect(replay(run.log, 99)).not.toEqual(recorded);
        expect(replay(run.log.slice(1), 1234)).not.toEqual(recorded);
      });
    }

    it('the PALADIN log exercises every Paladin command, evolve included', { timeout: 120_000 }, () => {
      const run = runBot(getData(), 'PALADIN', 1234, undefined, REPLAY_TICKS);
      const types = new Set(run.log.map((c) => c.command.type));
      for (const t of ['build', 'upgrade', 'upgradeTier', 'pickBranch', 'evolve', 'callWave'] as const) expect(types).toContain(t);
    });
  });
}

/**
 * Replay runs on a rich economy so the bot's log reaches tiers, branches and evolutions
 * whatever balance.json says; determinism must not depend on tuning.
 */
const RICH: typeof DESIGN = { ...DESIGN, balance: { ...DESIGN.balance, startingGold: 20_000 } };

replaySuite('replay (fixture data)', () => buildGameData(FIXTURE_TABLES, fixtureDesign(RICH), 30, FIXTURE_BUILD), ['PALADIN', 'TWOLINE']);

// Runs only where the pipeline has written the real tables; the repo holds no game data.
describe.skipIf(!hasTables())('real tables', () => {
  const real = () => buildGameData(loadTables(), DESIGN, 30);

  it('resolves the Paladin skills to their skills.txt numbers', () => {
    const data = real();
    const bolt = data.skills['holy-bolt'] as ProjectileDef;
    expect(bolt.levels[0]).toMatchObject({ min: 8 * 256, max: 16 * 256 });
    expect(bolt.filter).toMatchObject({ fullDamageTo: 'undead', otherDamagePct: 40 });
    expect((data.skills['might'] as BuffAuraDef).levels[0]!.damagePct).toBe(40);
    expect((data.skills['might'] as BuffAuraDef).levels[4]!.damagePct).toBe(230);
    // T2/T3 skills are laddered; resolve them at skill level 1 to check the raw table values
    const atLevel1 = (id: string) =>
      resolveSkill(loadTables(), DESIGN.skills.find((s) => s.id === id)!, DESIGN, undefined, [1, 1, 1, 1, 1]);
    expect((atLevel1('holy-freeze') as ControlDef).levels[0]!.slowPct).toBe(30);
    expect((atLevel1('conviction') as DebuffDef).levels[0]!.resistDown).toEqual({ fire: 30, cold: 30, ltng: 30 });
    expect(data.rules.championHpPct).toBe(200);
    expect(data.rules.uniqueHpPct).toBe(300);
  });

  it('reads the Act 1 roster with its undead and demon flags', () => {
    const m = real().monsters;
    expect(m['zombie1']!.undead && m['skeleton1']!.undead).toBe(true);
    expect(m['fallen1']!.demon && m['fallenshaman1']!.demon && m['andariel']!.demon).toBe(true);
    expect(m['quillrat1']!.undead || m['quillrat1']!.demon).toBe(false);
    expect(m['fallenshaman1']!.resurrect).toMatchObject({ monType: 'fallen', chancePct: 45 });
  });
});

if (hasTables()) replaySuite('replay (real tables)', () => buildGameData(loadTables(), RICH, 30), ['PALADIN']);

describe('difficulty', () => {
  it('Nightmare and Hell monsters are their own entries, read from the (N) and (H) columns', () => {
    const data = fixtureGameData(30, { difficulty: 2 });
    const zombie = data.monsters['zombie1@hell']!;
    expect(zombie).toMatchObject({ base: 'zombie1', difficulty: 2 });
    expect(zombie.resist.cold).toBe(120);
    // Bounty follows Normal's level
    expect(zombie.level).toBe(fixtureGameData().monsters['zombie1']!.level);
    expect(data.waves[0]!.difficulty).toBe(2);
    for (const g of data.waves[0]!.groups) expect(g.monster.endsWith('@hell')).toBe(true);
  });

  it('after the last wave the map loops at the next difficulty, through Hell', () => {
    const data = fixtureGameData(30, { loop: true });
    expect(data.waves).toHaveLength(90);
    expect(data.waves.map((w) => w.difficulty)).toEqual([...Array(30).fill(0), ...Array(30).fill(1), ...Array(30).fill(2)]);
    expect(data.waves[30]!.number).toBe(1);
    expect(fixtureGameData(30, { difficulty: 1, loop: true }).waves).toHaveLength(60);
  });

  it.skipIf(!hasTables())("scales each difficulty's wave monsters to Normal's average HP", () => {
    const data = buildGameData(loadTables(), DESIGN, 30, { loop: true });
    const avg = (d: number) => {
      const pooled = new Set(DESIGN.monsters.waves.flatMap((w) => ('monster' in w ? [w.monster] : [])));
      const defs = Object.values(data.monsters).filter((m) => m.difficulty === d && pooled.has(m.base));
      return defs.reduce((n, m) => n + m.minHp + m.maxHp, 0) / defs.length;
    };
    // Within rounding: no monster drops below 1 HP, and the smallest round up a lot
    for (const d of [1, 2]) expect(Math.abs(avg(d) / avg(0) - 1)).toBeLessThan(0.15);
    // The columns still say who is tough: a Hell zombie outlasts a Hell fallen
    expect(data.monsters['zombie1@hell']!.maxHp).toBeGreaterThan(data.monsters['fallen1@hell']!.maxHp);
  });
});
