// D2's trade window, as match commands (players may defend different rings in FFA, so a
// trade belongs to the match, not to a ring). Either player opens it on the other; each
// puts items from their inventory and gold on their side; any change clears both accepts;
// when both have accepted, everything moves at once, or nothing does if it no longer fits.
// Every peer runs the same commands, so the trade lands identically everywhere.

import type { Match } from '../match.ts';
import { ringOf, seatOf } from '../match.ts';
import type { Item } from './item.ts';
import { freeSpot, type InvItem } from './loot.ts';

export interface TradeSide {
  /** Uids of items in this player's inventory. */
  items: string[];
  gold: number;
  accepted: boolean;
}

export interface Trade {
  /** Lobby slots of the two players: a opened it. */
  a: number;
  b: number;
  sides: [TradeSide, TradeSide];
}

export type TradeCommand =
  | { type: 'tradeOpen'; with: number }
  | { type: 'tradeOffer'; items: string[]; gold: number }
  | { type: 'tradeAccept' }
  | { type: 'tradeCancel' };

const TRADE_TYPES = new Set(['tradeOpen', 'tradeOffer', 'tradeAccept', 'tradeCancel']);
export const isTradeCommand = (c: { type: string }): c is TradeCommand => TRADE_TYPES.has(c.type);

const emptySide = (): TradeSide => ({ items: [], gold: 0, accepted: false });

/** A player's inventory and gold, wherever they play. */
function holdings(match: Match, player: number): { inv: InvItem[]; gold: number[]; seat: number; ring: number } {
  const ring = ringOf(match, player);
  const zone = match.zones[ring]!;
  const seat = seatOf(match, player);
  return { inv: zone.state.inventories[seat]!, gold: zone.state.gold, seat, ring };
}

export function tradeOf(match: Match, player: number): Trade | undefined {
  return match.state.trades.find((t) => t.a === player || t.b === player);
}

export function applyTrade(match: Match, player: number, c: TradeCommand): void {
  const trades = match.state.trades;
  const open = tradeOf(match, player);
  if (c.type === 'tradeOpen') {
    if (open || c.with === player || c.with < 0 || c.with >= match.players || tradeOf(match, c.with)) return;
    trades.push({ a: player, b: c.with, sides: [emptySide(), emptySide()] });
    return;
  }
  if (!open) return;
  const mine = open.sides[open.a === player ? 0 : 1];
  if (c.type === 'tradeCancel') {
    match.state.trades = trades.filter((t) => t !== open);
    return;
  }
  if (c.type === 'tradeOffer') {
    const h = holdings(match, player);
    const items = [...new Set(c.items)].filter((uid) => h.inv.some((i) => i.item.uid === uid));
    mine.items = items;
    mine.gold = Math.max(0, Math.min(Math.trunc(c.gold), h.gold[h.seat] ?? 0));
    for (const s of open.sides) s.accepted = false;
    return;
  }
  mine.accepted = true;
  if (open.sides.every((s) => s.accepted)) complete(match, open);
}

/** Both accepted: swap items and gold if everything still fits; the window closes either way. */
function complete(match: Match, t: Trade): void {
  match.state.trades = match.state.trades.filter((x) => x !== t);
  const ha = holdings(match, t.a);
  const hb = holdings(match, t.b);
  const data = match.data.items;
  const take = (h: typeof ha, uids: string[]) => h.inv.filter((i) => uids.includes(i.item.uid)).map((i) => i.item);
  const giveA = take(ha, t.sides[0].items);
  const giveB = take(hb, t.sides[1].items);
  if (giveA.length !== t.sides[0].items.length || giveB.length !== t.sides[1].items.length) return;
  if ((ha.gold[ha.seat] ?? 0) < t.sides[0].gold || (hb.gold[hb.seat] ?? 0) < t.sides[1].gold) return;
  // Each side's inventory without what it gives, then what it receives placed in turn
  const place = (inv: InvItem[], gone: Item[], incoming: Item[]): InvItem[] | undefined => {
    const out = inv.filter((i) => !gone.includes(i.item));
    for (const item of incoming) {
      const at = freeSpot(data, out, item);
      if (!at) return undefined;
      out.push({ item, ...at });
    }
    return out;
  };
  const nextA = place(ha.inv, giveA, giveB);
  const nextB = place(hb.inv, giveB, giveA);
  if (!nextA || !nextB) return;
  match.zones[ha.ring]!.state.inventories[ha.seat] = nextA;
  match.zones[hb.ring]!.state.inventories[hb.seat] = nextB;
  ha.gold[ha.seat]! += t.sides[1].gold - t.sides[0].gold;
  hb.gold[hb.seat]! += t.sides[0].gold - t.sides[1].gold;
}
