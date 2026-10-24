// The in-game HUD as D2R's control panel, from the player's files (ui/hud), laid out from
// D2R's own layout (global/ui/layouts/hudpanelhd.json) and drawn at the size D2R draws it
// at 1080p: the stone bar across the bottom with the angel's life globe and the demon's
// mana globe, the two skill buttons either side of the centre, the four belt slots, the
// run/walk button, the stamina and experience bars and the row of mini-menu buttons.
//
// What they mean here: the life globe starts full and drains as the alive weight on the
// ring rises, empty being the loss, and its number is the alive weight over the limit; the
// mana globe fills with this player's share of every kill in the game (full alone) and its
// number is the game's kill count; the old meaning (the globe fills with the alive weight
// on the ring and its number is that weight (full is the loss). The skill buttons show the
// selected tower's line skills with its level in the corner. The belt holds gems, runes
// and jewels. The stamina bar drains with the wave timer, the experience bar fills across
// the act. Build choices open as D2R's skill-select tray over the panel; the selected
// tower gets a stone panel. GameScene decides what to show; this only draws it.

import Phaser from 'phaser';

import { HD_SCALE, frontendManifest, stoneButton, stonePanel } from '../launcher/frontend.ts';
import { GAME_HEIGHT, GAME_WIDTH, HUD_HEIGHT } from './layout.ts';
import { FONT, createTooltip, type Tooltip } from './ui.ts';

export const HUD_KEY = 'hud:manifest';
export const hudKey = (name: string) => `hud:${name}`;

interface Sheet {
  image: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
}

export type HudManifest = Record<string, Sheet>;

/** The sheets the panel cannot do without; the rest are drawn when present. */
const REQUIRED = ['panel', 'globe', 'slot'];

export function preloadHud(scene: Phaser.Scene): void {
  if (scene.cache.json.exists(HUD_KEY)) return;
  scene.load.json(HUD_KEY, 'ui/hud/hud.json');
  scene.load.once(`filecomplete-json-${HUD_KEY}`, (_k: string, _t: string, m: HudManifest) => {
    for (const [name, s] of Object.entries(m)) {
      if (!scene.textures.exists(hudKey(name))) scene.load.spritesheet(hudKey(name), s.image, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    }
  });
}

/** The HUD art and the frontend's stone buttons, or undefined to keep the plain panel. */
export function hudManifest(scene: Phaser.Scene): HudManifest | undefined {
  const m = scene.cache.json.get(HUD_KEY) as HudManifest | undefined;
  return m && REQUIRED.every((k) => m[k] && scene.textures.exists(hudKey(k))) && frontendManifest(scene) ? m : undefined;
}

/**
 * Where things sit on D2R's front_panel (2822 x 415), in its own pixels, from
 * hudpanelhd.json with the overlay's 34 px offset taken off. Rects are top-left corners.
 */
const LAYOUT = {
  /** The liquids' 348 x 350 frames; the glass is part of the panel art. */
  health: { x: 260, y: 65, size: 348 },
  mana: { x: 2234, y: 65, size: 348 },
  /** The value text's line above each globe. */
  valueY: 35,
  leftSkill: { x: 1223, y: 271 },
  rightSkill: { x: 1494, y: 271 },
  skillSize: 130,
  belt: { xs: [1727, 1852, 1978, 2104], y: 337, size: 112 },
  beltArrow: { x: 1661, y: 253 },
  run: { x: 685, y: 281 },
  stamina: { x: 731, y: 292 },
  exp: { x: 660, y: 234 },
  /** The mini-menu row, left to right as D2R orders it. */
  menu: { y: 324, size: 72, buttons: [['character', 680], ['skilltree', 751], ['questlog', 824], ['inventory', 894], ['automap', 964], ['messages', 1034], ['pausemenu', 1104]] as [string, number][] },
};
/** The stone bar's top edge in panel pixels; above it the panel is open except for the statues. */
const BAR_TOP = 150;
const GLOBE_ANIM = 'hud:globe';
const MANA_ANIM = 'hud:globemana';
const DEPTH = { liquid: 2899, panel: 2900, over: 2903, frame: 2905 };

export interface HudNumbers {
  gold: number;
  /** The game's kills in all, and this player's share of them, 0 to 1 (1 alone). */
  kills: number;
  killShare: number;
  /** The alive weight on the ring, and the limit that loses the run (100 for each player sharing it). */
  alive: number;
  aliveLimit: number;
  /** "Normal Act 1 3/6", the stage line under the bar. */
  wave: string;
  /** "Next wave in 23 s, send now for 46 gold", or empty. */
  timer: string;
  /** Time left on the wave timer, 0 to 1 (the stamina bar), and how far through the act (the experience bar). */
  timerFrac: number;
  actFrac: number;
  /** The next wave's tooltip, or undefined after the last. */
  nextWave?: { title: string; body: string };
  /** What the life globe's number says, when it is not the alive weight (Battle Mode: the Worldstone). */
  lifeLabel?: string;
}

export interface SlotItem {
  icon?: string;
  title: string;
  body: string;
  enabled: boolean;
  onClick: () => void;
}

export interface PanelButton {
  label: string;
  enabled: boolean;
  onClick: () => void;
}

export interface TowerPanelModel {
  icon?: string;
  title: string;
  lines: string[];
  buttons: PanelButton[];
}

/** What a skill button shows: the skill's icon, the tower's level in the corner, and its tooltip. */
export interface SkillSlot {
  icon?: string;
  level: number;
  title: string;
  body: string;
}

export interface HudCallbacks {
  onCallWave: () => void;
  /** False hides Send Wave (Battle Mode: the match starts every wave). */
  sendWave?: boolean;
  onInventory: () => void;
  onAutomap: () => void;
  onParty: () => void;
  onMenu: () => void;
}

const MENU_TIPS: Record<string, [string, string]> = {
  character: ['Character', 'Not in Tower Defense'],
  skilltree: ['Skill Tree', 'A tower’s skills are on the tower: click one'],
  questlog: ['Quest Log', 'Not in Tower Defense'],
  inventory: ['Inventory', 'I'],
  automap: ['Automap', 'M'],
  messages: ['Party', 'Tab'],
  pausemenu: ['Menu', 'Esc'],
};

export class D2Hud {
  /** Panel pixels to screen pixels. */
  private readonly scale = HD_SCALE;
  private readonly left: number;
  private readonly top: number;
  private readonly health: Phaser.GameObjects.Sprite;
  private readonly mana: Phaser.GameObjects.Sprite;
  private readonly killsText: Phaser.GameObjects.Text;
  private readonly goldText: Phaser.GameObjects.Text;
  private readonly aliveText: Phaser.GameObjects.Text;
  private readonly stageText: Phaser.GameObjects.Text;
  private readonly timerText: Phaser.GameObjects.Text;
  private readonly stamina: Phaser.GameObjects.Image | undefined;
  private readonly exp: Phaser.GameObjects.Image | undefined;
  readonly tooltip: Tooltip;
  private nextWave: HudNumbers['nextWave'];
  private slots: Phaser.GameObjects.GameObject[] = [];
  private tabs: Phaser.GameObjects.GameObject[] = [];
  private towerParts: Phaser.GameObjects.GameObject[] = [];
  private skillParts: Phaser.GameObjects.GameObject[] = [];
  private lastHealth = -1;
  private lastMana = -1;
  private lastStamina = -1;
  private lastExp = -1;
  private running = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly m: HudManifest,
    private readonly on: HudCallbacks,
  ) {
    for (const name of Object.keys(m)) if (scene.textures.exists(hudKey(name))) scene.textures.get(hudKey(name)).setFilter(Phaser.Textures.FilterMode.LINEAR);
    const panelW = m.panel!.frameWidth * this.scale;
    this.left = Math.round((GAME_WIDTH - panelW) / 2);
    this.top = GAME_HEIGHT - m.panel!.frameHeight * this.scale;

    // The liquids sit under the panel's glass, cropped from the top as they empty
    this.health = this.liquid('globe', GLOBE_ANIM, LAYOUT.health, 12);
    this.mana = this.liquid(this.has('globeMana') ? 'globeMana' : 'globe', MANA_ANIM, LAYOUT.mana, 10);
    const panel = scene.add.image(this.left, GAME_HEIGHT, hudKey('panel')).setOrigin(0, 1).setScale(this.scale).setDepth(DEPTH.panel);
    // Clicks on the panel's stone never reach the map; its open parts let them through
    panel.setInteractive({ pixelPerfect: true, alphaTolerance: 1 });

    // D2R's Show Health and Mana Values line: Exocet over each globe
    const value = { fontFamily: FONT, fontSize: '20px', color: '#e6e0d4' };
    const hx = this.at(LAYOUT.health.x + LAYOUT.health.size / 2, LAYOUT.valueY);
    const mx = this.at(LAYOUT.mana.x + LAYOUT.mana.size / 2, LAYOUT.valueY);
    this.killsText = scene.add.text(hx.x, hx.y, '', value).setOrigin(0.5).setDepth(DEPTH.over).setShadow(1, 1, '#000000', 3);
    this.aliveText = scene.add.text(mx.x, mx.y, '', value).setOrigin(0.5).setDepth(DEPTH.over).setShadow(1, 1, '#000000', 3);

    // The stage and the wave timer over the bar's middle, where D2R shows nothing
    const mid = this.at(m.panel!.frameWidth / 2, BAR_TOP);
    this.stageText = scene.add.text(mid.x, mid.y - 36, '', { fontFamily: FONT, fontSize: '16px', color: '#e8b45a' }).setOrigin(0.5).setDepth(DEPTH.over).setShadow(1, 1, '#000000', 2).setInteractive();
    this.timerText = scene.add.text(mid.x, mid.y - 16, '', { fontFamily: FONT, fontSize: '14px', color: '#c8bc98' }).setOrigin(0.5).setDepth(DEPTH.over).setShadow(1, 1, '#000000', 2);
    const waveTip = createTooltip(scene, mid.x - 170, mid.y - 48);
    this.stageText.on('pointerover', () => this.nextWave && waveTip.show(this.nextWave.title, this.nextWave.body));
    this.stageText.on('pointerout', () => waveTip.hide());
    this.tooltip = createTooltip(scene, 0, 0);

    // The bars: experience along the top of the bar, stamina beside the run button
    this.exp = this.has('expBar') ? this.image('expBar', LAYOUT.exp.x, LAYOUT.exp.y) : undefined;
    this.stamina = this.has('staminaBar') ? this.image('staminaBar', LAYOUT.stamina.x, LAYOUT.stamina.y, 1) : undefined;
    if (this.has('staminaBar')) this.image('staminaBar', LAYOUT.stamina.x, LAYOUT.stamina.y, 0).setDepth(DEPTH.over - 1);
    if (this.has('beltArrow')) this.image('beltArrow', LAYOUT.beltArrow.x, LAYOUT.beltArrow.y);
    this.drawRunButton();
    this.drawMiniMenu();
    this.drawBelt();
    this.setSkills(undefined);
    // The right skill slot holds the gold, always: D2's gold pile and the number
    const gp = this.at(LAYOUT.rightSkill.x + LAYOUT.skillSize / 2, LAYOUT.rightSkill.y + LAYOUT.skillSize / 2);
    const gsize = LAYOUT.skillSize * this.scale;
    if (this.has('gold')) {
      const pile = scene.add.image(gp.x, gp.y - gsize * 0.12, hudKey('gold')).setDepth(DEPTH.over);
      pile.setDisplaySize(gsize * 0.55, (gsize * 0.55 * pile.height) / Math.max(1, pile.width));
    }
    this.goldText = scene.add.text(gp.x, gp.y + gsize * 0.3, '', { fontFamily: FONT, fontSize: '17px', color: '#e8c060' }).setOrigin(0.5).setDepth(DEPTH.frame).setShadow(1, 1, '#000000', 2);

    if (on.sendWave !== false) stoneButton(scene, GAME_WIDTH - 158, 44, 'Send Wave', on.onCallWave, { width: 280 });
  }

  private has(name: string): boolean {
    return this.m[name] !== undefined && this.scene.textures.exists(hudKey(name));
  }

  /** Screen position of a point on the panel art. */
  private at(x: number, y: number): { x: number; y: number } {
    return { x: this.left + x * this.scale, y: this.top + y * this.scale };
  }

  /** An image placed by its top-left corner in panel pixels. */
  private image(name: string, x: number, y: number, frame = 0): Phaser.GameObjects.Image {
    const p = this.at(x, y);
    return this.scene.add.image(p.x, p.y, hudKey(name), frame).setOrigin(0).setScale(this.scale).setDepth(DEPTH.over);
  }

  private liquid(name: string, anim: string, spot: { x: number; y: number; size: number }, fps: number): Phaser.GameObjects.Sprite {
    const sheet = this.m[name]!;
    if (!this.scene.anims.exists(anim)) {
      // The sheet wraps into rows; only its first `frames` cells hold frames
      this.scene.anims.create({ key: anim, frames: this.scene.anims.generateFrameNumbers(hudKey(name), { start: 0, end: sheet.frames - 1 }), frameRate: fps, repeat: -1 });
    }
    const p = this.at(spot.x, spot.y);
    return this.scene.add.sprite(p.x, p.y, hudKey(name)).setOrigin(0).setScale(this.scale).setDepth(DEPTH.liquid).play(anim);
  }

  /** Keeps the bottom `frac` of a sprite's frame. */
  private crop(sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, frac: number, fromLeft = false): void {
    const f = Math.max(0, Math.min(1, frac));
    const w = sprite.frame.width;
    const h = sprite.frame.height;
    if (fromLeft) sprite.setCrop(0, 0, Math.round(w * f), h);
    else {
      const keep = Math.round(h * f);
      sprite.setCrop(0, h - keep, w, keep);
    }
  }

  /** True where the panel covers the map: the bar, and the globes with their statues. */
  covers(x: number, y: number): boolean {
    const bar = this.at(0, BAR_TOP);
    const right = this.at(this.m.panel!.frameWidth, 0).x;
    if (y >= bar.y && x >= this.left && x <= right) return true;
    const r = (LAYOUT.health.size / 2 + 40) * this.scale;
    const h = this.at(LAYOUT.health.x + LAYOUT.health.size / 2, LAYOUT.health.y + LAYOUT.health.size / 2);
    const mc = this.at(LAYOUT.mana.x + LAYOUT.mana.size / 2, LAYOUT.mana.y + LAYOUT.mana.size / 2);
    return Math.hypot(x - h.x, y - h.y) < r || Math.hypot(x - mc.x, y - mc.y) < r;
  }

  /** The panel's top edge on screen, for whatever stands just above it. */
  get barTop(): number {
    return this.at(0, BAR_TOP).y;
  }

  update(n: HudNumbers): void {
    // Life over the life globe: what is alive against the limit; kills over the mana globe
    this.killsText.setText(n.lifeLabel ?? `Alive: ${n.alive} / ${n.aliveLimit}`);
    this.aliveText.setText(`Kills: ${n.kills}`);
    this.goldText.setText(n.gold.toLocaleString('en-US'));
    this.stageText.setText(n.wave);
    this.timerText.setText(n.timer);
    this.nextWave = n.nextWave;
    const health = Math.max(0, Math.min(1, 1 - n.alive / Math.max(1, n.aliveLimit)));
    if (health !== this.lastHealth) {
      this.lastHealth = health;
      this.crop(this.health, health);
    }
    const mana = Math.max(0, Math.min(1, n.killShare));
    if (mana !== this.lastMana) {
      this.lastMana = mana;
      this.crop(this.mana, mana);
    }
    if (this.stamina && n.timerFrac !== this.lastStamina) {
      this.lastStamina = n.timerFrac;
      this.crop(this.stamina, n.timerFrac, true);
    }
    if (this.exp && n.actFrac !== this.lastExp) {
      this.lastExp = n.actFrac;
      this.crop(this.exp, n.actFrac, true);
    }
  }

  /** A square button from a frames sheet: normal, pressed and hover frames, a tooltip, and a click. */
  private button(name: string, x: number, y: number, frames: [number, number, number], tip: [string, string], onClick?: () => void): Phaser.GameObjects.Image {
    const img = this.image(name, x, y, frames[0]).setInteractive({ useHandCursor: onClick !== undefined });
    img.on('pointerover', () => {
      img.setFrame(frames[2]);
      const b = img.getBounds();
      this.tooltip.move(b.centerX - 60, b.top - 6);
      this.tooltip.show(tip[0], tip[1]);
    });
    img.on('pointerout', () => {
      img.setFrame(frames[0]);
      this.tooltip.hide();
    });
    img.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      img.setFrame(frames[1]);
    });
    img.on('pointerup', () => {
      img.setFrame(frames[2]);
      this.tooltip.hide();
      onClick?.();
    });
    return img;
  }

  private drawMiniMenu(): void {
    const actions: Record<string, () => void> = { inventory: this.on.onInventory, automap: this.on.onAutomap, messages: this.on.onParty, pausemenu: this.on.onMenu };
    for (const [name, x] of LAYOUT.menu.buttons) {
      if (!this.has(name)) continue;
      this.button(name, x, LAYOUT.menu.y, [0, 1, 2], MENU_TIPS[name] ?? [name, ''], actions[name]);
    }
  }

  /** Walk or run: the ring never stops, so this only changes the little figure. */
  private drawRunButton(): void {
    if (!this.has('sprint')) return;
    const img = this.button('sprint', LAYOUT.run.x, LAYOUT.run.y, [0, 1, 2], ['Run / Walk', 'Monsters keep their own pace'], () => {
      this.running = !this.running;
      img.setFrame(this.running ? 3 : 0);
    });
    img.on('pointerout', () => img.setFrame(this.running ? 3 : 0));
    img.on('pointerup', () => img.setFrame(this.running ? 5 : 2));
  }

  /** The belt's slots are drawn and handled by the item panels (itempanels.ts): only their spots live here. */
  private drawBelt(): void {}

  /** Where the four belt slots are on screen: centres and size. */
  beltSpots(): { x: number; y: number; size: number }[] {
    const size = LAYOUT.belt.size * this.scale;
    return LAYOUT.belt.xs.map((bx) => ({ ...this.at(bx, LAYOUT.belt.y), size }));
  }

  /** The left and right skill buttons: the selected tower's skills, or the empty squares. */
  /** The left skill slot shows the selected tower's current skill; the right one is the gold readout. */
  setSkills(left: SkillSlot | undefined): void {
    for (const o of this.skillParts) o.destroy();
    this.skillParts = [];
    const size = LAYOUT.skillSize * this.scale;
    for (const [spot, slot] of [[LAYOUT.leftSkill, left]] as const) {
      const p = this.at(spot.x + LAYOUT.skillSize / 2, spot.y + LAYOUT.skillSize / 2);
      if (!slot) continue;
      const icon = slot.icon && this.scene.textures.exists(slot.icon) ? this.scene.add.image(p.x, p.y, slot.icon) : this.scene.add.rectangle(p.x, p.y, size, size, 0x2a2018);
      icon.setDisplaySize(size, size).setDepth(DEPTH.over).setInteractive();
      if (icon instanceof Phaser.GameObjects.Image) icon.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      // The level where D2R writes the hotkey
      const level = this.scene.add
        .text(p.x + size / 2 - 4, p.y - size / 2 + 2, String(slot.level), { fontFamily: FONT, fontSize: '15px', color: '#e6e0d4' })
        .setOrigin(1, 0)
        .setDepth(DEPTH.frame)
        .setShadow(1, 1, '#000000', 2);
      icon.on('pointerover', () => {
        this.tooltip.move(p.x - 100, p.y - size / 2 - 8);
        this.tooltip.show(slot.title, slot.body);
      });
      icon.on('pointerout', () => this.tooltip.hide());
      icon.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => e.stopPropagation());
      this.skillParts.push(icon, level);
    }
  }

  /** D2R's skill-select tray over the panel: the build choices as a row of icons. */
  setSlots(items: SlotItem[]): void {
    for (const o of this.slots) o.destroy();
    this.slots = [];
    this.tooltip.hide();
    if (items.length === 0) return;
    const size = LAYOUT.skillSize * this.scale;
    const gap = 10;
    const y = this.barTop - 70;
    const x0 = GAME_WIDTH / 2 - ((items.length - 1) * (size + gap)) / 2;
    items.forEach((item, i) => {
      const x = x0 + i * (size + gap);
      const back = this.scene.add.rectangle(x, y, size + 8, size + 8, 0x000000, 0.55).setDepth(DEPTH.over - 1);
      const icon = item.icon && this.scene.textures.exists(item.icon) ? this.scene.add.image(x, y, item.icon) : this.scene.add.rectangle(x, y, size, size, 0x3a2c1c);
      icon.setDisplaySize(size, size).setDepth(DEPTH.over).setAlpha(item.enabled ? 1 : 0.4);
      if (icon instanceof Phaser.GameObjects.Image) icon.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      const frame = this.scene.add.image(x, y, hudKey('slot'), 1).setDisplaySize(size + 8, size + 8).setDepth(DEPTH.frame).setVisible(false);
      icon.setInteractive({ useHandCursor: item.enabled });
      icon.on('pointerover', () => {
        frame.setVisible(true);
        this.tooltip.move(x - 110, y - size / 2 - 10);
        this.tooltip.show(item.title, item.body);
      });
      icon.on('pointerout', () => {
        frame.setVisible(false);
        this.tooltip.hide();
      });
      if (item.enabled) {
        icon.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          this.tooltip.hide();
          item.onClick();
        });
      }
      this.slots.push(back, icon, frame);
    });
  }

  /** Stone tabs over the tray (the build menu's classes); the chosen one stands out. */
  setTabs(tabs: { label: string; chosen: boolean; onClick: () => void }[]): void {
    for (const o of this.tabs) o.destroy();
    this.tabs = [];
    if (tabs.length === 0) return;
    const y = this.barTop - 130;
    const width = 128;
    tabs.forEach((tab, i) => {
      const x = GAME_WIDTH / 2 + (i - (tabs.length - 1) / 2) * (width + 6);
      const parts = stoneButton(this.scene, x, y, tab.label, tab.onClick, { size: 'med', width, fontSize: 13 });
      for (const o of parts) {
        if (!tab.chosen) (o as Phaser.GameObjects.Image).setAlpha(0.6);
        this.tabs.push(o);
      }
    });
  }

  /**
   * The selected tower's stone panel, or none. The texts are laid out first and measured,
   * so wrapped lines stack without overlapping, and the panel is sized to them; it sits
   * above the life globe, never over it, and never above the top bar.
   */
  setTowerPanel(model: TowerPanelModel | undefined): void {
    for (const o of this.towerParts) o.destroy();
    this.towerParts = [];
    if (!model) return;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.towerParts.push(o), o);
    const left = 16;
    const width = 380;
    const gap = 6;
    const title = add(this.scene.add.text(left + 92, 0, model.title, { fontFamily: FONT, fontSize: '20px', color: '#e8b45a', wordWrap: { width: width - 120 } }).setDepth(3101));
    const lines = model.lines.map((line) => add(this.scene.add.text(left + 30, 0, line, { fontFamily: FONT, fontSize: '16px', color: '#d8d0b8', wordWrap: { width: width - 60 } }).setDepth(3101)));
    const rows = Math.ceil(model.buttons.length / 2);
    const head = Math.max(100, 40 + title.height + 16);
    const body = lines.reduce((n, t) => n + t.height + gap, 0);
    const height = head + body + 16 + rows * 52 + 16;
    // Above the globe's glass, which rises past the bar's top
    const globeTop = this.at(LAYOUT.health.x, LAYOUT.health.y).y;
    const bottom = Math.min(this.barTop - 30, globeTop - 12);
    const top = Math.max(HUD_HEIGHT + 8, bottom - height);
    const panel = stonePanel(this.scene, left + width / 2, top + height / 2, width, height);
    if (panel) add(panel.setInteractive());
    if (model.icon && this.scene.textures.exists(model.icon)) {
      const icon = add(this.scene.add.image(left + 52, top + 58, model.icon).setDisplaySize(56, 56).setDepth(3101));
      icon.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    title.setY(top + 40);
    let y = top + head;
    for (const t of lines) {
      t.setY(y);
      y += t.height + gap;
    }
    y += 16;
    model.buttons.forEach((b, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      for (const o of stoneButton(this.scene, left + 30 + 82 + col * 166, y + 18 + row * 52, b.label, b.onClick, { size: 'med', width: 160, enabled: b.enabled, fontSize: 13 })) add(o);
    });
  }
}
