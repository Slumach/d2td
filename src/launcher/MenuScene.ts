// Main menu, dressed as D2R's logo screen: black, the burning logo with TOWER DEFENSE
// under it, and D2's stone buttons stacked down the middle: Single Player, Multiplayer
// (Host or Join), Continue when there is a save, Options, Exit. Single Player opens a page
// in the manner of D2's character select: the player's profile (name, the stash's worth,
// the best wave reached) with Play and Continue. Options opens D2R's options panel for
// volume, name and the D2R folder. Battle Mode opens its own page: the battle record, the
// mode (a battle or co-op), team size and race, then Play against bots, Host or Join.
// Without the frontend art (an extraction from before it existed) the plain look stands in.

import Phaser from 'phaser';

import type { BattleStart, SoloStart } from '../render/GameScene.ts';
import { FONT, button } from '../render/ui.ts';
import { clearCheckpoint, loadCheckpoint } from '../render/saves.ts';
import type { Checkpoint } from '../sim/checkpoint.ts';
import { stageName } from '../sim/data.ts';
import { buildItemData, type ItemData } from '../sim/items/data.ts';
import { itemCost, SELL_DIVISOR } from '../sim/items/price.ts';
import type { Tables } from '../sim/tables.ts';
import { emptyProfile, loadProfile, saveProfile, type Profile } from './profile.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../render/layout.ts';
import type { LauncherApi, LauncherState, UpdateCheck, UpdateEvent } from './api.ts';
import { burningLogo, frontendManifest, menuMusic, optionsPanel, preloadFrontend, smoothHd, stoneButton } from './frontend.ts';
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

/** Battle Mode's lobby choices, kept while the menu is open. */
export interface BattleChoice {
  mode: 'battle' | 'coop';
  teamSize: number;
  /** A class id, or 'random'. */
  race: string;
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
  /** The profile, for the character page. */
  private profile: Profile | undefined;
  private items: ItemData | undefined;
  /** Battle Mode's choices on its page. */
  private battle: BattleChoice = { mode: 'battle', teamSize: 1, race: 'random' };

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
    for (const o of this.logo) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(this.page !== 'options');
    add(this.add.text(16, GAME_HEIGHT - 28, `v${this.state.version}   non-commercial fan project, not affiliated with Blizzard`, { ...MUTED, fontSize: '14px' }).setDepth(3100));

    if (this.page === 'options') return this.drawOptions(d2);
    if (this.page === 'character') return this.drawCharacter(d2);
    if (this.page === 'newgame') return this.drawNewGame(d2);
    if (this.page === 'update') return this.drawUpdate(d2);
    if (this.page === 'battle') return this.drawBattle(d2);
    const saved = this.saved;
    const items: [string, () => void][] =
      this.page === 'multiplayer'
        ? [
            ['Host Game', () => this.scene.start('Lobby', { role: 'host' })],
            ['Join Game', () => this.scene.start('Lobby', { role: 'join' })],
            ['Back', () => this.go('main')],
          ]
        : [
            ['Single Player', () => this.go('character')],
            ['Battle Mode', () => this.go('battle')],
            ['Multiplayer', () => this.go('multiplayer')],
            ...(saved ? [[`Continue: ${stageName(saved.difficulty, saved.act)}`, () => this.startGame(saved)] as [string, () => void]] : []),
            ['Options', () => this.go('options')],
            ['Update', () => this.go('update')],
            ['Exit', () => this.api.quit()],
          ];
    // Seven buttons close up so the last stays on screen
    const step = Math.min(BUTTON_STEP, Math.floor((GAME_HEIGHT - 70 - BUTTONS_TOP) / Math.max(1, items.length - 1)));
    items.forEach(([label, onClick], i) => {
      const y = BUTTONS_TOP + i * step;
      if (d2) this.parts.push(...stoneButton(this, CX, y, label, onClick, { width: 330 }));
      else this.parts.push(...button(this, CX - 180, y - 18, { label, onClick, width: 360 }));
    });
  }

  /**
   * Battle Mode: the profile's battle record, the choices (a battle or co-op, players a
   * team, race), and Play against bots, Host and Join. Bots fill every seat no player takes.
   */
  private drawBattle(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const b = this.battle;
    const r = this.profile?.battle;
    const top = BUTTONS_TOP - 70;
    add(this.add.rectangle(CX, top + 30, 620, 130, 0x000000, 0.75).setStrokeStyle(1, 0x7a6440).setDepth(3000));
    add(this.add.text(CX, top - 10, 'Battle Mode', { ...TEXT, fontSize: '28px', color: '#c7b377' }).setOrigin(0.5).setDepth(3001));
    const record = r ? `Won ${r.wins}, lost ${r.losses}${r.draws ? `, drawn ${r.draws}` : ''}; best wave ${r.bestWave || 'none yet'}` : 'Reading the profile...';
    add(this.add.text(CX, top + 28, record, TEXT).setOrigin(0.5).setDepth(3001));
    const about = b.mode === 'battle' ? 'Two teams, a lane each; first Worldstone to fall loses' : 'One team against 21 waves, sends on a timer';
    add(this.add.text(CX, top + 60, about, MUTED).setOrigin(0.5).setDepth(3001));
    const size = `${b.teamSize}v${b.teamSize}`;
    const items: [string, () => void][] = [
      [b.mode === 'battle' ? `Mode: Battle ${size}` : `Mode: Co-op, ${b.teamSize} ${b.teamSize === 1 ? 'player' : 'players'}`, () => ((this.battle = { ...b, mode: b.mode === 'battle' ? 'coop' : 'battle' }), this.draw())],
      ['Players a team: ' + b.teamSize, () => ((this.battle = { ...b, teamSize: (b.teamSize % 4) + 1 }), this.draw())],
      [`Race: ${RACE_NAMES[b.race] ?? b.race}`, () => ((this.battle = { ...b, race: ['random', ...RACES][(['random', ...RACES].indexOf(b.race) + 1) % (RACES.length + 1)]! }), this.draw())],
      ['Play against bots', () => this.startBattle()],
      ['Host online', () => this.scene.start('Lobby', { role: 'host', battle: this.battle })],
      ['Join online', () => this.scene.start('Lobby', { role: 'join' })],
      ['Back', () => this.go('main')],
    ];
    // Seven choices: the medium stones, which stack without overlapping
    items.forEach(([label, onClick], i) => {
      const y = BUTTONS_TOP + 75 + i * 60;
      if (d2) this.parts.push(...stoneButton(this, CX, y, label, onClick, { size: 'med', width: 350, fontSize: 18 }));
      else this.parts.push(...button(this, CX - 190, y - 18, { label, onClick, width: 380 }));
    });
  }

  /** A battle with this player in the first seat and bots in every other. */
  private startBattle(): void {
    menuMusic(this, false);
    const b = this.battle;
    const slots = b.teamSize * (b.mode === 'battle' ? 2 : 1);
    const races = Array.from({ length: slots }, (_, p) => (p === 0 && b.race !== 'random' ? b.race : 'random'));
    const bots = Array.from({ length: slots - 1 }, (_, i) => i + 1);
    this.scene.start('Game', { battle: { mode: b.mode, setup: { teamSize: b.teamSize, races, bots } } } satisfies BattleStart);
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

  /** The update page: asks the feed, shows the version and notes, downloads, installs on restart. */
  private drawUpdate(d2: boolean): void {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const top = BUTTONS_TOP - 70;
    add(this.add.rectangle(CX, top + 70, 680, 230, 0x000000, 0.8).setStrokeStyle(1, 0x7a6440).setDepth(3000));
    add(this.add.text(CX, top - 10, `Update   (this is v${this.state.version})`, { ...TEXT, fontSize: '28px', color: '#c7b377' }).setOrigin(0.5).setDepth(3001));
    const status = add(this.add.text(CX, top + 30, this.updateState.status, { ...TEXT, align: 'center', wordWrap: { width: 640 } }).setOrigin(0.5, 0).setDepth(3001));
    const notes = add(this.add.text(CX, top + 70, this.updateState.notes, { ...MUTED, fontSize: '15px', align: 'left', wordWrap: { width: 640 } }).setOrigin(0.5, 0).setDepth(3001));
    this.updateTexts = { status, notes };
    const u = this.updateState;
    const items: [string, () => void][] = [];
    if (u.check?.state === 'available' && !u.downloaded && !u.downloading) items.push([`Download v${u.check.version}`, () => this.downloadUpdate()]);
    if (u.downloaded) items.push(['Restart and install', () => this.api.updateInstall()]);
    items.push(['Check again', () => void this.checkUpdate()]);
    items.push(['Back', () => this.go('main')]);
    items.forEach(([label, onClick], i) => {
      const y = BUTTONS_TOP + 190 + i * BUTTON_STEP;
      if (d2) this.parts.push(...stoneButton(this, CX, y, label, onClick, { width: 330 }));
      else this.parts.push(...button(this, CX - 180, y - 18, { label, onClick, width: 360 }));
    });
    if (!u.check && !u.checking) void this.checkUpdate();
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
