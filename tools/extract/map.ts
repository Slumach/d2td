// The Blood Moor, baked at extraction from the player's own tiles and our layout
// (src/data/map/bloodmoor.json):
//
//   map/bloodmoor-ground.png   the whole map area: grass and dirt floor tiles, a dirt road
//                              along the sim path blended in with a noisy edge, rock floor
//                              tiles sprinkled in, and every scenery object's shadow
//   map/scenery/<prefab>.png   one image per scenery prefab (trees, rocks, ruins, fences)
//   map/bloodmoor.json         where the ground sits and where each object stands, so the
//                              renderer can place and depth-sort scenery with the units
//
// Floor tiles are D2 cells of 160 x 80, two and a half sim tiles a side; the road follows the
// sim's own path, so it lines up with where monsters walk.

import layout from '../../src/data/map/bloodmoor.json';
import { ORIGIN, project } from '../../src/render/iso.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../../src/render/layout.ts';
import { PATH_TILES } from '../../src/sim/map.ts';
import { UNITS_PER_TILE } from '../../src/sim/fixed.ts';
import { decodeDt1, tileImage, type Dt1Tile, type TileImage } from '../lib/dt1.ts';
import { decodePalDat, type Palette } from '../lib/palette.ts';
import { encodePng } from '../lib/png.ts';
import type { DataSource } from './source.ts';
import type { OutputFile, SpriteJob } from './sprites.ts';

/** The whole canvas: the HUD is D2's control panel over the map, not a strip beside it. */
const W = GAME_WIDTH;
const H = GAME_HEIGHT;
/** A D2 cell is 160 x 80 px; our sim tile is 64 x 32. */
const CELL_TILES = 2.5;
const SHADOW = 13;

interface Piece {
  file: string;
  o: number;
  key: string;
  at: number[];
}

const tilePath = (file: string) => `global/tiles/${file}`.toLowerCase();

/** Every game file the bake reads. */
export function mapInputs(): string[] {
  const files = new Set<string>([layout.floor.file, layout.floor.rocks.file]);
  for (const p of Object.values(layout.prefabs)) for (const piece of p.pieces as Piece[]) files.add(piece.file);
  return [layout.palette, ...[...files].map(tilePath)];
}

/** A small seeded PRNG (mulberry32): the bake is the same on every machine, run after run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of a lattice point to 0..1, for value noise and per-cell picks. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

class Tiles {
  private readonly cache = new Map<string, Dt1Tile[]>();
  private readonly images = new Map<Dt1Tile, TileImage>();

  constructor(private readonly source: DataSource) {}

  private file(file: string): Dt1Tile[] {
    let tiles = this.cache.get(file);
    if (!tiles) {
      tiles = decodeDt1(this.source.read(tilePath(file))).tiles;
      this.cache.set(file, tiles);
    }
    return tiles;
  }

  /** Every variant of orientation + "main-sub" in a file. */
  variants(file: string, o: number, key: string): Dt1Tile[] {
    const [main, sub] = key.split('-').map(Number);
    return this.file(file).filter((t) => t.orientation === o && t.mainIndex === main && t.subIndex === sub);
  }

  /** One variant, picked by rarity the way D2 weights them (0 counts as 1). */
  pick(file: string, o: number, keys: string[], r: number): Dt1Tile | undefined {
    const all = keys.flatMap((k) => this.variants(file, o, k));
    const total = all.reduce((n, t) => n + Math.max(1, t.rarity), 0);
    let at = r * total;
    for (const t of all) {
      at -= Math.max(1, t.rarity);
      if (at < 0) return t;
    }
    return all.at(-1);
  }

  image(tile: Dt1Tile): TileImage {
    let img = this.images.get(tile);
    if (!img) {
      img = tileImage(tile);
      this.images.set(tile, img);
    }
    return img;
  }
}

/** An RGBA buffer with palette-index blitting. */
class Canvas {
  readonly rgba: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rgba = new Uint8Array(width * height * 4);
  }

  /** Draws a tile with its floor-diamond top-left at (x, y). */
  blit(img: TileImage, x: number, y: number, palette: Palette): void {
    const top = Math.round(y) - img.yOffset;
    const left = Math.round(x);
    for (let py = 0; py < img.height; py++) {
      const sy = top + py;
      if (sy < 0 || sy >= this.height) continue;
      for (let px = 0; px < img.width; px++) {
        const c = img.pixels[py * img.width + px]!;
        if (!c) continue;
        const sx = left + px;
        if (sx < 0 || sx >= this.width) continue;
        this.rgba.set(palette.subarray(c * 4, c * 4 + 4), (sy * this.width + sx) * 4);
      }
    }
  }

  /** Darkens wherever a shadow tile has pixels, as D2 draws shadows at half strength. */
  shade(img: TileImage, x: number, y: number): void {
    const top = Math.round(y) - img.yOffset;
    const left = Math.round(x);
    for (let py = 0; py < img.height; py++) {
      const sy = top + py;
      if (sy < 0 || sy >= this.height) continue;
      for (let px = 0; px < img.width; px++) {
        if (!img.pixels[py * img.width + px]) continue;
        const sx = left + px;
        if (sx < 0 || sx >= this.width) continue;
        const o = (sy * this.width + sx) * 4;
        for (let k = 0; k < 3; k++) this.rgba[o + k] = this.rgba[o + k]! >> 1;
      }
    }
  }
}

/** Screen position (in ground-image pixels) of a point in sim tiles. */
function at(tx: number, ty: number): { x: number; y: number } {
  return project(tx * UNITS_PER_TILE, ty * UNITS_PER_TILE);
}

/** The floor diamond's top-left for a D2 cell offset from an anchor at sim (ax, ay): the anchor is cell (0,0)'s centre. */
function cellTopLeft(ax: number, ay: number, cx: number, cy: number): { x: number; y: number } {
  const c = at(ax + (cx - 0.5) * CELL_TILES, ay + (cy - 0.5) * CELL_TILES);
  return { x: c.x - 80, y: c.y };
}

/** Distance from p to segment ab, all in sim tiles. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/** Where an object meets the ground: the middle of its lowest few rows of pixels. */
function footOf(c: Canvas): { footX: number; footY: number } {
  const opaque = (x: number, y: number) => c.rgba[(y * c.width + x) * 4 + 3]! > 0;
  let bottom = c.height - 1;
  const count = (y: number) => {
    let n = 0;
    for (let x = 0; x < c.width; x++) if (opaque(x, y)) n++;
    return n;
  };
  while (bottom > 0 && count(bottom) < 2) bottom--;
  const xs: number[] = [];
  for (let y = Math.max(0, bottom - 6); y <= bottom; y++) for (let x = 0; x < c.width; x++) if (opaque(x, y)) xs.push(x);
  xs.sort((a, b) => a - b);
  return { footX: xs[xs.length >> 1] ?? c.width >> 1, footY: bottom };
}

interface PrefabOut {
  image: string;
  /** The anchor (cell (0,0)'s floor centre) within the image. */
  anchorX: number;
  anchorY: number;
}

export interface MapManifest {
  ground: { image: string; originX: number; originY: number };
  prefabs: Record<string, PrefabOut>;
  objects: { prefab: string; at: number[] }[];
}

export function mapJob(source: DataSource): SpriteJob {
  return {
    label: 'map blood moor',
    inputs: mapInputs(),
    run: () => bake(source),
  };
}

function bake(source: DataSource): OutputFile[] {
  const palette = decodePalDat(source.read(layout.palette));
  const tiles = new Tiles(source);
  const seed = layout.seed;
  const grass = new Canvas(W, H);
  const dirt = new Canvas(W, H);

  // Floor: cover the whole map area with D2 cells, grass and dirt on separate layers
  const f = layout.floor;
  for (let j = -12; j <= 16; j++) {
    for (let i = -8; i <= 20; i++) {
      const tl = cellTopLeft(0, 0, i + 0.5, j + 0.5);
      if (tl.x > W || tl.x + 160 < 0 || tl.y > H || tl.y + 80 < 0) continue;
      const r = hash2(i, j, seed);
      const rock = hash2(i, j, seed + 1) * 100 < f.rocks.chancePct;
      const g = rock ? tiles.pick(f.rocks.file, 0, f.rocks.tiles, r) : tiles.pick(f.file, 0, f.grass, r);
      const d = tiles.pick(f.file, 0, f.dirt, hash2(i, j, seed + 2));
      if (g) grass.blit(tiles.image(g), tl.x, tl.y, palette);
      if (d) dirt.blit(tiles.image(d), tl.x, tl.y, palette);
    }
  }

  // Road: dirt over grass within a wobbly band around the path, extended past both ends
  const road = layout.road;
  const pts = [road.extendStart, ...PATH_TILES, road.extendEnd].map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
  const ground = grass;
  const grain = rng(seed + 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = (x - ORIGIN.x) / 32;
      const b = (y - ORIGIN.y) / 16;
      const u = (a + b) / 2;
      const v = (b - a) / 2;
      let d = Infinity;
      for (let k = 1; k < pts.length; k++) d = Math.min(d, segDist(u, v, pts[k - 1]!.x, pts[k - 1]!.y, pts[k]!.x, pts[k]!.y));
      const half = road.halfWidth + road.wobble * (valueNoise(u * 1.3, v * 1.3, seed) * 2 - 1);
      let alpha = Math.max(0, Math.min(1, (half - d) / road.edge + 0.5));
      if (alpha > 0 && alpha < 1) alpha = Math.max(0, Math.min(1, alpha + (grain() - 0.5) * 0.5));
      if (alpha === 0) continue;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) ground.rgba[o + k] = Math.round(ground.rgba[o + k]! * (1 - alpha) + dirt.rgba[o + k]! * alpha);
      ground.rgba[o + 3] = 255;
    }
  }

  // Scenery: each prefab into its own image, anchored at its foot so "at" puts the trunk or
  // the base of the stones on that point; shadows follow the same anchor into the ground
  const prefabs = layout.prefabs as Record<string, { pieces: Piece[] }>;
  const built = new Map<string, { canvas: Canvas; cellX: number; cellY: number; footX: number; footY: number }>();
  for (const name of new Set(layout.objects.map((o) => o.prefab))) {
    const placed = prefabs[name]!.pieces.map((piece) => {
      const t = tiles.variants(piece.file, piece.o, piece.key)[0];
      if (!t) throw new Error(`${piece.file} has no orientation ${piece.o} tile ${piece.key}`);
      const [cx, cy] = piece.at as [number, number];
      // Floor-diamond top-left of this cell, relative to cell (0,0)'s
      return { img: tiles.image(t), x: (cx - cy) * 80, y: (cx + cy) * 40 };
    });
    const minX = Math.min(...placed.map((p) => p.x));
    const minY = Math.min(...placed.map((p) => p.y - p.img.yOffset));
    const maxX = Math.max(...placed.map((p) => p.x + p.img.width));
    const maxY = Math.max(...placed.map((p) => p.y - p.img.yOffset + p.img.height));
    const canvas = new Canvas(maxX - minX, maxY - minY);
    for (const p of placed) canvas.blit(p.img, p.x - minX, p.y - minY, palette);
    built.set(name, { canvas, cellX: 80 - minX, cellY: 40 - minY, ...footOf(canvas) });
  }

  for (const obj of layout.objects) {
    const b = built.get(obj.prefab)!;
    const foot = at(obj.at[0]!, obj.at[1]!);
    // Cell (0,0)'s floor centre on screen, then each piece's cell from there
    const cx0 = foot.x - (b.footX - b.cellX);
    const cy0 = foot.y - (b.footY - b.cellY);
    for (const piece of prefabs[obj.prefab]!.pieces) {
      const shadow = tiles.variants(piece.file, SHADOW, piece.key)[0];
      if (!shadow) continue;
      const img = tiles.image(shadow);
      // A shadow filling most of its cell is a room's floor shade, not an object's outline
      if (img.pixels.reduce((n, c) => n + (c ? 1 : 0), 0) > 0.8 * 160 * 80 * 0.5) continue;
      const [cx, cy] = piece.at as [number, number];
      ground.shade(img, cx0 + (cx - cy) * 80 - 80, cy0 + (cx + cy) * 40 - 40);
    }
  }

  const out: OutputFile[] = [{ path: 'map/bloodmoor-ground.png', bytes: encodePng(W, H, ground.rgba) }];
  const manifest: MapManifest = {
    ground: { image: 'map/bloodmoor-ground.png', originX: ORIGIN.x, originY: ORIGIN.y },
    prefabs: {},
    objects: layout.objects.map((o) => ({ prefab: o.prefab, at: o.at })),
  };
  for (const [name, b] of built) {
    const image = `map/scenery/${name}.png`;
    out.push({ path: image, bytes: encodePng(b.canvas.width, b.canvas.height, b.canvas.rgba) });
    manifest.prefabs[name] = { image, anchorX: b.footX, anchorY: b.footY };
  }
  out.push({ path: 'map/bloodmoor.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return out;
}
