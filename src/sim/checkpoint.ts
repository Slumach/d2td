// Checkpoints: a run saved at an act boundary (the tick a new act's first wave starts), so
// a player can Continue from the main menu. A checkpoint is the seed, every command so far
// and a snapshot of the whole match; the snapshot is what a Continue restores (the state is
// plain data, so a deep copy is exact), and the log keeps the run replayable from the seed.
// In multiplayer the host saves, and its lobby can start the same players from it.

import type { GameData } from './data.ts';
import { createMatch, type Match, type MatchMode, type MatchState, type PlayerCommand } from './match.ts';
import type { SimState } from './state.ts';

export const CHECKPOINT_VERSION = 7;

export interface TimedPlayerCommand extends PlayerCommand {
  tick: number;
}

export interface Checkpoint {
  version: number;
  mode: MatchMode;
  players: number;
  seed: number;
  /** Where it was saved: the stage whose first wave had just started, and the tick. */
  difficulty: number;
  act: number;
  tick: number;
  log: TimedPlayerCommand[];
  match: MatchState;
  zones: SimState[];
}

const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The match as it stands, with its seed and command log. */
export function takeCheckpoint(match: Match, seed: number, log: readonly TimedPlayerCommand[], ring = 0): Checkpoint {
  const sim = match.zones[ring]!;
  const wave = sim.data.waves[Math.max(0, sim.state.wave - 1)];
  return {
    version: CHECKPOINT_VERSION,
    mode: match.state.mode,
    players: match.players,
    seed,
    difficulty: wave?.difficulty ?? 0,
    act: wave?.act ?? 1,
    tick: match.state.tick,
    log: copy([...log]),
    match: { ...copy(match.state), trades: [] },
    zones: copy(match.zones.map((z) => z.state)).map(withoutItems),
  };
}

/**
 * A ring's state with its items taken out: towers unequipped, inventories and the ground
 * empty. Items live in the players' profiles (they went home when the game was left), so a
 * Continue starts with bare towers and each player's inventory loads from their profile.
 */
function withoutItems(state: SimState): SimState {
  return {
    ...state,
    towers: state.towers.map(({ gear: _gear, ...t }) => t),
    drops: [],
    inventories: state.inventories.map(() => []),
    homeward: state.homeward.map(() => []),
    belts: state.belts.map(() => [null, null, null, null]),
    lootFilters: state.lootFilters.map(() => 'default' as const),
  };
}

/** A match built afresh and set to the checkpoint's state, ready to step on from its tick. */
export function restoreMatch(data: GameData, cp: Checkpoint): Match {
  if (cp.version !== CHECKPOINT_VERSION) throw new Error(`This save is from another version of the game (${cp.version})`);
  const match = createMatch(data, cp.seed, cp.mode, cp.players);
  if (match.zones.length !== cp.zones.length) throw new Error('This save does not fit its mode and players');
  match.state = copy(cp.match);
  match.zones.forEach((z, i) => (z.state = copy(cp.zones[i]!)));
  return match;
}

/** True on the tick a ring started the first wave of a new act (not the run's first). */
export function actJustStarted(match: Match, ring: number, before: number): boolean {
  const sim = match.zones[ring]!;
  const now = sim.state.wave;
  if (now === before || now < 2) return false;
  return sim.data.waves[now - 1]?.actWave === 1;
}
