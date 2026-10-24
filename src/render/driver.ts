// What moves the match forward for GameScene. Locally that is the frame clock; online it
// is the relay's tick bundles, so every player runs the same ticks with the same commands.

import { restoreMatch, type Checkpoint, type TimedPlayerCommand } from '../sim/checkpoint.ts';
import type { GameData } from '../sim/data.ts';
import { createMatch, stepMatch, type BattleSetup, type Match } from '../sim/match.ts';
import { TICKS_PER_SECOND } from '../sim/fixed.ts';
import type { Command } from '../sim/state.ts';
import type { Lockstep } from '../net/lockstep.ts';
import type { LobbyPlayer } from '../net/protocol.ts';

const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Do not let a stalled tab replay minutes of ticks in one frame. */
const MAX_TICKS_PER_FRAME = 10;

export interface Driver {
  readonly match: Match;
  /** This player's slot. */
  readonly me: number;
  readonly online: boolean;
  /** Every command run so far, by tick: a checkpoint keeps it. */
  readonly log: readonly TimedPlayerCommand[];
  readonly players: LobbyPlayer[];
  /** Runs the ticks due this frame, calling onTick after each. */
  advance(deltaMs: number, speed: number, onTick: () => void): void;
  issue(command: Command): void;
}

/** A battle against the match's own bots: the mode, and the lobby's setup (slot 0 is the player). */
export interface LocalBattle {
  mode: 'battle' | 'coop';
  setup: BattleSetup;
}

/** Single player: a solo match on the frame clock. Commands run on the next tick. */
export class LocalDriver implements Driver {
  readonly match: Match;
  readonly me = 0;
  readonly online = false;
  readonly players: LobbyPlayer[] = [{ slot: 0, name: 'You' }];
  readonly log: TimedPlayerCommand[];
  private pending: Command[] = [];
  private accumulator = 0;

  /** A fresh solo run, one carried on from a checkpoint, or a battle against bots. */
  constructor(data: GameData, seed: number, resume?: Checkpoint, battle?: LocalBattle) {
    if (battle) {
      const teams = battle.mode === 'battle' ? 2 : 1;
      const slots = battle.setup.teamSize * teams;
      this.match = createMatch(data, seed, battle.mode, slots, battle.setup);
      this.players = Array.from({ length: slots }, (_, p) => ({ slot: p, name: p === 0 ? 'You' : `Bot ${p}` }));
    } else this.match = resume ? restoreMatch(data, resume) : createMatch(data, seed, 'solo', 1);
    this.log = resume ? [...resume.log] : [];
  }

  advance(deltaMs: number, speed: number, onTick: () => void): void {
    this.accumulator = Math.min(this.accumulator + deltaMs * speed, TICK_MS * MAX_TICKS_PER_FRAME * speed);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      const commands = this.pending.map((command) => ({ player: 0, command }));
      this.pending = [];
      for (const c of commands) this.log.push({ tick: this.match.state.tick, ...c });
      stepMatch(this.match, commands);
      onTick();
    }
  }

  issue(command: Command): void {
    this.pending.push(command);
  }
}

/** Online: ticks run only once their bundle has arrived; a player who fell behind catches up. */
export class NetDriver implements Driver {
  readonly online = true;
  private accumulator = 0;

  constructor(
    private readonly lockstep: Lockstep,
    readonly players: LobbyPlayer[],
  ) {}

  get match(): Match {
    return this.lockstep.match;
  }

  get me(): number {
    return this.lockstep.me;
  }

  get log(): readonly TimedPlayerCommand[] {
    return this.lockstep.log;
  }

  advance(deltaMs: number, _speed: number, onTick: () => void): void {
    this.accumulator += deltaMs;
    let due = Math.floor(this.accumulator / TICK_MS);
    // More than a few bundles waiting means we are late (loading, a hitch): run them faster
    const behind = this.lockstep.behind;
    if (behind > 3) due = Math.max(due, behind - 2);
    const ran = this.lockstep.advance(Math.min(due, MAX_TICKS_PER_FRAME), onTick);
    this.accumulator -= ran * TICK_MS;
    // Waiting on the network builds no debt, so the game does not lurch when bundles resume
    this.accumulator = Math.max(0, Math.min(this.accumulator, TICK_MS * 2));
  }

  issue(command: Command): void {
    this.lockstep.issue(command);
  }
}
