import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { CHECKSUM_FILE, EXTRACT_VERSION, OUTDATED, extractGame, verifyGame } from './game.ts';
import type { DataSource } from './source.ts';
import { TABLES, tableJobs } from './tables.ts';

const INPUTS = TABLES.map((t) => `global/excel/${t}.txt`);

/** An in-memory source with an invented two-column table for every table input. */
function fakeSource(skip: string[] = []): DataSource {
  const files = new Map(INPUTS.filter((p) => !skip.includes(p)).map((p) => [p, 'Id\tLevel\nfoo\t3\n']));
  for (const n of ['monsters', 'item-names', 'item-runes', 'item-modifiers', 'item-nameaffixes']) files.set(`local/lng/strings/${n}.json`, '[{"id":1,"Key":"foo","enUS":"Foo"}]');
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
    expect(Object.keys(list.files).sort()).toEqual([...TABLES, 'monstrings', 'itemstrings'].map((t) => `data/${t}.json`).sort());
    expect(progress.at(-1)).toBe(TABLES.length + 2);
    expect(verifyGame(out)).toEqual({ ok: true, bad: [] });
  });

  it('re-extracts only the jobs that changed, reusing the rest and dropping stale files', async () => {
    const out = tempDir();
    const source = fakeSource();
    const runs: string[] = [];
    const job = (label: string, path: string, inputs: string[], rev?: number) => ({
      label,
      inputs,
      ...(rev !== undefined ? { rev } : {}),
      run: () => {
        runs.push(label);
        return [{ path, bytes: new TextEncoder().encode(`${label}${rev ?? 0}`) }];
      },
    });
    const a = INPUTS[0]!;
    const b = INPUTS[1]!;
    await extractGame(source, out, undefined, [job('a', 'a.txt', [a]), job('b', 'b.txt', [b]), job('old', 'old.txt', [a])]);
    expect(runs).toEqual(['a', 'b', 'old']);
    runs.length = 0;
    // Same a; b reads one more file; c is new; old is gone
    const second = await extractGame(source, out, undefined, [job('a', 'a.txt', [a]), job('b', 'b.txt', [b, a]), job('c', 'c.txt', [b])]);
    expect(runs).toEqual(['b', 'c']);
    expect(second.reused).toBe(1);
    expect(Object.keys(second.files).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(existsSync(join(out, 'old.txt'))).toBe(false);
    expect(verifyGame(out)).toEqual({ ok: true, bad: [] });
    // A damaged output re-runs its job; a bumped rev does too
    writeFileSync(join(out, 'a.txt'), 'broken');
    runs.length = 0;
    await extractGame(source, out, undefined, [job('a', 'a.txt', [a]), job('b', 'b.txt', [b, a], 1), job('c', 'c.txt', [b])]);
    expect(runs).toEqual(['a', 'b']);
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

  it('reports an extraction from an older version as outdated', async () => {
    const out = tempDir();
    const source = fakeSource();
    await extractGame(source, out, undefined, tableJobs(source));
    const list = JSON.parse(readFileSync(join(out, CHECKSUM_FILE), 'utf8'));
    writeFileSync(join(out, CHECKSUM_FILE), JSON.stringify({ ...list, version: EXTRACT_VERSION - 1 }));
    expect(verifyGame(out)).toEqual({ ok: false, bad: [OUTDATED] });
  });

  it('refuses to run when the source lacks an input', async () => {
    const skip = INPUTS[1]!;
    const source = fakeSource([skip]);
    await expect(extractGame(source, tempDir(), undefined, tableJobs(source))).rejects.toThrow(skip);
  });
});
