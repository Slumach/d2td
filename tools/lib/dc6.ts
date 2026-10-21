// Ported from OpenDiablo2 (commit 7f92c57): d2common/d2fileformats/d2dc6/dc6.go (Load,
// DecodeFrame) and dc6_frame_header.go. Structure follows the Go code. Changes: frames decode
// to palette indices on request instead of being held decoded.

export interface Dc6Frame {
  flipped: boolean;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  data: Uint8Array;
}

export interface Dc6 {
  directions: number;
  framesPerDirection: number;
  /** frames[direction * framesPerDirection + frame] */
  frames: Dc6Frame[];
}

const END_OF_LINE = 0x80;
const TRANSPARENT_RUN = 0x80;

export function decodeDc6(data: Uint8Array): Dc6 {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getInt32(0, true);
  if (version !== 6) throw new Error(`Not a DC6 (version ${version})`);
  // flags, encoding and the 4-byte termination marker follow the version
  const directions = view.getInt32(16, true);
  const framesPerDirection = view.getInt32(20, true);
  const frames: Dc6Frame[] = [];
  for (let i = 0; i < directions * framesPerDirection; i++) {
    const p = view.getUint32(24 + i * 4, true);
    const length = view.getUint32(p + 28, true);
    frames.push({
      flipped: view.getUint32(p, true) !== 0,
      width: view.getUint32(p + 4, true),
      height: view.getUint32(p + 8, true),
      offsetX: view.getInt32(p + 12, true),
      offsetY: view.getInt32(p + 16, true),
      data: data.slice(p + 32, p + 32 + length),
    });
  }
  return { directions, framesPerDirection, frames };
}

/** A frame as palette indices, row-major, top row first; 0 is transparent. */
export function decodeDc6Frame(frame: Dc6Frame): Uint8Array {
  const { width, height } = frame;
  const out = new Uint8Array(width * height);
  // Unflipped frames are stored bottom row first
  let x = 0;
  let y = frame.flipped ? 0 : height - 1;
  const step = frame.flipped ? 1 : -1;
  for (let i = 0; i < frame.data.length; ) {
    const b = frame.data[i++]!;
    if (b === END_OF_LINE) {
      x = 0;
      y += step;
    } else if (b & TRANSPARENT_RUN) {
      x += b & 0x7f;
    } else {
      for (let n = 0; n < b; n++) {
        const c = frame.data[i++]!;
        if (x < width && y >= 0 && y < height) out[y * width + x] = c;
        x++;
      }
    }
  }
  return out;
}
