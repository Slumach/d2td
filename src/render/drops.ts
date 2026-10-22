// Items on the ground: D2R's name label over the drop spot, coloured by quality, with the
// item's drop sound when it lands. Clicking a label picks the item up (a command, so the
// sim decides). Only this player's drops are shown: another player's loot is theirs.

import Phaser from 'phaser';

import type { ItemData } from '../sim/items/data.ts';
import type { Item } from '../sim/items/item.ts';
import type { Drop } from '../sim/items/loot.ts';
import type { Command } from '../sim/state.ts';
import { project } from './iso.ts';
import { labelText, nameColour } from './itemtext.ts';
import { FONT } from './ui.ts';

interface View {
  box: Phaser.GameObjects.Container;
}

export class GroundDrops {
  private readonly views = new Map<number, View>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
    private readonly issue: (c: Command) => void,
    private readonly dropSound: (item: Item) => void,
    /** Creates game objects in the world camera (WorldView.asWorld). */
    private readonly world: <T>(make: () => T) => T,
    /** Shift-click on a label: sell the drop where it lies. */
    private readonly sell: (d: Drop) => void,
  ) {}

  /** Matches the labels to the sim's drops; a new one plays its drop sound. */
  sync(data: ItemData, drops: readonly Drop[], seat: number): void {
    const live = new Set<number>();
    // Labels stack upwards when drops share a spot, as D2 lifts overlapping names
    const placed: { x: number; y: number }[] = [];
    for (const d of drops) {
      if (d.owner !== seat) continue;
      live.add(d.id);
      let view = this.views.get(d.id);
      if (!view) {
        view = { box: this.world(() => this.make(data, d)) };
        this.views.set(d.id, view);
        this.dropSound(d.item);
      }
      const at = project(d.x, d.y);
      let y = at.y - 12;
      while (placed.some((p) => Math.abs(p.x - at.x) < 50 && Math.abs(p.y - y) < 10)) y -= 11;
      placed.push({ x: at.x, y });
      view.box.setPosition(Math.round(at.x), Math.round(y));
    }
    for (const [id, view] of this.views) {
      if (live.has(id)) continue;
      view.box.destroy();
      this.views.delete(id);
    }
  }

  clear(): void {
    for (const v of this.views.values()) v.box.destroy();
    this.views.clear();
  }

  private make(data: ItemData, d: Drop): Phaser.GameObjects.Container {
    // World space, so the label sits on its drop as the camera pans; drawn at three times the
    // size it shows at zoom 1, so it stays crisp at every whole-number zoom
    const text = this.scene.add.text(0, 0, labelText(data, d.item), { fontFamily: FONT, fontSize: '8px', color: nameColour(data, d.item) }).setOrigin(0.5).setResolution(3);
    const bg = this.scene.add.rectangle(0, 0, text.width + 8, text.height + 2, 0x000000, 0.7).setOrigin(0.5);
    const box = this.scene.add.container(0, 0, [bg, text]).setDepth(this.depth).setSize(bg.width, bg.height);
    box.setInteractive({ useHandCursor: true }).on('pointerdown', (p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      if (!p.leftButtonDown()) return;
      e.stopPropagation();
      if ((p.event as MouseEvent).shiftKey) return this.sell(d);
      this.issue({ type: 'pickup', dropId: d.id });
    });
    box.on('pointerover', () => bg.setFillStyle(0x203060, 0.85));
    box.on('pointerout', () => bg.setFillStyle(0x000000, 0.7));
    return box;
  }
}
