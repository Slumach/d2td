#!/usr/bin/env node
// The D2 Tower Defense relay server: lets a host behind a router take players from the
// internet without port forwarding. One process, one TCP port, no dependencies, and no game
// logic: it never reads the game's messages. The lockstep relay still runs in the host's app.
//
// A host connects out to this server and gets a room number; its join code carries this
// server's address and the room. A player connects here and names the room; the server asks
// the host, over the host's control connection, for a fresh connection, and pipes the two
// sockets together byte for byte.
//
// Every connection opens with one JSON line saying what it is:
//   {"r":"host","v":1}                     host's control connection; answered {"r":"room","room":N,"key":K}
//   {"r":"join","v":1,"room":N}            a player; the host is sent {"r":"incoming","id":I}
//   {"r":"accept","v":1,"room":N,"id":I,"key":K}  the host's data connection for player I
// A player whose room is gone is answered with the game's own reject line, so the game shows it.
//
//   node relay.mjs [--port 47311]

import { randomBytes, randomInt } from 'node:crypto';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';

export const RELAY_VERSION = 1;
export const RELAY_PORT = 47311;
/** Room numbers fit the 20 bits a join code gives them. */
export const MAX_ROOM = 0xfffff;

/** The opening line is short; anything longer is not one of ours. */
const MAX_HEAD = 1024;
const HEAD_TIMEOUT_MS = 5000;
/** A player waits this long for the host's data connection. */
const PAIR_TIMEOUT_MS = 10_000;
/** Players waiting on one room at once, and hosts at once. */
const MAX_WAITING = 16;
const MAX_ROOMS = 500;

const line = (o) => `${JSON.stringify(o)}\n`;
const reject = (reason) => line({ t: 'reject', reason });

/**
 * Starts the relay server; resolves once it listens. `port` 0 picks a free one (tests).
 * @param {{ port?: number, host?: string, log?: (s: string) => void, pairTimeoutMs?: number }} [opts]
 * @returns {Promise<{ port: number, rooms: () => number, close: () => void }>}
 */
export function startRelayServer(opts = {}) {
  const log = opts.log ?? ((s) => console.log(`${new Date().toISOString()} ${s}`));
  const pairTimeoutMs = opts.pairTimeoutMs ?? PAIR_TIMEOUT_MS;
  /** @type {Map<number, { control: import('node:net').Socket, key: string, nextId: number, waiting: Map<number, { socket: import('node:net').Socket, rest: Buffer, timer: NodeJS.Timeout }> }>} */
  const rooms = new Map();
  const sockets = new Set();

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.setNoDelay(true);
    let head = Buffer.alloc(0);
    const timer = setTimeout(() => socket.destroy(), HEAD_TIMEOUT_MS);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const nl = head.indexOf(10);
      if (nl < 0) {
        if (head.length > MAX_HEAD) socket.destroy();
        return;
      }
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.pause();
      let msg;
      try {
        msg = JSON.parse(head.subarray(0, nl).toString('utf8'));
      } catch {
        socket.destroy();
        return;
      }
      opened(socket, msg, head.subarray(nl + 1));
    };
    socket.on('data', onData);
  });

  /** What a connection said it is, and the bytes it sent after saying so. */
  function opened(socket, msg, rest) {
    if (!msg || typeof msg !== 'object' || msg.v !== RELAY_VERSION) return void socket.end(reject('The relay server runs another version. Ask the host to update the game.'));
    if (msg.r === 'host') return host(socket);
    if (msg.r === 'join') return join(socket, msg.room, rest);
    if (msg.r === 'accept') return accept(socket, msg, rest);
    socket.destroy();
  }

  function host(socket) {
    if (rooms.size >= MAX_ROOMS) return void socket.end(line({ r: 'full' }));
    let room;
    do room = randomInt(1, MAX_ROOM + 1);
    while (rooms.has(room));
    const key = randomBytes(16).toString('hex');
    rooms.set(room, { control: socket, key, nextId: 1, waiting: new Map() });
    socket.setKeepAlive(true, 30_000);
    socket.write(line({ r: 'room', room, key }));
    log(`room ${room} opened by ${socket.remoteAddress}; ${rooms.size} open`);
    // The host says nothing more on its control connection; reading keeps the socket flowing
    socket.on('data', () => undefined);
    socket.resume();
    socket.on('close', () => {
      const r = rooms.get(room);
      if (r?.control !== socket) return;
      rooms.delete(room);
      for (const w of r.waiting.values()) {
        clearTimeout(w.timer);
        w.socket.end(reject('The host closed the game.'));
      }
      log(`room ${room} closed; ${rooms.size} open`);
    });
  }

  function join(socket, roomId, rest) {
    const r = Number.isInteger(roomId) ? rooms.get(roomId) : undefined;
    if (!r) return void socket.end(reject('Nobody is hosting at that code. Check the code, and that the host has the lobby open.'));
    if (r.waiting.size >= MAX_WAITING) return void socket.end(reject('Too many players are joining that game at once. Try again in a moment.'));
    const id = r.nextId++;
    const timer = setTimeout(() => {
      if (r.waiting.delete(id)) socket.end(reject('The host did not answer. Ask them to check the game is still open.'));
    }, pairTimeoutMs);
    r.waiting.set(id, { socket, rest, timer });
    socket.on('close', () => {
      const w = r.waiting.get(id);
      if (w?.socket === socket) {
        clearTimeout(w.timer);
        r.waiting.delete(id);
      }
    });
    r.control.write(line({ r: 'incoming', id }));
  }

  function accept(socket, msg, rest) {
    const r = rooms.get(msg.room);
    const w = r && msg.key === r.key ? r.waiting.get(msg.id) : undefined;
    if (!w) return void socket.destroy();
    clearTimeout(w.timer);
    r.waiting.delete(msg.id);
    const player = w.socket;
    if (w.rest.length) socket.write(w.rest);
    if (rest.length) player.write(rest);
    const end = () => {
      socket.destroy();
      player.destroy();
    };
    socket.on('close', end);
    player.on('close', end);
    player.pipe(socket);
    socket.pipe(player);
    log(`room ${msg.room}: player ${msg.id} from ${player.remoteAddress} connected`);
  }

  return new Promise((resolve, reject_) => {
    server.once('error', reject_);
    server.listen(opts.port ?? RELAY_PORT, opts.host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : (opts.port ?? RELAY_PORT);
      log(`relay listening on port ${port}`);
      resolve({
        port,
        rooms: () => rooms.size,
        close: () => {
          server.close();
          for (const s of sockets) s.destroy();
        },
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : RELAY_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Not a port: ${process.argv[i + 1]}`);
    process.exit(2);
  }
  startRelayServer({ port }).catch((e) => {
    console.error(`relay: ${e.message}`);
    process.exit(1);
  });
}
