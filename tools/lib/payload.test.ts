import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listAsar, readAsarEntry } from './asar.ts';
import { forbiddenReason } from './payload.ts';

describe('forbiddenReason', () => {
  it('passes the app itself', () => {
    for (const ok of ['package.json', 'dist/index.html', 'dist/assets/index-abc123.js', 'dist-electron/main.cjs', 'dist-electron/main.cjs.map']) {
      expect(forbiddenReason(ok), ok).toBeNull();
    }
  });

  it('lets dependencies carry their own json and licences, but never game formats', () => {
    expect(forbiddenReason('node_modules/@jamiephan/casclib/package.json')).toBeNull();
    expect(forbiddenReason('node_modules/@jamiephan/casclib/LICENSE.txt')).toBeNull();
    expect(forbiddenReason('node_modules/x/zm.dcc')).toMatch('.dcc');
  });

  it('catches extracted output and raw game files', () => {
    expect(forbiddenReason('dist/monsters/zombie1/normal.json')).toMatch('monsters/');
    expect(forbiddenReason('dist/data/monstats.json')).toMatch('.json');
    expect(forbiddenReason('dist/icons/paladin/holy-bolt.png')).toMatch('icons/');
    expect(forbiddenReason('dist/checksums.json')).toMatch('checksum');
    expect(forbiddenReason('dist/global/excel/monstats.txt')).toMatch('global/');
    expect(forbiddenReason('dist/zombie.png')).toMatch('.png');
    expect(forbiddenReason('Data/global/palette/act1/pal.dat')).toMatch('global/');
    expect(forbiddenReason('sound/x.WAV')).toMatch('.wav');
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A two-file archive in the real asar layout. */
function writeAsar(path: string): void {
  const a = Buffer.from('hello');
  const b = Buffer.from('native');
  const tree = { files: { 'package.json': { size: a.length, offset: '0' }, lib: { files: { 'x.node': { size: b.length, unpacked: true } } } } };
  const json = Buffer.from(JSON.stringify(tree));
  const padded = Math.ceil((json.length + 8) / 4) * 4;
  const header = Buffer.alloc(8 + padded);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(padded, 4);
  header.writeUInt32LE(padded - 4, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  writeFileSync(path, Buffer.concat([header, a]));
}

describe('listAsar', () => {
  it('lists packed and unpacked files and reads packed contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'asar-'));
    dirs.push(dir);
    const archive = join(dir, 'app.asar');
    writeAsar(archive);
    const entries = listAsar(archive);
    expect(entries.map((e) => [e.path, e.unpacked])).toEqual([
      ['package.json', false],
      ['lib/x.node', true],
    ]);
    expect(readAsarEntry(archive, entries[0]!).toString()).toBe('hello');
  });
});
