// A match: the rings the players defend, stepped together, plus the rules that tie them
// into a game. Every client runs the same match from the same seed and the same per-tick
// command lists, so the match is deterministic exactly as each ring is.
//
//   solo  one ring, one player who owns all of it
//   team  one shared ring, an arc per player: one alive count, kill gold to the killer
//   ffa   a ring per player from the same seed; each ring keeps its own alive count, and
//         the last ring standing wins
//
// Waves run on each ring's own timer (sim.ts). Send Next Wave starts a ring's next wave
// early: on a team ring any player may press it, in FFA it is your own ring.

import type { GameData } from './data.ts';
import { hashValue } from './hash.ts';
import { ARC_COUNT } from './map.ts';
import { createSim, step } from './sim.ts';
import type { Command, Sim } from './state.ts';

export type MatchMode = 'solo' | 'ffa' | 'team';
export const MATCH_MODES: readonly MatchMode[] = ['solo', 'ffa', 'team'];
export const MAX_PLAYERS = 6;
/** A team shares one ring: an arc each. */
export const MAX_TEAM_PLAYERS = ARC_COUNT;

/** A player's command for this tick. `player` is the lobby slot. */
export interface PlayerCommand {
  player: number;
  command: Command;
}

export interface MatchState {
  tick: number;
  mode: MatchMode;
  status: 'playing' | 'over';
  /** Players who won, once the match is over. Empty means everyone lost. */
  winners: number[];
}

export interface Match {
  readonly data: GameData;
  /** The rings: one in solo and team, one per player in ffa. */
  readonly zones: Sim[];
  readonly players: number;
  state: MatchState;
}

export function createMatch(data: GameData, seed: number, mode: MatchMode, players: number): Match {
  if (players < 1 || players > MAX_PLAYERS) throw new Error(`A match takes 1 to ${MAX_PLAYERS} players, not ${players}`);
  if (mode === 'solo' && players !== 1) throw new Error('Solo is one player');
  if (mode === 'team' && players > MAX_TEAM_PLAYERS) throw new Error(`A team ring takes up to ${MAX_TEAM_PLAYERS} players`);
  // FFA rings are identical, so they share the seed
  const zones = mode === 'ffa' ? Array.from({ length: players }, () => createSim(data, seed)) : [createSim(data, seed, { players })];
  return {
    data,
    zones,
    players,
    state: { tick: 0, mode, status: 'playing', winners: [] },
  };
}

/** The ring a player defends. */
export function ringOf(match: Match, player: number): number {
  return match.state.mode === 'ffa' ? player : 0;
}

/** Who a player is on their ring: their slot on a shared team ring, else the ring's only player. */
export function seatOf(match: Match, player: number): number {
  return match.state.mode === 'team' ? player : 0;
}

/** The player defending an arc of a ring. */
export function arcOwner(match: Match, ring: number, arc: number): number {
  return match.state.mode === 'team' ? match.zones[0]!.arcOwners[arc]! : ring;
}

/** Players whose own ring is still going. */
export function playersIn(match: Match): number[] {
  return Array.from({ length: match.players }, (_, p) => p).filter((p) => match.zones[ringOf(match, p)]!.state.status !== 'lost');
}

/** The alive weight on a player's ring. */
export function aliveOf(match: Match, player: number): number {
  return match.zones[ringOf(match, player)]!.state.alive;
}

/** Advances every ring one tick. `commands` are this tick's, in the order the host relayed them. */
export function stepMatch(match: Match, commands: readonly PlayerCommand[]): void {
  const m = match.state;
  if (m.status === 'over') {
    m.tick++;
    return;
  }
  const perZone: Command[][] = match.zones.map(() => []);
  for (const { player, command } of commands) {
    if (player < 0 || player >= match.players) continue;
    perZone[ringOf(match, player)]!.push({ ...command, player: seatOf(match, player) });
  }

  match.zones.forEach((zone, i) => step(zone, perZone[i]!));
  checkOver(match);
  m.tick++;
}

function checkOver(match: Match): void {
  const m = match.state;
  const zones = match.zones;
  const all = Array.from({ length: match.players }, (_, p) => p);
  if (m.mode === 'ffa') {
    const alive = playersIn(match);
    const someonePlaying = zones.some((z) => z.state.status === 'playing');
    // With rivals, the last ring standing has won; alone, play the run out
    if ((zones.length > 1 && alive.length <= 1) || !someonePlaying) end(match, alive);
  } else {
    const s = zones[0]!.state;
    if (s.status !== 'playing') end(match, s.status === 'won' ? all : []);
  }
}

function end(match: Match, winners: number[]): void {
  match.state.status = 'over';
  match.state.winners = winners;
}

/** One number for the whole match, compared between clients every 100 ticks. */
export function matchHash(match: Match): number {
  return hashValue({ match: match.state, zones: match.zones.map((z) => z.state) }, 'match');
}
