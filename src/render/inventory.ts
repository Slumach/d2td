// D2R's inventory panel (ui/hud/invbg.png, from PANEL/Inventory/Background), opened with
// I or the panel's inventory button, drawn at D2R's 1080p size on the right of the screen
// as D2R places it: the title, the close button, the weapon-swap tabs, the paper doll, the
// 10 x 4 grid and the gold box. Only the gold is live; the slots and grid say that items
// and runes come later.

import Phaser from 'phaser';

import { HD_SCALE } from '../launcher/frontend.ts';
import { hudKey, type HudManifest } from './d2hud.ts';
import { GAME_WIDTH } from './layout.ts';
import { FONT, createTooltip, type Tooltip } from './ui.ts';

/** Spots on the 1162 x 1507 panel, in its own pixels (global/ui/layouts/playerinventoryexpansionlayouthd.json and the art). */
const SPOTS = {
  title: { x: 581, y: 98 },
  close: { x: 1090, y: 35 },
  tabs: [
    { x: 99, y: 179 },
    { x: 850, y: 179 },
  ],
  tabSize: { w: 215, h: 60 },
  grid: { x: 83, y: 880, cols: 10, rows: 4, cell: 96.4 },
  gold: { x: 420, y: 1339 },
  /** The paper doll's slots: name and box, for their tooltips. */
  doll: [
    ['Right hand', 97, 180, 215, 460],
    ['Left hand', 850, 180, 215, 460],
    ['Head', 472, 175, 215, 215],
    ['Amulet', 708, 340, 110, 110],
    ['Torso', 472, 410, 215, 320],
    ['Gloves', 97, 660, 215, 215],
    ['Boots', 850, 660, 215, 215],
    ['Ring', 332, 760, 110, 110],
    ['Ring', 708, 760, 110, 110],
    ['Belt', 472, 760, 215, 110],
  ] as [string, number, number, number, number][],
};
const DEPTH = 4000;
const MARGIN = { right: 40, top: 60 };

export class InventoryPanel {
  private parts: Phaser.GameObjects.GameObject[] = [];
  private goldText: Phaser.GameObjects.Text | undefined;
  private readonly tooltip: Tooltip;
  private shown = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly m: HudManifest,
  ) {
    this.tooltip = createTooltip(scene, 0, 0);
  }

  static available(scene: Phaser.Scene, m: HudManifest | undefined): boolean {
    return m?.invBg !== undefined && scene.textures.exists(hudKey('invBg'));
  }

  get open(): boolean {
    return this.shown;
  }

  toggle(gold: number): void {
    if (this.shown) this.hide();
    else this.show(gold);
  }

  /** True where the panel covers the screen, so clicks there never reach the map. */
  covers(x: number, y: number): boolean {
    if (!this.shown) return false;
    const { left, top, w, h } = this.box();
    return x >= left && x <= left + w && y >= top && y <= top + h;
  }

  private box(): { left: number; top: number; w: number; h: number; s: number } {
    const s = HD_SCALE;
    const w = this.m.invBg!.frameWidth * s;
    const h = this.m.invBg!.frameHeight * s;
    return { left: GAME_WIDTH - MARGIN.right - w, top: MARGIN.top, w, h, s };
  }

  setGold(gold: number): void {
    this.goldText?.setText(String(gold));
  }

  show(gold: number): void {
    this.hide();
    this.shown = true;
    const { left, top, s } = this.box();
    const at = (x: number, y: number) => ({ x: left + x * s, y: top + y * s });
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const stop = (o: Phaser.GameObjects.GameObject) => o.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => e.stopPropagation());
    const hover = (o: Phaser.GameObjects.GameObject, title: string, body: string, tx: number, ty: number) => {
      o.on('pointerover', () => {
        this.tooltip.move(tx, ty);
        this.tooltip.show(title, body);
      });
      o.on('pointerout', () => this.tooltip.hide());
    };

    const bg = add(this.scene.add.image(left, top, hudKey('invBg')).setOrigin(0).setScale(s).setDepth(DEPTH).setInteractive());
    stop(bg);
    const t = at(SPOTS.title.x, SPOTS.title.y);
    add(this.scene.add.text(t.x, t.y, 'Inventory', { fontFamily: FONT, fontSize: '26px', color: '#c7b377' }).setOrigin(0.5).setDepth(DEPTH + 1).setLetterSpacing(2));

    if (this.m.invClose && this.scene.textures.exists(hudKey('invClose'))) {
      const c = at(SPOTS.close.x, SPOTS.close.y);
      const close = add(this.scene.add.image(c.x, c.y, hudKey('invClose'), 0).setOrigin(0).setScale(s).setDepth(DEPTH + 1).setInteractive({ useHandCursor: true }));
      close.on('pointerover', () => close.setFrame(1));
      close.on('pointerout', () => close.setFrame(0));
      close.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        this.hide();
      });
    }

    // Weapon-swap tabs: I lit, II dark, as D2R shows a fresh character
    if (this.m.invTab && this.scene.textures.exists(hudKey('invTab'))) {
      for (const tab of SPOTS.tabs) {
        const p = at(tab.x, tab.y);
        add(this.scene.add.image(p.x, p.y, hudKey('invTab'), 0).setOrigin(0).setScale(s).setDepth(DEPTH + 1));
        const style = { fontFamily: FONT, fontSize: '18px' };
        add(this.scene.add.text(p.x + (SPOTS.tabSize.w / 4) * s, p.y + (SPOTS.tabSize.h / 2) * s, 'I', { ...style, color: '#e6e0d4' }).setOrigin(0.5).setDepth(DEPTH + 2));
        add(this.scene.add.text(p.x + ((3 * SPOTS.tabSize.w) / 4) * s, p.y + (SPOTS.tabSize.h / 2) * s, 'II', { ...style, color: '#7a7468' }).setOrigin(0.5).setDepth(DEPTH + 2));
      }
    }

    for (const [name, x, y, w, h] of SPOTS.doll) {
      const p = at(x, y);
      const zone = add(this.scene.add.zone(p.x, p.y, w * s, h * s).setOrigin(0).setDepth(DEPTH + 1).setInteractive());
      stop(zone);
      hover(zone, name, 'Items come later', p.x - 40, p.y - 6);
    }
    const g = at(SPOTS.grid.x, SPOTS.grid.y);
    const grid = add(this.scene.add.zone(g.x, g.y, SPOTS.grid.cols * SPOTS.grid.cell * s, SPOTS.grid.rows * SPOTS.grid.cell * s).setOrigin(0).setDepth(DEPTH + 1).setInteractive());
    stop(grid);
    hover(grid, 'Inventory', 'Item placement comes later', g.x + 120, g.y - 6);

    // The gold box: D2R's gold button and the amount
    const gp = at(SPOTS.gold.x, SPOTS.gold.y);
    if (this.m.goldButton && this.scene.textures.exists(hudKey('goldButton'))) {
      const btn = add(this.scene.add.image(gp.x, gp.y, hudKey('goldButton'), 0).setScale(s).setDepth(DEPTH + 1).setInteractive());
      btn.on('pointerover', () => btn.setFrame(1));
      btn.on('pointerout', () => btn.setFrame(0));
      stop(btn);
      hover(btn, 'Gold', 'Towers and upgrades are paid from here', gp.x - 60, gp.y - 20);
    }
    this.goldText = add(this.scene.add.text(gp.x + 24, gp.y, String(gold), { fontFamily: FONT, fontSize: '20px', color: '#e6c868' }).setOrigin(0, 0.5).setDepth(DEPTH + 1));
  }

  hide(): void {
    this.shown = false;
    this.tooltip.hide();
    for (const o of this.parts) o.destroy();
    this.parts = [];
    this.goldText = undefined;
  }
}
