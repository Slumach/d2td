// D2's 2:1 isometric view of the square sim grid. The sim never changes: positions stay in
// units on a square grid, and only the renderer projects them. One sim tile is a 64 x 32
// diamond, two by two of D2's 32 x 16 subtiles. Sim +x runs down-right on screen, +y down-left.
//
// Positions here are world pixels: the ring is bigger than the screen, and the world camera
// pans and zooms over it (GameScene). WORLD_WIDTH x WORLD_HEIGHT holds the whole diamond with
// room above for tall sprites on the far rows.

import { UNITS_PER_TILE } from '../sim/fixed.ts';
import { MAP_SIZE } from '../sim/map.ts';

export const ISO_W = 64;
export const ISO_H = 32;
const HALF_W = ISO_W / 2;
const HALF_H = ISO_H / 2;

/** The whole diamond, in world pixels. */
export const MAP_PX_WIDTH = (MAP_SIZE + MAP_SIZE) * HALF_W;
export const MAP_PX_HEIGHT = (MAP_SIZE + MAP_SIZE) * HALF_H;
/** Margin round the diamond: tall sprites and scenery stand above its far edge. */
const PAD = 160;

/** World position of sim tile corner (0, 0): the top of the diamond. */
export const ORIGIN = { x: PAD + MAP_SIZE * HALF_W, y: PAD };
export const WORLD_WIDTH = MAP_PX_WIDTH + 2 * PAD;
export const WORLD_HEIGHT = MAP_PX_HEIGHT + 2 * PAD;

export interface ScreenPoint {
  x: number;
  y: number;
}

/** World position of a sim point in units. */
export function project(x: number, y: number): ScreenPoint {
  return {
    x: ORIGIN.x + ((x - y) * HALF_W) / UNITS_PER_TILE,
    y: ORIGIN.y + ((x + y) * HALF_H) / UNITS_PER_TILE,
  };
}

/** World position of a tile corner, in tile coordinates. */
export function projectTile(tx: number, ty: number): ScreenPoint {
  return project(tx * UNITS_PER_TILE, ty * UNITS_PER_TILE);
}

/** The tile under a world point, or undefined off the map. */
export function tileAtWorld(wx: number, wy: number): { x: number; y: number } | undefined {
  const a = (wx - ORIGIN.x) / HALF_W;
  const b = (wy - ORIGIN.y) / HALF_H;
  const x = Math.floor((a + b) / 2);
  const y = Math.floor((b - a) / 2);
  return x >= 0 && x < MAP_SIZE && y >= 0 && y < MAP_SIZE ? { x, y } : undefined;
}

/** A sim-space direction as the screen-space vector D2's sprite directions are drawn for. */
export function screenVector(dx: number, dy: number): ScreenPoint {
  return { x: (dx - dy) * 2, y: dx + dy };
}

/** A sim circle of `radius` units seen in the 2:1 view: the full width and height of its ellipse. */
export function ellipseOf(radius: number): { w: number; h: number } {
  const r = (radius / UNITS_PER_TILE) * Math.SQRT2;
  return { w: 2 * r * HALF_W, h: 2 * r * HALF_H };
}

/** The four corners of a tile's diamond, top, right, bottom, left. */
export function tileDiamond(tx: number, ty: number): ScreenPoint[] {
  return [projectTile(tx, ty), projectTile(tx + 1, ty), projectTile(tx + 1, ty + 1), projectTile(tx, ty + 1)];
}
