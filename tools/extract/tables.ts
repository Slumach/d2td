// Converts D2 excel .txt tables to JSON arrays of row objects. Empty cells are dropped,
// integer cells become numbers, and the "Expansion" divider rows are skipped.

import type { SpriteJob } from './sprites.ts';
import { readTable } from './paths.ts';
import type { DataSource } from './source.ts';

/** The tables the sim reads (assets-extracted/data/*.json). */
export const TABLES = ['monstats', 'monlvl', 'monumod', 'monseq', 'skills', 'missiles', 'weapons', 'superuniques', 'levels'] as const;

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
  return TABLES.map((name) => ({
    label: `table ${name}`,
    inputs: [`global/excel/${name}.txt`],
    run: () => [{ path: `data/${name}.json`, bytes: new TextEncoder().encode(JSON.stringify(tableToJson(readTable(source, `${name}.txt`)))) }],
  }));
}
