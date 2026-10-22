import { describe, expect, it } from 'vitest';

import { integerZoom, letterbox } from './zoom.ts';

const W = 1440;
const H = 1000;

describe('integerZoom', () => {
  it('is 1 at 1080p and 2 at 4K', () => {
    expect(integerZoom(1920, 1080, W, H)).toBe(1);
    expect(integerZoom(3840, 2160, W, H)).toBe(2);
  });

  it('takes the tighter axis', () => {
    expect(integerZoom(3840, 1600, W, H)).toBe(1);
    expect(integerZoom(2900, 4000, W, H)).toBe(2);
  });

  it('never drops below 1', () => {
    expect(integerZoom(800, 600, W, H)).toBe(1);
  });
});

describe('letterbox', () => {
  it('fits whole device pixels whatever the display scaling, with margins on device pixel boundaries', () => {
    // 1080p at 100%, 125% and 150%: one device pixel a game pixel, 480 x 80 device pixels spare
    for (const dpr of [1, 1.25, 1.5]) {
      const box = letterbox(1920 / dpr, 1080 / dpr, dpr, W, H);
      expect(box.devicePixels).toBe(1);
      expect(box.cssZoom).toBe(1 / dpr);
      expect([box.spareWidth, box.spareHeight]).toEqual([480, 80]);
      expect(Math.round(box.left * dpr)).toBe(240);
      expect(Math.round(box.top * dpr)).toBe(40);
    }
    // 1440p: still 1x (1.5x would fit the width but is not whole), 1120 x 440 spare
    expect(letterbox(2560, 1440, 1, W, H)).toMatchObject({ devicePixels: 1, spareWidth: 1120, spareHeight: 440 });
    // 4K: 2x, 960 x 160 spare, at 150% the CSS zoom is 2 / 1.5
    expect(letterbox(3840, 2160, 1, W, H)).toMatchObject({ devicePixels: 2, spareWidth: 960, spareHeight: 160 });
    expect(letterbox(3840 / 1.5, 2160 / 1.5, 1.5, W, H).cssZoom).toBeCloseTo(2 / 1.5);
    // Too small: zoom 1 and no margins, the page scrolls
    expect(letterbox(800, 600, 1, W, H)).toMatchObject({ devicePixels: 1, left: 0, top: 0 });
  });
});
