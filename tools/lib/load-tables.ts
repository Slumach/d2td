// Loads the pipeline's table JSON from disk for Node callers (tests, balance harness).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TABLE_NAMES, type Tables } from '../../src/sim/tables.ts';

export const DATA_DIR = join('assets-extracted', 'data');

export function hasTables(dir = DATA_DIR): boolean {
  return TABLE_NAMES.every((name) => existsSync(join(dir, `${name}.json`)));
}

export function loadTables(dir = DATA_DIR): Tables {
  const out = {} as Tables;
  for (const name of TABLE_NAMES) out[name] = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  return out;
}
