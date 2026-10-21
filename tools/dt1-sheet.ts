// Dev aid for authoring maps: renders every tile of some DT1 files from the D2R install
// into contact sheets, with a text index of each cell's orientation, main and sub index and
// rarity. Output goes wherever --out says and stays out of the repo (it is game art).
//
//   npx tsx tools/dt1-sheet.ts --out <dir> Act1/Town/Floor.dt1 Act1/Outdoors/Fence.dt1 ...

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { CascSource, type CascStorage } from './extract/source.ts';
import { detectD2R } from './lib/d2r.ts';
import { decodeDt1, tileImage } from './lib/dt1.ts';
import { decodePalDat } from './lib/palette.ts';
import { encodePng } from './lib/png.ts';

const { values: args, positionals } = parseArgs({ options: { out: { type: 'string' }, orient: { type: 'string' }, cols: { type: 'string', default: '8' } }, allowPositionals: true });
if (!args.out || positionals.length === 0) throw new Error('Usage: dt1-sheet --out <dir> <file.dt1>...');
const install = await detectD2R();
if (!install) throw new Error('No D2R install found');
const { Storage } = createRequire(import.meta.url)('@jamiephan/casclib') as { Storage: { open(p: string): CascStorage } };
const source = new CascSource(Storage.open(install), install);
const palette = decodePalDat(source.read('global/palette/act1/pal.dat'));
mkdirSync(args.out, { recursive: true });

const COLS = Number(args.cols);
/** --orient 14 keeps only trees, for a closer look. */
const only = args.orient === undefined ? undefined : Number(args.orient);
for (const file of positionals) {
  const all = decodeDt1(source.read(`global/tiles/${file}`.toLowerCase()));
  const dt1 = { tiles: all.tiles.filter((t) => only === undefined || t.orientation === only) };
  if (dt1.tiles.length === 0) continue;
  const images = dt1.tiles.map(tileImage);
  const cw = Math.max(...images.map((i) => i.width)) + 8;
  const ch = Math.max(...images.map((i) => i.height)) + 8;
  const rows = Math.ceil(images.length / COLS);
  const W = cw * COLS;
  const H = ch * rows;
  const rgba = new Uint8Array(W * H * 4);
  // Checker background so transparent parts show
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    const v = ((x >> 3) + (y >> 3)) % 2 ? 40 : 56;
    rgba.set([v, v, v + 8, 255], o);
  }
  const lines: string[] = [];
  images.forEach((img, i) => {
    const t = dt1.tiles[i]!;
    const cx = (i % COLS) * cw + 4;
    const cy = Math.floor(i / COLS) * ch + 4;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const c = img.pixels[y * img.width + x]!;
      if (!c) continue;
      const o = ((cy + y) * W + cx + x) * 4;
      rgba.set(palette.subarray(c * 4, c * 4 + 4), o);
    }
    lines.push(`${i}\tcell ${i % COLS},${Math.floor(i / COLS)}\torient ${t.orientation}\tmain ${t.mainIndex}\tsub ${t.subIndex}\trarity ${t.rarity}\t${img.width}x${img.height}\tyOff ${img.yOffset}\tblocks ${t.blocks.length}`);
  });
  const name = file.replace(/[\\/]/g, '_').replace(/\.dt1$/i, '') + (only === undefined ? '' : `_o${only}`);
  writeFileSync(join(args.out, `${name}.png`), encodePng(W, H, rgba));
  writeFileSync(join(args.out, `${name}.txt`), `${file}: ${dt1.tiles.length} tiles, cells ${cw}x${ch}\n${lines.join('\n')}\n`);
  console.log(`${file}: ${dt1.tiles.length} tiles -> ${name}.png`);
}
source.close();
