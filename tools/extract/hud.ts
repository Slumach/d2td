// D2R's in-game HUD pieces for our control panel, from the player's install:
//
//   ui/hud/panel.png   the control panel: angel and demon with their globes, the stone bar,
//                      two skill-slot squares and four belt slots (hud_02/front_panel)
//   ui/hud/globe.png   the red life liquid, every other frame of its idle animation
//   ui/hud/globemana.png  the same liquid turned blue (red and blue swapped), for the
//                      mana orb: D2R colours one sprite for both
//   ui/hud/gold.png    the gold pile icon
//   ui/hud/slot.png    the gold slot frame D2R draws round a chosen skill (normal, lit)
//   ui/hud/character.png, skilltree.png, questlog.png, inventory.png, automap.png,
//   messages.png, pausemenu.png   the mini-menu buttons under the stone bar (normal,
//                      pressed, hover)
//   ui/hud/sprint.png  the run/walk button, walk and run x normal, pressed, hover
//   ui/hud/staminabar.png, expbar.png   the stamina and experience bars
//   ui/hud/beltarrow.png   the belt's pop-up arrow
//   ui/hud/goldbutton.png  the gold button (normal, hover, disabled, pressed)
//   ui/hud/invbg.png   the inventory panel, invtab.png its weapon-swap tabs (lit, dark)
//                      and invclose.png its close button
//   ui/hud/hud.json    sizes and frame counts
//
// HD only. Without these the game keeps its plain panel.

import { encodePng } from '../lib/png.ts';
import { decodeSprite, spriteFrame } from '../lib/sprite.ts';
import type { DataSource } from './source.ts';
import type { OutputFile, SpriteJob } from './sprites.ts';

const GLOBE = 'hd/global/ui/panel/hud_02/healthmanaanimation/healthidle/4k/globe_health_man_idle.sprite';
const HUD = 'hd/global/ui/panel/hud_02/';

interface Piece {
  file: string;
  /** Keep every nth frame. */
  every: number;
  /** Swap red and blue: the red life liquid turned into the blue mana one. */
  swapRB?: boolean;
}

const PIECES: Record<string, Piece> = {
  panel: { file: `${HUD}front_panel.sprite`, every: 1 },
  globe: { file: GLOBE, every: 2 },
  globeMana: { file: GLOBE, every: 2, swapRB: true },
  gold: { file: 'hd/global/ui/items/misc/gold/gold.sprite', every: 1 },
  slot: { file: 'hd/global/ui/panel/skillselect/selected.sprite', every: 1 },
  character: { file: `${HUD}character.sprite`, every: 1 },
  skilltree: { file: `${HUD}skilltree.sprite`, every: 1 },
  questlog: { file: `${HUD}questlog.sprite`, every: 1 },
  inventory: { file: `${HUD}inventory.sprite`, every: 1 },
  automap: { file: `${HUD}automap.sprite`, every: 1 },
  messages: { file: `${HUD}messages.sprite`, every: 1 },
  pausemenu: { file: `${HUD}pausemenu.sprite`, every: 1 },
  sprint: { file: `${HUD}sprint.sprite`, every: 1 },
  staminaBar: { file: `${HUD}stamina_bar.sprite`, every: 1 },
  expBar: { file: `${HUD}experience_bar.sprite`, every: 1 },
  beltArrow: { file: `${HUD}belt_uparrow.sprite`, every: 1 },
  goldButton: { file: 'hd/global/ui/panel/goldbutton.sprite', every: 1 },
  invBg: { file: 'hd/global/ui/panel/inventory/background.sprite', every: 1 },
  invTab: { file: 'hd/global/ui/panel/inventory/tab.sprite', every: 1 },
  invClose: { file: 'hd/global/ui/panel/inventory/button.sprite', every: 1 },
};

export interface HudSheet {
  image: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
}

export type HudManifest = Record<string, HudSheet>;

export function hudJob(source: DataSource): SpriteJob {
  return {
    label: 'hud',
    inputs: [...new Set(Object.values(PIECES).map((p) => p.file))],
    run: () => {
      const out: OutputFile[] = [];
      const manifest = {} as HudManifest;
      for (const [name, piece] of Object.entries(PIECES)) {
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
          if (piece.swapRB) for (let p = 0; p < frame.length; p += 4) [frame[p], frame[p + 2]] = [frame[p + 2]!, frame[p]!];
          const x0 = (i % cols) * w;
          const y0 = Math.floor(i / cols) * h;
          for (let y = 0; y < h; y++) rgba.set(frame.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * W + x0) * 4);
        });
        const image = `ui/hud/${name.toLowerCase()}.png`;
        out.push({ path: image, bytes: encodePng(W, h * rows, rgba) });
        manifest[name] = { image, frameWidth: w, frameHeight: h, frames: picks.length };
      }
      out.push({ path: 'ui/hud/hud.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      return out;
    },
  };
}
