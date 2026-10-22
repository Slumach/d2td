// What an item is worth to a vendor, from D2's cost columns: the base's cost, through each
// affix's multiply and add (magicprefix.txt, magicsuffix.txt), a unique's or set item's cost
// mult and cost add, plus whatever fills its sockets; a vendor pays a quarter of that (D2's
// sell divisor). The vendor's purse is capped by campaign stage (balance.json vendorCap):
// low in Normal so selling cannot fund early progress, D2's 35,000 by the end of Hell, and
// higher with every endless Tier.

import { compoundPct } from '../fixed.ts';
import type { Sim } from '../state.ts';
import type { ItemData } from './data.ts';
import type { Item } from './item.ts';

export const SELL_DIVISOR = 4;

/** An item's D2 cost: base, affixes, unique or set, and its socketed items. */
export function itemCost(data: ItemData, item: Item): number {
  const base = data.bases[item.code];
  if (!base) return 0;
  let cost = base.cost;
  const affixes = [...(item.prefixes ?? []).map((id) => data.prefixes.find((a) => a.id === id)), ...(item.suffixes ?? []).map((id) => data.suffixes.find((a) => a.id === id))];
  for (const a of affixes) if (a) cost = Math.trunc((cost * (a.multiply || 1024)) / 1024) + a.add;
  const special = item.unique ? data.uniques.find((u) => u.id === item.unique) : item.setItem ? data.setItems.find((s) => s.id === item.setItem) : undefined;
  if (special) cost = cost * special.costMult + special.costAdd;
  for (const s of item.socketed) cost += itemCost(data, s);
  return cost * Math.max(1, item.quantity ?? 1);
}

/** The vendor's cap at the stage the ring is on: Normal, Nightmare, Hell each climb by act; endless Tiers compound. */
export function vendorCap(sim: Sim): number {
  const cap = sim.data.vendorCap;
  const wave = sim.data.waves[Math.max(0, sim.state.wave - 1)];
  if (!wave) return cap.byDifficulty[0]![0]!;
  if (wave.tier) return Math.trunc((cap.byDifficulty[2]![1]! * compoundPct(100 + cap.tierPct, wave.tier)) / 100);
  const [lo, hi] = cap.byDifficulty[wave.difficulty]!;
  return lo! + Math.trunc(((hi! - lo!) * (wave.act - 1)) / 4);
}

/** What selling an item pays on this ring now. */
export function sellPrice(sim: Sim, item: Item): number {
  return Math.min(vendorCap(sim), Math.trunc(itemCost(sim.data.items, item) / SELL_DIVISOR));
}
