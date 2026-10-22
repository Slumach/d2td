// Converts D2 excel .txt tables to JSON arrays of row objects. Empty cells are dropped,
// integer cells become numbers, and the "Expansion" divider rows are skipped.

import type { SpriteJob } from './sprites.ts';
import { readTable } from './paths.ts';
import type { DataSource } from './source.ts';

/** The excel tables the sim reads (assets-extracted/data/*.json). */
export const TABLES = ['monstats', 'monlvl', 'monumod', 'monseq', 'skills', 'missiles', 'weapons', 'superuniques', 'levels'] as const;

/** D2R's monster name strings: monstats NameStr and superuniques Name are keys into it. */
const MONSTER_STRINGS = 'local/lng/strings/monsters.json';

const INTEGER = /^-?\d+$/;

export function tableToJson(rows: Record<string, string>[]): Record<string, string | number>[] {
  return rows
    .filter((row) => Object.values(row)[0] !== 'Expansion')
    .map((row) => {
      const out: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(row)) {
        if (value === '') continue;
        out[key] = INTEGER.test(value) ? Number(value) : value;
      }
      return out;
    });
}

export function tableJobs(source: DataSource): SpriteJob[] {
  return [
    ...TABLES.map((name) => ({
      label: `table ${name}`,
      inputs: [`global/excel/${name}.txt`],
      run: () => [{ path: `data/${name}.json`, bytes: new TextEncoder().encode(JSON.stringify(tableToJson(readTable(source, `${name}.txt`)))) }],
    })),
    {
      label: 'table monstrings',
      inputs: [MONSTER_STRINGS],
      run: () => {
        // A JSON array of { id, Key, enUS, deDE, ... } with a byte-order mark; English only
        const text = new TextDecoder().decode(source.read(MONSTER_STRINGS)).replace(/^\uFEFF/, '');
        const rows = (JSON.parse(text) as { Key: string; enUS?: string }[]).map((r) => ({ Key: r.Key, enUS: r.enUS ?? r.Key }));
        return [{ path: 'data/monstrings.json', bytes: new TextEncoder().encode(JSON.stringify(rows)) }];
      },
    },
  ];
}
