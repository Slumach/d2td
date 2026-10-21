import { describe, expect, it } from 'vitest';

import { BLOCKED_TILES, createMap, isBlocked, isPathTile } from './map.ts';
import { canBuild } from './sim.ts';
import { testSim } from './testkit.ts';

describe('map', () => {
  it('runs a switchback road 40 to 50% longer than the M1 path, on the 28 x 17 grid', () => {
    // The 30 x 17 map's waypoints, for the length the path must keep
    const before = createMap([
      { x: -1, y: 3 }, { x: 6, y: 3 }, { x: 6, y: 12 }, { x: 11, y: 12 }, { x: 15, y: 8 }, { x: 15, y: 3 },
      { x: 22, y: 3 }, { x: 22, y: 13 }, { x: 26, y: 13 }, { x: 26, y: 7 }, { x: 30, y: 7 },
    ]);
    const map = createMap();
    expect(map.width).toBe(28);
    expect(map.height).toBe(17);
    expect(map.length / before.length).toBeGreaterThan(1.4);
    expect(map.length / before.length).toBeLessThan(1.5);
  });
});

describe('scenery', () => {
  it('blocks building where scenery stands, never on the path', () => {
    const map = createMap();
    expect(BLOCKED_TILES.length).toBeGreaterThan(0);
    for (const t of BLOCKED_TILES) {
      expect(isBlocked(map, t.x, t.y)).toBe(true);
      expect(isPathTile(map, t.x, t.y), `${t.x},${t.y} is on the path`).toBe(false);
    }
    const sim = testSim();
    const t = BLOCKED_TILES[0]!;
    expect(canBuild(sim, t.x, t.y)).toBe(false);
    expect(canBuild(sim, 3, 4)).toBe(true);
  });
});
