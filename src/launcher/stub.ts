// A stand-in for the Electron side (electron/preload.ts) so the launcher's menus run in a
// plain browser (npm run dev, then ?menu): settings live for the page, saves in memory,
// multiplayer and the extraction are refused. For looking at the menus, not for playing.

import type { LauncherApi, LauncherState, SaveSlot } from './api.ts';

export function stubLauncher(): LauncherApi {
  const state: LauncherState = {
    d2rPath: null,
    detectedPath: null,
    setupOk: true,
    bad: [],
    volume: 50,
    version: 'dev',
    smoke: false,
    logFile: '',
    name: 'Player',
  };
  const saves = new Map<SaveSlot, string>();
  return {
    getState: () => Promise.resolve({ ...state }),
    pickFolder: () => Promise.resolve({ path: null }),
    setD2rPath: () => Promise.resolve({ ok: false, error: 'Not in the browser' }),
    runSetup: () => Promise.reject(new Error('Not in the browser')),
    openLogFolder: () => Promise.resolve(),
    onSetupProgress: () => undefined,
    setVolume: (volume) => {
      state.volume = volume;
      return Promise.resolve();
    },
    reportSmoke: () => undefined,
    setName: (name) => {
      state.name = name;
      return Promise.resolve();
    },
    quit: () => window.close(),
    mpHost: () => Promise.resolve({ ok: false, error: 'Not in the browser', codes: [] }),
    mpJoin: () => Promise.resolve({ ok: false, error: 'Not in the browser' }),
    mpSend: () => undefined,
    mpLeave: () => Promise.resolve(),
    onMp: () => undefined,
    loadCheckpoint: (slot) => Promise.resolve(saves.get(slot) ?? null),
    saveCheckpoint: (slot, json) => {
      saves.set(slot, json);
      return Promise.resolve();
    },
    clearCheckpoint: (slot) => {
      saves.delete(slot);
      return Promise.resolve();
    },
    loadProfile: () => Promise.resolve(localStorage.getItem('d2td:profile')),
    saveProfile: (json) => {
      localStorage.setItem('d2td:profile', json);
      return Promise.resolve();
    },
    updateCheck: () => Promise.resolve({ state: 'unavailable', message: 'Updates work in the installed game' }),
    updateDownload: () => Promise.resolve({ ok: false, error: 'Not in the browser' }),
    updateInstall: () => undefined,
    onUpdate: () => undefined,
  };
}
