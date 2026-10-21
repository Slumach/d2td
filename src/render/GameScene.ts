// The game scene: the sim's state drawn with the pipeline's D2 sprites. It reads sim state
// and never writes to it: every player action becomes a Command stamped with the tick it
// runs on, the same stream a lockstep peer would get.

import Phaser from 'phaser';

import { DESIGN } from '../data/design.ts';
import { buildGameData, MAX_TOWER_LEVEL, type DesignData } from '../sim/data.ts';
import { TICKS_PER_SECOND, UNITS_PER_TILE } from '../sim/fixed.ts';
import { isPathTile } from '../sim/map.ts';
import {
  activeSkill,
  canBuild,
  createSim,
  evolutionFor,
  pendingChoices,
  sellValue,
  step,
  tierCost,
  towerAt,
  towerById,
  upgradeCost,
  type Command,
  type Corpse,
  type Monster,
  type Sim,
  type TimedCommand,
  type Tower,
} from '../sim/sim.ts';
import { TABLE_NAMES, type Tables } from '../sim/tables.ts';
import { TARGETING_MODES } from '../sim/state.ts';
import {
  ICON_INDEX,
  MISSILES_FOR,
  animKey,
  createAnimations,
  heroKey,
  iconKey,
  metaOf,
  missileKey,
  monsterKey,
  originOf,
  preloadAssets,
  type IconIndex,
} from './assets.ts';
import { angle64, spriteDirection } from './directions.ts';
import { facingFromVector, type Facing8 } from './facing.ts';
import { GAME_HEIGHT, GAME_WIDTH, HUD_HEIGHT, PANEL_TOP, TILE } from './layout.ts';
import { FONT, buttonRow, createTooltip, type ButtonSpec, type Tooltip } from './ui.ts';

const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Do not let a stalled tab replay minutes of ticks in one frame. */
const MAX_TICKS_PER_FRAME = 10;
const CLASS = 'paladin';
/** How far a tower looks for a monster to face, in units. */
const FACE_RANGE = 6 * UNITS_PER_TILE;

const LINE_COLOURS: Record<string, number> = { zealot: 0xc84a3a, holy: 0xe0b840, aura: 0x4a84d8 };
const EVOLVED_COLOUR = 0xa050d0;

const DEPTH = { ground: 1, rings: 2, corpses: 3, units: 10, overlay: 1500, effects: 2000 };
/** Dev: ?debug logs every sprite the scene creates. */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

function toPx(units: number): number {
  return (units * TILE) / UNITS_PER_TILE;
}

type Selection = { kind: 'tile'; x: number; y: number } | { kind: 'tower'; id: number } | undefined;

interface MonsterView {
  sprite: Phaser.GameObjects.Sprite;
  texture: string;
  def: string;
  x: number;
  y: number;
  facing: Facing8;
  mode: string;
}

interface TowerView {
  sprite: Phaser.GameObjects.Sprite;
  texture: string;
  facing: Facing8;
  cooldown: number;
}

interface MissileView {
  sprite: Phaser.GameObjects.Sprite;
  x: number;
  y: number;
  /** Set for strikes: the skill whose impact art plays when the missile ends. */
  skill: string;
}

export class GameScene extends Phaser.Scene {
  private sim!: Sim;
  private seed = 1;
  private log: TimedCommand[] = [];
  private pending: Command[] = [];
  private accumulator = 0;
  private lastTick = -1;
  private hover: { x: number; y: number } | undefined;
  private selection: Selection;
  private panelKey = '';

  private overlayGfx!: Phaser.GameObjects.Graphics;
  private ringGfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private endOverlay!: Phaser.GameObjects.Text;
  private tooltip!: Tooltip;
  private icons: IconIndex | undefined;
  private panel: Phaser.GameObjects.GameObject[] = [];

  private monsters = new Map<number, MonsterView>();
  private corpses = new Map<number, Phaser.GameObjects.Sprite>();
  private towers = new Map<number, TowerView>();
  private missiles = new Map<number, MissileView>();
  private summons = new Map<number, Phaser.GameObjects.Sprite>();

  constructor() {
    super('Game');
  }

  preload(): void {
    for (const name of TABLE_NAMES) this.load.json(name, `data/${name}.json`);
    preloadAssets(this);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.add.text(16, 16, `Missing ${file.src}. Run npm run extract first.`, { color: '#e0c080' }).setDepth(9000);
    });
  }

  create(): void {
    if (!TABLE_NAMES.every((name) => this.cache.json.exists(name))) return;
    const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, this.cache.json.get(name)])) as unknown as Tables;
    const design = (this.registry.get('design') as DesignData | undefined) ?? DESIGN;
    this.sim = createSim(buildGameData(tables, design), this.seed);
    this.icons = this.cache.json.get(ICON_INDEX) as IconIndex | undefined;
    createAnimations(this);

    this.add.graphics().setDepth(0).fillStyle(0x1a1a14).fillRect(0, 0, GAME_WIDTH, HUD_HEIGHT).fillRect(0, PANEL_TOP, GAME_WIDTH, GAME_HEIGHT - PANEL_TOP);
    this.drawGround();
    this.ringGfx = this.add.graphics().setDepth(DEPTH.rings);
    this.overlayGfx = this.add.graphics().setDepth(DEPTH.overlay);

    const text = { fontFamily: FONT, fontSize: '24px', color: '#e8e0c0' };
    this.hud = this.add.text(16, 18, '', text).setDepth(3000);
    this.info = this.add.text(16, PANEL_TOP + 10, '', { ...text, fontSize: '20px' }).setDepth(3000);
    this.tooltip = createTooltip(this, 16, PANEL_TOP - 8);
    buttonRow(this, GAME_WIDTH - 180, 12, [{ label: 'Call Wave', onClick: () => this.issue({ type: 'callWave' }), colour: '#6a3020' }], 200);
    this.endOverlay = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '', { ...text, fontSize: '48px', align: 'center', backgroundColor: '#000000c0', padding: { x: 40, y: 24 } })
      .setOrigin(0.5)
      .setDepth(6000)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.restart());

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => (this.hover = this.tileAt(p)));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) this.onMapClick(p);
    });
    this.events.emit('game-ready');
  }

  // ---- input and commands ----

  private tileAt(p: Phaser.Input.Pointer): { x: number; y: number } | undefined {
    if (p.y < HUD_HEIGHT || p.y >= PANEL_TOP) return undefined;
    const x = Math.floor(p.x / TILE);
    const y = Math.floor((p.y - HUD_HEIGHT) / TILE);
    return x >= 0 && x < this.sim.map.width && y >= 0 && y < this.sim.map.height ? { x, y } : undefined;
  }

  private onMapClick(p: Phaser.Input.Pointer): void {
    if (!this.sim || this.sim.state.status !== 'playing') return;
    const tile = this.tileAt(p);
    if (!tile) return;
    const tower = towerAt(this.sim, tile.x, tile.y);
    if (tower) this.selection = { kind: 'tower', id: tower.id };
    else if (canBuild(this.sim, tile.x, tile.y)) this.selection = { kind: 'tile', x: tile.x, y: tile.y };
    else this.selection = undefined;
    this.panelKey = '';
  }

  /** Player input only ever queues commands; the sim applies them on the next tick. */
  issue(...commands: Command[]): void {
    this.pending.push(...commands);
  }

  /** Read-only view of the sim for the launcher's smoke test. */
  get state(): Sim['state'] | undefined {
    return this.sim?.state;
  }

  private restart(): void {
    this.seed++;
    this.sim = createSim(this.sim.data, this.seed);
    this.log = [];
    this.pending = [];
    this.accumulator = 0;
    this.lastTick = -1;
    this.selection = undefined;
    this.panelKey = '';
    for (const map of [this.monsters, this.towers, this.missiles] as Map<number, { sprite: Phaser.GameObjects.Sprite }>[]) {
      for (const v of map.values()) v.sprite.destroy();
      map.clear();
    }
    for (const map of [this.corpses, this.summons]) {
      for (const s of map.values()) s.destroy();
      map.clear();
    }
    this.endOverlay.setVisible(false);
  }

  override update(_time: number, delta: number): void {
    if (!this.sim) return;
    // Dev: ?speed=N runs N times as many ticks per frame (previews and the smoke test)
    const speed = (this.registry.get('speed') as number | undefined) ?? 1;
    this.accumulator = Math.min(this.accumulator + delta * speed, TICK_MS * MAX_TICKS_PER_FRAME * speed);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      const commands = this.pending;
      this.pending = [];
      for (const command of commands) this.log.push({ tick: this.sim.state.tick, command });
      step(this.sim, commands);
      this.syncTick();
      this.events.emit('sim-tick', this.sim.state.tick);
    }
    if (this.selection?.kind === 'tower' && !towerById(this.sim, this.selection.id)) this.selection = undefined;
    if (DEBUG && this.game.loop.frame % 60 === 0) {
      for (const o of this.children.list) {
        if (!(o instanceof Phaser.GameObjects.Sprite)) continue;
        const b = o.getBounds();
        if (b.top < HUD_HEIGHT + 40) {
          console.log(`high ${o.texture.key} anim ${o.anims.currentAnim?.key} frame ${o.frame.name} bounds ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`);
        }
      }
    }
    this.drawOverlay();
    this.drawHud();
    this.drawPanel();
  }

  // ---- sprites, synced once per sim tick ----

  private sprite(texture: string, x: number, y: number): Phaser.GameObjects.Sprite {
    if (DEBUG) console.log(`sprite ${texture} at ${Math.round(x)},${Math.round(y)} tick ${this.sim.state.tick}`);
    // Classic sprites draw at 1x; only the whole canvas zooms (design doc, Decisions locked)
    const s = this.add.sprite(x, y, texture);
    const [ox, oy] = originOf(metaOf(this, texture));
    return s.setOrigin(ox, oy);
  }

  private playIfChanged(s: Phaser.GameObjects.Sprite, key: string, keepFrame: boolean): void {
    if (s.anims.currentAnim?.key === key) return;
    if (!this.anims.exists(key)) return;
    const frame = keepFrame && s.anims.currentAnim && s.anims.currentFrame ? s.anims.currentAnim.frames.indexOf(s.anims.currentFrame) : 0;
    s.play({ key, startFrame: Math.max(0, frame) });
  }

  /** A one-shot effect (hit, impact) that removes itself when its animation ends. */
  private effect(missile: string, x: number, y: number, angle = 0): void {
    const texture = missileKey(missile);
    if (!this.textures.exists(texture)) return;
    const meta = metaOf(this, texture);
    const dir = String(spriteDirection(angle, meta.dccDirections ?? 1));
    const s = this.sprite(texture, x, y).setDepth(DEPTH.effects);
    if ((meta.blend ?? 0) > 0) s.setBlendMode(Phaser.BlendModes.ADD);
    s.play({ key: animKey(texture, 'MS', dir), repeat: 0 });
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
  }

  private syncTick(): void {
    const s = this.sim.state;
    if (s.tick === this.lastTick) return;
    this.lastTick = s.tick;
    this.syncMonsters();
    this.syncTowers();
    this.syncMissiles();
    this.syncSummons();
  }

  private syncMonsters(): void {
    const s = this.sim.state;
    const oy = HUD_HEIGHT;
    const alive = new Set<number>();
    for (const m of s.monsters) {
      alive.add(m.id);
      const px = toPx(m.x);
      const py = oy + toPx(m.y);
      let view = this.monsters.get(m.id);
      if (!view) {
        const texture = monsterKey(m.def, m.rank);
        if (!this.textures.exists(texture)) continue;
        view = { sprite: this.sprite(texture, px, py), texture, def: m.def, x: m.x, y: m.y, facing: 's', mode: '' };
        this.monsters.set(m.id, view);
      }
      const moved = m.x !== view.x || m.y !== view.y;
      if (moved) view.facing = facingFromVector(m.x - view.x, m.y - view.y);
      // Standing still and not stunned or casting means it is fighting a blocker
      const mode = moved ? 'WL' : m.stunTicks > 0 || m.castTicks > 0 ? view.mode || 'WL' : 'A1';
      if (mode === 'A1' && view.mode === 'A1' && !view.sprite.anims.isPlaying) view.sprite.play(animKey(view.texture, 'A1', view.facing));
      this.playIfChanged(view.sprite, animKey(view.texture, mode, view.facing), mode === 'WL');
      if (m.stunTicks > 0) view.sprite.anims.pause();
      else if (view.sprite.anims.isPaused) view.sprite.anims.resume();
      view.mode = mode;
      view.x = m.x;
      view.y = m.y;
      view.sprite.setPosition(Math.round(px), Math.round(py)).setDepth(DEPTH.units + py / 1000);
      const slowed = (this.sim.fx.monsters[m.id]?.slowPct ?? 0) > 0 || m.slowPct > 0;
      if (slowed) view.sprite.setTint(0xa8d4ff);
      else view.sprite.clearTint();
    }

    // Gone this tick: a new corpse in its place means it died, otherwise it leaked
    const fresh = s.corpses.filter((c) => !this.corpses.has(c.id));
    for (const [id, view] of this.monsters) {
      if (alive.has(id)) continue;
      this.monsters.delete(id);
      const corpse = fresh.find((c) => c.def === view.def && Math.abs(c.x - view.x) <= 400 && Math.abs(c.y - view.y) <= 400);
      if (!corpse) {
        view.sprite.destroy();
        continue;
      }
      fresh.splice(fresh.indexOf(corpse), 1);
      view.sprite.clearTint().setDepth(DEPTH.corpses);
      view.sprite.play(animKey(view.texture, 'DT', view.facing));
      // Then the body on the ground (D2's DD mode), held until the corpse goes
      const dead = animKey(view.texture, 'DD', view.facing);
      view.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (view.sprite.active && this.anims.exists(dead)) view.sprite.play(dead);
      });
      this.corpses.set(corpse.id, view.sprite);
    }
    const corpseIds = new Set(s.corpses.map((c: Corpse) => c.id));
    for (const [id, sprite] of this.corpses) {
      if (!corpseIds.has(id)) {
        sprite.destroy();
        this.corpses.delete(id);
      }
    }
  }

  private nearestMonster(from: { x: number; y: number }, range: number): Monster | undefined {
    let best: Monster | undefined;
    let bestD = range * range;
    for (const m of this.sim.state.monsters) {
      const d = (m.x - from.x) ** 2 + (m.y - from.y) ** 2;
      if (d <= bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  private syncTowers(): void {
    const s = this.sim.state;
    const seen = new Set<number>();
    for (const t of s.towers) {
      seen.add(t.id);
      const px = toPx(t.x);
      const py = HUD_HEIGHT + toPx(t.y) + TILE / 4;
      const texture = heroKey(t.evolved !== '');
      let view = this.towers.get(t.id);
      if (view && view.texture !== texture) {
        view.sprite.destroy();
        view = undefined;
      }
      if (!view) {
        if (!this.textures.exists(texture)) continue;
        view = { sprite: this.sprite(texture, px, py), texture, facing: 's', cooldown: t.cooldown };
        this.towers.set(t.id, view);
      }
      const target = this.nearestMonster(t, FACE_RANGE);
      if (target) view.facing = facingFromVector(target.x - t.x, target.y - t.y);
      // The cooldown jumping back up means the tower acted this tick
      const acted = t.cooldown > view.cooldown;
      view.cooldown = t.cooldown;
      if (acted) {
        view.sprite.play(animKey(texture, 'A1', view.facing));
        view.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => view!.sprite.play(animKey(texture, 'NU', view!.facing)));
        this.meleeHit(t);
      } else if (!view.sprite.anims.isPlaying || view.sprite.anims.currentAnim?.key.includes('|NU|')) {
        this.playIfChanged(view.sprite, animKey(texture, 'NU', view.facing), true);
      }
      view.sprite.setPosition(px, py).setDepth(DEPTH.units + py / 1000).setAlpha(t.line ? 1 : 0.55);
    }
    for (const [id, view] of this.towers) {
      if (!seen.has(id)) {
        view.sprite.destroy();
        this.towers.delete(id);
      }
    }
  }

  /** Zeal and Vengeance hits have no missile in the sim; show their effects on the target. */
  private meleeHit(t: Tower): void {
    const active = activeSkill(this.sim, t);
    if (!active || active.skill.archetype !== 'melee') return;
    const target = this.nearestMonster(t, active.skill.rangeUnits);
    if (!target) return;
    const hit = active.skill.id === 'vengeance' ? 'vengeance-hit' : 'zeal-hit';
    const angle = angle64(target.x - t.x, target.y - t.y);
    for (const m of MISSILES_FOR[hit] ?? []) this.effect(m, toPx(target.x), HUD_HEIGHT + toPx(target.y) - 15, angle);
  }

  private syncMissiles(): void {
    const s = this.sim.state;
    const seen = new Set<number>();
    for (const m of s.missiles) {
      seen.add(m.id);
      const skill = this.sim.data.skills[m.skill];
      const art = MISSILES_FOR[m.skill]?.[0];
      if (!skill || !art) continue;
      const px = toPx(m.x);
      const py = HUD_HEIGHT + toPx(m.y);
      let view = this.missiles.get(m.id);
      if (!view) {
        const texture = missileKey(art);
        if (!this.textures.exists(texture)) continue;
        const sprite = this.sprite(texture, px, py).setDepth(DEPTH.effects);
        if ((metaOf(this, texture).blend ?? 0) > 0) sprite.setBlendMode(Phaser.BlendModes.ADD);
        const strike = skill.archetype === 'splash' && skill.delivery === 'strike';
        view = { sprite, x: m.x, y: m.y, skill: strike ? m.skill : '' };
        this.missiles.set(m.id, view);
      }
      const texture = view.sprite.texture.key;
      const meta = metaOf(this, texture);
      const dir = String(spriteDirection(angle64(m.x - view.x, m.y - view.y), meta.dccDirections ?? 1));
      this.playIfChanged(view.sprite, animKey(texture, 'MS', dir), true);
      view.sprite.setPosition(px, py);
      view.x = m.x;
      view.y = m.y;
    }
    for (const [id, view] of this.missiles) {
      if (seen.has(id)) continue;
      // A strike's impact plays the skill's other art there: FoH sprays its holy bolts
      if (view.skill) for (const art of MISSILES_FOR[view.skill]!.slice(1)) this.effect(art, view.sprite.x, view.sprite.y);
      view.sprite.destroy();
      this.missiles.delete(id);
    }
  }

  private syncSummons(): void {
    const s = this.sim.state;
    const seen = new Set<number>();
    for (const u of s.summons) {
      seen.add(u.id);
      const texture = monsterKey('skeleton1', 'normal');
      const px = toPx(u.x);
      const py = HUD_HEIGHT + toPx(u.y);
      let sprite = this.summons.get(u.id);
      if (!sprite) {
        if (!this.textures.exists(texture)) continue;
        sprite = this.sprite(texture, px, py).setTint(0xb0ffb0);
        this.summons.set(u.id, sprite);
      }
      // Summons face up the path, toward where monsters come from
      const fighting = this.nearestMonster(u, UNITS_PER_TILE) !== undefined;
      this.playIfChanged(sprite, animKey(texture, fighting ? 'A1' : 'WL', 'w'), false);
      if (!fighting) sprite.anims.pause();
      else if (!sprite.anims.isPlaying) sprite.play(animKey(texture, 'A1', 'w'));
      sprite.setPosition(px, py).setDepth(DEPTH.units + py / 1000);
    }
    for (const [id, sprite] of this.summons) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.summons.delete(id);
      }
    }
  }

  // ---- shapes that stay shapes: ground, rings, bars ----

  private drawGround(): void {
    const g = this.add.graphics().setDepth(DEPTH.ground);
    const { map } = this.sim;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        g.fillStyle(isPathTile(map, x, y) ? 0x6a5a3a : (x + y) % 2 ? 0x2c3a24 : 0x30402a);
        g.fillRect(x * TILE, HUD_HEIGHT + y * TILE, TILE, TILE);
      }
    }
  }

  private drawOverlay(): void {
    const { state, fx } = this.sim;
    const g = this.overlayGfx.clear();
    const rings = this.ringGfx.clear();
    const oy = HUD_HEIGHT;
    const selected = this.selection?.kind === 'tower' ? this.selection.id : undefined;

    // Base rings in the tower's line colour; evolved towers ring purple
    for (const t of state.towers) {
      const colour = t.evolved ? EVOLVED_COLOUR : (LINE_COLOURS[t.line] ?? 0x707070);
      const cx = toPx(t.x);
      const cy = oy + toPx(t.y) + TILE / 4;
      rings.fillStyle(colour, 0.35).fillEllipse(cx, cy, TILE * 0.9, TILE * 0.45);
      rings.lineStyle(t.id === selected ? 3 : 2, colour, t.id === selected ? 1 : 0.8).strokeEllipse(cx, cy, TILE * 0.9, TILE * 0.45);
    }

    // Aura rings: faint for every emitter, bright for the selected tower
    for (const e of fx.emitters) {
      const t = towerById(this.sim, e.towerId);
      if (!t) continue;
      g.lineStyle(e.towerId === selected ? 2 : 1, 0x80b0ff, e.towerId === selected ? 0.8 : 0.15);
      g.strokeCircle(toPx(t.x), oy + toPx(t.y), toPx(e.radiusUnits));
    }
    const sel = selected !== undefined ? towerById(this.sim, selected) : undefined;
    const active = sel && activeSkill(this.sim, sel);
    if (sel && active && active.skill.rangeUnits > 0) {
      g.lineStyle(1, 0xffffff, 0.5).strokeCircle(toPx(sel.x), oy + toPx(sel.y), toPx(active.skill.rangeUnits));
    }

    // Zones (no Paladin skill makes one) stay translucent circles
    for (const m of state.missiles) {
      if (this.sim.data.skills[m.skill]?.archetype !== 'zone') continue;
      g.fillStyle(0x80c0ff, 0.2).fillCircle(toPx(m.x), oy + toPx(m.y), (TILE * 5) / 8);
    }

    // HP bars over monsters
    for (const m of state.monsters) {
      const view = this.monsters.get(m.id);
      const w = m.rank === 'boss' ? 42 : 24;
      // A D2 frame box reaches about twice the body's height above the feet
      const top = view ? view.sprite.y - view.sprite.displayOriginY * 0.45 - 6 : oy + toPx(m.y) - TILE / 2;
      const x = toPx(m.x) - w / 2;
      g.fillStyle(0x200000).fillRect(x, top, w, 4);
      g.fillStyle(m.rank === 'normal' ? 0x40e040 : 0xe0c040).fillRect(x, top, (w * Math.max(0, m.hp)) / m.maxHp, 4);
    }

    if (this.hover && state.status === 'playing') {
      const { x, y } = this.hover;
      const ok = canBuild(this.sim, x, y) || towerAt(this.sim, x, y) !== undefined;
      g.lineStyle(2, ok ? 0xffffff : 0xff4040, 0.5).strokeRect(x * TILE + 1, oy + y * TILE + 1, TILE - 2, TILE - 2);
    }
  }

  private drawHud(): void {
    const { state, data } = this.sim;
    this.hud.setText(`Gold ${state.gold}   Lives ${state.lives}   Wave ${state.wave}/${data.waves.length}   Kills ${state.kills}`);
    if (state.status !== 'playing' && !this.endOverlay.visible) {
      this.endOverlay
        .setText(`${state.status === 'won' ? 'Victory' : 'Defeat'}\nwave ${state.wave}, ${state.kills} kills\nclick to play again`)
        .setVisible(true);
    }
  }

  private skillName(id: string): string {
    return this.sim.data.skills[id]?.name ?? id;
  }

  /** An icon button for a skill, with the game's own name and description on hover. */
  private skillButton(id: string, label: string, onClick: () => void, enabled = true): ButtonSpec {
    const name = this.skillName(id);
    const entry = this.icons?.skills[name];
    return {
      label,
      onClick,
      enabled,
      icon: entry ? iconKey(name) : undefined,
      tooltip: { title: entry?.name ?? name, body: entry?.desc ?? '' },
    };
  }

  /** Rebuilds the bottom panel when what it would show changes. */
  private drawPanel(): void {
    const sim = this.sim;
    const sel = this.selection;
    const tower = sel?.kind === 'tower' ? towerById(sim, sel.id) : undefined;
    const key = JSON.stringify([sel, tower && [tower.tier, tower.level, tower.picks, tower.targeting], sim.state.gold, sim.state.towers.length]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    for (const o of this.panel) o.destroy();
    this.panel = [];
    this.tooltip.hide();

    const x = 16;
    const y = PANEL_TOP + 48;
    const width = GAME_WIDTH - 32;
    const e = sim.data.economy;
    const specs: ButtonSpec[] = [];

    if (sel?.kind === 'tile') {
      this.info.setText(`Build a Paladin tower (${e.buildCost}g): its T1 skill fixes its line`);
      for (const line of Object.values(sim.data.classes[CLASS]!.lines)) {
        const skill = line.tiers[0]![0]!;
        specs.push(
          this.skillButton(skill, `${line.name}: ${this.skillName(skill)}`, () => {
            this.issue({ type: 'build', x: sel.x, y: sel.y, cls: CLASS, skill });
            this.selection = undefined;
          }, sim.state.gold >= e.buildCost),
        );
      }
    } else if (tower) {
      this.towerPanel(tower, specs);
    } else {
      this.info.setText('Click a free tile to build. Click a tower to upgrade, pick branches, evolve or change targeting.');
    }
    this.panel = buttonRow(this, x, y, specs, width, this.tooltip);
  }

  private towerPanel(tower: Tower, specs: ButtonSpec[]): void {
    const sim = this.sim;
    const e = sim.data.economy;
    const active = activeSkill(sim, tower);
    const recipe = tower.evolved ? sim.data.evolutions.find((r) => r.id === tower.evolved) : undefined;
    const line = sim.data.classes[tower.cls]?.lines[tower.line];
    const title = recipe
      ? `${recipe.name}: ${this.skillName(recipe.attack.skill)} with ${this.skillName(tower.partnerSkill)} aura`
      : `${line?.name ?? 'Inert'} T${tower.tier} L${tower.level}: ${active ? active.skill.name : 'pick a skill'}`;
    this.info.setText(`${title}   targeting ${tower.targeting}`);

    const pick = pendingChoices(sim, tower);
    const type = tower.line ? 'pickBranch' : 'pickSkill';
    for (const skill of pick) specs.push(this.skillButton(skill, `Pick ${this.skillName(skill)}`, () => this.issue({ type, towerId: tower.id, skill })));

    if (active) {
      const level = upgradeCost(sim, tower);
      if (level !== undefined) {
        specs.push({
          ...this.skillButton(active.skill.id, `Level ${tower.level + 1} (${level}g)`, () => this.issue({ type: 'upgrade', towerId: tower.id }), sim.state.gold >= level),
        });
      }
    }
    const tier = tierCost(sim, tower);
    if (tier !== undefined && line) {
      const options = line.tiers[tower.tier] ?? [];
      for (const skill of options) {
        const commands: Command[] = [{ type: 'upgradeTier', towerId: tower.id }];
        if (options.length > 1) commands.push({ type: 'pickBranch', towerId: tower.id, skill });
        specs.push(this.skillButton(skill, `T${tower.tier + 1}: ${this.skillName(skill)} (${tier}g)`, () => this.issue(...commands), sim.state.gold >= tier));
      }
    } else if (!tower.evolved && line && tower.level < MAX_TOWER_LEVEL && tower.tier < line.tiers.length) {
      specs.push({ label: `T${tower.tier + 1} unlocks at level ${MAX_TOWER_LEVEL}`, enabled: false, onClick: () => undefined });
    }
    for (const other of sim.state.towers) {
      const match = evolutionFor(sim, tower, other);
      if (!match) continue;
      specs.push({
        ...this.skillButton(match.recipe.attack.skill, `Evolve ${match.recipe.name} (${e.evolveCost}g)`, () => this.issue({ type: 'evolve', towerA: tower.id, towerB: other.id }), sim.state.gold >= e.evolveCost),
        colour: '#5a2a70',
      });
    }
    const next = TARGETING_MODES[(TARGETING_MODES.indexOf(tower.targeting) + 1) % TARGETING_MODES.length]!;
    specs.push({ label: `Target: ${tower.targeting}`, colour: '#284050', onClick: () => this.issue({ type: 'setTargeting', towerId: tower.id, mode: next }) });
    specs.push({
      label: `Sell (${sellValue(sim, tower)}g)`,
      colour: '#502020',
      onClick: () => {
        this.issue({ type: 'sell', towerId: tower.id });
        this.selection = undefined;
      },
    });
  }
}
