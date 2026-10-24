// Battle Mode's battlefields, baked at extraction from the player's own tiles and our layout
// (src/data/map/battle.json): Harrogath under siege for the first team, the Pandemonium
// Fortress for the second, each once for every team size, on the lanes src/sim/map.ts
// createLaneMap lays out.
//
//   map/battle-<keep>-<lanes>.png        the ground: floor, the road along every lane and its
//                                        bend into the keep, and the scenery's shadows
//   map/scenery/battle-<keep>/<name>.png one image per prefab
//   map/maps.json battle                 where each ground sits and each object stands
//
// Scenery stands only on tiles the lane map blocks: tall pieces on the open ground behind
// and left of the lanes, low ones on the two edges that face the camera (anything tall there
// is drawn over the lanes in front of it), rocks along the columns between lanes, a little
// scatter round the keep, and the Worldstone on the king's tile.

import battle from '../../src/data/map/battle.json';
import { ORIGIN } from '../../src/render/iso.ts';
import { createLaneMap, LANE, MAP_SIZE } from '../../src/sim/map.ts';
import { UNITS_PER_TILE } from '../../src/sim/fixed.ts';
import { decodePalDat, type Palette } from '../lib/palette.ts';
import { encodePng } from '../lib/png.ts';
import { at, buildPieces, Canvas, H, hash2, segDist, SHADOW, tilePath, valueNoise, W, type BakedMap, type Built, type MapManifest, type Piece, type Tiles } from './map.ts';
import type { DataSource } from './source.ts';
import type { OutputFile } from './sprites.ts';

/** A D2 cell is 160 x 80 px; our sim tile is 64 x 32. */
const CELL_TILES = 2.5;

interface KeepLayout {
  palette: string;
  seed: number;
  floor: { file: string; ground: string[] };
  road: { file: string; tiles: string[]; halfWidth: number; wobble: number; edge: number };
  /** Percent of the open tiles behind the lanes that take a tall piece, and of those in front a low one. */
  edge: { tall: string[]; low: string[]; tallPct: number; lowPct: number };
  divider: { prefabs: string[]; every: number };
  keep: { prefabs: string[]; chancePct: number; flank: string };
  prefabs: Record<string, { palette?: string; pieces: Piece[] }>;
}

const KEEPS = (battle as unknown as { keeps: Record<string, KeepLayout> }).keeps;

/** The layout as authored, for the maps job's key. */
export function battleLayout(): unknown {
  return battle;
}

/** The two keeps in team order: the first team's, then the second's. */
export const BATTLE_KEEPS = Object.keys(KEEPS);

/** Every game file the battlefields read. */
export function battleInputs(): string[] {
  const files = new Set<string>();
  const palettes = new Set<string>();
  for (const k of Object.values(KEEPS)) {
    palettes.add(k.palette);
    files.add(k.floor.file);
    files.add(k.road.file);
    for (const p of Object.values(k.prefabs)) {
      if (p.palette) palettes.add(p.palette);
      for (const piece of p.pieces) files.add(piece.file);
    }
  }
  return [...palettes, ...[...files].map(tilePath)];
}

export function bakeBattle(source: DataSource, tiles: Tiles, out: OutputFile[], manifest: MapManifest): void {
  manifest.battle = {};
  for (const [name, keep] of Object.entries(KEEPS)) {
    const palette = decodePalDat(source.read(keep.palette));
    const palettes = new Map<string, Palette>([[keep.palette, palette]]);
    const paletteOf = (p: string | undefined) => {
      if (!p) return palette;
      let got = palettes.get(p);
      if (!got) palettes.set(p, (got = decodePalDat(source.read(p))));
      return got;
    };
    const built = new Map<string, Built>();
    const prefab = (id: string): Built => {
      let b = built.get(id);
      if (!b) {
        const def = keep.prefabs[id];
        if (!def) throw new Error(`battle.json ${name}: no prefab ${id}`);
        built.set(id, (b = buildPieces(def.pieces, tiles, paletteOf(def.palette))));
      }
      return b;
    };
    const maps: Record<string, BakedMap> = {};
    for (let lanes = 1; lanes <= 4; lanes++) {
      const { image, objects } = bakeField(name, keep, lanes, tiles, palette, prefab);
      out.push(image);
      maps[String(lanes)] = { ground: { image: image.path, originX: ORIGIN.x, originY: ORIGIN.y }, objects: objects.map((o) => ({ ...o, prefab: `battle-${name}/${o.prefab}` })) };
    }
    for (const [id, b] of built) {
      const path = `map/scenery/battle-${name}/${id}.png`;
      out.push({ path, bytes: encodePng(b.canvas.width, b.canvas.height, b.canvas.rgba) });
      manifest.prefabs[`battle-${name}/${id}`] = { image: path, anchorX: b.anchorX, anchorY: b.anchorY };
    }
    manifest.battle[name] = maps;
  }
}

function bakeField(name: string, keep: KeepLayout, lanes: number, tiles: Tiles, palette: Palette, prefab: (id: string) => Built): { image: OutputFile; objects: { prefab: string; at: number[] }[] } {
  const seed = keep.seed + lanes * 17;
  const map = createLaneMap(lanes);
  const ground = new Canvas(W, H);
  const road = new Canvas(W, H);
  const span = Math.ceil((MAP_SIZE + 8) / CELL_TILES);
  for (let j = -4; j <= span; j++) {
    for (let i = -4; i <= span; i++) {
      const c = at(i * CELL_TILES, j * CELL_TILES);
      const tl = { x: c.x - 80, y: c.y };
      if (tl.x > W || tl.x + 160 < 0 || tl.y > H || tl.y + 80 < 0) continue;
      const g = tiles.pick(keep.floor.file, 0, keep.floor.ground, hash2(i, j, seed));
      const d = tiles.pick(keep.road.file, 0, keep.road.tiles, hash2(i, j, seed + 2));
      if (g) ground.blit(tiles.image(g), tl.x, tl.y, palette);
      if (d) road.blit(tiles.image(d), tl.x, tl.y, palette);
    }
  }
  // The road along every lane's segments, in sim tiles
  const segs = map.segments.map((s) => [s.from.x / UNITS_PER_TILE, s.from.y / UNITS_PER_TILE, s.to.x / UNITS_PER_TILE, s.to.y / UNITS_PER_TILE] as const);
  const r = keep.road;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = (x - ORIGIN.x) / 32;
      const b = (y - ORIGIN.y) / 16;
      const u = (a + b) / 2;
      const v = (b - a) / 2;
      let d = Infinity;
      for (const s of segs) d = Math.min(d, segDist(u, v, s[0], s[1], s[2], s[3]));
      if (d > 2) continue;
      const half = r.halfWidth + r.wobble * (valueNoise(u * 1.3, v * 1.3, seed) * 2 - 1);
      let alpha = Math.max(0, Math.min(1, (half - d) / r.edge + 0.5));
      if (alpha > 0 && alpha < 1) alpha = Math.max(0, Math.min(1, alpha + (hash2(x, y, seed + 3) - 0.5) * 0.5));
      const o = (y * W + x) * 4;
      if (alpha === 0 || !road.rgba[o + 3]) continue;
      for (let k = 0; k < 3; k++) ground.rgba[o + k] = Math.round(ground.rgba[o + k]! * (1 - alpha) + road.rgba[o + k]! * alpha);
      ground.rgba[o + 3] = 255;
    }
  }

  // Scenery on blocked tiles only, so the picture matches the buildable mask
  const objects: { prefab: string; at: number[] }[] = [];
  const pick = (list: string[], x: number, y: number, salt: number) => list[Math.floor(hash2(x, y, seed + salt) * list.length)]!;
  const size = map.width;
  const blocked = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && map.blocked[y * size + x] === true && !map.pathTiles[y * size + x];
  const laneCols = new Set<number>();
  const columns: number[] = [];
  for (let x = 0; x < size; x++) if (map.pathTiles[10 * size + x]) columns.push(x);
  const half = Math.floor(LANE.width / 2);
  for (const cx of columns) for (let x = cx - half; x <= cx + half; x++) laneCols.add(x);
  const left = Math.min(...laneCols);
  const right = Math.max(...laneCols);
  const workers = new Set((map.workerSlots ?? []).flat().map((p) => `${p.x},${p.y}`));
  const king = map.king!;
  const tyrael = map.tyrael!;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!blocked(x, y) || workers.has(`${x},${y}`)) continue;
      // Clear ground round the king and Tyrael
      if (Math.abs(x - king.x) <= 2 && Math.abs(y - king.y) <= 2) continue;
      if (Math.abs(x - tyrael.x) <= 1 && Math.abs(y - tyrael.y) <= 1) continue;
      const inKeep = y >= LANE.bendRow - 1;
      // Inside a lane's columns only its top edge takes scenery: the rows by the workers stay clear
      if (laneCols.has(x) && !inKeep && y > 0) continue;
      const between = !inKeep && laneCols.has(x) === false && x > left && x < right;
      if (between) {
        // The column between two lanes: a rock every few tiles
        if (y % keep.divider.every === 1) objects.push({ prefab: pick(keep.divider.prefabs, x, y, 1), at: [x + 0.5, y + 0.5] });
        continue;
      }
      if (inKeep) {
        if (hash2(x, y, seed + 4) * 100 < keep.keep.chancePct) objects.push({ prefab: pick(keep.keep.prefabs, x, y, 2), at: [x + 0.5, y + 0.5] });
        continue;
      }
      // The open ground beside the lanes, a clear strip left along each: tall pieces behind and
      // left, sparse low ones on the side facing the camera
      if (x >= left - 1 && x <= right + 1 && y > 0) continue;
      const front = x > right || y >= LANE.lastBuildRow - 4;
      if (hash2(x, y, seed + 6) * 100 >= (front ? keep.edge.lowPct : keep.edge.tallPct)) continue;
      objects.push({ prefab: pick(front ? keep.edge.low : keep.edge.tall, x, y, 3), at: [x + 0.5, y + 0.5] });
    }
  }
  // The Worldstone on the king's tile, the keep's flank pieces either side of Tyrael and it
  objects.push({ prefab: 'worldstone', at: [king.x + 0.5, king.y + 0.5] });
  for (const dx of [-3, 3]) objects.push({ prefab: keep.keep.flank, at: [king.x + 0.5 + dx, king.y - 1.5] });

  // Shadows under each object's foot
  for (const obj of objects) {
    const pieces = keep.prefabs[obj.prefab]?.pieces;
    if (!pieces) continue;
    const b = prefab(obj.prefab);
    const foot = at(obj.at[0]!, obj.at[1]!);
    const cx0 = foot.x - (b.anchorX - b.cellX);
    const cy0 = foot.y - (b.anchorY - b.cellY);
    for (const piece of pieces) {
      const shadow = tiles.variants(piece.file, SHADOW, piece.key)[0];
      if (!shadow) continue;
      const img = tiles.image(shadow);
      if (img.pixels.reduce((n, c) => n + (c ? 1 : 0), 0) > 0.8 * 160 * 80 * 0.5) continue;
      const [px, py] = piece.at as [number, number];
      ground.shade(img, cx0 + (px - py) * 80 - 80, cy0 + (px + py) * 40 - 40);
    }
  }
  return { image: { path: `map/battle-${name}-${lanes}.png`, bytes: encodePng(W, H, ground.rgba) }, objects };
}
