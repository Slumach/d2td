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
}

/** A code a friend types to join, and which network it works on. */
export interface JoinCode {
  label: string;
  code: string;
}

/** How asking the router to open the game port went, once it is known. */
export type UpnpStatus = { state: 'ok'; code: JoinCode } | { state: 'failed' } | { state: 'doubleNat' };

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
  lives: number;
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
  /** Opens a lobby on this PC and joins it; codes for friends on the local network come back at once. */
  mpHost(): Promise<{ ok: boolean; error?: string; codes: JoinCode[] }>;
  mpJoin(code: string): Promise<{ ok: boolean; error?: string }>;
  mpSend(message: ClientMessage): void;
  mpLeave(): Promise<void>;
  /** Multiplayer events from the main process. Register once. */
  onMp(callback: (e: MpEvent) => void): void;
}

declare global {
  interface Window {
    d2td?: LauncherApi;
  }
}
