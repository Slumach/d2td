// Small Phaser UI helpers: text buttons and a rebuildable panel.

import Phaser from 'phaser';

export const FONT = 'monospace';

export interface ButtonSpec {
  label: string;
  onClick: () => void;
  enabled?: boolean;
  colour?: string;
}

/** A text button; disabled ones are dimmed and ignore clicks. */
export function button(scene: Phaser.Scene, x: number, y: number, spec: ButtonSpec): Phaser.GameObjects.Text {
  const enabled = spec.enabled ?? true;
  const text = scene.add
    .text(x, y, spec.label, {
      fontFamily: FONT,
      fontSize: '20px',
      color: enabled ? '#f0e8d0' : '#807868',
      backgroundColor: enabled ? (spec.colour ?? '#4a3420') : '#2a2420',
      padding: { x: 10, y: 6 },
    })
    .setDepth(30);
  if (enabled) {
    text.setInteractive({ useHandCursor: true }).on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      spec.onClick();
    });
  }
  return text;
}

/** Lays buttons out left to right, wrapping at maxWidth. */
export function buttonRow(scene: Phaser.Scene, x: number, y: number, specs: ButtonSpec[], maxWidth: number): Phaser.GameObjects.Text[] {
  const out: Phaser.GameObjects.Text[] = [];
  let cx = x;
  let cy = y;
  for (const spec of specs) {
    const b = button(scene, cx, cy, spec);
    if (cx > x && cx + b.width > x + maxWidth) {
      cx = x;
      cy += b.height + 8;
      b.setPosition(cx, cy);
    }
    cx += b.width + 8;
    out.push(b);
  }
  return out;
}
