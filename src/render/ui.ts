// Small Phaser UI helpers: text buttons, icon buttons with tooltips, and row layout.

import Phaser from 'phaser';

import { EXOCET } from './feel.ts';

/** D2R's Exocet from the player's files, with a serif in its place until setup has run. */
export const FONT = `${EXOCET}, Georgia, serif`;

export interface ButtonSpec {
  label: string;
  onClick: () => void;
  enabled?: boolean;
  colour?: string;
  /** An HD skill icon shown left of the label. */
  icon?: string;
  /** Shown above the panel while hovered. */
  tooltip?: { title: string; body: string };
  /** A fixed width with the label centred, for menus. Text buttons only. */
  width?: number;
}

export interface Tooltip {
  show(title: string, body: string): void;
  hide(): void;
}

/** D2's item and skill box: translucent black, text centred, the name in gold over white lines. */
const TOOLTIP_GOLD = '#c7b377';
const TOOLTIP_WHITE = '#e8e8e8';

/** One shared tooltip box, anchored above the panel with its bottom-left at (x, bottom). */
export function createTooltip(scene: Phaser.Scene, x: number, bottom: number): Tooltip {
  const box = scene.add.graphics().setDepth(5000).setVisible(false);
  const title = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '20px', color: TOOLTIP_GOLD, align: 'center' }).setOrigin(0.5, 0).setDepth(5001).setVisible(false);
  const body = scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '17px', color: TOOLTIP_WHITE, align: 'center', lineSpacing: 4 }).setOrigin(0.5, 0).setDepth(5001).setVisible(false);
  const PAD = 12;
  return {
    show: (t, b) => {
      title.setText(t);
      body.setText(b);
      const w = Math.max(title.width, b ? body.width : 0) + PAD * 2;
      const h = title.height + (b ? body.height + 8 : 0) + PAD * 2;
      const top = bottom - h;
      box.clear().fillStyle(0x000000, 0.82).fillRect(x, top, w, h).setVisible(true);
      title.setPosition(x + w / 2, top + PAD).setVisible(true);
      body.setPosition(x + w / 2, top + PAD + title.height + 8).setVisible(b !== '');
    },
    hide: () => {
      box.setVisible(false);
      title.setVisible(false);
      body.setVisible(false);
    },
  };
}

/** Two rows of buttons fit the 120 px panel under its info line. */
const ICON_SIZE = 36;
const ROW_GAP = 6;

/** A button; disabled ones are dimmed and ignore clicks. Returns its parts for cleanup. */
export function button(scene: Phaser.Scene, x: number, y: number, spec: ButtonSpec, tooltip?: Tooltip): Phaser.GameObjects.GameObject[] {
  const enabled = spec.enabled ?? true;
  const hasIcon = spec.icon !== undefined && scene.textures.exists(spec.icon);
  const text = scene.add
    .text(x + (hasIcon ? ICON_SIZE + 6 : 0), y, spec.label, {
      fontFamily: FONT,
      fontSize: '20px',
      color: enabled ? '#f0e8d0' : '#807868',
      backgroundColor: enabled ? (spec.colour ?? '#4a3420') : '#2a2420',
      padding: { x: 10, y: 6 },
      fixedHeight: hasIcon ? ICON_SIZE : 0,
      fixedWidth: hasIcon ? 0 : (spec.width ?? 0),
      align: 'center',
    })
    .setDepth(3100);
  const parts: Phaser.GameObjects.GameObject[] = [text];
  const targets: (Phaser.GameObjects.Text | Phaser.GameObjects.Image)[] = [text];
  if (hasIcon) {
    const img = scene.add.image(x, y, spec.icon!).setOrigin(0, 0).setDisplaySize(ICON_SIZE, ICON_SIZE).setDepth(3100);
    img.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    if (!enabled) img.setAlpha(0.45);
    parts.push(img);
    targets.push(img);
  }
  for (const t of targets) {
    t.setInteractive({ useHandCursor: enabled });
    if (spec.tooltip && tooltip) {
      t.on('pointerover', () => tooltip.show(spec.tooltip!.title, spec.tooltip!.body));
      t.on('pointerout', () => tooltip.hide());
    }
    if (enabled) {
      t.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        tooltip?.hide();
        spec.onClick();
      });
    }
  }
  return parts;
}

/** Width a button will take, for layout. */
function widthOf(parts: Phaser.GameObjects.GameObject[]): number {
  let right = 0;
  let left = Infinity;
  for (const p of parts) {
    const o = p as Phaser.GameObjects.Text | Phaser.GameObjects.Image;
    left = Math.min(left, o.x);
    right = Math.max(right, o.x + o.displayWidth);
  }
  return right - left;
}

/** Lays buttons out left to right, wrapping at maxWidth. */
export function buttonRow(
  scene: Phaser.Scene,
  x: number,
  y: number,
  specs: ButtonSpec[],
  maxWidth: number,
  tooltip?: Tooltip,
): Phaser.GameObjects.GameObject[] {
  const out: Phaser.GameObjects.GameObject[] = [];
  let cx = x;
  let cy = y;
  for (const spec of specs) {
    let parts = button(scene, cx, cy, spec, tooltip);
    const w = widthOf(parts);
    if (cx > x && cx + w > x + maxWidth) {
      for (const p of parts) p.destroy();
      cx = x;
      cy += ICON_SIZE + ROW_GAP;
      parts = button(scene, cx, cy, spec, tooltip);
    }
    cx += w + 10;
    out.push(...parts);
  }
  return out;
}
