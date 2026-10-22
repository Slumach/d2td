// The host's tunnel through a relay server (server/relay.mjs): a control connection out to
// the server holds a room there, and each player who joins through it gets a fresh
// connection out from here, piped to the host's own relay on loopback. The host's relay
// sees an ordinary player socket. No Electron import, so it runs and is tested in plain Node.

import { lookup } from 'node:dns/promises';
import { connect, isIPv4, type Socket } from 'node:net';

import { readLines, sendLine } from './framing.ts';

export const RELAY_SERVER_PORT = 47311;
const RELAY_VERSION = 1;

export interface Tunnel {
  /** The relay server's IPv4 address and port, and this host's room there: what a relay code carries. */
  ip: string;
  port: number;
  room: number;
  close(): void;
}

/** "host:port" or "host"; the host may be a name, which resolves to an IPv4 address. */
export async function resolveRelay(address: string): Promise<{ ip: string; port: number } | null> {
  const m = /^\s*([^\s:]+)(?::(\d+))?\s*$/.exec(address);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : RELAY_SERVER_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (isIPv4(m[1]!)) return { ip: m[1]!, port };
  try {
    return { ip: (await lookup(m[1]!, { family: 4 })).address, port };
  } catch {
    return null;
  }
}

/**
 * Opens a room on the relay server at `address` for the host's relay on `localPort`.
 * Resolves to the tunnel, or null if the server cannot be reached within `timeoutMs`.
 * `onLost` runs if the control connection drops after the room was opened.
 */
export async function openTunnel(address: string, localPort: number, log: (line: string) => void, onLost: () => void, timeoutMs = 6000): Promise<Tunnel | null> {
  const server = await resolveRelay(address);
  if (!server) {
    log(`tunnel: cannot resolve relay address "${address}"`);
    return null;
  }
  const pipes = new Set<Socket>();
  let closed = false;
  return new Promise((resolve) => {
    const control = connect({ host: server.ip, port: server.port });
    control.setNoDelay(true);
    control.setKeepAlive(true, 30_000);
    let room = 0;
    // The key proves our data connections belong to this room
    let key = '';
    const timer = setTimeout(() => {
      if (!room) {
        log(`tunnel: no answer from ${server.ip}:${server.port}`);
        control.destroy();
      }
    }, timeoutMs);
    const close = () => {
      closed = true;
      control.destroy();
      for (const s of pipes) s.destroy();
    };
    control.on('connect', () => sendLine(control, { r: 'host', v: RELAY_VERSION }));
    readLines(control, (m) => {
      const msg = m as { r?: string; room?: number; key?: string; id?: number };
      if (msg.r === 'room' && Number.isInteger(msg.room) && typeof msg.key === 'string' && !room) {
        room = msg.room!;
        key = msg.key!;
        clearTimeout(timer);
        log(`tunnel: room ${room} on ${server.ip}:${server.port}`);
        resolve({ ...server, room, close });
      } else if (msg.r === 'incoming' && Number.isInteger(msg.id) && room) {
        // A player is waiting: a data connection to the server for them, piped to our relay
        const data = connect({ host: server.ip, port: server.port });
        const local = connect({ host: '127.0.0.1', port: localPort });
        for (const s of [data, local]) {
          s.setNoDelay(true);
          pipes.add(s);
          s.on('error', () => undefined);
          s.on('close', () => {
            pipes.delete(s);
            data.destroy();
            local.destroy();
          });
        }
        data.on('connect', () => {
          sendLine(data, { r: 'accept', v: RELAY_VERSION, room, id: msg.id, key });
          data.pipe(local);
          local.pipe(data);
        });
      } else if (msg.r === 'full') {
        log('tunnel: the relay server is full');
      }
    });
    control.on('error', (e) => log(`tunnel: ${e.message}`));
    control.on('close', () => {
      clearTimeout(timer);
      if (!room) return resolve(null);
      if (!closed) {
        log(`tunnel: lost the relay server`);
        onLost();
      }
    });
  });
}
