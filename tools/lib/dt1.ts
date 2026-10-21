// Ported from OpenDiablo2 (commit 7f92c57):
//   d2common/d2fileformats/d2dt1/dt1.go, tile.go, block.go (file layout)
//   d2core/d2map/d2maprenderer/tile_cache.go (decodeTileGfxData: isometric and RLE blocks)
// Structure follows the Go code. Changes: the renderer's pixel writes become palette indices
// into one image per tile, sized from the tile's blocks as tile_cache.go does.

/** Tile orientation, D2's "direction" for walls: 0 floor, 1-9 walls, 10-12 specials and objects, 13 shadow, 14 tree, 15 roof, 16-19 lower walls. */
export type Orientation = number;

export const FLOOR = 0;
export const SHADOW = 13;
export const TREE = 14;
export const ROOF = 15;

export interface Dt1Block {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  /** 1 is a 32 x 15 isometric floor block; anything else is RLE. */
  format: number;
  data: Uint8Array;
}

export interface Dt1Tile {
  direction: number;
  roofHeight: number;
  materialFlags: number;
  height: number;
  width: number;
  orientation: Orientation;
  mainIndex: number;
  subIndex: number;
  rarity: number;
  subTileFlags: Uint8Array;
  blocks: Dt1Block[];
}

export interface Dt1 {
  tiles: Dt1Tile[];
}

export function decodeDt1(data: Uint8Array): Dt1 {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const i32 = () => ((pos += 4), view.getInt32(pos - 4, true));
  const i16 = () => ((pos += 2), view.getInt16(pos - 2, true));
  const u8 = () => view.getUint8(pos++);
  const version1 = i32();
  const version2 = i32();
  if (version1 !== 7 || version2 !== 6) throw new Error(`Not a DT1 (version ${version1}.${version2})`);
  pos += 260;
  const count = i32();
  pos = i32();

  const heads: { tile: Dt1Tile; blockPointer: number; blockCount: number }[] = [];
  for (let t = 0; t < count; t++) {
    const direction = i32();
    const roofHeight = i16();
    const materialFlags = i16();
    const height = i32();
    const width = i32();
    pos += 4;
    const orientation = i32();
    const mainIndex = i32();
    const subIndex = i32();
    const rarity = i32();
    pos += 4;
    const subTileFlags = data.slice(pos, pos + 25);
    pos += 25 + 7;
    const blockPointer = i32();
    pos += 4; // block header size
    const blockCount = i32();
    pos += 12;
    heads.push({ tile: { direction, roofHeight, materialFlags, height, width, orientation, mainIndex, subIndex, rarity, subTileFlags, blocks: [] }, blockPointer, blockCount });
  }

  for (const { tile, blockPointer, blockCount } of heads) {
    pos = blockPointer;
    const raw: { x: number; y: number; gridX: number; gridY: number; format: number; length: number; offset: number }[] = [];
    for (let b = 0; b < blockCount; b++) {
      const x = i16();
      const y = i16();
      pos += 2;
      const gridX = u8();
      const gridY = u8();
      const format = i16();
      const length = i32();
      pos += 2;
      const offset = i32();
      raw.push({ x, y, gridX, gridY, format, length, offset });
    }
    tile.blocks = raw.map((b) => ({ x: b.x, y: b.y, gridX: b.gridX, gridY: b.gridY, format: b.format, data: data.slice(blockPointer + b.offset, blockPointer + b.offset + b.length) }));
  }
  return { tiles: heads.map((h) => h.tile) };
}

/** A tile as palette indices (0 is transparent), with where its ground line sits. */
export interface TileImage {
  width: number;
  height: number;
  /** Rows above the tile's origin: walls and trees reach up past the floor diamond. */
  yOffset: number;
  pixels: Uint8Array;
}

const XJUMP = [14, 12, 10, 8, 6, 4, 2, 0, 2, 4, 6, 8, 10, 12, 14];
const NBPIX = [4, 8, 12, 16, 20, 24, 28, 32, 28, 24, 20, 16, 12, 8, 4];

/** Draws one block into `out` at (ox, oy) + the block's own offset. */
export function drawBlock(block: Dt1Block, out: Uint8Array, outWidth: number, outHeight: number, ox: number, oy: number): void {
  const put = (x: number, y: number, c: number) => {
    if (c === 0 || x < 0 || y < 0 || x >= outWidth || y >= outHeight) return;
    out[y * outWidth + x] = c;
  };
  const bx = ox + block.x;
  const by = oy + block.y;
  let idx = 0;
  if (block.format === 1) {
    // Isometric floor block: 15 rows of a 32 x 15 diamond, 256 bytes
    for (let y = 0; y < 15; y++) {
      let x = XJUMP[y]!;
      for (let n = NBPIX[y]!; n > 0; n--) put(bx + x++, by + y, block.data[idx++]!);
    }
    return;
  }
  // RLE: pairs of (skip, count), then count pixels; (0, 0) ends a row
  let x = 0;
  let y = 0;
  let length = block.data.length;
  while (length > 0) {
    const skip = block.data[idx]!;
    let n = block.data[idx + 1]!;
    idx += 2;
    length -= 2;
    if ((skip | n) === 0) {
      x = 0;
      y++;
      continue;
    }
    x += skip;
    length -= n;
    for (; n > 0; n--) put(bx + x++, by + y, block.data[idx++]!);
  }
}

/** Renders a whole tile, sized and offset from its blocks as OpenDiablo2's tile cache does. */
export function tileImage(tile: Dt1Tile): TileImage {
  let minY = 0;
  let maxY = 0;
  for (const b of tile.blocks) {
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y + (b.format === 1 ? 15 : 32));
  }
  const yOffset = -minY;
  const width = Math.max(tile.width, 160);
  const height = Math.max(Math.abs(tile.height), maxY - minY, 1);
  const pixels = new Uint8Array(width * height);
  for (const b of tile.blocks) drawBlock(b, pixels, width, height, 0, yOffset);
  return { width, height, yOffset, pixels };
}

/** D2 picks among tiles sharing orientation, main and sub index by rarity; this is that key. */
export function tileKey(t: { orientation: number; mainIndex: number; subIndex: number }): string {
  return `${t.orientation}-${t.mainIndex}-${t.subIndex}`;
}
