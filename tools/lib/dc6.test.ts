import { describe, expect, it } from 'vitest';

import { decodeDc6, decodeDc6Frame } from './dc6.ts';

/** One direction, one 3 x 2 frame, stored bottom row first as DC6 does. */
function sample(): Uint8Array {
  // bottom row: 1 transparent, then 2 pixels (5, 6); top row: 3 pixels (7, 8, 9)
  const pixels = [0x81, 2, 5, 6, 0x80, 3, 7, 8, 9, 0x80];
  const frameAt = 24 + 4;
  const buf = new Uint8Array(frameAt + 32 + pixels.length + 3);
  const v = new DataView(buf.buffer);
  v.setInt32(0, 6, true);
  v.setInt32(16, 1, true);
  v.setInt32(20, 1, true);
  v.setUint32(24, frameAt, true);
  v.setUint32(frameAt + 4, 3, true);
  v.setUint32(frameAt + 8, 2, true);
  v.setInt32(frameAt + 12, -1, true);
  v.setInt32(frameAt + 16, 4, true);
  v.setUint32(frameAt + 28, pixels.length, true);
  buf.set(pixels, frameAt + 32);
  return buf;
}

describe('dc6', () => {
  it('reads frame headers', () => {
    const dc6 = decodeDc6(sample());
    expect([dc6.directions, dc6.framesPerDirection]).toEqual([1, 1]);
    const f = dc6.frames[0]!;
    expect([f.width, f.height, f.offsetX, f.offsetY, f.flipped]).toEqual([3, 2, -1, 4, false]);
  });

  it('decodes runs bottom up', () => {
    expect([...decodeDc6Frame(decodeDc6(sample()).frames[0]!)]).toEqual([7, 8, 9, 0, 5, 6]);
  });
});
