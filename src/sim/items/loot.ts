// Loot in the sim: a kill drops its items on the ground at the kill spot, owned by the
// player whose tower made the kill. That player picks them up with a command; whatever is
// still on the ground when the monster's wave is cleared goes to the owner's inventory if
// there is room, and is lost otherwise. Drops roll on their own rng stream, so loot never
// shifts combat's rolls.

import { compoundPct } from '../fixed.ts';
import type { Monster, Sim } from '../state.ts';
import { rollKillDrops } from './drops.ts';
import type { ItemData } from './data.ts';
import type { Item } from './item.ts';
import { gearOf } from './tower.ts';

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

/** The drop rate scaling of the wave a monster walks in: each endless Tier multiplies it (balance.json drops.tierDropPct). */
function tierPct(sim: Sim, monster: Monster): number {
  const tier = sim.data.waves[monster.wave]?.tier ?? 0;
  return compoundPct(100 + sim.data.drops.tierDropPct, tier);
}

/** What a killed monster drops, onto the ground. */
export function dropLoot(sim: Sim, monster: Monster): void {
  const s = sim.state;
  const def = sim.data.monsters[monster.def];
  if (!def) return;
  const tc = monster.rank === 'champion' ? def.treasure[1] : monster.rank === 'unique' ? def.treasure[2] : def.treasure[0];
  if (!tc) return;
  const tower = monster.lastTower ? s.towers.find((t) => t.id === monster.lastTower) : undefined;
  const owner = Math.min(monster.lastHit, s.gold.length - 1);
  const scale = tierPct(sim, monster);
  const d = sim.data.drops;
  const items = rollKillDrops(sim.data.items, s.dropRng, {
    tc,
    ctx: {
      mlvl: monster.level,
      magicFind: tower ? gearOf(sim, tower).magicFindPct : 0,
      runePct: d.runeMultiplierPct * (monster.runeBoost ?? 1),
      noDropPct: Math.max(1, Math.trunc((100 * 100) / scale)),
    },
    hammerPpm: Math.trunc((d.smithsHammerPpm * scale) / 100),
    uid: `${s.tick}.${monster.id}`,
  });
  for (const item of items) s.drops.push({ id: s.nextId++, item, owner, x: monster.x, y: monster.y, wave: monster.wave });
}

/** A player picks up one of their drops. Refused when it is not theirs or the inventory is full. */
export function pickup(sim: Sim, player: number, dropId: number): void {
  const s = sim.state;
  const drop = s.drops.find((d) => d.id === dropId);
  if (!drop || drop.owner !== player) return;
  if (stow(sim, player, drop.item)) s.drops = s.drops.filter((d) => d.id !== dropId);
}

/** Drops of cleared waves go to their owners' inventories if there is room; the rest are lost. */
export function collectCleared(sim: Sim): void {
  const s = sim.state;
  if (s.drops.length === 0) return;
  const cleared = s.drops.filter((d) => (s.waves[d.wave]?.remaining ?? 0) <= 0);
  if (cleared.length === 0) return;
  for (const d of cleared) stow(sim, d.owner, d.item);
  s.drops = s.drops.filter((d) => !cleared.includes(d));
}
