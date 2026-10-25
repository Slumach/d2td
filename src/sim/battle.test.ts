import { describe, expect, it } from 'vitest';

import { DESIGN } from '../data/design.ts';
import { hasTables, loadTables } from '../../tools/lib/load-tables.ts';
import { battleData, fighterLife, kingUpgradeCost, leakDamage, sendCost, sendDef, sendGroups, sendHpPct, shardsPerTick, workerCost } from './battle.ts';
import { buildGameData, type GameData } from './data.ts';
import { UNITS_PER_TILE } from './fixed.ts';
import { createLaneMap, isBlocked, isPathTile, laneOf, LANE, positionAt, wrap } from './map.ts';
import { battleSetupFor, createMatch, matchHash, stepMatch, type Match, type PlayerCommand } from './match.ts';
import { createMonster } from './monsters.ts';
import { step } from './sim.ts';
import { towerAt } from './towers.ts';

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

describe('battle seats', () => {
  it('puts each player on the team they asked for while it has room, bots in the rest', () => {
    expect(battleSetupFor('battle', 2, [{ race: 'paladin', team: 1 }, { race: 'druid', team: 1 }, { race: 'random', team: 1 }])).toEqual({
      teamSize: 2,
      races: ['random', 'random', 'paladin', 'druid'],
      bots: [1],
      seats: [2, 3, 0],
    });
    expect(battleSetupFor('coop', 3, [{ race: 'amazon', team: 1 }])).toEqual({ teamSize: 3, races: ['amazon', 'random', 'random'], bots: [1, 2], seats: [0] });
    expect(battleSetupFor('battle', 1, [{ race: 'a', team: 0 }, { race: 'b', team: 0 }, { race: 'c', team: 0 }])).toBeUndefined();
  });
});

describe.skipIf(!hasTables())('Eternal Conflict (real tables)', () => {
  it('online, a lobby slot acts for the seat it was given', () => {
    const setup = battleSetupFor('battle', 2, [{ race: 'paladin', team: 0 }, { race: 'sorceress', team: 1 }])!;
    const m = createMatch(real(), 9, 'battle', 4, setup);
    // Lobby slot 1 sits at match slot 2: the second team's first lane
    expect(m.state.battle!.races[2]).toBe('sorceress');
    const lane = m.zones[1]!;
    const arc = lane.map.arcs[0]!;
    const p = positionAt(lane.map, arc.start + 10 * UNITS_PER_TILE);
    stepMatch(m, [{ player: 1, command: { type: 'build', x: Math.floor(p.x / UNITS_PER_TILE) + 1, y: 10, cls: 'sorceress', skill: 'fire-bolt' } }]);
    expect(lane.state.towers.filter((t) => t.owner === 0 && t.cls === 'sorceress')).toHaveLength(1);
  });

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

  it('a monster that reaches its lane end stands at the king and hits it until one of them dies', () => {
    const m = duel();
    const sim = m.zones[0]!;
    const arc = sim.map.arcs[0]!;
    sim.state.waves.push({ remaining: 1 });
    const k = real().battle!.rules.king;
    // A tough one, so the king's strikes do not kill it first
    const mo = createMonster(sim, real().battle!.waves[0]!.groups[0]!.monster, 0, 'champion', [], arc.end! - 50, 100_000_000);
    sim.state.monsters.push(mo);
    const before = sim.state.battle!.king.hp;
    step(sim, []);
    expect(mo.atKing).toBe(true);
    expect(sim.state.battle!.leaks[0]).toBe(1);
    expect(sim.state.monsters).toHaveLength(1);
    const dpw = real().battle!.rules.king.damagePerWeight;
    expect(sim.state.battle!.king.hp).toBe(before - real().rules.aliveWeight.champion * dpw);
    expect(sim.kingHits).toHaveLength(1);
    // It swings again when its attack comes round, and the king strikes it back
    const hp = mo.hp;
    for (let i = 0; i < real().rules.monsterAttackTicks; i++) step(sim, []);
    expect(sim.state.battle!.king.hp).toBe(before - 2 * real().rules.aliveWeight.champion * dpw);
    expect(mo.hp).toBeLessThan(hp);
    expect(sim.state.battle!.leaks[0]).toBe(1);
    expect(k.hp[0]).toBe(sim.state.battle!.king.maxHp);
  });

  it('a later wave leak hurts the king more, and the king has life for each team size', () => {
    const m = duel();
    const sim = m.zones[0]!;
    const k = real().battle!.rules.king;
    expect(sim.state.battle!.king.maxHp).toBe(k.hp[0]);
    expect(createMatch(real(), 1, 'battle', 4, { teamSize: 2, races: ['paladin', 'paladin', 'sorceress', 'sorceress'], bots: [] }).zones[0]!.state.battle!.king.maxHp).toBe(k.hp[1]);
    const arc = sim.map.arcs[0]!;
    for (let i = 0; i < 10; i++) sim.state.waves.push({ remaining: 1 });
    const mo = createMonster(sim, real().battle!.waves[0]!.groups[0]!.monster, 9, 'normal', [], arc.end! - 50, 100_000_000);
    sim.state.monsters.push(mo);
    expect(leakDamage(sim, mo)).toBe(Math.floor((real().rules.aliveWeight.normal * k.damagePerWeight * (100 + 9 * k.damagePctPerWave)) / 100));
  });

  it('a fighter has life from its class, blocks the creeps on its lane and is hit by them; down, it is passed', () => {
    const m = duel();
    const sim = m.zones[0]!;
    sim.state.gold[0] = 100_000;
    stepMatch(m, [{ player: 0, command: { type: 'build', x: 19, y: 10, cls: 'paladin', skill: 'holy-bolt' } }]);
    const t = towerAt(sim, 19, 10)!;
    const paladin = real().classes['paladin']!.life;
    const f = real().battle!.rules.fighter;
    expect(fighterLife(sim, t)).toBe(Math.floor((paladin.base * 256 * f.lifePct) / 100));
    expect(t.hp).toBe(t.maxHp);
    const arc = sim.map.arcs[0]!;
    sim.state.waves.push({ remaining: 1 });
    const mo = createMonster(sim, real().battle!.waves[0]!.groups[0]!.monster, 0, 'normal', [], arc.start + 8 * UNITS_PER_TILE, 100_000_000);
    sim.state.monsters.push(mo);
    for (let i = 0; i < 60; i++) step(sim, []);
    // Held at the fighter's row, off the path toward it, hitting it
    expect(mo.blockedBy).toBe(t.id);
    expect(mo.dist).toBeLessThan(arc.start + 10 * UNITS_PER_TILE);
    expect(mo.dist).toBeGreaterThan(arc.start + 8 * UNITS_PER_TILE);
    // The fighter stands left of the path (x 19 beside the path's 20): the creep steps that way
    expect(mo.x).toBeLessThan(positionAt(sim.map, mo.dist).x);
    expect(t.hp).toBeLessThan(t.maxHp!);
    // Down, it stops the creep no more
    t.hp = 0;
    for (let i = 0; i < 40; i++) step(sim, []);
    expect(mo.blockedBy).not.toBe(t.id);
    expect(mo.dist).toBeGreaterThan(arc.start + 11 * UNITS_PER_TILE);
    expect(t.hp).toBe(0);
  });

  it('a cleared lane sends its fighters to the king, and the countdown brings them home at full life', () => {
    const m = createMatch(real(), 4, 'battle', 4, { teamSize: 2, races: ['paladin', 'paladin', 'sorceress', 'sorceress'], bots: [] });
    const sim = m.zones[0]!;
    sim.state.gold[0] = 100_000;
    const lane0 = sim.map.arcs[0]!;
    const x0 = Math.floor(positionAt(sim.map, lane0.start).x / UNITS_PER_TILE) + 1;
    stepMatch(m, [{ player: 0, command: { type: 'build', x: x0, y: 10, cls: 'paladin', skill: 'holy-bolt' } }]);
    const t = towerAt(sim, x0, 10)!;
    toFight(m);
    // Lane 1 is still busy while lane 0 is clear: lane 0's fighter rallies
    sim.state.spawns = sim.state.spawns.filter((s) => laneOf(sim.map, s.dist) === 1);
    stepMatch(m, []);
    expect(t.atKing).toBe(true);
    const king = sim.map.king!;
    expect(Math.abs(t.x - (king.x + 0.5) * UNITS_PER_TILE)).toBeLessThan(3 * UNITS_PER_TILE);
    t.hp = 5;
    // The fight ends: home, standing, at full
    for (const z of m.zones) {
      z.state.spawns = [];
      z.state.monsters = [];
    }
    stepMatch(m, []);
    expect(m.state.battle!.phase).toBe('build');
    expect(t.atKing).toBeUndefined();
    expect(t.x).toBe((x0 + 0.5) * UNITS_PER_TILE);
    expect(t.hp).toBe(t.maxHp);
  });

  it('the countdown waits for every creep on both sides, the kings\' fights included', () => {
    const m = duel();
    toFight(m);
    for (const z of m.zones) z.state.spawns = [];
    m.zones[0]!.state.monsters = [];
    const z1 = m.zones[1]!;
    z1.state.waves.push({ remaining: 1 });
    const mo = createMonster(z1, real().battle!.waves[0]!.groups[0]!.monster, 0, 'normal', [], z1.map.arcs[0]!.end! - 50, 100_000_000);
    z1.state.monsters.push(mo);
    for (let i = 0; i < 50; i++) stepMatch(m, []);
    expect(mo.atKing).toBe(true);
    expect(m.state.battle!.phase).toBe('fight');
    z1.state.monsters = [];
    stepMatch(m, []);
    expect(m.state.battle!.phase).toBe('build');
    expect(m.state.battle!.phaseTick - m.state.tick).toBe(real().battle!.rules.buildTicks - 1);
  });

  it('sends grow stronger late in the match', () => {
    const data = real();
    const p = data.battle!.rules.sendPotency;
    const send = sendDef(data, 'pindleskin')!;
    const late = data.battle!.waves.length - 1;
    expect(sendHpPct(data, send, p.fromWave - 2)).toBe(send.hpPct);
    expect(sendHpPct(data, send, late)).toBe(Math.floor((send.hpPct * (100 + p.hpPctPerWave * (late + 1 - p.fromWave))) / 100));
    expect(sendGroups(data, send, data.battle!.waves[late]!, late).every((g) => g.hpPct === sendHpPct(data, send, late))).toBe(true);
  });

  it('the king strikes a monster in his reach for his percent of its life', () => {
    const m = duel();
    const sim = m.zones[0]!;
    const arc = sim.map.arcs[0]!;
    sim.state.waves.push({ remaining: 1 });
    // A tough one, three tiles short of the king, held still
    const mo = createMonster(sim, real().battle!.waves[0]!.groups[0]!.monster, 0, 'normal', [], arc.end! - 3 * UNITS_PER_TILE, 1_000_000);
    mo.stunTicks = 100;
    sim.state.monsters.push(mo);
    step(sim, []);
    expect(mo.hp).toBe(1_000_000 - Math.floor((1_000_000 * real().battle!.rules.king.attack.hitPct) / 100));
    expect(sim.kingStrikes).toHaveLength(1);
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

  it('battle towers cost the battle price, the same however many are owned', () => {
    const m = duel();
    const lane = m.zones[0]!;
    lane.state.gold[0] = 100_000;
    stepMatch(m, [{ player: 0, command: { type: 'build', x: 19, y: 10, cls: 'paladin', skill: 'holy-bolt' } }]);
    stepMatch(m, [{ player: 0, command: { type: 'build', x: 19, y: 11, cls: 'paladin', skill: 'holy-bolt' } }]);
    expect(100_000 - lane.state.gold[0]!).toBe(2 * real().battle!.rules.buildCost);
    expect(real().battle!.rules.buildCost).toBeLessThan(real().economy.buildCost);
  });

  it('workers cost gold and mine shards every tick', () => {
    const m = duel();
    const lane = m.zones[0]!;
    lane.state.gold[0] = 10_000;
    const cost = workerCost(lane, 0);
    stepMatch(m, [{ player: 0, command: { type: 'hire' } }]);
    expect(lane.state.gold[0]).toBe(10_000 - cost);
    expect(lane.state.battle!.workers[0]).toBe(1);
    const w = real().battle!.rules.worker;
    expect(shardsPerTick(lane, 0)).toBe(w.shardsPerSecond / 20);
    const before = lane.state.battle!.shards[0]!;
    for (let i = 0; i < 20; i++) stepMatch(m, []);
    expect(lane.state.battle!.shards[0]).toBe(before + w.shardsPerSecond);
  });

  it('a send costs shards, raises the sender\'s income and joins the enemy lane\'s next wave', () => {
    const m = duel();
    const own = m.zones[0]!.state.battle!;
    own.shards[0] = 100_000;
    const send = sendDef(real(), 'corpsefire')!;
    const cost = sendCost(send, 0);
    stepMatch(m, [{ player: 0, command: { type: 'send', send: 'corpsefire', lane: 0 } }]);
    expect(own.shards[0]).toBe(100_000 - cost * 1000);
    expect(own.income[0]).toBe(cost * real().battle!.rules.sendIncomePerShard);
    expect(m.zones[1]!.state.battle!.queued).toEqual([{ send: 'corpsefire', lane: 0, from: 0 }]);
    toFight(m);
    const enemy = m.zones[1]!.state.spawns.map((s) => s.def.split('@')[0]);
    expect(enemy).toContain('corpsefire');
    expect(m.zones[0]!.state.spawns.map((s) => s.def.split('@')[0])).not.toContain('corpsefire');
  });

  it('an act boss send goes once a match, and not before its wave', () => {
    const m = duel();
    const own = m.zones[0]!.state.battle!;
    own.shards[0] = 10_000_000;
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

  it('a bigger team faces tougher waves: teamWavePct by seats', () => {
    const one = createMatch(real(), 2, 'battle', 2, { teamSize: 1 }).zones[0]!.data.waves[3]!.hpPct!;
    const two = createMatch(real(), 2, 'battle', 4, { teamSize: 2 }).zones[0]!.data.waves[3]!.hpPct!;
    const pct = real().battle!.rules.teamWavePct;
    expect(one).toBe(Math.floor((real().battle!.waves[3]!.hpPct! * pct[0]!) / 100));
    expect(two).toBe(Math.floor((real().battle!.waves[3]!.hpPct! * pct[1]!) / 100));
  });

  it('random towers: a roll of lines from different classes each wave, and only the roll builds', () => {
    const opts = { pick: 'random' as const, sends: 1, mirror: false, easy: false, long: false, champions: true };
    const m = createMatch(real(), 6, 'battle', 2, { teamSize: 1, races: ['paladin', 'paladin'], bots: [], options: opts });
    const sim = m.zones[0]!;
    const n = real().battle!.rules.randomRoll.lines;
    const roll = sim.state.battle!.randomRolls![0]!;
    expect(roll).toHaveLength(n);
    expect(new Set(roll.map((k) => k.split('/')[0])).size).toBe(n);
    // A line off the roll will not build; one on it will, whatever its class
    const off = Object.entries(real().classes).flatMap(([cls, c]) => Object.keys(c.lines).map((l) => `${cls}/${l}`)).find((k) => !roll.includes(k))!;
    const skillOf = (k: string) => {
      const [cls, line] = k.split('/') as [string, string];
      return { cls, skill: real().classes[cls]!.lines[line]!.tiers[0]![0]! };
    };
    sim.state.gold[0] = 100_000;
    stepMatch(m, [{ player: 0, command: { type: 'build', x: 19, y: 10, ...skillOf(off) } }]);
    expect(sim.state.towers).toHaveLength(0);
    stepMatch(m, [{ player: 0, command: { type: 'build', x: 19, y: 10, ...skillOf(roll[0]!) } }]);
    expect(sim.state.towers).toHaveLength(1);
    // The next countdown brings a new roll, the same on both teams in mirror mode
    toFight(m);
    for (const z of m.zones) {
      z.state.spawns = [];
      z.state.monsters = [];
    }
    stepMatch(m, []);
    expect(m.state.battle!.phase).toBe('build');
    expect(sim.state.battle!.randomRolls![0]).not.toEqual(roll);
    const mirror = createMatch(real(), 6, 'battle', 2, { teamSize: 1, options: { ...opts, mirror: true } });
    expect(mirror.zones[1]!.state.battle!.randomRolls).toEqual(mirror.zones[0]!.state.battle!.randomRolls);
    expect(m.zones[1]!.state.battle!.randomRolls).not.toEqual(m.zones[0]!.state.battle!.randomRolls);
  });

  it('bots play the random builder to the end', () => {
    const m = createMatch(real(), 8, 'battle', 2, { teamSize: 1, bots: [0, 1], options: { pick: 'random', sends: 1, mirror: false, easy: false, long: false, champions: true } });
    while (m.state.status !== 'over' && m.state.tick < 60_000) stepMatch(m, []);
    expect(m.state.status).toBe('over');
    for (const z of m.zones) {
      expect(z.state.towers.length).toBeGreaterThan(2);
      expect(new Set(z.state.towers.map((t) => t.cls)).size).toBeGreaterThan(1);
    }
  });

  it('the long game plays waves 22 to 30 from Nightmare, Diablo on 26 and Baal on 30', () => {
    const m = createMatch(real(), 2, 'battle', 2, { teamSize: 1, races: ['paladin', 'paladin'], bots: [], options: { pick: 'all', sends: 1, mirror: false, easy: false, long: true, champions: true } });
    const waves = m.zones[0]!.data.waves;
    expect(waves).toHaveLength(30);
    expect(waves.slice(21).every((w) => w.difficulty === 1)).toBe(true);
    const bosses = waves.flatMap((w, i) => (w.kind === 'boss' ? [`${i + 1}:${w.groups.at(-1)!.monster.split('@')[0]}`] : []));
    expect(bosses.slice(-2)).toEqual(['26:diablo', '30:baal']);
    expect(createMatch(real(), 2, 'battle', 2, { teamSize: 1 }).zones[0]!.data.waves).toHaveLength(21);
  });

  it('the game setup: mirror and random picks, easy waves and king, multiplied sends, no champions', () => {
    const base = { teamSize: 2, races: ['paladin', 'druid', 'sorceress', 'amazon'], bots: [] };
    const mirror = createMatch(real(), 2, 'battle', 4, { ...base, options: { pick: 'all', sends: 1, mirror: true, easy: false, long: false, champions: true } });
    expect(mirror.state.battle!.races).toEqual(['paladin', 'druid', 'paladin', 'druid']);
    const random = createMatch(real(), 2, 'battle', 4, { ...base, options: { pick: 'random', sends: 1, mirror: false, easy: false, long: false, champions: true } });
    expect(random.state.battle!.races).toEqual(['random', 'random', 'random', 'random']);
    const easy = createMatch(real(), 2, 'battle', 2, { teamSize: 1, races: ['paladin', 'paladin'], bots: [], options: { pick: 'all', sends: 3, mirror: false, easy: true, long: false, champions: false } });
    const rules = real().battle!.rules;
    expect(easy.zones[0]!.state.battle!.king.maxHp).toBe(Math.floor((rules.king.hp[0]! * rules.easy.kingPct) / 100));
    expect(easy.zones[0]!.data.waves[0]!.hpPct).toBe(Math.floor((real().battle!.waves[0]!.hpPct! * rules.easy.wavePct) / 100));
    // No champion packs: the champion waves carry none
    expect(easy.zones[0]!.data.waves.every((w) => w.groups.every((g) => g.rank !== 'champion'))).toBe(true);
    expect(real().battle!.waves.some((w) => w.groups.some((g) => g.rank === 'champion'))).toBe(true);
    // X3 sends: the send walks three times over
    easy.zones[0]!.state.battle!.shards[0] = 1_000_000;
    stepMatch(easy, [{ player: 0, command: { type: 'send', send: 'corpsefire', lane: 0 } }]);
    toFight(easy);
    const corpsefires = easy.zones[1]!.state.spawns.filter((s) => s.def.startsWith('corpsefire')).length;
    expect(corpsefires).toBe(3);
  });
});
