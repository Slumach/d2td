import { describe, expect, it } from 'vitest';

import { shortPath } from './paths.ts';

describe('shortPath', () => {
  it('leaves short paths alone', () => {
    expect(shortPath('C:\\Program Files (x86)\\Diablo II Resurrected', 60)).toBe('C:\\Program Files (x86)\\Diablo II Resurrected');
  });

  it('keeps the drive and as many trailing folders as fit', () => {
    const long = 'C:\\Users\\someone\\AppData\\Roaming\\D2 Tower Defense\\logs\\main.log';
    const short = shortPath(long, 40);
    expect(short).toBe('C:\\...\\D2 Tower Defense\\logs\\main.log');
    expect(short.length).toBeLessThanOrEqual(40);
  });

  it('cuts a single long last folder from the left', () => {
    const short = shortPath(`C:\\${'x'.repeat(80)}`, 30);
    expect(short.length).toBe(30);
    expect(short.startsWith('...')).toBe(true);
  });
});
