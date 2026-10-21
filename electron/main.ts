// Electron main process: the window, the app:// protocol that serves the game and its
// extracted data, settings, and the setup step that runs the pipeline against D2R's CASC.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, app, dialog, ipcMain, net, protocol, screen, shell } from 'electron';

import type { JoinCode, LauncherState, MpEvent, SetupResult, SmokeResult } from '../src/launcher/api.ts';
import { decodeJoinCode, encodeJoinCode } from '../src/net/codes.ts';
import { DEFAULT_PORT, PROTOCOL, type ClientMessage } from '../src/net/protocol.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../src/render/layout.ts';
import { extractGame, verifyGame } from '../tools/extract/game.ts';
import { CascSource, type CascStorage } from '../tools/extract/source.ts';
import { detectD2R, looksLikeD2R } from '../tools/lib/d2r.ts';
import { describe, log, openLog } from './log.ts';
import { localAddresses } from './net/addresses.ts';
import { connectToRelay, type Connection } from './net/client.ts';
import { Relay } from './net/relay.ts';
import { openPort, type PortMapping } from './net/upnp.ts';

// A clean profile for tests and the smoke run: D2TD_USER_DATA=<folder>
if (process.env['D2TD_USER_DATA']) app.setPath('userData', process.env['D2TD_USER_DATA']);

const smokeArg = process.argv.find((a) => a.startsWith('--smoke='));
const smokeFile = smokeArg?.slice('--smoke='.length);

const logFile = openLog(app.getPath('userData'));
process.on('uncaughtException', (e) => log(`uncaught exception: ${describe(e)}`));
process.on('unhandledRejection', (e) => log(`unhandled rejection: ${describe(e)}`));

interface Settings {
  d2rPath: string | null;
  volume: number;
  name: string;
}

function defaultName(): string {
  try {
    return userInfo().username.slice(0, 20) || 'Player';
  } catch {
    return 'Player';
  }
}

const settingsPath = () => join(app.getPath('userData'), 'settings.json');
/** Extracted game files live here, never inside the app. */
const assetsDir = () => join(app.getPath('userData'), 'assets');
/** The built renderer (Vite output). */
const rendererDir = () => join(app.getAppPath(), 'dist');

function loadSettings(): Settings {
  const defaults: Settings = { d2rPath: null, volume: 80, name: defaultName() };
  try {
    return { ...defaults, ...JSON.parse(readFileSync(settingsPath(), 'utf8')) };
  } catch {
    return defaults;
  }
}

function saveSettings(s: Settings): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

let settings: Settings;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** A file under root, or null if the request tries to leave it. */
function inside(root: string, rel: string): string | null {
  const full = normalize(join(root, rel));
  const back = relative(root, full);
  return back.startsWith('..') || back.includes(`..${sep}`) ? null : full;
}

/** The only paths the built renderer owns: the page and Vite's bundled scripts. */
function isRendererPath(path: string): boolean {
  return path === 'index.html' || path.startsWith('assets/');
}

/**
 * app://game/... serves the renderer from dist. Every other request (tables, sprite
 * atlases, icons) comes from the extracted assets in userData, so no game file ships in
 * the app.
 */
function serveApp(): void {
  protocol.handle('app', (request) => {
    const path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = inside(isRendererPath(path) ? rendererDir() : assetsDir(), path);
    if (!file || !existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

// CascLib is a native module; require it at run time so the bundler leaves it alone
const requireNative = createRequire(__filename);
function openCasc(path: string): CascStorage {
  const { Storage } = requireNative('@jamiephan/casclib') as { Storage: { open(p: string): CascStorage } };
  return Storage.open(path);
}

async function launcherState(): Promise<LauncherState> {
  const verify = verifyGame(assetsDir());
  return {
    d2rPath: settings.d2rPath,
    detectedPath: await detectD2R(),
    setupOk: verify.ok,
    bad: verify.bad,
    volume: settings.volume,
    version: app.getVersion(),
    smoke: smokeFile !== undefined,
    logFile,
    name: settings.name,
  };
}

// ---- multiplayer: the relay when hosting, the router mapping, and this player's socket ----

let relay: Relay | undefined;
let mapping: PortMapping | undefined;
let connection: Connection | undefined;
/** Proves to our own relay that our game is its host. */
const hostToken = randomBytes(16).toString('hex');

/** Players must extract the same tables or their sims would desync; this names them. */
function dataHash(): string {
  try {
    const list = JSON.parse(readFileSync(join(assetsDir(), 'checksums.json'), 'utf8')) as { files: Record<string, string> };
    const tables = Object.entries(list.files)
      .filter(([path]) => path.startsWith('data/'))
      .sort(([a], [b]) => a.localeCompare(b));
    return createHash('sha256').update(JSON.stringify(tables)).digest('hex').slice(0, 16);
  } catch {
    return 'none';
  }
}

function joinRelay(win: BrowserWindow, ip: string, port: number, token?: string): void {
  connection?.close();
  const hello: Extract<ClientMessage, { t: 'hello' }> = { t: 'hello', protocol: PROTOCOL, version: app.getVersion(), data: dataHash(), name: settings.name, token };
  const send = (e: MpEvent) => !win.isDestroyed() && win.webContents.send('mp-event', e);
  log(`mp: connecting to ${ip}:${port}`);
  const conn = connectToRelay(
    ip,
    port,
    hello,
    (message) => {
      if (message.t === 'reject' || message.t === 'desync' || message.t === 'start') log(`mp: ${JSON.stringify(message).slice(0, 300)}`);
      send({ kind: 'message', message });
    },
    (reason) => {
      if (connection !== conn) return;
      connection = undefined;
      log(`mp: closed: ${reason}`);
      send({ kind: 'closed', reason });
    },
  );
  connection = conn;
}

async function leaveMultiplayer(): Promise<void> {
  const conn = connection;
  connection = undefined;
  conn?.close();
  relay?.close();
  relay = undefined;
  const m = mapping;
  mapping = undefined;
  await m?.close();
}

async function hostMultiplayer(win: BrowserWindow): Promise<{ ok: boolean; error?: string; codes: JoinCode[] }> {
  await leaveMultiplayer();
  const r = new Relay({ port: DEFAULT_PORT, token: hostToken, version: app.getVersion(), log });
  let port: number;
  try {
    port = await r.listen();
  } catch (e) {
    log(`mp: could not listen on ${DEFAULT_PORT}: ${describe(e)}`);
    return { ok: false, error: `Could not open the game port (${DEFAULT_PORT}). Close any other copy of the game that is hosting and try again.`, codes: [] };
  }
  relay = r;
  const codes = localAddresses().map((a) => ({ label: a.kind === 'tailscale' ? 'Tailscale' : 'Same network', code: encodeJoinCode({ ip: a.ip, port }) }));
  log(`mp: hosting on port ${port}; local codes ${codes.map((c) => `${c.label} ${c.code}`).join(', ')}`);
  joinRelay(win, '127.0.0.1', port, hostToken);
  // The router may take a few seconds or not answer at all; the lobby updates when it does
  void openPort(port, 'D2 Tower Defense', log).then((m) => {
    if (relay !== r) {
      void m?.close();
      return;
    }
    mapping = m ?? undefined;
    const status: MpEvent = !m
      ? { kind: 'upnp', status: { state: 'failed' } }
      : m.externalIp && !m.doubleNat
        ? { kind: 'upnp', status: { state: 'ok', code: { label: 'Internet', code: encodeJoinCode({ ip: m.externalIp, port }) } } }
        : { kind: 'upnp', status: { state: m.doubleNat ? 'doubleNat' : 'failed' } };
    if (!win.isDestroyed()) win.webContents.send('mp-event', status);
  });
  return { ok: true, codes };
}

async function runSetup(win: BrowserWindow): Promise<SetupResult> {
  const path = settings.d2rPath;
  if (!path || !looksLikeD2R(path)) return { ok: false, error: 'Choose your Diablo II: Resurrected folder first.', files: 0 };
  log(`setup: reading ${path} into ${assetsDir()}`);
  let source: CascSource | undefined;
  try {
    source = new CascSource(openCasc(path), path);
    // Start clean so stale files from an older game build cannot survive
    rmSync(assetsDir(), { recursive: true, force: true });
    const list = await extractGame(source, assetsDir(), (p) => {
      if (p.file) log(`setup: ${p.done + 1}/${p.total} ${p.file}`);
      win.webContents.send('setup-progress', p);
    });
    const verify = verifyGame(assetsDir());
    if (!verify.ok) {
      log(`setup: checksum failed for ${verify.bad.join(', ')}`);
      return { ok: false, error: 'Some files did not come out right. Try again; if it keeps failing, send the log.', files: 0 };
    }
    log(`setup: done, ${Object.keys(list.files).length} files`);
    return { ok: true, files: Object.keys(list.files).length };
  } catch (e) {
    // The details are for the log; the screen gets something a player can act on
    log(`setup failed: ${describe(e)}`);
    return {
      ok: false,
      error: 'Setup could not read the game files in that folder. Check that Diablo II: Resurrected is installed there and has been started once, then try again.',
      files: 0,
    };
  } finally {
    source?.close();
  }
}

function createWindow(): BrowserWindow {
  // The canvas at zoom 1 exactly, in screen pixels: Electron sizes windows in DIPs, so
  // divide by the display scale. The window can grow (zoom 2 at 4K) but never shrink below it.
  const scale = screen.getPrimaryDisplay().scaleFactor;
  const width = Math.ceil(GAME_WIDTH / scale);
  const height = Math.ceil(GAME_HEIGHT / scale);
  const win = new BrowserWindow({
    useContentSize: true,
    width,
    height,
    minWidth: width,
    minHeight: height,
    title: 'D2 Tower Defense',
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // An online game runs on the relay's clock; a covered or alt-tabbed window must keep up
      backgroundThrottling: false,
    },
  });
  // Links never open inside the game window
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') log(`renderer ${e.level}: ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on('render-process-gone', (_e, details) => log(`renderer gone: ${details.reason} (exit ${details.exitCode})`));
  void win.loadURL('app://game/index.html');
  return win;
}

void app.whenReady().then(async () => {
  settings = loadSettings();
  const display = screen.getPrimaryDisplay();
  log(`D2 Tower Defense ${app.getVersion()}, Electron ${process.versions.electron}, Windows ${process.getSystemVersion()}`);
  log(`display ${display.size.width}x${display.size.height} at ${display.scaleFactor}x; D2R folder ${settings.d2rPath ?? 'not set'}, registry says ${(await detectD2R()) ?? 'nothing'}`);
  serveApp();
  const win = createWindow();

  ipcMain.handle('get-state', () => launcherState());
  ipcMain.handle('pick-folder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose your Diablo II: Resurrected folder',
      properties: ['openDirectory'],
      defaultPath: settings.d2rPath ?? undefined,
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return { path: null };
    if (!looksLikeD2R(path)) return { path: null, error: 'That folder has no D2R game data (.build.info and Data).' };
    return { path };
  });
  ipcMain.handle('set-d2r-path', (_e, path: string) => {
    if (!looksLikeD2R(path)) return { ok: false, error: 'That folder has no D2R game data.' };
    settings = { ...settings, d2rPath: path };
    saveSettings(settings);
    return { ok: true };
  });
  ipcMain.handle('run-setup', () => runSetup(win));
  ipcMain.handle('open-log-folder', () => shell.openPath(dirname(logFile)));
  ipcMain.handle('set-name', (_e, name: string) => {
    settings = { ...settings, name: String(name).trim().slice(0, 20) || defaultName() };
    saveSettings(settings);
  });
  ipcMain.on('quit', () => app.quit());
  ipcMain.handle('mp-host', () => hostMultiplayer(win));
  ipcMain.handle('mp-join', async (_e, code: string) => {
    const address = decodeJoinCode(String(code));
    if (!address) return { ok: false, error: 'That code is not right. Check it with the host and try again.' };
    await leaveMultiplayer();
    joinRelay(win, address.ip, address.port);
    return { ok: true };
  });
  ipcMain.on('mp-send', (_e, message: ClientMessage) => connection?.send(message));
  ipcMain.handle('mp-leave', () => leaveMultiplayer());
  ipcMain.handle('set-volume', (_e, volume: number) => {
    settings = { ...settings, volume: Math.max(0, Math.min(100, Math.round(volume))) };
    saveSettings(settings);
  });
  ipcMain.on('smoke-result', async (_e, result: SmokeResult) => {
    log(`smoke: ${JSON.stringify(result)}`);
    if (smokeFile) {
      mkdirSync(dirname(smokeFile), { recursive: true });
      writeFileSync(smokeFile, JSON.stringify(result, null, 2));
      // A picture of the run for whoever checks the gate
      const image = await win.webContents.capturePage();
      writeFileSync(smokeFile.replace(/\.json$/, '') + '.png', image.toPNG());
    }
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());
// Give the router mapping back on the way out
let leaving = false;
app.on('before-quit', (e) => {
  if (leaving || (!relay && !mapping && !connection)) return;
  e.preventDefault();
  leaving = true;
  void leaveMultiplayer().finally(() => app.quit());
});
