import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CHECKSUM_FILE, extractGame, verifyGame } from './game.ts';
import type { DataSource } from './source.ts';
import { TABLES, tableJobs } from './tables.ts';

const INPUTS = TABLES.map((t) => `global/excel/${t}.txt`);

/** An in-memory source with an invented two-column table for every table input. */
function fakeSource(skip: string[] = []): DataSource {
  const files = new Map(INPUTS.filter((p) => !skip.includes(p)).map((p) => [p, 'Id\tLevel\nfoo\t3\n']));
  return {
    label: 'fake',
    exists: (p: string) => files.has(p),
    read: (p: string) => new TextEncoder().encode(files.get(p)!),
    close: () => undefined,
  };
}

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'd2td-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('game extraction', () => {
  it('writes every job output and a checksum list that verifies', async () => {
    const out = tempDir();
    const source = fakeSource();
    const progress: number[] = [];
    const list = await extractGame(source, out, (p) => progress.push(p.done), tableJobs(source));
    expect(Object.keys(list.files).sort()).toEqual(TABLES.map((t) => `data/${t}.json`).sort());
    expect(progress.at(-1)).toBe(TABLES.length);
    expect(verifyGame(out)).toEqual({ ok: true, bad: [] });
  });

  it('catches a changed or missing output', async () => {
    const out = tempDir();
    const source = fakeSource();
    await extractGame(source, out, undefined, tableJobs(source));
    const first = `data/${TABLES[0]}.json`;
    writeFileSync(join(out, first), '[]');
    expect(verifyGame(out)).toEqual({ ok: false, bad: [first] });
    rmSync(join(out, CHECKSUM_FILE));
    expect(verifyGame(out).ok).toBe(false);
  });

  it('refuses to run when the source lacks an input', async () => {
    const skip = INPUTS[1]!;
    const source = fakeSource([skip]);
    await expect(extractGame(source, tempDir(), undefined, tableJobs(source))).rejects.toThrow(skip);
  });
});
