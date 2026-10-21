// The pause menu, opened with Escape over a paused GameScene: Resume, Restart, and Quit to
// menu (launcher only), which asks before throwing the run away. Pausing the scene stops
// its update, so no sim tick runs and no animation advances while this is open.

import Phaser from 'phaser';

import type { GameScene } from './GameScene.ts';
import { GAME_HEIGHT, GAME_WIDTH } from './layout.ts';
import { FONT, button } from './ui.ts';

const BUTTON_WIDTH = 320;
const CX = GAME_WIDTH / 2;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#e8e0c0', align: 'center' };

export class PauseScene extends Phaser.Scene {
  private parts: Phaser.GameObjects.GameObject[] = [];

  constructor() {
    super('Pause');
  }

  private get run(): GameScene {
    return this.scene.get('Game') as GameScene;
  }

  create(): void {
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

  private menuButton(y: number, label: string, onClick: () => void, colour?: string): void {
    this.parts.push(...button(this, CX - BUTTON_WIDTH / 2, y, { label, onClick, colour, width: BUTTON_WIDTH }));
  }

  private drawMenu(): void {
    this.clear();
    const top = GAME_HEIGHT / 2 - 140;
    this.parts.push(this.add.text(CX, top, 'Paused', { ...TEXT, fontSize: '40px' }).setOrigin(0.5));
    this.menuButton(top + 70, 'Resume', () => this.resume(), '#6a3020');
    this.menuButton(top + 130, 'Restart', () => {
      this.run.restartRun();
      this.resume();
    });
    // The plain-browser build has no menu to go back to
    if (this.scene.manager.getScene('Menu')) this.menuButton(top + 190, 'Quit to menu', () => this.drawConfirm());
  }

  private drawConfirm(): void {
    this.clear();
    const top = GAME_HEIGHT / 2 - 100;
    this.parts.push(this.add.text(CX, top, 'Quit to the menu?\nThis run will be lost.', { ...TEXT, lineSpacing: 8 }).setOrigin(0.5));
    this.menuButton(top + 80, 'Quit', () => {
      this.scene.stop();
      this.run.quitToMenu();
    }, '#6a3020');
    this.menuButton(top + 140, 'Cancel', () => this.drawMenu());
  }
}
