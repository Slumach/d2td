// Main menu, dressed as D2R's logo screen: black, the burning logo with TOWER DEFENSE
// under it, and D2's stone buttons stacked down the middle: Single Player, Multiplayer
// (Host or Join), Continue when there is a save, Options, Exit. Options opens D2R's
// options panel for volume, name and the D2R folder. Without the frontend art (an
// extraction from before it existed) the plain look stands in.

import Phaser from 'phaser';

import type { SoloStart } from '../render/GameScene.ts';
import { FONT, button } from '../render/ui.ts';
import { loadCheckpoint } from '../render/saves.ts';
import type { Checkpoint } from '../sim/checkpoint.ts';
import { stageName } from '../sim/data.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../render/layout.ts';
import type { LauncherApi, LauncherState } from './api.ts';
import { burningLogo, frontendManifest, menuMusic, optionsPanel, preloadFrontend, smoothHd, stoneButton } from './frontend.ts';
import { shortPath } from './paths.ts';
import { TextField } from './TextField.ts';
import { LAUNCHER_KEY } from './SetupScene.ts';

const CX = GAME_WIDTH / 2;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#d8c89a' };
const MUTED = { ...TEXT, fontSize: '17px', color: '#9a9078' };
/** The logo as the intro shows it: big, its top near the top of the screen. */
const LOGO_TOP = 10;
const LOGO_SCALE = 1.25;
const BUTTONS_TOP = 470;
const BUTTON_STEP = 92;

type Page = 'main' | 'multiplayer' | 'options';

export class MenuScene extends Phaser.Scene {
  private api!: LauncherApi;
  private state!: LauncherState;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private logo: Phaser.GameObjects.GameObject[] = [];
  private page: Page = 'main';
  /** The single-player checkpoint, if there is one: Continue carries it on. */
  private saved: Checkpoint | undefined;
  private nameField: TextField | undefined;

  constructor() {
    super('Menu');
  }

  preload(): void {
    preloadFrontend(this);
  }

  create(): void {
    this.api = this.registry.get(LAUNCHER_KEY) as LauncherApi;
    // Whatever path led here, no lobby or game connection outlives the main menu
    void this.api.mpLeave();
    this.page = 'main';
    this.saved = undefined;
    void loadCheckpoint(this.api, 'solo').then((cp) => {
      this.saved = cp;
      if (this.state) this.draw();
    });
    const m = frontendManifest(this);
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000).setOrigin(0).setDepth(0);
    if (m) smoothHd(this, m);
    this.logo = burningLogo(this, CX, LOGO_TOP, LOGO_SCALE, 2);
    menuMusic(this, true);
    void this.api.getState().then((state) => {
      this.state = state;
      this.draw();
    });
  }

  private async setVolume(volume: number): Promise<void> {
    await this.api.setVolume(volume);
    this.state = await this.api.getState();
    this.sound.volume = this.state.volume / 100;
    this.draw();
  }

  private clear(): void {
    for (const p of this.parts) p.destroy();
    this.parts = [];
    this.nameField?.destroy();
    this.nameField = undefined;
  }

  private go(page: Page): void {
    this.page = page;
    this.draw();
  }

  private draw(): void {
    this.clear();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const d2 = frontendManifest(this) !== undefined;
    for (const o of this.logo) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(this.page !== 'options');
    add(this.add.text(16, GAME_HEIGHT - 28, `v${this.state.version}   non-commercial fan project, not affiliated with Blizzard`, { ...MUTED, fontSize: '14px' }).setDepth(3100));

    if (this.page === 'options') return this.drawOptions(d2);
    const saved = this.saved;
    const items: [string, () => void][] =
      this.page === 'multiplayer'
        ? [
            ['Host Game', () => this.scene.start('Lobby', { role: 'host' })],
            ['Join Game', () => this.scene.start('Lobby', { role: 'join' })],
            ['Back', () => this.go('main')],
          ]
        : [
            ['Single Player', () => this.startGame()],
            ['Multiplayer', () => this.go('multiplayer')],
            ...(saved ? [[`Continue: ${stageName(saved.difficulty, saved.act)}`, () => this.startGame(saved)] as [string, () => void]] : []),
            ['Options', () => this.go('options')],
            ['Exit', () => this.api.quit()],
          ];
    items.forEach(([label, onClick], i) => {
      const y = BUTTONS_TOP + i * BUTTON_STEP;
      if (d2) this.parts.push(...stoneButton(this, CX, y, label, onClick, { width: 330 }));
      else this.parts.push(...button(this, CX - 180, y - 18, { label, onClick, width: 360 }));
    });
  }

  /** A new campaign, or the saved one carried on from its last act. */
  private startGame(resume?: Checkpoint): void {
    menuMusic(this, false);
    this.scene.start('Game', (resume ? { resume } : {}) satisfies SoloStart);
  }

  /** D2R's options panel with our settings: name, volume, the D2R folder. */
  private drawOptions(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const height = 760;
    const panel = d2 ? optionsPanel(this, CX, GAME_HEIGHT / 2 - 30, height, 'optionsBg') : undefined;
    if (panel) add(panel);
    const w = panel ? panel.displayWidth : 760;
    const top = GAME_HEIGHT / 2 - 30 - height / 2;
    const left = CX - w / 2 + w * 0.12;
    const med = (x: number, y: number, label: string, onClick: () => void, width: number, enabled = true) => {
      if (d2) this.parts.push(...stoneButton(this, x + width / 2, y + 18, label, onClick, { size: 'med', width, enabled, fontSize: 18 }));
      else this.parts.push(...button(this, x, y, { label, onClick, width, enabled }));
    };
    let y = top + 70;
    add(this.add.text(CX, y, 'Options', { ...TEXT, fontSize: '34px', color: '#c7b377' }).setOrigin(0.5).setDepth(3101));
    y += 70;

    add(this.add.text(left, y, 'Your name in multiplayer games', MUTED).setDepth(3101));
    y += 30;
    this.nameField = new TextField(this, left, y, 360, {
      value: this.state.name,
      maxLength: 20,
      onChange: (v) => {
        this.state = { ...this.state, name: v };
        void this.api.setName(v);
      },
    });
    for (const p of this.nameField.parts) (p as unknown as Phaser.GameObjects.Components.Depth).setDepth(3101);
    y += 64;

    add(this.add.text(left, y, 'Volume', MUTED).setDepth(3101));
    y += 30;
    const volume = this.state.volume;
    med(left, y, '-', () => void this.setVolume(volume - 10), 130, volume > 0);
    add(this.add.text(left + 175, y + 6, `${volume}`, TEXT).setDepth(3101));
    med(left + 240, y, '+', () => void this.setVolume(volume + 10), 130, volume < 100);
    y += 70;

    add(this.add.text(left, y, 'Diablo II: Resurrected folder', MUTED).setDepth(3101));
    y += 30;
    add(this.add.text(left, y, this.state.d2rPath ? shortPath(this.state.d2rPath, 48) : 'Not set', TEXT).setDepth(3101));
    y += 50;
    med(left, y, 'Extract again', () => this.scene.start('Setup', { force: true }), 260);
    med(left + 300, y, 'Open log folder', () => void this.api.openLogFolder(), 260);
    y += 90;

    const back = () => this.go('main');
    if (d2) this.parts.push(...stoneButton(this, CX, top + height - 60, 'Back', back, { width: 300 }));
    else this.parts.push(...button(this, CX - 150, y, { label: 'Back', onClick: back, width: 300 }));
  }
}
