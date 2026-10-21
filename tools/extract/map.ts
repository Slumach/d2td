// Act 1's maps for the ring, baked at extraction from the player's own tiles and our layout
// (src/data/map/act1.json, src/data/map/ring.json):
//
//   map/act1-<map>.png        the whole world: floor tiles, the road along the ring blended
//                             in, and every scenery object's shadow
//   map/scenery/<prefab>.png  one image per scenery prefab (trees, rocks, bushes, the
//                             cottage, Andariel's throne)
//   map/act1.json             where each ground sits and where each object stands, so the
//                             renderer can place and depth-sort scenery with the units
//
// Two maps share the ring's grid, path and buildable mask: the Blood Moor (the field) and
// Catacombs 4 (the lair, for Act 1's boss waves). Scenery stands exactly on the tiles
// ring.json gives each kind: a treeline round the edge, rocks on the arc boundaries,
// bushes, and the cottage (D2's own Cott4 preset, read as a DS1) or the throne in the
// middle. Floor cells are D2's 160 x 80, two and a half sim tiles a side.

import layout from '../../src/data/map/act1.json';
import { ORIGIN, WORLD_HEIGHT, WORLD_WIDTH, project } from '../../src/render/iso.ts';
import { UNITS_PER_TILE } from '../../src/sim/fixed.ts';
import { MAP_SIZE, ringWaypoints, sceneryTiles, type SceneryKind } from '../../src/sim/map.ts';
import { decodeDs1 } from '../lib/ds1.ts';
import { decodeDt1, tileImage, type Dt1Tile, type TileImage } from '../lib/dt1.ts';
import { decodePalDat, type Palette } from '../lib/palette.ts';
import { encodePng } from '../lib/png.ts';
import type { DataSource } from './source.ts';
import type { OutputFile, SpriteJob } from './sprites.ts';

const W = WORLD_WIDTH;
const H = WORLD_HEIGHT;
/** A D2 cell is 160 x 80 px; our sim tile is 64 x 32. */
const CELL_TILES = 2.5;
const SHADOW = 13;
/** DT1 orientations a preset uses as markers, not art. */
const MARKERS = [10, 11, SHADOW];

interface Piece {
  file: string;
  o: number;
  key: string;
  at: number[];
}

type MapName = keyof typeof layout.maps;
type MapLayout = (typeof layout.maps)[MapName];

const tilePath = (file: string) => `global/tiles/${file}`.toLowerCase();
const prefabs = layout.prefabs as Record<string, { pieces: Piece[] }>;

/** Every game file the bake reads. */
export function mapInputs(): string[] {
  const files = new Set<string>();
  for (const map of Object.values(layout.maps) as MapLayout[]) {
    files.add(map.floor.file);
    files.add(map.road.file);
    files.add(map.scenery.treeline.front.file);
    if ('sprinkle' in map.floor) files.add(map.floor.sprinkle.file);
    const cottage = map.scenery.cottage;
    if ('ds1' in cottage) {
      files.add(cottage.ds1);
      for (const f of cottage.files) files.add(f);
    }
  }
  for (const p of Object.values(prefabs)) for (const piece of p.pieces) files.add(piece.file);
  return [layout.palette, ...[...files].map(tilePath)];
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

  /** The first tile of an orientation, main and sub index in any of `files` (a DS1's lookup). */
  find(files: string[], o: number, main: number, sub: number): Dt1Tile | undefined {
    for (const f of files) {
      const t = this.file(f).find((x) => x.orientation === o && x.mainIndex === main && x.subIndex === sub);
      if (t) return t;
    }
    return undefined;
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

/** World position of a point in sim tiles. */
function at(tx: number, ty: number): { x: number; y: number } {
  return project(tx * UNITS_PER_TILE, ty * UNITS_PER_TILE);
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
  /** The image pixel that stands on the object's spot. */
  anchorX: number;
  anchorY: number;
}

export interface MapManifest {
  maps: Record<MapName, { ground: { image: string; originX: number; originY: number }; objects: { prefab: string; at: number[] }[] }>;
  prefabs: Record<string, PrefabOut>;
}

export function mapJob(source: DataSource): SpriteJob {
  return { label: 'map act 1', inputs: mapInputs(), run: () => bake(source) };
}

/** A built prefab: its image, the floor centre of its cell (0, 0) in it, and its foot. */
interface Built {
  canvas: Canvas;
  cellX: number;
  cellY: number;
  anchorX: number;
  anchorY: number;
}

function buildPieces(name: string, tiles: Tiles, palette: Palette): Built {
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
  const foot = footOf(canvas);
  return { canvas, cellX: 80 - minX, cellY: 40 - minY, anchorX: foot.footX, anchorY: foot.footY };
}

function bake(source: DataSource): OutputFile[] {
  const palette = decodePalDat(source.read(layout.palette));
  const tiles = new Tiles(source);
  const seed = layout.seed;
  const out: OutputFile[] = [];
  const manifest: MapManifest = { maps: {} as MapManifest['maps'], prefabs: {} };
  const built = new Map<string, Built>();
  const prefab = (name: string): Built => {
    let b = built.get(name);
    if (!b) built.set(name, (b = buildPieces(name, tiles, palette)));
    return b;
  };

  for (const [name, map] of Object.entries(layout.maps) as [MapName, MapLayout][]) {
    const ground = new Canvas(W, H);
    const road = new Canvas(W, H);
    // The two edges facing the camera (x or y at the far side) get flat rubble, not trees:
    // anything standing there is drawn over the path in front of it, and the monsters on it
    const rubble = new Canvas(W, H);
    const front = map.scenery.treeline.front;

    // Floor: cover the whole world with D2 cells, ground and road on separate layers
    const span = Math.ceil((MAP_SIZE + 8) / CELL_TILES);
    for (let j = -4; j <= span; j++) {
      for (let i = -4; i <= span; i++) {
        const c = at(i * CELL_TILES, j * CELL_TILES);
        const tl = { x: c.x - 80, y: c.y };
        if (tl.x > W || tl.x + 160 < 0 || tl.y > H || tl.y + 80 < 0) continue;
        const r = hash2(i, j, seed);
        const sprinkle = 'sprinkle' in map.floor ? map.floor.sprinkle : undefined;
        const g =
          sprinkle && hash2(i, j, seed + 1) * 100 < sprinkle.chancePct
            ? tiles.pick(sprinkle.file, 0, sprinkle.tiles, r)
            : tiles.pick(map.floor.file, 0, map.floor.ground, r);
        const d = tiles.pick(map.road.file, 0, map.road.tiles, hash2(i, j, seed + 2));
        if (g) ground.blit(tiles.image(g), tl.x, tl.y, palette);
        if (d) road.blit(tiles.image(d), tl.x, tl.y, palette);
        const f = tiles.pick(front.file, 0, front.tiles, hash2(i, j, seed + 4));
        if (f) rubble.blit(tiles.image(f), tl.x, tl.y, palette);
      }
    }

    // Road: the road layer over the ground within a band round the ring's path
    const corners = ringWaypoints().map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
    const loop = [...corners, corners[0]!];
    const r = map.road;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = (x - ORIGIN.x) / 32;
        const b = (y - ORIGIN.y) / 16;
        const u = (a + b) / 2;
        const v = (b - a) / 2;
        const o = (y * W + x) * 4;
        // Rubble fades in over the last tile and a half of each front edge
        const edge = Math.max(0, Math.min(1, (Math.max(u, v) - (MAP_SIZE - 1.5)) / 0.6 + (hash2(x, y, seed + 5) - 0.5) * 0.4));
        if (edge > 0 && rubble.rgba[o + 3]) {
          for (let k = 0; k < 3; k++) ground.rgba[o + k] = Math.round(ground.rgba[o + k]! * (1 - edge) + rubble.rgba[o + k]! * edge);
        }
        let d = Infinity;
        for (let k = 1; k < loop.length; k++) d = Math.min(d, segDist(u, v, loop[k - 1]!.x, loop[k - 1]!.y, loop[k]!.x, loop[k]!.y));
        const half = r.halfWidth + r.wobble * (valueNoise(u * 1.3, v * 1.3, seed) * 2 - 1);
        let alpha = Math.max(0, Math.min(1, (half - d) / r.edge + 0.5));
        if (alpha > 0 && alpha < 1) alpha = Math.max(0, Math.min(1, alpha + (hash2(x, y, seed + 3) - 0.5) * 0.5));
        if (alpha === 0) continue;
        for (let k = 0; k < 3; k++) ground.rgba[o + k] = Math.round(ground.rgba[o + k]! * (1 - alpha) + road.rgba[o + k]! * alpha);
        ground.rgba[o + 3] = 255;
      }
    }

    // Scenery on the tiles ring.json gives each kind
    const objects: { prefab: string; at: number[] }[] = [];
    const choose = (list: string[], x: number, y: number, salt: number) => list[Math.floor(hash2(Math.round(x * 2), Math.round(y * 2), seed + salt) * list.length)]!;
    const s = map.scenery;
    const kinds: SceneryKind[] = ['treeline', 'rocks', 'bushes'];
    for (const kind of kinds) {
      const spec = s[kind] as { prefabs: string[]; every?: number; outside?: number };
      for (const t of sceneryTiles(kind)) {
        // The treeline thins to one every `every` tiles along the edge
        if (kind === 'treeline' && spec.every && (t.x + t.y) % Math.round(spec.every) !== 0) continue;
        if (kind === 'treeline' && Math.max(t.x, t.y) === MAP_SIZE - 1) continue;
        objects.push({ prefab: choose(spec.prefabs, t.x, t.y, kinds.indexOf(kind)), at: [t.x + 0.5, t.y + 0.5] });
      }
    }
    // A second row of the treeline just off the two back edges, so the border reads as woods
    const line = s.treeline as { prefabs: string[]; every: number; outside: number };
    for (let i = 0; i <= MAP_SIZE; i += line.every) {
      for (const [x, y] of [[i, -line.outside], [-line.outside, MAP_SIZE - i]] as const) {
        objects.push({ prefab: choose(line.prefabs, x, y, 9), at: [x, y] });
      }
    }
    // The middle: the cottage, or the throne with braziers on its corners
    const block = sceneryTiles('cottage');
    const cx = (Math.min(...block.map((t) => t.x)) + Math.max(...block.map((t) => t.x)) + 1) / 2;
    const cy = (Math.min(...block.map((t) => t.y)) + Math.max(...block.map((t) => t.y)) + 1) / 2;
    const middle = s.cottage as { ds1?: string; files?: string[]; centreCell?: number[]; centre?: string; corners?: string };
    if (middle.ds1) {
      const cottage = `cottage-${name}`;
      built.set(cottage, cottageOf(middle as { ds1: string; files: string[]; centreCell: number[] }, source, tiles, palette, ground, at(cx, cy)));
      objects.push({ prefab: cottage, at: [cx, cy] });
    } else {
      objects.push({ prefab: middle.centre!, at: [cx, cy] });
      const x0 = Math.min(...block.map((t) => t.x)) + 0.5;
      const x1 = Math.max(...block.map((t) => t.x)) + 0.5;
      for (const [x, y] of [[x0, x0], [x1, x0], [x0, x1], [x1, x1]] as const) objects.push({ prefab: middle.corners!, at: [x, y] });
    }

    // Shadows of the piece prefabs into the ground, under each object's foot
    for (const obj of objects) {
      const pieces = prefabs[obj.prefab]?.pieces;
      if (!pieces) continue;
      const b = prefab(obj.prefab);
      const foot = at(obj.at[0]!, obj.at[1]!);
      const cx0 = foot.x - (b.anchorX - b.cellX);
      const cy0 = foot.y - (b.anchorY - b.cellY);
      for (const piece of pieces) {
        const shadow = tiles.variants(piece.file, SHADOW, piece.key)[0];
        if (!shadow) continue;
        const img = tiles.image(shadow);
        // A shadow filling most of its cell is a room's floor shade, not an object's outline
        if (img.pixels.reduce((n, c) => n + (c ? 1 : 0), 0) > 0.8 * 160 * 80 * 0.5) continue;
        const [px, py] = piece.at as [number, number];
        ground.shade(img, cx0 + (px - py) * 80 - 80, cy0 + (px + py) * 40 - 40);
      }
    }

    const image = `map/act1-${name}.png`;
    out.push({ path: image, bytes: encodePng(W, H, ground.rgba) });
    manifest.maps[name] = { ground: { image, originX: ORIGIN.x, originY: ORIGIN.y }, objects };
  }

  for (const [name, b] of built) {
    const image = `map/scenery/${name}.png`;
    out.push({ path: image, bytes: encodePng(b.canvas.width, b.canvas.height, b.canvas.rgba) });
    manifest.prefabs[name] = { image, anchorX: b.anchorX, anchorY: b.anchorY };
  }
  out.push({ path: 'map/act1.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return out;
}

/**
 * D2's cottage preset: its walls and roofs as one prefab anchored on `centreCell` (in the
 * preset's cells), and its own floors (the house and the porch, not the grass round it)
 * laid into the ground under it, centred on `centre` (world pixels).
 */
function cottageOf(
  spec: { ds1: string; files: string[]; centreCell: number[] },
  source: DataSource,
  tiles: Tiles,
  palette: Palette,
  ground: Canvas,
  centre: { x: number; y: number },
): Built {
  const ds1 = decodeDs1(source.read(tilePath(spec.ds1)));
  const [ccx, ccy] = spec.centreCell as [number, number];
  // A preset cell's floor-diamond top corner, relative to the centre cell point
  const corner = (x: number, y: number) => ({ x: (x - ccx - (y - ccy)) * 80, y: (x - ccx + (y - ccy)) * 40 });
  const cells = ds1.width * ds1.height;
  const pos = (i: number) => corner(i % ds1.width, Math.floor(i / ds1.width));

  // Its own floors into the ground (style 0 is the grass the preset sits on)
  for (const layer of ds1.floors) {
    for (let i = 0; i < cells; i++) {
      const c = layer[i]!;
      if (c.prop1 === 0 || c.style === 0) continue;
      const t = tiles.find(spec.files, 0, c.style, c.sequence);
      const p = pos(i);
      if (t) ground.blit(tiles.image(t), centre.x + p.x - 80, centre.y + p.y, palette);
    }
  }
  // Walls in depth order, then the roofs over them, as D2 draws them; a corner (3) has its 4
  const draws: { img: TileImage; x: number; y: number }[] = [];
  const order = [...Array(cells).keys()].sort((a, b) => (a % ds1.width) + Math.floor(a / ds1.width) - ((b % ds1.width) + Math.floor(b / ds1.width)));
  for (const roofs of [false, true]) {
    for (const i of order) {
      for (const layer of ds1.walls) {
        const c = layer[i]!;
        if (c.prop1 === 0 || MARKERS.includes(c.orientation) || (c.orientation === 15) !== roofs) continue;
        const p = pos(i);
        for (const o of c.orientation === 3 ? [3, 4] : [c.orientation]) {
          const t = tiles.find(spec.files, o, c.style, c.sequence);
          if (t) draws.push({ img: tiles.image(t), x: p.x - 80, y: p.y - (o === 15 ? t.roofHeight : 0) });
        }
      }
    }
  }
  const minX = Math.min(...draws.map((d) => d.x));
  const minY = Math.min(...draws.map((d) => d.y - d.img.yOffset));
  const maxX = Math.max(...draws.map((d) => d.x + d.img.width));
  const maxY = Math.max(...draws.map((d) => d.y - d.img.yOffset + d.img.height));
  const canvas = new Canvas(maxX - minX, maxY - minY);
  for (const d of draws) canvas.blit(d.img, d.x - minX, d.y - minY, palette);
  // The anchor is the centre cell point, so the object stands on the middle of the block
  return { canvas, cellX: -minX, cellY: -minY, anchorX: -minX, anchorY: -minY };
}
