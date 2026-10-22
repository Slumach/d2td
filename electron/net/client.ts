// A player's connection to a relay, from the Electron main process. The renderer runs the
// game; this only moves lines between the socket and the renderer.

import { connect } from 'node:net';

import type { ClientMessage, HostMessage } from '../../src/net/protocol.ts';
import { readLines, sendLine } from './framing.ts';

export interface Connection {
  send(message: ClientMessage): void;
  close(): void;
}

const CONNECT_TIMEOUT_MS = 8000;

/**
 * Connects and says hello. `onClose` gets a reason the player can read. `preamble` is a line
 * sent before the hello: through a relay server, the room to join (server/relay.mjs).
 */
export function connectToRelay(
  ip: string,
  port: number,
  hello: Extract<ClientMessage, { t: 'hello' }>,
  onMessage: (message: HostMessage) => void,
  onClose: (reason: string) => void,
  preamble?: object,
): Connection {
  const socket = connect({ host: ip, port });
  socket.setNoDelay(true);
  let open = false;
  let closing = false;
  const timer = setTimeout(() => {
    if (!open) socket.destroy(new Error('timeout'));
  }, CONNECT_TIMEOUT_MS);
  socket.on('connect', () => {
    open = true;
    clearTimeout(timer);
    if (preamble) sendLine(socket, preamble);
    sendLine(socket, hello);
  });
  readLines(socket, (m) => onMessage(m as HostMessage));
  let error: Error | undefined;
  socket.on('error', (e) => (error = e));
  socket.on('close', () => {
    clearTimeout(timer);
    if (closing) return;
    if (!open) {
      const refused = (error as NodeJS.ErrnoException | undefined)?.code === 'ECONNREFUSED';
      onClose(refused ? 'Nobody is hosting at that code. Check the code, and that the host has the lobby open.' : 'Could not reach the host. Check the code, and ask the host to check their port forwarding.');
    } else {
      onClose('The connection to the host was lost.');
    }
  });
  return {
    send: (message) => sendLine(socket, message),
    close: () => {
      closing = true;
      socket.destroy();
    },
  };
}
