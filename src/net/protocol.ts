// The multiplayer wire protocol: one JSON object per line over TCP between each player and
// the host's relay. The relay never runs the game. It keeps the lobby, stamps every
// player's commands with the tick they run on, sends one bundle per tick to everyone, and
// compares the match hashes players report every HASH_EVERY ticks.
//
// The host's own game is a player like the rest: it connects to its relay over loopback.

import type { Command } from '../sim/state.ts';
import type { MatchMode, PlayerCommand } from '../sim/match.ts';

/** Bumped whenever a message changes shape; players on different protocols cannot join. */
export const PROTOCOL = 1;
export const DEFAULT_PORT = 47310;
/** Ticks between match hash reports. */
export const HASH_EVERY = 100;
/** The relay sends one bundle per sim tick, 20 per second. */
export const TICK_MS = 50;

export interface LobbyPlayer {
  slot: number;
  name: string;
}

/** Player to relay. */
export type ClientMessage =
  | {
      t: 'hello';
      protocol: number;
      version: string;
      /** Hash of the extracted tables; different game data would desync. */
      data: string;
      name: string;
      /** The relay's owner proves it is the host with the token the relay was started with. */
      token?: string;
    }
  | { t: 'mode'; mode: MatchMode }
  | { t: 'start' }
  | { t: 'cmd'; command: Command }
  | { t: 'hash'; tick: number; hash: number };

/** Relay to player. */
export type HostMessage =
  | { t: 'welcome'; you: number; host: boolean }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; players: LobbyPlayer[]; mode: MatchMode }
  | { t: 'start'; seed: number; mode: MatchMode; players: LobbyPlayer[]; you: number }
  | { t: 'tick'; tick: number; cmds: PlayerCommand[] }
  | { t: 'left'; slot: number; name: string }
  | { t: 'desync'; tick: number };

/** Lobby modes; solo is single-player only. */
export const LOBBY_MODES: readonly MatchMode[] = ['team', 'ffa'];
