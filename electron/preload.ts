// Preload: exposes the launcher API to the sandboxed renderer as window.d2td.

import { contextBridge, ipcRenderer } from 'electron';

import type { LauncherApi, MpEvent, SaveSlot, SetupProgress, SmokeResult } from '../src/launcher/api.ts';
import type { ClientMessage } from '../src/net/protocol.ts';

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
  setName: (name: string) => ipcRenderer.invoke('set-name', name),
  quit: () => ipcRenderer.send('quit'),
  mpHost: () => ipcRenderer.invoke('mp-host'),
  mpJoin: (code: string) => ipcRenderer.invoke('mp-join', code),
  mpSend: (message: ClientMessage) => ipcRenderer.send('mp-send', message),
  mpLeave: () => ipcRenderer.invoke('mp-leave'),
  onMp: (callback: (e: MpEvent) => void) => {
    ipcRenderer.on('mp-event', (_e, event: MpEvent) => callback(event));
  },
  loadCheckpoint: (slot: SaveSlot) => ipcRenderer.invoke('load-checkpoint', slot),
  saveCheckpoint: (slot: SaveSlot, json: string) => ipcRenderer.invoke('save-checkpoint', slot, json),
  clearCheckpoint: (slot: SaveSlot) => ipcRenderer.invoke('clear-checkpoint', slot),
};

contextBridge.exposeInMainWorld('d2td', api);
