// Eternal Conflict: a creep crosses a build pad on its own feet, not on a drawn road. The pad
// is a grid of tiles, its standing fighters are walls, and a cost field counted back from the
// pad's exit row guides every creep down the shortest way round them. A pad walled right
// across has no way through: the field is then built without walls, so the creeps walk into
// the wall and fight it. Fields are cached on the sim by the walls they were built from
// (not state: every client rebuilds the same field from the same towers).

import { standing } from './battle.ts';
import { LANE } from './map.ts';
import { idiv } from './fixed.ts';
import type { Sim } from './state.ts';

export interface PadField {
  /** The pad's columns and its exit row (the first row past the buildable ground). */
  x0: number;
  x1: number;
  y1: number;
  /** cost[y * width + (x - x0)]: steps to the exit, ten a straight step and fourteen a diagonal; INF where walled off. */
  cost: number[];
  walls: boolean[];
}

export const INF = 1 << 30;

/** The eight steps, downhill first so ties fall toward the exit, then by x so every client picks alike. */
const STEPS: readonly (readonly [number, number, number])[] = [
  [0, 1, 10],
  [-1, 1, 14],
  [1, 1, 14],
  [-1, 0, 10],
  [1, 0, 10],
  [-1, -1, 14],
  [1, -1, 14],
  [0, -1, 10],
];

/** A lane's pad: its columns and the exit row below its buildable ground. */
export function padBounds(sim: Sim, lane: number): { x0: number; x1: number; y1: number } {
  const cx = sim.map.laneColumns?.[lane] ?? 0;
  const half = idiv(LANE.width, 2);
  return { x0: cx - half, x1: cx + half, y1: LANE.lastBuildRow + 1 };
}

/** The tiles this lane's standing fighters hold, as the field's walls. */
function wallsOf(sim: Sim, b: { x0: number; x1: number; y1: number }): boolean[] {
  const w = b.x1 - b.x0 + 1;
  const walls = new Array<boolean>(w * (b.y1 + 1)).fill(false);
  for (const t of sim.state.towers) {
    if (t.legendOf !== undefined || t.atKing || !standing(sim, t)) continue;
    if (t.tileX < b.x0 || t.tileX > b.x1 || t.tileY < 0 || t.tileY >= b.y1) continue;
    walls[t.tileY * w + (t.tileX - b.x0)] = true;
  }
  return walls;
}

/** Dijkstra from the exit row over the pad, walls impassable, no cutting a wall's corner. */
function build(b: { x0: number; x1: number; y1: number }, walls: boolean[]): PadField {
  const w = b.x1 - b.x0 + 1;
  const h = b.y1 + 1;
  const n = w * h;
  const cost = new Array<number>(n).fill(INF);
  const done = new Array<boolean>(n).fill(false);
  for (let x = 0; x < w; x++) cost[b.y1 * w + x] = 0;
  const open = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h && !walls[y * w + x];
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && cost[i]! < INF && (u < 0 || cost[i]! < cost[u]!)) u = i;
    if (u < 0) break;
    done[u] = true;
    const ux = u % w;
    const uy = idiv(u, w);
    for (const [dx, dy, c] of STEPS) {
      const vx = ux + dx;
      const vy = uy + dy;
      if (!open(vx, vy)) continue;
      if (dx !== 0 && dy !== 0 && (!open(ux + dx, uy) || !open(ux, uy + dy))) continue;
      const v = vy * w + vx;
      if (cost[u]! + c < cost[v]!) cost[v] = cost[u]! + c;
    }
  }
  return { ...b, cost, walls };
}

/** The lane's field for its fighters as they stand now, or the open field with no walls. */
export function padField(sim: Sim, lane: number, openField = false): PadField {
  const b = padBounds(sim, lane);
  const walls = openField ? new Array<boolean>((b.x1 - b.x0 + 1) * (b.y1 + 1)).fill(false) : wallsOf(sim, b);
  const key = `${lane}:${openField ? 'open' : walls.map((v) => (v ? 1 : 0)).join('')}`;
  const cache = (sim.padFields ??= {});
  const hit = cache[key];
  if (hit) return hit;
  if (Object.keys(cache).length > 64) for (const k of Object.keys(cache)) delete cache[k];
  return (cache[key] = build(b, walls));
}

/** The field's cost at a tile, INF off the pad or walled off. */
export function costAt(f: PadField, x: number, y: number): number {
  if (x < f.x0 || x > f.x1 || y < 0 || y > f.y1) return INF;
  return f.cost[y * (f.x1 - f.x0 + 1) + (x - f.x0)]!;
}

/** The neighbouring tile a creep on (x, y) steps to: the cheapest, downhill first; none when nothing is cheaper. */
export function nextTile(f: PadField, x: number, y: number): { x: number; y: number } | undefined {
  const w = f.x1 - f.x0 + 1;
  const open = (tx: number, ty: number) => tx >= f.x0 && tx <= f.x1 && ty >= 0 && ty <= f.y1 && !f.walls[ty * w + (tx - f.x0)];
  let best: { x: number; y: number } | undefined;
  let bestCost = costAt(f, x, y);
  for (const [dx, dy] of STEPS) {
    const tx = x + dx;
    const ty = y + dy;
    if (!open(tx, ty)) continue;
    if (dx !== 0 && dy !== 0 && (!open(x + dx, y) || !open(x, y + dy))) continue;
    const c = costAt(f, tx, ty);
    if (c < bestCost) {
      best = { x: tx, y: ty };
      bestCost = c;
    }
  }
  return best;
}
