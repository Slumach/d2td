// Main menu, dressed as D2's: the stone game-select backdrop, the logo's flames over
// "TOWER DEFENSE" in Exocet, and D2's stone buttons stacked down the middle. Options opens
// the stone panel for volume, name and the D2R folder. Without the frontend art (an
// extraction from before it existed) the plain look stands in.

import Phaser from 'phaser';

import { FONT, button } from '../render/ui.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../render/layout.ts';
import type { LauncherApi, LauncherState } from './api.ts';
import { frontendKey, frontendManifest, menuMusic, preloadFrontend, smoothHd, stoneButton, stonePanel } from './frontend.ts';
import { shortPath } from './paths.ts';
import { TextField } from './TextField.ts';
import { LAUNCHER_KEY } from './SetupScene.ts';

const CX = GAME_WIDTH / 2;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#d8c89a' };
const MUTED = { ...TEXT, fontSize: '17px', color: '#9a9078' };
const FLAMES_ANIM = 'frontend:flames';
const TITLE_Y = 312;
const BUTTONS_TOP = 470;
const BUTTON_STEP = 92;

export class MenuScene extends Phaser.Scene {
  private api!: LauncherApi;
  private state!: LauncherState;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private settingsOpen = false;
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
    this.settingsOpen = false;
    const m = frontendManifest(this);
    if (m) {
      smoothHd(this, m);
      if (m.flames && !this.anims.exists(FLAMES_ANIM)) {
        this.anims.create({ key: FLAMES_ANIM, frames: this.anims.generateFrameNumbers(frontendKey('flames')), frameRate: 18, repeat: -1 });
      }
      this.drawBackdrop();
    }
    menuMusic(this, true);
    void this.api.getState().then((state) => {
      this.state = state;
      this.draw();
    });
  }

  /** The parts that never change: backdrop, flames and title. */
  private drawBackdrop(): void {
    // The 800 x 600 classic backdrop at 2x, nearest-neighbour, cropped to the canvas
    this.add.image(CX, GAME_HEIGHT / 2, frontendKey('bg'), 0).setScale(2).setDepth(0);
    // A dark glow behind the title; it also hides the backdrop's own "Expansion Set" lettering
    const glow = this.add.graphics().setDepth(1);
    for (let i = 10; i > 0; i--) glow.fillStyle(0x000000, 0.11).fillEllipse(CX, TITLE_Y - 20, 300 + i * 60, 120 + i * 18);
    if (this.textures.exists(frontendKey('flames'))) {
      this.add.sprite(CX, TITLE_Y - 60, frontendKey('flames')).setScale(2.4).setDepth(2).setBlendMode(Phaser.BlendModes.ADD).play(FLAMES_ANIM);
    }
    this.add
      .text(CX, TITLE_Y, 'TOWER DEFENSE', { fontFamily: FONT, fontSize: '68px', color: '#e8b45a' })
      .setOrigin(0.5)
      .setDepth(3)
      .setStroke('#2a1206', 6)
      .setShadow(0, 0, '#ff6a00', 18, true, true);
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

  private draw(): void {
    this.clear();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const d2 = frontendManifest(this) !== undefined;
    if (!d2) {
      add(this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x14120e).setOrigin(0));
      add(this.add.text(CX, 200, 'D2 Tower Defense', { ...TEXT, fontSize: '56px' }).setOrigin(0.5));
    }
    add(this.add.text(16, GAME_HEIGHT - 28, `v${this.state.version}   non-commercial fan project, not affiliated with Blizzard`, { ...MUTED, fontSize: '14px' }).setDepth(3100));

    if (this.settingsOpen) return this.drawSettings(d2);
    const items: [string, () => void][] = [
      ['Single Player', () => this.startGame()],
      ['Host Game', () => this.scene.start('Lobby', { role: 'host' })],
      ['Join Game', () => this.scene.start('Lobby', { role: 'join' })],
      [
        'Options',
        () => {
          this.settingsOpen = true;
          this.draw();
        },
      ],
      ['Exit', () => this.api.quit()],
    ];
    items.forEach(([label, onClick], i) => {
      const y = BUTTONS_TOP + i * BUTTON_STEP;
      if (d2) this.parts.push(...stoneButton(this, CX, y, label, onClick, { width: 330 }));
      else this.parts.push(...button(this, CX - 180, y - 18, { label, onClick, width: 360 }));
    });
  }

  private startGame(): void {
    menuMusic(this, false);
    this.scene.start('Game');
  }

  private drawSettings(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const top = 410;
    const panel = d2 ? stonePanel(this, CX, top + 230, 720, 540) : undefined;
    if (panel) this.parts.push(panel);
    const left = CX - 300;
    const med = (x: number, y: number, label: string, onClick: () => void, width: number, enabled = true) => {
      if (d2) this.parts.push(...stoneButton(this, x + width / 2, y + 18, label, onClick, { size: 'med', width, enabled, fontSize: 18 }));
      else this.parts.push(...button(this, x, y, { label, onClick, width, enabled }));
    };
    let y = top;
    add(this.add.text(CX, y, 'OPTIONS', { ...TEXT, fontSize: '34px', color: '#e8b45a' }).setOrigin(0.5).setDepth(3101));
    y += 60;

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

    const back = () => {
      this.settingsOpen = false;
      this.draw();
    };
    if (d2) this.parts.push(...stoneButton(this, CX, y + 10, 'Back', back, { width: 300 }));
    else this.parts.push(...button(this, CX - 150, y, { label: 'Back', onClick: back, width: 300 }));
  }
}
