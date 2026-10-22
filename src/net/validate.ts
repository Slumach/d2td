// The relay checks every command before it goes into a bundle. A malformed command would
// reach every player's sim at the same tick, so one bad client must not be able to send one.

import { SLOTS, type Slot } from '../sim/items/data.ts';
import type { ItemRef } from '../sim/items/inventory.ts';
import type { Item, Quality, StatRoll } from '../sim/items/item.ts';
import type { InvItem } from '../sim/items/loot.ts';
import type { Command, Targeting } from '../sim/state.ts';
import { TARGETING_MODES } from '../sim/state.ts';

const int = (v: unknown, max = 1_000_000_000): boolean => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const str = (v: unknown): boolean => typeof v === 'string' && v.length > 0 && v.length <= 64;
const signed = (v: unknown): boolean => Number.isSafeInteger(v) && Math.abs(v as number) <= 1_000_000_000;
const QUALITIES: readonly Quality[] = ['low', 'normal', 'superior', 'magic', 'rare', 'set', 'unique', 'runeword'];
const strs = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length <= max && v.every(str);

function validStat(v: unknown): StatRoll | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (!str(s['stat']) || !signed(s['value']) || (s['param'] !== undefined && typeof s['param'] !== 'string') || (s['level'] !== undefined && !signed(s['level']))) return null;
  return { stat: s['stat'] as string, value: s['value'] as number, ...(s['param'] !== undefined ? { param: (s['param'] as string).slice(0, 64) } : {}), ...(s['level'] !== undefined ? { level: s['level'] as number } : {}) };
}

/** An item record, rebuilt field by field; socketed items one level deep. */
export function validItem(v: unknown, depth = 0): Item | null {
  if (typeof v !== 'object' || v === null || depth > 1) return null;
  const i = v as Record<string, unknown>;
  if (!str(i['uid']) || !str(i['code']) || !QUALITIES.includes(i['quality'] as Quality) || !int(i['ilvl'], 255) || !int(i['sockets'], 6)) return null;
  if (!Array.isArray(i['socketed']) || i['socketed'].length > 6 || !Array.isArray(i['stats']) || i['stats'].length > 128) return null;
  const socketed = i['socketed'].map((s) => validItem(s, depth + 1));
  const stats = i['stats'].map(validStat);
  if (socketed.some((s) => !s) || stats.some((s) => !s)) return null;
  const item: Item = { uid: i['uid'] as string, code: i['code'] as string, quality: i['quality'] as Quality, ilvl: i['ilvl'] as number, sockets: i['sockets'] as number, socketed: socketed as Item[], stats: stats as StatRoll[] };
  if (i['ethereal'] === true) item.ethereal = true;
  if (i['prefixes'] !== undefined) {
    if (!strs(i['prefixes'], 3)) return null;
    item.prefixes = i['prefixes'];
  }
  if (i['suffixes'] !== undefined) {
    if (!strs(i['suffixes'], 3)) return null;
    item.suffixes = i['suffixes'];
  }
  if (i['rareName'] !== undefined) {
    if (!strs(i['rareName'], 2) || i['rareName'].length !== 2) return null;
    item.rareName = [i['rareName'][0]!, i['rareName'][1]!];
  }
  for (const k of ['unique', 'setItem', 'runeword'] as const) {
    if (i[k] === undefined) continue;
    if (!str(i[k])) return null;
    item[k] = i[k] as string;
  }
  if (i['quantity'] !== undefined) {
    if (!int(i['quantity'], 999) || (i['quantity'] as number) < 1) return null;
    item.quantity = i['quantity'] as number;
  }
  return item;
}

const slot = (v: unknown): v is Slot => SLOTS.includes(v as Slot);

function validRef(v: unknown): ItemRef | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (str(r['uid'])) return { uid: r['uid'] as string };
  if (int(r['towerId']) && slot(r['slot'])) return { towerId: r['towerId'] as number, slot: r['slot'] };
  return null;
}

function validInvItem(v: unknown): InvItem | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const item = validItem(r['item']);
  if (!item || !int(r['x'], 9) || !int(r['y'], 3)) return null;
  return { item, x: r['x'] as number, y: r['y'] as number };
}

/** The command if it is well formed, else null. Rebuilt field by field so no extra data rides along. */
export function validCommand(v: unknown): Command | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  switch (c['type']) {
    case 'build':
      if (!int(c['x'], 1000) || !int(c['y'], 1000) || !str(c['cls']) || (c['skill'] !== undefined && !str(c['skill']))) return null;
      return { type: 'build', x: c['x'] as number, y: c['y'] as number, cls: c['cls'] as string, ...(c['skill'] !== undefined ? { skill: c['skill'] as string } : {}) };
    case 'pickSkill':
    case 'pickBranch':
      if (!int(c['towerId']) || !str(c['skill'])) return null;
      return { type: c['type'], towerId: c['towerId'] as number, skill: c['skill'] as string };
    case 'upgrade':
    case 'upgradeTier':
    case 'sell':
      if (!int(c['towerId'])) return null;
      return { type: c['type'], towerId: c['towerId'] as number };
    case 'setTargeting':
      if (!int(c['towerId']) || !TARGETING_MODES.includes(c['mode'] as never)) return null;
      return { type: 'setTargeting', towerId: c['towerId'] as number, mode: c['mode'] as Targeting };
    case 'evolve':
      if (!int(c['towerA']) || !int(c['towerB'])) return null;
      return { type: 'evolve', towerA: c['towerA'] as number, towerB: c['towerB'] as number };
    case 'callWave':
      return { type: 'callWave' };
    case 'pickup':
      return int(c['dropId']) ? { type: 'pickup', dropId: c['dropId'] as number } : null;
    case 'sellDrop':
      return int(c['dropId']) ? { type: 'sellDrop', dropId: c['dropId'] as number } : null;
    case 'cowPortal':
      return str(c['uid']) ? { type: 'cowPortal', uid: c['uid'] as string } : null;
    case 'loadInventory': {
      if (!Array.isArray(c['items']) || c['items'].length > 40) return null;
      const items = c['items'].map(validInvItem);
      if (!items.every((i) => i)) return null;
      if (c['belt'] === undefined) return { type: 'loadInventory', items: items as InvItem[] };
      const raw = c['belt'];
      if (!Array.isArray(raw) || raw.length > 4) return null;
      const belt = raw.map((b: unknown) => (b === null ? null : validItem(b)));
      if (belt.some((b, k) => b === null && raw[k] !== null)) return null;
      return { type: 'loadInventory', items: items as InvItem[], belt };
    }
    case 'toBelt':
      return str(c['uid']) && int(c['slot'], 3) ? { type: 'toBelt', uid: c['uid'] as string, slot: c['slot'] as number } : null;
    case 'fromBelt':
      return int(c['slot'], 3) && int(c['x'], 9) && int(c['y'], 3) ? { type: 'fromBelt', slot: c['slot'] as number, x: c['x'] as number, y: c['y'] as number } : null;
    case 'moveItem':
      return str(c['uid']) && int(c['x'], 9) && int(c['y'], 3) ? { type: 'moveItem', uid: c['uid'] as string, x: c['x'] as number, y: c['y'] as number } : null;
    case 'stashIn':
    case 'sellItem':
      return str(c['uid']) ? { type: c['type'], uid: c['uid'] as string } : null;
    case 'stashOut': {
      const item = validItem(c['item']);
      return item && int(c['x'], 9) && int(c['y'], 3) ? { type: 'stashOut', item, x: c['x'] as number, y: c['y'] as number } : null;
    }
    case 'equip': {
      const item = validItem(c['item']);
      return item && int(c['towerId']) && slot(c['slot']) ? { type: 'equip', towerId: c['towerId'] as number, slot: c['slot'], item } : null;
    }
    case 'unequip': {
      if (!int(c['towerId']) || !slot(c['slot'])) return null;
      const out: Command = { type: 'unequip', towerId: c['towerId'] as number, slot: c['slot'] };
      if (c['toStash'] === true) out.toStash = true;
      if (int(c['x'], 9) && int(c['y'], 3)) {
        out.x = c['x'] as number;
        out.y = c['y'] as number;
      }
      return out;
    }
    case 'socket':
    case 'hammer': {
      const target = validRef(c['target']);
      return target && str(c['uid']) ? { type: c['type'], target, uid: c['uid'] as string } : null;
    }
    case 'tradeOpen':
      return int(c['with'], 64) ? { type: 'tradeOpen', with: c['with'] as number } : null;
    case 'tradeOffer':
      return strs(c['items'], 40) && int(c['gold']) ? { type: 'tradeOffer', items: [...c['items']], gold: c['gold'] as number } : null;
    case 'tradeAccept':
    case 'tradeCancel':
      return { type: c['type'] };
    default:
      return null;
  }
}
