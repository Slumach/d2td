// Keeps the player's profile in step with the game on screen. The sim owns the inventory
// while a game runs (every peer must agree on it); the profile mirrors it, records what is
// on the player's towers as in play, and owns the stash. An item crossing between the
// stash and the game goes as a command, and the stash changes only once the sim shows the
// move happened, so a refused command never loses an item. Leaving the game brings
// everything home. The keeper only reads the sim; it never changes it.

import type { LauncherApi } from '../launcher/api.ts';
import { bringHome, freeIn, loadProfile, saveProfile, settle, STASH_H, STASH_W, type Profile } from '../launcher/profile.ts';
import type { ItemData } from '../sim/items/data.ts';
import type { Item } from '../sim/items/item.ts';
import { INV_H, INV_W, type InvItem } from '../sim/items/loot.ts';
import type { Command, Sim } from '../sim/state.ts';

/** How long a stash move waits for the sim to show it before it is given up, in ticks. */
const PENDING_TICKS = 100;

interface Pending {
  uid: string;
  since: number;
  /** Out of the stash (into the game), or into it (at a chosen page and spot). */
  dir: 'out' | 'in';
  item: Item;
  page?: number;
  at?: { x: number; y: number };
}

export class Keeper {
  profile: Profile | undefined;
  private pending: Pending[] = [];
  /** How many of the sim's homeward items this game are already in the stash. */
  private homewardSeen = 0;
  private savedJson = '';
  /** The game's side of the profile as last mirrored, to skip ticks where nothing changed. */
  private mirrored = '';
  private dirty = false;
  private loaded = false;
  private started = false;

  constructor(
    private readonly launcher: LauncherApi | undefined,
    private readonly data: ItemData,
  ) {}

  async load(): Promise<void> {
    const profile = await loadProfile(this.launcher, this.data);
    settle(this.data, profile);
    this.profile = profile;
    this.loaded = true;
    this.save();
  }

  /** A new game: its inventory starts as the profile's. Waits for the profile if it is still loading. */
  begin(issue: (c: Command) => void): void {
    this.started = false;
    this.homewardSeen = 0;
    this.pending = [];
    this.mirrored = '';
    const go = () => {
      if (this.started || !this.profile) return;
      this.started = true;
      this.profile.inventory = this.laidOut(this.profile.inventory);
      this.save();
      issue({ type: 'loadInventory', items: this.profile.inventory, belt: this.profile.belt });
    };
    if (this.loaded) go();
    else void this.load().then(go);
  }

  /** Every tick: settle pending stash moves, take homeward items into the stash, save on any change. */
  sync(sim: Sim, seat: number): void {
    const p = this.profile;
    if (!p || !this.started) return;
    const held = holdings(sim, seat);
    const has = (uid: string) => held.some((i) => i.uid === uid);
    const tick = sim.state.tick;
    for (const m of [...this.pending]) {
      const done = m.dir === 'out' ? has(m.uid) : !has(m.uid);
      if (done) {
        if (m.dir === 'out') for (const page of p.stash) removeUid(page, m.uid);
        else this.putInStash(m.item, m.page, m.at);
        this.dirty = true;
      }
      if (done || tick - m.since > PENDING_TICKS) this.pending = this.pending.filter((x) => x !== m);
    }
    const homeward = sim.state.homeward[seat] ?? [];
    for (; this.homewardSeen < homeward.length; this.homewardSeen++) {
      this.putInStash(homeward[this.homewardSeen]!);
      this.dirty = true;
    }
    const inPlay = sim.state.towers.filter((t) => t.owner === seat).flatMap((t) => Object.values(t.gear ?? {}));
    const belt = sim.state.belts[seat] ?? [];
    const mirror = JSON.stringify([sim.state.inventories[seat] ?? [], inPlay, belt, sim.state.wave]);
    if (mirror === this.mirrored && !this.dirty) return;
    this.mirrored = mirror;
    this.dirty = false;
    p.inventory = structuredClone(sim.state.inventories[seat] ?? []);
    p.inPlay = structuredClone(inPlay);
    p.belt = structuredClone(belt);
    p.bestWave = Math.max(p.bestWave, sim.state.wave);
    this.save();
  }

  /** Eternal Conflict: a finished match on the profile's record (won true, lost false, a draw undefined). */
  recordBattle(won: boolean | undefined, wave: number): void {
    const go = () => {
      const r = this.profile!.battle;
      if (won === true) r.wins++;
      else if (won === false) r.losses++;
      else r.draws++;
      r.bestWave = Math.max(r.bestWave, wave);
      this.save();
    };
    if (this.loaded && this.profile) go();
    else void this.load().then(go);
  }

  /** The game is left (quit, lost, won, disconnected): everything in it comes home. */
  leave(sim: Sim | undefined, seat: number): void {
    const p = this.profile;
    if (!p || !this.started) return;
    if (sim) {
      this.sync(sim, seat);
      // Homeward items not yet stashed, then what the towers wore
      const homeward = sim.state.homeward[seat] ?? [];
      for (; this.homewardSeen < homeward.length; this.homewardSeen++) this.putInStash(homeward[this.homewardSeen]!);
    }
    const items = p.inPlay;
    p.inPlay = [];
    bringHome(this.data, p, items);
    this.started = false;
    this.pending = [];
    this.save();
  }

  /** Items in the stash that are not on their way out, by page. */
  stashPage(page: number): InvItem[] {
    const out = new Set(this.pending.filter((m) => m.dir === 'out').map((m) => m.uid));
    return (this.profile?.stash[page] ?? []).filter((i) => !out.has(i.item.uid));
  }

  /** A stash item goes into the game (by a stashOut or equip command the caller issues). */
  sendOut(item: Item, tick: number): void {
    this.pending.push({ uid: item.uid, since: tick, dir: 'out', item });
  }

  /** A game item goes into the stash (by a stashIn or unequip command), at a spot if one is chosen. */
  takeIn(item: Item, tick: number, page?: number, at?: { x: number; y: number }): void {
    this.pending.push({ uid: item.uid, since: tick, dir: 'in', item, page, at });
  }

  /** Moves an item within the stash: the profile's own, no command needed. */
  moveInStash(uid: string, page: number, at: { x: number; y: number }): boolean {
    const p = this.profile;
    if (!p) return false;
    const from = p.stash.findIndex((pg) => pg.some((i) => i.item.uid === uid));
    if (from < 0) return false;
    const it = p.stash[from]!.find((i) => i.item.uid === uid)!;
    const target = (p.stash[page] ??= []);
    const others = target.filter((i) => i.item.uid !== uid);
    if (!fits(this.data, others, it.item, at.x, at.y)) return false;
    removeUid(p.stash[from]!, uid);
    target.push({ item: it.item, x: at.x, y: at.y });
    this.save();
    return true;
  }

  /**
   * The inventory as the sim will take it: items where they are when they fit, else in the
   * first free spot, else into the stash. The sim drops what overlaps, so nothing is sent
   * that it would refuse.
   */
  private laidOut(items: readonly InvItem[]): InvItem[] {
    const out: InvItem[] = [];
    const fitsInv = (item: Item, x: number, y: number) => {
      const b = this.data.bases[item.code];
      const w = b?.width ?? 1;
      const h = b?.height ?? 1;
      if (x < 0 || y < 0 || x + w > INV_W || y + h > INV_H) return false;
      return !out.some((g) => {
        const gb = this.data.bases[g.item.code];
        return x < g.x + (gb?.width ?? 1) && g.x < x + w && y < g.y + (gb?.height ?? 1) && g.y < y + h;
      });
    };
    for (const i of items) {
      if (fitsInv(i.item, i.x, i.y)) out.push(i);
      else {
        const spot = freeIn(this.data, out, i.item, INV_W, INV_H);
        if (spot) out.push({ item: i.item, ...spot });
        else this.putInStash(i.item);
      }
    }
    return out;
  }

  private putInStash(item: Item, page?: number, at?: { x: number; y: number }): void {
    const p = this.profile!;
    if (p.stash.some((pg) => pg.some((i) => i.item.uid === item.uid))) return;
    if (page !== undefined && at) {
      const target = (p.stash[page] ??= []);
      if (fits(this.data, target, item, at.x, at.y)) return void target.push({ item, x: at.x, y: at.y });
    }
    for (const pg of p.stash) {
      const spot = freeIn(this.data, pg, item, STASH_W, STASH_H);
      if (spot) return void pg.push({ item, ...spot });
    }
    p.stash.push([{ item, x: 0, y: 0 }]);
  }

  private save(): void {
    if (!this.profile) return;
    const json = JSON.stringify(this.profile);
    if (json === this.savedJson) return;
    this.savedJson = json;
    void saveProfile(this.launcher, this.profile);
  }
}

/** Everything a player has in the sim: inventory and what their towers wear. */
export function holdings(sim: Sim, seat: number): Item[] {
  return [...(sim.state.inventories[seat] ?? []).map((i) => i.item), ...sim.state.towers.filter((t) => t.owner === seat).flatMap((t) => Object.values(t.gear ?? {}))];
}

function removeUid(grid: InvItem[], uid: string): void {
  const k = grid.findIndex((i) => i.item.uid === uid);
  if (k >= 0) grid.splice(k, 1);
}

function fits(data: ItemData, grid: readonly InvItem[], item: Item, x: number, y: number): boolean {
  const b = data.bases[item.code];
  const w = b?.width ?? 1;
  const h = b?.height ?? 1;
  if (x < 0 || y < 0 || x + w > STASH_W || y + h > STASH_H) return false;
  return !grid.some((g) => {
    const gb = data.bases[g.item.code];
    return x < g.x + (gb?.width ?? 1) && g.x < x + w && y < g.y + (gb?.height ?? 1) && g.y < y + h;
  });
}
