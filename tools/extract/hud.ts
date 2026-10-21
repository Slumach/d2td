// D2R's in-game HUD pieces for our control panel, from the player's install:
//
//   ui/hud/panel.png   the control panel: angel and demon with their globes, the stone bar,
//                      two skill-slot squares and four belt slots (hud_02/front_panel)
//   ui/hud/globe.png   the red life liquid, every other frame of its idle animation
//   ui/hud/gold.png    the gold pile icon
//   ui/hud/slot.png    the gold slot frame D2R draws round a chosen skill (normal, lit)
//   ui/hud/hud.json    sizes and frame counts
//
// HD only. Without these the game keeps its plain panel.

import { encodePng } from '../lib/png.ts';
import { decodeSprite, spriteFrame } from '../lib/sprite.ts';
import type { DataSource } from './source.ts';
import type { OutputFile, SpriteJob } from './sprites.ts';

const PIECES = {
  panel: { file: 'hd/global/ui/panel/hud_02/front_panel.sprite', every: 1 },
  globe: { file: 'hd/global/ui/panel/hud_02/healthmanaanimation/healthidle/4k/globe_health_man_idle.sprite', every: 2 },
  gold: { file: 'hd/global/ui/items/misc/gold/gold.sprite', every: 1 },
  slot: { file: 'hd/global/ui/panel/skillselect/selected.sprite', every: 1 },
};

export interface HudSheet {
  image: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
}

export type HudManifest = Record<keyof typeof PIECES, HudSheet>;

export function hudJob(source: DataSource): SpriteJob {
  return {
    label: 'hud',
    inputs: Object.values(PIECES).map((p) => p.file),
    run: () => {
      const out: OutputFile[] = [];
      const manifest = {} as HudManifest;
      for (const [name, piece] of Object.entries(PIECES) as [keyof typeof PIECES, (typeof PIECES)[keyof typeof PIECES]][]) {
        const sheet = decodeSprite(source.read(piece.file));
        const picks = Array.from({ length: Math.ceil(sheet.frameCount / piece.every) }, (_, i) => i * piece.every);
        const w = sheet.frameWidth;
        const h = sheet.frameHeight;
        // Frames left to right, wrapping into rows so no side passes 4096 px (a common GPU limit)
        const cols = Math.max(1, Math.min(picks.length, Math.floor(4096 / w)));
        const rows = Math.ceil(picks.length / cols);
        const W = w * cols;
        const rgba = new Uint8Array(W * h * rows * 4);
        picks.forEach((f, i) => {
          const frame = spriteFrame(sheet, f);
          const x0 = (i % cols) * w;
          const y0 = Math.floor(i / cols) * h;
          for (let y = 0; y < h; y++) rgba.set(frame.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * W + x0) * 4);
        });
        const image = `ui/hud/${name}.png`;
        out.push({ path: image, bytes: encodePng(W, h * rows, rgba) });
        manifest[name] = { image, frameWidth: w, frameHeight: h, frames: picks.length };
      }
      out.push({ path: 'ui/hud/hud.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      return out;
    },
  };
}
