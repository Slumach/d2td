// Main menu: Play, Host and Join (multiplayer arrives in M4), and Settings for volume and
// the D2R folder.

import Phaser from 'phaser';

import { FONT, button } from '../render/ui.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../render/layout.ts';
import type { LauncherApi, LauncherState } from './api.ts';
import { shortPath } from './paths.ts';
import { LAUNCHER_KEY } from './SetupScene.ts';

const BUTTON_WIDTH = 360;
const CX = GAME_WIDTH / 2;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#e8e0c0' };
const MUTED = { ...TEXT, fontSize: '18px', color: '#a8a088' };

export class MenuScene extends Phaser.Scene {
  private api!: LauncherApi;
  private state!: LauncherState;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private settingsOpen = false;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.api = this.registry.get(LAUNCHER_KEY) as LauncherApi;
    this.settingsOpen = false;
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

  /** A centred menu button. */
  private menuButton(y: number, label: string, onClick: () => void, enabled = true, colour?: string): void {
    this.parts.push(...button(this, CX - BUTTON_WIDTH / 2, y, { label, onClick, enabled, colour, width: BUTTON_WIDTH }));
  }

  private draw(): void {
    for (const p of this.parts) p.destroy();
    this.parts = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);

    add(this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x14120e).setOrigin(0));
    add(this.add.text(CX, 200, 'D2 Tower Defense', { ...TEXT, fontSize: '56px' }).setOrigin(0.5));

    if (this.settingsOpen) this.drawSettings();
    else {
      let y = 360;
      this.menuButton(y, 'Play', () => this.scene.start('Game'), true, '#6a3020');
      y += 70;
      this.menuButton(y, 'Host (coming soon)', () => undefined, false);
      y += 70;
      this.menuButton(y, 'Join (coming soon)', () => undefined, false);
      y += 70;
      this.menuButton(y, 'Settings', () => {
        this.settingsOpen = true;
        this.draw();
      });
    }

    add(this.add.text(CX, GAME_HEIGHT - 50, `Version ${this.state.version}. Non-commercial fan project, not affiliated with Blizzard.`, MUTED).setOrigin(0.5));
  }

  private drawSettings(): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const left = CX - 360;
    let y = 340;

    add(this.add.text(left, y, 'Volume', MUTED));
    y += 34;
    const volume = this.state.volume;
    this.parts.push(...button(this, left, y, { label: '-', onClick: () => void this.setVolume(volume - 10), enabled: volume > 0, width: 48 }));
    add(this.add.text(left + 64, y + 6, `${volume}`, TEXT));
    this.parts.push(...button(this, left + 130, y, { label: '+', onClick: () => void this.setVolume(volume + 10), enabled: volume < 100, width: 48 }));
    y += 90;

    add(this.add.text(left, y, 'Diablo II: Resurrected folder', MUTED));
    y += 34;
    add(this.add.text(left, y, this.state.d2rPath ? shortPath(this.state.d2rPath, 60) : 'Not set', TEXT));
    y += 50;
    this.parts.push(
      ...button(this, left, y, { label: 'Change folder or extract again...', onClick: () => this.scene.start('Setup', { force: true }), width: 420 }),
    );
    this.parts.push(...button(this, left + 440, y, { label: 'Open log folder', onClick: () => void this.api.openLogFolder(), width: 260 }));
    y += 110;

    this.menuButton(y, 'Back', () => {
      this.settingsOpen = false;
      this.draw();
    });
  }
}
