// The bridge between the Electron main process and the renderer, exposed by the preload
// script as window.d2td. Types only, so both sides compile against the same contract.
// In a plain browser (npm run dev) window.d2td is undefined and the game starts directly.

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
}

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
}

declare global {
  interface Window {
    d2td?: LauncherApi;
  }
}
