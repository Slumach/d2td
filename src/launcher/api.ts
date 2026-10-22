// The bridge between the Electron main process and the renderer, exposed by the preload
// script as window.d2td. Types only, so both sides compile against the same contract.
// In a plain browser (npm run dev) window.d2td is undefined and the game starts directly.

import type { ClientMessage, HostMessage } from '../net/protocol.ts';

export interface LauncherState {
  /** The D2R folder in settings, or null before first setup. */
  d2rPath: string | null;
  /** What the registry says, for the setup screen's default. */
  detectedPath: string | null;
  /** True when the extracted files exist and match their checksum list. */
  setupOk: boolean;
  /** Files that are missing or failed the checksum, when setupOk is false. */
  bad: string[];
  volume: number;
  version: string;
  /** Set when launched with --smoke=<file>: run setup and wave 1 unattended. */
  smoke: boolean;
  /** Where the launcher writes its log, to show when something fails. */
  logFile: string;
  /** The player's name in multiplayer lobbies. */
  name: string;
  /** The loot filter from Options (src/sim/state.ts LootFilter). */
  lootFilter: 'default' | 'all';
}

/** A code a friend types to join, and which network it works on. */
export interface JoinCode {
  label: string;
  code: string;
}

/**
 * How opening the game to the internet went, once it is known: through the relay server
 * (via 'relay'), or by asking the router to open the game port. 'trying' again when the
 * relay server is lost and the router is asked instead.
 */
export type UpnpStatus = { state: 'ok'; code: JoinCode; via?: 'relay' } | { state: 'failed' } | { state: 'doubleNat' } | { state: 'trying' };

export type MpEvent =
  | { kind: 'message'; message: HostMessage }
  | { kind: 'closed'; reason: string }
  | { kind: 'upnp'; status: UpnpStatus };

export interface SetupProgress {
  done: number;
  total: number;
  file: string;
}

export interface SetupResult {
  ok: boolean;
  error?: string;
  files: number;
}

export interface SmokeResult {
  setup: SetupResult;
  wave: number;
  kills: number;
  /** The alive weight on the ring when the smoke test stopped. */
  alive: number;
  waveCleared: boolean;
  error?: string;
}

export interface LauncherApi {
  getState(): Promise<LauncherState>;
  /** Opens a folder picker; returns the chosen D2R folder if it looks like an install. */
  pickFolder(): Promise<{ path: string | null; error?: string }>;
  setD2rPath(path: string): Promise<{ ok: boolean; error?: string }>;
  runSetup(): Promise<SetupResult>;
  /** Opens the folder holding the log in Explorer. */
  openLogFolder(): Promise<void>;
  onSetupProgress(callback: (p: SetupProgress) => void): void;
  setVolume(volume: number): Promise<void>;
  reportSmoke(result: SmokeResult): void;
  setName(name: string): Promise<void>;
  setLootFilter(mode: 'default' | 'all'): Promise<void>;
  /** Closes the app (the main menu's Exit). */
  quit(): void;
  /** Opens a lobby on this PC and joins it; codes for friends on the local network come back at once. */
  mpHost(): Promise<{ ok: boolean; error?: string; codes: JoinCode[] }>;
  mpJoin(code: string): Promise<{ ok: boolean; error?: string }>;
  mpSend(message: ClientMessage): void;
  mpLeave(): Promise<void>;
  /** Multiplayer events from the main process. Register once. */
  onMp(callback: (e: MpEvent) => void): void;
  /** The checkpoint in a save slot (single player, or the host's multiplayer game) as JSON, or null. */
  loadCheckpoint(slot: SaveSlot): Promise<string | null>;
  saveCheckpoint(slot: SaveSlot, json: string): Promise<void>;
  clearCheckpoint(slot: SaveSlot): Promise<void>;
  /** The player's profile (inventory, stash) as JSON, or null before the first save. */
  loadProfile(): Promise<string | null>;
  saveProfile(json: string): Promise<void>;
  /** Updates: asks the feed, downloads the newer version, installs it on restart. */
  updateCheck(): Promise<UpdateCheck>;
  updateDownload(): Promise<{ ok: boolean; error?: string }>;
  updateInstall(): void;
  /** Download progress and completion. Register once. */
  onUpdate(callback: (e: UpdateEvent) => void): void;
}

/** Single player's save, and the host's multiplayer save. */
export type SaveSlot = 'solo' | 'mp';

/** What the update feed says: this is the newest, or a newer version with its notes, or no answer. */
export type UpdateCheck =
  | { state: 'current'; version: string }
  | { state: 'available'; version: string; notes: string }
  | { state: 'unavailable'; message: string };

export type UpdateEvent = { kind: 'progress'; percent: number } | { kind: 'downloaded'; version: string } | { kind: 'error'; message: string };

declare global {
  interface Window {
    d2td?: LauncherApi;
  }
}
