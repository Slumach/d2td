import { describe, expect, it } from 'vitest';

import { integerZoom } from './zoom.ts';

const W = 1440;
const H = 1016;

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
