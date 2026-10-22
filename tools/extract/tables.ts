// Converts D2 excel .txt tables to JSON arrays of row objects. Empty cells are dropped,
// integer cells become numbers, and the "Expansion" divider rows are skipped.

import type { SpriteJob } from './sprites.ts';
import { readTable } from './paths.ts';
import type { DataSource } from './source.ts';

/** The excel tables the sim reads (assets-extracted/data/*.json). */
export const TABLES = [
  'monstats', 'monlvl', 'monumod', 'monseq', 'skills', 'missiles', 'weapons', 'superuniques', 'levels',
  // Which skill tree tab a skill sits on (SkillPage), for items' +skill tab stats
  'skilldesc',
  // Items: every equippable base, uniques, sets, affixes, gems and runes, and how they drop
  'armor', 'misc', 'uniqueitems', 'setitems', 'sets', 'magicprefix', 'magicsuffix', 'rareprefix', 'raresuffix', 'gems', 'runes', 'itemstatcost', 'itemtypes', 'properties', 'treasureclassex', 'itemratio', 'qualityitems',
] as const;

/** D2R's monster name strings: monstats NameStr and superuniques Name are keys into it. */
const MONSTER_STRINGS = 'local/lng/strings/monsters.json';
/** D2R's item strings: base, unique, set and runeword names, affix names and stat descriptions. */
const ITEM_STRINGS = ['item-names', 'item-runes', 'item-modifiers', 'item-nameaffixes'].map((n) => `local/lng/strings/${n}.json`);

/** A D2R string file: a JSON array of { id, Key, enUS, deDE, ... } with a byte-order mark. English only. */
function englishStrings(source: DataSource, path: string): { Key: string; enUS: string }[] {
  const text = new TextDecoder().decode(source.read(path)).replace(/^\uFEFF/, '');
  return (JSON.parse(text) as { Key: string; enUS?: string }[]).map((r) => ({ Key: r.Key, enUS: r.enUS ?? r.Key }));
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
      run: () => [{ path: 'data/monstrings.json', bytes: new TextEncoder().encode(JSON.stringify(englishStrings(source, MONSTER_STRINGS))) }],
    },
    {
      label: 'table itemstrings',
      inputs: ITEM_STRINGS,
      run: () => [{ path: 'data/itemstrings.json', bytes: new TextEncoder().encode(JSON.stringify(ITEM_STRINGS.flatMap((path) => englishStrings(source, path)))) }],
    },
  ];
}
