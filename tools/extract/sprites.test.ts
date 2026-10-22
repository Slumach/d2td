import { describe, expect, it } from 'vitest';

import { decodePl2, PL2_SIZE } from '../lib/pl2.ts';
import { composite } from './composite.ts';
import { heroGearPath, parseHeroGearPath, remapped, trim } from './sprites.ts';

describe('pal.pl2', () => {
  it('matches the 443,175-byte layout of D2 pal.pl2 and reads the hue tables', () => {
    expect(PL2_SIZE).toBe(443_175);
    const data = new Uint8Array(PL2_SIZE);
    // Hue variation 3 maps index 10 to 20; it starts after base, light, inv, select, blends
    const hueStart = 1024 + 32 * 256 + 16 * 256 + 256 + 3 * 256 * 256 + 256 * 256 * 2;
    data[hueStart + 3 * 256 + 10] = 20;
    const pl2 = decodePl2(data);
    expect(pl2.hueVariations).toHaveLength(111);
    expect(pl2.hueVariations[3]![10]).toBe(20);
    expect(() => decodePl2(new Uint8Array(10))).toThrow(/443175/);
  });
});

describe('palette remaps', () => {
  it('chains maps and keeps index 0 transparent', () => {
    const palette = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) palette.set([i, i, i, i === 0 ? 0 : 255], i * 4);
    const a = new Uint8Array(256).map((_, i) => i);
    const b = new Uint8Array(256).map((_, i) => i);
    a[5] = 9;
    b[9] = 40;
    const out = remapped(palette, [a, b]);
    expect(Array.from(out.subarray(5 * 4, 5 * 4 + 4))).toEqual([40, 40, 40, 255]);
    expect(out[3]).toBe(0);
  });
});

describe('trim', () => {
  it('cuts a frame to its visible pixels and remembers where they were', () => {
    const w = 6;
    const h = 5;
    const rgba = new Uint8Array(w * h * 4);
    rgba.set([1, 2, 3, 255], (2 * w + 3) * 4);
    rgba.set([4, 5, 6, 255], (3 * w + 4) * 4);
    const t = trim('f', rgba, w, h);
    expect([t.x, t.y, t.w, t.h]).toEqual([3, 2, 2, 2]);
    expect(Array.from(t.pixels.subarray(0, 4))).toEqual([1, 2, 3, 255]);
    expect(trim('empty', new Uint8Array(w * h * 4), w, h)).toMatchObject({ w: 1, h: 1 });
  });
});

describe('composite glow layers', () => {
  it('bakes additive layers: brightness becomes alpha on empty pixels, colours add on the body', () => {
    const palette = new Uint8Array(256 * 4);
    palette.set([100, 0, 0, 255], 1 * 4);
    palette.set([0, 50, 0, 255], 2 * 4);
    const dcc = (index: number) => ({
      version: 6,
      numberOfDirections: 1,
      framesPerDirection: 1,
      directions: [
        {
          box: { left: 0, top: 0, width: 2, height: 1 },
          frames: [{ width: 2, height: 1, xOffset: 0, yOffset: 0, box: { left: 0, top: 0, width: 2, height: 1 }, pixelData: new Uint8Array(index === 1 ? [1, 0] : [2, 2]) }],
        },
      ],
    });
    const cof = { numberOfLayers: 2, framesPerDirection: 1, numberOfDirections: 1, speed: 0, layers: [], animationFrames: [0], priority: [[[0, 1]]] };
    const result = composite(cof, [{ type: 0, dcc: dcc(1), alpha: 255 }, { type: 1, dcc: dcc(2), alpha: 255, additive: true }], palette);
    const px = result.frames[0]![0]!;
    // Pixel 0: body red plus glow green
    expect(Array.from(px.subarray(0, 4))).toEqual([100, 50, 0, 255]);
    // Pixel 1: glow alone, green at full colour with its brightness as alpha
    expect(Array.from(px.subarray(4, 8))).toEqual([0, 255, 0, 50]);
  });
});

describe('worn looks', () => {
  it('name an atlas by class, line, tier, weapon and shield, and read it back from its JSON or page path', () => {
    const spec = { cls: 'paladin', line: 'zealot', look: 't2', weapon: 'lbw', shield: '' };
    expect(heroGearPath(spec)).toBe('hero-gear/paladin/zealot-t2-lbw-own');
    expect(parseHeroGearPath('hero-gear/paladin/zealot-t2-lbw-own.json')).toEqual(spec);
    expect(parseHeroGearPath('hero-gear/paladin/zealot-t2-lbw-own-0.png')).toEqual(spec);
    expect(parseHeroGearPath('hero-gear/paladin/zealot-evolved-own-tow.json')).toEqual({ ...spec, look: 'evolved', weapon: '', shield: 'tow' });
    expect(parseHeroGearPath('hero/paladin/zealot-t2.json')).toBeUndefined();
    expect(parseHeroGearPath('hero-gear/../../secret.json')).toBeUndefined();
  });
});
