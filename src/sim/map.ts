// The map: a ring of four identical arcs on a square grid (src/data/map/ring.json).
// Monsters spawn on the ring and keep lapping it until they are killed; nothing ever leaves.
//
// Each arc, in walking order: a long outer straight, a U-bend dented into the interior
// (its one-tile pocket touches all three legs), then a 90 degree corner that hands the
// path to the next arc. ring.json gives arc 0 (the top edge, walking east) and the scenery
// on its wedge, by kind; the other three are the same turned 90, 180 and 270 degrees about the
// centre, so every player's arc is identical. That needs a square grid: 42 x 42 has the
// tile count of the 48 x 36 the design asked for.

import ring from '../data/map/ring.json';
import { UNITS_PER_TILE, idiv, isqrt } from './fixed.ts';

export const MAP_SIZE = ring.size;
export const ARC_COUNT = 4;

export interface Point {
  x: number;
  y: number;
}

export interface PathSegment {
  from: Point;
  to: Point;
  /** Distance along the ring where this segment starts, in units. */
  start: number;
  length: number;
}

export interface Arc {
  /** Ring distance of the arc's first corner (the handoff into it). */
  start: number;
  /** Ring distance where its monsters spawn: the middle of its side, halfway from its corner to the next. */
  spawn: number;
}

export interface GameMap {
  width: number;
  height: number;
  segments: PathSegment[];
  /** Ring length in units; distances wrap at it. */
  length: number;
  arcs: Arc[];
  /** pathTiles[y * width + x] is true for tiles the path crosses. */
  pathTiles: boolean[];
  /** blocked[y * width + x] is true where scenery stands: no path, but no tower either. */
  blocked: boolean[];
  /** arcTiles[y * width + x] is the arc whose wedge holds the tile (whose player may build there). */
  arcTiles: number[];
}

/** A tile turned 90 degrees clockwise (on screen, sim +x right and +y down) about the grid centre, `times` times. */
export function rotateTile(p: Point, times: number, size = MAP_SIZE): Point {
  let { x, y } = p;
  for (let i = 0; i < ((times % 4) + 4) % 4; i++) [x, y] = [size - 1 - y, x];
  return { x, y };
}

/**
 * The arc whose wedge holds a tile. Arc 0's wedge is the top quarter between the diagonals,
 * half-open so the four wedges tile the grid exactly: v <= u < -v about the centre, in
 * doubled coordinates to stay integer. Each arc owns the corner that hands the path to it.
 */
export function arcOfTile(p: Point, size = MAP_SIZE): number {
  for (let k = 0; k < ARC_COUNT; k++) {
    // Turn the tile back into arc 0's frame and test its wedge
    const q = rotateTile(p, ARC_COUNT - k, size);
    const u = 2 * q.x - (size - 1);
    const v = 2 * q.y - (size - 1);
    if (v <= u && u < -v) return k;
  }
  return 0;
}

export function tileCenter(tile: Point): Point {
  return {
    x: tile.x * UNITS_PER_TILE + UNITS_PER_TILE / 2,
    y: tile.y * UNITS_PER_TILE + UNITS_PER_TILE / 2,
  };
}

/** The ring's corner waypoints in walking order, arc by arc, starting at arc 0's first corner. */
export function ringWaypoints(): Point[] {
  const arc = ring.arc.map(([x, y]) => ({ x: x!, y: y! }));
  return Array.from({ length: ARC_COUNT }, (_, k) => arc.map((p) => rotateTile(p, k))).flat();
}

export type SceneryKind = keyof typeof ring.scenery;

/**
 * ring.json's scenery of one kind on arc 0's wedge, turned onto all four: the treeline
 * round the edge, rocks at the arc boundaries, bushes, and the cottage in the middle. The
 * map bake puts its art on exactly these tiles, so the mask and the picture agree.
 */
export function sceneryTiles(kind: SceneryKind): Point[] {
  const out = new Map<string, Point>();
  for (const [x, y] of ring.scenery[kind]) {
    for (let k = 0; k < ARC_COUNT; k++) {
      const t = rotateTile({ x: x!, y: y! }, k);
      out.set(`${t.x},${t.y}`, t);
    }
  }
  return [...out.values()];
}

/** Every tile scenery stands on. */
export function blockedTiles(): Point[] {
  return (Object.keys(ring.scenery) as SceneryKind[]).flatMap(sceneryTiles);
}

export function createMap(): GameMap {
  const size = MAP_SIZE;
  const corners = ringWaypoints();
  // Closed: the last corner walks back to the first
  const loop = [...corners, corners[0]!];
  const segments: PathSegment[] = [];
  let start = 0;
  const startOf: number[] = [];
  for (let i = 1; i < loop.length; i++) {
    startOf.push(start);
    const from = tileCenter(loop[i - 1]!);
    const to = tileCenter(loop[i]!);
    const length = isqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
    segments.push({ from, to, start, length });
    start += length;
  }
  const perArc = ring.arc.length;
  const arcs = Array.from({ length: ARC_COUNT }, (_, k) => {
    const s = startOf[k * perArc]!;
    // The side runs from this arc's corner to the next arc's, which is the first turned a quarter
    const side = (size - 1 - 2 * ring.arc[0]![0]!) * UNITS_PER_TILE;
    return { start: s, spawn: s + idiv(side, 2) };
  });

  const pathTiles = new Array<boolean>(size * size).fill(false);
  for (let i = 1; i < loop.length; i++) {
    for (const t of tileWalk(loop[i - 1]!, loop[i]!)) pathTiles[t.y * size + t.x] = true;
  }
  const blocked = new Array<boolean>(size * size).fill(false);
  for (const t of blockedTiles()) if (!pathTiles[t.y * size + t.x]) blocked[t.y * size + t.x] = true;
  const arcTiles = Array.from({ length: size * size }, (_, i) => arcOfTile({ x: i % size, y: Math.floor(i / size) }, size));

  return { width: size, height: size, segments, length: start, arcs, pathTiles, blocked, arcTiles };
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

/** The arc a tile belongs to. */
export function arcAt(map: GameMap, x: number, y: number): number {
  return map.arcTiles[y * map.width + x] ?? 0;
}

/** A ring distance wrapped into [0, length). */
export function wrap(map: GameMap, dist: number): number {
  return ((dist % map.length) + map.length) % map.length;
}

/** How far ahead `to` lies from `from` along the ring, in (-length/2, length/2]: negative is behind. */
export function ahead(map: GameMap, from: number, to: number): number {
  const d = wrap(map, to - from);
  return d > map.length / 2 ? d - map.length : d;
}

/** Ring distance of the path point closest to `p`, by projecting onto each segment. */
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
  return wrap(map, best);
}

/** Position at a ring distance, in units; any distance wraps around the ring. */
export function positionAt(map: GameMap, dist: number): Point {
  const d = wrap(map, dist);
  for (const seg of map.segments) {
    if (d < seg.start + seg.length) {
      const offset = d - seg.start;
      return {
        x: seg.from.x + idiv((seg.to.x - seg.from.x) * offset, seg.length),
        y: seg.from.y + idiv((seg.to.y - seg.from.y) * offset, seg.length),
      };
    }
  }
  return { ...map.segments[0]!.from };
}
