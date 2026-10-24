// A player's side of lockstep: the match runs tick T only once the relay's bundle for T has
// arrived, and every player applies the same bundle at the same tick. Commands go out to
// the relay and come back stamped in a later bundle, the host's included, so no one's input
// is special. Transport is someone else's job: feed bundles in, send what onSend gives.

import { restoreMatch, type Checkpoint, type TimedPlayerCommand } from '../sim/checkpoint.ts';
import type { GameData } from '../sim/data.ts';
import { createMatch, matchHash, stepMatch, type BattleSetup, type Match, type MatchMode, type PlayerCommand } from '../sim/match.ts';
import type { Command } from '../sim/state.ts';
import { HASH_EVERY, type ClientMessage } from './protocol.ts';

export interface LockstepOptions {
  data: GameData;
  seed: number;
  mode: MatchMode;
  players: number;
  /** This player's slot. */
  me: number;
  send: (message: ClientMessage) => void;
  /** Carry on from the host's checkpoint instead of a fresh match. */
  resume?: Checkpoint;
  /** Battle and co-op: the lobby's teams, races and bots. */
  battle?: BattleSetup;
}

export class Lockstep {
  readonly match: Match;
  readonly me: number;
  private readonly send: (message: ClientMessage) => void;
  private readonly bundles = new Map<number, PlayerCommand[]>();
  /** Highest tick whose bundle has arrived. */
  private newest = -1;
  /** Every command run so far, for checkpoints. */
  readonly log: TimedPlayerCommand[];

  constructor(opts: LockstepOptions) {
    this.match = opts.resume ? restoreMatch(opts.data, opts.resume) : createMatch(opts.data, opts.seed, opts.mode, opts.players, opts.battle);
    this.log = opts.resume ? [...opts.resume.log] : [];
    this.me = opts.me;
    this.send = opts.send;
  }

  /** A bundle from the relay. They arrive in order; a duplicate or stale one is ignored. */
  receive(tick: number, cmds: PlayerCommand[]): void {
    if (tick < this.match.state.tick || this.bundles.has(tick)) return;
    this.bundles.set(tick, cmds);
    this.newest = Math.max(this.newest, tick);
  }

  /** Ticks received but not yet run: how far behind the relay this player is. */
  get behind(): number {
    return this.newest + 1 - this.match.state.tick;
  }

  /** Runs up to `max` ticks that have their bundle; returns how many ran. */
  advance(max: number, onTick?: () => void): number {
    let ran = 0;
    while (ran < max) {
      const tick = this.match.state.tick;
      const cmds = this.bundles.get(tick);
      if (!cmds) break;
      this.bundles.delete(tick);
      for (const c of cmds) this.log.push({ tick, ...c });
      stepMatch(this.match, cmds);
      ran++;
      onTick?.();
      const done = this.match.state.tick;
      if (done % HASH_EVERY === 0) this.send({ t: 'hash', tick: done, hash: matchHash(this.match) });
    }
    return ran;
  }

  /** A command from this player, sent to the relay to be stamped and bundled. */
  issue(command: Command): void {
    this.send({ t: 'cmd', command });
  }
}
