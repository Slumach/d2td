// The Secret Cow Level. A player right-clicks Wirt's Leg (a cowPortal command): one leg is
// used up, a red portal opens at their spawn, and the campaign's wave timer hands over to
// three cow waves: Moo Moo Farm's Hell Bovines in large packs, the Cow King leading the
// third with his pack. Cows weigh 1 each on the alive count, whatever their rank, and drop
// runes five times as often. The campaign resumes on the timer after the third cow wave,
// at the scaling it had (a cow walks at the run's current level when that is above its
// own); the portal closes when the last cow is dead. Every cow comes out of the portal at
// the opener's spawn: their own arc in multiplayer, the first arc alone.

import type { MonsterMod, Sim } from './state.ts';

export interface CowState {
  /** The player who opened the portal (their seat on the ring). */
  opener: number;
  /** Cow waves started so far, and cows still queued or alive. */
  started: number;
  remaining: number;
  /** The level the cows walk at. */
  level: number;
  /** The campaign wave whose scaling the cows carry. */
  wave: number;
}

const HELL = 2;

/** Opens the portal with one Wirt's Leg from the player's inventory. Refused while a cow level is open. */
export function openCowPortal(sim: Sim, player: number, uid: string): void {
  const s = sim.state;
  const inv = s.inventories[player];
  const k = inv?.findIndex((i) => i.item.uid === uid) ?? -1;
  if (!inv || k < 0 || s.cow || s.status !== 'playing') return;
  const at = inv[k]!;
  if (sim.data.items.bases[at.item.code]?.consumable !== 'cowPortal') return;
  if ((at.item.quantity ?? 1) > 1) at.item = { ...at.item, quantity: at.item.quantity! - 1 };
  else inv.splice(k, 1);
  const c = sim.data.cow;
  const wave = Math.max(0, s.wave - 1);
  const cowLevel = sim.data.monsters[sim.data.monsterVariant(c.monster, HELL)]!.level;
  // The wave it carries is already built: it has started (endless waves are built as reached)
  s.cow = { opener: player, started: 0, remaining: 0, level: Math.max(cowLevel, sim.data.waves[wave]?.level ?? 0), wave };
  s.nextWaveTick = s.tick + c.portalTicks;
}

/** True while the cow level holds the wave timer: its three waves are not all out yet. */
export function cowWavesDue(sim: Sim): boolean {
  const cow = sim.state.cow;
  return cow !== undefined && cow.started < sim.data.cow.waves;
}

/** The next cow wave: packs of Hell Bovines, the Cow King and his pack leading the last one. */
export function startCowWave(sim: Sim): void {
  const s = sim.state;
  const cow = s.cow!;
  const c = sim.data.cow;
  const cowDef = sim.data.monsterVariant(c.monster, HELL, cow.level);
  const packs: { monster: string; count: number; rank: 'normal' | 'unique'; mods: MonsterMod[] }[] = [];
  if (cow.started === c.waves - 1) {
    // The Cow King: a superunique at the cows' level, his own pack walking just behind him
    const king = sim.data.monsters[sim.data.monsterVariant(c.king, HELL, cow.level)]!;
    packs.push({ monster: king.id, count: 1, rank: 'unique', mods: [...king.mods] });
    if (king.minion) packs.push({ monster: sim.data.monsterVariant(king.minion.monster, HELL, cow.level), count: king.minion.count, rank: 'normal', mods: [] });
  }
  for (let p = 0; p < c.packs; p++) packs.push({ monster: cowDef, count: c.packSize, rank: 'normal', mods: [] });
  let offset = 1;
  let count = 0;
  packs.forEach((pack) => {
    // Every cow comes out of the portal, at the opener's spawn: their arc in multiplayer,
    // the first arc alone
    const dist = sim.map.arcs[arcOfSeat(sim, cow.opener)]!.spawn;
    for (let i = 0; i < pack.count; i++) {
      s.spawns.push({ tick: s.tick + offset, def: pack.monster, wave: cow.wave, rank: pack.rank, mods: [...pack.mods], dist, cow: true });
      offset += c.packSpacingTicks;
      count++;
    }
    offset += c.packGapTicks;
  });
  s.spawns.sort((a, b) => a.tick - b.tick);
  cow.remaining += count;
  cow.started++;
  s.nextWaveTick = s.tick + sim.data.economy.waveTicks;
}

/** The first arc a seat owns: where the portal opens. */
export function arcOfSeat(sim: Sim, seat: number): number {
  return Math.max(0, sim.arcOwners.indexOf(seat));
}

/** A cow is gone: the portal closes with the last one of the last wave. */
export function cowGone(sim: Sim): void {
  const cow = sim.state.cow;
  if (!cow) return;
  cow.remaining--;
  if (cow.started >= sim.data.cow.waves && cow.remaining <= 0) sim.state.cow = undefined;
}
