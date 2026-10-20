import { parseTxt, type TxtRow } from '../lib/txt.ts';
import type { DataSource } from './source.ts';

/** An excel table from the source, e.g. readTable(source, 'monstats.txt'). */
export function readTable(source: DataSource, name: string): TxtRow[] {
  return parseTxt(Buffer.from(source.read(`global/excel/${name}`)).toString('latin1'));
}

/** Case-insensitive column lookup; monstats2 spells them HDv, TRv but Rav, Lav. */
export function column(row: TxtRow, name: string): string {
  const key = Object.keys(row).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? '' : (row[key] ?? '');
}
