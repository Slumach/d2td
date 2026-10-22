// The Escape menu, as D2R lays out its pause menu (global/ui/layouts/pauselayouthd.json):
// the game darkened, the burning logo, and D2R's stone buttons down the middle: Options,
// Save, Quit to Menu, Return to Game. Pausing the scene stops its update, so no sim tick
// runs and no animation advances while this is open. Online the game cannot pause for one
// player, so it keeps running underneath, Save is the host's and Quit leaves the game.
// Options opens D2R's settings panel with the volume. Without the frontend art the plain
// look stands in.

import Phaser from 'phaser';

import { HD_SCALE, LOGO_HEIGHT, burningLogo, frontendManifest, optionsPanel, pauseButton, stoneButton } from '../launcher/frontend.ts';
import type { LauncherApi, LauncherState } from '../launcher/api.ts';
import type { GameScene } from './GameScene.ts';
import { GAME_HEIGHT, GAME_WIDTH } from './layout.ts';
import { FONT, button } from './ui.ts';

const CX = GAME_WIDTH / 2;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#e8e0c0', align: 'center' };
/** The logo widget's top and the button table's first row, as the layout places them at 1080p. */
const LOGO_TOP = 40;
const ROW_STEP = 140 * HD_SCALE;

export class PauseScene extends Phaser.Scene {
  private parts: Phaser.GameObjects.GameObject[] = [];
  private logo: Phaser.GameObjects.GameObject[] = [];
  private online = false;
  private launcher: LauncherApi | undefined;
  private volume = 100;

  constructor() {
    super('Pause');
  }

  private get run(): GameScene {
    return this.scene.get('Game') as GameScene;
  }

  create(data?: { online?: boolean }): void {
    this.online = data?.online === true;
    this.launcher = this.registry.get('launcher') as LauncherApi | undefined;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setOrigin(0).setInteractive();
    this.input.keyboard?.on('keydown-ESC', () => this.resume());
    this.logo = burningLogo(this, CX, LOGO_TOP, 1, 3060);
    void this.launcher?.getState().then((s: LauncherState) => (this.volume = s.volume));
    this.drawMenu();
  }

  private resume(): void {
    this.scene.stop();
    this.scene.resume('Game');
  }

  private clear(): void {
    for (const p of this.parts) p.destroy();
    this.parts = [];
  }

  /** D2R's pause button when the frontend art is extracted, the plain one otherwise. */
  private menuButton(y: number, label: string, onClick: () => void, enabled = true): void {
    if (frontendManifest(this)) this.parts.push(...pauseButton(this, CX, y, label, onClick, { enabled }));
    else this.parts.push(...button(this, CX - 160, y - 18, { label, onClick, width: 320, enabled }));
  }

  private rows(): number {
    return LOGO_TOP + LOGO_HEIGHT * HD_SCALE + 60;
  }

  private drawMenu(): void {
    this.clear();
    for (const o of this.logo) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(true);
    let y = this.rows();
    if (this.online) {
      this.parts.push(this.add.text(CX, y - 46, 'The game goes on', { ...TEXT, fontSize: '18px', color: '#b8b090' }).setOrigin(0.5).setDepth(3101));
    }
    this.menuButton(y, 'Options', () => this.drawOptions());
    y += ROW_STEP;
    const canSave = this.run.canSave;
    this.menuButton(y, 'Save', () => {
      this.run.saveNow();
      this.resume();
    }, canSave);
    y += ROW_STEP;
    // The plain-browser build has no menu to go back to
    if (this.scene.manager.getScene('Menu')) {
      this.menuButton(y, this.online ? 'Leave Game' : 'Quit to Menu', () => this.drawConfirm());
      y += ROW_STEP;
    }
    this.menuButton(y, 'Return to Game', () => this.resume());
  }

  private drawConfirm(): void {
    this.clear();
    let y = this.rows();
    const question = this.online ? 'Leave the game? You cannot rejoin it.' : 'Quit to the menu? The run keeps its last save.';
    this.parts.push(this.add.text(CX, y - 46, question, { ...TEXT, fontSize: '20px' }).setOrigin(0.5).setDepth(3101));
    this.menuButton(y, this.online ? 'Leave' : 'Quit', () => {
      this.scene.stop();
      this.run.quitToMenu();
    });
    y += ROW_STEP;
    this.menuButton(y, 'Cancel', () => this.drawMenu());
  }

  /** D2R's settings panel with what we have to set: the volume. */
  private drawOptions(): void {
    this.clear();
    for (const o of this.logo) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(false);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const height = 700;
    const panel = optionsPanel(this, CX, GAME_HEIGHT / 2 - 20, height, 'settingsPanel');
    if (panel) add(panel);
    const w = panel ? panel.displayWidth : 900;
    const left = CX - w / 2;
    const top = GAME_HEIGHT / 2 - 20 - height / 2;
    // The panel's left column lists the pages; ours has one
    add(this.add.text(left + w * 0.12, top + 60, 'Sound', { ...TEXT, color: '#e8b45a' }).setOrigin(0.5, 0).setDepth(3101));
    const rx = left + w * 0.3;
    add(this.add.text(rx, top + 60, 'Options', { ...TEXT, fontSize: '30px', color: '#c7b377' }).setDepth(3101));
    add(this.add.text(rx, top + 130, 'Volume', TEXT).setDepth(3101));
    const value = add(this.add.text(rx + 320, top + 174, `${this.volume}`, TEXT).setOrigin(0.5, 0).setDepth(3101));
    const set = (v: number) => {
      this.volume = Math.max(0, Math.min(100, v));
      value.setText(`${this.volume}`);
      this.sound.volume = this.volume / 100;
      void this.launcher?.setVolume(this.volume);
    };
    for (const o of stoneButton(this, rx + 100, top + 190, '-', () => set(this.volume - 10), { size: 'med', width: 150, fontSize: 20 })) add(o);
    for (const o of stoneButton(this, rx + 540, top + 190, '+', () => set(this.volume + 10), { size: 'med', width: 150, fontSize: 20 })) add(o);
    add(this.add.text(rx, top + 250, 'Name and the Diablo II: Resurrected folder are set from the main menu.', { ...TEXT, fontSize: '16px', color: '#9a9078', align: 'left' }).setDepth(3101));
    this.menuButton(top + height - 70, 'Back', () => this.drawMenu());
  }
}
