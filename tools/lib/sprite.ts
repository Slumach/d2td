// Decoder for D2R HD .sprite files (magic "SpA1", version 31: uncompressed RGBA).
// Not ported: OpenDiablo2 predates D2R and has no .sprite reader. Layout read from the files:
//   0x00 "SpA1"   0x04 u16 version   0x06 u16 frame width   0x08 u32 sheet width
//   0x0C u32 height   0x14 u32 frame count   0x20 u32 pixel byte count   0x28 RGBA pixels
// Frames sit side by side in equal slots of sheet width / frame count; the slot is a
// little wider than the frame (132 for 130 px icons), and the frame starts at the slot's left.

const MAGIC = 'SpA1';
const HEADER_SIZE = 0x28;
const SUPPORTED_VERSION = 31;

export interface SpriteSheet {
  version: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  /** Slot width in the source sheet, frame width plus padding. */
  slotWidth: number;
  sheetWidth: number;
  /** sheetWidth x frameHeight RGBA. */
  pixels: Uint8Array;
}

export function decodeSprite(data: Uint8Array): SpriteSheet {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = String.fromCharCode(...data.subarray(0, 4));
  if (magic !== MAGIC) throw new Error(`.sprite magic expected SpA1, got ${JSON.stringify(magic)}`);

  const version = view.getUint16(0x04, true);
  if (version !== SUPPORTED_VERSION) {
    throw new Error(`.sprite version ${version} is not supported (only ${SUPPORTED_VERSION}, uncompressed RGBA)`);
  }

  const frameWidth = view.getUint16(0x06, true);
  const sheetWidth = view.getUint32(0x08, true);
  const frameHeight = view.getUint32(0x0c, true);
  const frameCount = view.getUint32(0x14, true);
  const pixelBytes = view.getUint32(0x20, true);

  if (pixelBytes !== sheetWidth * frameHeight * 4 || HEADER_SIZE + pixelBytes > data.length) {
    throw new Error(`.sprite pixel size ${pixelBytes} does not match ${sheetWidth}x${frameHeight} RGBA`);
  }
  if (frameCount === 0 || sheetWidth % frameCount !== 0) {
    throw new Error(`.sprite sheet width ${sheetWidth} does not split into ${frameCount} frames`);
  }

  return {
    version,
    frameWidth,
    frameHeight,
    frameCount,
    slotWidth: sheetWidth / frameCount,
    sheetWidth,
    pixels: data.subarray(HEADER_SIZE, HEADER_SIZE + pixelBytes),
  };
}

/** One frame as frameWidth x frameHeight RGBA. */
export function spriteFrame(sheet: SpriteSheet, index: number): Uint8Array {
  if (index < 0 || index >= sheet.frameCount) throw new Error(`.sprite frame ${index} out of range`);
  const out = new Uint8Array(sheet.frameWidth * sheet.frameHeight * 4);
  const rowBytes = sheet.frameWidth * 4;
  for (let y = 0; y < sheet.frameHeight; y++) {
    const src = (y * sheet.sheetWidth + index * sheet.slotWidth) * 4;
    out.set(sheet.pixels.subarray(src, src + rowBytes), y * rowBytes);
  }
  return out;
}
