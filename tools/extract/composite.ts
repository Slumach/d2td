// Composites the per-layer DCC animations of one COF into full frames.
// Draw order follows OpenDiablo2 d2core/d2asset/composite.go (Render): for each frame,
// cof.priority lists the layer types back to front. One difference: OpenDiablo2 looks up
// the priority row through Dir64ToCof while layers use Dir64ToDcc, which disagree for 8
// directions. Here both use the file's own direction index, so a frame's priority row and
// its layer pixels always describe the same facing.

import { DrawEffect, compositeCode, type Cof } from '../lib/cof.ts';
import type { Dcc, Rect } from '../lib/dcc.ts';
import type { Palette } from '../lib/palette.ts';

export interface CompositeLayer {
  type: number;
  dcc: Dcc;
  /** 0 to 255 opacity from the COF draw effect. */
  alpha: number;
  /**
   * Glow layers (draw effects Modulate and beyond: spirits, auras on bodies) are blended
   * by the game at draw time. A sheet cannot, so they are baked as additive: on the body
   * the colours add; on empty pixels black turns transparent and brightness becomes alpha,
   * which over the ground reads close to ground + glow.
   */
  additive?: boolean;
}

/** True for COF draw effects the game blends at draw time rather than by a fixed alpha. */
export function isGlowEffect(transparent: boolean, drawEffect: number): boolean {
  return transparent && drawEffect >= DrawEffect.Modulate && drawEffect !== DrawEffect.None;
}

export interface CompositeResult {
  frameWidth: number;
  frameHeight: number;
  /** Position of the sprite origin (the feet) inside every frame. */
  originX: number;
  originY: number;
  /** frames[direction][frame] is frameWidth x frameHeight RGBA. */
  frames: Uint8Array[][];
}

export function layerAlpha(transparent: boolean, drawEffect: number): number {
  if (!transparent) return 255;
  switch (drawEffect) {
    case DrawEffect.PctTransparency25:
      return 191;
    case DrawEffect.PctTransparency50:
      return 128;
    case DrawEffect.PctTransparency75:
      return 64;
    default:
      return 255;
  }
}

export function composite(cof: Cof, layers: CompositeLayer[], palette: Palette): CompositeResult {
  const byType = new Map<number, CompositeLayer>();
  for (const layer of layers) {
    if (layer.dcc.numberOfDirections !== cof.numberOfDirections) {
      throw new Error(
        `Layer ${compositeCode(layer.type)} has ${layer.dcc.numberOfDirections} directions, COF has ${cof.numberOfDirections}`,
      );
    }
    // The COF sets the frame count; a layer with extra frames (Blood Raven's death S3 has
    // 25 for 24) is cut, one with fewer wraps, as the game plays them
    if (layer.dcc.framesPerDirection === 0) throw new Error(`Layer ${compositeCode(layer.type)} has no frames`);
    byType.set(layer.type, layer);
  }

  // One shared box across all directions keeps the origin fixed for every frame.
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const layer of layers) {
    for (const dir of layer.dcc.directions) {
      left = Math.min(left, dir.box.left);
      top = Math.min(top, dir.box.top);
      right = Math.max(right, dir.box.left + dir.box.width);
      bottom = Math.max(bottom, dir.box.top + dir.box.height);
    }
  }
  const frameWidth = right - left;
  const frameHeight = bottom - top;

  const frames: Uint8Array[][] = [];
  for (let d = 0; d < cof.numberOfDirections; d++) {
    const dirFrames: Uint8Array[] = [];
    for (let f = 0; f < cof.framesPerDirection; f++) {
      const out = new Uint8Array(frameWidth * frameHeight * 4);
      for (const type of cof.priority[d]![f]!) {
        const layer = byType.get(type);
        if (!layer) continue;
        const dir = layer.dcc.directions[d]!;
        const pixels = dir.frames[f % dir.frames.length]!.pixelData;
        if (layer.additive) blitAdditive(out, frameWidth, dir.box, pixels, left, top, palette);
        else blit(out, frameWidth, dir.box, pixels, left, top, palette, layer.alpha);
      }
      dirFrames.push(out);
    }
    frames.push(dirFrames);
  }

  return { frameWidth, frameHeight, originX: -left, originY: -top, frames };
}

function blitAdditive(
  out: Uint8Array,
  outWidth: number,
  box: Rect,
  indices: Uint8Array,
  originLeft: number,
  originTop: number,
  palette: Palette,
): void {
  const dx = box.left - originLeft;
  const dy = box.top - originTop;
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const index = indices[x + y * box.width]!;
      if (index === 0) continue;
      const o = (x + dx + (y + dy) * outWidth) * 4;
      const r = palette[index * 4]!;
      const g = palette[index * 4 + 1]!;
      const b = palette[index * 4 + 2]!;
      const glow = Math.max(r, g, b);
      if (glow === 0) continue;
      const da = out[o + 3]!;
      if (da === 255) {
        // On the body: colours add
        out[o] = Math.min(255, out[o]! + r);
        out[o + 1] = Math.min(255, out[o + 1]! + g);
        out[o + 2] = Math.min(255, out[o + 2]! + b);
        continue;
      }
      // On empty or translucent pixels: brightness is the alpha, colour is unpremultiplied
      const a = Math.max(da, glow);
      out[o] = Math.min(255, Math.trunc((r * 255) / glow));
      out[o + 1] = Math.min(255, Math.trunc((g * 255) / glow));
      out[o + 2] = Math.min(255, Math.trunc((b * 255) / glow));
      out[o + 3] = a;
    }
  }
}

function blit(
  out: Uint8Array,
  outWidth: number,
  box: Rect,
  indices: Uint8Array,
  originLeft: number,
  originTop: number,
  palette: Palette,
  alpha: number,
): void {
  const dx = box.left - originLeft;
  const dy = box.top - originTop;
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const index = indices[x + y * box.width]!;
      if (index === 0) continue;
      const o = (x + dx + (y + dy) * outWidth) * 4;
      const p = index * 4;
      if (alpha === 255) {
        out[o] = palette[p]!;
        out[o + 1] = palette[p + 1]!;
        out[o + 2] = palette[p + 2]!;
        out[o + 3] = 255;
        continue;
      }
      // Source-over blend in integer math
      const da = out[o + 3]!;
      const outA = alpha + Math.trunc((da * (255 - alpha)) / 255);
      for (let c = 0; c < 3; c++) {
        const src = palette[p + c]!;
        const dst = out[o + c]!;
        out[o + c] = Math.trunc((src * alpha + Math.trunc((dst * da * (255 - alpha)) / 255)) / outA);
      }
      out[o + 3] = outA;
    }
  }
}
