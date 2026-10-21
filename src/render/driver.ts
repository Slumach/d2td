// What moves the match forward for GameScene. Locally that is the frame clock; online it
// is the relay's tick bundles, so every player runs the same ticks with the same commands.

import type { GameData } from '../sim/data.ts';
import { createMatch, stepMatch, type Match } from '../sim/match.ts';
import { TICKS_PER_SECOND } from '../sim/fixed.ts';
import type { Command } from '../sim/state.ts';
import type { Lockstep } from '../net/lockstep.ts';
import type { LobbyPlayer } from '../net/protocol.ts';

const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Do not let a stalled tab replay minutes of ticks in one frame. */
const MAX_TICKS_PER_FRAME = 10;

export interface Driver {
  readonly match: Match;
  /** This player's zone. */
  readonly me: number;
  readonly online: boolean;
  readonly players: LobbyPlayer[];
  /** Runs the ticks due this frame, calling onTick after each. */
  advance(deltaMs: number, speed: number, onTick: () => void): void;
  issue(command: Command): void;
}

/** Single player: a solo match on the frame clock. Commands run on the next tick. */
export class LocalDriver implements Driver {
  readonly match: Match;
  readonly me = 0;
  readonly online = false;
  readonly players: LobbyPlayer[] = [{ slot: 0, name: 'You' }];
  private pending: Command[] = [];
  private accumulator = 0;

  constructor(data: GameData, seed: number) {
    this.match = createMatch(data, seed, 'solo', 1);
  }

  advance(deltaMs: number, speed: number, onTick: () => void): void {
    this.accumulator = Math.min(this.accumulator + deltaMs * speed, TICK_MS * MAX_TICKS_PER_FRAME * speed);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      const commands = this.pending;
      this.pending = [];
      stepMatch(
        this.match,
        commands.map((command) => ({ player: 0, command })),
      );
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
