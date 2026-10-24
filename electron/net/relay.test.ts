import { afterEach, describe, expect, it } from 'vitest';

import { createBot, type Strategy } from '../../tools/bots.ts';
import { Lockstep } from '../../src/net/lockstep.ts';
import { PROTOCOL, type ClientMessage, type HostMessage } from '../../src/net/protocol.ts';
import { fixtureGameData } from '../../src/sim/fixture.ts';
import { matchHash } from '../../src/sim/match.ts';
import { DESIGN } from '../../src/data/design.ts';
import { buildGameData } from '../../src/sim/data.ts';
import { hasTables, loadTables } from '../../tools/lib/load-tables.ts';
import { connectToRelay, type Connection } from './client.ts';
import { Relay } from './relay.ts';

const TOKEN = 'host-token';
const VERSION = '9.9.9';
const DATA = 'tables-a';
const data = fixtureGameData(3);

const relays: Relay[] = [];
const conns: Connection[] = [];
afterEach(() => {
  for (const c of conns.splice(0)) c.close();
  for (const r of relays.splice(0)) r.close();
});

async function relay(opts: Partial<ConstructorParameters<typeof Relay>[0]> = {}): Promise<number> {
  const r = new Relay({ port: 0, token: TOKEN, version: VERSION, tickMs: 0, seed: () => 1234, ...opts });
  relays.push(r);
  return r.listen();
}

interface TestPlayer {
  conn: Connection;
  messages: HostMessage[];
  closed: Promise<string>;
  next(t: HostMessage['t']): Promise<HostMessage>;
}

function player(port: number, name: string, extra: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}, onMessage?: (m: HostMessage) => void): TestPlayer {
  const messages: HostMessage[] = [];
  const taken = new Set<HostMessage>();
  const waiters: { t: string; resolve: (m: HostMessage) => void }[] = [];
  let closeWith: (reason: string) => void = () => undefined;
  const closed = new Promise<string>((r) => (closeWith = r));
  const conn = connectToRelay(
    '127.0.0.1',
    port,
    { t: 'hello', protocol: PROTOCOL, version: VERSION, data: DATA, name, ...extra },
    (m) => {
      messages.push(m);
      onMessage?.(m);
      const i = waiters.findIndex((w) => w.t === m.t);
      if (i >= 0) {
        taken.add(m);
        waiters.splice(i, 1)[0]!.resolve(m);
      }
    },
    closeWith,
  );
  conns.push(conn);
  return {
    conn,
    messages,
    closed,
    next: (t) => {
      const seen = messages.find((m) => m.t === t && !taken.has(m));
      if (seen) {
        taken.add(seen);
        return Promise.resolve(seen);
      }
      return new Promise((resolve) => waiters.push({ t, resolve }));
    },
  };
}

describe('relay lobby', () => {
  it('lets the host in first, then players with the same version and game data', async () => {
    const port = await relay();
    const host = player(port, 'Host', { token: TOKEN });
    expect(await host.next('welcome')).toEqual({ t: 'welcome', you: 0, host: true });
    const ann = player(port, 'Ann');
    expect(await ann.next('welcome')).toEqual({ t: 'welcome', you: 1, host: false });
    const lobby = (await ann.next('lobby')) as Extract<HostMessage, { t: 'lobby' }>;
    expect(lobby.players.map((p) => p.name)).toEqual(['Host', 'Ann']);
  });

  it('turns away another version, other game data, and anyone before the host', async () => {
    const port = await relay();
    const early = player(port, 'Early');
    expect(((await early.next('reject')) as { reason: string }).reason).toMatch(/not ready/);
    const host = player(port, 'Host', { token: TOKEN });
    await host.next('welcome');
    const old = player(port, 'Old', { version: '0.0.1' });
    expect(((await old.next('reject')) as { reason: string }).reason).toMatch(/version 9\.9\.9/);
    const other = player(port, 'Other', { data: 'tables-b' });
    expect(((await other.next('reject')) as { reason: string }).reason).toMatch(/game files are different/);
  });

  it('closes the gap when a player leaves the lobby', async () => {
    const port = await relay();
    const host = player(port, 'Host', { token: TOKEN });
    await host.next('welcome');
    const ann = player(port, 'Ann');
    await ann.next('welcome');
    const bob = player(port, 'Bob');
    await bob.next('welcome');
    ann.conn.close();
    expect(await bob.next('welcome')).toEqual({ t: 'welcome', you: 1, host: false });
  });
});

describe('relay battle lobby', () => {
  it('seats the players by the team they asked for and sends the setup with the start', async () => {
    const port = await relay();
    const host = player(port, 'Host', { token: TOKEN });
    await host.next('welcome');
    const ann = player(port, 'Ann');
    await ann.next('welcome');
    host.conn.send({ t: 'mode', mode: 'battle' });
    host.conn.send({ t: 'battle', teamSize: 2, race: 'paladin' });
    ann.conn.send({ t: 'battle', race: 'sorceress', team: 1 });
    // Only the host sizes the teams
    ann.conn.send({ t: 'battle', teamSize: 4 });
    await new Promise((r) => setTimeout(r, 50));
    const lobby = host.messages.filter((m) => m.t === 'lobby').at(-1) as Extract<HostMessage, { t: 'lobby' }>;
    expect(lobby.teamSize).toBe(2);
    expect(lobby.players.map((p) => [p.race, p.team])).toEqual([['paladin', 0], ['sorceress', 1]]);
    host.conn.send({ t: 'start' });
    const start = (await ann.next('start')) as Extract<HostMessage, { t: 'start' }>;
    expect(start.mode).toBe('battle');
    expect(start.battle).toEqual({ teamSize: 2, races: ['paladin', 'random', 'sorceress', 'random'], bots: [1, 3], seats: [0, 2], options: { pick: 'all', sends: 1, mirror: false, easy: false, long: false, champions: true } });
  });

  it.skipIf(!hasTables())('a 2v2 battle, two players and two bots, plays over TCP in lockstep', async () => {
    const LIMIT = 4000;
    const real = buildGameData(loadTables(), DESIGN, 30);
    const port = await relay();
    const finals: Promise<number>[] = [];
    let desync = false;
    const players = ['Host', 'Ann'].map((name, i) => {
      let step: Lockstep | undefined;
      let done: (hash: number) => void = () => undefined;
      finals.push(new Promise((r) => (done = r)));
      const p: TestPlayer = player(port, name, i === 0 ? { token: TOKEN } : {}, (m) => {
        if (m.t === 'desync') desync = true;
        if (m.t === 'start') {
          step = new Lockstep({ data: real, seed: m.seed, mode: m.mode, players: 4, me: m.you, send: (msg) => p.conn.send(msg), ...(m.battle ? { battle: m.battle } : {}) });
        }
        if (m.t === 'tick' && step && step.match.state.tick < LIMIT) {
          step.receive(m.tick, m.cmds);
          step.advance(LIMIT - step.match.state.tick, () => {
            // Each human hires a worker now and then; the bots build
            if (step!.match.state.tick % 400 === 0) step!.issue({ type: 'hire' });
          });
          if (step.match.state.tick >= LIMIT) done(matchHash(step.match));
        }
      });
      return p;
    });
    await players[0]!.next('welcome');
    await players[1]!.next('welcome');
    players[0]!.conn.send({ t: 'mode', mode: 'battle' });
    players[0]!.conn.send({ t: 'battle', teamSize: 2 });
    players[1]!.conn.send({ t: 'battle', team: 1 });
    await new Promise((r) => setTimeout(r, 50));
    players[0]!.conn.send({ t: 'start' });
    const hashes = await Promise.all(finals);
    expect(desync).toBe(false);
    expect(new Set(hashes).size).toBe(1);
  }, 60_000);

  it('will not start a battle its players do not fit', async () => {
    const port = await relay();
    const host = player(port, 'Host', { token: TOKEN });
    await host.next('welcome');
    const others = ['Ann', 'Bob'].map((n) => player(port, n));
    for (const o of others) await o.next('welcome');
    host.conn.send({ t: 'mode', mode: 'coop' });
    host.conn.send({ t: 'battle', teamSize: 2 });
    host.conn.send({ t: 'start' });
    await new Promise((r) => setTimeout(r, 80));
    expect(host.messages.some((m) => m.t === 'start')).toBe(false);
  });
});

describe('relay game', () => {
  it('stamps commands into bundles and drops malformed ones', async () => {
    const port = await relay();
    const host = player(port, 'Host', { token: TOKEN });
    await host.next('welcome');
    host.conn.send({ t: 'start' });
    await host.next('start');
    host.conn.send({ t: 'cmd', command: { type: 'build', x: 3, y: 4, cls: 'paladin', skill: 'holy-bolt' } });
    host.conn.send({ t: 'cmd', command: { type: 'build', x: -1, y: 'no' } as never });
    host.conn.send({ t: 'cmd', command: { type: 'explode' } as never });
    await new Promise((r) => setTimeout(r, 100));
    const cmds = host.messages.flatMap((m) => (m.t === 'tick' ? m.cmds : []));
    expect(cmds).toEqual([{ player: 0, command: { type: 'build', x: 3, y: 4, cls: 'paladin', skill: 'holy-bolt' } }]);
  });

  it('tells everyone when hashes disagree', async () => {
    const port = await relay();
    const host = player(port, 'Host', { token: TOKEN });
    await host.next('welcome');
    const ann = player(port, 'Ann');
    await ann.next('welcome');
    host.conn.send({ t: 'start' });
    await ann.next('start');
    host.conn.send({ t: 'hash', tick: 100, hash: 1 });
    ann.conn.send({ t: 'hash', tick: 100, hash: 2 });
    expect(await ann.next('desync')).toEqual({ t: 'desync', tick: 100 });
  });

  it('four bots play an FFA match over TCP and stay in lockstep', async () => {
    const LIMIT = 3000;
    const port = await relay();
    const strategies: Strategy[] = ['PALADIN', 'HOLY', 'TWOLINE', 'BOLT'];
    const finals: Promise<number>[] = [];
    let desync = false;
    const players = strategies.map((strategy, i) => {
      let step: Lockstep | undefined;
      let bot: ReturnType<typeof createBot> | undefined;
      let done: (hash: number) => void = () => undefined;
      finals.push(new Promise((r) => (done = r)));
      const p: TestPlayer = player(port, strategy, i === 0 ? { token: TOKEN } : {}, (m) => {
        if (m.t === 'desync') desync = true;
        if (m.t === 'start') {
          step = new Lockstep({ data, seed: m.seed, mode: m.mode, players: m.players.length, me: m.you, send: (msg) => p.conn.send(msg) });
          bot = createBot(strategy, step.match.zones[m.you]!);
        }
        if (m.t === 'tick' && step && step.match.state.tick < LIMIT) {
          step.receive(m.tick, m.cmds);
          step.advance(LIMIT - step.match.state.tick, () => {
            for (const command of bot!.decide(step!.match.zones[step!.me]!)) step!.issue(command);
          });
          if (step.match.state.tick >= LIMIT) done(matchHash(step.match));
        }
      });
      return p;
    });
    await players[0]!.next('welcome');
    for (const p of players.slice(1)) await p.next('welcome');
    // The bots play a ring of their own; a team shares one ring
    players[0]!.conn.send({ t: 'mode', mode: 'ffa' });
    players[0]!.conn.send({ t: 'start' });
    const hashes = await Promise.all(finals);
    expect(desync).toBe(false);
    expect(new Set(hashes).size).toBe(1);
  }, 60_000);
});
