import { describe, expect, it } from 'vitest';

import { createBot } from '../../tools/bots.ts';
import { fixtureGameData } from './fixture.ts';
import { createMatch, livesOf, matchHash, playersIn, stepMatch, type Match, type PlayerCommand } from './match.ts';
import { createSim, runLog } from './sim.ts';
import type { TimedCommand } from './state.ts';
import { stateHash } from './hash.ts';
import { addMonster } from './testkit.ts';

const data = fixtureGameData(3);

function run(match: Match, n: number, commands: PlayerCommand[] = []): void {
  for (let i = 0; i < n; i++) stepMatch(match, i === 0 ? commands : []);
}

describe('solo match', () => {
  it('is the single-player game: same commands, same state', () => {
    const log: TimedCommand[] = [
      { tick: 0, command: { type: 'build', x: 3, y: 4, cls: 'paladin', skill: 'holy-bolt' } },
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
  it('hands a leak to the next zone with its damage, and only the last zone loses lives', () => {
    const match = createMatch(data, 1, 'team', 3);
    const [z0, z1, z2] = match.zones;
    const m = addMonster(z0!, 'zombie1', z0!.map.length - 1);
    m.hp = 777;
    run(match, 2);
    expect(z0!.state.monsters).toHaveLength(0);
    expect(z0!.state.lives).toBe(data.economy.lives);
    expect(z1!.state.monsters).toHaveLength(1);
    expect(z1!.state.monsters[0]!.hp).toBe(777);
    expect(z1!.state.monsters[0]!.dist).toBeLessThan(z1!.map.length / 10);

    // Walk it through zone 2 and out of zone 3
    z1!.state.monsters[0]!.dist = z1!.map.length - 1;
    run(match, 2);
    z2!.state.monsters[0]!.dist = z2!.map.length - 1;
    run(match, 2);
    expect(livesOf(match, 0)).toBe(data.economy.lives - data.economy.leakCost);
    expect(livesOf(match, 2)).toBe(livesOf(match, 0));
  });

  it('spawns waves in the first zone only', () => {
    const match = createMatch(data, 1, 'team', 2);
    run(match, data.economy.firstWaveTicks + 30);
    expect(match.state.wavesCalled).toBe(1);
    expect(match.zones[0]!.state.wave).toBe(1);
    expect(match.zones[1]!.state.wave).toBe(0);
  });
});

describe('ffa match', () => {
  it('starts each wave in every lane on the clock, or as soon as everyone is ready', () => {
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

  it('drops a player who runs out of lives, and the last one standing wins', () => {
    const match = createMatch(data, 1, 'ffa', 3);
    match.zones[0]!.state.lives = 0;
    run(match, 1);
    expect(playersIn(match)).toEqual([1, 2]);
    expect(match.state.status).toBe('playing');
    match.zones[2]!.state.lives = 0;
    run(match, 1);
    expect(match.state.status).toBe('over');
    expect(match.state.winners).toEqual([1]);
  });
});

describe('lockstep', () => {
  it('two clients fed the same commands agree on the match hash every 100 ticks', () => {
    // Four bots play a team match; their commands are recorded per tick, then replayed
    const recorded: PlayerCommand[][] = [];
    const hashes: number[] = [];
    const a = createMatch(data, 42, 'team', 4);
    const bots = a.zones.map((z, i) => createBot((['BOLT', 'HOLY', 'TWOLINE', 'PALADIN'] as const)[i]!, z));
    while (a.state.status === 'playing' && a.state.tick < 6000) {
      const now = bots.flatMap((bot, player) => bot.decide(a.zones[player]!).map((command) => ({ player, command })));
      recorded.push(now);
      stepMatch(a, now);
      if (a.state.tick % 100 === 0) hashes.push(matchHash(a));
    }
    expect(a.state.wavesCalled).toBeGreaterThan(0);

    const b = createMatch(data, 42, 'team', 4);
    recorded.forEach((now) => {
      stepMatch(b, now);
      if (b.state.tick % 100 === 0) expect(matchHash(b), `tick ${b.state.tick}`).toBe(hashes[b.state.tick / 100 - 1]);
    });
    expect(matchHash(b)).toBe(matchHash(a));
  });
});
