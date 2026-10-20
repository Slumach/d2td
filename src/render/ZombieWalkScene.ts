// M0 gate scene: the decoded zombie walk cycle walking a circle at 2x, with the
// Paladin's HD skill icons underneath, so one screenshot proves the whole pipeline.
// This is a render-only demo with no simulation behind it, so it moves on Phaser's
// frame delta. Real units will take their positions from src/sim.

import Phaser from 'phaser';

import { facingFromVector, type Facing8 } from './facing.ts';

const TEXTURE = 'zm_wl_hth';
const ICON_INDEX = 'icons_paladin';
const ICON_DIR = 'icons/paladin/';
const SCALE = 2;
const RADIUS = 160;
const CIRCLE_Y = 250;
/** Seconds per lap. Picked by eye for the demo; real movement will use monstats velocity. */
const LAP_SECONDS = 14;
const ICON_SIZE = 56;
const ICON_GAP = 4;
const ICONS_PER_ROW = 15;
const ICONS_TOP = 540;

interface AtlasMeta {
  mode: string;
  directions: Facing8[];
  framesPerDirection: number;
  fps: number;
  frameWidth: number;
  frameHeight: number;
  origin: { x: number; y: number };
}

interface IconIndex {
  skills: Record<string, { id: number; icon: string }>;
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
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
      this.add
        .text(16, 16, 'Missing files in assets-extracted. Run npm run extract first.', { color: '#e0c080' })
        .setDepth(10_000);
    });

    this.load.atlas(TEXTURE, 'monsters/zm/zm_wl_hth.png', 'monsters/zm/zm_wl_hth.json');

    // The icon list is data, so queue the images once the index arrives
    this.load.json(ICON_INDEX, `${ICON_DIR}index.json`);
    this.load.once(`filecomplete-json-${ICON_INDEX}`, (_key: string, _type: string, index: IconIndex) => {
      for (const [name, entry] of Object.entries(index.skills)) {
        this.load.image(`icon:${name}`, `${ICON_DIR}${entry.icon}`);
      }
    });
  }

  create(): void {
    this.createZombie();
    this.createIcons();
  }

  private createZombie(): void {
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

    const { width } = this.scale;
    this.add.circle(width / 2, CIRCLE_Y, RADIUS, 0x000000, 0).setStrokeStyle(1, 0x555544);

    this.zombie = this.add
      .sprite(width / 2 + RADIUS, CIRCLE_Y, TEXTURE)
      .setScale(SCALE)
      .setOrigin(origin.x / frameWidth, origin.y / frameHeight);

    this.add.text(16, 16, `zm walk, ${directions.length} directions x ${framesPerDirection} frames, ${fps.toFixed(1)} fps`, {
      color: '#c8c0a0',
      fontFamily: 'monospace',
    });
  }

  private createIcons(): void {
    const index = this.cache.json.get(ICON_INDEX) as IconIndex | undefined;
    if (!index) return;

    const names = Object.entries(index.skills)
      .sort(([, a], [, b]) => a.id - b.id)
      .map(([name]) => name)
      .filter((name) => this.textures.exists(`icon:${name}`));

    const rowWidth = ICONS_PER_ROW * (ICON_SIZE + ICON_GAP) - ICON_GAP;
    const left = (this.scale.width - rowWidth) / 2;
    const label = this.add
      .text(this.scale.width / 2, ICONS_TOP - 14, `Paladin HD skill icons (${names.length})`, {
        color: '#c8c0a0',
        fontFamily: 'monospace',
      })
      .setOrigin(0.5, 1);

    names.forEach((name, i) => {
      const key = `icon:${name}`;
      // HD art is meant to be smoothed; pixelArt mode defaults every texture to nearest
      this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
      const col = i % ICONS_PER_ROW;
      const row = Math.floor(i / ICONS_PER_ROW);
      this.add
        .image(left + col * (ICON_SIZE + ICON_GAP), ICONS_TOP + row * (ICON_SIZE + ICON_GAP), key)
        .setOrigin(0, 0)
        .setDisplaySize(ICON_SIZE, ICON_SIZE)
        .setInteractive()
        .on('pointerover', () => label.setText(name))
        .on('pointerout', () => label.setText(`Paladin HD skill icons (${names.length})`));
    });
  }

  override update(_time: number, delta: number): void {
    if (!this.zombie) return;

    const { width } = this.scale;
    this.angle = (this.angle + (delta / 1000) * ((2 * Math.PI) / LAP_SECONDS)) % (2 * Math.PI);

    const x = width / 2 + Math.cos(this.angle) * RADIUS;
    const y = CIRCLE_Y + Math.sin(this.angle) * RADIUS;
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
