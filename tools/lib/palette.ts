// Ported from OpenDiablo2 (commit 7f92c57): d2common/d2fileformats/d2dat/dat.go (Load)
// and the index-0-is-transparent rule from d2common/d2util/palette.go (ImgIndexToRGBA).

/** 256 colours as packed RGBA bytes. Index 0 is always fully transparent. */
export type Palette = Uint8Array;

/** pal.dat stores 256 colours as B, G, R triplets. */
export function decodePalDat(data: Uint8Array): Palette {
  if (data.length < 256 * 3) {
    throw new Error(`pal.dat too short: ${data.length} bytes`);
  }
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    out[i * 4] = data[i * 3 + 2]!;
    out[i * 4 + 1] = data[i * 3 + 1]!;
    out[i * 4 + 2] = data[i * 3]!;
    out[i * 4 + 3] = i === 0 ? 0 : 255;
  }
  return out;
}
