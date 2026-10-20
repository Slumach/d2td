import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodeAnimData } from './animdata.ts';
import { BitMuncher, makeSigned } from './bitmuncher.ts';
import { compositeCode, decodeCof } from './cof.ts';
import { decodeDcc } from './dcc.ts';
import { decodePalDat } from './palette.ts';
import { encodePng } from './png.ts';

describe('BitMuncher', () => {
  it('reads bits least significant first across byte boundaries', () => {
    const bm = new BitMuncher(new Uint8Array([0b1010_1101, 0b0000_0011]));
    expect(bm.getBits(3)).toBe(0b101);
    expect(bm.getBits(7)).toBe(0b11_10101);
    expect(bm.read).toBe(10);
  });

  it('reads 32-bit values without going negative', () => {
    const bm = new BitMuncher(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    expect(bm.copy().getUInt32()).toBe(0xffffffff);
    expect(bm.getInt32()).toBe(-1);
  });

  it('copies at the current bit with a fresh read counter', () => {
    const bm = new BitMuncher(new Uint8Array([0xf0]));
    bm.skipBits(4);
    const copy = bm.copy();
    expect(copy.read).toBe(0);
    expect(copy.getBits(4)).toBe(0xf);
  });
});

describe('makeSigned', () => {
  it('matches two-s complement, with the 1-bit special case', () => {
    expect(makeSigned(0b0111, 4)).toBe(7);
    expect(makeSigned(0b1000, 4)).toBe(-8);
    expect(makeSigned(0b1111, 4)).toBe(-1);
    expect(makeSigned(1, 1)).toBe(-1);
    expect(makeSigned(5, 0)).toBe(0);
  });
});

describe('decodePalDat', () => {
  it('swaps BGR to RGB and makes index 0 transparent', () => {
    const dat = new Uint8Array(768);
    dat.set([1, 2, 3], 0);
    dat.set([10, 20, 30], 3);
    const pal = decodePalDat(dat);
    expect(Array.from(pal.subarray(0, 8))).toEqual([3, 2, 1, 0, 30, 20, 10, 255]);
  });
});

describe('encodePng', () => {
  it('writes a valid header and scanlines that inflate back to the pixels', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]);
    const png = encodePng(2, 1, rgba);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(2);
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(Array.from(raw)).toEqual([0, ...rgba]);
  });
});

// Runs only on a machine with a local CascView export; the repo holds no game files.
const zm = join('assets-raw', 'data', 'data', 'global', 'monsters', 'zm');
describe.skipIf(!existsSync(zm))('zombie walk from assets-raw', () => {
  it('decodes the COF, every layer DCC and the animdata record consistently', () => {
    const cof = decodeCof(new Uint8Array(readFileSync(join(zm, 'cof', 'zmwlhth.cof'))));
    expect(cof.numberOfDirections).toBe(8);

    for (const layer of cof.layers) {
      const code = compositeCode(layer.type);
      const variant = code === 'S3' ? 'bld' : 'lit';
      const file = join(zm, code.toLowerCase(), `zm${code}${variant}wl${layer.weaponClass}.dcc`.toLowerCase());
      const dcc = decodeDcc(new Uint8Array(readFileSync(file)));
      expect(dcc.numberOfDirections).toBe(cof.numberOfDirections);
      expect(dcc.framesPerDirection).toBe(cof.framesPerDirection);
      for (const dir of dcc.directions) {
        expect(dir.frames.every((f) => f.pixelData.length === dir.box.width * dir.box.height)).toBe(true);
      }
    }

    const animdata = decodeAnimData(new Uint8Array(readFileSync(join(zm, '..', '..', 'animdata.d2'))));
    expect(animdata.get('ZMWLHTH')?.[0]?.framesPerDirection).toBe(cof.framesPerDirection);
  });
});
