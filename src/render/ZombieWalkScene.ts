// M0 gate scene: the decoded zombie walk cycle, walking a circle at 2x.
// This is a render-only demo with no simulation behind it, so it moves on Phaser's
// frame delta. Real units will take their positions from src/sim.

import Phaser from 'phaser';

import { facingFromVector, type Facing8 } from './facing.ts';

const TEXTURE = 'zm_wl_hth';
const SCALE = 2;
const RADIUS = 180;
/** Seconds per lap. Picked by eye for the demo; real movement will use monstats velocity. */
const LAP_SECONDS = 14;

interface AtlasMeta {
  mode: string;
  directions: Facing8[];
  framesPerDirection: number;
  fps: number;
  frameWidth: number;
  frameHeight: number;
  origin: { x: number; y: number };
}

export class ZombieWalkScene extends Phaser.Scene {
  private zombie!: Phaser.GameObjects.Sprite;
  private meta!: AtlasMeta;
  private angle = 0;
  private facing: Facing8 | undefined;

  constructor() {
    super('ZombieWalk');
  }

  preload(): void {
    this.load.atlas(TEXTURE, 'monsters/zm/zm_wl_hth.png', 'monsters/zm/zm_wl_hth.json');
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
      this.add
        .text(16, 16, 'Missing assets-extracted/monsters/zm. Run npm run extract first.', { color: '#e0c080' })
        .setDepth(10);
    });
  }

  create(): void {
    if (!this.textures.exists(TEXTURE)) return;

    // Phaser's JSON Hash parser copies the atlas "meta" block onto texture.customData
    this.meta = (this.textures.get(TEXTURE).customData as { meta: AtlasMeta }).meta;
    const { mode, directions, framesPerDirection, fps, frameWidth, frameHeight, origin } = this.meta;

    for (const dir of directions) {
      this.anims.create({
        key: `${mode}_${dir}`,
        frames: Array.from({ length: framesPerDirection }, (_, f) => ({
          key: TEXTURE,
          frame: `${mode}_${dir}_${String(f).padStart(2, '0')}`,
        })),
        frameRate: fps,
        repeat: -1,
      });
    }

    const { width, height } = this.scale;
    this.add.circle(width / 2, height / 2, RADIUS, 0x000000, 0).setStrokeStyle(1, 0x555544);

    this.zombie = this.add
      .sprite(width / 2 + RADIUS, height / 2, TEXTURE)
      .setScale(SCALE)
      .setOrigin(origin.x / frameWidth, origin.y / frameHeight);

    this.add.text(16, 16, `zm walk, ${directions.length} directions x ${framesPerDirection} frames, ${fps.toFixed(1)} fps`, {
      color: '#c8c0a0',
      fontFamily: 'monospace',
    });
  }

  override update(_time: number, delta: number): void {
    if (!this.zombie) return;

    const { width, height } = this.scale;
    this.angle = (this.angle + (delta / 1000) * ((2 * Math.PI) / LAP_SECONDS)) % (2 * Math.PI);

    const x = width / 2 + Math.cos(this.angle) * RADIUS;
    const y = height / 2 + Math.sin(this.angle) * RADIUS;
    this.zombie.setPosition(Math.round(x), Math.round(y));
    // Feet lower on screen draw in front
    this.zombie.setDepth(y);

    // Clockwise on screen, so the walk direction is the tangent (-sin, cos)
    const facing = facingFromVector(-Math.sin(this.angle), Math.cos(this.angle));
    if (facing !== this.facing) {
      // Keep the stride phase when turning so the legs do not snap back to frame 0
      const anims = this.zombie.anims;
      const current = anims.currentAnim && anims.currentFrame ? anims.currentAnim.frames.indexOf(anims.currentFrame) : 0;
      anims.play({ key: `${this.meta.mode}_${facing}`, startFrame: Math.max(0, current) });
      this.facing = facing;
    }
  }
}
