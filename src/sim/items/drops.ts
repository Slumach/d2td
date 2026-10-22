// Drops, as D2 rolls them: a monster's treasure class (upgraded within its group to the
// monster's level), its picks against NoDrop, nested classes down to an item code or an
// automatic class (weap33), then the item's quality by itemratio.txt with magic find and
// the class's quality bonuses. Gold, potions, charms, scrolls, keys and quest items are
// left out: they come up as nothing. At most six items a kill, as in D2. All rolls are on
// the rng the caller passes (the sim's drop stream), so lockstep stays deterministic.

import { rollInt, type Rng } from '../rng.ts';
import { autoTreasure, SMITHS_HAMMER, type ItemBase, type ItemData, type ItemRatio, type TreasureClass } from './data.ts';
import { rollItem, type Item, type Quality } from './item.ts';

export const MAX_DROPS = 6;

export interface DropContext {
  /** Monster level: the item level of what it drops. */
  mlvl: number;
  /** The killing tower's magic find. */
  magicFind: number;
  /** Rune entries' weight, percent (balance.json drops.runeMultiplierPct; times five in the cow level). */
  runePct: number;
  /** NoDrop's weight, percent: 100 normally, less in endless Tiers (more drops). */
  noDropPct: number;
}

type Qualities = TreasureClass['quality'];
const NO_QUALITY: Qualities = { unique: 0, set: 0, rare: 0, magic: 0 };

/** D2's treasure class level upgrade: the highest class of the same group at or under the monster's level. */
export function upgraded(data: ItemData, tc: TreasureClass, mlvl: number): TreasureClass {
  if (tc.group <= 0) return tc;
  let best = tc;
  for (const other of data.tcGroups[tc.group] ?? []) if (other.level <= mlvl && other.level >= best.level) best = other;
  return best;
}

const isRuneEntry = (data: ItemData, name: string) => data.bases[name]?.isRune === true || name.startsWith('Runes ');

/** What a treasure class drops: base codes with the quality bonuses they came down with. */
export function rollTreasure(data: ItemData, rng: Rng, tcName: string, ctx: DropContext): { base: ItemBase; quality: Qualities }[] {
  const out: { base: ItemBase; quality: Qualities }[] = [];
  const resolve = (name: string, quality: Qualities, depth: number) => {
    if (out.length >= MAX_DROPS || depth > 16) return;
    const tc = data.treasureClasses[name];
    if (tc) return pick(tc, quality, depth + 1);
    const auto = autoTreasure(data, name);
    if (auto) {
      const total = auto.reduce((n, b) => n + b.rarity, 0);
      if (total <= 0) return;
      let r = rollInt(rng, 0, total - 1);
      for (const b of auto) {
        r -= b.rarity;
        if (r < 0) return void out.push({ base: b, quality });
      }
      return;
    }
    const base = data.bases[name];
    if (base) out.push({ base, quality });
  };
  const pick = (start: TreasureClass, inherited: Qualities, depth: number) => {
    const tc = upgraded(data, start, ctx.mlvl);
    // A class's own quality bonus applies when it has one; otherwise its parent's carries down
    const q: Qualities = {
      unique: tc.quality.unique || inherited.unique,
      set: tc.quality.set || inherited.set,
      rare: tc.quality.rare || inherited.rare,
      magic: tc.quality.magic || inherited.magic,
    };
    if (tc.picks < 0) {
      // Negative picks: each entry drops its Prob times, in order, until |Picks| have dropped
      let left = -tc.picks;
      for (const e of tc.items) {
        for (let i = 0; i < e.prob && left > 0; i++, left--) resolve(e.name, q, depth);
        if (left <= 0) break;
      }
      return;
    }
    const weights = tc.items.map((e) => e.prob * (isRuneEntry(data, e.name) ? ctx.runePct : 100));
    const noDrop = Math.trunc((tc.noDrop * 100 * ctx.noDropPct) / 100);
    const total = weights.reduce((n, w) => n + w, 0) + noDrop;
    if (total <= 0) return;
    for (let p = 0; p < tc.picks && out.length < MAX_DROPS; p++) {
      let r = rollInt(rng, 0, total - 1);
      if (r < noDrop) continue;
      r -= noDrop;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i]!;
        if (r < 0) {
          resolve(tc.items[i]!.name, q, depth);
          break;
        }
      }
    }
  };
  resolve(tcName, NO_QUALITY, 0);
  return out;
}

/** D2's diminishing magic find for uniques (250), sets (500) and rares (600); magic items take it whole. */
const effectiveMf = (mf: number, k: number) => (mf <= 10 ? mf : Math.trunc((mf * k) / (mf + k)));

function ratioFor(data: ItemData, base: ItemBase): ItemRatio | undefined {
  const uber = base.tier > 0;
  const cls = base.classOnly !== undefined;
  return data.itemRatios.find((r) => r.uber === uber && r.classSpecific === cls) ?? data.itemRatios[0];
}

/**
 * An item's quality, as D2 rolls it: unique, then set, rare, magic, superior, each with
 * chance 128 in (ratio - (ilvl - qlvl) / divisor) x 128, divided by magic find, floored at
 * the minimum, less the treasure class's bonus in 1024ths.
 */
export function rollQuality(data: ItemData, rng: Rng, base: ItemBase, ilvl: number, mf: number, tcq: Qualities): Quality {
  if (base.isGem || base.isRune || base.consumable) return 'normal';
  const ratio = ratioFor(data, base);
  if (!ratio) return base.alwaysMagic ? 'magic' : 'normal';
  const diff = Math.max(0, ilvl - base.level);
  const tries: [Quality, [number, number, number], number, number][] = [
    ['unique', ratio.unique, effectiveMf(mf, 250), tcq.unique],
    ['set', ratio.set, effectiveMf(mf, 500), tcq.set],
    ['rare', ratio.rare, effectiveMf(mf, 600), tcq.rare],
    ['magic', ratio.magic, mf, tcq.magic],
  ];
  for (const [quality, [r, div, min], emf, bonus] of tries) {
    if (quality === 'rare' && !base.canRare) continue;
    if (quality === 'magic' && !base.canMagic) continue;
    let chance = (r - Math.trunc(diff / div)) * 128;
    chance = Math.trunc((chance * 100) / (100 + Math.max(0, emf)));
    if (chance < min) chance = min;
    chance -= Math.trunc((chance * bonus) / 1024);
    if (chance <= 128 || rollInt(rng, 0, chance - 1) < 128) return quality;
  }
  if (base.alwaysMagic) return 'magic';
  const [hq, hqDiv] = ratio.hiQuality;
  const hqChance = (hq - Math.trunc(diff / hqDiv)) * 128;
  if (hqChance <= 128 || rollInt(rng, 0, hqChance - 1) < 128) return 'superior';
  return 'normal';
}

export interface KillDrops {
  tc: string;
  ctx: DropContext;
  /**
   * The share of what the treasure class rolls that actually falls, percent, for items and
   * for gems and runes (balance.json drops.dropPct and gemRunePct); rolled per item before
   * its quality, so rarities keep D2R's ratios. Absent, everything falls.
   */
  keep?: { itemPct: number; gemRunePct: number };
  /** Smith's Hammer's own chance per kill, in parts per million (already Tier scaled). */
  hammerPpm: number;
  /** Prefix for the items' uids: unique in the run. */
  uid: string;
}

/** Every item a kill drops: its treasure class, rolled to items, thinned by the keep share, then Smith's Hammer's own roll. */
export function rollKillDrops(data: ItemData, rng: Rng, k: KillDrops): Item[] {
  const items: Item[] = [];
  for (const { base, quality } of rollTreasure(data, rng, k.tc, k.ctx)) {
    if (k.keep) {
      const pct = base.isGem || base.isRune ? k.keep.gemRunePct : k.keep.itemPct;
      if (pct < 100 && rollInt(rng, 0, 99) >= pct) continue;
    }
    const q = rollQuality(data, rng, base, k.ctx.mlvl, k.ctx.magicFind, quality);
    items.push(rollItem(data, rng, { uid: `${k.uid}.${items.length}`, code: base.code, ilvl: k.ctx.mlvl, quality: q }));
  }
  if (k.hammerPpm > 0 && items.length < MAX_DROPS && rollInt(rng, 0, 999_999) < k.hammerPpm) {
    items.push(rollItem(data, rng, { uid: `${k.uid}.${items.length}`, code: SMITHS_HAMMER, ilvl: k.ctx.mlvl, quality: 'normal' }));
  }
  return items;
}
