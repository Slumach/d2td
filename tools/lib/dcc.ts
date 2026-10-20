// Ported from OpenDiablo2 (commit 7f92c57):
//   d2common/d2fileformats/d2dcc/dcc.go
//   d2common/d2fileformats/d2dcc/dcc_direction.go
//   d2common/d2fileformats/d2dcc/dcc_direction_frame.go
//   d2common/d2fileformats/d2dcc/dcc_cell.go
//   d2common/d2fileformats/d2dcc/dcc_pixel_buffer_entry.go
// Structure and algorithm follow the Go code line for line. Changes: panics become
// thrown errors, and the pixel buffer grows on demand instead of being preallocated.

import { BitMuncher } from './bitmuncher.ts';

const DCC_SIGNATURE = 0x74;
const DIRECTION_OFFSET_MULTIPLIER = 8;
const CELL_SIZE = 4;
const CRAZY_BIT_TABLE = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 26, 28, 30, 32];
const PIXEL_MASK_LOOKUP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Cell {
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  lastWidth: number;
  lastHeight: number;
  lastXOffset: number;
  lastYOffset: number;
}

interface PixelBufferEntry {
  value: Uint8Array;
  frame: number;
  frameCellIndex: number;
}

export interface DccFrame {
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  box: Rect;
  /** Palette indices sized to the direction box, not the frame box. 0 is transparent. */
  pixelData: Uint8Array;
}

export interface DccDirection {
  /** Union of every frame box, relative to the sprite origin (the feet). */
  box: Rect;
  frames: DccFrame[];
}

export interface Dcc {
  version: number;
  numberOfDirections: number;
  framesPerDirection: number;
  directions: DccDirection[];
}

function cell(width: number, height: number, xOffset: number, yOffset: number): Cell {
  return { width, height, xOffset, yOffset, lastWidth: 0, lastHeight: 0, lastXOffset: 0, lastYOffset: 0 };
}

export function decodeDcc(fileData: Uint8Array): Dcc {
  const bm = new BitMuncher(fileData, 0);

  const signature = bm.getByte();
  if (signature !== DCC_SIGNATURE) {
    throw new Error(`DCC signature expected to be 0x74 but is 0x${signature.toString(16)}`);
  }

  const version = bm.getByte();
  const numberOfDirections = bm.getByte();
  const framesPerDirection = bm.getInt32();

  if (bm.getInt32() !== 1) {
    throw new Error('DCC header tag is not 1');
  }

  bm.getInt32(); // TotalSizeCoded

  const directions: DccDirection[] = [];
  for (let i = 0; i < numberOfDirections; i++) {
    const directionOffset = bm.getInt32();
    const dirBm = new BitMuncher(fileData, directionOffset * DIRECTION_OFFSET_MULTIPLIER);
    directions.push(decodeDirection(dirBm, framesPerDirection));
  }

  return { version, numberOfDirections, framesPerDirection, directions };
}

interface FrameState extends DccFrame {
  cells: Cell[];
  horizontalCellCount: number;
  verticalCellCount: number;
}

interface DirectionState {
  variable0Bits: number;
  widthBits: number;
  heightBits: number;
  xOffsetBits: number;
  yOffsetBits: number;
  optionalDataBits: number;
  codedBytesBits: number;
  compressionFlags: number;
  equalCellsBitstreamSize: number;
  pixelMaskBitstreamSize: number;
  encodingTypeBitstreamSize: number;
  rawPixelCodesBitstreamSize: number;
  paletteEntries: Uint8Array;
  box: Rect;
  frames: FrameState[];
  cells: Cell[];
  pixelData: Uint8Array;
  horizontalCellCount: number;
  verticalCellCount: number;
  pixelBuffer: PixelBufferEntry[];
}

function decodeDirection(bm: BitMuncher, framesPerDirection: number): DccDirection {
  bm.getUInt32(); // OutSizeCoded
  const compressionFlags = bm.getBits(2);
  const bitsFor = (): number => CRAZY_BIT_TABLE[bm.getBits(4)]!;

  const v: DirectionState = {
    compressionFlags,
    variable0Bits: bitsFor(),
    widthBits: bitsFor(),
    heightBits: bitsFor(),
    xOffsetBits: bitsFor(),
    yOffsetBits: bitsFor(),
    optionalDataBits: bitsFor(),
    codedBytesBits: bitsFor(),
    equalCellsBitstreamSize: 0,
    pixelMaskBitstreamSize: 0,
    encodingTypeBitstreamSize: 0,
    rawPixelCodesBitstreamSize: 0,
    paletteEntries: new Uint8Array(256),
    box: { left: 0, top: 0, width: 0, height: 0 },
    frames: [],
    cells: [],
    pixelData: new Uint8Array(0),
    horizontalCellCount: 0,
    verticalCellCount: 0,
    pixelBuffer: [],
  };

  let minx = 100000;
  let miny = 100000;
  let maxx = -100000;
  let maxy = -100000;

  // Load the frame headers
  for (let frameIdx = 0; frameIdx < framesPerDirection; frameIdx++) {
    const frame = decodeFrameHeader(bm, v);
    v.frames.push(frame);
    minx = Math.min(frame.box.left, minx);
    miny = Math.min(frame.box.top, miny);
    maxx = Math.max(frame.box.left + frame.box.width, maxx);
    maxy = Math.max(frame.box.top + frame.box.height, maxy);
  }

  v.box = { left: minx, top: miny, width: maxx - minx, height: maxy - miny };

  if (v.optionalDataBits > 0) {
    throw new Error('Optional bits in DCC data are not supported');
  }

  if (v.compressionFlags & 0x2) {
    v.equalCellsBitstreamSize = bm.getBits(20);
  }

  v.pixelMaskBitstreamSize = bm.getBits(20);

  if (v.compressionFlags & 0x1) {
    v.encodingTypeBitstreamSize = bm.getBits(20);
    v.rawPixelCodesBitstreamSize = bm.getBits(20);
  }

  for (let paletteEntryCount = 0, i = 0; i < 256; i++) {
    if (bm.getBit() !== 0) {
      v.paletteEntries[paletteEntryCount] = i;
      paletteEntryCount++;
    }
  }

  // Bit offset matters here: each stream starts at the exact bit where the previous one ended.
  const equalCellsBitstream = bm.copy();
  bm.skipBits(v.equalCellsBitstreamSize);
  const pixelMaskBitstream = bm.copy();
  bm.skipBits(v.pixelMaskBitstreamSize);
  const encodingTypeBitstream = bm.copy();
  bm.skipBits(v.encodingTypeBitstreamSize);
  const rawPixelCodesBitstream = bm.copy();
  bm.skipBits(v.rawPixelCodesBitstreamSize);
  const pixelCodeAndDisplacement = bm.copy();

  calculateCells(v);
  for (const frame of v.frames) {
    recalculateCells(frame, v);
  }

  fillPixelBuffer(v, pixelCodeAndDisplacement, equalCellsBitstream, pixelMaskBitstream, encodingTypeBitstream, rawPixelCodesBitstream);
  generateFrames(v, pixelCodeAndDisplacement);

  // Sanity check that each stream was consumed exactly
  const checks: [BitMuncher, number, string][] = [
    [equalCellsBitstream, v.equalCellsBitstreamSize, 'equal cells'],
    [pixelMaskBitstream, v.pixelMaskBitstreamSize, 'pixel mask'],
    [encodingTypeBitstream, v.encodingTypeBitstreamSize, 'encoding type'],
    [rawPixelCodesBitstream, v.rawPixelCodesBitstreamSize, 'raw pixel codes'],
  ];
  for (const [stream, expected, name] of checks) {
    if (stream.read !== expected) {
      throw new Error(`DCC ${name} stream: read ${stream.read} bits, expected ${expected}`);
    }
  }

  return {
    box: v.box,
    frames: v.frames.map(({ width, height, xOffset, yOffset, box, pixelData }) => ({
      width,
      height,
      xOffset,
      yOffset,
      box,
      pixelData,
    })),
  };
}

function decodeFrameHeader(bits: BitMuncher, direction: DirectionState): FrameState {
  bits.getBits(direction.variable0Bits); // Variable0

  const width = bits.getBits(direction.widthBits);
  const height = bits.getBits(direction.heightBits);
  const xOffset = bits.getSignedBits(direction.xOffsetBits);
  const yOffset = bits.getSignedBits(direction.yOffsetBits);
  bits.getBits(direction.optionalDataBits); // NumberOfOptionalBytes
  bits.getBits(direction.codedBytesBits); // NumberOfCodedBytes
  const frameIsBottomUp = bits.getBit() === 1;

  if (frameIsBottomUp) {
    throw new Error('Bottom up DCC frames are not implemented');
  }

  return {
    width,
    height,
    xOffset,
    yOffset,
    box: { left: xOffset, top: yOffset - height + 1, width, height },
    pixelData: new Uint8Array(0),
    cells: [],
    horizontalCellCount: 0,
    verticalCellCount: 0,
  };
}

function calculateCells(v: DirectionState): void {
  v.horizontalCellCount = 1 + Math.trunc((v.box.width - 1) / CELL_SIZE);
  v.verticalCellCount = 1 + Math.trunc((v.box.height - 1) / CELL_SIZE);

  const cellWidths = new Array<number>(v.horizontalCellCount).fill(CELL_SIZE);
  if (v.horizontalCellCount === 1) {
    cellWidths[0] = v.box.width;
  } else {
    cellWidths[v.horizontalCellCount - 1] = v.box.width - CELL_SIZE * (v.horizontalCellCount - 1);
  }

  const cellHeights = new Array<number>(v.verticalCellCount).fill(CELL_SIZE);
  if (v.verticalCellCount === 1) {
    cellHeights[0] = v.box.height;
  } else {
    cellHeights[v.verticalCellCount - 1] = v.box.height - CELL_SIZE * (v.verticalCellCount - 1);
  }

  v.cells = [];
  let yOffset = 0;
  for (let y = 0; y < v.verticalCellCount; y++) {
    let xOffset = 0;
    for (let x = 0; x < v.horizontalCellCount; x++) {
      v.cells[x + y * v.horizontalCellCount] = cell(cellWidths[x]!, cellHeights[y]!, xOffset, yOffset);
      xOffset += CELL_SIZE;
    }
    yOffset += CELL_SIZE;
  }
}

function recalculateCells(f: FrameState, direction: DirectionState): void {
  // Width of the first column (in pixels)
  const w = CELL_SIZE - ((f.box.left - direction.box.left) % CELL_SIZE);

  if (f.width - w <= 1) {
    f.horizontalCellCount = 1;
  } else {
    const tmp = f.width - w - 1;
    f.horizontalCellCount = 2 + Math.trunc(tmp / CELL_SIZE);
    if (tmp % CELL_SIZE === 0) {
      f.horizontalCellCount--;
    }
  }

  // Height of the first row (in pixels)
  const h = CELL_SIZE - ((f.box.top - direction.box.top) % CELL_SIZE);

  if (f.height - h <= 1) {
    f.verticalCellCount = 1;
  } else {
    const tmp = f.height - h - 1;
    f.verticalCellCount = 2 + Math.trunc(tmp / CELL_SIZE);
    if (tmp % CELL_SIZE === 0) {
      f.verticalCellCount--;
    }
  }

  const cellWidths = new Array<number>(f.horizontalCellCount).fill(CELL_SIZE);
  if (f.horizontalCellCount === 1) {
    cellWidths[0] = f.width;
  } else {
    cellWidths[0] = w;
    cellWidths[f.horizontalCellCount - 1] = f.width - w - CELL_SIZE * (f.horizontalCellCount - 2);
  }

  const cellHeights = new Array<number>(f.verticalCellCount).fill(CELL_SIZE);
  if (f.verticalCellCount === 1) {
    cellHeights[0] = f.height;
  } else {
    cellHeights[0] = h;
    cellHeights[f.verticalCellCount - 1] = f.height - h - CELL_SIZE * (f.verticalCellCount - 2);
  }

  f.cells = [];
  let offsetY = f.box.top - direction.box.top;
  for (let y = 0; y < f.verticalCellCount; y++) {
    let offsetX = f.box.left - direction.box.left;
    for (let x = 0; x < f.horizontalCellCount; x++) {
      f.cells[x + y * f.horizontalCellCount] = cell(cellWidths[x]!, cellHeights[y]!, offsetX, offsetY);
      offsetX += cellWidths[x]!;
    }
    offsetY += cellHeights[y]!;
  }
}

function fillPixelBuffer(
  v: DirectionState,
  pcd: BitMuncher,
  ec: BitMuncher,
  pm: BitMuncher,
  et: BitMuncher,
  rp: BitMuncher,
): void {
  const cellBuffer: (PixelBufferEntry | undefined)[] = new Array(v.horizontalCellCount * v.verticalCellCount);
  let frameIndex = -1;
  let pixelMask = 0;

  v.pixelBuffer = [];

  for (const frame of v.frames) {
    frameIndex++;

    const originCellX = Math.trunc((frame.box.left - v.box.left) / CELL_SIZE);
    const originCellY = Math.trunc((frame.box.top - v.box.top) / CELL_SIZE);

    for (let cellY = 0; cellY < frame.verticalCellCount; cellY++) {
      const currentCellY = cellY + originCellY;

      for (let cellX = 0; cellX < frame.horizontalCellCount; cellX++) {
        const currentCell = originCellX + cellX + currentCellY * v.horizontalCellCount;
        let nextCell = false;

        if (cellBuffer[currentCell] !== undefined) {
          const tmp = v.equalCellsBitstreamSize > 0 ? ec.getBit() : 0;
          if (tmp === 0) {
            pixelMask = pm.getBits(4);
          } else {
            nextCell = true;
          }
        } else {
          pixelMask = 0x0f;
        }

        if (nextCell) {
          continue;
        }

        // Decode the pixels
        const pixelStack = [0, 0, 0, 0];
        let lastPixel = 0;
        const numberOfPixelBits = PIXEL_MASK_LOOKUP[pixelMask]!;
        const encodingType = numberOfPixelBits !== 0 && v.encodingTypeBitstreamSize > 0 ? et.getBit() : 0;
        let decodedPixel = 0;

        for (let i = 0; i < numberOfPixelBits; i++) {
          if (encodingType !== 0) {
            pixelStack[i] = rp.getBits(8);
          } else {
            let pixel = lastPixel;
            let pixelDisplacement = pcd.getBits(4);
            pixel += pixelDisplacement;
            while (pixelDisplacement === 15) {
              pixelDisplacement = pcd.getBits(4);
              pixel += pixelDisplacement;
            }
            pixelStack[i] = pixel;
          }

          if (pixelStack[i] === lastPixel) {
            pixelStack[i] = 0;
            break;
          } else {
            lastPixel = pixelStack[i]!;
            decodedPixel++;
          }
        }

        const oldEntry = cellBuffer[currentCell];
        const entry: PixelBufferEntry = {
          value: new Uint8Array(4),
          frame: frameIndex,
          frameCellIndex: cellX + cellY * frame.horizontalCellCount,
        };

        let curIdx = decodedPixel - 1;
        for (let i = 0; i < 4; i++) {
          if (pixelMask & (1 << i)) {
            if (curIdx >= 0) {
              entry.value[i] = pixelStack[curIdx]!;
              curIdx--;
            } else {
              entry.value[i] = 0;
            }
          } else {
            entry.value[i] = oldEntry!.value[i]!;
          }
        }

        v.pixelBuffer.push(entry);
        cellBuffer[currentCell] = entry;
      }
    }
  }

  // Convert the palette entry index into actual palette entries
  for (const entry of v.pixelBuffer) {
    for (let x = 0; x < 4; x++) {
      entry.value[x] = v.paletteEntries[entry.value[x]!]!;
    }
  }
}

const NO_ENTRY: PixelBufferEntry = { value: new Uint8Array(4), frame: -1, frameCellIndex: -1 };

function generateFrames(v: DirectionState, pcd: BitMuncher): void {
  let pbIdx = 0;
  const boxWidth = v.box.width;

  for (const c of v.cells) {
    c.lastWidth = -1;
    c.lastHeight = -1;
  }

  v.pixelData = new Uint8Array(boxWidth * v.box.height);
  let frameIndex = -1;

  for (const frame of v.frames) {
    frameIndex++;
    frame.pixelData = new Uint8Array(boxWidth * v.box.height);
    let c = -1;

    for (const frameCell of frame.cells) {
      c++;

      const cellX = Math.trunc(frameCell.xOffset / CELL_SIZE);
      const cellY = Math.trunc(frameCell.yOffset / CELL_SIZE);
      const bufferCell = v.cells[cellX + cellY * v.horizontalCellCount]!;
      const pbe = v.pixelBuffer[pbIdx] ?? NO_ENTRY;

      if (pbe.frame !== frameIndex || pbe.frameCellIndex !== c) {
        // This buffer cell has an EqualCell bit set to 1, so copy the frame cell or clear it
        if (frameCell.width !== bufferCell.lastWidth || frameCell.height !== bufferCell.lastHeight) {
          // Different sizes
          for (let y = 0; y < frameCell.height; y++) {
            for (let x = 0; x < frameCell.width; x++) {
              v.pixelData[x + frameCell.xOffset + (y + frameCell.yOffset) * boxWidth] = 0;
            }
          }
        } else {
          // Same sizes: copy the old frame cell into the new position
          for (let fy = 0; fy < frameCell.height; fy++) {
            for (let fx = 0; fx < frameCell.width; fx++) {
              v.pixelData[fx + frameCell.xOffset + (fy + frameCell.yOffset) * boxWidth] =
                v.pixelData[fx + bufferCell.lastXOffset + (fy + bufferCell.lastYOffset) * boxWidth]!;
            }
          }
          // Copy it again into the final frame image
          for (let fy = 0; fy < frameCell.height; fy++) {
            for (let fx = 0; fx < frameCell.width; fx++) {
              const i = fx + frameCell.xOffset + (fy + frameCell.yOffset) * boxWidth;
              frame.pixelData[i] = v.pixelData[i]!;
            }
          }
        }
      } else {
        if (pbe.value[0] === pbe.value[1]) {
          // Clear the frame
          for (let y = 0; y < frameCell.height; y++) {
            for (let x = 0; x < frameCell.width; x++) {
              v.pixelData[x + frameCell.xOffset + (y + frameCell.yOffset) * boxWidth] = pbe.value[0]!;
            }
          }
        } else {
          // Fill the frame cell with the pixels
          const bitsToRead = pbe.value[1] !== pbe.value[2] ? 2 : 1;
          for (let y = 0; y < frameCell.height; y++) {
            for (let x = 0; x < frameCell.width; x++) {
              const paletteIndex = pcd.getBits(bitsToRead);
              v.pixelData[x + frameCell.xOffset + (y + frameCell.yOffset) * boxWidth] = pbe.value[paletteIndex]!;
            }
          }
        }

        // Copy the frame cell into the frame
        for (let fy = 0; fy < frameCell.height; fy++) {
          for (let fx = 0; fx < frameCell.width; fx++) {
            const i = fx + frameCell.xOffset + (fy + frameCell.yOffset) * boxWidth;
            frame.pixelData[i] = v.pixelData[i]!;
          }
        }
        pbIdx++;
      }

      bufferCell.lastWidth = frameCell.width;
      bufferCell.lastHeight = frameCell.height;
      bufferCell.lastXOffset = frameCell.xOffset;
      bufferCell.lastYOffset = frameCell.yOffset;
    }
  }
}
