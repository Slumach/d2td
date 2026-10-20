import { describe, expect, it } from 'vitest';

import { decodeSprite, spriteFrame } from './sprite.ts';

/** A synthetic SpA1 file: 2 frames of 2x1 in 3 px slots. */
function makeSprite(): Uint8Array {
  const sheetWidth = 6;
  const height = 1;
  const pixels = new Uint8Array(sheetWidth * height * 4);
  for (let x = 0; x < sheetWidth; x++) pixels.set([x, 0, 0, 255], x * 4);

  const data = new Uint8Array(0x28 + pixels.length);
  const view = new DataView(data.buffer);
  data.set([0x53, 0x70, 0x41, 0x31]);
  view.setUint16(0x04, 31, true);
  view.setUint16(0x06, 2, true);
  view.setUint32(0x08, sheetWidth, true);
  view.setUint32(0x0c, height, true);
  view.setUint32(0x14, 2, true);
  view.setUint32(0x20, pixels.length, true);
  data.set(pixels, 0x28);
  return data;
}

describe('decodeSprite', () => {
  it('reads the header and cuts frames from their slots', () => {
    const sheet = decodeSprite(makeSprite());
    expect(sheet).toMatchObject({ frameWidth: 2, frameHeight: 1, frameCount: 2, slotWidth: 3 });
    expect(Array.from(spriteFrame(sheet, 1)).filter((_, i) => i % 4 === 0)).toEqual([3, 4]);
  });

  it('rejects other magic and versions', () => {
    const bad = makeSprite();
    bad[0] = 0;
    expect(() => decodeSprite(bad)).toThrow(/magic/);
    const v61 = makeSprite();
    new DataView(v61.buffer).setUint16(4, 61, true);
    expect(() => decodeSprite(v61)).toThrow(/version 61/);
  });
});
