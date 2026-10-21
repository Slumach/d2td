// D2's 2:1 isometric view of the square sim grid. The sim never changes: positions stay in
// units on a square grid, and only the renderer projects them. One sim tile is a 64 x 32
// diamond, two by two of D2's 32 x 16 subtiles. Sim +x runs down-right on screen, +y down-left.

import { UNITS_PER_TILE } from '../sim/fixed.ts';
import { MAP_HEIGHT, MAP_WIDTH } from '../sim/map.ts';
import { GAME_WIDTH, HUD_HEIGHT, MAP_AREA_HEIGHT } from './layout.ts';

export const ISO_W = 64;
export const ISO_H = 32;
const HALF_W = ISO_W / 2;
const HALF_H = ISO_H / 2;

/** The whole diamond, in screen pixels. */
export const MAP_PX_WIDTH = (MAP_WIDTH + MAP_HEIGHT) * HALF_W;
export const MAP_PX_HEIGHT = (MAP_WIDTH + MAP_HEIGHT) * HALF_H;
/** Space above the top corner for the tall sprites standing on the first row. */
const TOP_MARGIN = Math.floor((MAP_AREA_HEIGHT - MAP_PX_HEIGHT) * 2 / 3);

/** Screen position of sim tile corner (0, 0): the top of the diamond. Centred horizontally. */
export const ORIGIN = {
  x: GAME_WIDTH / 2 - ((MAP_WIDTH - MAP_HEIGHT) * HALF_W) / 2,
  y: HUD_HEIGHT + TOP_MARGIN,
};

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Screen position of a sim point in units. */
export function project(x: number, y: number): ScreenPoint {
  return {
    x: ORIGIN.x + ((x - y) * HALF_W) / UNITS_PER_TILE,
    y: ORIGIN.y + ((x + y) * HALF_H) / UNITS_PER_TILE,
  };
}

/** Screen position of a tile corner, in tile coordinates. */
export function projectTile(tx: number, ty: number): ScreenPoint {
  return project(tx * UNITS_PER_TILE, ty * UNITS_PER_TILE);
}

/** The tile under a screen point, or undefined off the map. */
export function tileAtScreen(sx: number, sy: number): { x: number; y: number } | undefined {
  const a = (sx - ORIGIN.x) / HALF_W;
  const b = (sy - ORIGIN.y) / HALF_H;
  const x = Math.floor((a + b) / 2);
  const y = Math.floor((b - a) / 2);
  return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT ? { x, y } : undefined;
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
