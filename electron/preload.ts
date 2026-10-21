// Preload: exposes the launcher API to the sandboxed renderer as window.d2td.

import { contextBridge, ipcRenderer } from 'electron';

import type { LauncherApi, SetupProgress, SmokeResult } from '../src/launcher/api.ts';

const api: LauncherApi = {
  getState: () => ipcRenderer.invoke('get-state'),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  setD2rPath: (path: string) => ipcRenderer.invoke('set-d2r-path', path),
  runSetup: () => ipcRenderer.invoke('run-setup'),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
  onSetupProgress: (callback: (p: SetupProgress) => void) => {
    ipcRenderer.on('setup-progress', (_e, p: SetupProgress) => callback(p));
  },
  setVolume: (volume: number) => ipcRenderer.invoke('set-volume', volume),
  reportSmoke: (result: SmokeResult) => ipcRenderer.send('smoke-result', result),
};

contextBridge.exposeInMainWorld('d2td', api);
