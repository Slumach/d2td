import { describe, expect, it } from 'vitest';

import { UNITS_PER_TILE } from '../sim/fixed.ts';
import { MAP_HEIGHT, MAP_WIDTH } from '../sim/map.ts';
import { ISO_H, ISO_W, MAP_PX_HEIGHT, MAP_PX_WIDTH, ellipseOf, project, projectTile, screenVector, tileAtScreen } from './iso.ts';
import { GAME_WIDTH, HUD_HEIGHT, MAP_AREA_HEIGHT } from './layout.ts';

describe('isometric view', () => {
  it('fits the whole diamond inside the map area', () => {
    expect(MAP_PX_WIDTH).toBeLessThanOrEqual(GAME_WIDTH);
    expect(MAP_PX_HEIGHT).toBeLessThanOrEqual(MAP_AREA_HEIGHT);
    const corners = [projectTile(0, 0), projectTile(MAP_WIDTH, 0), projectTile(0, MAP_HEIGHT), projectTile(MAP_WIDTH, MAP_HEIGHT)];
    for (const c of corners) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(GAME_WIDTH);
      expect(c.y).toBeGreaterThanOrEqual(HUD_HEIGHT);
      expect(c.y).toBeLessThanOrEqual(HUD_HEIGHT + MAP_AREA_HEIGHT);
    }
  });

  it('draws one tile as a 64 x 32 diamond', () => {
    const top = projectTile(3, 4);
    expect(projectTile(4, 4)).toEqual({ x: top.x + ISO_W / 2, y: top.y + ISO_H / 2 });
    expect(projectTile(3, 5)).toEqual({ x: top.x - ISO_W / 2, y: top.y + ISO_H / 2 });
  });

  it('finds the tile under every tile centre, and nothing off the map', () => {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const c = project(x * UNITS_PER_TILE + UNITS_PER_TILE / 2, y * UNITS_PER_TILE + UNITS_PER_TILE / 2);
        expect(tileAtScreen(c.x, c.y)).toEqual({ x, y });
      }
    }
    const outside = projectTile(-1, 5);
    expect(tileAtScreen(outside.x, outside.y + 2)).toBeUndefined();
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
