import { afterEach, describe, expect, it } from 'vitest';

import { startRelayServer } from '../../server/relay.mjs';
import { decodeRelayCode, encodeRelayCode } from '../../src/net/codes.ts';
import { PROTOCOL, type HostMessage } from '../../src/net/protocol.ts';
import { connectToRelay, type Connection } from './client.ts';
import { Relay } from './relay.ts';
import { openTunnel, resolveRelay, type Tunnel } from './tunnel.ts';

const TOKEN = 'host-token';
const VERSION = '9.9.9';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

function player(port: number, name: string, room?: number, token?: string): { conn: Connection; next(t: HostMessage['t']): Promise<HostMessage>; closed: Promise<string> } {
  const seen: HostMessage[] = [];
  const waiters: { t: string; resolve: (m: HostMessage) => void }[] = [];
  let closeWith: (r: string) => void = () => undefined;
  const closed = new Promise<string>((r) => (closeWith = r));
  const conn = connectToRelay(
    '127.0.0.1',
    port,
    { t: 'hello', protocol: PROTOCOL, version: VERSION, data: 'd', name, token },
    (m) => {
      const i = waiters.findIndex((w) => w.t === m.t);
      if (i >= 0) waiters.splice(i, 1)[0]!.resolve(m);
      else seen.push(m);
    },
    closeWith,
    room === undefined ? undefined : { r: 'join', v: 1, room },
  );
  cleanup.push(() => conn.close());
  return {
    conn,
    closed,
    next: (t) => {
      const i = seen.findIndex((m) => m.t === t);
      if (i >= 0) return Promise.resolve(seen.splice(i, 1)[0]!);
      return new Promise((resolve) => waiters.push({ t, resolve }));
    },
  };
}

async function setup(): Promise<{ server: { port: number; rooms: () => number }; tunnel: Tunnel; hostPort: number }> {
  const server = await startRelayServer({ port: 0, host: '127.0.0.1', log: () => undefined, pairTimeoutMs: 2000 });
  cleanup.push(() => server.close());
  const relay = new Relay({ port: 0, token: TOKEN, version: VERSION, tickMs: 0, seed: () => 7 });
  cleanup.push(() => relay.close());
  const hostPort = await relay.listen();
  const tunnel = await openTunnel(`127.0.0.1:${server.port}`, hostPort, () => undefined, () => undefined);
  expect(tunnel).not.toBeNull();
  cleanup.push(() => tunnel!.close());
  return { server, tunnel: tunnel!, hostPort };
}

describe('relay server and tunnel', () => {
  it('reads an address with or without a port', async () => {
    expect(await resolveRelay('10.1.2.3')).toEqual({ ip: '10.1.2.3', port: 47311 });
    expect(await resolveRelay(' 10.1.2.3:5000 ')).toEqual({ ip: '10.1.2.3', port: 5000 });
    expect(await resolveRelay('10.1.2.3:99999')).toBeNull();
  });

  it("pipes players through the server to the host's relay, which runs the game as ever", async () => {
    const { server, tunnel, hostPort } = await setup();
    expect(server.rooms()).toBe(1);
    const code = encodeRelayCode({ ip: tunnel.ip, port: tunnel.port, room: tunnel.room });
    const at = decodeRelayCode(code)!;
    const host = player(hostPort, 'Host', undefined, TOKEN);
    expect(await host.next('welcome')).toMatchObject({ host: true, you: 0 });
    const a = player(at.port, 'Ann', at.room);
    const b = player(at.port, 'Bo', at.room);
    expect(await a.next('welcome')).toMatchObject({ host: false });
    expect(await b.next('welcome')).toMatchObject({ host: false });
    // Everyone sees the full lobby
    const full = async (p: ReturnType<typeof player>) => {
      for (;;) {
        const m = (await p.next('lobby')) as Extract<HostMessage, { t: 'lobby' }>;
        if (m.players.length === 3) return m.players.map((x) => x.name).sort();
      }
    };
    expect(await full(a)).toEqual(['Ann', 'Bo', 'Host']);
    host.conn.send({ t: 'start' });
    expect(await b.next('start')).toMatchObject({ seed: 7 });
    a.conn.send({ t: 'cmd', command: { type: 'callWave' } });
    for (;;) {
      const m = (await b.next('tick')) as Extract<HostMessage, { t: 'tick' }>;
      if (m.cmds.length) {
        expect(m.cmds[0]).toMatchObject({ command: { type: 'callWave' } });
        break;
      }
    }
  });

  it('turns a player away from a room nobody holds, with a reason the game shows', async () => {
    const { tunnel } = await setup();
    const p = player(tunnel.port, 'Lost', tunnel.room + 1 > 0xfffff ? 1 : tunnel.room + 1);
    expect(((await p.next('reject')) as Extract<HostMessage, { t: 'reject' }>).reason).toMatch(/Nobody is hosting/);
  });

  it('closes the room when the host goes', async () => {
    const { server, tunnel } = await setup();
    tunnel.close();
    for (let i = 0; i < 50 && server.rooms() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(server.rooms()).toBe(0);
  });

  it('gives up quickly on a server that is not there', async () => {
    const t = await openTunnel('127.0.0.1:1', 47310, () => undefined, () => undefined, 1000);
    expect(t).toBeNull();
  });
});
