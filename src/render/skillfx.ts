// Skill effects that the sim has no object for, drawn from the extraction's missile and
// overlay art: one-shot impacts and casts, shots that fly from one point to another and
// burst into their missiles.txt explosion, overlays riding on units (curses, Enchant,
// frozen), and drawn lightning and rings where D2 itself draws them by code (Lightning's
// CelFile is null). Everything here is render-only and may use Math.random.

import Phaser from 'phaser';

import { animKey, metaOf, missileKey, originOf, overlayKey } from './assets.ts';
import { spriteDirection } from './directions.ts';

export interface Point {
  x: number;
  y: number;
}

interface Flash {
  until: number;
  ms: number;
  draw: (g: Phaser.GameObjects.Graphics, life: number) => void;
}

/** A looping overlay that follows a unit. */
interface Riding {
  sprite: Phaser.GameObjects.Sprite;
  id: string;
}

export class SkillFx {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private flashes: Flash[] = [];
  private readonly riding = new Map<string, Riding>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {
    this.gfx = scene.add.graphics().setDepth(depth + 1).setBlendMode(Phaser.BlendModes.ADD);
  }

  private spriteOf(texture: string, x: number, y: number): Phaser.GameObjects.Sprite | undefined {
    if (!this.scene.textures.exists(texture)) return undefined;
    const meta = metaOf(this.scene, texture);
    const [ox, oy] = originOf(meta);
    const s = this.scene.add.sprite(Math.round(x), Math.round(y), texture).setOrigin(ox, oy).setDepth(this.depth);
    if ((meta.blend ?? 0) > 0) s.setBlendMode(Phaser.BlendModes.ADD);
    return s;
  }

  /** The missile's explosion from missiles.txt, if it has art. */
  explosionOf(missile: string): string | undefined {
    const texture = missileKey(missile);
    return this.scene.textures.exists(texture) ? metaOf(this.scene, texture).explosion || undefined : undefined;
  }

  /** One-shot missile art at a screen point, facing `angle` (0 to 63); `loops` repeats it. */
  play(missile: string, x: number, y: number, angle = 0, loops = 1): Phaser.GameObjects.Sprite | undefined {
    const texture = missileKey(missile);
    const s = this.spriteOf(texture, x, y);
    if (!s) return undefined;
    const meta = metaOf(this.scene, texture);
    const dir = String(spriteDirection(angle, meta.dccDirections ?? 1));
    s.play({ key: animKey(texture, 'MS', dir), repeat: loops - 1 });
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  }

  /** A shot from `from` to `to` over `ms`, bursting into its explosion where it lands. */
  shoot(missile: string, from: Point, to: Point, ms: number, angle = 0): void {
    const texture = missileKey(missile);
    const s = this.spriteOf(texture, from.x, from.y);
    if (!s) return;
    const meta = metaOf(this.scene, texture);
    s.play({ key: animKey(texture, 'MS', String(spriteDirection(angle, meta.dccDirections ?? 1))), repeat: -1 });
    this.scene.tweens.add({
      targets: s,
      x: to.x,
      y: to.y,
      duration: ms,
      onComplete: () => {
        s.destroy();
        const ex = meta.explosion;
        if (ex) this.play(ex, to.x, to.y, angle);
      },
    });
  }

  /** Something falling from above onto `to` over `ms` (Meteor), then `onLand`. */
  fall(missile: string, to: Point, ms: number, onLand: () => void): void {
    const texture = missileKey(missile);
    const s = this.spriteOf(texture, to.x - 160, to.y - 360);
    if (!s) return onLand();
    const meta = metaOf(this.scene, texture);
    s.play({ key: animKey(texture, 'MS', String(spriteDirection(0, meta.dccDirections ?? 1))), repeat: -1 });
    this.scene.tweens.add({ targets: s, x: to.x, y: to.y, duration: ms, ease: 'Quad.easeIn', onComplete: () => (s.destroy(), onLand()) });
  }

  /** Jagged lightning through `points`, fading over `ms`. */
  lightning(points: Point[], ms = 180, colour = 0xb8d8ff): void {
    if (points.length < 2) return;
    // Fixed jitter per bolt so it flickers by fading, not by jumping about
    const path: Point[] = [points[0]!];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 18));
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const j = k === steps ? 0 : 9;
        path.push({ x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j * 2, y: a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j });
      }
    }
    this.flash(ms, (g, life) => {
      g.lineStyle(5, colour, 0.25 * life).strokePoints(path, false);
      g.lineStyle(2, 0xffffff, 0.9 * life).strokePoints(path, false);
    });
  }

  /** An expanding ellipse at a screen point (Static Field's burst). */
  ring(at: Point, rx: number, ry: number, ms = 300, colour = 0x9cc8ff): void {
    this.flash(ms, (g, life) => {
      const grow = 1.15 - life * 0.75;
      g.lineStyle(3, colour, 0.8 * life).strokeEllipse(at.x, at.y, rx * 2 * grow, ry * 2 * grow);
    });
  }

  private flash(ms: number, draw: Flash['draw']): void {
    this.flashes.push({ until: this.scene.time.now + ms, ms, draw });
  }

  /**
   * Keeps one looping overlay on a unit while `id` is set, moved to its feet; an empty id
   * or a new one removes the old. `key` names the unit (`m12`, `t3`).
   */
  ride(key: string, id: string | undefined, at: Point, depth: number): void {
    const have = this.riding.get(key);
    if (have && have.id !== id) {
      have.sprite.destroy();
      this.riding.delete(key);
    }
    if (!id) return;
    let r = this.riding.get(key);
    if (!r) {
      const texture = overlayKey(id);
      const s = this.spriteOf(texture, at.x, at.y);
      if (!s) return;
      s.play({ key: animKey(texture, 'MS', '0'), repeat: -1 });
      r = { sprite: s, id };
      this.riding.set(key, r);
    }
    r.sprite.setPosition(Math.round(at.x), Math.round(at.y)).setDepth(depth);
  }

  /** Drops the overlays of units that are gone. */
  keepRiders(alive: Set<string>): void {
    for (const [key, r] of this.riding) {
      if (alive.has(key)) continue;
      r.sprite.destroy();
      this.riding.delete(key);
    }
  }

  update(): void {
    const now = this.scene.time.now;
    this.flashes = this.flashes.filter((f) => f.until > now);
    this.gfx.clear();
    for (const f of this.flashes) f.draw(this.gfx, (f.until - now) / f.ms);
  }

  clear(): void {
    for (const r of this.riding.values()) r.sprite.destroy();
    this.riding.clear();
    this.flashes = [];
    this.gfx.clear();
  }
}
