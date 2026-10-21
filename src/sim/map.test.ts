import { describe, expect, it } from 'vitest';

import { ARC_COUNT, MAP_SIZE, arcAt, blockedTiles, createMap, isBlocked, isPathTile, positionAt, rotateTile, tileCenter } from './map.ts';
import { canBuild } from './sim.ts';
import { testSim } from './testkit.ts';

describe('ring', () => {
  const map = createMap();

  it('is a closed loop of four identical arcs on a square grid', () => {
    expect(map.width).toBe(MAP_SIZE);
    expect(map.height).toBe(MAP_SIZE);
    expect(map.arcs).toHaveLength(ARC_COUNT);
    // Every arc is the same length, and walking off the end comes back to the start
    const lengths = map.arcs.map((a, k) => (map.arcs[k + 1]?.start ?? map.length) - a.start);
    expect(new Set(lengths).size).toBe(1);
    expect(positionAt(map, map.length)).toEqual(positionAt(map, 0));
    expect(positionAt(map, map.length + 1234)).toEqual(positionAt(map, 1234));
    // Each arc is arc 0 turned a quarter more
    for (let k = 1; k < ARC_COUNT; k++) {
      const p = positionAt(map, map.arcs[k]!.start + 4000);
      const q = positionAt(map, 4000);
      const turned = rotateTile({ x: Math.floor(q.x / 1000), y: Math.floor(q.y / 1000) }, k);
      expect({ x: Math.floor(p.x / 1000), y: Math.floor(p.y / 1000) }).toEqual(turned);
    }
  });

  it("has a U-bend whose pocket tile touches all three legs, and each arc's spawn just past its corner", () => {
    // Arc 0's U: legs down x = 30 and up x = 32, bottom along y = 7; the pocket is x = 31
    for (const y of [3, 4, 5, 6, 7]) {
      expect(isPathTile(map, 30, y)).toBe(true);
      expect(isPathTile(map, 32, y)).toBe(true);
    }
    expect(isPathTile(map, 31, 7)).toBe(true);
    for (const y of [3, 4, 5, 6]) expect(isPathTile(map, 31, y)).toBe(false);
    const pocket = { x: 31, y: 6 };
    expect([isPathTile(map, 30, 6), isPathTile(map, 32, 6), isPathTile(map, 31, 7)]).toEqual([true, true, true]);
    expect(isBlocked(map, pocket.x, pocket.y)).toBe(false);
    // Spawns sit one tile past each arc's first corner
    for (const a of map.arcs) expect(a.spawn - a.start).toBe(1000);
    expect(positionAt(map, map.arcs[0]!.spawn)).toEqual(tileCenter({ x: 4, y: 3 }));
  });

  it('gives every tile to one arc, rotationally, and each arc its own handoff corner', () => {
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const k = arcAt(map, x, y);
        const turned = rotateTile({ x, y }, 1);
        expect(arcAt(map, turned.x, turned.y)).toBe((k + 1) % ARC_COUNT);
      }
    }
    expect(arcAt(map, 3, 3)).toBe(0);
    expect(arcAt(map, 38, 3)).toBe(1);
  });
});

describe('scenery', () => {
  it('blocks building where scenery stands, never on the path, the same on every arc', () => {
    const map = createMap();
    const tiles = blockedTiles();
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(isBlocked(map, t.x, t.y)).toBe(true);
      expect(isPathTile(map, t.x, t.y), `${t.x},${t.y} is on the path`).toBe(false);
      const turned = rotateTile(t, 1);
      expect(isBlocked(map, turned.x, turned.y)).toBe(true);
    }
    const sim = testSim();
    const t = tiles[0]!;
    expect(canBuild(sim, t.x, t.y)).toBe(false);
    expect(canBuild(sim, 7, 5)).toBe(true);
  });
});
