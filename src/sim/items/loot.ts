// Loot in the sim: a kill drops its items on the ground at the kill spot, owned by the
// player whose tower made the kill. That player picks them up with a command; whatever is
// still on the ground when the monster's wave is cleared goes to the owner's inventory if
// there is room, and is lost otherwise. Drops roll on their own rng stream, so loot never
// shifts combat's rolls.

import { compoundPct } from '../fixed.ts';
import type { LootFilter, Monster, Sim } from '../state.ts';
import { baseMonsterId } from '../difficulty.ts';
import { rollInt } from '../rng.ts';
import { rollKillDrops, rollTreasure } from './drops.ts';
import { WIRTS_LEG, type ItemData } from './data.ts';
import { rollItem, type Item } from './item.ts';
import { gearOf } from './tower.ts';
import { sellPrice } from './price.ts';

/** D2's inventory: ten columns, four rows. */
export const INV_W = 10;
export const INV_H = 4;

export interface InvItem {
  item: Item;
  x: number;
  y: number;
}

export interface Drop {
  id: number;
  item: Item;
  owner: number;
  x: number;
  y: number;
  /** The wave of the monster that dropped it: cleared, it is collected. */
  wave: number;
  /** Dropped by a cow: collected when the cow portal closes. */
  cow?: boolean;
}

/** Inventory cells an item covers. */
export function sizeOf(data: ItemData, item: Item): { w: number; h: number } {
  const b = data.bases[item.code];
  return { w: b?.width ?? 1, h: b?.height ?? 1 };
}

/** The first free spot for an item, column by column from the top left, as D2 places a pickup. */
export function freeSpot(data: ItemData, inv: readonly InvItem[], item: Item): { x: number; y: number } | undefined {
  const { w, h } = sizeOf(data, item);
  const taken = (x: number, y: number) =>
    inv.some((i) => {
      const s = sizeOf(data, i.item);
      return x < i.x + s.w && i.x < x + w && y < i.y + s.h && i.y < y + h;
    });
  for (let x = 0; x + w <= INV_W; x++) for (let y = 0; y + h <= INV_H; y++) if (!taken(x, y)) return { x, y };
  return undefined;
}

/** Puts an item into a player's inventory: on a stack of the same consumable, or the first free spot. False when full. */
export function stow(sim: Sim, player: number, item: Item): boolean {
  const inv = sim.state.inventories[player];
  if (!inv) return false;
  const data = sim.data.items;
  const base = data.bases[item.code];
  if (base?.stackable) {
    const stack = inv.find((i) => i.item.code === item.code && (i.item.quantity ?? 1) < base.maxStack);
    if (stack) {
      stack.item.quantity = (stack.item.quantity ?? 1) + (item.quantity ?? 1);
      return true;
    }
  }
  const at = freeSpot(data, inv, item);
  if (!at) return false;
  inv.push({ item, ...at });
  return true;
}

/** Items going back to a player: into the inventory where they fit, the rest homeward to the stash. */
export function sendHome(sim: Sim, player: number, items: readonly Item[]): void {
  for (const item of items) if (!stow(sim, player, item)) sim.state.homeward[player]?.push(item);
}

/** The drop rate scaling of the wave a monster walks in: every endless wave past Hell multiplies it (balance.json drops.endlessWaveDropPct). */
function tierPct(sim: Sim, monster: Monster): number {
  return compoundPct(100 + sim.data.drops.endlessWaveDropPct, endlessWaveOf(sim.data, monster.wave));
}

/** How many waves past Hell Baal a wave index lies: 0 in the campaign, 1 for the first endless wave. */
export function endlessWaveOf(data: { waves: readonly { tier?: number; actWave: number; actWaves: number }[] }, wave: number): number {
  const w = data.waves[wave];
  if (!w?.tier) return 0;
  return (w.tier - 1) * w.actWaves + w.actWave;
}

/** What a killed monster drops, onto the ground. */
export function dropLoot(sim: Sim, monster: Monster): void {
  if (sim.data.noLoot) return;
  const s = sim.state;
  const def = sim.data.monsters[monster.def];
  if (!def) return;
  const tc = monster.rank === 'champion' ? def.treasure[1] : monster.rank === 'unique' ? def.treasure[2] : def.treasure[0];
  const tower = monster.lastTower ? s.towers.find((t) => t.id === monster.lastTower) : undefined;
  const owner = Math.min(monster.lastHit, s.gold.length - 1);
  const scale = tierPct(sim, monster);
  const d = sim.data.drops;
  // A monster without a treasure class drops nothing of its own, but may still drop a leg
  const items = !tc ? [] : rollKillDrops(sim.data.items, s.dropRng, {
    tc,
    ctx: {
      mlvl: monster.level,
      magicFind: tower ? gearOf(sim, tower).magicFindPct : 0,
      runePct: d.runeMultiplierPct * (monster.runeBoost ?? 1),
      noDropPct: Math.max(1, Math.trunc((100 * 100) / scale)),
    },
    keep: { itemPct: d.dropPct, gemRunePct: d.gemRunePct },
    hammerPpm: Math.trunc((d.smithsHammerPpm * scale) / 100),
    uid: `${s.tick}.${monster.id}`,
  });
  items.push(...cowLevelDrops(sim, monster, items.length));
  for (const item of items) s.drops.push({ id: s.nextId++, item, owner, x: monster.x, y: monster.y, wave: monster.wave, ...(monster.cow ? { cow: true } : {}) });
}

/**
 * Wirt's Leg, only in Hell and the endless Tiers: a tiny chance from any monster, a much
 * bigger one from Griswold's pack (balance.json cow). The Cow King always drops a rune of
 * Ist or higher, at D2's odds among those runes, and sometimes another leg.
 */
function cowLevelDrops(sim: Sim, monster: Monster, already: number): Item[] {
  const s = sim.state;
  const c = sim.data.cow;
  const data = sim.data.items;
  const def = sim.data.monsters[monster.def];
  const out: Item[] = [];
  const uid = () => `${s.tick}.${monster.id}.c${already + out.length}`;
  const leg = () => rollItem(data, s.dropRng, { uid: uid(), code: WIRTS_LEG, ilvl: monster.level, quality: 'normal' });
  const hell = (def?.difficulty ?? 0) >= 2 || (sim.data.waves[monster.wave]?.tier ?? 0) > 0;
  if (hell && !monster.cow) {
    const ppm = monster.pack === c.pack ? c.griswoldLegPpm : c.legPpm;
    if (rollInt(s.dropRng, 0, 999_999) < ppm) out.push(leg());
  }
  if (monster.cow && def && baseMonsterId(def.id) === c.king) {
    const rune = highRune(sim);
    if (data.bases[rune]) out.push(rollItem(data, s.dropRng, { uid: uid(), code: rune, ilvl: monster.level, quality: 'normal' }));
    if (rollInt(s.dropRng, 0, 99) < c.kingLegPct) out.push(leg());
  }
  return out;
}

/** A rune of balance.json cow.kingRuneMin or higher, drawn from D2's Runes classes, so higher runes keep D2's rarity. */
function highRune(sim: Sim): string {
  const data = sim.data.items;
  const min = sim.data.cow.kingRuneMin;
  const top = [...Object.keys(data.treasureClasses)].filter((n) => /^Runes \d+$/.test(n)).sort((a, b) => Number(b.slice(6)) - Number(a.slice(6)))[0];
  for (let i = 0; top && i < 64; i++) {
    const got = rollTreasure(data, sim.state.dropRng, top, { mlvl: 99, magicFind: 0, runePct: 100, noDropPct: 0 })[0];
    if (got && got.base.isRune && got.base.code >= min) return got.base.code;
  }
  return min;
}

/** A player picks up one of their drops. Refused when it is not theirs or the inventory is full. */
export function pickup(sim: Sim, player: number, dropId: number): void {
  const s = sim.state;
  const drop = s.drops.find((d) => d.id === dropId);
  if (!drop || drop.owner !== player) return;
  if (stow(sim, player, drop.item)) s.drops = s.drops.filter((d) => d.id !== dropId);
}

/** Sells a drop where it lies: its owner gets the capped sell price and the drop is gone. */
export function sellDrop(sim: Sim, player: number, dropId: number): void {
  const s = sim.state;
  const drop = s.drops.find((d) => d.id === dropId);
  if (!drop || drop.owner !== player) return;
  s.gold[player]! += sellPrice(sim, drop.item);
  s.drops = s.drops.filter((d) => d.id !== dropId);
}

/**
 * D2R-style loot filter. The default keeps what a player would stop for: magic, rare, set,
 * unique and runeword items, anything socketed or superior, gems, runes and the consumables
 * (Smith's Hammer, Wirt's Leg); plain white items drop but are not collected. 'all' keeps
 * everything. A click on a label picks anything up regardless.
 */
export function passesFilter(data: ItemData, item: Item, filter: LootFilter): boolean {
  if (filter === 'all') return true;
  const base = data.bases[item.code];
  if (!base) return false;
  if (base.isGem || base.isRune || base.consumable) return true;
  if (item.sockets > 0) return true;
  return item.quality !== 'normal' && item.quality !== 'low';
}

/** Drops of cleared waves go to their owners' inventories if the filter keeps them and there is room; the rest are lost. */
export function collectCleared(sim: Sim): void {
  const s = sim.state;
  if (s.drops.length === 0) return;
  const cleared = s.drops.filter((d) => (d.cow ? !s.cow : (s.waves[d.wave]?.remaining ?? 0) <= 0));
  if (cleared.length === 0) return;
  for (const d of cleared) if (passesFilter(sim.data.items, d.item, s.lootFilters[d.owner] ?? 'default')) stow(sim, d.owner, d.item);
  s.drops = s.drops.filter((d) => !cleared.includes(d));
}
