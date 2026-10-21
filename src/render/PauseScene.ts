// The pause menu, opened with Escape over a paused GameScene: Resume, Restart, and Quit to
// menu (launcher only), which asks before throwing the run away. Pausing the scene stops
// its update, so no sim tick runs and no animation advances while this is open. Online the
// game cannot pause for one player, so it keeps running underneath and there is no Restart.

import Phaser from 'phaser';

import { frontendManifest, stoneButton, stonePanel } from '../launcher/frontend.ts';
import type { GameScene } from './GameScene.ts';
import { GAME_HEIGHT, GAME_WIDTH } from './layout.ts';
import { FONT, button } from './ui.ts';

const BUTTON_WIDTH = 320;
const CX = GAME_WIDTH / 2;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#e8e0c0', align: 'center' };

export class PauseScene extends Phaser.Scene {
  private parts: Phaser.GameObjects.GameObject[] = [];
  private online = false;

  constructor() {
    super('Pause');
  }

  private get run(): GameScene {
    return this.scene.get('Game') as GameScene;
  }

  create(data?: { online?: boolean }): void {
    this.online = data?.online === true;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6).setOrigin(0).setInteractive();
    this.input.keyboard?.on('keydown-ESC', () => this.resume());
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

  /** D2's stone button when the frontend art is extracted, the plain one otherwise. */
  private menuButton(y: number, label: string, onClick: () => void, colour?: string): void {
    if (frontendManifest(this)) this.parts.push(...stoneButton(this, CX, y + 18, label, onClick, { size: 'med', width: BUTTON_WIDTH, fontSize: 20 }));
    else this.parts.push(...button(this, CX - BUTTON_WIDTH / 2, y, { label, onClick, colour, width: BUTTON_WIDTH }));
  }

  /** The stone panel behind the menu, as in Options. */
  private panel(top: number, height: number): void {
    const p = stonePanel(this, CX, top + height / 2, 460, height);
    if (p) this.parts.push(p);
  }

  private drawMenu(): void {
    this.clear();
    const top = GAME_HEIGHT / 2 - 140;
    this.panel(top - 50, this.online ? 300 : 400);
    const title = this.online ? 'Menu (the game goes on)' : 'Paused';
    this.parts.push(this.add.text(CX, top, title, { ...TEXT, fontSize: this.online ? '30px' : '40px' }).setOrigin(0.5).setDepth(3101));
    this.menuButton(top + 70, 'Resume', () => this.resume(), '#6a3020');
    const step = frontendManifest(this) ? 90 : 60;
    if (this.online) {
      this.menuButton(top + 70 + step, 'Leave game', () => this.drawConfirm());
      return;
    }
    this.menuButton(top + 70 + step, 'Restart', () => {
      this.run.restartRun();
      this.resume();
    });
    // The plain-browser build has no menu to go back to
    if (this.scene.manager.getScene('Menu')) this.menuButton(top + 70 + step * 2, 'Quit to menu', () => this.drawConfirm());
  }

  private drawConfirm(): void {
    this.clear();
    const top = GAME_HEIGHT / 2 - 100;
    this.panel(top - 60, frontendManifest(this) ? 340 : 270);
    const question = this.online ? 'Leave the game?\nYou cannot rejoin it.' : 'Quit to the menu?\nThis run will be lost.';
    this.parts.push(this.add.text(CX, top, question, { ...TEXT, lineSpacing: 8 }).setOrigin(0.5).setDepth(3101));
    this.menuButton(top + 80, this.online ? 'Leave' : 'Quit', () => {
      this.scene.stop();
      this.run.quitToMenu();
    }, '#6a3020');
    this.menuButton(top + 80 + (frontendManifest(this) ? 90 : 60), 'Cancel', () => this.drawMenu());
  }
}
