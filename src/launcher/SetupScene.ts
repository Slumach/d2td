// First-launch setup: find the player's D2R install and extract what the game draws from it.
// Shown again from Settings to re-extract, and skipped when the extracted files verify.
// Under --smoke it runs unattended: setup if needed, then wave 1, then reports.

import Phaser from 'phaser';

import { loadFeel } from '../render/feel.ts';
import { FONT, button } from '../render/ui.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../render/layout.ts';
import type { GameScene } from '../render/GameScene.ts';
import type { LauncherApi, LauncherState, SetupProgress, SetupResult } from './api.ts';
import { shortPath } from './paths.ts';
import { playWaveOne } from './smoke.ts';

/** The registry key for window.d2td. */
export const LAUNCHER_KEY = 'launcher';

const LEFT = 240;
const WIDTH = GAME_WIDTH - 2 * LEFT;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#e8e0c0', wordWrap: { width: WIDTH } };
const MUTED = { ...TEXT, fontSize: '18px', color: '#a8a088' };

/** The preload's listener is permanent, so it is added once and points at whichever scene is open. */
let progressTarget: ((p: SetupProgress) => void) | undefined;
let listening = false;

export class SetupScene extends Phaser.Scene {
  private api!: LauncherApi;
  private state!: LauncherState;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private busy = false;
  private progress: SetupProgress | undefined;
  private message = '';
  private failed = false;

  constructor() {
    super('Setup');
  }

  /** `force` shows the screen even when the extracted files already verify (Settings). */
  create(data: { force?: boolean }): void {
    this.api = this.registry.get(LAUNCHER_KEY) as LauncherApi;
    this.busy = false;
    this.progress = undefined;
    this.message = '';
    this.failed = false;
    if (!listening) {
      this.api.onSetupProgress((p) => progressTarget?.(p));
      listening = true;
    }
    progressTarget = (p) => {
      this.progress = p;
      this.draw();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => (progressTarget = undefined));

    void this.api.getState().then((state) => {
      this.state = state;
      this.sound.volume = state.volume / 100;
      if (state.smoke) void this.smoke();
      else if (state.setupOk && !data?.force) this.scene.start('Menu');
      else if (!data?.force && this.needsRepair && this.folder) {
        // An extraction from an older version, or with files missing: bring it up to date
        // on the progress screen without waiting for a click
        this.draw();
        void this.onExtract();
      } else this.draw();
    });
  }

  /** An earlier extraction exists but is outdated or damaged (not a first run). */
  private get needsRepair(): boolean {
    return this.state.bad.length > 0 && !this.state.bad.includes('checksums.json');
  }

  /** The folder setup will read: the one in settings, else what the registry found. */
  private get folder(): string | null {
    return this.state.d2rPath ?? this.state.detectedPath;
  }

  private async chooseFolder(): Promise<void> {
    const picked = await this.api.pickFolder();
    if (picked.path) {
      await this.api.setD2rPath(picked.path);
      this.state = await this.api.getState();
      this.message = '';
      this.failed = false;
    } else if (picked.error) {
      this.message = picked.error;
      this.failed = true;
    }
    this.draw();
  }

  private async extract(): Promise<SetupResult> {
    const folder = this.folder;
    if (!folder) return { ok: false, error: 'Choose your Diablo II: Resurrected folder first.', files: 0 };
    const set = await this.api.setD2rPath(folder);
    if (!set.ok) return { ok: false, error: set.error ?? 'That folder has no D2R game data.', files: 0 };
    this.busy = true;
    this.message = '';
    this.draw();
    const result = await this.api.runSetup();
    this.busy = false;
    this.state = await this.api.getState();
    return result;
  }

  private async onExtract(): Promise<void> {
    const result = await this.extract();
    if (result.ok) {
      await loadFeel();
      this.scene.start('Menu');
      return;
    }
    this.progress = undefined;
    this.message = result.error ?? 'Setup failed.';
    this.failed = true;
    this.draw();
  }

  private async smoke(): Promise<void> {
    let setup: SetupResult = { ok: true, files: 0 };
    if (!this.state.setupOk) {
      setup = await this.extract();
      if (setup.ok) await loadFeel();
    }
    if (!setup.ok) {
      this.api.reportSmoke({ setup, wave: 0, kills: 0, alive: 0, waveCleared: false, error: setup.error });
      return;
    }
    this.registry.set('speed', 4);
    const game = this.scene.get('Game') as GameScene;
    game.events.once('game-ready', () => playWaveOne(game, (r) => this.api.reportSmoke({ setup, ...r })));
    this.scene.start('Game');
  }

  private draw(): void {
    for (const p of this.parts) p.destroy();
    const parts: Phaser.GameObjects.GameObject[] = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (parts.push(o), o);
    this.parts = parts;
    if (!this.state) return;

    add(this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x14120e).setOrigin(0));
    let y = 140;
    add(this.add.text(LEFT, y, 'D2 Tower Defense', { ...TEXT, fontSize: '48px' }));
    y += 90;
    add(
      this.add.text(
        LEFT,
        y,
        'Every monster, hero and skill icon comes from your own copy of Diablo II: Resurrected. ' +
          'Nothing from the game ships with this app. Setup reads the files once from your install ' +
          'and keeps them in the app\'s data folder.',
        { ...TEXT, lineSpacing: 6 },
      ),
    );
    y += 130;

    if (this.state.bad.includes('version')) {
      add(this.add.text(LEFT, y, 'This version of the game reads a few more files from Diablo II: Resurrected. Click Extract game files once more.', { ...TEXT, color: '#e0b060' }));
      y += 70;
    } else if (this.state.bad.length > 0 && !this.state.bad.includes('checksums.json')) {
      add(this.add.text(LEFT, y, 'Some extracted files are missing or changed. Extract again to repair them.', { ...TEXT, color: '#e0b060' }));
      y += 50;
    }

    add(this.add.text(LEFT, y, 'Diablo II: Resurrected folder', MUTED));
    y += 32;
    const folder = this.folder;
    add(this.add.text(LEFT, y, folder ? shortPath(folder, 70) : 'Not found automatically. Choose the folder you installed the game to.', folder ? TEXT : { ...TEXT, color: '#e0b060' }));
    y += 70;

    const enabled = !this.busy;
    parts.push(...button(this, LEFT, y, { label: 'Choose folder...', onClick: () => void this.chooseFolder(), enabled, width: 260 }));
    parts.push(
      ...button(this, LEFT + 290, y, { label: 'Extract game files', onClick: () => void this.onExtract(), enabled: enabled && folder !== null, colour: '#6a3020', width: 300 }),
    );
    y += 80;

    if (this.busy) {
      const p = this.progress;
      const frac = p && p.total > 0 ? p.done / p.total : 0;
      add(this.add.rectangle(LEFT, y, WIDTH, 18, 0x2a2420).setOrigin(0));
      add(this.add.rectangle(LEFT, y, Math.round(WIDTH * frac), 18, 0xa04a2a).setOrigin(0));
      const label = p && p.file ? `Extracting ${p.done + 1} of ${p.total}: ${p.file}` : 'Opening the game storage...';
      add(this.add.text(LEFT, y + 30, label, MUTED));
    } else if (this.message) {
      const text = add(this.add.text(LEFT, y, this.message, { ...TEXT, color: this.failed ? '#ff8060' : '#e8e0c0', lineSpacing: 6 }));
      if (this.failed) {
        y += text.height + 20;
        add(this.add.text(LEFT, y, `The log has the details: ${shortPath(this.state.logFile, 60)}`, MUTED));
        parts.push(...button(this, LEFT, y + 40, { label: 'Open log folder', onClick: () => void this.api.openLogFolder(), width: 260 }));
      }
    }

    add(this.add.text(LEFT, GAME_HEIGHT - 60, `Version ${this.state.version}. Non-commercial fan project, not affiliated with Blizzard.`, MUTED));
  }
}
