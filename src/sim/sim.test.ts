import { describe, expect, it } from 'vitest';

import { DESIGN } from '../data/design.ts';
import { hasTables, loadTables } from '../../tools/lib/load-tables.ts';
import { runBot, type Strategy } from '../../tools/bots.ts';
import { damageAt, elementalAtLevel } from './archetypes/common.ts';
import type { BuffAuraDef, ControlDef, DebuffDef, ProjectileDef } from './archetypes/types.ts';
import { buildGameData, compound, generateWaves, type GameData } from './data.ts';
import { isqrt } from './fixed.ts';
import { FIXTURE_TABLES, fixtureDesign, fixtureGameData } from './fixture.ts';
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
    expect([map.width, map.height]).toEqual([30, 17]);
    expect(isPathTile(map, 0, 3)).toBe(true);
    expect(isPathTile(map, 0, 0)).toBe(false);
    expect(isPathTile(map, 11, 12) && isPathTile(map, 15, 8)).toBe(true);
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

  it('generates waves from the formulas: 2 to 4 types, champions, uniques and bosses', () => {
    const b = DESIGN.balance;
    const waves = generateWaves(b, DESIGN.monsters, 30);
    const normalCount = (i: number) => waves[i]!.groups.filter((g) => g.rank === 'normal').reduce((n, g) => n + g.count, 0);
    expect(waves.map((w) => w.kind).slice(0, 4)).toEqual(['swarm', 'tank', 'swarm', 'tank']);
    expect(normalCount(0)).toBe(b.waves.swarm.base + b.waves.swarm.perWave * 1);
    expect(normalCount(1)).toBe(b.waves.tank.base + b.waves.tank.perWave * 2);
    for (const w of waves) {
      const types = w.groups.filter((g) => g.rank === 'normal').length;
      expect(types).toBeGreaterThanOrEqual(b.waves.minTypes);
      expect(types).toBeLessThanOrEqual(b.waves.maxTypes);
    }
    const ranked = (n: number, rank: string) => waves[n - 1]!.groups.filter((g) => g.rank === rank);
    expect(ranked(5, 'champion')).toEqual([expect.objectContaining({ count: b.waves.championPackSize, modCount: 1 })]);
    expect(ranked(10, 'unique')).toEqual([expect.objectContaining({ count: 1, modCount: 2 })]);
    expect(ranked(10, 'boss').map((g) => g.monster)).toEqual(['bloodraven']);
    expect(ranked(20, 'boss').map((g) => g.monster)).toEqual(['bloodraven']);
    expect(ranked(30, 'boss').map((g) => g.monster)).toEqual(['andariel']);
    expect(ranked(7, 'champion')).toEqual([]);
  });

  it('rolls champion and unique mods when the wave is called, one set per pack', () => {
    const sim = createSim(fixtureGameData(10), 3);
    sim.state.wave = 4; // the next call is wave 5, a champion wave
    sim.state.waves = Array.from({ length: 4 }, () => ({ remaining: 0, bounty: 0, early: false }));
    step(sim, [{ type: 'callWave' }]);
    const champions = sim.state.spawns.filter((sp) => sp.rank === 'champion');
    expect(champions.length).toBe(DESIGN.balance.waves.championPackSize);
    expect(champions[0]!.mods).toHaveLength(1);
    expect(new Set(champions.map((c) => c.mods.join()))).toHaveLength(1);
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

/** Plays a bot game recording hashes every 100 ticks, then replays its log twice. */
function replaySuite(name: string, getData: () => GameData, strategies: Strategy[]): void {
  describe(name, () => {
    for (const strategy of strategies) {
      it(`${strategy}: two sims replaying the same seed and command log match the original every 100 ticks`, () => {
        const data = getData();
        const recorded: number[] = [];
        const run = runBot(data, strategy, 1234, (s) => {
          if (s.state.tick % 100 === 0) recorded.push(stateHash(s.state));
        });
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

    it('the PALADIN log exercises every Paladin command, evolve included', () => {
      const run = runBot(getData(), 'PALADIN', 1234);
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

replaySuite('replay (fixture data)', () => buildGameData(FIXTURE_TABLES, fixtureDesign(RICH), 30), ['PALADIN', 'ONE-LINE']);

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
    expect((data.skills['holy-freeze'] as ControlDef).levels[0]!.slowPct).toBe(30);
    expect((data.skills['conviction'] as DebuffDef).levels[0]!.resistDown).toEqual({ fire: 30, cold: 30, ltng: 30 });
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
