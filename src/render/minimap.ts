// The automap in the top-right corner, in D2's style: a translucent dark sheet, the ring's
// path as blue-grey lines (each arc's in the colour of the player whose arc it is),
// scenery as faint marks, a dot per monster (so a crowded arc shows), and the world
// camera's view as a box. Tab or the panel's automap button toggles it; clicking it moves
// the camera. It draws the ring in the same isometric view at 1/8 scale.

import Phaser from 'phaser';

import { isBlocked, isPathTile } from '../sim/map.ts';
import type { Sim } from '../sim/state.ts';
import { WORLD_HEIGHT, WORLD_WIDTH, project, tileDiamond } from './iso.ts';
import type { WorldView } from './view.ts';

const SCALE = 8;
/** Redraw the moving parts this often, in frames. */
const EVERY = 6;
/** D2's automap blue for walls and the sheet behind it. */
const WALL = 0x5c74b8;
const SHEET_ALPHA = 0.55;

export class Minimap {
  readonly width = WORLD_WIDTH / SCALE;
  readonly height = WORLD_HEIGHT / SCALE;
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly live: Phaser.GameObjects.Graphics;
  private readonly zone: Phaser.GameObjects.Zone;
  private frame = 0;
  private drawnFor: Sim | undefined;
  private shown = true;

  constructor(
    scene: Phaser.Scene,
    private readonly view: WorldView,
    private readonly x: number,
    private readonly y: number,
    depth: number,
  ) {
    this.ground = scene.add.graphics().setDepth(depth);
    this.live = scene.add.graphics().setDepth(depth + 1);
    this.zone = scene.add
      .zone(x, y, this.width, this.height)
      .setOrigin(0)
      .setDepth(depth + 2)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', (p: Phaser.Input.Pointer) => view.centreOn((p.x - x) * SCALE, (p.y - y) * SCALE));
  }

  get visible(): boolean {
    return this.shown;
  }

  toggle(): void {
    this.shown = !this.shown;
    this.ground.setVisible(this.shown);
    this.live.setVisible(this.shown);
    if (this.shown) this.zone.setInteractive({ useHandCursor: true });
    else this.zone.disableInteractive();
  }

  /** True where the map covers the screen while shown. */
  covers(px: number, py: number): boolean {
    return this.shown && px >= this.x && px <= this.x + this.width && py >= this.y && py <= this.y + this.height;
  }

  /** Draws `sim`'s ring; `colourOf(arc)` is the arc owner's colour. */
  draw(sim: Sim, colourOf: (arc: number) => number): void {
    if (this.drawnFor !== sim) {
      this.drawnFor = sim;
      this.drawGround(sim, colourOf);
    }
    if (!this.shown || this.frame++ % EVERY !== 0) return;
    const g = this.live.clear();
    const at = (wx: number, wy: number) => ({ x: this.x + wx / SCALE, y: this.y + wy / SCALE });
    for (const m of sim.state.monsters) {
      const w = project(m.x, m.y);
      const p = at(w.x, w.y);
      const r = m.rank === 'normal' ? 1.5 : 2.5;
      g.fillStyle(m.rank === 'normal' ? 0xe84838 : 0xffd040).fillCircle(p.x, p.y, r);
    }
    const v = this.view.world.worldView;
    const a = at(v.x, v.y);
    g.lineStyle(1, 0xffffff, 0.8).strokeRect(a.x, a.y, v.width / SCALE, v.height / SCALE);
  }

  private drawGround(sim: Sim, colourOf: (arc: number) => number): void {
    const g = this.ground.clear();
    g.fillStyle(0x000000, SHEET_ALPHA).fillRect(this.x - 2, this.y - 2, this.width + 4, this.height + 4);
    const { map } = sim;
    const corner = (tx: number, ty: number) => tileDiamond(tx, ty).map((p) => new Phaser.Math.Vector2(this.x + p.x / SCALE, this.y + p.y / SCALE));
    // The map's edge, as D2 draws a level's walls
    const edge = [corner(0, 0)[0]!, corner(map.width - 1, 0)[1]!, corner(map.width - 1, map.height - 1)[2]!, corner(0, map.height - 1)[3]!];
    g.lineStyle(1, WALL, 0.9).strokePoints(edge, true);
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        if (isPathTile(map, tx, ty)) {
          // A path tile is drawn as its outline, so the road reads as two lines in the owner's colour
          g.lineStyle(1, colourOf(map.arcTiles[ty * map.width + tx]!), 0.95).strokePoints(corner(tx, ty), true);
        } else if (isBlocked(map, tx, ty)) {
          const c = corner(tx, ty);
          g.fillStyle(WALL, 0.45).fillCircle((c[0]!.x + c[2]!.x) / 2, (c[0]!.y + c[2]!.y) / 2, 1);
        }
      }
    }
  }
}
