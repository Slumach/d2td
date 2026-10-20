import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseTxt, type TxtRow } from '../lib/txt.ts';

/** The CascView export may nest the CASC "data" folder once or twice. */
export function findDataRoot(raw: string): string {
  for (const candidate of [join(raw, 'data', 'data'), join(raw, 'data'), raw]) {
    if (existsSync(join(candidate, 'global', 'monsters'))) return candidate;
  }
  throw new Error(`No global/monsters folder under ${resolve(raw)}`);
}

export function readBytes(path: string): Uint8Array {
  if (!existsSync(path)) throw new Error(`Missing file: ${path}`);
  return new Uint8Array(readFileSync(path));
}

export function readTable(dataRoot: string, name: string): TxtRow[] {
  return parseTxt(readFileSync(join(dataRoot, 'global', 'excel', name), 'latin1'));
}

/** Case-insensitive column lookup; monstats2 spells them HDv, TRv but Rav, Lav. */
export function column(row: TxtRow, name: string): string {
  const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? '' : (row[key] ?? '');
}
