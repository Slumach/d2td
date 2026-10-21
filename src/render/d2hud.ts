// The in-game HUD as D2's control panel, from the player's files (ui/hud): the stone bar
// across the bottom with the angel's life globe on the left draining as lives go, gold in
// the long slot, the wave counter over the centre with the next wave on hover, build
// buttons as skill icons in the belt slots, and the selected tower in a small stone panel.
// GameScene decides what to show; this only draws it.

import Phaser from 'phaser';

import { frontendManifest, stoneButton, stonePanel } from '../launcher/frontend.ts';
import { GAME_HEIGHT, GAME_WIDTH } from './layout.ts';
import { FONT, createTooltip, type Tooltip } from './ui.ts';

export const HUD_KEY = 'hud:manifest';
export const hudKey = (name: string) => `hud:${name}`;
const GLOBE_ANIM = 'hud:globe';

interface Sheet {
  image: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
}

export interface HudManifest {
  panel: Sheet;
  globe: Sheet;
  gold: Sheet;
  slot: Sheet;
}

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
  return m && Object.keys(m).every((k) => scene.textures.exists(hudKey(k))) && frontendManifest(scene) ? m : undefined;
}

/** Where things sit on D2R's front_panel, in its own pixels (2822 x 415). */
const SPOTS = {
  globe: { x: 440, y: 198, r: 165 },
  gold: { x: 700, y: 334 },
  wave: { x: 1420, y: 128 },
  belt: { xs: [1727, 1852, 1978, 2104], y: 337, size: 112 },
};
/** The stone bar's top edge in panel pixels; above it the panel is open except for the statues. */
const BAR_TOP = 150;

export interface HudNumbers {
  gold: number;
  lives: number;
  maxLives: number;
  wave: number;
  waves: number;
  /** The next wave's tooltip, or undefined after the last. */
  nextWave?: { title: string; body: string };
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

export class D2Hud {
  private readonly scale: number;
  private readonly panelHeight: number;
  private readonly globe: Phaser.GameObjects.Sprite;
  private readonly globeTop: number;
  private readonly globeSize: number;
  private readonly livesText: Phaser.GameObjects.Text;
  private readonly goldText: Phaser.GameObjects.Text;
  private readonly waveText: Phaser.GameObjects.Text;
  readonly tooltip: Tooltip;
  private nextWave: HudNumbers['nextWave'];
  private slots: Phaser.GameObjects.GameObject[] = [];
  private towerParts: Phaser.GameObjects.GameObject[] = [];
  private lastLivesFrac = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    m: HudManifest,
    onCallWave: () => void,
  ) {
    for (const name of Object.keys(m)) scene.textures.get(hudKey(name)).setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.scale = GAME_WIDTH / m.panel.frameWidth;
    this.panelHeight = m.panel.frameHeight;
    const at = (x: number, y: number) => this.at(x, y);

    // The life globe's liquid sits under the panel's glass, drained from the top
    if (!scene.anims.exists(GLOBE_ANIM)) scene.anims.create({ key: GLOBE_ANIM, frames: scene.anims.generateFrameNumbers(hudKey('globe')), frameRate: 12, repeat: -1 });
    const g = at(SPOTS.globe.x, SPOTS.globe.y);
    this.globeSize = SPOTS.globe.r * 2 * this.scale;
    this.globe = scene.add.sprite(g.x, g.y, hudKey('globe')).setDisplaySize(this.globeSize, this.globeSize).setDepth(2899).play(GLOBE_ANIM);
    this.globeTop = g.y - this.globeSize / 2;
    const panel = scene.add.image(0, GAME_HEIGHT, hudKey('panel')).setOrigin(0, 1).setScale(this.scale).setDepth(2900);
    // Clicks on the panel's stone never reach the map; its open parts let them through
    panel.setInteractive({ pixelPerfect: true, alphaTolerance: 1 });
    // The globe glass in the art is dark; the liquid shows through it
    this.globe.setDepth(2902).setBlendMode(Phaser.BlendModes.SCREEN);

    const big = { fontFamily: FONT, fontSize: '28px', color: '#f0e6d0' };
    this.livesText = scene.add.text(g.x, g.y, '', big).setOrigin(0.5).setDepth(2903).setShadow(2, 2, '#000000', 3);

    const gold = at(SPOTS.gold.x, SPOTS.gold.y);
    const coin = scene.add.image(gold.x, gold.y, hudKey('gold')).setDisplaySize(38, 38).setDepth(2903);
    this.goldText = scene.add.text(coin.x + 28, gold.y, '', { ...big, fontSize: '24px', color: '#e6c868' }).setOrigin(0, 0.5).setDepth(2903).setShadow(1, 1, '#000000', 2);

    const wave = at(SPOTS.wave.x, SPOTS.wave.y);
    this.waveText = scene.add
      .text(wave.x, wave.y, '', { ...big, fontSize: '24px', color: '#e8b45a' })
      .setOrigin(0.5)
      .setDepth(2903)
      .setStroke('#140a04', 4)
      .setInteractive({ useHandCursor: false });
    this.tooltip = createTooltip(scene, 0, 0);
    const waveTip = createTooltip(scene, wave.x - 170, wave.y - 22);
    this.waveText.on('pointerover', () => this.nextWave && waveTip.show(this.nextWave.title, this.nextWave.body));
    this.waveText.on('pointerout', () => waveTip.hide());

    stoneButton(scene, GAME_WIDTH - 158, 44, 'Call Wave', onCallWave, { width: 280 });
  }

  /** Screen position of a point on the panel art. */
  private at(x: number, y: number): { x: number; y: number } {
    return { x: x * this.scale, y: GAME_HEIGHT - (this.panelHeight - y) * this.scale };
  }

  /** True where the panel covers the map: the bar, and the globes with their statues. */
  covers(x: number, y: number): boolean {
    if (y >= this.at(0, BAR_TOP).y) return true;
    const left = this.at(SPOTS.globe.x, SPOTS.globe.y);
    const r = (SPOTS.globe.r + 40) * this.scale;
    return Math.hypot(x - left.x, y - left.y) < r || Math.hypot(x - (GAME_WIDTH - left.x), y - left.y) < r;
  }

  update(n: HudNumbers): void {
    this.goldText.setText(String(n.gold));
    this.livesText.setText(String(n.lives));
    this.waveText.setText(`Wave ${n.wave}/${n.waves}`);
    this.nextWave = n.nextWave;
    const frac = Math.max(0, Math.min(1, n.lives / Math.max(1, n.maxLives)));
    if (frac !== this.lastLivesFrac) {
      this.lastLivesFrac = frac;
      // Crop in texture pixels: keep the bottom `frac` of the liquid
      const h = this.globe.frame.height;
      const keep = Math.round(h * frac);
      this.globe.setCrop(0, h - keep, this.globe.frame.width, keep);
    }
  }

  /** The belt slots: build choices, or nothing. */
  setSlots(items: SlotItem[]): void {
    for (const o of this.slots) o.destroy();
    this.slots = [];
    this.tooltip.hide();
    const size = SPOTS.belt.size * this.scale;
    items.slice(0, SPOTS.belt.xs.length).forEach((item, i) => {
      const p = this.at(SPOTS.belt.xs[i]!, SPOTS.belt.y);
      const icon = item.icon && this.scene.textures.exists(item.icon) ? this.scene.add.image(p.x, p.y, item.icon) : this.scene.add.rectangle(p.x, p.y, size, size, 0x3a2c1c);
      icon.setDisplaySize(size - 6, size - 6).setDepth(2904).setAlpha(item.enabled ? 1 : 0.4);
      if (icon instanceof Phaser.GameObjects.Image) icon.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
      const frame = this.scene.add.image(p.x, p.y, hudKey('slot'), 0).setDisplaySize(size + 4, size + 4).setDepth(2905).setVisible(false);
      icon.setInteractive({ useHandCursor: item.enabled });
      icon.on('pointerover', () => {
        frame.setVisible(true);
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
      this.slots.push(icon, frame);
    });
    // The shared tooltip sits just above the belt
    this.moveTooltip(this.at(SPOTS.belt.xs[0]!, 0).x - 40, this.at(0, BAR_TOP).y - 6);
  }

  private moveTooltip(x: number, bottom: number): void {
    this.tooltip.move(x, bottom);
  }

  /** The selected tower's stone panel, or none. */
  setTowerPanel(model: TowerPanelModel | undefined): void {
    for (const o of this.towerParts) o.destroy();
    this.towerParts = [];
    if (!model) return;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.towerParts.push(o), o);
    const left = 16;
    const width = 380;
    const rows = Math.ceil(model.buttons.length / 2);
    const height = 136 + model.lines.length * 24 + rows * 52;
    const top = this.at(0, BAR_TOP).y - height - 30;
    const panel = stonePanel(this.scene, left + width / 2, top + height / 2, width, height);
    if (panel) add(panel.setInteractive());
    if (model.icon && this.scene.textures.exists(model.icon)) {
      const icon = add(this.scene.add.image(left + 52, top + 58, model.icon).setDisplaySize(56, 56).setDepth(3101));
      icon.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }
    add(this.scene.add.text(left + 92, top + 40, model.title, { fontFamily: FONT, fontSize: '20px', color: '#e8b45a', wordWrap: { width: width - 120 } }).setDepth(3101));
    let y = top + 100;
    for (const line of model.lines) {
      add(this.scene.add.text(left + 30, y, line, { fontFamily: FONT, fontSize: '16px', color: '#d8d0b8', wordWrap: { width: width - 60 } }).setDepth(3101));
      y += 24;
    }
    y += 16;
    model.buttons.forEach((b, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      for (const o of stoneButton(this.scene, left + 30 + 82 + col * 166, y + 18 + row * 52, b.label, b.onClick, { size: 'med', width: 160, enabled: b.enabled, fontSize: 13 })) add(o);
    });
  }
}
