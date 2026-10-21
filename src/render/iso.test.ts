import { describe, expect, it } from 'vitest';

import { UNITS_PER_TILE } from '../sim/fixed.ts';
import { MAP_SIZE } from '../sim/map.ts';
import { ISO_H, ISO_W, WORLD_HEIGHT, WORLD_WIDTH, ellipseOf, project, projectTile, screenVector, tileAtWorld } from './iso.ts';

describe('isometric view', () => {
  it('fits the whole diamond inside the world, with room round it', () => {
    const corners = [projectTile(0, 0), projectTile(MAP_SIZE, 0), projectTile(0, MAP_SIZE), projectTile(MAP_SIZE, MAP_SIZE)];
    for (const c of corners) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(WORLD_WIDTH);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThan(WORLD_HEIGHT);
    }
  });

  it('draws one tile as a 64 x 32 diamond', () => {
    const top = projectTile(3, 4);
    expect(projectTile(4, 4)).toEqual({ x: top.x + ISO_W / 2, y: top.y + ISO_H / 2 });
    expect(projectTile(3, 5)).toEqual({ x: top.x - ISO_W / 2, y: top.y + ISO_H / 2 });
  });

  it('finds the tile under every tile centre, and nothing off the map', () => {
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const c = project(x * UNITS_PER_TILE + UNITS_PER_TILE / 2, y * UNITS_PER_TILE + UNITS_PER_TILE / 2);
        expect(tileAtWorld(c.x, c.y)).toEqual({ x, y });
      }
    }
    const outside = projectTile(-1, 5);
    expect(tileAtWorld(outside.x, outside.y + 2)).toBeUndefined();
  });

  it('turns sim directions into the screen vectors D2 sprites face', () => {
    // Sim +x runs down-right, +y down-left, at 2:1
    expect(screenVector(1000, 0)).toEqual({ x: 2000, y: 1000 });
    expect(screenVector(0, 1000)).toEqual({ x: -2000, y: 1000 });
  });

  it('shows a circle as a 2:1 ellipse', () => {
    const e = ellipseOf(UNITS_PER_TILE);
    expect(e.w / e.h).toBeCloseTo(2);
  });
});
