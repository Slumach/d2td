// The game scene: the sim's state drawn with the pipeline's D2 sprites. It reads sim state
// and never writes to it: every player action becomes a Command stamped with the tick it
// runs on, the same stream a lockstep peer would get.
//
// The ring is drawn in world space under a camera that pans and zooms (view.ts); the HUD,
// panel and minimap sit flat over it on their own camera.

import Phaser from 'phaser';

import { DESIGN } from '../data/design.ts';
import type { MpEvent, LauncherApi, SaveSlot } from '../launcher/api.ts';
import { frontendManifest, menuMusic, preloadFrontend, stoneButton, stonePanel } from '../launcher/frontend.ts';
import { MpSession } from '../launcher/session.ts';
import { Lockstep } from '../net/lockstep.ts';
import type { LobbyPlayer } from '../net/protocol.ts';
import { actJustStarted, takeCheckpoint, type Checkpoint } from '../sim/checkpoint.ts';
import { baseMonsterId, baseSkillId, buildGameData, MAX_TIER, MAX_TOWER_LEVEL, stageName, waveLabel as labelOf, type DesignData, type GameData, type WaveDef } from '../sim/data.ts';
import { effectsOn, helps, projected, reachOf, terms } from './aurainfo.ts';
import { GroundDrops } from './drops.ts';
import { isAura, standardDps } from '../sim/dps.ts';
import { TICKS_PER_SECOND, UNITS_PER_TILE } from '../sim/fixed.ts';
import { aliveOf, arcOwner, ringOf, seatOf, slotOf, teamOf, type BattleSetup, type MatchMode } from '../sim/match.ts';
import { meets } from '../sim/towers.ts';
import { geared } from '../sim/items/tower.ts';
import { ARC_COUNT, arcAt, isBlocked, isPathTile, positionAt } from '../sim/map.ts';
import {
  activeSkill,
  canBuild,
  earlySendBonus,
  evolutionFor,
  legendOptions,
  ridersOf,
  aliveLimitOf,
  pendingChoices,
  sellValue,
  buildCostFor,
  tierCost,
  towerAt,
  towerById,
  upgradeCost,
  type Command,
  type Corpse,
  type Monster,
  type Sim,
  type Tower,
  waveAt,
} from '../sim/sim.ts';
import { TABLE_NAMES, type Tables } from '../sim/tables.ts';
import { TARGETING_MODES, type LootFilter } from '../sim/state.ts';
import type { DebuffDef, PierceDef, SkillDef } from '../sim/archetypes/types.ts';
import { SKILL_ART, STATUS_OVERLAYS, SUMMON_BOLTS, SUMMON_HEROES } from './art.ts';
import {
  MAP_KEY,
  groundKey,
  sceneryKey,
  type MapManifest,
  animKey,
  createAnimations,
  heroAttackMode,
  heroGearOf,
  heroKey,
  iconIndex,
  iconKey,
  metaOf,
  missileKey,
  monsterKey,
  objectKey,
  originOf,
  HIRELING_IDS,
  preloadAssets,
  type IconIndex,
} from './assets.ts';
import { D2Hud, hudManifest, preloadHud, type HudNumbers, type PanelButton, type SkillSlot, type SlotItem, type TowerPanelModel } from './d2hud.ts';
import { ItemPanels, type ItemPanelHost } from './itempanels.ts';
import { preloadItemArt } from './itemart.ts';
import { Keeper } from './keeper.ts';
import { arcOfSeat } from '../sim/cow.ts';
import { tradeOf } from '../sim/items/trade.ts';
import { angle64, spriteDirection } from './directions.ts';
import { LocalDriver, NetDriver, type Driver, type LocalBattle } from './driver.ts';
import { BattleHud, KEEP_NAMES } from './battlehud.ts';
import { facingFromVector, type Facing8 } from './facing.ts';
import { ISO_H, ISO_W, ORIGIN, WORLD_WIDTH, ellipseOf, project, screenVector, tileAtWorld, tileDiamond } from './iso.ts';
import { GAME_HEIGHT, GAME_WIDTH, HUD_HEIGHT, PANEL_TOP } from './layout.ts';
import { Minimap } from './minimap.ts';
import { BATTLE_COLUMNS, battleRows, Scoreboard, scoreRows } from './scoreboard.ts';
import { saveCheckpoint } from './saves.ts';
import { WorldView } from './view.ts';
import { SkillFx, type Point } from './skillfx.ts';
import { SoundBank, preloadSounds } from './sound.ts';
import { FONT, buttonRow, createTooltip, type ButtonSpec, type Tooltip } from './ui.ts';

/** How far a tower looks for a monster to face, in units. */
const FACE_RANGE = 6 * UNITS_PER_TILE;

const LINE_COLOURS: Record<string, number> = {
  zealot: 0xc84a3a,
  holy: 0xe0b840,
  aura: 0x4a84d8,
  fire: 0xe06020,
  cold: 0x60a8f0,
  lightning: 0xe0e060,
  support: 0xa070e0,
  summoning: 0x80c070,
  bone: 0xd8d0b0,
  curses: 0x903040,
};
const EVOLVED_COLOUR = 0xa050d0;
/** Status tints: frozen, chilled or slowed, poisoned. */
const FROZEN_TINT = 0x6f98ff;
const CHILL_TINT = 0xa8d4ff;
const POISON_TINT = 0x9ae07a;
/** Revived corpses fight for the player; a pale tint tells them from the wave. */
const REVIVED_TINT = 0xd0ffd0;
/** How far a shoved summon is pushed sideways at first, in screen pixels. */
const SHOVE_PX = 14;
/** Milliseconds per sim tick, for effects timed to the sim. */
const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Enchant's full flame plays once this often on a tower (staggered by tower); a faint ember on the weapon hand rides between. */
const ENCHANT_FLARE_TICKS = 12 * TICKS_PER_SECOND;
/** D2's gold: the colour of gold and of unique item names. */
const GOLD_TEXT = '#c7b377';
/** Floating kill gold on screen at once at most. */
const MAX_GOLD_TEXTS = 60;
/** Where a standing hero's weapon hand is, from its feet. */
const ENCHANT_HAND = { x: 6, y: -11 };

const DEPTH = { ground: 1, rings: 2, corpses: 3, units: 10, overlay: 1500, effects: 2000, chrome: 2900 };
/** Each player's colour: their arcs on the map and the minimap. */
const PLAYER_COLOURS = [0xc8a040, 0x4a84d8, 0xc84a3a, 0x60b060, 0xa070e0, 0x50c0c0];
/** The alive bar across the top of the screen. */
const ALIVE_BAR = { width: 440, height: 16, y: 10 };

/** What a summon tower's panel calls its summons, by monster. */
const SUMMON_NOUNS: Record<string, [string, string]> = {
  necroskeleton: ['skeleton', 'skeletons'],
  necromage: ['skeletal mage', 'skeletal mages'],
  druidhawk: ['raven', 'ravens'],
  fenris: ['dire wolf', 'dire wolves'],
  druidbear: ['grizzly', 'grizzlies'],
  dopplezon: ['decoy', 'decoys'],
  shadowmaster: ['shadow master', 'shadow masters'],
};
/** Dev: ?debug logs every sprite the scene creates. */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');


type Selection = { kind: 'tile'; x: number; y: number } | { kind: 'tower'; id: number } | undefined;

/** What the lobby hands the game when the host starts an online match. */
export interface OnlineStart {
  seed: number;
  mode: MatchMode;
  players: LobbyPlayer[];
  you: number;
  /** The host saves the game at every new act. */
  host: boolean;
  /** Carry on from the host's checkpoint. */
  resume?: Checkpoint;
  /** Battle and co-op: the lobby's teams, races and bots. */
  battle?: BattleSetup;
}

/** A single-player run: a new campaign, or one carried on from its checkpoint. */
export interface SoloStart {
  resume?: Checkpoint;
}

/** Battle Mode against the match's own bots, from the main menu. */
export interface BattleStart {
  battle: LocalBattle;
}

/** The battlefields' keeps in team order, as the extraction names them (src/data/map/battle.json). */
const BATTLE_KEEPS = ['harrogath', 'fortress'];

/** Battle Mode's workers: D2's hirelings of every act in turn, a Dark Hunter before they are extracted. */
const WORKER_ART = HIRELING_IDS.map((id) => `mon:${id}:normal`);
const WORKER_STAND_IN = 'mon:corruptrogue1:normal';

/** The grey-box ground, for a run without the extracted maps: field, then boss lair. */
const GREY_BOX: [number, number] = [0x30402a, 0x34343a];

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
  partnerCooldown: number;
}

interface MissileView {
  /** A Lightning bolt: where its strikes have been laid to so far. */
  boltAt?: { x: number; y: number };
  /** Missiles with no flying art (zones, novas, lightning) have no sprite. */
  sprite: Phaser.GameObjects.Sprite | undefined;
  x: number;
  y: number;
  skill: string;
  /** The flying art, which also names its sounds; empty if it has none. */
  art: string;
  age: number;
}

interface SummonView {
  sprite: Phaser.GameObjects.Sprite;
  texture: string;
  facing: Facing8;
  cooldown: number;
}

export class GameScene extends Phaser.Scene {
  private driver: Driver | undefined;
  private gameData!: GameData;
  private seed = 1;
  /** The ring on screen: your own, or another FFA player's while watching. */
  private view = 0;
  private camera!: WorldView;
  /** Which slot this game saves its checkpoints to; none for a multiplayer guest. */
  private saves: SaveSlot | undefined;
  /** The ring's wave count on the last tick, to catch the start of an act. */
  private waveSeen = 0;
  private stageText!: Phaser.GameObjects.Text;
  private minimap!: Minimap;
  private scoreboard!: Scoreboard;
  /** D2R's inventory panel, with the HUD art. */
  private inventory: ItemPanels | undefined;
  /** The player's profile, kept in step with the game (inventory, stash, items in play). */
  private keeper: Keeper | undefined;
  private aliveGfx!: Phaser.GameObjects.Graphics;
  private aliveText!: Phaser.GameObjects.Text;
  private groundGfx: Phaser.GameObjects.Graphics | undefined;
  /** The baked map on screen: its ground and scenery, rebuilt when the act or lair changes. */
  private mapParts: Phaser.GameObjects.GameObject[] = [];
  private mapShown = '';
  /** Why an online game stopped early (desync, host gone); empty while it runs. */
  private halted = '';
  private lastTick = -1;
  private hover: { x: number; y: number } | undefined;
  private spawnLabel: Phaser.GameObjects.Text | undefined;
  private altKey: Phaser.Input.Keyboard.Key | undefined;
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
  private drops?: GroundDrops;
  /** The cow portal on screen, and whether the cow level is showing. */
  private portal: Phaser.GameObjects.Sprite | undefined;
  private cowShown = false;
  private towers = new Map<number, TowerView>();
  private missiles = new Map<number, MissileView>();
  private summons = new Map<number, SummonView>();
  /** Where each corpse lies and how long it had left, to tell a consumed corpse from a rotted one. */
  private corpseSeen = new Map<number, { x: number; y: number; ticksLeft: number }>();
  /** Curses each monster carried last tick, to mark fresh ones. */
  private cursesSeen = new Map<number, Set<string>>();
  private fx!: SkillFx;
  /** The class tab the build menu shows. */
  /** The build tab chosen; every class the game data carries has one, in its order. */
  private buildClass = 'paladin';
  /** Battle Mode: its HUD, the keep's sprites, the local battle to play again, and whether the result is on the profile. */
  private battleHud: BattleHud | undefined;
  private keepParts: Phaser.GameObjects.GameObject[] = [];
  private localBattle: LocalBattle | undefined;
  private battleRecorded = false;

  constructor() {
    super('Game');
  }

  preload(): void {
    // The menu may have loaded the item tables already
    for (const name of TABLE_NAMES) if (!this.cache.json.exists(name)) this.load.json(name, `data/${name}.json`);
    preloadAssets(this);
    preloadSounds(this);
    preloadHud(this);
    preloadFrontend(this);
    preloadItemArt(this);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.add.text(16, 16, `Missing ${file.src}. Run npm run extract first.`, { color: '#e0c080' }).setDepth(9000);
    });
  }

  /** The ring on screen. */
  private get sim(): Sim {
    return this.driver!.match.zones[this.view]!;
  }

  /** Who this player is on the ring on screen (their slot on a team ring). */
  private get seat(): number {
    return this.driver ? seatOf(this.driver.match, this.driver.me) : 0;
  }

  /** This player's gold. */
  private get gold(): number {
    return this.sim.state.gold[this.seat] ?? 0;
  }

  /** The colour of whoever defends an arc of the ring on screen. */
  private arcColour(arc: number): number {
    return PLAYER_COLOURS[this.driver ? arcOwner(this.driver.match, this.view, arc) % PLAYER_COLOURS.length : 0]!;
  }

  /** Puts the camera over a player's own arc. */
  private lookAtArcOf(player: number): void {
    const match = this.driver!.match;
    const sim = match.zones[ringOf(match, player)]!;
    const arc = sim.arcOwners.indexOf(seatOf(match, player));
    const a = sim.map.arcs[Math.max(0, arc)]!;
    if (sim.map.open) {
      // A battle lane: its middle rows
      const p = positionAt(sim.map, a.start + 15 * UNITS_PER_TILE);
      const at = project(p.x, p.y);
      this.camera.centreOn(at.x, at.y);
      return;
    }
    // The middle of its long straight, pulled a little into the interior
    const p = positionAt(sim.map, a.start + sim.map.length / ARC_COUNT / 2);
    const mid = { x: (p.x + (sim.map.width * UNITS_PER_TILE) / 2) / 2, y: (p.y + (sim.map.height * UNITS_PER_TILE) / 2) / 2 };
    const at = project((p.x * 3 + mid.x) / 4, (p.y * 3 + mid.y) / 4);
    this.camera.centreOn(at.x, at.y);
  }

  create(start?: OnlineStart | SoloStart | BattleStart): void {
    // The browser preview's ?battle starts the first game as a battle
    const preview = this.registry.get('battle') as LocalBattle | undefined;
    if ((!start || Object.keys(start).length === 0) && preview) {
      start = { battle: preview };
      this.registry.remove('battle');
    }
    this.driver = undefined;
    this.battleHud = undefined;
    this.keepParts = [];
    this.localBattle = undefined;
    this.battleRecorded = false;
    this.battleEndShown = false;
    this.halted = '';
    this.groundGfx = undefined;
    this.mapParts = [];
    this.mapShown = '';
    this.camera = new WorldView(this, (p) => this.onMapClick(p));
    this.clearViews();
    if (!TABLE_NAMES.every((name) => this.cache.json.exists(name))) return;
    const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, this.cache.json.get(name)])) as unknown as Tables;
    const design = (this.registry.get('design') as DesignData | undefined) ?? DESIGN;
    // The campaign: five acts on Normal, then Nightmare, then Hell
    this.gameData = buildGameData(tables, design);
    // Browser preview (?wave=N): the run starts at wave N, the schedule before it dropped
    const startAt = Number(this.registry.get('startWave') ?? 1);
    if (startAt > 1) this.gameData = { ...this.gameData, waves: this.gameData.waves.slice(startAt - 1) };
    this.saves = undefined;
    if (start && 'players' in start) {
      const session = MpSession.of(this.registry.get('launcher') as LauncherApi);
      this.seed = start.resume?.seed ?? start.seed;
      const lockstep = new Lockstep({
        data: this.gameData,
        seed: this.seed,
        mode: start.mode,
        players: start.battle ? start.battle.teamSize * (start.mode === 'battle' ? 2 : 1) : start.players.length,
        ...(start.battle ? { battle: start.battle } : {}),
        me: start.you,
        send: (m) => session.send(m),
        ...(start.resume ? { resume: start.resume } : {}),
      });
      // In a battle the names go by seat: the lobby's players where it seated them, bots in the rest
      const seats = start.battle?.seats;
      const players = seats
        ? Array.from({ length: lockstep.match.players }, (_, slot) => {
            const lobby = seats.indexOf(slot);
            return { slot, name: lobby >= 0 ? (start.players.find((p) => p.slot === lobby)?.name ?? `Player ${lobby + 1}`) : `Bot ${slot + 1}` };
          })
        : start.players;
      this.driver = new NetDriver(lockstep, players);
      this.view = ringOf(lockstep.match, this.driver.me);
      // The host keeps the multiplayer save; a battle is not saved
      if (start.host && !start.battle) this.saves = 'mp';
      session.listen((e) => this.onNet(e, lockstep));
    } else if (start && 'battle' in start) {
      // A battle against bots: a fresh seed each time, nothing saved
      this.seed = (Date.now() % 2_000_000_000) + 1;
      this.localBattle = start.battle;
      this.driver = new LocalDriver(this.gameData, this.seed, undefined, start.battle);
      this.view = 0;
    } else {
      if (start?.resume) this.seed = start.resume.seed;
      this.driver = new LocalDriver(this.gameData, this.seed, start?.resume);
      this.view = 0;
      this.saves = 'solo';
    }
    const battle = this.driver.match.state.battle;
    // A battle player builds only their race
    if (battle) this.buildClass = battle.races[this.driver.me] ?? this.buildClass;
    this.waveSeen = this.sim.state.wave;
    this.keeper = new Keeper(this.registry.get('launcher') as LauncherApi | undefined, this.gameData.items);
    // Battle Mode carries no items: the profile only takes its record
    if (!battle) this.keeper.begin((c) => this.issue(c));
    // The loot filter from Options; the default needs no command
    const filter = (this.registry.get('lootFilter') as LootFilter | undefined) ?? 'default';
    if (filter !== 'default' && !battle) this.issue({ type: 'lootFilter', mode: filter });
    this.icons = iconIndex(this);
    createAnimations(this);
    this.fx = this.camera.asWorld(() => new SkillFx(this, DEPTH.effects));
    menuMusic(this, false);
    this.sounds = new SoundBank(this);
    this.sounds.startLoops();
    this.drops = new GroundDrops(
      this,
      DEPTH.overlay - 1,
      (c) => this.issue(c),
      (item) => this.sounds.item(this.sim.data.items.bases[item.code]?.dropSound),
      (make) => this.camera.asWorld(make),
      (d) => {
        const sell = () => {
          this.issue({ type: 'sellDrop', dropId: d.id });
          this.sounds.item('item_gold');
        };
        if (this.inventory) this.inventory.confirmSale(d.item, sell);
        else sell();
      },
    );

    const hudArt = hudManifest(this);
    this.d2 = hudArt
      ? new D2Hud(this, hudArt, {
          onCallWave: () => this.issue({ type: 'callWave' }),
          sendWave: !battle,
          onInventory: () => this.toggleInventory(),
          onAutomap: () => this.minimap.toggle(),
          onParty: () => this.scoreboard.toggle(),
          onMenu: () => this.openMenu(),
        })
      : undefined;
    this.inventory = !battle && hudArt && ItemPanels.available(this, hudArt) ? new ItemPanels(this, hudArt, this.itemHost(), this.d2?.beltSpots() ?? []) : undefined;
    // The plain HUD and panel backgrounds sit over the map, so tall scenery never paints across them
    if (!this.d2) this.add.graphics().setDepth(DEPTH.chrome).fillStyle(0x1a1a14).fillRect(0, 0, GAME_WIDTH, HUD_HEIGHT).fillRect(0, PANEL_TOP, GAME_WIDTH, GAME_HEIGHT - PANEL_TOP);
    this.camera.asWorld(() => {
      this.drawGround();
      this.ringGfx = this.add.graphics().setDepth(DEPTH.rings);
      this.overlayGfx = this.add.graphics().setDepth(DEPTH.overlay);
    });
    this.minimap = new Minimap(this, this.camera, GAME_WIDTH - WORLD_WIDTH / 8 - 12, 84, 3100);
    this.scoreboard = new Scoreboard(this, (GAME_WIDTH - WORLD_WIDTH / 8 - 24) / 2, 150, 5600);
    // FFA: the rings lie side by side, so panning on past an edge shows the next player's
    this.camera.onEdge = (dir) => {
      const match = this.driver?.match;
      // Battle: the other team's battlefield lies past either edge
      if (match?.state.battle) {
        if (match.zones.length < 2) return false;
        this.watch((this.view + dir + 2) % 2);
        return true;
      }
      if (!match || match.state.mode !== 'ffa' || match.players < 2) return false;
      this.watch((this.view + dir + match.players) % match.players);
      return true;
    };
    this.aliveGfx = this.add.graphics().setDepth(3100);
    this.aliveText = this.add
      .text(GAME_WIDTH / 2, ALIVE_BAR.y + ALIVE_BAR.height / 2, '', { fontFamily: FONT, fontSize: '15px', color: '#f0e6d0' })
      .setOrigin(0.5)
      .setDepth(3101)
      .setShadow(1, 1, '#000000', 2);
    this.stageText = this.add
      .text(GAME_WIDTH / 2, ALIVE_BAR.y + ALIVE_BAR.height + 14, '', { fontFamily: FONT, fontSize: '14px', color: '#c8bc98' })
      .setOrigin(0.5)
      .setDepth(3101)
      .setShadow(1, 1, '#000000', 2);
    this.stageText.setText(this.stage().label);
    // With D2R's panel the globes and its stage line carry these
    if (this.d2) this.stageText.setVisible(false);
    this.lookAtArcOf(this.driver.me);

    const text = { fontFamily: FONT, fontSize: '24px', color: '#e8e0c0' };
    const online = this.driver.online;
    this.hud = this.add.text(16, online ? 8 : 18, '', text).setDepth(3000);
    this.hud2 = this.add.text(16, 38, '', { ...text, fontSize: '17px', color: '#b8b090' }).setDepth(3000);
    this.notice = this.add.text(GAME_WIDTH / 2, HUD_HEIGHT + 16, '', { ...text, fontSize: '20px', backgroundColor: '#000000a0', padding: { x: 12, y: 6 } }).setOrigin(0.5, 0).setDepth(5500).setVisible(false);
    // The spawn mark toasts, so it waits for the notice text to exist (0.2.3 threw here on launch)
    if (battle) this.markLanes();
    else if (this.sim.players === 1) this.markSpawn();
    else this.markArcs();
    this.info = this.add.text(16, PANEL_TOP + 8, '', { ...text, fontSize: '20px' }).setDepth(3000);
    this.tooltip = createTooltip(this, 16, PANEL_TOP - 8);
    if (battle) {
      this.battleHud = new BattleHud(this, {
        match: () => this.driver!.match,
        me: () => this.driver!.me,
        nameOf: (slot) => this.nameOf(slot),
        issue: (c) => {
          this.issue(c);
          if (c.type === 'send') this.sounds.battle('send');
        },
        monsterName: (id) => (this.gameData.monsters[id]?.name ?? id).replace(/([a-z])([A-Z])/g, '$1 $2'),
        tooltip: this.tooltip,
      });
      this.stageText.setVisible(false);
      this.aliveText.setVisible(false);
      this.toast(`You play the ${this.gameData.classes[this.buildClass]?.name ?? this.buildClass}. Build beside your lane before the first wave.`);
    }
    if (this.d2) {
      // D2 shows no status line: lives, gold and the wave live in the panel; hints sit just above it
      this.hud.setVisible(false);
      this.hud2.setPosition(16, 12).setShadow(1, 1, '#000000', 2);
      this.info.setPosition(GAME_WIDTH / 2, 816).setOrigin(0.5).setFontSize(15).setColor('#c8bc98').setShadow(1, 1, '#000000', 2);
    } else {
      buttonRow(this, GAME_WIDTH - 180, 12, [{ label: 'Send Next Wave', onClick: () => this.issue({ type: 'callWave' }), colour: '#6a3020' }], 200);
    }
    this.endOverlay = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '', { ...text, fontSize: '48px', align: 'center', backgroundColor: '#000000c0', padding: { x: 40, y: 24 } })
      .setOrigin(0.5)
      .setDepth(6000)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => (this.driver?.online ? this.leaveOnline() : this.localBattle ? this.quitToMenu() : this.restartRun()));

    this.input.mouse?.disableContextMenu();
    // Keys 1 to n: on a team ring, look at that player's arc; in FFA, watch their ring
    this.input.keyboard?.on('keydown-ESC', () => {
      // As in D2, Escape closes an open panel before it opens the menu
      if (this.inventory?.holding) return this.inventory.dropHeld();
      if (this.inventory?.open) return this.inventory.hide();
      this.openMenu();
    });
    this.input.keyboard?.on('keydown-I', () => this.toggleInventory());
    this.input.keyboard?.addCapture('TAB');
    // Tab is the scoreboard (D2's party panel); M, or the panel's button, the automap
    this.input.keyboard?.on('keydown-TAB', () => this.scoreboard.toggle());
    this.input.keyboard?.on('keydown-M', () => this.minimap.toggle());
    // Home: back to your own arc (in FFA, your own ring)
    this.input.keyboard?.on('keydown-HOME', () => {
      const d = this.driver;
      if (!d) return;
      if ((d.match.state.mode === 'ffa' || battle) && this.view !== ringOf(d.match, d.me)) this.watch(ringOf(d.match, d.me));
      this.lookAtArcOf(d.me);
    });
    if (online || battle) {
      // Keys 1 to n: a player's arc, ring or lane (in a battle, on whichever battlefield it is)
      this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
        const n = Number(e.key);
        const match = this.driver!.match;
        if (!Number.isInteger(n) || n < 1 || n > match.players) return;
        if (match.state.mode === 'ffa' && n - 1 !== this.view) this.watch(n - 1);
        else if (match.state.battle && ringOf(match, n - 1) !== this.view) {
          this.watch(ringOf(match, n - 1));
          this.lookAtArcOf(n - 1);
        } else this.lookAtArcOf(n - 1);
      });
    }
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => (this.hover = this.camera.dragging ? undefined : this.tileAt(p)));
    // Alt shows every drop label, filtered ones included
    this.altKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ALT, false);
    this.events.emit('game-ready');
  }

  // ---- input and commands ----

  /** Why this tower cannot evolve yet: the recipes its line is part of, what it still needs and what must stand beside it. */
  /**
   * Every tower on the ring that can evolve with `tower`, highest tier and level first; when
   * more than one qualifies each button names its partner, so the player picks which is spent.
   */
  private partners(tower: Tower): { match: NonNullable<ReturnType<typeof evolutionFor>>; other: Tower; label: string }[] {
    const sim = this.sim;
    const found = sim.state.towers.flatMap((other) => {
      const match = evolutionFor(sim, tower, other);
      return match ? [{ match, other }] : [];
    });
    found.sort((a, b) => b.other.tier - a.other.tier || b.other.level - a.other.level);
    const many = found.length > 1;
    return found.map((f) => ({ ...f, label: many ? ` with ${this.skillName(f.other.picks.at(-1) ?? '')} T${f.other.tier} L${f.other.level}` : '' }));
  }

  /**
   * What a branch leads to, for a tier-up choice: the next tier's skills on the line and the
   * evolutions the branch is part of ("Concentration: leads to T3 Fanaticism or Conviction;
   * evolves Hammerdin with a Blessed Hammer tower").
   */
  private branchLead(tower: Tower, tierIndex: number, skill: string): string {
    const sim = this.sim;
    const line = sim.data.classes[tower.cls]?.lines[tower.line];
    const after = line?.tiers[tierIndex + 1];
    const parts: string[] = [];
    if (after) parts.push(`leads to T${tierIndex + 2} ${after.map((s) => this.skillName(s)).join(' or ')}`);
    const recipes = sim.data.evolutions.flatMap((r) => {
      const other = r.attack.skill === skill ? r.partner : r.partner.skill === skill ? r.attack : undefined;
      return other ? [`${r.name} with a ${this.skillName(other.skill)} tower`] : [];
    });
    parts.push(recipes.length ? `evolves ${recipes.join(', ')}` : 'in no evolution');
    return `${this.skillName(skill)}: ${parts.join('; ')}`;
  }

  private evolveHint(tower: Tower): string {
    const sim = this.sim;
    const line = sim.data.classes[tower.cls]?.lines[tower.line];
    const ofLine = new Set(line?.tiers.flat() ?? []);
    // Not a recipe this tower has branched away from (a Holy Freeze tower makes no Hammerdin)
    const open = (skill: string) => {
      const at = line?.tiers.findIndex((opts) => opts.includes(skill)) ?? -1;
      return at < 0 || at >= tower.picks.length || tower.picks[at] === skill;
    };
    const recipes = sim.data.evolutions.filter((r) => (ofLine.has(r.attack.skill) && open(r.attack.skill)) || (ofLine.has(r.partner.skill) && open(r.partner.skill)));
    if (recipes.length === 0) return 'Evolve: this line is in no evolution';
    const parts = recipes.slice(0, 2).map((r) => {
      const own = ofLine.has(r.attack.skill) ? r.attack : r.partner;
      const other = own === r.attack ? r.partner : r.attack;
      return meets(sim, tower, own)
        ? `${r.name} needs a ${this.skillName(other.skill)} tower at tier ${other.minTier} anywhere on your ring`
        : `${r.name} needs this tower at ${this.skillName(own.skill)} tier ${own.minTier} and a ${this.skillName(other.skill)} tower at tier ${other.minTier} anywhere on your ring`;
    });
    return `Evolve: ${parts.join('; ')}`;
  }

  /** A mode's animation facing `facing`, or its one stored direction when D2 drew it in one (Diablo's and Baal's deaths), or none. */
  private modeKey(texture: string, mode: string, facing: string): string | undefined {
    const want = animKey(texture, mode, facing);
    if (this.anims.exists(want)) return want;
    for (const dir of ['sw', 's', 'w', 'n', 'e', 'nw', 'ne', 'se']) {
      const key = animKey(texture, mode, dir);
      if (this.anims.exists(key)) return key;
    }
    return undefined;
  }

  /** Team mode: your own arc, outlined and tinted, shown when zoomed out. */
  private ownArc: Phaser.GameObjects.Graphics | undefined;

  /**
   * Team mode: each player's name on the path at the handoff corner into their arc, a marker
   * at their arc's spawn, in their colour, and their own arc ready to stand out zoomed out.
   */
  private markArcs(): void {
    const d = this.driver;
    if (!d) return;
    const { map } = this.sim;
    const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    this.camera.asWorld(() => {
      const marks = this.add.graphics().setDepth(DEPTH.rings + 0.5);
      map.arcs.forEach((arc, k) => {
        const owner = arcOwner(d.match, this.view, k);
        const colour = PLAYER_COLOURS[owner % PLAYER_COLOURS.length]!;
        const corner = project(positionAt(map, arc.start).x, positionAt(map, arc.start).y);
        this.add
          .text(Math.round(corner.x), Math.round(corner.y) - 14, this.nameOf(owner), { fontFamily: FONT, fontSize: '13px', color: hex(colour), stroke: '#000000', strokeThickness: 3 })
          .setOrigin(0.5, 1)
          .setResolution(3)
          .setDepth(DEPTH.overlay);
        // The spawn: a ring and a point, D2 automap style, in the owner's colour
        const sp = positionAt(map, arc.spawn);
        const at = project(sp.x, sp.y);
        marks.lineStyle(2, colour, 0.9).strokeEllipse(at.x, at.y, 26, 13);
        marks.fillStyle(colour, 0.9).fillTriangle(at.x, at.y - 16, at.x - 5, at.y - 6, at.x + 5, at.y - 6);
      });
      // Your arc: its tiles tinted again and edged, shown when the camera is zoomed out
      const mine = map.arcs.findIndex((_, k) => arcOwner(d.match, this.view, k) === d.me);
      if (mine < 0) return;
      const g = (this.ownArc = this.add.graphics().setDepth(DEPTH.ground + 0.5).setVisible(false));
      const colour = PLAYER_COLOURS[d.me % PLAYER_COLOURS.length]!;
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (isBlocked(map, x, y) || arcAt(map, x, y) !== mine) continue;
          g.fillStyle(colour, 0.16).fillPoints(tileDiamond(x, y), true);
          g.lineStyle(1, colour, 0.45).strokePoints(tileDiamond(x, y), true);
        }
      }
    });
  }

  /**
   * Battle Mode: each lane's player named at its top in their colour, and the keep at the
   * back: the Worldstone, with Tyrael beside it.
   */
  private markLanes(): void {
    const d = this.driver;
    if (!d) return;
    const { map } = this.sim;
    const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    this.camera.asWorld(() => {
      map.arcs.forEach((arc, k) => {
        const owner = arcOwner(d.match, this.view, k);
        const colour = PLAYER_COLOURS[owner % PLAYER_COLOURS.length]!;
        const top = positionAt(map, arc.start + UNITS_PER_TILE);
        const at = project(top.x, top.y);
        const race = d.match.state.battle?.races[owner];
        const label = `${this.nameOf(owner)}${race ? `, ${this.gameData.classes[race]?.name ?? race}` : ''}`;
        this.keepParts.push(
          this.add.text(Math.round(at.x), Math.round(at.y) - 16, label, { fontFamily: FONT, fontSize: '13px', color: hex(colour), stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1).setResolution(3).setDepth(DEPTH.overlay),
        );
      });
    });
    this.drawKeep();
  }

  /** The keep where the lanes meet: Tyrael beside the Worldstone. */
  private drawKeep(): void {
    const { map } = this.sim;
    if (!map.king || !map.tyrael) return;
    this.camera.asWorld(() => {
      const k = project((map.king!.x + 0.5) * UNITS_PER_TILE, (map.king!.y + 0.5) * UNITS_PER_TILE);
      // The Worldstone stands in the baked battlefield; a drawn crystal stands in without it
      const baked = (this.cache.json.get(MAP_KEY) as MapManifest | undefined)?.battle !== undefined;
      const g = this.add.graphics().setDepth(DEPTH.units + k.y / 1000).setVisible(!baked);
      g.fillStyle(0x6040a0, 0.9).fillTriangle(k.x - 14, k.y, k.x + 14, k.y, k.x, k.y - 70);
      g.fillStyle(0xa080f0, 0.8).fillTriangle(k.x - 6, k.y - 4, k.x + 8, k.y - 4, k.x + 1, k.y - 60);
      g.lineStyle(2, 0xd0c0ff, 0.9).strokeTriangle(k.x - 14, k.y, k.x + 14, k.y, k.x, k.y - 70);
      this.keepParts.push(g);
      const t = project((map.tyrael!.x + 0.5) * UNITS_PER_TILE, (map.tyrael!.y + 0.5) * UNITS_PER_TILE);
      const key = monsterKey('tyrael1', 'normal');
      if (this.textures.exists(key)) {
        const s = this.sprite(key, Math.round(t.x), Math.round(t.y)).setDepth(DEPTH.units + t.y / 1000);
        const anim = this.modeKey(key, 'NU', 'sw');
        if (anim) s.play(anim);
        this.keepParts.push(s);
        this.tyraelSprite = s;
      }
    });
  }

  private tyraelSprite: Phaser.GameObjects.Sprite | undefined;
  /** Battlefield grounds asked for, so each loads once. */
  private battlefieldLoading = new Set<string>();
  /** Battle Mode: the workers standing in each lane's back row, by lane and slot; the sends seen queued. */
  private workerSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private queuedSeen = 0;

  /**
   * Battle Mode, every tick: each lane's workers in its back row, Tyrael striking, what
   * reached the Worldstone (its damage floating red over it), and a word when a send is
   * made at your lane.
   */
  private syncBattle(): void {
    const d = this.driver!;
    const sim = this.sim;
    const b = sim.state.battle!;
    const slots = sim.map.workerSlots ?? [];
    const hired = WORKER_ART.filter((k) => this.textures.exists(k));
    slots.forEach((spots, lane) => {
      const seat = sim.arcOwners[lane] ?? 0;
      const n = b.workers[seat] ?? 0;
      spots.forEach((spot, i) => {
        const id = `${lane}:${i}`;
        const key = hired.length ? hired[i % hired.length]! : this.textures.exists(WORKER_STAND_IN) ? WORKER_STAND_IN : undefined;
        const have = this.workerSprites.get(id);
        if (i >= n || !key) {
          have?.destroy();
          this.workerSprites.delete(id);
          return;
        }
        if (have) return;
        const at = project((spot.x + 0.5) * UNITS_PER_TILE, (spot.y + 0.5) * UNITS_PER_TILE);
        const s = this.sprite(key, Math.round(at.x), Math.round(at.y)).setDepth(DEPTH.units + at.y / 1000);
        const anim = this.modeKey(key, 'NU', i % 2 ? 'se' : 'sw');
        if (anim) s.play({ key: anim, startFrame: i % 3 });
        this.workerSprites.set(id, s);
      });
    });
    // Tyrael swings at what he strikes; the strike lands as a holy bolt's burst
    if (sim.tyraelHits?.length) this.sounds.battle('tyrael');
    if (sim.kingHits?.length && this.onOwnRing) this.sounds.battle('kingHit');
    for (const h of sim.tyraelHits ?? []) {
      const t = this.tyraelSprite;
      if (t) {
        const anim = this.modeKey(t.texture.key, 'A1', 'sw');
        if (anim) t.play(anim).once('animationcomplete', () => {
          const idle = this.modeKey(t.texture.key, 'NU', 'sw');
          if (idle && t.active) t.play(idle);
        });
      }
      this.effect('fistoftheheavensbolt', this.chest(h).x, this.chest(h).y);
    }
    const king = sim.map.king;
    for (const hit of sim.kingHits ?? []) {
      if (!king) break;
      const at = project((king.x + 0.5) * UNITS_PER_TILE, (king.y + 0.5) * UNITS_PER_TILE);
      const t = this.add.text(Math.round(at.x), Math.round(at.y) - 80, `-${hit.damage}`, { fontFamily: FONT, fontSize: '15px', color: '#ff5040', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1).setResolution(3).setDepth(DEPTH.effects);
      this.tweens.add({ targets: t, y: t.y - 24, alpha: 0, duration: 1200, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
    }
    // A send made at your own team's lanes, as it is queued
    const own = d.match.zones[ringOf(d.match, d.me)]!.state.battle!;
    if (own.queued.length < this.queuedSeen) this.queuedSeen = 0;
    for (; this.queuedSeen < own.queued.length; this.queuedSeen++) {
      const q = own.queued[this.queuedSeen]!;
      const send = d.match.data.battle?.rules.sends.find((x) => x.id === q.send);
      const target = slotOf(d.match, ringOf(d.match, d.me), d.match.zones[ringOf(d.match, d.me)]!.arcOwners[q.lane] ?? 0);
      const name = send?.name ?? (this.gameData.monsters[this.gameData.monsterVariant([send?.monster ?? ''].flat()[0]!, 0)]?.name ?? q.send);
      this.toast(`${this.nameOf(q.from)} sends ${name} down ${target === d.me ? 'your lane' : `${this.nameOf(target)}'s lane`}`);
      this.sounds.battle('send');
    }
  }

  /** Alone, the monsters' one spawn is marked on the ground until the first wave: the place to build near. */
  private markSpawn(): void {
    const sp = positionAt(this.sim.map, this.sim.map.arcs[0]!.spawn);
    const at = project(sp.x, sp.y);
    this.spawnLabel = this.camera.asWorld(() =>
      this.add.text(Math.round(at.x), Math.round(at.y) - 40, 'Monsters come from here\nbuild nearby', { fontFamily: FONT, fontSize: '9px', color: '#ff9080', align: 'center', backgroundColor: '#000000a0', padding: { x: 4, y: 2 } }).setOrigin(0.5, 1).setResolution(3).setDepth(DEPTH.overlay),
    );
    this.toast('Monsters come from the marked corner; build near it');
  }

  /** The tower whose auras are shown: the selected tower, or the one under the pointer. */
  private highlightedTower(): number | undefined {
    if (this.selection?.kind === 'tower') return this.selection.id;
    const h = this.hover;
    return h ? this.sim.state.towers.find((t) => t.tileX === h.x && t.tileY === h.y)?.id : undefined;
  }

  private tileAt(p: Phaser.Input.Pointer): { x: number; y: number } | undefined {
    if (this.d2 ? this.d2.covers(p.x, p.y) : p.y < HUD_HEIGHT || p.y >= PANEL_TOP) return undefined;
    if (this.inventory?.covers(p.x, p.y) || this.minimap.covers(p.x, p.y) || this.battleHud?.covers(p.x, p.y)) return undefined;
    const w = this.camera.worldPoint(p.x, p.y);
    return tileAtWorld(w.x, w.y);
  }

  /** True when the ring on screen is this player's own. */
  private get onOwnRing(): boolean {
    return !!this.driver && this.view === ringOf(this.driver.match, this.driver.me);
  }

  private onMapClick(p: Phaser.Input.Pointer): void {
    if (!this.driver || this.sim.state.status !== 'playing' || this.halted) return;
    if (this.inventory?.holding) return;
    const tile = this.tileAt(p);
    if (!tile) return;
    // Anyone's tower can be looked at; only your own arc's free tiles can be built on
    const tower = towerAt(this.sim, tile.x, tile.y);
    if (tower) this.selection = { kind: 'tower', id: tower.id };
    else if (this.onOwnRing && canBuild(this.sim, tile.x, tile.y, this.seat)) this.selection = { kind: 'tile', x: tile.x, y: tile.y };
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
    if (this.localBattle) {
      this.clearViews();
      this.driver = undefined;
      this.battleHud?.destroy();
      this.scene.stop('Pause');
      this.scene.start('Menu');
      return;
    }
    this.restartRun();
    this.scene.start('Menu');
  }

  /**
   * On the tick a new act's first wave starts: save the run (single player, or the host of
   * a multiplayer game), and show the act's map.
   */
  /**
   * The cow portal on the ring on screen: the red portal at the opener's spawn (opening, then
   * steady), its sound, Moo Moo Farm's map and music; all gone when the last cow dies.
   */
  private syncCowLevel(): void {
    const cow = this.sim.state.cow;
    if (!!cow === this.cowShown) return;
    this.cowShown = !!cow;
    this.sounds.cowLevel(!!cow);
    this.redrawGround();
    this.portal?.destroy();
    this.portal = undefined;
    if (!cow) return this.toast('The cow portal closes');
    this.toast('A red portal opens: the Secret Cow Level');
    const key = objectKey('redportal');
    if (!this.textures.exists(key)) return;
    const map = this.sim.map;
    const at = positionAt(map, map.arcs[arcOfSeat(this.sim, cow.opener)]!.spawn);
    const p = project(at.x, at.y);
    const meta = metaOf(this, key);
    this.portal = this.camera.asWorld(() => this.add.sprite(Math.round(p.x), Math.round(p.y), key).setOrigin(...originOf(meta)).setDepth(DEPTH.units + p.y / 1000));
    this.portal.play(animKey(key, 'OP', 's'));
    this.portal.once('animationcomplete', () => this.portal?.play(animKey(key, 'ON', 's')));
  }

  private atActBoundary(): void {
    const match = this.driver!.match;
    const ring = ringOf(match, this.driver!.me);
    const before = this.waveSeen;
    this.waveSeen = match.zones[ring]!.state.wave;
    if (this.waveSeen !== before) this.redrawGround();
    if (!this.saves || !actJustStarted(match, ring, before)) return;
    const launcher = this.registry.get('launcher') as LauncherApi | undefined;
    void saveCheckpoint(launcher, this.saves, takeCheckpoint(match, this.seed, this.driver!.log, ring));
    const wave = match.zones[ring]!.data.waves[this.waveSeen - 1]!;
    this.toast(`${stageName(wave.difficulty, wave.act)}: saved`);
  }

  /** The Escape menu over the game: paused in single player, running on underneath online. */
  private openMenu(): void {
    if (!this.scene.isActive() || this.scene.isActive('Pause')) return;
    const online = this.driver?.online === true;
    // An online game cannot stop for one player: the menu opens over it while it runs
    if (!online) this.scene.pause();
    this.scene.launch('Pause', { online });
  }

  private toggleInventory(): void {
    if (!this.inventory || !this.scene.isActive() || this.scene.isActive('Pause')) return;
    this.inventory.toggle();
  }

  /** Whether this player may save: single player, or the host of a multiplayer game. */
  get canSave(): boolean {
    return this.saves !== undefined && this.driver !== undefined;
  }

  /** The Escape menu's Save: the run as it stands, in the same slot the act boundaries use. */
  saveNow(): void {
    if (!this.canSave) return;
    const match = this.driver!.match;
    const ring = ringOf(match, this.driver!.me);
    const launcher = this.registry.get('launcher') as LauncherApi | undefined;
    void saveCheckpoint(launcher, this.saves!, takeCheckpoint(match, this.seed, this.driver!.log, ring));
    this.toast('Saved');
  }

  /** A fresh single-player run on the next seed: the end-of-run click and the pause menu's Restart. */
  restartRun(): void {
    // Everything the last run's towers wore comes home first
    if (this.driver) this.keeper?.leave(this.ownSim, this.seat);
    this.inventory?.hide();
    this.seed++;
    this.driver = new LocalDriver(this.gameData, this.seed);
    this.keeper?.begin((c) => this.issue(c));
    this.waveSeen = 0;
    this.redrawGround();
    this.clearViews();
    this.endOverlay.setVisible(false);
  }

  /** Drops every sprite so the next tick rebuilds the zone on screen from scratch. */
  private clearViews(): void {
    for (const s of this.workerSprites.values()) s.destroy();
    this.workerSprites.clear();
    this.lastTick = -1;
    this.selection = undefined;
    this.panelKey = '';
    for (const map of [this.monsters, this.towers, this.missiles, this.summons] as Map<number, { sprite?: Phaser.GameObjects.Sprite }>[]) {
      for (const v of map.values()) v.sprite?.destroy();
      map.clear();
    }
    for (const s of this.corpses.values()) s.destroy();
    this.corpses.clear();
    this.drops?.clear();
    this.portal?.destroy();
    this.portal = undefined;
    this.cowShown = false;
    this.corpseSeen.clear();
    this.cursesSeen.clear();
    this.fx?.clear();
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
    if (this.driver) this.keeper?.leave(this.ownSim, this.seat);
    void MpSession.of(this.registry.get('launcher') as LauncherApi).leave();
    this.clearViews();
    this.driver = undefined;
    this.scene.stop('Pause');
    this.scene.start('Menu');
  }

  /** FFA: show another player's ring. Building waits until you are back on your own. */
  private watch(ring: number): void {
    this.view = ring;
    this.clearViews();
    this.mapShown = '-';
    this.redrawGround();
    if (this.driver?.match.state.battle) {
      for (const o of this.keepParts) o.destroy();
      this.keepParts = [];
      this.tyraelSprite = undefined;
      this.markLanes();
    }
  }

  private nameOf(slot: number): string {
    return this.driver?.players.find((p) => p.slot === slot)?.name ?? `Player ${slot + 1}`;
  }

  override update(_time: number, delta: number): void {
    if (!this.driver) return;
    // Dev: ?speed=N runs N times as many ticks per frame (previews and the smoke test)
    const speed = (this.registry.get('speed') as number | undefined) ?? 1;
    this.camera.update(delta);
    // Zoomed out on a shared ring, your own arc stands out
    this.ownArc?.setVisible(this.camera.world.zoom <= 1);
    if (!this.halted) {
      this.driver.advance(delta, speed, () => {
        this.camera.asWorld(() => this.syncTick());
        this.atActBoundary();
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
    // The item panels are screen furniture: drawn by the UI camera, outside asWorld
    this.inventory?.sync();
    this.syncCowLevel();
    this.camera.asWorld(() => this.fx?.update());
    this.minimap.draw(this.sim, (arc) => this.arcColour(arc));
    this.drawPlayers();
  }

  /** FFA's player chips under the minimap, and the scoreboard while it is open. */
  private drawPlayers(): void {
    const d = this.driver;
    if (!d) return;
    const match = d.match;
    const colourOf = (slot: number) => PLAYER_COLOURS[slot % PLAYER_COLOURS.length]!;
    if (match.state.mode === 'ffa' && match.players > 1) {
      const chips = Array.from({ length: match.players }, (_, p) => ({
        label: `${p + 1} ${this.nameOf(p)} ${aliveOf(match, p)}/${aliveLimitOf(match.zones[p]!)}`,
        colour: colourOf(p),
        here: p === this.view,
        out: match.zones[p]!.state.status === 'lost',
      }));
      this.minimap.rings(chips, (p) => p !== this.view && this.watch(p));
    }
    if (this.scoreboard.visible && match.state.battle) {
      const b = match.state.battle;
      this.scoreboard.table(BATTLE_COLUMNS, battleRows(match, d.me, (slot) => this.nameOf(slot), colourOf), `${match.state.mode === 'coop' ? 'Co-op' : 'Battle'}: wave ${b.wave} of ${match.data.battle!.waves.length}`);
    } else if (this.scoreboard.visible) {
      const title = match.state.mode === 'ffa' ? 'Free for All' : match.state.mode === 'team' ? 'Party' : 'Score';
      this.scoreboard.update(scoreRows(match, d.me, (slot) => this.nameOf(slot), colourOf, (wave) => this.waveLabel(wave)), title);
    }
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
    const anim = this.anims.get(key);
    if (!anim) return;
    // Keep the step when only the facing changes; a mode with fewer frames starts within them
    const frame = keepFrame && s.anims.currentAnim && s.anims.currentFrame ? s.anims.currentAnim.frames.indexOf(s.anims.currentFrame) : 0;
    s.play({ key, startFrame: Math.min(Math.max(0, frame), anim.frames.length - 1) });
  }

  /** A one-shot effect (hit, impact) that removes itself when its animation ends. */
  private effect(missile: string, x: number, y: number, angle = 0): void {
    this.fx.play(missile, x, y, angle);
  }

  /** A sim point on screen, lifted to about chest height for effects. */
  private chest(p: Point): Point {
    const at = project(p.x, p.y);
    return { x: at.x, y: at.y - 30 };
  }

  private syncTick(): void {
    const s = this.sim.state;
    if (s.tick === this.lastTick) return;
    this.lastTick = s.tick;
    this.syncMonsters();
    this.syncTowers();
    this.syncMissiles();
    this.syncSummons();
    this.floatGold();
    if (this.battleHud) this.syncBattle();
    this.drops?.sync(this.sim.data.items, s.drops, this.seat, this.sim.state.lootFilters[this.seat] ?? 'default', this.altKey?.isDown === true);
    if (this.spawnLabel && s.wave >= 1) {
      this.spawnLabel.destroy();
      this.spawnLabel = undefined;
    }
    this.keeper?.sync(this.ownSim, this.seat);
  }

  /** Floating kill gold on screen now, oldest first, so a crowded wave never piles up hundreds. */
  private goldTexts: Phaser.GameObjects.Text[] = [];

  /**
   * A "+N" in D2's gold at each corpse, what that kill paid (gold find and Find Item
   * included): your kills on your ring, every kill on a ring you watch. Options turns it off.
   */
  private floatGold(): void {
    if (this.registry.get('goldNumbers') === false) return;
    for (const p of this.sim.paid) {
      if (this.onOwnRing && p.player !== this.seat) continue;
      const at = project(p.x, p.y);
      const t = this.add
        .text(Math.round(at.x), Math.round(at.y) - 28, `+${p.gold}`, { fontFamily: FONT, fontSize: '13px', color: GOLD_TEXT, stroke: '#000000', strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setResolution(3)
        .setDepth(DEPTH.effects);
      this.goldTexts.push(t);
      this.tweens.add({ targets: t, y: t.y - 18, alpha: 0, duration: 1100, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
    }
    this.goldTexts = this.goldTexts.filter((t) => t.active);
    while (this.goldTexts.length > MAX_GOLD_TEXTS) this.goldTexts.shift()!.destroy();
  }

  /** This player's own ring (in FFA the one on screen may be someone else's). */
  private get ownSim(): Sim {
    const match = this.driver!.match;
    return match.zones[ringOf(match, this.driver!.me)]!;
  }

  /** What the inventory and stash panels need from the game. */
  private itemHost(): ItemPanelHost {
    const scene = this;
    const names = Object.fromEntries(Object.entries(this.gameData.skillIds).map(([name, id]) => [id, name]));
    return {
      data: this.gameData.items,
      sim: () => (scene.driver ? scene.ownSim : undefined),
      seat: () => scene.seat,
      tower: () => {
        const sel = scene.selection;
        if (!scene.driver || sel?.kind !== 'tower' || !scene.onOwnRing) return undefined;
        const t = towerById(scene.sim, sel.id);
        return t && t.owner === scene.seat ? t : undefined;
      },
      issue: (c) => scene.issue(c),
      get keeper() {
        return scene.keeper!;
      },
      skillName: (p) => names[p] ?? p,
      get conversions() {
        return scene.sim.data.itemConversions;
      },
      get procs() {
        return scene.sim.data.itemProcs;
      },
      get qualityPct() {
        return scene.sim.data.itemQualityPct;
      },
      sound: (n) => scene.sounds.item(n),
      toast: (t) => scene.toast(t),
      others: () => (scene.driver?.online ? scene.driver.players.filter((p) => p.slot !== scene.driver!.me) : []),
      trade: () => {
        const d = scene.driver;
        const t = d && tradeOf(d.match, d.me);
        if (!d || !t) return undefined;
        const mine = t.a === d.me ? 0 : 1;
        const other = mine === 0 ? t.b : t.a;
        const side = (player: number, k: 0 | 1) => {
          const zone = d.match.zones[ringOf(d.match, player)]!;
          const inv = zone.state.inventories[seatOf(d.match, player)] ?? [];
          const s = t.sides[k];
          return {
            name: d.players.find((p) => p.slot === player)?.name ?? `Player ${player + 1}`,
            items: s.items.flatMap((u) => inv.find((i) => i.item.uid === u)?.item ?? []),
            gold: s.gold,
            accepted: s.accepted,
          };
        };
        return { mine: side(d.me, mine as 0 | 1), theirs: side(other, (1 - mine) as 0 | 1) };
      },
    };
  }

  private syncMonsters(): void {
    const s = this.sim.state;
    const alive = new Set<number>();
    const riders = new Set<string>();
    /** Each curse skill marks one freshly cursed spot per tick with its area art. */
    const freshCurse = new Map<string, Point>();
    for (const m of s.monsters) {
      alive.add(m.id);
      const { x: px, y: py } = project(m.x, m.y);
      let view = this.monsters.get(m.id);
      if (!view) {
        const def = this.sim.data.monsters[m.def]!;
        const texture = monsterKey(def.base, m.rank, def.artVariant);
        if (!this.textures.exists(texture)) continue;
        view = { sprite: this.sprite(texture, px, py), texture, def: m.def, x: m.x, y: m.y, facing: 's', mode: '' };
        this.monsters.set(m.id, view);
      }
      const moved = m.x !== view.x || m.y !== view.y;
      if (moved) {
        const v = screenVector(m.x - view.x, m.y - view.y);
        view.facing = facingFromVector(v.x, v.y);
      }
      // Standing still and not stunned, frozen or casting means it is fighting a blocker
      const held = m.stunTicks > 0 || m.freezeTicks > 0 || m.castTicks > 0;
      const mode = moved ? 'WL' : held ? view.mode || 'WL' : 'A1';
      if (mode === 'A1' && view.mode === 'A1' && !view.sprite.anims.isPlaying) view.sprite.play(animKey(view.texture, 'A1', view.facing));
      this.playIfChanged(view.sprite, animKey(view.texture, mode, view.facing), mode === 'WL');
      if (m.stunTicks > 0 || m.freezeTicks > 0) view.sprite.anims.pause();
      else if (view.sprite.anims.isPaused) view.sprite.anims.resume();
      view.mode = mode;
      view.x = m.x;
      view.y = m.y;
      const depth = DEPTH.units + py / 1000;
      view.sprite.setPosition(Math.round(px), Math.round(py)).setDepth(depth);
      // Cold shows blue (frozen deeper than chilled), poison green
      const slowed = (this.sim.fx.monsters[m.id]?.slowPct ?? 0) > 0 || m.slowPct > 0 || m.chillTicks > 0;
      const tint = m.freezeTicks > 0 ? FROZEN_TINT : slowed ? CHILL_TINT : m.poisonTicks > 0 ? POISON_TINT : undefined;
      if (tint !== undefined) view.sprite.setTint(tint);
      else view.sprite.clearTint();

      // The first curse it carries rides on it as its overlay.txt effect; frozen shows ice
      const key = `m${m.id}`;
      riders.add(key);
      const curse = m.curses[0];
      this.fx.ride(key, curse ? SKILL_ART[baseSkillId(curse.skill)]?.overlay : undefined, { x: px, y: py }, depth + 0.0005);
      riders.add(`${key}f`);
      this.fx.ride(`${key}f`, m.freezeTicks > 0 ? STATUS_OVERLAYS.frozen : undefined, { x: px, y: py }, depth + 0.0004);
      const before = this.cursesSeen.get(m.id);
      for (const c of m.curses) if (!before?.has(baseSkillId(c.skill)) && !freshCurse.has(baseSkillId(c.skill))) freshCurse.set(baseSkillId(c.skill), { x: px, y: py });
      this.cursesSeen.set(m.id, new Set(m.curses.map((c) => baseSkillId(c.skill))));
    }
    for (const [skill, at] of freshCurse) {
      const art = SKILL_ART[skill]?.area;
      if (art) this.effect(art, at.x, at.y);
    }
    for (const id of this.cursesSeen.keys()) if (!alive.has(id)) this.cursesSeen.delete(id);

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
      this.sounds.death(this.sim.data.monsters[view.def]?.base ?? baseMonsterId(view.def));
      this.sounds.gold();
      view.sprite.clearTint().setDepth(DEPTH.corpses);
      view.sprite.anims.resume();
      // D2's death (a boss's long one: Diablo's and Baal's have one direction only)
      const dying = this.modeKey(view.texture, 'DT', view.facing);
      if (dying) view.sprite.play(dying);
      // Then the body on the ground (D2's DD mode), held until the corpse goes
      const dead = this.modeKey(view.texture, 'DD', view.facing) ?? '';
      view.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (view.sprite.active && this.anims.exists(dead)) view.sprite.play(dead);
      });
      this.corpses.set(corpse.id, view.sprite);
    }

    // A corpse gone before it rotted was taken: Corpse Explosion bursts it, Revive raises it
    // (its summon shows that), a Fallen Shaman raises it (its monster shows that)
    const corpseIds = new Set(s.corpses.map((c: Corpse) => c.id));
    const exploders = this.actedThisTick.filter((t) => activeSkill(this.sim, t)?.skill.archetype === 'corpse');
    for (const [id, seen] of this.corpseSeen) {
      if (corpseIds.has(id)) continue;
      this.corpseSeen.delete(id);
      if (seen.ticksLeft <= 1 || exploders.length === 0) continue;
      const near = exploders.find((t) => (t.x - seen.x) ** 2 + (t.y - seen.y) ** 2 <= (activeSkill(this.sim, t)!.skill.rangeUnits + 200) ** 2);
      if (!near) continue;
      const art = SKILL_ART[baseSkillId(activeSkill(this.sim, near)!.skill.id)];
      const at = project(seen.x, seen.y);
      if (art?.corpse) this.effect(art.corpse, at.x, at.y);
      for (const a of art?.impact ?? []) this.effect(a, at.x, at.y);
    }
    for (const c of s.corpses) this.corpseSeen.set(c.id, { x: c.x, y: c.y, ticksLeft: c.ticksLeft });
    for (const [id, sprite] of this.corpses) {
      if (!corpseIds.has(id)) {
        this.corpses.delete(id);
        // A death still playing (Baal's runs past the corpse's ten seconds) finishes first
        if (sprite.active && sprite.anims.isPlaying && sprite.anims.currentAnim?.key.includes('|DT|')) {
          sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
        } else sprite.destroy();
      }
    }
    // Towers under Enchant: a faint ember on the weapon all the time, and the full flame
    // only now and then, so the tower stays readable; and every rider of a unit that is gone
    const enchant = SKILL_ART['enchant']?.overlay;
    for (const t of s.towers) {
      if ((this.sim.fx.towers[t.id]?.fireMax ?? 0) <= 0 || !enchant) continue;
      const key = `t${t.id}`;
      riders.add(key);
      const at = project(t.x, t.y);
      const depth = DEPTH.units + at.y / 1000 + 0.0005;
      this.fx.ride(key, enchant, { x: at.x + ENCHANT_HAND.x, y: at.y + ENCHANT_HAND.y }, depth, { scale: 0.22, alpha: 0.35 });
      if ((s.tick + t.id * 37) % ENCHANT_FLARE_TICKS === 0) this.fx.overlayOnce(enchant, at, depth, 0.5);
    }
    // The selected or hovered aura tower: D2's aura glow on every tower its auras reach
    const lit = this.highlightedTower();
    const source = lit !== undefined ? towerById(this.sim, lit) : undefined;
    if (source) {
      for (const aura of projected(this.sim, source)) {
        const overlay = SKILL_ART[aura.skill]?.overlay;
        if (!overlay || !helps(aura)) continue;
        for (const { tower } of reachOf(this.sim, source, aura)) {
          const key = `ta${tower.id}.${aura.skill}`;
          riders.add(key);
          const at = project(tower.x, tower.y);
          this.fx.ride(key, overlay, at, DEPTH.units + at.y / 1000 + 0.0006);
        }
      }
    }
    this.fx.keepRiders(riders);
  }

  private nearestMonster(from: { x: number; y: number }, range: number, skip: number[] = []): Monster | undefined {
    let best: Monster | undefined;
    let bestD = range * range;
    for (const m of this.sim.state.monsters) {
      if (m.hp <= 0 || skip.includes(m.id)) continue;
      const d = (m.x - from.x) ** 2 + (m.y - from.y) ** 2;
      if (d <= bestD) {
        best = m;
        bestD = d;
      }
    }
    return best;
  }

  /** Towers whose skill (or evolved partner skill) acted on the tick being drawn. */
  private actedThisTick: Tower[] = [];

  /** Worn looks asked for, loaded or failed, so each is requested once. */
  private gearLooks = new Map<string, 'loading' | 'ready' | 'failed'>();

  /**
   * The texture of a tower's worn weapon and shield, once loaded; the first sight of a pair
   * asks for it (the app composites it from the game files) and the line's own look stands
   * in until it arrives.
   */
  private wornLook(t: Tower): string | undefined {
    const gear = heroGearOf(t);
    if (!gear) return undefined;
    const state = this.gearLooks.get(gear.key);
    if (state === 'ready') return gear.key;
    if (state) return undefined;
    this.gearLooks.set(gear.key, 'loading');
    this.load.multiatlas(gear.key, gear.json, gear.dir);
    this.load.once(`filecomplete-multiatlas-${gear.key}`, () => {
      createAnimations(this);
      this.gearLooks.set(gear.key, 'ready');
    });
    const failed = (file: Phaser.Loader.File) => {
      if (file.key !== gear.key) return;
      this.gearLooks.set(gear.key, 'failed');
      this.load.off('loaderror', failed);
    };
    this.load.on('loaderror', failed);
    this.load.start();
    return undefined;
  }

  /** The last cooldowns seen of each legend rider, to tell when it acted. */
  private riders = new Map<number, { cooldown: number; partnerCooldown: number }>();

  private syncTowers(): void {
    const s = this.sim.state;
    const seen = new Set<number>();
    this.actedThisTick = [];
    // A legend's riders have no figure of their own: their casts show at the legend, first,
    // so the legend knows to swing
    for (const t of s.towers) {
      if (t.legendOf !== undefined) {
        const was = this.riders.get(t.id);
        this.riders.set(t.id, { cooldown: t.cooldown, partnerCooldown: t.partnerCooldown });
        if (!was) continue;
        const acted = t.cooldown > was.cooldown;
        if (acted || t.partnerCooldown > was.partnerCooldown) this.actedThisTick.push(t);
        const active = acted ? activeSkill(this.sim, t) : undefined;
        if (active) this.castEffects(t, active.skill.id, active.lvl);
        if (t.partnerCooldown > was.partnerCooldown && t.partnerSkill) this.castEffects(t, t.partnerSkill, t.partnerLevel);
      }
    }
    for (const t of s.towers) {
      if (t.legendOf !== undefined) continue;
      seen.add(t.id);
      const { x: px, y: py } = project(t.x, t.y);
      const legend = t.legend ? this.sim.data.legends.find((l) => l.id === t.legend) : undefined;
      const texture = legend ? monsterKey(legend.monster, 'normal') : (this.wornLook(t) ?? heroKey(t));
      let view = this.towers.get(t.id);
      if (view && view.texture !== texture) {
        view.sprite.destroy();
        view = undefined;
      }
      if (!view) {
        if (!this.textures.exists(texture)) continue;
        view = { sprite: this.sprite(texture, px, py), texture, facing: 's', cooldown: t.cooldown, partnerCooldown: t.partnerCooldown };
        this.towers.set(t.id, view);
      }
      const target = this.nearestMonster(t, FACE_RANGE);
      if (target) {
        const v = screenVector(target.x - t.x, target.y - t.y);
        view.facing = facingFromVector(v.x, v.y);
      }
      // The cooldown jumping back up means the tower acted this tick
      const acted = t.cooldown > view.cooldown;
      const partnerActed = t.partnerCooldown > view.partnerCooldown;
      view.cooldown = t.cooldown;
      view.partnerCooldown = t.partnerCooldown;
      const attack = legend ? 'A1' : heroAttackMode(t.cls);
      // A legend swings when any of its three acts; an NPC with no attack of its own stands
      const ridersActed = legend ? this.actedThisTick.some((r) => r.legendOf === t.id) : false;
      const stand = this.modeKey(texture, 'NU', view.facing) ?? animKey(texture, 'NU', view.facing);
      if (acted || partnerActed || ridersActed) {
        if (acted || partnerActed) this.actedThisTick.push(t);
        const swing = this.modeKey(texture, attack, view.facing);
        // Three towers act often: a legend finishes one swing before the next
        const swinging = legend && view.sprite.anims.isPlaying && view.sprite.anims.currentAnim?.key === swing;
        if (swing && !swinging) {
          view.sprite.play(swing);
          view.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => view!.sprite.play(stand));
        }
      } else if (!view.sprite.anims.isPlaying || view.sprite.anims.currentAnim?.key.includes('|NU|')) {
        this.playIfChanged(view.sprite, stand, true);
      }
      if (acted) {
        const active = activeSkill(this.sim, t);
        if (active) this.castEffects(t, active.skill.id, active.lvl);
        this.meleeHit(t);
      }
      if (partnerActed && t.partnerSkill) this.castEffects(t, t.partnerSkill, t.partnerLevel);
      view.sprite.setPosition(px, py).setDepth(DEPTH.units + py / 1000).setAlpha(t.line ? 1 : 0.55);
    }
    for (const [id, view] of this.towers) {
      if (!seen.has(id)) {
        view.sprite.destroy();
        this.towers.delete(id);
      }
    }
  }

  /**
   * What a tower's cast looks like when the skill leaves no missile: the cast art at the
   * tower, Chain Lightning's arcs from target to target, Static Field's burst.
   */
  private castEffects(t: Tower, skillId: string, lvl: number): void {
    this.sounds.cast(baseSkillId(skillId));
    const skill = this.sim.data.skills[skillId];
    const art = SKILL_ART[baseSkillId(skillId)];
    if (!skill || !art) return;
    const at = project(t.x, t.y);
    if (art.cast) this.effect(art.cast, at.x, at.y);
    if (art.castOverlay) this.fx.overlayOnce(art.castOverlay, at, DEPTH.units + at.y / 1000 + 0.0007);
    if (skill.archetype === 'pierce' && skill.mode === 'chain' && art.arc) {
      // The sim jumps from the target to the nearest monster not hit yet; draw the same
      const { hops, jumpUnits } = (skill as PierceDef).levels[lvl]!;
      const hit: number[] = [];
      const points: Point[] = [{ x: at.x, y: at.y - 50 }];
      let current = this.nearestMonster(t, skill.rangeUnits);
      for (let hop = 0; current && hop <= hops; hop++) {
        hit.push(current.id);
        const p = this.chest(current);
        points.push(p);
        current = this.nearestMonster(current, jumpUnits, hit);
      }
      // D2's chain: its LightningStrike cel along every jump
      this.fx.strikeTrail(art.arc, points);
    } else if (skill.archetype === 'control' && skill.mode === 'aura' && art.swirl?.length) {
      // Hurricane: its client missiles swirl round the tower, D2's swoosh, rocks and trees
      const r = ellipseOf(skill.levels[lvl]!.radiusUnits);
      const ms = Math.max(400, skill.pulseTicks * TICK_MS);
      for (let i = 0; i < 6; i++) {
        const k = 0.45 + Math.random() * 0.55;
        this.fx.orbit(art.swirl[i % art.swirl.length]!, { x: at.x, y: at.y - 30 }, (r.w / 2) * k, (r.h / 2) * k, ms, Math.random() * Math.PI * 2);
      }
    } else if (skill.archetype === 'debuff' && skill.mode === 'pulse') {
      const radius = (skill as DebuffDef).levels[lvl]!.radiusUnits;
      const r = ellipseOf(radius);
      // The field's edge in D2's lightning art, then a strike on everything it took from
      if (art.arc) {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.effect(art.arc, at.x + (Math.cos(a) * r.w) / 2, at.y + (Math.sin(a) * r.h) / 2 + 30);
        }
      }
      const struck = this.sim.state.monsters.filter((m) => m.hp > 0 && (m.x - t.x) ** 2 + (m.y - t.y) ** 2 <= radius * radius).slice(0, 6);
      for (const m of struck) {
        const p = this.chest(m);
        if (art.arc) this.effect(art.arc, p.x, p.y + 30);
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
    for (const m of SKILL_ART[hit]?.impact ?? []) this.effect(m, at.x, at.y - 15, angle);
  }

  /**
   * Missiles in flight, by their skill's art: the flying missile; Meteor falling onto its
   * mark; Blizzard's shards over its zone; Frozen Orb spraying shards; Poison Nova's ring;
   * Lightning drawn along its line. Where one ends, its missiles.txt explosion and the
   * skill's impact art play.
   */
  private syncMissiles(): void {
    const s = this.sim.state;
    const seen = new Set<number>();
    for (const m of s.missiles) {
      seen.add(m.id);
      const skill = this.sim.data.skills[m.skill];
      const art = SKILL_ART[baseSkillId(m.skill)];
      if (!skill || !art) continue;
      const { x: px, y: py } = project(m.x, m.y);
      let view = this.missiles.get(m.id);
      if (!view) {
        const texture = art.fly ? missileKey(art.fly) : '';
        let sprite: Phaser.GameObjects.Sprite | undefined;
        if (texture && this.textures.exists(texture)) {
          sprite = this.sprite(texture, px, py).setDepth(DEPTH.effects);
          if ((metaOf(this, texture).blend ?? 0) > 0) sprite.setBlendMode(Phaser.BlendModes.ADD);
        }
        view = { sprite, x: m.x, y: m.y, skill: baseSkillId(m.skill), art: art.fly ?? '', age: 0 };
        if (art.fly) this.sounds.travel(art.fly);
        this.missiles.set(m.id, view);
        if (art.fall) this.fx.fall(art.fall, { x: px, y: py }, m.ticksLeft * TICK_MS, () => undefined);
        if (art.ring && skill.archetype === 'splash') {
          // The nova's ring: missiles thrown outward to its edge over its life
          const r = ellipseOf(skill.levels[m.level]?.radiusUnits ?? skill.radiusUnits);
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            this.fx.shoot(art.ring, { x: px, y: py - 20 }, { x: px + (Math.cos(a) * r.w) / 2, y: py - 20 + (Math.sin(a) * r.h) / 2 }, m.ticksLeft * TICK_MS, Math.round((i / 16) * 64 + 16) % 64);
          }
          this.sounds.travel(art.ring);
        }
      }
      view.age++;
      if (art.zone && skill.archetype === 'zone' && view.age % 2 === 0) {
        // Shards falling at random spots inside the zone
        const r = ellipseOf(skill.levels[m.level]?.radiusUnits ?? skill.radiusUnits);
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random());
        this.effect(art.zone, px + (Math.cos(a) * d * r.w) / 2, py + (Math.sin(a) * d * r.h) / 2);
        if (view.age % 10 === 0) this.sounds.travel(art.zone);
      }
      if (art.shards && view.age % 2 === 0) {
        // The orb throws shards out in a turning spiral, as D2's Frozen Orb does
        const a = view.age * 0.7;
        const to = { x: px + Math.cos(a) * 110, y: py - 20 + Math.sin(a) * 55 };
        this.fx.shoot(art.shards, { x: px, y: py - 20 }, to, 260, Math.round(((a / (Math.PI * 2)) * 64 + 16) % 64 + 64) % 64);
      }
      if (art.bolt) {
        // The bolt grows along its line as the missile flies: D2's strikes laid on each new stretch
        const from = view.boltAt ?? (() => {
          const o = project(m.ox, m.oy);
          return { x: o.x, y: o.y - 50 };
        })();
        const to = { x: px, y: py - 30 };
        if (Math.hypot(to.x - from.x, to.y - from.y) >= 20) {
          this.fx.strikeTrail(art.bolt, [from, to], 26, 0);
          view.boltAt = to;
        } else view.boltAt = from;
      }
      if (view.sprite) {
        const texture = view.sprite.texture.key;
        const meta = metaOf(this, texture);
        const v = screenVector(m.x - view.x, m.y - view.y);
        const dir = String(spriteDirection(angle64(v.x, v.y), meta.dccDirections ?? 1));
        this.playIfChanged(view.sprite, animKey(texture, 'MS', dir), true);
        view.sprite.setPosition(px, py);
      }
      view.x = m.x;
      view.y = m.y;
    }
    for (const [id, view] of this.missiles) {
      if (seen.has(id)) continue;
      const art = SKILL_ART[view.skill];
      const at = project(view.x, view.y);
      if (view.art) this.sounds.hit(view.art);
      const ex = view.art ? this.fx.explosionOf(view.art) : undefined;
      if (ex) this.effect(ex, at.x, at.y - 15);
      for (const a of art?.impact ?? []) this.effect(a, at.x, at.y - 10);
      // Fist of the Heavens: its holy bolts fly from the strike to the monsters around it
      const skill = this.sim.data.skills[view.skill];
      if (art?.burst && skill?.archetype === 'splash') {
        const reach = skill.levels[skill.levels.length - 1]!.subRadiusUnits || skill.radiusUnits;
        const around = this.sim.state.monsters.filter((mm) => mm.hp > 0 && (mm.x - view.x) ** 2 + (mm.y - view.y) ** 2 <= reach * reach).slice(0, 8);
        for (const mm of around) {
          const to = this.chest(mm);
          const v = screenVector(mm.x - view.x, mm.y - view.y);
          this.fx.shoot(art.burst, { x: at.x, y: at.y - 30 }, to, 260, angle64(v.x, v.y));
        }
      }
      view.sprite?.destroy();
      this.missiles.delete(id);
    }
  }

  /**
   * Summons: skeletons and mages in the art the player has (necroskeleton, necromage),
   * rising out of the ground when raised; a revived monster in its own art, pale. They face
   * the nearest monster, attack when their attack comes round, and mages throw their
   * element's missile.
   */
  private syncSummons(): void {
    const s = this.sim.state;
    const seen = new Set<number>();
    for (const u of s.summons) {
      seen.add(u.id);
      const { x: px, y: py } = project(u.x, u.y);
      let view = this.summons.get(u.id);
      if (!view) {
        const base = this.sim.data.monsters[u.def]?.base ?? u.def;
        const hero = SUMMON_HEROES[base];
        const texture = hero ? heroKey({ cls: hero.cls, line: hero.line, tier: MAX_TIER, evolved: '' }) : monsterKey(base, 'normal');
        if (!this.textures.exists(texture)) continue;
        const sprite = this.sprite(texture, px, py);
        if (hero) sprite.setTint(hero.tint).setAlpha(hero.alpha);
        if (u.kind === 'revive') {
          sprite.setTint(REVIVED_TINT);
          const raise = SKILL_ART['revive']?.raise;
          if (raise) this.effect(raise, px, py);
        }
        view = { sprite, texture, facing: 'n', cooldown: u.cooldown };
        this.summons.set(u.id, view);
        // Raised skeletons and mages climb out of the ground (D2's S1)
        // (a sentry trap is drawn in one facing: modeKey finds it)
        const rise = this.modeKey(texture, 'S1', view.facing);
        if (rise) sprite.play(rise);
        else this.playIfChanged(sprite, this.modeKey(texture, 'NU', view.facing) ?? '', false);
      }
      const target = s.monsters.find((m) => m.id === u.targetId && m.hp > 0) ?? this.nearestMonster(u, UNITS_PER_TILE * 4);
      if (target) {
        const v = screenVector(target.x - u.x, target.y - u.y);
        view.facing = facingFromVector(v.x, v.y);
      }
      const attacked = u.cooldown > view.cooldown;
      view.cooldown = u.cooldown;
      const rising = view.sprite.anims.currentAnim?.key.includes('|S1|') && view.sprite.anims.isPlaying;
      if (attacked && target) {
        const swing = this.modeKey(view.texture, 'A1', view.facing);
        if (swing) view.sprite.play(swing);
        if (u.kind === 'ranged') {
          const bolt = SUMMON_BOLTS[u.element];
          const v = screenVector(target.x - u.x, target.y - u.y);
          if (bolt) this.fx.shoot(bolt, { x: px, y: py - 40 }, this.chest(target), 220, angle64(v.x, v.y));
        }
      } else if (!rising && !view.sprite.anims.currentAnim?.key.includes('|A1|')) {
        this.playIfChanged(view.sprite, this.modeKey(view.texture, 'NU', view.facing) ?? '', true);
      } else if (!rising && !view.sprite.anims.isPlaying) {
        this.playIfChanged(view.sprite, this.modeKey(view.texture, 'NU', view.facing) ?? '', false);
      }
      // A monster that broke through shoved it: it stumbles aside and back
      const shove = u.shovedTicks > 0 ? Math.round((SHOVE_PX * u.shovedTicks) / 10) : 0;
      view.sprite.setPosition(px + shove, py).setDepth(DEPTH.units + py / 1000);
    }
    for (const [id, view] of this.summons) {
      if (seen.has(id)) continue;
      this.summons.delete(id);
      // A fallen summon plays its death where it has one
      const death = this.modeKey(view.texture, 'DT', view.facing) ?? '';
      if (!this.anims.exists(death)) {
        view.sprite.destroy();
        continue;
      }
      view.sprite.play(death);
      view.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => view.sprite.destroy());
    }
  }

  // ---- shapes that stay shapes: ground, rings, bars ----

  /**
   * The ring as flat tiles until its art is baked: dirt on the path, dark scenery, grass
   * where towers go, each arc's grass edged in the colour of the player who defends it.
   */
  private drawGround(): void {
    const g = (this.groundGfx ??= this.add.graphics().setDepth(DEPTH.ground)).clear();
    const { map } = this.sim;
    const stage = this.stage();
    this.stageText?.setText(stage.label);
    if (this.drawBakedMap(stage)) {
      // On a shared ring each arc is tinted in its owner's colour, path and free tiles alike
      if (this.sim.players > 1) {
        for (let y = 0; y < map.height; y++) {
          for (let x = 0; x < map.width; x++) {
            if (isBlocked(map, x, y)) continue;
            const colour = this.arcColour(arcAt(map, x, y));
            g.fillStyle(colour, isPathTile(map, x, y) ? 0.1 : 0.12).fillPoints(tileDiamond(x, y), true);
            if (!isPathTile(map, x, y)) g.lineStyle(1, colour, 0.18).strokePoints(tileDiamond(x, y), true);
          }
        }
      }
      return;
    }
    const grass = GREY_BOX[stage.lair ? 1 : 0];
    const darker = Phaser.Display.Color.IntegerToColor(grass).darken(8).color;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const path = isPathTile(map, x, y);
        const blocked = isBlocked(map, x, y);
        g.fillStyle(path ? 0x6a5a3a : blocked ? 0x1c2416 : (x + y) % 2 ? darker : grass);
        g.fillPoints(tileDiamond(x, y), true);
        if (!path && !blocked) g.lineStyle(1, this.arcColour(arcAt(map, x, y)), 0.18).strokePoints(tileDiamond(x, y), true);
      }
    }
  }

  /**
   * The map the ring on screen shows: the act of its last wave started (Act 1 before the
   * first), in its boss lair while that act's final wave is out.
   */
  private stage(): { act: number; lair: boolean; cow?: boolean; label: string } {
    const s = this.sim.state;
    if (this.driver?.match.state.battle) return { act: 5, lair: false, label: KEEP_NAMES[this.view] ?? '' };
    const wave = this.sim.data.waves[Math.max(0, s.wave - 1)];
    // The Secret Cow Level is Moo Moo Farm, an Act 1 field, while its portal is open
    if (s.cow) return { act: 1, lair: false, cow: true, label: 'Moo Moo Farm' };
    const act = wave?.act ?? 1;
    const lair = s.wave > 0 && wave?.final === true;
    const info = this.sim.data.acts[act - 1];
    const place = info ? (lair ? info.lair : info.field) : '';
    return { act, lair, label: `${stageName(wave?.difficulty ?? 0, act)}: ${place}` };
  }

  /**
   * The act's baked map for the stage (its field, or its boss lair on the final wave), its
   * scenery depth-sorted with the units. False when the act has no art (or none was
   * extracted), and the grey box shows instead.
   */
  private drawBakedMap(stage: { act: number; lair: boolean; cow?: boolean }): boolean {
    const manifest = this.cache.json.get(MAP_KEY) as MapManifest | undefined;
    // A battlefield is drawn on its own ground, never an act's ring
    if (this.sim.map.open) return this.drawBattlefield(manifest);
    const name = stage.cow ? 'cow' : stage.lair ? 'lair' : 'field';
    const baked = manifest?.acts[String(stage.act)]?.[name];
    const key = groundKey(stage.act, name);
    const want = baked && this.textures.exists(key) ? key : '';
    if (want === this.mapShown) return want !== '';
    for (const o of this.mapParts) o.destroy();
    this.mapParts = [];
    this.mapShown = want;
    if (!baked || !want || !manifest) return false;
    // The bake's world origin and ours line up unless the layout changed since
    const ground = this.add.image(ORIGIN.x - baked.ground.originX, ORIGIN.y - baked.ground.originY, key).setOrigin(0).setDepth(DEPTH.ground - 0.5);
    this.mapParts.push(ground);
    for (const obj of baked.objects) {
      const prefab = manifest.prefabs[obj.prefab];
      if (!prefab || !this.textures.exists(sceneryKey(obj.prefab))) continue;
      const p = project(obj.at[0]! * UNITS_PER_TILE, obj.at[1]! * UNITS_PER_TILE);
      const img = this.add.image(Math.round(p.x), Math.round(p.y), sceneryKey(obj.prefab));
      img.setOrigin(prefab.anchorX / img.width, prefab.anchorY / img.height).setDepth(DEPTH.units + p.y / 1000);
      this.mapParts.push(img);
    }
    return true;
  }

  /**
   * A battlefield's baked ground and scenery (the extraction's map/battle-<keep>-<lanes>):
   * its team's keep, for its lane count. Its ground image loads the first time it is shown;
   * false (the grey box) until then, or without the art.
   */
  private drawBattlefield(manifest: MapManifest | undefined): boolean {
    const keep = BATTLE_KEEPS[this.view];
    const baked = keep ? manifest?.battle?.[keep]?.[String(this.sim.map.arcs.length)] : undefined;
    const key = groundKey(`battle-${keep}`, String(this.sim.map.arcs.length));
    const want = baked && this.textures.exists(key) ? key : '';
    if (baked && !want && !this.battlefieldLoading.has(key)) {
      // Load it now and draw again once it is in
      this.battlefieldLoading.add(key);
      this.load.image(key, baked.ground.image);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.mapShown = '-';
        this.redrawGround();
      });
      this.load.start();
    }
    if (want === this.mapShown) return want !== '';
    for (const o of this.mapParts) o.destroy();
    this.mapParts = [];
    this.mapShown = want;
    if (!baked || !manifest || !want) return false;
    this.mapParts.push(this.add.image(ORIGIN.x - baked.ground.originX, ORIGIN.y - baked.ground.originY, key).setOrigin(0).setDepth(DEPTH.ground - 0.5));
    for (const obj of baked.objects) {
      const prefab = manifest.prefabs[obj.prefab];
      if (!prefab || !this.textures.exists(sceneryKey(obj.prefab))) continue;
      const p = project(obj.at[0]! * UNITS_PER_TILE, obj.at[1]! * UNITS_PER_TILE);
      const img = this.add.image(Math.round(p.x), Math.round(p.y), sceneryKey(obj.prefab));
      img.setOrigin(prefab.anchorX / img.width, prefab.anchorY / img.height).setDepth(DEPTH.units + p.y / 1000);
      this.mapParts.push(img);
    }
    return true;
  }

  /** The ring on screen changed (FFA watching): redraw its ground. */
  private redrawGround(): void {
    this.camera.asWorld(() => this.drawGround());
  }

  private drawOverlay(): void {
    const { state, fx } = this.sim;
    const g = this.overlayGfx.clear();
    const rings = this.ringGfx.clear();
    const selected = this.selection?.kind === 'tower' ? this.selection.id : undefined;
    const highlight = this.highlightedTower();

    // Base rings in the tower's line colour; evolved towers ring purple
    for (const t of state.towers) {
      const colour = t.evolved ? EVOLVED_COLOUR : (LINE_COLOURS[t.line] ?? 0x707070);
      const { x: cx, y: cy } = project(t.x, t.y);
      rings.fillStyle(colour, 0.35).fillEllipse(cx, cy, ISO_W * 0.7, ISO_H * 0.7);
      rings.lineStyle(t.id === selected ? 3 : 2, colour, t.id === selected ? 1 : 0.8).strokeEllipse(cx, cy, ISO_W * 0.7, ISO_H * 0.7);
    }

    // Aura rings: faint for every emitter, bright for the selected or hovered tower
    for (const e of fx.emitters) {
      const t = towerById(this.sim, e.towerId);
      if (!t) continue;
      g.lineStyle(e.towerId === highlight ? 2 : 1, 0x80b0ff, e.towerId === highlight ? 0.8 : 0.15);
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

    // Ground zones: a faint ellipse of the zone's radius under its falling shards
    for (const m of state.missiles) {
      const skill = this.sim.data.skills[m.skill];
      if (skill?.archetype !== 'zone') continue;
      const c = project(m.x, m.y);
      const r = ellipseOf(skill.levels[m.level]?.radiusUnits ?? skill.radiusUnits);
      g.fillStyle(0x80c0ff, 0.12).fillEllipse(c.x, c.y, r.w, r.h);
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
      const ok = (this.onOwnRing && canBuild(this.sim, x, y, this.seat)) || towerAt(this.sim, x, y) !== undefined;
      g.lineStyle(2, ok ? 0xffffff : 0xff4040, 0.6).strokePoints(tileDiamond(x, y), true);
    }
  }

  /** The alive count across the top: it fills as monsters pile up, and the run is lost when it is full. */
  private drawAlive(alive: number): void {
    const limit = aliveLimitOf(this.sim);
    const frac = Math.max(0, Math.min(1, alive / limit));
    if (this.d2) return;
    const { width, height, y } = ALIVE_BAR;
    const x = GAME_WIDTH / 2 - width / 2;
    const colour = frac < 0.5 ? 0x60a040 : frac < 0.8 ? 0xd0a030 : 0xd03020;
    this.aliveGfx.clear().fillStyle(0x000000, 0.6).fillRect(x - 2, y - 2, width + 4, height + 4).fillStyle(colour).fillRect(x, y, Math.round(width * frac), height);
    this.aliveText.setText(`Alive ${alive} / ${limit}`);
  }

  private drawHud(): void {
    const { state, data } = this.sim;
    if (this.battleHud) return this.drawBattleHud();
    if (this.driver?.online) return this.drawOnlineHud();
    this.drawAlive(state.alive);
    this.hud.setText(`Gold ${this.gold}   Wave ${state.wave}   Kills ${state.kills}`);
    this.hud2.setText(this.d2 ? '' : this.waveTimer());
    this.d2?.update(this.hudNumbers(aliveLimitOf(this.sim)));
    if (state.status !== 'playing' && !this.endOverlay.visible) {
      const why = state.status === 'won' ? 'Victory' : `Defeat: ${aliveLimitOf(this.sim)} alive on the ring`;
      this.endOverlay.setText(`${why}\nwave ${state.wave}, ${state.kills} kills\nclick to play again`).setVisible(true);
    }
  }

  /** Battle Mode: the kings, the phase and the panel, the globes on your king, and the result at the end. */
  private drawBattleHud(): void {
    const d = this.driver!;
    const match = d.match;
    const b = match.state.battle!;
    this.battleHud!.update();
    const own = match.zones[ringOf(match, d.me)]!;
    const king = own.state.battle!.king;
    this.hud2.setText('');
    if (this.d2) {
      const n = this.hudNumbers(king.maxHp);
      const rules = match.data.battle!.rules;
      const left = b.phase === 'build' ? (b.phaseTick - match.state.tick) / Math.max(1, b.wave === 0 ? rules.firstBuildTicks : rules.buildTicks) : 0;
      this.d2.update({ ...n, gold: own.state.gold[seatOf(match, d.me)] ?? 0, alive: king.maxHp - Math.max(0, king.hp), aliveLimit: king.maxHp, lifeLabel: `Worldstone: ${Math.max(0, king.hp)} / ${king.maxHp}`, wave: `Wave ${b.wave} of ${match.data.battle!.waves.length}`, timer: '', timerFrac: Math.max(0, Math.min(1, left)), actFrac: b.wave / match.data.battle!.waves.length, nextWave: this.nextWaveTip(b.wave) });
    }
    if (match.state.status === 'over' && !this.endOverlay.visible && !this.battleEndShown && !this.halted) {
      const won = match.state.winners.includes(d.me);
      const draw = match.state.winners.length === 0 && match.state.mode === 'battle';
      const kings = match.zones.map((z) => z.state.battle!.king.hp);
      const fell = kings.some((hp) => hp <= 0);
      const title =
        match.state.mode === 'coop'
          ? won ? 'The Worldstone stands' : 'The Worldstone has fallen'
          : draw ? 'A draw' : won ? (fell ? "Victory: the enemy's Worldstone fell" : 'Victory on life') : fell ? 'Defeat: your Worldstone fell' : 'Defeat on life';
      const yours = kings[teamOf(match, d.me)] ?? 0;
      if (!this.battleEnd(title, won)) this.endOverlay.setText(`${title}
wave ${b.wave}, your Worldstone at ${Math.max(0, yours)}
click to return to the menu`).setFontSize(40).setVisible(true);
      if (won) this.sounds.battle('victory');
      if (!this.battleRecorded) {
        this.battleRecorded = true;
        this.keeper?.recordBattle(draw ? undefined : won, b.wave);
      }
    }
  }

  /**
   * Battle Mode's end, in D2's style: the stone panel with the result in gold, each team's
   * Worldstone, kills, leaks and sends, and a stone button back to the menu. False without
   * the frontend art (the plain overlay shows instead).
   */
  private battleEnd(title: string, won: boolean): boolean {
    if (this.battleEndShown) return true;
    if (!frontendManifest(this)) return false;
    this.battleEndShown = true;
    const d = this.driver!;
    const match = d.match;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2 - 40;
    const parts: Phaser.GameObjects.GameObject[] = [];
    parts.push(this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.55).setOrigin(0).setDepth(6000).setInteractive());
    const panel = stonePanel(this, cx, cy, 760, 520);
    if (panel) parts.push(panel.setDepth(6001));
    const text = (y: number, s: string, size: number, colour: string) => parts.push(this.add.text(cx, y, s, { fontFamily: FONT, fontSize: `${size}px`, color: colour, align: 'center' }).setOrigin(0.5).setDepth(6002).setShadow(1, 1, '#000000', 2));
    text(cy - 200, title, 34, won ? '#c7b377' : '#d06048');
    text(cy - 150, `Wave ${match.state.battle!.wave} of ${match.data.battle!.waves.length}`, 20, '#a8a088');
    match.zones.forEach((zone, t) => {
      const b = zone.state.battle!;
      const team = match.zones.length === 1 ? 'Your team' : t === teamOf(match, d.me) ? 'Your team' : 'The enemy';
      const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
      text(cy - 90 + t * 110, `${team}, ${KEEP_NAMES[t]}`, 22, '#c7b377');
      text(cy - 58 + t * 110, `Worldstone ${Math.max(0, b.king.hp)} of ${b.king.maxHp}   Kills ${zone.state.kills}   Leaks ${sum(b.leaks)}   Sends ${sum(b.sendsMade)}`, 19, '#e8e0c8');
      text(cy - 32 + t * 110, b.races.map((r, seat) => `${this.nameOf(slotOf(match, t, seat))}: ${this.gameData.classes[r]?.name ?? r}`).join('   '), 16, '#a8a088');
    });
    parts.push(...stoneButton(this, cx, cy + 190, 'Return to menu', () => (d.online ? this.leaveOnline() : this.quitToMenu()), { width: 300 }).map((o) => (o as Phaser.GameObjects.Image).setDepth(6003)));
    return true;
  }

  private battleEndShown = false;

  private drawOnlineHud(): void {
    const driver = this.driver!;
    const match = driver.match;
    const m = match.state;
    const s = this.sim.state;
        const watching = !this.onOwnRing ? `   (watching ${this.nameOf(this.view)})` : '';
    this.drawAlive(s.alive);
    this.hud.setText(`Gold ${this.onOwnRing ? this.gold : (s.gold[0] ?? 0)}   Alive ${s.alive}   Wave ${s.wave}   Kills ${s.kills}${watching}`);
    this.d2?.update(this.hudNumbers(aliveLimitOf(this.sim)));

    const parts: string[] = [];
    const timer = this.waveTimer();
    if (timer && !this.d2) parts.push(timer);
    const names = Array.from({ length: match.players }, (_, p) => {
      const tag = m.mode === 'ffa' ? (match.zones[p]!.state.status === 'lost' ? ' out' : ` ${aliveOf(match, p)}`) : '';
      const here = m.mode === 'ffa' ? p === this.view : p === driver.me;
      return `${p + 1} ${this.nameOf(p)}${tag}${here ? '*' : ''}`;
    });
    parts.push(`${m.mode === 'team' ? 'Arcs' : 'Rings'}: ${names.join('  ')}`);
    if (match.players > 1) parts.push(`keys 1-${match.players} ${m.mode === 'team' ? 'look' : 'watch'}`);
    this.hud2.setText(parts.join('   |   '));

    if (m.status === 'over' && !this.endOverlay.visible && !this.halted) {
      const won = m.winners.includes(driver.me);
      const title =
        m.mode === 'team'
          ? won ? 'Your team held!' : 'Your team fell'
          : won ? 'You win!' : m.winners.length > 0 ? `${m.winners.map((w) => this.nameOf(w)).join(' and ')} won` : 'Nobody survived';
      this.endOverlay.setText(`${title}\nwave ${s.wave}\nclick to return to the menu`).setFontSize(48).setVisible(true);
    }
  }

  /** What D2R's panel shows for the ring on screen: this player's kills and wave share, the alive weight, the timers. */
  private hudNumbers(aliveLimit: number): HudNumbers {
    const sim = this.sim;
    const s = sim.state;
    const seat = this.onOwnRing ? this.seat : 0;
    const last = sim.data.waves[s.wave - 1];
    const left = s.status === 'playing' && waveAt(sim, s.wave) ? (s.nextWaveTick - s.tick) / sim.data.economy.waveTicks : 0;
    return {
      // A watched FFA ring shows its own player's gold
      gold: this.onOwnRing ? this.gold : (s.gold[0] ?? 0),
      kills: s.kills,
      killShare: s.kills > 0 ? (s.killsBy[seat] ?? 0) / s.kills : 1,
      alive: s.alive,
      aliveLimit,
      wave: this.waveLabel(s.wave),
      timer: this.waveTimer(),
      timerFrac: Math.max(0, Math.min(1, left)),
      actFrac: last ? last.actWave / last.actWaves : 0,
      nextWave: this.nextWaveTip(s.wave),
    };
  }

  /** "Next wave in 23 s, send now for 46 gold": the ring's wave timer and what sending early pays. */
  private waveTimer(): string {
    const sim = this.sim;
    const s = sim.state;
    if (s.status !== 'playing' || !waveAt(sim, s.wave)) return '';
    const secs = Math.max(0, Math.ceil((s.nextWaveTick - s.tick) / TICKS_PER_SECOND));
    return `Next wave in ${secs} s, send now for ${earlySendBonus(sim)} gold`;
  }

  /** "Normal Act 1 3/6": the stage of the last wave started and its number in its act. */
  private waveLabel(called: number): string {
    const last = this.sim.data.waves[called - 1];
    if (!last) {
      const first = this.sim.data.waves[0];
      return first ? `${stageName(first.difficulty, first.act)} 0/${first.actWaves}` : '';
    }
    return labelOf(last);
  }

  /** The next wave's monsters as a D2 tooltip: counts by type, then champions, uniques and bosses. */
  private nextWaveTip(index: number): { title: string; body: string } | undefined {
    const data = this.sim.data;
    const def: WaveDef | undefined = waveAt(this.sim, index);
    if (!def) return undefined;
    const nice = (id: string) => (data.monsters[id]?.name ?? id).replace(/([a-z])([A-Z])/g, '$1 $2');
    const mod = (m: string) => m.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    // What a special weighs on the alive count while it lives
    const leak = (g: WaveDef['groups'][number]) => `weighs ${data.rules.aliveWeight[g.rank]} on the alive count${g.count > 1 ? ' each' : ''}`;
    const normal = new Map<string, number>();
    const special: string[] = [];
    for (const g of def.groups) {
      if (g.rank === 'normal') normal.set(g.monster, (normal.get(g.monster) ?? 0) + g.count);
      else {
        const who = `${g.rank === 'boss' ? 'Boss' : g.rank === 'unique' ? 'Unique' : `${g.count} champion`}: ${nice(g.monster)}`;
        special.push(`${who}${g.mods.length ? ` (${g.mods.map(mod).join(', ')})` : ''}`, `  ${leak(g)}`);
      }
    }
    const lines = [...[...normal].map(([id, n]) => `${n} ${nice(id)}`), ...special, '', `Kills so far: ${this.sim.state.kills}`];
    return { title: `Next: ${labelOf(def)}${def.final ? ', act boss' : ''}`, body: lines.join('\n') };
  }

  private skillName(id: string): string {
    return this.sim.data.skills[id]?.displayName ?? id;
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
    const key = JSON.stringify([this.view, sel, this.buildClass, tower && [tower.tier, tower.level, tower.picks, tower.targeting], this.gold, sim.state.towers.length]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    for (const o of this.panel) o.destroy();
    this.panel = [];
    this.tooltip.hide();
    if (!this.onOwnRing || (tower && tower.owner !== this.seat)) {
      const match = this.driver?.match;
      if (match?.state.battle) {
        const whose = tower ? `${this.nameOf(slotOf(match, this.view, tower.owner))}'s tower` : `the ${KEEP_NAMES[this.view] ?? ''} battlefield`;
        this.info.setText(`Looking at ${whose}.${this.onOwnRing ? '' : ' Press Home to go back to your lane.'}`);
      } else {
        const whose = tower ? `${this.nameOf(match?.state.mode === 'team' ? tower.owner : this.view)}'s tower` : `${this.nameOf(this.view)}'s ring`;
        this.info.setText(`Looking at ${whose}.${this.onOwnRing ? '' : ` Press ${(this.driver?.me ?? 0) + 1}, or click your name under the map, to go back to yours.`}`);
      }
      this.d2?.setSlots([]);
      this.d2?.setTabs([]);
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
      this.info.setText(`Build a tower (${buildCostFor(sim, this.seat)}g): its class and T1 skill fix its line`);
      const battleRace = this.driver?.match.state.battle?.races[this.driver.me];
      for (const [cls, c] of Object.entries(sim.data.classes)) {
        if (battleRace && cls !== battleRace) continue;
        for (const line of Object.values(c.lines)) {
          const skill = line.tiers[0]![0]!;
          specs.push(
            this.skillButton(skill, `${line.name}: ${this.skillName(skill)}`, () => {
              this.issue({ type: 'build', x: sel.x, y: sel.y, cls, skill });
              this.selection = undefined;
            }, this.gold >= buildCostFor(sim, this.seat)),
          );
        }
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
      // A tab per class over the belt; the belt holds the chosen class's first skills
      const cls = sim.data.classes[this.buildClass] ? this.buildClass : Object.keys(sim.data.classes)[0]!;
      const c = sim.data.classes[cls]!;
      this.info.setText(`Build a ${c.name} tower (${buildCostFor(sim, this.seat)} gold): its first skill fixes its line`);
      const battleRace = this.driver?.match.state.battle?.races[this.driver.me];
      d2.setTabs(
        Object.keys(sim.data.classes).filter((id) => !battleRace || id === battleRace).map((id) => ({
          label: sim.data.classes[id]!.name,
          chosen: id === cls,
          onClick: () => {
            this.buildClass = id;
            this.panelKey = '';
          },
        })),
      );
      const items: SlotItem[] = Object.values(c.lines).map((line) => {
        const skill = line.tiers[0]![0]!;
        const spec = this.skillButton(skill, '', () => undefined);
        return {
          icon: spec.icon,
          title: `${line.name}: ${this.skillName(skill)}`,
          body: `${spec.tooltip?.body ?? ''}\n\nBuild for ${buildCostFor(sim, this.seat)} gold`.trim(),
          enabled: this.gold >= buildCostFor(sim, this.seat),
          onClick: () => {
            this.issue({ type: 'build', x: sel.x, y: sel.y, cls, skill });
            this.selection = undefined;
          },
        };
      });
      d2.setSlots(items);
      d2.setTowerPanel(undefined);
    } else if (tower) {
      this.info.setText('');
      d2.setSlots([]);
      d2.setTabs([]);
      d2.setTowerPanel(this.towerModel(tower));
    } else {
      this.info.setText(sim.state.towers.length < 2 ? 'Click a free tile to build. Click a tower to upgrade it.' : '');
      d2.setSlots([]);
      d2.setTabs([]);
      d2.setTowerPanel(undefined);
    }
    // The current skill in the left slot; the right slot is the gold readout
    const [, right] = tower ? this.skillSlots(tower) : [undefined, undefined];
    d2.setSkills(right);
  }

  /**
   * The panel's two skill buttons for a tower: its current skill on the right with its
   * level, and on the left the skill the tier before it (or, evolved, its partner's).
   */
  private skillSlots(tower: Tower): [SkillSlot | undefined, SkillSlot | undefined] {
    const slot = (id: string | undefined, level: number): SkillSlot | undefined => {
      if (!id) return undefined;
      const spec = this.skillButton(id, '', () => undefined);
      return { icon: spec.icon, level, title: spec.tooltip?.title ?? this.skillName(id), body: `Level ${level}\n${spec.tooltip?.body ?? ''}`.trim() };
    };
    const current = tower.picks[tower.tier - 1];
    const right = slot(current, tower.level);
    const left = tower.evolved ? slot(tower.partnerSkill, tower.partnerLevel + 1) : slot(tower.picks[tower.tier - 2], MAX_TOWER_LEVEL);
    return [left, right];
  }

  /** What a tower with no standard damage number does, in a few words. */
  private roleOf(skill: SkillDef, lvl: number): string {
    switch (skill.archetype) {
      case 'debuff': {
        const l = skill.levels[lvl]!;
        if (skill.mode === 'pulse') return `Takes ${l.hpPct}% of current HP in radius`;
        if (skill.mode === 'curse') {
          // What the curse does, then for how long: Battle Cry weakens, Cloak of Shadows blinds
          const does = [
            ...(l.damageDownPct >= 100 ? ['blinds'] : l.damageDownPct > 0 ? [`-${l.damageDownPct}% monster damage`] : []),
            ...Object.entries(l.resistDown).filter(([, v]) => (v ?? 0) > 0).map(([el, v]) => `-${v}% ${el === 'phys' ? 'physical' : el} resistance`),
            ...(l.slowPct > 0 ? [`${l.slowPct}% slower`] : []),
          ];
          return `Curses monsters for ${Math.round(l.durationTicks / TICKS_PER_SECOND)} s${does.length ? `: ${does.join(', ')}` : ''}`;
        }
        return 'Aura tower';
      }
      case 'summon': {
        const l = skill.levels[lvl]!;
        if (skill.kind === 'trap') return `Sets up to ${l.count} traps on the path, ${l.shots} shots each`;
        const [one, many] = skill.kind === 'revive' ? ['revived corpse', 'revived corpses'] : (SUMMON_NOUNS[skill.monster] ?? ['summon', 'summons']);
        return `Up to ${l.count} ${l.count === 1 ? one : many}`;
      }
      case 'corpse':
        return 'Explodes fresh corpses';
      default:
        return 'Aura tower';
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
    const className = sim.data.classes[tower.cls]?.name ?? tower.cls;
    const legend = tower.legend ? sim.data.legends.find((l) => l.id === tower.legend) : undefined;
    const three = legend ? [tower, ...ridersOf(sim, tower)].map((t) => sim.data.evolutions.find((r) => r.id === t.evolved)?.name ?? t.evolved) : [];
    lines.push(
      legend
        ? `${className} legend: ${three.join(', ')}   Level ${tower.level}`
        : recipe
          ? `${className}, evolved with ${this.skillName(tower.partnerSkill)} built in   Level ${tower.level}`
          : `${className}, ${line?.name ?? 'no line yet'}   Tier ${tower.tier}   Level ${tower.level}`,
    );
    const auras = effectsOn(sim, tower);
    const auraName = (e: { skill: string; item: boolean }) => `${this.skillName(e.skill)}${e.item ? ' (item)' : ''}`;
    if (active) {
      const buff = sim.fx.towers[tower.id];
      // An evolved tower fires both lines: its partner's casts count with its attack
      const partnerSkill = tower.evolved && tower.partnerSkill ? geared(sim, tower, sim.data.skills[tower.partnerSkill]!) : undefined;
      const partnerDps = partnerSkill && !isAura(partnerSkill) ? standardDps(partnerSkill, tower.partnerLevel) : 0;
      const recipe = tower.evolved ? sim.data.evolutions.find((r) => r.id === tower.evolved) : undefined;
      const base = standardDps(active.skill, active.lvl, recipe?.ignoreSkillDelay === true) + partnerDps;
      // 1/256 HP per 1000 ticks, at 20 ticks a second; the auras this tower stands in broken out
      const perSecond = (damagePct: number, speedPct: number) => Math.round((((base * TICKS_PER_SECOND) / 1000 / 256) * (100 + damagePct) * (100 + speedPct)) / 10000);
      const dps = perSecond(buff?.damagePct ?? 0, buff?.attackSpeedPct ?? 0);
      const own = perSecond(0, 0);
      const dmg = auras.filter((e) => e.damagePct > 0).map((e) => `+${e.damagePct}% ${auraName(e)}`);
      const spd = auras.filter((e) => e.attackSpeedPct > 0).map((e) => `+${e.attackSpeedPct}% ${auraName(e)}`);
      if (base > 0) {
        lines.push(dmg.length || spd.length ? `Damage per second ${dps} (${own} ${[...dmg, ...spd.map((s) => `${s} speed`)].join(', ')})` : `Damage per second ${dps}`);
      } else {
        lines.push(this.roleOf(active.skill, active.lvl));
        if (dmg.length || spd.length) lines.push(`Under ${[...dmg, ...spd.map((s) => `${s} speed`)].join(', ')}`);
      }
    }
    // An aura tower: what it projects, and who it reaches with what
    for (const aura of projected(sim, tower)) {
      const what = terms(aura);
      if (!what) continue;
      lines.push(`${auraName(aura)}: ${what}`);
      if (helps(aura)) {
        const reach = reachOf(sim, tower, aura).filter((r) => r.tower.id !== tower.id);
        const names = reach.map((r) => {
          const a = activeSkill(sim, r.tower);
          return `${a ? this.skillName(baseSkillId(a.skill.id)) : 'tower'}${r.counts ? '' : ' (under a stronger one)'}`;
        });
        lines.push(names.length ? `Reaches ${names.join(', ')}` : 'Reaches no other tower');
      }
    }
    const under = auras.filter((e) => e.towerId !== tower.id).map(auraName);
    const curses = [...new Set(sim.fx.emitters.filter((em) => {
      if (em.towerId === tower.id) return false;
      const src = towerById(sim, em.towerId);
      return src !== undefined && (src.x - tower.x) ** 2 + (src.y - tower.y) ** 2 <= em.radiusUnits * em.radiusUnits;
    }).map((em) => this.skillName(baseSkillId(em.skill))))].filter((n) => !under.includes(n) && !auras.some((e) => auraName(e) === n));
    if (curses.length) lines.push(`In range of ${curses.join(', ')}`);
    const level = active ? upgradeCost(sim, tower) : undefined;
    const tier = tierCost(sim, tower);
    if (level !== undefined) lines.push(`Next: level ${tower.level + 1} for ${level} gold`);
    else if (tier !== undefined) lines.push(`Next: tier ${tower.tier + 1} for ${tier} gold`);
    // A branching tier: what each branch leads to, so the choice can be read before it is made
    const branchTier = tier !== undefined ? tower.tier : tower.line && tower.picks.length === tower.tier - 1 ? tower.tier - 1 : -1;
    const branches = branchTier >= 0 ? (line?.tiers[branchTier] ?? []) : [];
    if (branches.length > 1) for (const skill of branches) lines.push(this.branchLead(tower, branchTier, skill));
    lines.push(`Targeting ${tower.targeting}`);

    const buttons: PanelButton[] = [];
    const type = tower.line ? 'pickBranch' : 'pickSkill';
    for (const skill of pendingChoices(sim, tower)) buttons.push({ label: `Pick ${this.skillName(skill)}`, enabled: true, onClick: () => this.issue({ type, towerId: tower.id, skill }) });
    if (level !== undefined) buttons.push({ label: `Upgrade ${level}g`, enabled: this.gold >= level, onClick: () => this.issue({ type: 'upgrade', towerId: tower.id }) });
    if (tier !== undefined && line) {
      const options = line.tiers[tower.tier] ?? [];
      for (const skill of options) {
        const commands: Command[] = [{ type: 'upgradeTier', towerId: tower.id }];
        if (options.length > 1) commands.push({ type: 'pickBranch', towerId: tower.id, skill });
        buttons.push({ label: options.length > 1 ? `T${tower.tier + 1}: ${this.skillName(skill)}` : `Tier up ${tier}g`, enabled: this.gold >= tier, onClick: () => this.issue(...commands) });
      }
    }
    let evolvable = false;
    for (const { match, other, label } of this.partners(tower)) {
      evolvable = true;
      buttons.push({ label: `Evolve ${match.recipe.name}${label} ${e.evolveCost}g`, enabled: this.gold >= e.evolveCost, onClick: () => this.issue({ type: 'evolve', towerA: tower.id, towerB: other.id }) });
    }
    // T5: shown only once three evolutions stand together
    for (const o of legendOptions(sim, tower)) {
      evolvable = true;
      buttons.push({
        label: `Evolve ${o.legend.name} ${e.legend.cost}g`,
        enabled: this.gold >= e.legend.cost,
        onClick: () => this.issue({ type: 'ascend', towerA: tower.id, towerB: o.others[0].id, towerC: o.others[1].id }),
      });
    }
    if (!evolvable && !tower.evolved && active) lines.push(this.evolveHint(tower));
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
    const title = legend ? legend.name : recipe ? recipe.name : active ? active.skill.displayName : `${className} tower`;
    return { icon, title, lines, buttons };
  }

  private towerPanel(tower: Tower, specs: ButtonSpec[]): void {
    const sim = this.sim;
    const e = sim.data.economy;
    const active = activeSkill(sim, tower);
    const recipe = tower.evolved ? sim.data.evolutions.find((r) => r.id === tower.evolved) : undefined;
    const line = sim.data.classes[tower.cls]?.lines[tower.line];
    const legend = tower.legend ? sim.data.legends.find((l) => l.id === tower.legend) : undefined;
    const title = legend
      ? `${legend.name} L${tower.level}`
      : recipe
        ? `${recipe.name}: ${this.skillName(recipe.attack.skill)} with ${this.skillName(tower.partnerSkill)} aura`
        : `${line?.name ?? 'Inert'} T${tower.tier} L${tower.level}: ${active ? active.skill.displayName : 'pick a skill'}`;
    this.info.setText(`${title}   targeting ${tower.targeting}`);

    const pick = pendingChoices(sim, tower);
    const type = tower.line ? 'pickBranch' : 'pickSkill';
    for (const skill of pick) specs.push(this.skillButton(skill, `Pick ${this.skillName(skill)}`, () => this.issue({ type, towerId: tower.id, skill })));

    if (active) {
      const level = upgradeCost(sim, tower);
      if (level !== undefined) {
        specs.push({
          ...this.skillButton(active.skill.id, `Level ${tower.level + 1} (${level}g)`, () => this.issue({ type: 'upgrade', towerId: tower.id }), this.gold >= level),
        });
      }
    }
    const tier = tierCost(sim, tower);
    if (tier !== undefined && line) {
      const options = line.tiers[tower.tier] ?? [];
      for (const skill of options) {
        const commands: Command[] = [{ type: 'upgradeTier', towerId: tower.id }];
        if (options.length > 1) commands.push({ type: 'pickBranch', towerId: tower.id, skill });
        const spec = this.skillButton(skill, `T${tower.tier + 1}: ${this.skillName(skill)} (${tier}g)`, () => this.issue(...commands), this.gold >= tier);
        if (options.length > 1 && spec.tooltip) spec.tooltip.body = `${this.branchLead(tower, tower.tier, skill)}

${spec.tooltip.body}`;
        specs.push(spec);
      }
    } else if (!tower.evolved && line && tower.level < MAX_TOWER_LEVEL && tower.tier < line.tiers.length) {
      specs.push({ label: `T${tower.tier + 1} unlocks at level ${MAX_TOWER_LEVEL}`, enabled: false, onClick: () => undefined });
    }
    for (const { match, other, label } of this.partners(tower)) {
      specs.push({
        ...this.skillButton(match.recipe.attack.skill, `Evolve ${match.recipe.name}${label} (${e.evolveCost}g)`, () => this.issue({ type: 'evolve', towerA: tower.id, towerB: other.id }), this.gold >= e.evolveCost),
        colour: '#5a2a70',
      });
    }
    for (const o of legendOptions(sim, tower)) {
      specs.push({
        label: `Evolve ${o.legend.name} (${e.legend.cost}g)`,
        enabled: this.gold >= e.legend.cost,
        colour: '#7a5a10',
        onClick: () => this.issue({ type: 'ascend', towerA: tower.id, towerB: o.others[0].id, towerC: o.others[1].id }),
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
