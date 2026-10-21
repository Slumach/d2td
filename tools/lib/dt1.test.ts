import { describe, expect, it } from 'vitest';

import { decodeDt1, drawBlock, tileImage } from './dt1.ts';

/** A one-tile DT1 with one isometric block and one RLE block, laid out like the real files. */
function sampleDt1(): Uint8Array {
  const iso = new Uint8Array(256).fill(7);
  const rle = Uint8Array.from([2, 3, 9, 9, 9, 0, 0, 1, 1, 5]); // row 0: skip 2, 3 px; row 1: skip 1, 1 px
  const headerSize = 8 + 260 + 8;
  const tileHeader = 96;
  const blockHeaders = 2 * 20;
  const blockStart = headerSize + tileHeader;
  const buf = new Uint8Array(blockStart + blockHeaders + iso.length + rle.length);
  const v = new DataView(buf.buffer);
  v.setInt32(0, 7, true);
  v.setInt32(4, 6, true);
  v.setInt32(268, 1, true); // tiles
  v.setInt32(272, headerSize, true); // tile headers start
  let p = headerSize;
  v.setInt32(p, 0, true); // direction
  v.setInt32(p + 8, 80, true); // height
  v.setInt32(p + 12, 160, true); // width
  v.setInt32(p + 20, 0, true); // orientation
  v.setInt32(p + 24, 3, true); // main
  v.setInt32(p + 28, 4, true); // sub
  v.setInt32(p + 32, 1, true); // rarity
  v.setInt32(p + 72, blockStart, true); // block headers
  v.setInt32(p + 80, 2, true); // blocks
  p = blockStart;
  const block = (x: number, y: number, gx: number, gy: number, format: number, length: number, offset: number) => {
    v.setInt16(p, x, true);
    v.setInt16(p + 2, y, true);
    buf[p + 6] = gx;
    buf[p + 7] = gy;
    v.setInt16(p + 8, format, true);
    v.setInt32(p + 10, length, true);
    v.setInt32(p + 16, offset, true);
    p += 20;
  };
  block(64, 0, 2, 0, 1, iso.length, blockHeaders);
  block(0, 40, 0, 0, 0, rle.length, blockHeaders + iso.length);
  buf.set(iso, blockStart + blockHeaders);
  buf.set(rle, blockStart + blockHeaders + iso.length);
  return buf;
}

describe('dt1', () => {
  it('reads tile and block headers', () => {
    const { tiles } = decodeDt1(sampleDt1());
    expect(tiles).toHaveLength(1);
    const t = tiles[0]!;
    expect([t.orientation, t.mainIndex, t.subIndex, t.rarity, t.width, t.height]).toEqual([0, 3, 4, 1, 160, 80]);
    expect(t.blocks.map((b) => [b.x, b.y, b.gridX, b.format, b.data.length])).toEqual([
      [64, 0, 2, 1, 256],
      [0, 40, 0, 0, 10],
    ]);
  });

  it('draws an isometric block as a 32 x 15 diamond of 256 pixels', () => {
    const out = new Uint8Array(32 * 15);
    drawBlock({ x: 0, y: 0, gridX: 0, gridY: 0, format: 1, data: new Uint8Array(256).fill(5) }, out, 32, 15, 0, 0);
    expect(out.filter((c) => c === 5)).toHaveLength(256);
    // The top row is 4 pixels wide and centred
    expect([...out.slice(0, 32)].map((c) => (c ? 1 : 0)).join('')).toBe('00000000000000111100000000000000');
  });

  it('draws RLE rows with skips', () => {
    const img = tileImage(decodeDt1(sampleDt1()).tiles[0]!);
    const row = (y: number) => [...img.pixels.slice(y * img.width, y * img.width + 6)];
    expect(row(40)).toEqual([0, 0, 9, 9, 9, 0]);
    expect(row(41)).toEqual([0, 5, 0, 0, 0, 0]);
  });
});
