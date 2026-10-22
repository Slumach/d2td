// The pipeline's table JSON (assets-extracted/data/*.json) and row helpers.

export type TableRow = Record<string, string | number>;

export interface Tables {
  monstats: TableRow[];
  monlvl: TableRow[];
  monumod: TableRow[];
  monseq: TableRow[];
  skills: TableRow[];
  missiles: TableRow[];
  weapons: TableRow[];
  superuniques: TableRow[];
  levels: TableRow[];
  /** D2R's monster names (local/lng/strings/monsters.json): Key, the NameStr or superunique Name, and enUS. */
  monstrings: TableRow[];
}

export const TABLE_NAMES: readonly (keyof Tables)[] = ['monstats', 'monlvl', 'monumod', 'monseq', 'skills', 'missiles', 'weapons', 'superuniques', 'levels', 'monstrings'];

/** An integer column; empty cells are 0. Throws on text so a typo in a column name fails loudly. */
export function int(row: TableRow, key: string): number {
  const v = row[key];
  if (v === undefined) return 0;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`Column ${key} is not an integer: ${v}`);
  return v;
}

export function str(row: TableRow, key: string): string {
  const v = row[key];
  return v === undefined ? '' : String(v);
}

export function findRow(rows: TableRow[], key: string, value: string | number): TableRow {
  const row = rows.find((r) => r[key] === value);
  if (!row) throw new Error(`No row with ${key} = ${value}`);
  return row;
}

/** monumod.txt keeps game constants in its "constants" column, named by "*constant desc". */
export function monumodConstant(tables: Tables, description: string): number {
  return int(findRow(tables.monumod, '*constant desc', description), 'constants');
}
