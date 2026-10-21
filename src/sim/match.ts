// A match: one zone sim per player, stepped together, plus the rules that tie them into a
// game. Every client runs the same match from the same seed and the same per-tick command
// lists, so the match is deterministic exactly as each sim is.
//
//   solo  one zone, Call Wave calls the wave at once (the single-player game)
//   ffa   identical lanes from the same seed; each player loses their own lives; the last
//         player standing wins
//   team  zones chained in player order on one path: monsters spawn in zone 1, a leak
//         walks into the next zone, and only a leak past the last zone costs the shared lives
//
// In ffa and team, waves run on a match-wide clock: the next wave starts in every lane
// together when every player still in has pressed Call Wave, or when the clock runs out.

import type { GameData } from './data.ts';
import { hashValue } from './hash.ts';
import { createSim, injectMonster, step } from './sim.ts';
import type { Command, Sim } from './state.ts';

export type MatchMode = 'solo' | 'ffa' | 'team';
export const MATCH_MODES: readonly MatchMode[] = ['solo', 'ffa', 'team'];
export const MAX_PLAYERS = 6;

/** A player's command for this tick. `player` is the zone index, which is the lobby slot. */
export interface PlayerCommand {
  player: number;
  command: Command;
}

export interface MatchState {
  tick: number;
  mode: MatchMode;
  status: 'playing' | 'over';
  /** Waves started so far on the match clock (ffa and team). */
  wavesCalled: number;
  /** The tick the next wave starts if not everyone is ready first; -1 in solo. */
  nextWaveTick: number;
  /** Who has pressed Call Wave for the next wave, by player. */
  ready: boolean[];
  /** Players who won, once the match is over. Empty means everyone lost. */
  winners: number[];
}

export interface Match {
  readonly data: GameData;
  readonly zones: Sim[];
  state: MatchState;
}

export function createMatch(data: GameData, seed: number, mode: MatchMode, players: number): Match {
  if (players < 1 || players > MAX_PLAYERS) throw new Error(`A match takes 1 to ${MAX_PLAYERS} players, not ${players}`);
  if (mode === 'solo' && players !== 1) throw new Error('Solo is one player');
  const zones = Array.from({ length: players }, (_, i) =>
    // FFA lanes are identical, so they share the seed; team zones are parts of one map
    createSim(data, mode === 'team' ? seed + i : seed, { passLeaks: mode === 'team' && i < players - 1 }),
  );
  return {
    data,
    zones,
    state: {
      tick: 0,
      mode,
      status: 'playing',
      wavesCalled: 0,
      nextWaveTick: mode === 'solo' ? -1 : data.economy.firstWaveTicks,
      ready: Array.from({ length: players }, () => false),
      winners: [],
    },
  };
}

/** Players whose own run is still going. In team mode that is everyone until the end. */
export function playersIn(match: Match): number[] {
  if (match.state.mode === 'team') return match.zones.map((_, i) => i);
  return match.zones.flatMap((z, i) => (z.state.status === 'lost' ? [] : [i]));
}

/** Lives that count for `player`: their own, or the team's (the last zone's). */
export function livesOf(match: Match, player: number): number {
  const zone = match.state.mode === 'team' ? match.zones.at(-1)! : match.zones[player]!;
  return zone.state.lives;
}

/** Advances every zone one tick. `commands` are this tick's, in the order the host relayed them. */
export function stepMatch(match: Match, commands: readonly PlayerCommand[]): void {
  const m = match.state;
  if (m.status === 'over') {
    m.tick++;
    return;
  }
  const perZone: Command[][] = match.zones.map(() => []);
  for (const { player, command } of commands) {
    if (!perZone[player]) continue;
    if (command.type === 'callWave' && m.mode !== 'solo') m.ready[player] = true;
    else perZone[player]!.push(command);
  }
  if (m.mode !== 'solo') clock(match, perZone);

  match.zones.forEach((zone, i) => step(zone, perZone[i]!));
  if (m.mode === 'team') {
    // Leaks enter the next zone at the start of its path on the next tick
    for (let i = 0; i < match.zones.length - 1; i++) {
      const from = match.zones[i]!.state;
      for (const p of from.passed) injectMonster(match.zones[i + 1]!, p);
      from.passed = [];
    }
  }
  checkOver(match);
  m.tick++;
}

/** Starts the next wave when everyone in is ready or the clock runs out. */
function clock(match: Match, perZone: Command[][]): void {
  const m = match.state;
  if (m.wavesCalled >= match.data.waves.length) return;
  const waiting = playersIn(match);
  const allReady = waiting.length > 0 && waiting.every((p) => m.ready[p]);
  if (!allReady && m.tick < m.nextWaveTick) return;
  const lanes = m.mode === 'team' ? [0] : waiting;
  for (const lane of lanes) perZone[lane]!.push({ type: 'callWave' });
  m.wavesCalled++;
  m.nextWaveTick = m.tick + match.data.economy.waveGapTicks;
  m.ready = m.ready.map(() => false);
}

function checkOver(match: Match): void {
  const m = match.state;
  const zones = match.zones;
  if (m.mode === 'solo') {
    const s = zones[0]!.state;
    if (s.status !== 'playing') end(match, s.status === 'won' ? [0] : []);
  } else if (m.mode === 'ffa') {
    const alive = playersIn(match);
    const someonePlaying = zones.some((z) => z.state.status === 'playing');
    // With rivals, the last one standing has won; alone, play the run out
    if ((zones.length > 1 && alive.length <= 1) || !someonePlaying) end(match, alive);
  } else {
    if (zones.at(-1)!.state.status === 'lost') end(match, []);
    else if (m.wavesCalled >= match.data.waves.length && zones.every(empty)) end(match, zones.map((_, i) => i));
  }
}

function empty(zone: Sim): boolean {
  const s = zone.state;
  return s.monsters.length === 0 && s.spawns.length === 0 && s.passed.length === 0;
}

function end(match: Match, winners: number[]): void {
  match.state.status = 'over';
  match.state.winners = winners;
}

/** One number for the whole match, compared between clients every 100 ticks. */
export function matchHash(match: Match): number {
  return hashValue({ match: match.state, zones: match.zones.map((z) => z.state) }, 'match');
}
