// Item art from the extraction (tools/extract/items.ts): D2R's HD inventory sprites, one
// PNG per asset, and the manifest saying which asset each item code, unique and set item
// draws with. Loaded with the game; an item with no art shows its name instead.

import type Phaser from 'phaser';

import type { ItemData } from '../sim/items/data.ts';
import type { Item } from '../sim/items/item.ts';

export const ITEM_ART_KEY = 'items:manifest';

export interface ItemArtManifest {
  /** Item code to asset. */
  codes: Record<string, string>;
  /** Unique or set item key (its index, lower case, words joined by _) to asset by tier: normal, uber, ultra. */
  uniques: Record<string, [string, string, string]>;
  sets: Record<string, [string, string, string]>;
  /** Asset to its PNG and size. */
  images: Record<string, { image: string; w: number; h: number }>;
}

/** D2R's key for a unique or set item: "Civerb's Ward" is civerbs_ward. */
export function itemArtKey(index: string): string {
  return index
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

const textureOf = (asset: string) => `item:${asset}`;

export function preloadItemArt(scene: Phaser.Scene): void {
  if (scene.cache.json.exists(ITEM_ART_KEY)) return;
  scene.load.json(ITEM_ART_KEY, 'items/items.json');
  scene.load.once(`filecomplete-json-${ITEM_ART_KEY}`, (_k: string, _t: string, m: ItemArtManifest) => {
    for (const [asset, img] of Object.entries(m.images)) if (!scene.textures.exists(textureOf(asset))) scene.load.image(textureOf(asset), img.image);
  });
}

/** The texture an item draws with: its unique's or set item's own art, else its base's. */
export function itemTexture(scene: Phaser.Scene, data: ItemData, item: Item): string | undefined {
  const m = scene.cache.json.get(ITEM_ART_KEY) as ItemArtManifest | undefined;
  if (!m) return undefined;
  const tier = data.bases[item.code]?.tier ?? 0;
  const own = item.unique ? m.uniques[itemArtKey(item.unique)] : item.setItem ? m.sets[itemArtKey(item.setItem)] : undefined;
  const asset = own?.[tier] ?? m.codes[item.code];
  const key = asset && textureOf(asset);
  return key && scene.textures.exists(key) ? key : undefined;
}
