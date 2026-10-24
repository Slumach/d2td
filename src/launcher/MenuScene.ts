// Main menu, dressed as D2R's logo screen: black, the burning logo with TOWER DEFENSE
// under it, and D2's stone buttons stacked down the middle: Single Player, Multiplayer
// (Host or Join), Continue when there is a save, Options, Exit. Single Player opens a page
// in the manner of D2's character select: the player's profile (name, the stash's worth,
// the best wave reached) with Play and Continue. Options opens D2R's options panel for
// volume, name and the D2R folder. Eternal Conflict opens its own page: the battle record, the
// mode (a battle or co-op), team size and race, then Play against bots, Host or Join.
// Without the frontend art (an extraction from before it existed) the plain look stands in.

import Phaser from 'phaser';

import type { BattleStart, SoloStart } from '../render/GameScene.ts';
import { FONT, button, createTooltip, type Tooltip } from '../render/ui.ts';
import { clearCheckpoint, loadCheckpoint } from '../render/saves.ts';
import type { Checkpoint } from '../sim/checkpoint.ts';
import { stageName } from '../sim/data.ts';
import { buildItemData, type ItemData } from '../sim/items/data.ts';
import { itemCost, SELL_DIVISOR } from '../sim/items/price.ts';
import type { Tables } from '../sim/tables.ts';
import { emptyProfile, loadProfile, saveProfile, type Profile } from './profile.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../render/layout.ts';
import type { LauncherApi, LauncherState, UpdateCheck, UpdateEvent } from './api.ts';
import { burningLogo, checkbox, frontendManifest, menuMusic, optionsPanel, preloadFrontend, smoothHd, stoneButton } from './frontend.ts';
import { DEFAULT_OPTIONS, type BattleOptions } from '../sim/battle.ts';
import { shortPath } from './paths.ts';
import { TextField } from './TextField.ts';
import { LAUNCHER_KEY } from './SetupScene.ts';

const CX = GAME_WIDTH / 2;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#d8c89a' };
const MUTED = { ...TEXT, fontSize: '17px', color: '#9a9078' };
/** The logo as the intro shows it: big, its top near the top of the screen. */
const LOGO_TOP = 10;
const LOGO_SCALE = 1.25;
const BUTTONS_TOP = 470;
const BUTTON_STEP = 92;

type Page = 'main' | 'character' | 'newgame' | 'multiplayer' | 'options' | 'update' | 'battle';

/** Eternal Conflict's lobby choices, kept while the menu is open. */
export interface BattleChoice {
  mode: 'battle' | 'coop';
  teamSize: number;
  /** A class id, or 'random'. */
  race: string;
  /** The game setup screen's switches. */
  options: BattleOptions;
}

/** The classes a battle player may pick, in the game's order. */
export const RACES = ['paladin', 'sorceress', 'necromancer', 'amazon', 'barbarian', 'druid', 'assassin'];
const RACE_NAMES: Record<string, string> = { random: 'Random', paladin: 'Paladin', sorceress: 'Sorceress', necromancer: 'Necromancer', amazon: 'Amazon', barbarian: 'Barbarian', druid: 'Druid', assassin: 'Assassin' };

/** The item tables the character page needs to price the stash (GameScene loads the rest). */
const ITEM_TABLES: (keyof Tables)[] = [
  'weapons', 'armor', 'misc', 'uniqueitems', 'setitems', 'sets', 'magicprefix', 'magicsuffix', 'rareprefix', 'raresuffix',
  'gems', 'runes', 'itemtypes', 'properties', 'itemstatcost', 'treasureclassex', 'itemratio', 'itemstrings',
];

export class MenuScene extends Phaser.Scene {
  private api!: LauncherApi;
  private state!: LauncherState;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private logo: Phaser.GameObjects.GameObject[] = [];
  private page: Page = 'main';
  /** The single-player checkpoint, if there is one: Continue carries it on. */
  private saved: Checkpoint | undefined;
  private static updateHooked = false;
  private nameField: TextField | undefined;
  /** The update page's state, kept across pages while a download runs. */
  private updateState: { checking: boolean; check?: UpdateCheck; downloading: boolean; downloaded: boolean; status: string; notes: string } = { checking: false, downloading: false, downloaded: false, status: '', notes: '' };
  private updateTexts: { status: Phaser.GameObjects.Text; notes: Phaser.GameObjects.Text } | undefined;
  /** The update page's changelog: the notes text, the window it scrolls in, and how far it has scrolled. */
  private updateNotes: { text: Phaser.GameObjects.Text; bar: Phaser.GameObjects.Graphics; area: { x: number; y: number; w: number; h: number }; scroll: number } | undefined;
  /** The profile, for the character page. */
  private profile: Profile | undefined;
  private items: ItemData | undefined;
  /** Eternal Conflict's choices on its page. */
  private battle: BattleChoice = { mode: 'battle', teamSize: 1, race: 'random', options: { ...DEFAULT_OPTIONS } };
  private hintTip: Tooltip | undefined;

  constructor() {
    super('Menu');
  }

  preload(): void {
    preloadFrontend(this);
    for (const name of ITEM_TABLES) if (!this.cache.json.exists(name)) this.load.json(name, `data/${name}.json`);
  }

  create(): void {
    this.api = this.registry.get(LAUNCHER_KEY) as LauncherApi;
    // Once: the scene instance is reused every time the menu comes back
    if (!MenuScene.updateHooked) {
      MenuScene.updateHooked = true;
      this.api.onUpdate((e) => this.onUpdateEvent(e));
    }
    // Whatever path led here, no lobby or game connection outlives the main menu
    void this.api.mpLeave();
    this.page = 'main';
    this.saved = undefined;
    this.profile = undefined;
    if (ITEM_TABLES.every((n) => this.cache.json.exists(n))) {
      this.items = buildItemData(Object.fromEntries(ITEM_TABLES.map((n) => [n, this.cache.json.get(n)])) as unknown as Tables);
      void loadProfile(this.api, this.items).then((p) => {
        this.profile = p;
        if (this.state && this.page === 'character') this.draw();
      });
    }
    void loadCheckpoint(this.api, 'solo').then((cp) => {
      this.saved = cp;
      if (this.state) this.draw();
    });
    const m = frontendManifest(this);
    this.hintTip = createTooltip(this, 0, 0);
    // The update page's changelog scrolls on the wheel
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.scrollNotes(dy));
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000).setOrigin(0).setDepth(0);
    if (m) smoothHd(this, m);
    this.logo = burningLogo(this, CX, LOGO_TOP, LOGO_SCALE, 2);
    menuMusic(this, true);
    void this.api.getState().then((state) => {
      this.state = state;
      // The game reads it from the registry, solo or online
      this.registry.set('goldNumbers', state.goldNumbers);
      this.draw();
    });
  }

  private async setGoldNumbers(on: boolean): Promise<void> {
    await this.api.setGoldNumbers(on);
    this.state = { ...this.state, goldNumbers: on };
    this.registry.set('goldNumbers', on);
    this.draw();
  }

  private async setLootFilter(mode: 'default' | 'all'): Promise<void> {
    await this.api.setLootFilter(mode);
    this.state = { ...this.state, lootFilter: mode };
    this.draw();
  }

  private async setVolume(volume: number): Promise<void> {
    await this.api.setVolume(volume);
    this.state = await this.api.getState();
    this.sound.volume = this.state.volume / 100;
    this.draw();
  }

  private clear(): void {
    for (const p of this.parts) p.destroy();
    this.parts = [];
    this.nameField?.destroy();
    this.nameField = undefined;
  }

  private go(page: Page): void {
    this.page = page;
    this.draw();
  }

  private draw(): void {
    this.clear();
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const d2 = frontendManifest(this) !== undefined;
    for (const o of this.logo) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(this.page !== 'options' && this.page !== 'battle' && this.page !== 'update');
    this.updateNotes = undefined;
    add(this.add.text(16, GAME_HEIGHT - 28, `v${this.state.version}   non-commercial fan project, not affiliated with Blizzard`, { ...MUTED, fontSize: '14px' }).setDepth(3100));

    if (this.page === 'options') return this.drawOptions(d2);
    if (this.page === 'character') return this.drawCharacter(d2);
    if (this.page === 'newgame') return this.drawNewGame(d2);
    if (this.page === 'update') return this.drawUpdate(d2);
    if (this.page === 'battle') return this.drawBattle(d2);
    const saved = this.saved;
    const items: [string, () => void, string?][] =
      this.page === 'multiplayer'
        ? [
            ['Host Game', () => this.scene.start('Lobby', { role: 'host' })],
            ['Join Game', () => this.scene.start('Lobby', { role: 'join' })],
            ['Back', () => this.go('main')],
          ]
        : [
            ['Single Player', () => this.go('character')],
            ['Eternal Conflict', () => this.go('battle'), 'Heaven against Hell, Legion style.'],
            ['Multiplayer', () => this.go('multiplayer')],
            ...(saved ? [[`Continue: ${stageName(saved.difficulty, saved.act)}`, () => this.startGame(saved)] as [string, () => void]] : []),
            ['Options', () => this.go('options')],
            ['Update', () => this.go('update')],
            ['Exit', () => this.api.quit()],
          ];
    // Seven buttons close up so the last stays on screen
    const step = Math.min(BUTTON_STEP, Math.floor((GAME_HEIGHT - 70 - BUTTONS_TOP) / Math.max(1, items.length - 1)));
    items.forEach(([label, onClick, hint], i) => {
      const y = BUTTONS_TOP + i * step;
      if (d2) this.parts.push(...stoneButton(this, CX, y, label, onClick, { width: 330, ...(label.length > 13 ? { fontSize: 20 } : {}), ...(hint ? { hint, tooltip: this.hintTip } : {}) }));
      else this.parts.push(...button(this, CX - 180, y - 18, { label, onClick, width: 360 }));
    });
  }

  /**
   * Eternal Conflict's game setup screen, as Legion's: D2R's options panel with the profile's
   * record, the mode (a conflict or co-op), players a team and your race, then the switches
   * in three columns (random races or all pick, mirror mode; the send multiplier; easy mode,
   * the long game, no champions), each a D2R checkbox, and Start against bots, Host or Join.
   */
  private drawBattle(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const b = this.battle;
    const o = b.options;
    const r = this.profile?.battle;
    const height = 860;
    const panel = d2 ? optionsPanel(this, CX, GAME_HEIGHT / 2 - 20, height, 'optionsBg') : undefined;
    if (panel) add(panel);
    const w = panel ? panel.displayWidth : 900;
    const top = GAME_HEIGHT / 2 - 20 - height / 2;
    const left = CX - w / 2 + w * 0.1;
    const inner = w * 0.8;
    const set = (patch: Partial<BattleChoice>) => {
      this.battle = { ...this.battle, ...patch };
      this.draw();
    };
    const setOpt = (patch: Partial<BattleOptions>) => set({ options: { ...o, ...patch } });
    const med = (x: number, y: number, label: string, onClick: () => void, width: number, chosen = false) => {
      if (d2) {
        const parts = stoneButton(this, x + width / 2, y + 16, label, onClick, { size: 'med', width, fontSize: 15 });
        if (!chosen) for (const p of parts) (p as Phaser.GameObjects.Image).setAlpha?.(0.6);
        this.parts.push(...parts);
      } else this.parts.push(...button(this, x, y, { label, onClick, width, colour: chosen ? '#6a3020' : '#3a2c1c' }));
    };

    let y = top + 54;
    add(this.add.text(CX, y, 'Eternal Conflict', { ...TEXT, fontSize: '34px', color: '#c7b377' }).setOrigin(0.5).setDepth(3101));
    y += 36;
    add(this.add.text(CX, y, 'Heaven against Hell, Legion style: game setup', MUTED).setOrigin(0.5).setDepth(3101));
    y += 28;
    const record = r ? `Your record: won ${r.wins}, lost ${r.losses}${r.draws ? `, drawn ${r.draws}` : ''}; best wave ${r.bestWave || 'none yet'}` : 'Reading the profile...';
    add(this.add.text(CX, y, record, { ...MUTED, fontSize: '15px' }).setOrigin(0.5).setDepth(3101));
    y += 40;

    // The match: mode, team size, your race
    const col = inner / 3;
    add(this.add.text(left, y, 'Mode', MUTED).setDepth(3101));
    add(this.add.text(left + col, y, 'Players a team', MUTED).setDepth(3101));
    add(this.add.text(left + 2 * col, y, 'Your race', MUTED).setDepth(3101));
    y += 28;
    med(left, y, 'Conflict', () => set({ mode: 'battle' }), 118, b.mode === 'battle');
    med(left + 124, y, 'Co-op', () => set({ mode: 'coop' }), 110, b.mode === 'coop');
    for (let n = 1; n <= 4; n++) med(left + col + (n - 1) * 58, y, `${n}`, () => set({ teamSize: n }), 52, n === b.teamSize);
    const all = ['random', ...RACES];
    med(left + 2 * col, y, RACE_NAMES[b.race] ?? b.race, () => set({ race: all[(all.indexOf(b.race) + 1) % all.length]! }), 200, true);
    y += 60;

    // The switches, Legion's three columns
    const rows: [number, number, string, boolean, () => void, string][] = [
      [0, 0, 'Random towers', o.pick === 'random', () => setOpt({ pick: 'random' }), 'A fresh roll from different races every wave'],
      [0, 1, 'All pick', o.pick === 'all', () => setOpt({ pick: 'all' }), 'Pick your race and build it'],
      [0, 2, 'Mirror mode', o.mirror, () => setOpt({ mirror: !o.mirror }), 'Both teams play the same races'],
      [1, 0, 'X1 Normal mode', o.sends === 1, () => setOpt({ sends: 1 }), 'Sends are not multiplied'],
      [1, 1, 'X2 Double trouble', o.sends === 2, () => setOpt({ sends: 2 }), 'Sends walk twice over'],
      [1, 2, 'X3 Triple threat', o.sends === 3, () => setOpt({ sends: 3 }), 'Sends walk three times over'],
      [1, 3, 'X4 Quadruple chaos', o.sends === 4, () => setOpt({ sends: 4 }), 'Sends walk four times over'],
      [2, 0, 'Easy mode', o.easy, () => setOpt({ easy: !o.easy }), 'Weaker waves, a stronger king'],
      [2, 1, 'Long game', o.long, () => setOpt({ long: !o.long }), 'Waves 22 to 30 are played too'],
      [2, 2, 'No champions', !o.champions, () => setOpt({ champions: !o.champions }), 'No champion packs walk'],
    ];
    for (const [c, row, label, on, toggle, hint] of rows) {
      this.parts.push(...checkbox(this, left + c * col, y + row * 62, label, on, toggle, { sub: hint, fontSize: 17 }));
    }
    y += 4 * 62 + 10;

    const items: [string, () => void][] = [
      ['Start game', () => this.startBattle()],
      ['Host online', () => this.scene.start('Lobby', { role: 'host', battle: this.battle })],
      ['Join online', () => this.scene.start('Lobby', { role: 'join' })],
      ['Back', () => this.go('main')],
    ];
    const bw = 200;
    items.forEach(([label, onClick], i) => {
      const x = CX + (i - (items.length - 1) / 2) * (bw + 14);
      if (d2) this.parts.push(...stoneButton(this, x, top + height - 70, label, onClick, { size: 'med', width: bw, fontSize: 16 }));
      else this.parts.push(...button(this, x - bw / 2, y, { label, onClick, width: bw }));
    });
  }

  /** A battle with this player in the first seat and bots in every other. */
  private startBattle(): void {
    menuMusic(this, false);
    const b = this.battle;
    const slots = b.teamSize * (b.mode === 'battle' ? 2 : 1);
    const races = Array.from({ length: slots }, (_, p) => (p === 0 && b.race !== 'random' ? b.race : 'random'));
    const bots = Array.from({ length: slots - 1 }, (_, i) => i + 1);
    this.scene.start('Game', { battle: { mode: b.mode, setup: { teamSize: b.teamSize, races, bots, options: { ...b.options } } } } satisfies BattleStart);
  }

  /**
   * Single Player, as D2's character select: the profile's card (name, what the stash and
   * inventory are worth to a vendor before any cap, items held, the best wave reached), and
   * Play, Continue when there is a save, Back.
   */
  private drawCharacter(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const p = this.profile;
    const all = p ? [...p.inventory.map((i) => i.item), ...p.stash.flat().map((i) => i.item), ...p.inPlay, ...p.belt.flatMap((b) => (b ? [b] : []))] : [];
    const worth = this.items ? all.reduce((n, item) => n + Math.trunc(itemCost(this.items!, item) / SELL_DIVISOR), 0) : 0;
    const top = BUTTONS_TOP - 70;
    add(this.add.rectangle(CX, top + 40, 520, 150, 0x000000, 0.75).setStrokeStyle(1, 0x7a6440).setDepth(3000));
    add(this.add.text(CX, top - 10, this.state.name || 'Player', { ...TEXT, fontSize: '28px', color: '#c7b377' }).setOrigin(0.5).setDepth(3001));
    const lines = p
      ? [`Stash value: ${worth.toLocaleString('en-US')} gold`, `Items: ${all.length}`, `Best wave: ${p.bestWave > 0 ? p.bestWave : 'none yet'}`]
      : ['Reading the profile...'];
    lines.forEach((l, k) => add(this.add.text(CX, top + 30 + k * 28, l, TEXT).setOrigin(0.5).setDepth(3001)));
    const saved = this.saved;
    const items: [string, () => void][] = [
      ['Play', () => this.startGame()],
      ...(saved ? [[`Continue: ${stageName(saved.difficulty, saved.act)}`, () => this.startGame(saved)] as [string, () => void]] : []),
      ['New Game', () => this.go('newgame')],
      ['Back', () => this.go('main')],
    ];
    items.forEach(([label, onClick], i) => {
      const y = BUTTONS_TOP + 140 + i * BUTTON_STEP;
      if (d2) this.parts.push(...stoneButton(this, CX, y, label, onClick, { width: 330 }));
      else this.parts.push(...button(this, CX - 180, y - 18, { label, onClick, width: 360 }));
    });
  }

  /**
   * The update page, in D2R's options panel: asks the feed, shows the version and the
   * changelog in a window that scrolls on the wheel, and the buttons under it (download,
   * restart and install, check again, back).
   */
  private drawUpdate(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const height = 760;
    const panel = d2 ? optionsPanel(this, CX, GAME_HEIGHT / 2 - 30, height, 'optionsBg') : undefined;
    if (panel) add(panel);
    const w = panel ? panel.displayWidth : 800;
    const top = GAME_HEIGHT / 2 - 30 - height / 2;
    const left = CX - w / 2 + w * 0.1;
    const inner = w * 0.8;
    add(this.add.text(CX, top + 54, `Update   (this is v${this.state.version})`, { ...TEXT, fontSize: '30px', color: '#c7b377' }).setOrigin(0.5).setDepth(3101));
    const status = add(this.add.text(CX, top + 100, this.updateState.status, { ...TEXT, align: 'center', wordWrap: { width: inner } }).setOrigin(0.5, 0).setDepth(3101));
    // The changelog's window: the notes slide under a mask, a thin bar at the right shows where they are
    const area = { x: left, y: top + 150, w: inner, h: height - 150 - 150 };
    add(this.add.rectangle(area.x - 8, area.y - 8, area.w + 16, area.h + 16, 0x000000, 0.35).setOrigin(0).setDepth(3100).setStrokeStyle(1, 0x6a5a3a, 0.8));
    const notes = add(this.add.text(area.x, area.y, this.updateState.notes, { ...MUTED, fontSize: '15px', align: 'left', wordWrap: { width: area.w - 24 }, lineSpacing: 4 }).setOrigin(0, 0).setDepth(3101));
    const shape = this.make.graphics({ x: 0, y: 0 }, false).fillRect(area.x, area.y, area.w, area.h);
    notes.setMask(shape.createGeometryMask());
    this.parts.push(shape);
    const bar = add(this.add.graphics().setDepth(3102));
    this.updateNotes = { text: notes, bar, area, scroll: 0 };
    this.scrollNotes(0);
    this.updateTexts = { status, notes };
    const u = this.updateState;
    const items: [string, () => void][] = [];
    if (u.check?.state === 'available' && !u.downloaded && !u.downloading) items.push([`Download v${u.check.version}`, () => this.downloadUpdate()]);
    if (u.downloaded) items.push(['Restart and install', () => this.api.updateInstall()]);
    items.push(['Check again', () => void this.checkUpdate()]);
    items.push(['Back', () => this.go('main')]);
    const bw = 220;
    items.forEach(([label, onClick], i) => {
      const x = CX + (i - (items.length - 1) / 2) * (bw + 14);
      if (d2) this.parts.push(...stoneButton(this, x, top + height - 70, label, onClick, { size: 'med', width: bw, fontSize: 15 }));
      else this.parts.push(...button(this, x - bw / 2, top + height - 88, { label, onClick, width: bw }));
    });
    if (!u.check && !u.checking) void this.checkUpdate();
  }

  /** Scrolls the changelog by `dy` wheel pixels (0 only redraws the bar) and keeps it inside its window. */
  private scrollNotes(dy: number): void {
    const n = this.updateNotes;
    if (!n || this.page !== 'update' || !n.text.active) return;
    const overflow = Math.max(0, n.text.height - n.area.h);
    n.scroll = Math.max(0, Math.min(overflow, n.scroll + dy * 0.5));
    n.text.setY(n.area.y - n.scroll);
    const g = n.bar.clear();
    if (overflow <= 0) return;
    const x = n.area.x + n.area.w - 6;
    g.fillStyle(0x000000, 0.5).fillRect(x, n.area.y, 4, n.area.h);
    const knob = Math.max(24, (n.area.h * n.area.h) / n.text.height);
    g.fillStyle(0x8c7448, 1).fillRect(x, n.area.y + ((n.area.h - knob) * n.scroll) / overflow, 4, knob);
  }

  private async checkUpdate(): Promise<void> {
    this.updateState = { ...this.updateState, checking: true, status: 'Checking for updates...', notes: '' };
    this.refreshUpdate();
    const check = await this.api.updateCheck();
    const status =
      check.state === 'available' ? `Version ${check.version} is available.`
      : check.state === 'current' ? `You have the newest version, ${check.version}.`
      : `Could not check: ${check.message}`;
    this.updateState = { ...this.updateState, checking: false, check, status, notes: check.state === 'available' ? check.notes : '' };
    if (this.page === 'update') this.draw();
  }

  private downloadUpdate(): void {
    this.updateState = { ...this.updateState, downloading: true, status: 'Downloading... 0%' };
    this.draw();
    void this.api.updateDownload().then((r) => {
      if (!r.ok) {
        this.updateState = { ...this.updateState, downloading: false, status: `Download failed: ${r.error ?? 'unknown error'}` };
        if (this.page === 'update') this.draw();
      }
    });
  }

  /** Progress from the main process; the page redraws when the download lands. */
  private onUpdateEvent(e: UpdateEvent): void {
    if (e.kind === 'progress') this.updateState = { ...this.updateState, status: `Downloading... ${e.percent}%` };
    else if (e.kind === 'downloaded') this.updateState = { ...this.updateState, downloading: false, downloaded: true, status: `Version ${e.version} is downloaded. Restart to install it.` };
    else this.updateState = { ...this.updateState, downloading: false, status: `Update failed: ${e.message}` };
    if (this.page !== 'update') return;
    if (e.kind === 'progress') this.refreshUpdate();
    else this.draw();
  }

  private refreshUpdate(): void {
    this.updateTexts?.status.setText(this.updateState.status);
    this.updateTexts?.notes.setText(this.updateState.notes);
    this.scrollNotes(0);
  }

  /** New Game: start over entirely, after a warning. Clears the stash, the inventory, the belt, the best wave and every saved campaign. */
  private drawNewGame(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const top = BUTTONS_TOP - 70;
    add(this.add.rectangle(CX, top + 50, 620, 170, 0x000000, 0.8).setStrokeStyle(1, 0xa03030).setDepth(3000));
    add(this.add.text(CX, top - 10, 'Start over?', { ...TEXT, fontSize: '28px', color: '#e0a0a0' }).setOrigin(0.5).setDepth(3001));
    const warning = ['This clears everything you own: the stash, the inventory and the belt,', 'your best wave, and every saved campaign, single player and multiplayer.', 'There is no undo.'];
    warning.forEach((l, k) => add(this.add.text(CX, top + 30 + k * 28, l, TEXT).setOrigin(0.5).setDepth(3001)));
    const wipe = async () => {
      await saveProfile(this.api, emptyProfile());
      await clearCheckpoint(this.api, 'solo');
      await clearCheckpoint(this.api, 'mp');
      this.profile = emptyProfile();
      this.saved = undefined;
      this.startGame();
    };
    const items: [string, () => void][] = [
      ['Yes, start over', () => void wipe()],
      ['Back', () => this.go('character')],
    ];
    items.forEach(([label, onClick], i) => {
      const y = BUTTONS_TOP + 140 + i * BUTTON_STEP;
      if (d2) this.parts.push(...stoneButton(this, CX, y, label, onClick, { width: 330 }));
      else this.parts.push(...button(this, CX - 180, y - 18, { label, onClick, width: 360 }));
    });
  }

  /** A new campaign, or the saved one carried on from its last act. */
  private startGame(resume?: Checkpoint): void {
    menuMusic(this, false);
    this.registry.set('lootFilter', this.state.lootFilter);
    this.scene.start('Game', (resume ? { resume } : {}) satisfies SoloStart);
  }

  /** D2R's options panel with our settings: name, volume, the D2R folder. */
  private drawOptions(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const height = 760;
    const panel = d2 ? optionsPanel(this, CX, GAME_HEIGHT / 2 - 30, height, 'optionsBg') : undefined;
    if (panel) add(panel);
    const w = panel ? panel.displayWidth : 760;
    const top = GAME_HEIGHT / 2 - 30 - height / 2;
    const left = CX - w / 2 + w * 0.12;
    const med = (x: number, y: number, label: string, onClick: () => void, width: number, enabled = true) => {
      if (d2) this.parts.push(...stoneButton(this, x + width / 2, y + 18, label, onClick, { size: 'med', width, enabled, fontSize: 18 }));
      else this.parts.push(...button(this, x, y, { label, onClick, width, enabled }));
    };
    let y = top + 70;
    add(this.add.text(CX, y, 'Options', { ...TEXT, fontSize: '34px', color: '#c7b377' }).setOrigin(0.5).setDepth(3101));
    y += 70;

    add(this.add.text(left, y, 'Your name in multiplayer games', MUTED).setDepth(3101));
    y += 30;
    this.nameField = new TextField(this, left, y, 360, {
      value: this.state.name,
      maxLength: 20,
      onChange: (v) => {
        this.state = { ...this.state, name: v };
        void this.api.setName(v);
      },
    });
    for (const p of this.nameField.parts) (p as unknown as Phaser.GameObjects.Components.Depth).setDepth(3101);
    y += 64;

    add(this.add.text(left, y, 'Volume', MUTED).setDepth(3101));
    y += 30;
    const volume = this.state.volume;
    med(left, y, '-', () => void this.setVolume(volume - 10), 130, volume > 0);
    add(this.add.text(left + 175, y + 6, `${volume}`, TEXT).setDepth(3101));
    med(left + 240, y, '+', () => void this.setVolume(volume + 10), 130, volume < 100);
    y += 70;

    add(this.add.text(left, y, 'Loot filter: what a cleared wave collects (Alt shows every label)', MUTED).setDepth(3101));
    y += 30;
    const filter = this.state.lootFilter;
    med(left, y, filter === 'all' ? 'Everything' : 'Magic and better', () => void this.setLootFilter(filter === 'all' ? 'default' : 'all'), 260);
    y += 64;

    add(this.add.text(left, y, 'Gold on kill: the gold each kill pays, floating over the corpse', MUTED).setDepth(3101));
    y += 30;
    const gold = this.state.goldNumbers !== false;
    med(left, y, gold ? 'Shown' : 'Hidden', () => void this.setGoldNumbers(!gold), 260);
    y += 64;

    add(this.add.text(left, y, 'Diablo II: Resurrected folder', MUTED).setDepth(3101));
    y += 30;
    add(this.add.text(left, y, this.state.d2rPath ? shortPath(this.state.d2rPath, 48) : 'Not set', TEXT).setDepth(3101));
    y += 50;
    med(left, y, 'Extract again', () => this.scene.start('Setup', { force: true }), 260);
    med(left + 300, y, 'Open log folder', () => void this.api.openLogFolder(), 260);
    y += 80;

    const back = () => this.go('main');
    if (d2) this.parts.push(...stoneButton(this, CX, top + height - 60, 'Back', back, { width: 300 }));
    else this.parts.push(...button(this, CX - 150, y, { label: 'Back', onClick: back, width: 300 }));
  }
}
