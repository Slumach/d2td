// The inventory commands. A player's inventory is sim state (every peer must agree what is
// where, and whether a pickup fits), loaded from their profile when the game starts; their
// stash stays in the profile, so an item coming out of the stash travels in the command
// whole, and one going in simply leaves the sim. Equipping carries the item record too, as
// the lockstep rule asks. Every command acts only on the issuing player's own things.

import type { Sim, Tower } from '../state.ts';
import { maxSocketsAt, type Slot } from './data.ts';
import { canWear, makeRuneword, runewordFor, type Item } from './item.ts';
import { freeSpot, INV_H, INV_W, sizeOf, type InvItem } from './loot.ts';
import { sellPrice } from './price.ts';

/** Where an item sits that a command works on: the player's inventory, or a tower's slot. */
export type ItemRef = { uid: string } | { towerId: number; slot: Slot };

function invOf(sim: Sim, player: number): InvItem[] | undefined {
  return sim.state.inventories[player];
}

function ownTower(sim: Sim, player: number, towerId: number): Tower | undefined {
  const t = sim.state.towers.find((x) => x.id === towerId);
  return t && t.owner === player ? t : undefined;
}

/** True when the item fits at x, y among the others (the item itself excluded). */
export function fitsAt(sim: Sim, inv: readonly InvItem[], item: Item, x: number, y: number): boolean {
  const data = sim.data.items;
  const { w, h } = sizeOf(data, item);
  if (x < 0 || y < 0 || x + w > INV_W || y + h > INV_H) return false;
  return !inv.some((i) => {
    if (i.item.uid === item.uid) return false;
    const s = sizeOf(data, i.item);
    return x < i.x + s.w && i.x < x + w && y < i.y + s.h && i.y < y + h;
  });
}

/** The game starts with the player's inventory from their profile. Only into an empty one. */
export function loadInventory(sim: Sim, player: number, items: readonly InvItem[], belt: readonly (Item | null)[] = []): void {
  const inv = invOf(sim, player);
  if (!inv || inv.length > 0) return;
  for (const i of items) if (fitsAt(sim, inv, i.item, i.x, i.y)) inv.push({ item: i.item, x: i.x, y: i.y });
  const b = sim.state.belts[player];
  if (b) belt.slice(0, BELT_SLOTS).forEach((item, k) => (b[k] = item && beltable(sim, item) ? item : null));
}

/** The belt: four quick slots for gems, runes and jewels, to socket from. */
export const BELT_SLOTS = 4;

function beltable(sim: Sim, item: Item): boolean {
  const b = sim.data.items.bases[item.code];
  return !!b && (b.isGem || b.isRune || b.isJewel);
}

/** A gem, rune or jewel from the inventory into an empty belt slot. */
export function toBelt(sim: Sim, player: number, uid: string, slot: number): void {
  const inv = invOf(sim, player);
  const belt = sim.state.belts[player];
  const k = inv?.findIndex((i) => i.item.uid === uid) ?? -1;
  if (!inv || !belt || k < 0 || slot < 0 || slot >= BELT_SLOTS || belt[slot] || !beltable(sim, inv[k]!.item)) return;
  belt[slot] = inv[k]!.item;
  inv.splice(k, 1);
}

/** A belt slot's item back into the inventory at x, y. */
export function fromBelt(sim: Sim, player: number, slot: number, x: number, y: number): void {
  const inv = invOf(sim, player);
  const belt = sim.state.belts[player];
  const item = belt?.[slot];
  if (!inv || !belt || !item || !fitsAt(sim, inv, item, x, y)) return;
  inv.push({ item, x, y });
  belt[slot] = null;
}

export function moveItem(sim: Sim, player: number, uid: string, x: number, y: number): void {
  const inv = invOf(sim, player);
  const at = inv?.find((i) => i.item.uid === uid);
  if (!inv || !at || !fitsAt(sim, inv, at.item, x, y)) return;
  at.x = x;
  at.y = y;
}

/** An item leaves the game's inventory for the player's stash (the profile keeps it). */
export function stashIn(sim: Sim, player: number, uid: string): void {
  const inv = invOf(sim, player);
  if (!inv) return;
  const i = inv.findIndex((x) => x.item.uid === uid);
  if (i >= 0) inv.splice(i, 1);
}

/** An item from the player's stash comes into the inventory at x, y. */
export function stashOut(sim: Sim, player: number, item: Item, x: number, y: number): void {
  const inv = invOf(sim, player);
  if (!inv || !sim.data.items.bases[item.code] || inv.some((i) => i.item.uid === item.uid)) return;
  if (fitsAt(sim, inv, item, x, y)) inv.push({ item, x, y });
}

/**
 * Puts an item on one of the player's towers: from the inventory when it is there, else
 * the record the command carries (from the stash). Whatever the slot held goes into the
 * inventory; with no room for it, nothing changes.
 */
export function equip(sim: Sim, player: number, towerId: number, slot: Slot, item: Item): void {
  const tower = ownTower(sim, player, towerId);
  const inv = invOf(sim, player);
  if (!tower || !inv || !sim.data.items.bases[item.code]) return;
  const fromInv = inv.find((i) => i.item.uid === item.uid);
  const wearing = fromInv?.item ?? item;
  const worn = { ...tower.gear };
  const old = worn[slot];
  delete worn[slot];
  if (!canWear(sim.data.items, wearing, slot, tower.cls, worn)) return;
  const rest = inv.filter((i) => i !== fromInv);
  let back: InvItem | undefined;
  if (old) {
    const at = freeSpot(sim.data.items, rest, old);
    if (!at) return;
    back = { item: old, ...at };
  }
  sim.state.inventories[player] = back ? [...rest, back] : rest;
  tower.gear = { ...worn, [slot]: wearing };
}

/** Takes an item off a tower: into the inventory (at x, y, or the first free spot), or to the stash. */
export function unequip(sim: Sim, player: number, towerId: number, slot: Slot, to: { x: number; y: number } | 'stash' | undefined): void {
  const tower = ownTower(sim, player, towerId);
  const inv = invOf(sim, player);
  const item = tower?.gear?.[slot];
  if (!tower || !inv || !item) return;
  if (to !== 'stash') {
    const at = to && fitsAt(sim, inv, item, to.x, to.y) ? to : freeSpot(sim.data.items, inv, item);
    if (!at) return;
    inv.push({ item, x: at.x, y: at.y });
  }
  const gear = { ...tower.gear };
  delete gear[slot];
  tower.gear = gear;
}

/** The item a reference points at, and how to put a changed copy back. */
function resolve(sim: Sim, player: number, ref: ItemRef): { item: Item; put: (i: Item) => void } | undefined {
  if ('uid' in ref) {
    const at = invOf(sim, player)?.find((i) => i.item.uid === ref.uid);
    return at && { item: at.item, put: (i) => (at.item = i) };
  }
  const tower = ownTower(sim, player, ref.towerId);
  const item = tower?.gear?.[ref.slot];
  return tower && item ? { item, put: (i) => (tower.gear = { ...tower.gear, [ref.slot]: i }) } : undefined;
}

/** Takes one of a stack (or the whole item) out of the inventory. */
function consume(sim: Sim, player: number, uid: string): Item | undefined {
  const inv = invOf(sim, player);
  const k = inv?.findIndex((i) => i.item.uid === uid) ?? -1;
  if (!inv || k < 0) return undefined;
  const at = inv[k]!;
  if ((at.item.quantity ?? 1) > 1) {
    at.item = { ...at.item, quantity: at.item.quantity! - 1 };
    return { ...at.item, quantity: 1 };
  }
  inv.splice(k, 1);
  return at.item;
}

/**
 * A gem, rune or jewel from the inventory into the next free socket of an item, as D2 does.
 * Sockets never unfill. When the runes in order spell a runeword for the base, it becomes it.
 */
export function socket(sim: Sim, player: number, target: ItemRef, fillerUid: string): void {
  const data = sim.data.items;
  const t = resolve(sim, player, target);
  // The filler comes from the inventory or the belt
  const belt = sim.state.belts[player] ?? [];
  const inBelt = belt.findIndex((i) => i?.uid === fillerUid);
  const fillerItem = invOf(sim, player)?.find((i) => i.item.uid === fillerUid)?.item ?? belt[inBelt] ?? undefined;
  if (!t || !fillerItem || t.item.uid === fillerUid) return;
  const fb = data.bases[fillerItem.code];
  if (!fb || !(fb.isGem || fb.isRune || fb.isJewel)) return;
  if (t.item.socketed.length >= t.item.sockets || t.item.runeword) return;
  let filler: Item;
  if (inBelt >= 0) {
    filler = belt[inBelt]!;
    belt[inBelt] = null;
  } else filler = consume(sim, player, fillerUid)!;
  const next: Item = { ...t.item, socketed: [...t.item.socketed, filler] };
  const rw = runewordFor(data, next);
  if (rw) makeRuneword(data, sim.state.dropRng, next, rw);
  t.put(next);
}

/** Smith's Hammer: one more socket, up to the base's D2 maximum for the item level; refused at it, and on runewords. */
export function hammer(sim: Sim, player: number, target: ItemRef, hammerUid: string): void {
  const data = sim.data.items;
  const t = resolve(sim, player, target);
  const h = invOf(sim, player)?.find((i) => i.item.uid === hammerUid);
  if (!t || !h || data.bases[h.item.code]?.consumable !== 'socket') return;
  const base = data.bases[t.item.code];
  if (!base || t.item.runeword || t.item.sockets >= maxSocketsAt(base, t.item.ilvl)) return;
  consume(sim, player, hammerUid);
  t.put({ ...t.item, sockets: t.item.sockets + 1 });
}

/** Sells an inventory item to the vendor: D2's price, capped by the stage's purse. */
export function sellItem(sim: Sim, player: number, uid: string): void {
  const inv = invOf(sim, player);
  const k = inv?.findIndex((i) => i.item.uid === uid) ?? -1;
  if (!inv || k < 0) return;
  const price = sellPrice(sim, inv[k]!.item);
  inv.splice(k, 1);
  sim.state.gold[player]! += price;
}

