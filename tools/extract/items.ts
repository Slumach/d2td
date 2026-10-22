// Item art: D2R's HD inventory sprites, the look D2R's own inventory shows. D2R maps each
// item code to an asset (hd/items/items.json), and each unique and set item to its own
// (hd/items/uniques.json and sets.json, by tier); an asset names a sprite under
// hd/global/ui/items/<weapon|armor|misc>/. Each sprite's first frame becomes a PNG, and
// items/items.json says which PNG each code, unique and set item draws with.
//
//   items/<asset>.png   e.g. items/sword/crystal_sword.png
//   items/items.json    { codes, uniques, sets }: code or name key to asset

import { decodeSprite, spriteFrame } from '../lib/sprite.ts';
import { encodePng } from '../lib/png.ts';
import { readTable } from './paths.ts';
import type { DataSource } from './source.ts';
import type { OutputFile, SpriteJob } from './sprites.ts';
import type { ItemArtManifest } from '../../src/render/itemart.ts';

const MAPS = { codes: 'hd/items/items.json', uniques: 'hd/items/uniques.json', sets: 'hd/items/sets.json' };
const CATEGORIES = ['weapon', 'armor', 'misc'];
/** Our consumables borrow D2 art: Smith's Hammer is drawn as the Hellforge Hammer. */
const BORROWED: Record<string, string> = { xsh: 'hfh' };

/** A D2R item map: a JSON array of one-key objects, with a byte-order mark. */
function readMap<T>(source: DataSource, path: string): Record<string, T> {
  const text = new TextDecoder().decode(source.read(path)).replace(/^﻿/, '');
  return Object.assign({}, ...(JSON.parse(text) as Record<string, T>[]));
}

export function itemArtJob(source: DataSource): SpriteJob {
  const codes = readMap<{ asset: string }>(source, MAPS.codes);
  const uniques = readMap<{ normal: string; uber: string; ultra: string }>(source, MAPS.uniques);
  const sets = readMap<{ normal: string; uber: string; ultra: string }>(source, MAPS.sets);
  // Only items the tables hold: every base in weapons, armor and misc
  const used = new Set(['weapons.txt', 'armor.txt', 'misc.txt'].flatMap((t) => readTable(source, t).map((r) => String(r['code'] ?? ''))).filter((c) => c));
  const manifest: ItemArtManifest = { codes: {}, uniques: {}, sets: {}, images: {} };
  const files = new Map<string, string>();
  const fileOf = (asset: string): string | undefined => {
    if (files.has(asset)) return files.get(asset);
    const path = CATEGORIES.map((c) => `hd/global/ui/items/${c}/${asset}.sprite`).find((p) => source.exists(p));
    if (path) files.set(asset, path);
    return path;
  };
  for (const [code, { asset }] of Object.entries(codes)) if (used.has(code) && fileOf(asset)) manifest.codes[code] = asset;
  for (const [code, from] of Object.entries(BORROWED)) if (manifest.codes[from]) manifest.codes[code] = manifest.codes[from]!;
  const tiers = (m: Record<string, { normal: string; uber: string; ultra: string }>, into: Record<string, [string, string, string]>) => {
    for (const [key, t] of Object.entries(m)) {
      const list: [string, string, string] = [t.normal, t.uber, t.ultra];
      if (list.every((a) => fileOf(a))) into[key] = list;
    }
  };
  tiers(uniques, manifest.uniques);
  tiers(sets, manifest.sets);

  const tables = ['weapons.txt', 'armor.txt', 'misc.txt'].map((t) => `global/excel/${t}`);
  return {
    label: 'item art',
    inputs: [...Object.values(MAPS), ...tables, ...files.values()],
    run: () => {
      const out: OutputFile[] = [];
      for (const [asset, file] of files) {
        const sheet = decodeSprite(source.read(file));
        const image = `items/${asset}.png`;
        out.push({ path: image, bytes: encodePng(sheet.frameWidth, sheet.frameHeight, spriteFrame(sheet, 0)) });
        manifest.images[asset] = { image, w: sheet.frameWidth, h: sheet.frameHeight };
      }
      out.push({ path: 'items/items.json', bytes: new TextEncoder().encode(JSON.stringify(manifest)) });
      return out;
    },
  };
}
