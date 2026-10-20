// Ported from OpenDiablo2 (commit 7f92c57): d2common/d2fileformats/d2pl2/pl2.go,
// pl2_palette.go, pl2_color.go, pl2_color_24bits.go, pl2_palette_transform.go.
// The Go code unpacks the struct with restruct; this reads the same fields at their
// fixed offsets. A transform is 256 palette indices: pixel index i becomes table[i].

export interface Pl2 {
  /** The base palette, 256 RGB colours. */
  base: Uint8Array[];
  lightLevelVariations: Uint8Array[];
  invColorVariations: Uint8Array[];
  selectedUnitShift: Uint8Array;
  /** 111 hue shifts; D2 tints unique and champion monsters with these. */
  hueVariations: Uint8Array[];
  redTones: Uint8Array;
  greenTones: Uint8Array;
  blueTones: Uint8Array;
  unknownVariations: Uint8Array[];
  darkenedColorShift: Uint8Array;
}

const T = 256;
/** Field sizes in file order, from the Go struct. */
const LAYOUT = {
  basePalette: 256 * 4,
  lightLevelVariations: 32 * T,
  invColorVariations: 16 * T,
  selectedUnitShift: T,
  alphaBlend: 3 * 256 * T,
  additiveBlend: 256 * T,
  multiplicativeBlend: 256 * T,
  hueVariations: 111 * T,
  redTones: T,
  greenTones: T,
  blueTones: T,
  unknownVariations: 14 * T,
  maxComponentBlend: 256 * T,
  darkenedColorShift: T,
  textColors: 13 * 3,
  textColorShifts: 13 * T,
} as const;

export const PL2_SIZE = Object.values(LAYOUT).reduce((n, v) => n + v, 0);

export function decodePl2(data: Uint8Array): Pl2 {
  if (data.length !== PL2_SIZE) throw new Error(`pal.pl2 should be ${PL2_SIZE} bytes, got ${data.length}`);
  const offsets = {} as Record<keyof typeof LAYOUT, number>;
  let at = 0;
  for (const [name, size] of Object.entries(LAYOUT) as [keyof typeof LAYOUT, number][]) {
    offsets[name] = at;
    at += size;
  }
  const table = (offset: number) => data.slice(offset, offset + T);
  const tables = (name: keyof typeof LAYOUT, count: number) =>
    Array.from({ length: count }, (_, i) => table(offsets[name] + i * T));
  return {
    base: Array.from({ length: 256 }, (_, i) => data.slice(offsets.basePalette + i * 4, offsets.basePalette + i * 4 + 3)),
    lightLevelVariations: tables('lightLevelVariations', 32),
    invColorVariations: tables('invColorVariations', 16),
    selectedUnitShift: table(offsets.selectedUnitShift),
    hueVariations: tables('hueVariations', 111),
    redTones: table(offsets.redTones),
    greenTones: table(offsets.greenTones),
    blueTones: table(offsets.blueTones),
    unknownVariations: tables('unknownVariations', 14),
    darkenedColorShift: table(offsets.darkenedColorShift),
  };
}
