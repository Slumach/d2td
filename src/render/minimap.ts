// The minimap in the top-right corner: the ring in the same isometric view at 1/16 scale,
// path tiles in the colour of the player whose arc they are, a dot per monster (so a
// crowded arc shows), and the world camera's view as a box. Clicking it moves the camera.

import Phaser from 'phaser';

import { isBlocked, isPathTile } from '../sim/map.ts';
import type { Sim } from '../sim/state.ts';
import { WORLD_HEIGHT, WORLD_WIDTH, project, tileDiamond } from './iso.ts';
import type { WorldView } from './view.ts';

const SCALE = 16;
/** Redraw the moving parts this often, in frames. */
const EVERY = 6;

export class Minimap {
  readonly width = WORLD_WIDTH / SCALE;
  readonly height = WORLD_HEIGHT / SCALE;
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly live: Phaser.GameObjects.Graphics;
  private frame = 0;
  private drawnFor: Sim | undefined;

  constructor(
    scene: Phaser.Scene,
    private readonly view: WorldView,
    private readonly x: number,
    private readonly y: number,
    depth: number,
  ) {
    this.ground = scene.add.graphics().setDepth(depth);
    this.live = scene.add.graphics().setDepth(depth + 1);
    scene.add
      .zone(x, y, this.width, this.height)
      .setOrigin(0)
      .setDepth(depth + 2)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (p: Phaser.Input.Pointer) => view.centreOn((p.x - x) * SCALE, (p.y - y) * SCALE));
  }

  /** Draws `sim`'s ring; `colourOf(arc)` is the arc owner's colour. */
  draw(sim: Sim, colourOf: (arc: number) => number): void {
    if (this.drawnFor !== sim) {
      this.drawnFor = sim;
      this.drawGround(sim, colourOf);
    }
    if (this.frame++ % EVERY !== 0) return;
    const g = this.live.clear();
    const at = (wx: number, wy: number) => ({ x: this.x + wx / SCALE, y: this.y + wy / SCALE });
    for (const m of sim.state.monsters) {
      const w = project(m.x, m.y);
      const p = at(w.x, w.y);
      const r = m.rank === 'normal' ? 1 : 2;
      g.fillStyle(m.rank === 'normal' ? 0xff5040 : 0xffd040).fillRect(p.x - r / 2, p.y - r / 2, r + 0.5, r + 0.5);
    }
    const v = this.view.world.worldView;
    const a = at(v.x, v.y);
    g.lineStyle(1, 0xffffff, 0.8).strokeRect(a.x, a.y, v.width / SCALE, v.height / SCALE);
  }

  private drawGround(sim: Sim, colourOf: (arc: number) => number): void {
    const g = this.ground.clear();
    g.fillStyle(0x000000, 0.55).fillRect(this.x - 2, this.y - 2, this.width + 4, this.height + 4);
    const { map } = sim;
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const path = isPathTile(map, tx, ty);
        if (!path && !isBlocked(map, tx, ty)) continue;
        g.fillStyle(path ? colourOf(map.arcTiles[ty * map.width + tx]!) : 0x384030, path ? 1 : 0.8);
        g.fillPoints(
          tileDiamond(tx, ty).map((p) => new Phaser.Math.Vector2(this.x + p.x / SCALE, this.y + p.y / SCALE)),
          true,
        );
      }
    }
  }
}

