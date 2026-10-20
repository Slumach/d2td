// Ported from OpenDiablo2 (commit 7f92c57):
//   d2common/d2fileformats/d2cof/cof.go (Unmarshal, loadHeader, loadCOFLayers, loadAnimationFrames, loadPriority)
//   d2common/d2fileformats/d2cof/cof_layer.go
//   d2common/d2enum/composite_type.go (layer codes)
//   d2common/d2enum/draw_effect.go
// Weapon class is kept as its raw code ("hth") instead of the d2enum WeaponClass type.

const NUM_UNKNOWN_HEADER_BYTES = 21;
const NUM_UNKNOWN_BODY_BYTES = 3;
const NUM_HEADER_BYTES = 4 + NUM_UNKNOWN_HEADER_BYTES;
const NUM_LAYER_BYTES = 9;
const HEADER_SPEED = NUM_HEADER_BYTES - 1;

/** COF layer types in d2enum.CompositeType order; the index is the type value. */
export const COMPOSITE_TYPES = [
  'HD', 'TR', 'LG', 'RA', 'LA', 'RH', 'LH', 'SH',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8',
] as const;

export type CompositeCode = (typeof COMPOSITE_TYPES)[number];

/** d2enum.DrawEffect values. */
export const DrawEffect = {
  PctTransparency25: 0,
  PctTransparency50: 1,
  PctTransparency75: 2,
  Modulate: 3,
  Burn: 4,
  Normal: 5,
  Mod2XTrans: 6,
  Mod2X: 7,
  None: 8,
} as const;

export interface CofLayer {
  /** CompositeType index into COMPOSITE_TYPES. */
  type: number;
  shadow: number;
  selectable: boolean;
  transparent: boolean;
  drawEffect: number;
  weaponClass: string;
}

export interface Cof {
  numberOfLayers: number;
  framesPerDirection: number;
  numberOfDirections: number;
  speed: number;
  layers: CofLayer[];
  /** Per frame trigger byte (attack, sound and so on). */
  animationFrames: number[];
  /** priority[direction][frame] lists layer types in draw order, back to front. */
  priority: number[][][];
}

export function compositeCode(type: number): CompositeCode {
  const code = COMPOSITE_TYPES[type];
  if (code === undefined) throw new Error(`Unknown COF composite type ${type}`);
  return code;
}

export function decodeCof(fileData: Uint8Array): Cof {
  let pos = 0;
  const readBytes = (n: number): Uint8Array => {
    if (pos + n > fileData.length) {
      throw new Error(`COF truncated: wanted ${n} bytes at ${pos}, file is ${fileData.length}`);
    }
    const out = fileData.subarray(pos, pos + n);
    pos += n;
    return out;
  };

  const header = readBytes(NUM_HEADER_BYTES);
  const numberOfLayers = header[0]!;
  const framesPerDirection = header[1]!;
  const numberOfDirections = header[2]!;
  const speed = header[HEADER_SPEED]!;

  readBytes(NUM_UNKNOWN_BODY_BYTES);

  const layers: CofLayer[] = [];
  for (let i = 0; i < numberOfLayers; i++) {
    const b = readBytes(NUM_LAYER_BYTES);
    const weaponBytes = Array.from(b.subarray(5)).filter((c) => c !== 0);
    layers.push({
      type: b[0]!,
      shadow: b[1]!,
      selectable: b[2]! > 0,
      transparent: b[3]! > 0,
      drawEffect: b[4]!,
      weaponClass: String.fromCharCode(...weaponBytes).trim().toLowerCase(),
    });
  }

  const animationFrames = Array.from(readBytes(framesPerDirection));

  const priorityBytes = readBytes(framesPerDirection * numberOfDirections * numberOfLayers);
  const priority: number[][][] = [];
  let priorityIndex = 0;
  for (let direction = 0; direction < numberOfDirections; direction++) {
    const frames: number[][] = [];
    for (let frame = 0; frame < framesPerDirection; frame++) {
      const order: number[] = [];
      for (let i = 0; i < numberOfLayers; i++) {
        order.push(priorityBytes[priorityIndex++]!);
      }
      frames.push(order);
    }
    priority.push(frames);
  }

  return { numberOfLayers, framesPerDirection, numberOfDirections, speed, layers, animationFrames, priority };
}
