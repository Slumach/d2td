// Converts D2 excel .txt tables to JSON arrays of row objects. Empty cells are dropped,
// integer cells become numbers, and the "Expansion" divider rows are skipped.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readTable } from './paths.ts';

export const TABLES = ['monstats', 'monlvl', 'monumod', 'monseq', 'skills', 'missiles', 'weapons'] as const;

export interface TableOptions {
  dataRoot: string;
  out: string;
}

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

export function extractTables(opts: TableOptions): void {
  const outDir = join(opts.out, 'data');
  mkdirSync(outDir, { recursive: true });
  for (const name of TABLES) {
    const rows = tableToJson(readTable(opts.dataRoot, `${name}.txt`));
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows));
    console.log(`${name}.txt: ${rows.length} rows`);
  }
  console.log(`Wrote ${outDir}`);
}
