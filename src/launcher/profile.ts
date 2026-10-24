// The player's profile: what they own between games. Their inventory (D2's 10 x 4 grid),
// their stash (10 x 10 pages, a page added whenever one is needed), and the items still
// out in a game that has not been left yet (on towers, or on their way home), which come
// back into the inventory, or the stash when it is full, the next time the profile loads.
// In Electron it lives in the app data folder, one per Windows user (userData/profile.json);
// in the browser, in localStorage. Saved on every change.

import { validItem } from '../net/validate.ts';
import type { ItemData } from '../sim/items/data.ts';
import type { Item } from '../sim/items/item.ts';
import { INV_H, INV_W, sizeOf, type InvItem } from '../sim/items/loot.ts';
import type { LauncherApi } from './api.ts';

export const STASH_W = 10;
export const STASH_H = 10;
const STORAGE_KEY = 'd2td:profile';

export interface Profile {
  version: 1;
  inventory: InvItem[];
  stash: InvItem[][];
  /** Items out in a game not yet left: they come home on the next load. */
  inPlay: Item[];
  /** The belt's four slots. */
  belt: (Item | null)[];
  /** The furthest wave reached, for the character screen. */
  bestWave: number;
  /** Battle Mode's record: matches won and lost (draws count as neither), and the furthest wave a match reached. */
  battle: BattleRecord;
}

export interface BattleRecord {
  wins: number;
  losses: number;
  draws: number;
  bestWave: number;
}

const NO_BATTLES: BattleRecord = { wins: 0, losses: 0, draws: 0, bestWave: 0 };

export function emptyProfile(): Profile {
  return { version: 1, inventory: [], stash: [[]], inPlay: [], belt: [null, null, null, null], bestWave: 0, battle: { ...NO_BATTLES } };
}

/** The first free spot in a w x h grid, column by column from the top left. */
export function freeIn(data: ItemData, grid: readonly InvItem[], item: Item, w: number, h: number): { x: number; y: number } | undefined {
  const { w: iw, h: ih } = sizeOf(data, item);
  const taken = (x: number, y: number) =>
    grid.some((g) => {
      const s = sizeOf(data, g.item);
      return x < g.x + s.w && g.x < x + iw && y < g.y + s.h && g.y < y + ih;
    });
  for (let x = 0; x + iw <= w; x++) for (let y = 0; y + ih <= h; y++) if (!taken(x, y)) return { x, y };
  return undefined;
}

/** Puts an item in the stash: the first page with room, or a new page. */
export function stashItem(data: ItemData, profile: Profile, item: Item): void {
  for (const page of profile.stash) {
    const at = freeIn(data, page, item, STASH_W, STASH_H);
    if (at) return void page.push({ item, ...at });
  }
  profile.stash.push([{ item, x: 0, y: 0 }]);
}

/** Brings items home: into the inventory where they fit, the rest into the stash. */
export function bringHome(data: ItemData, profile: Profile, items: readonly Item[]): void {
  for (const item of items) {
    const at = freeIn(data, profile.inventory, item, INV_W, INV_H);
    if (at) profile.inventory.push({ item, ...at });
    else stashItem(data, profile, item);
  }
}

/** Items in play come home (the last game was left, or the app closed during it). */
export function settle(data: ItemData, profile: Profile): void {
  const items = profile.inPlay;
  profile.inPlay = [];
  bringHome(data, profile, items);
}

/** A profile read back, keeping only well-formed items of bases this install knows. */
export function parseProfile(json: string | null, data: ItemData): Profile {
  if (!json) return emptyProfile();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return emptyProfile();
  }
  const item = (v: unknown): Item | undefined => {
    const i = validItem(v);
    return i && data.bases[i.code] ? i : undefined;
  };
  const grid = (v: unknown): InvItem[] =>
    Array.isArray(v)
      ? v.flatMap((g) => {
          const i = item((g as InvItem)?.item);
          const { x, y } = (g ?? {}) as InvItem;
          return i && Number.isInteger(x) && Number.isInteger(y) ? [{ item: i, x, y }] : [];
        })
      : [];
  const stash = Array.isArray(raw['stash']) ? raw['stash'].map(grid) : [];
  return {
    version: 1,
    inventory: grid(raw['inventory']),
    stash: stash.length > 0 ? stash : [[]],
    inPlay: Array.isArray(raw['inPlay']) ? raw['inPlay'].flatMap((v) => item(v) ?? []) : [],
    belt: [0, 1, 2, 3].map((k) => (Array.isArray(raw['belt']) ? (item(raw['belt'][k]) ?? null) : null)),
    bestWave: Number.isInteger(raw['bestWave']) ? (raw['bestWave'] as number) : 0,
    battle: battleRecord(raw['battle']),
  };
}

/** A battle record read back: every count a whole number, nothing missing. */
function battleRecord(v: unknown): BattleRecord {
  const r = (v ?? {}) as Partial<Record<keyof BattleRecord, unknown>>;
  const n = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : 0);
  return { wins: n(r.wins), losses: n(r.losses), draws: n(r.draws), bestWave: n(r.bestWave) };
}

export async function loadProfile(launcher: LauncherApi | undefined, data: ItemData): Promise<Profile> {
  try {
    const json = launcher ? await launcher.loadProfile() : localStorage.getItem(STORAGE_KEY);
    return parseProfile(json, data);
  } catch {
    return emptyProfile();
  }
}

export async function saveProfile(launcher: LauncherApi | undefined, profile: Profile): Promise<void> {
  const json = JSON.stringify(profile);
  try {
    if (launcher) await launcher.saveProfile(json);
    else localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // A profile that cannot be written now is written on the next change
  }
}
