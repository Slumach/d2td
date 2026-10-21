// The game scene: the sim's state drawn with the pipeline's D2 sprites. It reads sim state
// and never writes to it: every player action becomes a Command stamped with the tick it
// runs on, the same stream a lockstep peer would get.

import Phaser from 'phaser';

import { DESIGN } from '../data/design.ts';
import type { MpEvent, LauncherApi } from '../launcher/api.ts';
import { menuMusic, preloadFrontend } from '../launcher/frontend.ts';
import { MpSession } from '../launcher/session.ts';
import { Lockstep } from '../net/lockstep.ts';
import type { LobbyPlayer } from '../net/protocol.ts';
import { baseMonsterId, buildGameData, DIFFICULTY_NAMES, MAX_TOWER_LEVEL, type DesignData, type GameData, type WaveDef } from '../sim/data.ts';
import { standardDps } from '../sim/dps.ts';
import { TICKS_PER_SECOND, UNITS_PER_TILE } from '../sim/fixed.ts';
import { livesOf, playersIn, type MatchMode } from '../sim/match.ts';
import { isPathTile } from '../sim/map.ts';
import {
  activeSkill,
  canBuild,
  evolutionFor,
  pendingChoices,
  sellValue,
  tierCost,
  towerAt,
  towerById,
  upgradeCost,
  type Command,
  type Corpse,
  type Monster,
  type Sim,
  type Tower,
} from '../sim/sim.ts';
import { TABLE_NAMES, type Tables } from '../sim/tables.ts';
import { TARGETING_MODES } from '../sim/state.ts';
import {
  GROUND_KEY,
  ICON_INDEX,
  MAP_KEY,
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
  sceneryKey,
  type IconIndex,
  type MapManifest,
} from './assets.ts';
import { D2Hud, hudManifest, preloadHud, type PanelButton, type SlotItem, type TowerPanelModel } from './d2hud.ts';
import { angle64, spriteDirection } from './directions.ts';
import { LocalDriver, NetDriver, type Driver } from './driver.ts';
import { facingFromVector, type Facing8 } from './facing.ts';
import { ISO_H, ISO_W, ORIGIN, ellipseOf, project, screenVector, tileAtScreen, tileDiamond } from './iso.ts';
import { GAME_HEIGHT, GAME_WIDTH, HUD_HEIGHT, PANEL_TOP } from './layout.ts';
import { SoundBank, preloadSounds } from './sound.ts';
import { FONT, buttonRow, createTooltip, type ButtonSpec, type Tooltip } from './ui.ts';

const CLASS = 'paladin';
/** How far a tower looks for a monster to face, in units. */
const FACE_RANGE = 6 * UNITS_PER_TILE;

const LINE_COLOURS: Record<string, number> = { zealot: 0xc84a3a, holy: 0xe0b840, aura: 0x4a84d8 };
const EVOLVED_COLOUR = 0xa050d0;

const DEPTH = { ground: 1, rings: 2, corpses: 3, units: 10, overlay: 1500, effects: 2000, chrome: 2900 };
/** Dev: ?debug logs every sprite the scene creates. */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

/** Zones have no art yet; they draw as a translucent ellipse of this radius in units. */
const ZONE_RADIUS = (UNITS_PER_TILE * 5) / 8;

type Selection = { kind: 'tile'; x: number; y: number } | { kind: 'tower'; id: number } | undefined;

/** What the lobby hands the game when the host starts an online match. */
export interface OnlineStart {
  seed: number;
  mode: MatchMode;
  difficulty: number;
  players: LobbyPlayer[];
  you: number;
}

/** A single-player run: the difficulty it starts at. */
export interface SoloStart {
  difficulty: number;
}

/** The registry key for the last chosen single-player difficulty, so Restart keeps it. */
export const DIFFICULTY_KEY = 'difficulty';

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
  /** The missile art, which also names its sounds. */
  art: string;
}

export class GameScene extends Phaser.Scene {
  private driver: Driver | undefined;
  private gameData!: GameData;
  private seed = 1;
  /** The zone on screen: your own, or another player's while watching. */
  private view = 0;
  /** Why an online game stopped early (desync, host gone); empty while it runs. */
  private halted = '';
  private lastTick = -1;
  private hover: { x: number; y: number } | undefined;
  private selection: Selection;
  private panelKey = '';

  private overlayGfx!: Phaser.GameObjects.Graphics;
  private ringGfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  /** Online only: the wave clock and the other players. */
  private hud2!: Phaser.GameObjects.Text;
  private notice!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private endOverlay!: Phaser.GameObjects.Text;
  private tooltip!: Tooltip;
  private icons: IconIndex | undefined;
  private panel: Phaser.GameObjects.GameObject[] = [];
  private sounds!: SoundBank;
  /** D2's control panel when its art is extracted; otherwise the plain HUD and panel. */
  private d2: D2Hud | undefined;

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
    preloadSounds(this);
    preloadHud(this);
    preloadFrontend(this);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.add.text(16, 16, `Missing ${file.src}. Run npm run extract first.`, { color: '#e0c080' }).setDepth(9000);
    });
  }

  /** The zone on screen. */
  private get sim(): Sim {
    return this.driver!.match.zones[this.view]!;
  }

  create(start?: OnlineStart | SoloStart): void {
    this.driver = undefined;
    this.halted = '';
    this.clearViews();
    if (!TABLE_NAMES.every((name) => this.cache.json.exists(name))) return;
    const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, this.cache.json.get(name)])) as unknown as Tables;
    const design = (this.registry.get('design') as DesignData | undefined) ?? DESIGN;
    if (start) this.registry.set(DIFFICULTY_KEY, start.difficulty);
    const difficulty = start?.difficulty ?? (this.registry.get(DIFFICULTY_KEY) as number | undefined) ?? 0;
    // After the last wave the map loops at the next difficulty, up to Hell
    this.gameData = buildGameData(tables, design, undefined, { difficulty, loop: true });
    if (start && 'players' in start) {
      const session = MpSession.of(this.registry.get('launcher') as LauncherApi);
      const lockstep = new Lockstep({ data: this.gameData, seed: start.seed, mode: start.mode, players: start.players.length, me: start.you, send: (m) => session.send(m) });
      this.driver = new NetDriver(lockstep, start.players);
      this.view = start.you;
      session.listen((e) => this.onNet(e, lockstep));
    } else {
      this.driver = new LocalDriver(this.gameData, this.seed);
      this.view = 0;
    }
    this.icons = this.cache.json.get(ICON_INDEX) as IconIndex | undefined;
    createAnimations(this);
    menuMusic(this, false);
    this.sounds = new SoundBank(this);
    this.sounds.startLoops();

    const hudArt = hudManifest(this);
    this.d2 = hudArt ? new D2Hud(this, hudArt, () => this.issue({ type: 'callWave' })) : undefined;
    // The plain HUD and panel backgrounds sit over the map, so tall scenery never paints across them
    if (!this.d2) this.add.graphics().setDepth(DEPTH.chrome).fillStyle(0x1a1a14).fillRect(0, 0, GAME_WIDTH, HUD_HEIGHT).fillRect(0, PANEL_TOP, GAME_WIDTH, GAME_HEIGHT - PANEL_TOP);
    this.drawGround();
    this.ringGfx = this.add.graphics().setDepth(DEPTH.rings);
    this.overlayGfx = this.add.graphics().setDepth(DEPTH.overlay);

    const text = { fontFamily: FONT, fontSize: '24px', color: '#e8e0c0' };
    const online = this.driver.online;
    this.hud = this.add.text(16, online ? 8 : 18, '', text).setDepth(3000);
    this.hud2 = this.add.text(16, 38, '', { ...text, fontSize: '17px', color: '#b8b090' }).setDepth(3000).setVisible(online);
    this.notice = this.add.text(GAME_WIDTH / 2, HUD_HEIGHT + 16, '', { ...text, fontSize: '20px', backgroundColor: '#000000a0', padding: { x: 12, y: 6 } }).setOrigin(0.5, 0).setDepth(5500).setVisible(false);
    this.info = this.add.text(16, PANEL_TOP + 8, '', { ...text, fontSize: '20px' }).setDepth(3000);
    this.tooltip = createTooltip(this, 16, PANEL_TOP - 8);
    if (this.d2) {
      // D2 shows no status line: lives, gold and the wave live in the panel; hints sit just above it
      this.hud.setVisible(false);
      this.hud2.setPosition(16, 12).setShadow(1, 1, '#000000', 2);
      this.info.setPosition(GAME_WIDTH / 2, 816).setOrigin(0.5).setFontSize(15).setColor('#c8bc98').setShadow(1, 1, '#000000', 2);
    } else {
      buttonRow(this, GAME_WIDTH - 180, 12, [{ label: 'Call Wave', onClick: () => this.issue({ type: 'callWave' }), colour: '#6a3020' }], 200);
    }
    this.endOverlay = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '', { ...text, fontSize: '48px', align: 'center', backgroundColor: '#000000c0', padding: { x: 40, y: 24 } })
      .setOrigin(0.5)
      .setDepth(6000)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => (this.driver?.online ? this.leaveOnline() : this.restartRun()));

    this.input.mouse?.disableContextMenu();
    this.input.keyboard?.on('keydown-ESC', () => {
      if (!this.scene.isActive() || this.scene.isActive('Pause')) return;
      // An online game cannot stop for one player: the menu opens over it while it runs
      if (!online) this.scene.pause();
      this.scene.launch('Pause', { online });
    });
    if (online) {
      this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= this.driver!.match.zones.length && n - 1 !== this.view) this.watch(n - 1);
      });
    }
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => (this.hover = this.tileAt(p)));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) this.onMapClick(p);
    });
    this.events.emit('game-ready');
  }

  // ---- input and commands ----

  private tileAt(p: Phaser.Input.Pointer): { x: number; y: number } | undefined {
    if (this.d2 ? this.d2.covers(p.x, p.y) : p.y < HUD_HEIGHT || p.y >= PANEL_TOP) return undefined;
    return tileAtScreen(p.x, p.y);
  }

  private onMapClick(p: Phaser.Input.Pointer): void {
    if (!this.driver || this.sim.state.status !== 'playing' || this.view !== this.driver.me || this.halted) return;
    const tile = this.tileAt(p);
    if (!tile) return;
    const tower = towerAt(this.sim, tile.x, tile.y);
    if (tower) this.selection = { kind: 'tower', id: tower.id };
    else if (canBuild(this.sim, tile.x, tile.y)) this.selection = { kind: 'tile', x: tile.x, y: tile.y };
    else this.selection = undefined;
    this.panelKey = '';
  }

  /** Player input only ever becomes commands; the match applies them on a later tick. */
  issue(...commands: Command[]): void {
    for (const command of commands) this.driver?.issue(command);
  }

  /** Read-only view of the zone on screen, for autoplay and the launcher's smoke test. */
  get state(): Sim['state'] | undefined {
    return this.driver ? this.sim.state : undefined;
  }

  /** Pause menu: throw the run away and go back to the launcher's main menu. */
  quitToMenu(): void {
    if (this.driver?.online) return this.leaveOnline();
    this.restartRun();
    this.scene.start('Menu');
  }

  /** A fresh single-player run on the next seed: the end-of-run click and the pause menu's Restart. */
  restartRun(): void {
    this.seed++;
    this.driver = new LocalDriver(this.gameData, this.seed);
    this.clearViews();
    this.endOverlay.setVisible(false);
  }

  /** Drops every sprite so the next tick rebuilds the zone on screen from scratch. */
  private clearViews(): void {
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
  }

  // ---- online ----

  private onNet(e: MpEvent, lockstep: Lockstep): void {
    if (e.kind === 'closed') {
      if (lockstep.match.state.status !== 'over') this.halt(e.reason);
      return;
    }
    if (e.kind !== 'message') return;
    const m = e.message;
    if (m.t === 'tick') lockstep.receive(m.tick, m.cmds);
    else if (m.t === 'left') this.toast(`${m.name} left the game.`);
    else if (m.t === 'desync') this.halt(`The players' games fell out of step at tick ${m.tick}.\nThis game cannot go on; the log has the details.`);
  }

  /** Stops an online game for good and says why. */
  private halt(reason: string): void {
    if (this.halted) return;
    this.halted = reason;
    this.endOverlay.setText(`${reason}\n\nclick to return to the menu`).setFontSize(28).setVisible(true);
  }

  private toast(text: string): void {
    this.notice.setText(text).setVisible(true);
    this.time.delayedCall(4000, () => this.notice.setVisible(false));
  }

  private leaveOnline(): void {
    void MpSession.of(this.registry.get('launcher') as LauncherApi).leave();
    this.clearViews();
    this.driver = undefined;
    this.scene.stop('Pause');
    this.scene.start('Menu');
  }

  /** Online: show another player's zone. Building waits until you are back on your own. */
  private watch(zone: number): void {
    this.view = zone;
    this.clearViews();
  }

  private nameOf(slot: number): string {
    return this.driver?.players.find((p) => p.slot === slot)?.name ?? `Player ${slot + 1}`;
  }

  override update(_time: number, delta: number): void {
    if (!this.driver) return;
    // Dev: ?speed=N runs N times as many ticks per frame (previews and the smoke test)
    const speed = (this.registry.get('speed') as number | undefined) ?? 1;
    if (!this.halted) {
      this.driver.advance(delta, speed, () => {
        this.syncTick();
        this.events.emit('sim-tick', this.sim.state.tick);
      });
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
    const alive = new Set<number>();
    for (const m of s.monsters) {
      alive.add(m.id);
      const { x: px, y: py } = project(m.x, m.y);
      let view = this.monsters.get(m.id);
      if (!view) {
        const texture = monsterKey(baseMonsterId(m.def), m.rank);
        if (!this.textures.exists(texture)) continue;
        view = { sprite: this.sprite(texture, px, py), texture, def: m.def, x: m.x, y: m.y, facing: 's', mode: '' };
        this.monsters.set(m.id, view);
      }
      const moved = m.x !== view.x || m.y !== view.y;
      if (moved) {
        const v = screenVector(m.x - view.x, m.y - view.y);
        view.facing = facingFromVector(v.x, v.y);
      }
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
      this.sounds.death(baseMonsterId(view.def));
      this.sounds.gold();
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
      const { x: px, y: py } = project(t.x, t.y);
      const texture = heroKey(t);
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
      if (target) {
        const v = screenVector(target.x - t.x, target.y - t.y);
        view.facing = facingFromVector(v.x, v.y);
      }
      // The cooldown jumping back up means the tower acted this tick
      const acted = t.cooldown > view.cooldown;
      view.cooldown = t.cooldown;
      if (acted) {
        const active = activeSkill(this.sim, t);
        if (active) this.sounds.cast(active.skill.id);
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
    const v = screenVector(target.x - t.x, target.y - t.y);
    const angle = angle64(v.x, v.y);
    const at = project(target.x, target.y);
    for (const m of MISSILES_FOR[hit] ?? []) this.effect(m, at.x, at.y - 15, angle);
  }

  private syncMissiles(): void {
    const s = this.sim.state;
    const seen = new Set<number>();
    for (const m of s.missiles) {
      seen.add(m.id);
      const skill = this.sim.data.skills[m.skill];
      const art = MISSILES_FOR[m.skill]?.[0];
      if (!skill || !art) continue;
      const { x: px, y: py } = project(m.x, m.y);
      let view = this.missiles.get(m.id);
      if (!view) {
        const texture = missileKey(art);
        if (!this.textures.exists(texture)) continue;
        const sprite = this.sprite(texture, px, py).setDepth(DEPTH.effects);
        if ((metaOf(this, texture).blend ?? 0) > 0) sprite.setBlendMode(Phaser.BlendModes.ADD);
        const strike = skill.archetype === 'splash' && skill.delivery === 'strike';
        view = { sprite, x: m.x, y: m.y, skill: strike ? m.skill : '', art };
        this.sounds.travel(art);
        this.missiles.set(m.id, view);
      }
      const texture = view.sprite.texture.key;
      const meta = metaOf(this, texture);
      const v = screenVector(m.x - view.x, m.y - view.y);
      const dir = String(spriteDirection(angle64(v.x, v.y), meta.dccDirections ?? 1));
      this.playIfChanged(view.sprite, animKey(texture, 'MS', dir), true);
      view.sprite.setPosition(px, py);
      view.x = m.x;
      view.y = m.y;
    }
    for (const [id, view] of this.missiles) {
      if (seen.has(id)) continue;
      this.sounds.hit(view.art);
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
      const { x: px, y: py } = project(u.x, u.y);
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
    const manifest = this.cache.json.get(MAP_KEY) as MapManifest | undefined;
    if (manifest && this.textures.exists(GROUND_KEY)) {
      // The baked Blood Moor; a layout change since the bake only shifts it
      const dx = ORIGIN.x - manifest.ground.originX;
      const dy = ORIGIN.y - HUD_HEIGHT - manifest.ground.originY;
      this.add.image(dx, HUD_HEIGHT + dy, GROUND_KEY).setOrigin(0).setDepth(DEPTH.ground);
      for (const obj of manifest.objects) {
        const prefab = manifest.prefabs[obj.prefab];
        if (!prefab || !this.textures.exists(sceneryKey(obj.prefab))) continue;
        const p = project(obj.at[0]! * UNITS_PER_TILE, obj.at[1]! * UNITS_PER_TILE);
        const img = this.add.image(Math.round(p.x), Math.round(p.y), sceneryKey(obj.prefab));
        img.setOrigin(prefab.anchorX / img.width, prefab.anchorY / img.height).setDepth(DEPTH.units + p.y / 1000);
      }
      return;
    }
    const g = this.add.graphics().setDepth(DEPTH.ground);
    const { map } = this.sim;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        g.fillStyle(isPathTile(map, x, y) ? 0x6a5a3a : (x + y) % 2 ? 0x2c3a24 : 0x30402a);
        g.fillPoints(tileDiamond(x, y), true);
      }
    }
  }

  private drawOverlay(): void {
    const { state, fx } = this.sim;
    const g = this.overlayGfx.clear();
    const rings = this.ringGfx.clear();
    const selected = this.selection?.kind === 'tower' ? this.selection.id : undefined;

    // Base rings in the tower's line colour; evolved towers ring purple
    for (const t of state.towers) {
      const colour = t.evolved ? EVOLVED_COLOUR : (LINE_COLOURS[t.line] ?? 0x707070);
      const { x: cx, y: cy } = project(t.x, t.y);
      rings.fillStyle(colour, 0.35).fillEllipse(cx, cy, ISO_W * 0.7, ISO_H * 0.7);
      rings.lineStyle(t.id === selected ? 3 : 2, colour, t.id === selected ? 1 : 0.8).strokeEllipse(cx, cy, ISO_W * 0.7, ISO_H * 0.7);
    }

    // Aura rings: faint for every emitter, bright for the selected tower
    for (const e of fx.emitters) {
      const t = towerById(this.sim, e.towerId);
      if (!t) continue;
      g.lineStyle(e.towerId === selected ? 2 : 1, 0x80b0ff, e.towerId === selected ? 0.8 : 0.15);
      const c = project(t.x, t.y);
      const r = ellipseOf(e.radiusUnits);
      g.strokeEllipse(c.x, c.y, r.w, r.h);
    }
    const sel = selected !== undefined ? towerById(this.sim, selected) : undefined;
    const active = sel && activeSkill(this.sim, sel);
    if (sel && active && active.skill.rangeUnits > 0) {
      const c = project(sel.x, sel.y);
      const r = ellipseOf(active.skill.rangeUnits);
      g.lineStyle(1, 0xffffff, 0.5).strokeEllipse(c.x, c.y, r.w, r.h);
    }

    // Zones (no Paladin skill makes one) stay translucent circles
    for (const m of state.missiles) {
      if (this.sim.data.skills[m.skill]?.archetype !== 'zone') continue;
      const c = project(m.x, m.y);
      const r = ellipseOf(ZONE_RADIUS);
      g.fillStyle(0x80c0ff, 0.2).fillEllipse(c.x, c.y, r.w, r.h);
    }

    // HP bars over monsters
    for (const m of state.monsters) {
      const view = this.monsters.get(m.id);
      const w = m.rank === 'boss' ? 42 : 24;
      // A D2 frame box reaches about twice the body's height above the feet
      const at = project(m.x, m.y);
      const top = view ? view.sprite.y - view.sprite.displayOriginY * 0.45 - 6 : at.y - 40;
      const x = at.x - w / 2;
      g.fillStyle(0x200000).fillRect(x, top, w, 4);
      g.fillStyle(m.rank === 'normal' ? 0x40e040 : 0xe0c040).fillRect(x, top, (w * Math.max(0, m.hp)) / m.maxHp, 4);
    }

    if (this.hover && state.status === 'playing') {
      const { x, y } = this.hover;
      const ok = canBuild(this.sim, x, y) || towerAt(this.sim, x, y) !== undefined;
      g.lineStyle(2, ok ? 0xffffff : 0xff4040, 0.6).strokePoints(tileDiamond(x, y), true);
    }
  }

  private drawHud(): void {
    const { state, data } = this.sim;
    if (this.driver?.online) return this.drawOnlineHud();
    this.hud.setText(`Gold ${state.gold}   Lives ${state.lives}   Wave ${state.wave}/${data.waves.length}   Kills ${state.kills}`);
    this.d2?.update({ gold: state.gold, lives: state.lives, maxLives: data.economy.lives, wave: this.waveLabel(state.wave), nextWave: this.nextWaveTip(state.wave) });
    if (state.status !== 'playing' && !this.endOverlay.visible) {
      this.endOverlay
        .setText(`${state.status === 'won' ? 'Victory' : 'Defeat'}\nwave ${state.wave}, ${state.kills} kills\nclick to play again`)
        .setVisible(true);
    }
  }

  private drawOnlineHud(): void {
    const driver = this.driver!;
    const match = driver.match;
    const m = match.state;
    const s = this.sim.state;
    const waves = match.data.waves.length;
    const watching = this.view !== driver.me ? `   (watching ${this.nameOf(this.view)})` : '';
    this.hud.setText(`Gold ${s.gold}   Lives ${livesOf(match, this.view)}   Wave ${m.wavesCalled}/${waves}   Kills ${s.kills}${watching}`);
    this.d2?.update({ gold: s.gold, lives: livesOf(match, this.view), maxLives: match.data.economy.lives, wave: this.waveLabel(m.wavesCalled), nextWave: this.nextWaveTip(m.wavesCalled) });

    const parts: string[] = [];
    if (m.status === 'playing' && m.wavesCalled < waves) {
      const waiting = playersIn(match);
      const ready = waiting.filter((p) => m.ready[p]).length;
      parts.push(`Next wave in ${Math.max(0, Math.ceil((m.nextWaveTick - m.tick) / TICKS_PER_SECOND))} s, ${ready}/${waiting.length} ready`);
    }
    const names = match.zones.map((z, i) => {
      const tag = m.mode === 'ffa' ? (z.state.status === 'lost' ? ' out' : ` ${z.state.lives}`) : '';
      return `${i + 1} ${this.nameOf(i)}${tag}${i === this.view ? '*' : ''}`;
    });
    parts.push(`${m.mode === 'team' ? 'Zones' : 'Lanes'}: ${names.join('  ')}`);
    if (match.zones.length > 1) parts.push(`keys 1-${match.zones.length} watch`);
    this.hud2.setText(parts.join('   |   '));

    if (m.status === 'over' && !this.endOverlay.visible && !this.halted) {
      const won = m.winners.includes(driver.me);
      const title =
        m.mode === 'team'
          ? won ? 'Your team held!' : 'Your team fell'
          : won ? 'You win!' : m.winners.length > 0 ? `${m.winners.map((w) => this.nameOf(w)).join(' and ')} won` : 'Nobody survived';
      this.endOverlay.setText(`${title}\nwave ${m.wavesCalled}\nclick to return to the menu`).setFontSize(48).setVisible(true);
    }
  }

  /** "Nightmare 4/30": the difficulty of the last wave called and its number in it. */
  private waveLabel(called: number): string {
    const data = this.sim.data;
    const last = data.waves[called - 1];
    const difficulty = last?.difficulty ?? data.difficulty;
    const perDifficulty = data.waves.filter((w) => w.difficulty === difficulty).length;
    return `${DIFFICULTY_NAMES[difficulty]} ${last?.number ?? 0}/${perDifficulty}`;
  }

  /** The next wave's monsters as a D2 tooltip: counts by type, then champions, uniques and bosses. */
  private nextWaveTip(index: number): { title: string; body: string } | undefined {
    const data = this.sim.data;
    const def: WaveDef | undefined = data.waves[index];
    if (!def) return undefined;
    const nice = (id: string) => (data.monsters[id]?.name ?? id).replace(/([a-z])([A-Z])/g, '$1 $2');
    const mod = (m: string) => m.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    const normal = new Map<string, number>();
    const special: string[] = [];
    for (const g of def.groups) {
      if (g.rank === 'normal') normal.set(g.monster, (normal.get(g.monster) ?? 0) + g.count);
      else special.push(`${g.rank === 'boss' ? 'Boss' : g.rank === 'unique' ? 'Unique' : `${g.count} champion`}: ${nice(g.monster)}${g.mods.length ? ` (${g.mods.map(mod).join(', ')})` : ''}`);
    }
    const lines = [...[...normal].map(([id, n]) => `${n} ${nice(id)}`), ...special, '', `Kills so far: ${this.sim.state.kills}`];
    return { title: `Next: ${DIFFICULTY_NAMES[def.difficulty]} wave ${def.number}`, body: lines.join('\n') };
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
    const key = JSON.stringify([this.view, sel, tower && [tower.tier, tower.level, tower.picks, tower.targeting], sim.state.gold, sim.state.towers.length]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    for (const o of this.panel) o.destroy();
    this.panel = [];
    this.tooltip.hide();
    if (this.driver && this.view !== this.driver.me) {
      this.info.setText(`Watching ${this.nameOf(this.view)}'s zone. Press ${this.driver.me + 1} to go back to yours.`);
      this.d2?.setSlots([]);
      this.d2?.setTowerPanel(undefined);
      return;
    }
    if (this.d2) return this.drawD2Panel(sel, tower);

    const x = 16;
    const y = PANEL_TOP + 38;
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

  /** The D2 panel: build choices in the belt slots, the selected tower in its stone panel. */
  private drawD2Panel(sel: Selection, tower: Tower | undefined): void {
    const sim = this.sim;
    const e = sim.data.economy;
    const d2 = this.d2!;
    if (sel?.kind === 'tile') {
      this.info.setText(`Build a Paladin tower (${e.buildCost} gold): its first skill fixes its line`);
      const items: SlotItem[] = Object.values(sim.data.classes[CLASS]!.lines).map((line) => {
        const skill = line.tiers[0]![0]!;
        const spec = this.skillButton(skill, '', () => undefined);
        return {
          icon: spec.icon,
          title: `${line.name}: ${this.skillName(skill)}`,
          body: `${spec.tooltip?.body ?? ''}\n\nBuild for ${e.buildCost} gold`.trim(),
          enabled: sim.state.gold >= e.buildCost,
          onClick: () => {
            this.issue({ type: 'build', x: sel.x, y: sel.y, cls: CLASS, skill });
            this.selection = undefined;
          },
        };
      });
      d2.setSlots(items);
      d2.setTowerPanel(undefined);
    } else if (tower) {
      this.info.setText('');
      d2.setSlots([]);
      d2.setTowerPanel(this.towerModel(tower));
    } else {
      this.info.setText(sim.state.towers.length < 2 ? 'Click a free tile to build. Click a tower to upgrade it.' : '');
      d2.setSlots([]);
      d2.setTowerPanel(undefined);
    }
  }

  /** What the selected tower's stone panel shows: who it is, what it does, what it can buy. */
  private towerModel(tower: Tower): TowerPanelModel {
    const sim = this.sim;
    const e = sim.data.economy;
    const active = activeSkill(sim, tower);
    const recipe = tower.evolved ? sim.data.evolutions.find((r) => r.id === tower.evolved) : undefined;
    const line = sim.data.classes[tower.cls]?.lines[tower.line];
    const lines: string[] = [];
    lines.push(recipe ? `Evolved, with ${this.skillName(tower.partnerSkill)} built in` : `${line?.name ?? 'No line yet'}   Tier ${tower.tier}   Level ${tower.level}`);
    if (active) {
      const buff = sim.fx.towers[tower.id];
      const base = standardDps(active.skill, active.lvl);
      // 1/256 HP per 1000 ticks, at 20 ticks a second, lifted by the auras this tower stands in
      const dps = Math.round((((base * TICKS_PER_SECOND) / 1000 / 256) * (100 + (buff?.damagePct ?? 0)) * (100 + (buff?.attackSpeedPct ?? 0))) / 10000);
      lines.push(base > 0 ? `Damage per second ${dps}` : `${active.skill.archetype === 'buffAura' || active.skill.archetype === 'debuff' || active.skill.archetype === 'control' ? 'Aura' : 'Support'} tower`);
    }
    const under = [...new Set(sim.fx.emitters.filter((em) => {
      if (em.towerId === tower.id) return false;
      const src = towerById(sim, em.towerId);
      return src !== undefined && (src.x - tower.x) ** 2 + (src.y - tower.y) ** 2 <= em.radiusUnits * em.radiusUnits;
    }).map((em) => this.skillName(em.skill)))];
    if (under.length) lines.push(`Under ${under.join(', ')}`);
    const level = active ? upgradeCost(sim, tower) : undefined;
    const tier = tierCost(sim, tower);
    if (level !== undefined) lines.push(`Next: level ${tower.level + 1} for ${level} gold`);
    else if (tier !== undefined) lines.push(`Next: tier ${tower.tier + 1} for ${tier} gold`);
    lines.push(`Targeting ${tower.targeting}`);

    const buttons: PanelButton[] = [];
    const type = tower.line ? 'pickBranch' : 'pickSkill';
    for (const skill of pendingChoices(sim, tower)) buttons.push({ label: `Pick ${this.skillName(skill)}`, enabled: true, onClick: () => this.issue({ type, towerId: tower.id, skill }) });
    if (level !== undefined) buttons.push({ label: `Upgrade ${level}g`, enabled: sim.state.gold >= level, onClick: () => this.issue({ type: 'upgrade', towerId: tower.id }) });
    if (tier !== undefined && line) {
      const options = line.tiers[tower.tier] ?? [];
      for (const skill of options) {
        const commands: Command[] = [{ type: 'upgradeTier', towerId: tower.id }];
        if (options.length > 1) commands.push({ type: 'pickBranch', towerId: tower.id, skill });
        buttons.push({ label: options.length > 1 ? `Tier up: ${this.skillName(skill)}` : `Tier up ${tier}g`, enabled: sim.state.gold >= tier, onClick: () => this.issue(...commands) });
      }
    }
    for (const other of sim.state.towers) {
      const match = evolutionFor(sim, tower, other);
      if (match) buttons.push({ label: `Evolve ${match.recipe.name}`, enabled: sim.state.gold >= e.evolveCost, onClick: () => this.issue({ type: 'evolve', towerA: tower.id, towerB: other.id }) });
    }
    const next = TARGETING_MODES[(TARGETING_MODES.indexOf(tower.targeting) + 1) % TARGETING_MODES.length]!;
    buttons.push({ label: 'Targeting', enabled: true, onClick: () => this.issue({ type: 'setTargeting', towerId: tower.id, mode: next }) });
    buttons.push({
      label: `Sell ${sellValue(sim, tower)}g`,
      enabled: true,
      onClick: () => {
        this.issue({ type: 'sell', towerId: tower.id });
        this.selection = undefined;
      },
    });
    const skillId = recipe?.attack.skill ?? active?.skill.id;
    const icon = skillId ? this.skillButton(skillId, '', () => undefined).icon : undefined;
    const title = recipe ? recipe.name : active ? active.skill.name : 'Paladin tower';
    return { icon, title, lines, buttons };
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
