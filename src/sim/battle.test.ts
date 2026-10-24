import { describe, expect, it } from 'vitest';

import { DESIGN } from '../data/design.ts';
import { hasTables, loadTables } from '../../tools/lib/load-tables.ts';
import { battleData, kingUpgradeCost, sendCost, sendDef, workerCost } from './battle.ts';
import { buildGameData, type GameData } from './data.ts';
import { UNITS_PER_TILE } from './fixed.ts';
import { createLaneMap, isBlocked, isPathTile, laneOf, LANE, positionAt, wrap } from './map.ts';
import { createMatch, matchHash, stepMatch, type Match, type PlayerCommand } from './match.ts';
import { createMonster } from './monsters.ts';
import { step } from './sim.ts';

let cached: GameData | undefined;
const real = () => (cached ??= buildGameData(loadTables(), DESIGN, 30));

/** A 1v1 with no bots, races fixed. */
function duel(races = ['paladin', 'sorceress'], seed = 7): Match {
  return createMatch(real(), seed, 'battle', 2, { teamSize: 1, races });
}

/** Runs the match until its build phase ends and the first fight starts. */
function toFight(m: Match, commands: PlayerCommand[] = []): void {
  stepMatch(m, commands);
  while (m.state.battle!.phase === 'build') stepMatch(m, []);
}

describe('battle lanes', () => {
  it('lays a lane per player side by side, each from the top edge to the king', () => {
    for (const lanes of [1, 2, 3, 4]) {
      const map = createLaneMap(lanes);
      expect(map.open).toBe(true);
      expect(map.arcs).toHaveLength(lanes);
      map.arcs.forEach((arc, k) => {
        expect(laneOf(map, arc.start)).toBe(k);
        expect(laneOf(map, arc.end! - 1)).toBe(k);
        // Each lane ends beside the king
        const end = positionAt(map, arc.end! - 1);
        expect(Math.abs(end.x - (LANE.king.x * UNITS_PER_TILE + 500))).toBeLessThanOrEqual(UNITS_PER_TILE);
        expect(map.workerSlots![k]).toHaveLength(16);
      });
      // Nothing wraps: past the end is held at the end
      expect(wrap(map, map.length + 5000)).toBe(map.length - 1);
    }
  });

  it('has buildable ground on both sides of every lane and none in the keep', () => {
    const map = createLaneMap(2);
    for (const arc of map.arcs) {
      const p = positionAt(map, arc.start + 10 * UNITS_PER_TILE);
      const x = Math.floor(p.x / UNITS_PER_TILE);
      const y = Math.floor(p.y / UNITS_PER_TILE);
      expect(isPathTile(map, x, y)).toBe(true);
      for (const dx of [-4, -1, 1, 4]) expect(isBlocked(map, x + dx, y)).toBe(false);
    }
    for (let x = 0; x < map.width; x++) if (!isPathTile(map, x, 36)) expect(isBlocked(map, x, 36)).toBe(true);
  });
});

describe.skipIf(!hasTables())('Battle Mode (real tables)', () => {
  it('builds 21 waves from the tables, the act bosses on 6, 10, 14, 17 and 21', () => {
    const waves = real().battle!.waves;
    expect(waves).toHaveLength(21);
    expect(waves[0]!.groups[0]!.monster).toMatch(/^fallen1/);
    const bosses = waves.flatMap((w, i) => (w.kind === 'boss' ? [`${i + 1}:${w.groups.at(-1)!.monster.split('@')[0]}`] : []));
    expect(bosses).toEqual(['6:andariel', '10:duriel', '14:mephisto', '17:diablo', '21:baal']);
  });

  it('starts in a build phase, then both teams fight the same wave', () => {
    const m = duel();
    expect(m.state.battle!.phase).toBe('build');
    toFight(m);
    expect(m.state.battle!.wave).toBe(1);
    const [a, b] = m.zones.map((z) => z.state.spawns.map((s) => s.def));
    expect(a).toEqual(b);
    expect(a!.length).toBeGreaterThan(0);
  });

  it('a monster that reaches its lane end takes its alive weight off the king and is gone', () => {
    const m = duel();
    const sim = m.zones[0]!;
    const arc = sim.map.arcs[0]!;
    sim.state.waves.push({ remaining: 1 });
    const mo = createMonster(sim, real().battle!.waves[0]!.groups[0]!.monster, 0, 'champion', [], arc.end! - 50);
    sim.state.monsters.push(mo);
    const before = sim.state.battle!.king.hp;
    step(sim, []);
    const dpw = real().battle!.rules.king.damagePerWeight;
    expect(sim.state.battle!.king.hp).toBe(before - real().rules.aliveWeight.champion * dpw);
    expect(sim.state.monsters).toHaveLength(0);
    expect(sim.state.battle!.leaks[0]).toBe(1);
    expect(sim.kingHits).toHaveLength(1);
  });

  it('Tyrael strikes a monster in his reach for his percent of its life', () => {
    const m = duel();
    const sim = m.zones[0]!;
    const arc = sim.map.arcs[0]!;
    sim.state.waves.push({ remaining: 1 });
    // A tough one, three tiles short of the king, held still
    const mo = createMonster(sim, real().battle!.waves[0]!.groups[0]!.monster, 0, 'normal', [], arc.end! - 3 * UNITS_PER_TILE, 1_000_000);
    mo.stunTicks = 100;
    sim.state.monsters.push(mo);
    step(sim, []);
    expect(mo.hp).toBe(1_000_000 - Math.floor((1_000_000 * real().battle!.rules.tyrael.hitPct) / 100));
    expect(sim.tyraelHits).toHaveLength(1);
  });

  it('a player builds only their race', () => {
    const m = duel(['paladin', 'sorceress']);
    const lane = m.zones[0]!;
    const x = lane.map.arcs.length === 1 ? 19 : 0;
    stepMatch(m, [{ player: 0, command: { type: 'build', x, y: 10, cls: 'sorceress', skill: 'fire-bolt' } }]);
    expect(lane.state.towers).toHaveLength(0);
    stepMatch(m, [{ player: 0, command: { type: 'build', x, y: 10, cls: 'paladin', skill: 'holy-bolt' } }]);
    expect(lane.state.towers).toHaveLength(1);
    // A player builds on their own team's field: player 1 is the other team
    expect(m.zones[1]!.state.towers).toHaveLength(0);
  });

  it('battle towers cost more for each one owned', () => {
    const m = duel();
    const lane = m.zones[0]!;
    lane.state.gold[0] = 100_000;
    const pct = real().battle!.rules.buildCostPctPerTower;
    stepMatch(m, [{ player: 0, command: { type: 'build', x: 19, y: 10, cls: 'paladin', skill: 'holy-bolt' } }]);
    stepMatch(m, [{ player: 0, command: { type: 'build', x: 19, y: 11, cls: 'paladin', skill: 'holy-bolt' } }]);
    const base = real().economy.buildCost;
    expect(100_000 - lane.state.gold[0]!).toBe(base + Math.floor((base * (100 + pct)) / 100));
  });

  it('workers cost gold and bring Souls at the end of every wave', () => {
    const m = duel();
    const lane = m.zones[0]!;
    lane.state.gold[0] = 10_000;
    const cost = workerCost(lane, 0);
    stepMatch(m, [{ player: 0, command: { type: 'hire' } }]);
    expect(lane.state.gold[0]).toBe(10_000 - cost);
    expect(lane.state.battle!.workers[0]).toBe(1);
    toFight(m);
    while (m.state.battle!.phase === 'fight') stepMatch(m, []);
    expect(lane.state.battle!.souls[0]).toBe(real().battle!.rules.worker.soulsPerWave);
  });

  it('a send costs Souls, raises the sender\'s income and joins the enemy lane\'s next wave', () => {
    const m = duel();
    const own = m.zones[0]!.state.battle!;
    own.souls[0] = 100;
    const send = sendDef(real(), 'corpsefire')!;
    const cost = sendCost(send, 0);
    stepMatch(m, [{ player: 0, command: { type: 'send', send: 'corpsefire', lane: 0 } }]);
    expect(own.souls[0]).toBe(100 - cost);
    expect(own.income[0]).toBe(cost * real().battle!.rules.sendIncomePerSoul);
    expect(m.zones[1]!.state.battle!.queued).toEqual([{ send: 'corpsefire', lane: 0, from: 0 }]);
    toFight(m);
    const enemy = m.zones[1]!.state.spawns.map((s) => s.def.split('@')[0]);
    expect(enemy).toContain('corpsefire');
    expect(m.zones[0]!.state.spawns.map((s) => s.def.split('@')[0])).not.toContain('corpsefire');
  });

  it('an act boss send goes once a match, and not before its wave', () => {
    const m = duel();
    const own = m.zones[0]!.state.battle!;
    own.souls[0] = 10_000;
    stepMatch(m, [{ player: 0, command: { type: 'send', send: 'andariel', lane: 0 } }]);
    expect(own.sendsMade[0]).toBe(0);
    m.state.battle!.wave = 9;
    stepMatch(m, [{ player: 0, command: { type: 'send', send: 'andariel', lane: 0 } }]);
    stepMatch(m, [{ player: 0, command: { type: 'send', send: 'andariel', lane: 0 } }]);
    expect(own.sendsMade[0]).toBe(1);
  });

  it('gold buys the team king life', () => {
    const m = duel();
    const lane = m.zones[0]!;
    lane.state.gold[0] = 10_000;
    const cost = kingUpgradeCost(lane, 'hp')!;
    const max = lane.state.battle!.king.maxHp;
    stepMatch(m, [{ player: 0, command: { type: 'king', upgrade: 'hp' } }]);
    expect(lane.state.gold[0]).toBe(10_000 - cost);
    expect(lane.state.battle!.king.maxHp).toBe(max + real().battle!.rules.king.upgrades.hp.add);
  });

  it('the first king to fall loses', () => {
    const m = duel();
    toFight(m);
    m.zones[1]!.state.battle!.king.hp = 0;
    stepMatch(m, []);
    expect(m.state.status).toBe('over');
    expect(m.state.winners).toEqual([0]);
  });

  it('kills drop nothing on a battlefield', () => {
    expect(battleData(real()).noLoot).toBe(true);
  });

  it('a bot match plays all the way and replays to the same state', () => {
    const play = () => {
      const m = createMatch(real(), 3, 'battle', 2, { teamSize: 1, races: ['necromancer', 'amazon'], bots: [0, 1] });
      while (m.state.status !== 'over' && m.state.tick < 40_000) stepMatch(m, []);
      return m;
    };
    const a = play();
    expect(a.state.status).toBe('over');
    expect(a.zones.every((z) => z.state.towers.length > 0)).toBe(true);
    expect(matchHash(play())).toBe(matchHash(a));
  });

  it('co-op: one team, and the schedule\'s sends arrive with their wave', () => {
    const m = createMatch(real(), 5, 'coop', 2, { teamSize: 2 });
    expect(m.zones).toHaveLength(1);
    const coop = real().battle!.rules.coop.sends;
    const first = coop.findIndex((w) => w.length > 0);
    m.state.battle!.wave = first;
    toFight(m);
    const named = coop[first]!.map((id) => sendDef(real(), id)!.monster).flat();
    const spawned = m.zones[0]!.state.spawns.map((s) => s.def.split('@')[0]);
    for (const id of named) expect(spawned).toContain(id);
  });

  it('random races are rolled from the seed, the same on every client', () => {
    const races = (seed: number) => createMatch(real(), seed, 'battle', 4, { teamSize: 2 }).state.battle!.races;
    expect(races(11)).toEqual(races(11));
    for (const r of races(11)) expect(Object.keys(real().classes)).toContain(r);
  });
});
