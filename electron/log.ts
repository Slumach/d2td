// The launcher's log file, the one thing a friend can send when setup or the game fails.
// Plain lines with a timestamp, in <userData>/logs/main.log; the previous run's log is kept
// as main.old.log.

import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

let file: string | undefined;
let written = 0;
/** A runaway error loop must not fill the disk. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Starts a fresh log for this run, keeping the last one. */
export function openLog(userData: string): string {
  file = join(userData, 'logs', 'main.log');
  mkdirSync(dirname(file), { recursive: true });
  const old = join(dirname(file), 'main.old.log');
  if (existsSync(file)) {
    rmSync(old, { force: true });
    renameSync(file, old);
  }
  return file;
}

export function log(line: string): void {
  if (!file || written > MAX_BYTES) return;
  try {
    const text = `${new Date().toISOString()} ${line}\n`;
    written += text.length;
    appendFileSync(file, written > MAX_BYTES ? 'Log full; nothing more is written this run.\n' : text);
  } catch {
    // A log that cannot be written must never take the app down
  }
}

/** An error with its stack, for the log. */
export function describe(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}
