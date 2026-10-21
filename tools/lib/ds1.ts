// DS1: D2's level preset files (a grid of D2 cells with floor, wall, orientation, shadow and
// substitution layers, then objects). Ported from OpenDiablo2's
// d2common/d2fileformats/d2ds1/ds1.go (layer order, the per-version header fields and the
// cell bit layout); we read the tile layers and stop before the objects, which the bake
// does not use.
//
// A wall or floor cell names a DT1 tile by style (its main index) and sequence (its sub
// index); a wall's orientation layer gives the DT1 orientation it draws with. Prop1 of 0
// means the cell is empty.

export interface Ds1Cell {
  prop1: number;
  sequence: number;
  style: number;
  hidden: boolean;
}

export interface Ds1Wall extends Ds1Cell {
  orientation: number;
}

export interface Ds1 {
  version: number;
  /** In D2 cells (160 x 80 px each). */
  width: number;
  height: number;
  /** The DT1 files the preset names, if any (version 3 on). */
  files: string[];
  /** walls[layer][y * width + x], floors[layer][...], shadows[y * width + x]. */
  walls: Ds1Wall[][];
  floors: Ds1Cell[][];
  shadows: Ds1Cell[];
}

/** Versions before 7 store orientations through this table (OpenDiablo2's dirLookup). */
const DIR_LOOKUP = [0x00, 0x01, 0x02, 0x01, 0x02, 0x03, 0x03, 0x05, 0x05, 0x06, 0x06, 0x07, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x14];

function cell(dw: number): Ds1Cell {
  return {
    prop1: dw & 0xff,
    sequence: (dw >>> 8) & 0x3f,
    style: (dw >>> 20) & 0x3f,
    hidden: dw >>> 31 === 1,
  };
}

export function decodeDs1(data: Uint8Array): Ds1 {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const i32 = () => ((pos += 4), view.getInt32(pos - 4, true));
  const u32 = () => ((pos += 4), view.getUint32(pos - 4, true));

  const version = i32();
  const width = i32() + 1;
  const height = i32() + 1;
  if (version >= 8) i32(); // act
  const substitutionType = version >= 10 ? i32() : 0;
  const files: string[] = [];
  if (version >= 3) {
    const count = i32();
    for (let i = 0; i < count; i++) {
      let s = '';
      for (let c = view.getUint8(pos++); c !== 0; c = view.getUint8(pos++)) s += String.fromCharCode(c);
      files.push(s);
    }
  }
  // Two unused dwords in versions 9 to 13
  if (version >= 9 && version <= 13) pos += 8;
  const wallCount = version >= 4 ? i32() : 1;
  const floorCount = version >= 16 ? i32() : 1;

  // The order the layers are stored in
  type Layer = { kind: 'wall' | 'orientation' | 'floor' | 'shadow' | 'substitution'; index: number };
  const layers: Layer[] = [];
  if (version < 4) {
    layers.push({ kind: 'wall', index: 0 }, { kind: 'floor', index: 0 }, { kind: 'orientation', index: 0 }, { kind: 'substitution', index: 0 }, { kind: 'shadow', index: 0 });
  } else {
    for (let i = 0; i < wallCount; i++) layers.push({ kind: 'wall', index: i }, { kind: 'orientation', index: i });
    for (let i = 0; i < floorCount; i++) layers.push({ kind: 'floor', index: i });
    layers.push({ kind: 'shadow', index: 0 });
    if (substitutionType === 1 || substitutionType === 2) layers.push({ kind: 'substitution', index: 0 });
  }

  const size = width * height;
  const empty = (): Ds1Cell => ({ prop1: 0, sequence: 0, style: 0, hidden: false });
  const walls: Ds1Wall[][] = Array.from({ length: wallCount }, () => Array.from({ length: size }, () => ({ ...empty(), orientation: 0 })));
  const floors: Ds1Cell[][] = Array.from({ length: floorCount }, () => Array.from({ length: size }, empty));
  const shadows: Ds1Cell[] = Array.from({ length: size }, empty);

  for (const layer of layers) {
    for (let i = 0; i < size; i++) {
      const dw = u32();
      if (layer.kind === 'wall') Object.assign(walls[layer.index]![i]!, cell(dw));
      else if (layer.kind === 'orientation') {
        const o = dw & 0xff;
        walls[layer.index]![i]!.orientation = version < 7 ? (DIR_LOOKUP[o] ?? o) : o;
      } else if (layer.kind === 'floor') floors[layer.index]![i] = cell(dw);
      else if (layer.kind === 'shadow') shadows[i] = cell(dw);
    }
  }
  return { version, width, height, files, walls, floors, shadows };
}
