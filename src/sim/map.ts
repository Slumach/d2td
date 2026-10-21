// The map: a 28 x 17 grid with one hard-coded winding path. Every tile off the path is
// buildable. It was 30 x 17 until M5's isometric view, which fits 28 + 17 tiles across the
// 1440 px canvas; the waypoints moved so the path kept its length to the unit.

import bloodmoor from '../data/map/bloodmoor.json';
import { UNITS_PER_TILE, idiv, isqrt } from './fixed.ts';

export const MAP_WIDTH = 28;
export const MAP_HEIGHT = 17;

export interface Point {
  x: number;
  y: number;
}

/** Path waypoints in tile coordinates. The ends sit just off the map so monsters walk in and out. */
export const PATH_TILES: readonly Point[] = [
  { x: -1, y: 3 },
  { x: 6, y: 3 },
  { x: 6, y: 13 },
  { x: 10, y: 13 },
  { x: 14, y: 9 },
  { x: 14, y: 3 },
  { x: 20, y: 3 },
  { x: 20, y: 13 },
  { x: 24, y: 13 },
  { x: 24, y: 7 },
  { x: 28, y: 7 },
];

export interface PathSegment {
  from: Point;
  to: Point;
  /** Distance along the path where this segment starts, in units. */
  start: number;
  length: number;
}

export interface GameMap {
  width: number;
  height: number;
  segments: PathSegment[];
  /** Total path length in units; a monster at this distance has leaked. */
  length: number;
  /** pathTiles[y * width + x] is true for tiles the path crosses. */
  pathTiles: boolean[];
  /** blocked[y * width + x] is true where scenery stands: no path, but no tower either. */
  blocked: boolean[];
}

/** Playable tiles the Blood Moor's scenery stands on (src/data/map/bloodmoor.json). */
export const BLOCKED_TILES: readonly Point[] = bloodmoor.blocked.map(([x, y]) => ({ x: x!, y: y! }));

export function tileCenter(tile: Point): Point {
  return {
    x: tile.x * UNITS_PER_TILE + UNITS_PER_TILE / 2,
    y: tile.y * UNITS_PER_TILE + UNITS_PER_TILE / 2,
  };
}

export function createMap(waypoints: readonly Point[] = PATH_TILES, blockedTiles: readonly Point[] = BLOCKED_TILES): GameMap {
  const segments: PathSegment[] = [];
  let start = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const from = tileCenter(waypoints[i - 1]!);
    const to = tileCenter(waypoints[i]!);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = isqrt(dx * dx + dy * dy);
    segments.push({ from, to, start, length });
    start += length;
  }

  const pathTiles = new Array<boolean>(MAP_WIDTH * MAP_HEIGHT).fill(false);
  for (let i = 1; i < waypoints.length; i++) {
    for (const t of tileWalk(waypoints[i - 1]!, waypoints[i]!)) {
      if (t.x >= 0 && t.x < MAP_WIDTH && t.y >= 0 && t.y < MAP_HEIGHT) {
        pathTiles[t.y * MAP_WIDTH + t.x] = true;
      }
    }
  }

  const blocked = new Array<boolean>(MAP_WIDTH * MAP_HEIGHT).fill(false);
  for (const t of blockedTiles) {
    if (t.x >= 0 && t.x < MAP_WIDTH && t.y >= 0 && t.y < MAP_HEIGHT) blocked[t.y * MAP_WIDTH + t.x] = true;
  }

  return { width: MAP_WIDTH, height: MAP_HEIGHT, segments, length: start, pathTiles, blocked };
}

/** 4-connected tiles from a to b, so a diagonal segment leaves no gaps a tower could fill. */
function tileWalk(a: Point, b: Point): Point[] {
  const tiles: Point[] = [{ ...a }];
  let { x, y } = a;
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  while (x !== b.x || y !== b.y) {
    // Step along whichever axis is further behind its share of the line
    const doneX = Math.abs(x - a.x) * Math.abs(b.y - a.y);
    const doneY = Math.abs(y - a.y) * Math.abs(b.x - a.x);
    if (x !== b.x && (y === b.y || doneX <= doneY)) x += sx;
    else y += sy;
    tiles.push({ x, y });
  }
  return tiles;
}

export function isPathTile(map: GameMap, x: number, y: number): boolean {
  return map.pathTiles[y * map.width + x] === true;
}

export function isBlocked(map: GameMap, x: number, y: number): boolean {
  return map.blocked[y * map.width + x] === true;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && x < map.width && y >= 0 && y < map.height;
}

/** Distance along the path of the path point closest to `p`, by projecting onto each segment. */
export function nearestPathDist(map: GameMap, p: Point): number {
  let best = 0;
  let bestSq = -1;
  for (const seg of map.segments) {
    const dot = (p.x - seg.from.x) * (seg.to.x - seg.from.x) + (p.y - seg.from.y) * (seg.to.y - seg.from.y);
    const offset = Math.max(0, Math.min(seg.length, idiv(dot, seg.length)));
    const q = positionAt(map, seg.start + offset);
    const dSq = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
    if (bestSq < 0 || dSq < bestSq) {
      bestSq = dSq;
      best = seg.start + offset;
    }
  }
  return best;
}

/** Position at a distance along the path, in units. */
export function positionAt(map: GameMap, dist: number): Point {
  for (const seg of map.segments) {
    if (dist < seg.start + seg.length) {
      const offset = Math.max(0, dist - seg.start);
      return {
        x: seg.from.x + idiv((seg.to.x - seg.from.x) * offset, seg.length),
        y: seg.from.y + idiv((seg.to.y - seg.from.y) * offset, seg.length),
      };
    }
  }
  const last = map.segments[map.segments.length - 1]!;
  return { ...last.to };
}
