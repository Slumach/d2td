// D2's frontend for our menus, from the player's install. HD sprites from
// hd/global/ui/frontend first; where an HD piece is missing, the classic DC6 frontend file
// stands in. D2R's menu background is a 3D scene, so the stone backdrop is always classic.
//
//   ui/frontend/bg.png        the Lord of Destruction game-select screen (800 x 600, sky palette)
//   ui/frontend/flames.png    the logo's flame strip, frames side by side (HD only: the classic
//                             logo fire traces the Diablo II letters, which we do not show)
//   ui/frontend/button.png    the wide stone button: normal, hover, pressed, disabled
//   ui/frontend/buttonmed.png the medium stone button, same states
//   ui/frontend/panel.png     the stone modal panel for Settings and the pause menu
//   ui/frontend/frontend.json sizes and frame counts for the renderer

import { decodeDc6, decodeDc6Frame } from '../lib/dc6.ts';
import { decodePalDat, type Palette } from '../lib/palette.ts';
import { encodePng } from '../lib/png.ts';
import { decodeSprite, spriteFrame } from '../lib/sprite.ts';
import type { DataSource } from './source.ts';
import type { OutputFile, SpriteJob } from './sprites.ts';

const HD = 'hd/global/ui/frontend/hd/final/';
const CLASSIC = 'global/ui/frontend/';
const PAL_SKY = 'global/palette/sky/pal.dat';
const PAL_UNITS = 'global/palette/units/pal.dat';

/** A sheet of equal frames side by side. */
export interface FrontendSheet {
  image: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  /** HD art is smoothed when scaled; classic art stays nearest-neighbour. */
  hd: boolean;
}

export interface FrontendManifest {
  bg: FrontendSheet;
  flames: FrontendSheet | null;
  button: FrontendSheet;
  buttonMed: FrontendSheet;
  panel: FrontendSheet;
}

interface Piece {
  name: string;
  hd?: string;
  /** Classic fallback: frames of a DC6 joined into states (e.g. [[0, 1], [2, 3]] for a two-part button). */
  classic?: { file: string; palette: string; states: number[][] };
}

const PIECES: Piece[] = [
  { name: 'flames', hd: 'hd/global/ui/logoanimation/logo_bottomflame.sprite' },
  { name: 'button', hd: `${HD}frontend_buttonmain.sprite`, classic: { file: `${CLASSIC}widebuttonblank.dc6`, palette: PAL_UNITS, states: [[0, 1], [0, 1], [2, 3], [0, 1]] } },
  { name: 'buttonMed', hd: `${HD}frontend_buttonmed.sprite`, classic: { file: `${CLASSIC}mediumbuttonblank.dc6`, palette: PAL_UNITS, states: [[0], [0], [1], [0]] } },
  { name: 'panel', hd: `${HD}frontend_difficultymodal.sprite`, classic: { file: `${CLASSIC}popuplargest.dc6`, palette: PAL_UNITS, states: [[0, 1, 2, 3]] } },
];
const BG = { file: `${CLASSIC}gameselectscreenexp.dc6`, palette: PAL_SKY, cols: 4 };
/** Where the backdrop says "Expansion Set / Lord of Destruction"; our title goes there instead. */
const BG_LETTERING = { x0: 236, y0: 174, x1: 566, y1: 240 };

/**
 * Paints over a box of the backdrop: each column fades from the sky just above the box to
 * the sky just below it, with a little grain so it does not read as a smear. The title and
 * its glow are drawn over this spot, so it only has to be quiet, not perfect.
 */
function eraseLettering(rgba: Uint8Array, width: number, box: { x0: number; y0: number; x1: number; y1: number }): void {
  let seed = 7;
  const grain = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296 - 0.5) * 6;
  for (let x = box.x0; x < box.x1; x++) {
    const above = (box.y0 - 1) * width + x;
    const below = box.y1 * width + x;
    for (let y = box.y0; y < box.y1; y++) {
      const t = (y - box.y0 + 1) / (box.y1 - box.y0 + 1);
      const o = (y * width + x) * 4;
      for (let k = 0; k < 3; k++) {
        const v = rgba[above * 4 + k]! * (1 - t) + rgba[below * 4 + k]! * t + grain();
        rgba[o + k] = Math.max(0, Math.min(255, Math.round(v)));
      }
      rgba[o + 3] = 255;
    }
  }
}

/** Joins RGBA frames of one height side by side. */
function strip(frames: { rgba: Uint8Array; w: number; h: number }[]): { rgba: Uint8Array; w: number; h: number } {
  const w = Math.max(...frames.map((f) => f.w));
  const h = Math.max(...frames.map((f) => f.h));
  const W = w * frames.length;
  const rgba = new Uint8Array(W * h * 4);
  frames.forEach((f, i) => {
    for (let y = 0; y < f.h; y++) rgba.set(f.rgba.subarray(y * f.w * 4, (y + 1) * f.w * 4), (y * W + i * w) * 4);
  });
  return { rgba, w, h };
}

function dc6Rgba(source: DataSource, file: string, palette: Palette, index: number): { rgba: Uint8Array; w: number; h: number } {
  const f = decodeDc6(source.read(file)).frames[index]!;
  const idx = decodeDc6Frame(f);
  const rgba = new Uint8Array(idx.length * 4);
  idx.forEach((c, i) => c && rgba.set(palette.subarray(c * 4, c * 4 + 4), i * 4));
  return { rgba, w: f.width, h: f.height };
}

/** A classic state made of several DC6 frames laid left to right (wide buttons come in two parts). */
function classicState(source: DataSource, file: string, palette: Palette, parts: number[]): { rgba: Uint8Array; w: number; h: number } {
  const frames = parts.map((i) => dc6Rgba(source, file, palette, i));
  const w = frames.reduce((n, f) => n + f.w, 0);
  const h = Math.max(...frames.map((f) => f.h));
  const rgba = new Uint8Array(w * h * 4);
  let x = 0;
  for (const f of frames) {
    for (let y = 0; y < f.h; y++) rgba.set(f.rgba.subarray(y * f.w * 4, (y + 1) * f.w * 4), (y * w + x) * 4);
    x += f.w;
  }
  return { rgba, w, h };
}

export function frontendJob(source: DataSource): SpriteJob {
  const pick = PIECES.map((p) => ({ ...p, useHd: p.hd !== undefined && source.exists(p.hd) }));
  const inputs = [BG.file, PAL_SKY, PAL_UNITS];
  for (const p of pick) {
    if (p.useHd) inputs.push(p.hd!);
    else if (p.classic) inputs.push(p.classic.file);
  }
  return {
    label: 'frontend',
    inputs,
    run: () => {
      const out: OutputFile[] = [];
      const sheets: Record<string, FrontendSheet | null> = {};
      const emit = (name: string, s: { rgba: Uint8Array; w: number; h: number }, frames: number, hd: boolean) => {
        const image = `ui/frontend/${name.toLowerCase()}.png`;
        out.push({ path: image, bytes: encodePng(s.w * frames, s.h, s.rgba) });
        sheets[name] = { image, frameWidth: s.w, frameHeight: s.h, frames, hd };
      };

      // The backdrop: 256 px tiles in rows of four (the last column is 32 px wide)
      const sky = decodePalDat(source.read(BG.palette));
      const bg = decodeDc6(source.read(BG.file));
      const cols = BG.cols;
      const widths = bg.frames.slice(0, cols).map((f) => f.width);
      const W = widths.reduce((a, b) => a + b, 0);
      const rows = Math.ceil(bg.frames.length / cols);
      const H = bg.frames.filter((_, i) => i % cols === 0).reduce((n, f) => n + f.height, 0);
      const rgba = new Uint8Array(W * H * 4);
      let oy = 0;
      for (let r = 0; r < rows; r++) {
        let ox = 0;
        for (let c = 0; c < cols; c++) {
          const f = bg.frames[r * cols + c]!;
          const idx = decodeDc6Frame(f);
          for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
            const k = idx[y * f.width + x]!;
            if (k) rgba.set(sky.subarray(k * 4, k * 4 + 4), ((oy + y) * W + ox + x) * 4);
          }
          ox += f.width;
        }
        oy += bg.frames[r * cols]!.height;
      }
      eraseLettering(rgba, W, BG_LETTERING);
      emit('bg', { rgba, w: W, h: H }, 1, false);

      for (const p of pick) {
        if (p.useHd) {
          const sheet = decodeSprite(source.read(p.hd!));
          const frames = Array.from({ length: sheet.frameCount }, (_, i) => ({ rgba: spriteFrame(sheet, i), w: sheet.frameWidth, h: sheet.frameHeight }));
          emit(p.name, strip(frames), sheet.frameCount, true);
        } else if (p.classic) {
          const pal = decodePalDat(source.read(p.classic.palette));
          const states = p.classic.states.map((parts) => classicState(source, p.classic!.file, pal, parts));
          emit(p.name, strip(states), states.length, false);
        } else {
          sheets[p.name] = null;
        }
      }
      const manifest = sheets as unknown as FrontendManifest;
      out.push({ path: 'ui/frontend/frontend.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      return out;
    },
  };
}
