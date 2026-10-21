import { describe, expect, it } from 'vitest';

import { createBot } from '../../tools/bots.ts';
import { fixtureGameData } from './fixture.ts';
import { arcAt } from './map.ts';
import { aliveOf, createMatch, matchHash, playersIn, stepMatch, type Match, type PlayerCommand } from './match.ts';
import { createSim, runLog } from './sim.ts';
import type { TimedCommand } from './state.ts';
import { stateHash } from './hash.ts';
import { addMonster, placeTower } from './testkit.ts';

const data = fixtureGameData(3);

function run(match: Match, n: number, commands: PlayerCommand[] = []): void {
  for (let i = 0; i < n; i++) stepMatch(match, i === 0 ? commands : []);
}

/** A free tile on `arc` of the ring: arc 0's tile (6, 5) turned onto it. */
function tileOn(match: Match, arc: number): { x: number; y: number } {
  const size = match.zones[0]!.map.width;
  let t = { x: 6, y: 5 };
  for (let i = 0; i < arc; i++) t = { x: size - 1 - t.y, y: t.x };
  return t;
}

describe('solo match', () => {
  it('is the single-player game: same commands, same state', () => {
    const log: TimedCommand[] = [
      { tick: 0, command: { type: 'build', x: 11, y: 6, cls: 'paladin', skill: 'holy-bolt' } },
      { tick: 5, command: { type: 'callWave' } },
    ];
    const sim = createSim(data, 7);
    runLog(sim, log, 400);
    const match = createMatch(data, 7, 'solo', 1);
    for (let t = 0; t < 400; t++) stepMatch(match, log.filter((c) => c.tick === t).map((c) => ({ player: 0, command: c.command })));
    expect(stateHash(match.zones[0]!.state)).toBe(stateHash(sim.state));
  });
});

describe('team match', () => {
  it('is one shared ring: each player builds on their own arc only, with their own gold', () => {
    const match = createMatch(data, 1, 'team', 2);
    expect(match.zones).toHaveLength(1);
    const ring = match.zones[0]!;
    // Two players own arcs 0 and 2, and 1 and 3
    expect(ring.arcOwners).toEqual([0, 1, 0, 1]);
    const mine = tileOn(match, 0);
    const theirs = tileOn(match, 1);
    expect(arcAt(ring.map, theirs.x, theirs.y)).toBe(1);
    run(match, 1, [
      { player: 0, command: { type: 'build', ...theirs, cls: 'paladin', skill: 'holy-bolt' } },
      { player: 1, command: { type: 'build', ...theirs, cls: 'paladin', skill: 'holy-bolt' } },
      { player: 0, command: { type: 'build', ...mine, cls: 'paladin', skill: 'holy-bolt' } },
    ]);
    expect(ring.state.towers.map((t) => [t.owner, t.tileX, t.tileY])).toEqual([
      [1, theirs.x, theirs.y],
      [0, mine.x, mine.y],
    ]);
    const cost = data.economy.buildCost;
    expect(ring.state.gold).toEqual([data.economy.startingGold - cost, data.economy.startingGold - cost]);
    // Nobody can change another player's tower
    const other = ring.state.towers.find((t) => t.owner === 1)!;
    run(match, 1, [{ player: 0, command: { type: 'sell', towerId: other.id } }]);
    expect(ring.state.towers).toHaveLength(2);
  });

  it("spawns each player's wave at their own arc, and pays a kill to the killer", () => {
    const match = createMatch(data, 1, 'team', 2);
    const ring = match.zones[0]!;
    run(match, data.economy.firstWaveTicks + 1);
    expect(match.state.wavesCalled).toBe(1);
    const spawnAt = new Set(ring.state.spawns.map((s) => s.dist));
    expect([...spawnAt].sort((a, b) => a - b)).toEqual([ring.map.arcs[0]!.spawn, ring.map.arcs[1]!.spawn]);

    // Player 1's tower kills a monster on player 0's arc: the gold is player 1's
    const quiet = createMatch(data, 1, 'team', 2);
    const r = quiet.zones[0]!;
    const tower = placeTower(r, 6, 5, 'holy-bolt');
    tower.owner = 1;
    const m = addMonster(r, 'zombie1', 3000, { hp: 300 });
    m.stunTicks = 1_000_000;
    const before = [...r.state.gold];
    run(quiet, 200);
    expect(r.state.monsters).toHaveLength(0);
    expect(r.state.gold[0]).toBe(before[0]);
    expect(r.state.gold[1]).toBeGreaterThan(before[1]!);
  });
});

describe('ffa match', () => {
  it('starts each wave on every ring on the clock, or as soon as everyone is ready', () => {
    const match = createMatch(data, 1, 'ffa', 3);
    run(match, data.economy.firstWaveTicks);
    expect(match.state.wavesCalled).toBe(0);
    run(match, 1);
    expect(match.state.wavesCalled).toBe(1);
    expect(match.zones.map((z) => z.state.wave)).toEqual([1, 1, 1]);

    // Two of three ready is not enough; the third makes it start now
    stepMatch(match, [{ player: 0, command: { type: 'callWave' } }, { player: 1, command: { type: 'callWave' } }]);
    expect(match.state.wavesCalled).toBe(1);
    stepMatch(match, [{ player: 2, command: { type: 'callWave' } }]);
    expect(match.state.wavesCalled).toBe(2);
    expect(match.state.ready).toEqual([false, false, false]);
  });

  it('drops a player whose ring fills up, and the last ring standing wins', () => {
    const match = createMatch(data, 1, 'ffa', 3);
    const fill = (ring: number) => {
      const z = match.zones[ring]!;
      for (let i = 0; i < data.rules.aliveLimit; i++) addMonster(z, 'zombie1', i * 100).stunTicks = 1_000_000;
    };
    fill(0);
    run(match, 1);
    expect(aliveOf(match, 0)).toBeGreaterThanOrEqual(data.rules.aliveLimit);
    expect(playersIn(match)).toEqual([1, 2]);
    expect(match.state.status).toBe('playing');
    fill(2);
    run(match, 1);
    expect(match.state.status).toBe('over');
    expect(match.state.winners).toEqual([1]);
  });
});

describe('lockstep', () => {
  it('two clients fed the same commands agree on the match hash every 100 ticks', () => {
    // Four bots play an FFA match; their commands are recorded per tick, then replayed
    const recorded: PlayerCommand[][] = [];
    const hashes: number[] = [];
    const a = createMatch(data, 42, 'ffa', 4);
    const bots = a.zones.map((z, i) => createBot((['BOLT', 'HOLY', 'TWOLINE', 'PALADIN'] as const)[i]!, z));
    while (a.state.status === 'playing' && a.state.tick < 6000) {
      const now = bots.flatMap((bot, player) => bot.decide(a.zones[player]!).map((command) => ({ player, command })));
      recorded.push(now);
      stepMatch(a, now);
      if (a.state.tick % 100 === 0) hashes.push(matchHash(a));
    }
    expect(a.state.wavesCalled).toBeGreaterThan(0);

    const b = createMatch(data, 42, 'ffa', 4);
    recorded.forEach((now) => {
      stepMatch(b, now);
      if (b.state.tick % 100 === 0) expect(matchHash(b), `tick ${b.state.tick}`).toBe(hashes[b.state.tick / 100 - 1]);
    });
    expect(matchHash(b)).toBe(matchHash(a));
  });
});
