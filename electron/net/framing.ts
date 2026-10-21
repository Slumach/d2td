// One JSON object per line over a TCP socket, for the relay and the players' connections.

import type { Socket } from 'node:net';

/** A peer that sends a line longer than this is cut off; no real message comes close. */
const MAX_LINE = 64 * 1024;

export function sendLine(socket: Socket, message: unknown): void {
  if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
}

/** Calls `onMessage` with each parsed line; a line that is not JSON, or too long, ends the connection. */
export function readLines(socket: Socket, onMessage: (message: unknown) => void): void {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }
      onMessage(message);
    }
    if (buffer.length > MAX_LINE) socket.destroy();
  });
}
