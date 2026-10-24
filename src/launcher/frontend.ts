// D2's frontend art and sounds for the menus, all from the extraction
// (ui/frontend/frontend.json): the burning logo (D2R's logo animation, its glow and the
// flames under it, with TOWER DEFENSE where RESURRECTED goes), D2R's pause-menu buttons and
// options panels, the stone buttons and modal panel, plus the click, hover and title music
// from the sound manifest. HD art is drawn at half size, the size D2R draws it at 1080p.

import Phaser from 'phaser';

import { SOUND_MANIFEST, type SoundManifest } from '../render/sound.ts';
import { FONT, type Tooltip } from '../render/ui.ts';

export const FRONTEND_KEY = 'frontend:manifest';
export const frontendKey = (name: string) => `frontend:${name}`;

interface Sheet {
  image: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  hd: boolean;
}

export interface FrontendManifest {
  bg: Sheet;
  flames: Sheet | null;
  button: Sheet;
  buttonMed: Sheet;
  panel: Sheet;
  logo: Sheet | null;
  logoAnim: Sheet | null;
  fullGlow: Sheet | null;
  pauseButton: Sheet | null;
  settingsPanel: Sheet | null;
  optionsBg: Sheet | null;
}

/** D2R draws its HD UI at this scale at 1080p; so do we, so it is the size players know. */
export const HD_SCALE = 0.5;

/** Queues the frontend sheets and the menu sounds; safe to call from every menu scene. */
export function preloadFrontend(scene: Phaser.Scene): void {
  if (!scene.cache.json.exists(FRONTEND_KEY)) {
    scene.load.json(FRONTEND_KEY, 'ui/frontend/frontend.json');
    scene.load.once(`filecomplete-json-${FRONTEND_KEY}`, (_k: string, _t: string, m: FrontendManifest) => {
      for (const [name, s] of Object.entries(m)) {
        if (s && !scene.textures.exists(frontendKey(name))) scene.load.spritesheet(frontendKey(name), s.image, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
      }
    });
  }
  const queue = (m: SoundManifest) => {
    for (const path of [...(m.ui?.click ?? []), ...(m.ui?.hover ?? []), ...(m.ui?.music ? [m.ui.music] : [])]) {
      if (!scene.cache.audio.exists(path)) scene.load.audio(path, path);
    }
  };
  const cached = scene.cache.json.get(SOUND_MANIFEST) as SoundManifest | undefined;
  if (cached) queue(cached);
  else {
    scene.load.json(SOUND_MANIFEST, 'sfx/sounds.json');
    scene.load.once(`filecomplete-json-${SOUND_MANIFEST}`, (_k: string, _t: string, m: SoundManifest) => queue(m));
  }
}

export function frontendManifest(scene: Phaser.Scene): FrontendManifest | undefined {
  const m = scene.cache.json.get(FRONTEND_KEY) as FrontendManifest | undefined;
  return m && scene.textures.exists(frontendKey('button')) ? m : undefined;
}

/** HD art is meant to be smoothed when scaled; pixelArt mode defaults every texture to nearest. */
export function smoothHd(scene: Phaser.Scene, m: FrontendManifest): void {
  for (const [name, s] of Object.entries(m)) {
    if (s?.hd && scene.textures.exists(frontendKey(name))) scene.textures.get(frontendKey(name)).setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
}

function uiSound(scene: Phaser.Scene, kind: 'click' | 'hover'): void {
  const m = scene.cache.json.get(SOUND_MANIFEST) as SoundManifest | undefined;
  const path = m?.ui?.[kind]?.[0];
  if (path && scene.cache.audio.exists(path)) scene.sound.play(path, { volume: ((m.volumePct.sfx ?? 70) * (kind === 'click' ? 60 : 30)) / 10000 });
}

/** The title music on the menus: started once and left running from menu to menu. */
export function menuMusic(scene: Phaser.Scene, play: boolean): void {
  const m = scene.cache.json.get(SOUND_MANIFEST) as SoundManifest | undefined;
  const path = m?.ui?.music;
  if (!path || !scene.cache.audio.exists(path)) return;
  const existing = scene.sound.get(path);
  if (play && !existing?.isPlaying) (existing ?? scene.sound.add(path, { loop: true, volume: (m.volumePct.music ?? 30) / 100 })).play();
  if (!play && existing) existing.stop();
}

export interface StoneButtonOptions {
  /** 'main' is the wide menu button, 'med' the smaller one for panels. */
  size?: 'main' | 'med';
  /** Displayed width in game pixels. */
  width?: number;
  enabled?: boolean;
  fontSize?: number;
  /** A line shown in `tooltip` while the pointer rests on the button. */
  hint?: string;
  tooltip?: Tooltip;
}

/** A D2 stone button: normal, hover and pressed frames, Exocet label, D2's click and hover sounds. */
export function stoneButton(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, opts: StoneButtonOptions = {}): Phaser.GameObjects.GameObject[] {
  const m = frontendManifest(scene)!;
  const key = frontendKey(opts.size === 'med' ? 'buttonMed' : 'button');
  const sheet = opts.size === 'med' ? m.buttonMed : m.button;
  const width = opts.width ?? (opts.size === 'med' ? 200 : 300);
  const scale = width / sheet.frameWidth;
  const enabled = opts.enabled ?? true;
  const img = scene.add.image(x, y, key, 0).setScale(scale).setDepth(3100);
  const text = scene.add
    .text(x, y, label.toUpperCase(), { fontFamily: FONT, fontSize: `${opts.fontSize ?? Math.round(sheet.frameHeight * scale * 0.24)}px`, color: enabled ? '#d8c89a' : '#6e6658' })
    .setOrigin(0.5)
    .setDepth(3101)
    .setShadow(1, 1, '#000000', 2);
  if (!enabled) img.setAlpha(0.55);
  else {
    img.setInteractive({ useHandCursor: true });
    img.on('pointerover', () => {
      img.setFrame(1);
      text.setColor('#f2e4b8');
      uiSound(scene, 'hover');
      if (opts.hint && opts.tooltip) {
        opts.tooltip.move(x - 150, y - img.displayHeight / 2 - 4);
        opts.tooltip.show(label, opts.hint);
      }
    });
    img.on('pointerout', () => {
      img.setFrame(0);
      text.setColor('#d8c89a');
      opts.tooltip?.hide();
    });
    img.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      img.setFrame(2);
      text.setY(y + 2);
    });
    img.on('pointerup', () => {
      img.setFrame(1);
      text.setY(y);
      uiSound(scene, 'click');
      onClick();
    });
  }
  return [img, text];
}

/** The stone modal panel centred at (x, y), scaled to `width`. */
export function stonePanel(scene: Phaser.Scene, x: number, y: number, width: number, height: number): Phaser.GameObjects.Image | undefined {
  const m = frontendManifest(scene);
  if (!m) return undefined;
  return scene.add.image(x, y, frontendKey('panel'), 0).setDisplaySize(width, height).setDepth(3050);
}

/** One looping animation per sheet, made on first use. */
function sheetAnim(scene: Phaser.Scene, name: string, sheet: Sheet, fps: number): string {
  const key = `frontend:anim:${name}`;
  if (!scene.anims.exists(key)) {
    scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(frontendKey(name), { start: 0, end: sheet.frames - 1 }), frameRate: fps, repeat: -1 });
  }
  return key;
}

/**
 * D2R's burning logo as its pause menu lays it out (global/ui/layouts/pauselayouthd.json):
 * the glow, the fire over the letters, the line of text under it and the flames beneath,
 * all placed from the layout's own offsets about the centre line `cx`, with `top` the
 * logo widget's top. `scale` 1 is D2R's own 1080p size. TOWER DEFENSE stands where
 * RESURRECTED does. Without the animation the still logo stands in; without any logo
 * art, the title alone.
 */
export function burningLogo(scene: Phaser.Scene, cx: number, top: number, scale: number, depth: number): Phaser.GameObjects.GameObject[] {
  const m = frontendManifest(scene);
  const out: Phaser.GameObjects.GameObject[] = [];
  const s = HD_SCALE * scale;
  const at = (x: number, y: number, w: number, h: number) => ({ x: cx + (x + w / 2) * s, y: top + (y + h / 2) * s });
  if (m?.fullGlow && scene.textures.exists(frontendKey('fullGlow'))) {
    const p = at(-303, 171, m.fullGlow.frameWidth, m.fullGlow.frameHeight);
    out.push(scene.add.sprite(p.x, p.y, frontendKey('fullGlow')).setScale(s).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD).play(sheetAnim(scene, 'fullGlow', m.fullGlow, 20)));
  }
  if (m?.logoAnim && scene.textures.exists(frontendKey('logoAnim'))) {
    const p = at(-292, 141, m.logoAnim.frameWidth, m.logoAnim.frameHeight);
    out.push(scene.add.sprite(p.x, p.y, frontendKey('logoAnim')).setScale(s).setDepth(depth + 1).play(sheetAnim(scene, 'logoAnim', m.logoAnim, 20)));
  } else if (m?.logo && scene.textures.exists(frontendKey('logo'))) {
    const p = at(-337, 101, m.logo.frameWidth, m.logo.frameHeight);
    out.push(scene.add.image(p.x, p.y, frontendKey('logo')).setScale(s).setDepth(depth + 1));
  }
  // RESURRECTED is a 474 x 28 strip at (-239, 473); the title takes its line
  const t = at(-239, 473, 474, 28);
  out.push(
    scene.add
      .text(t.x, t.y, 'TOWER DEFENSE', { fontFamily: FONT, fontSize: `${Math.round(44 * s)}px`, color: '#c9894a' })
      .setOrigin(0.5)
      .setDepth(depth + 2)
      .setLetterSpacing(Math.round(10 * s))
      .setShadow(0, 0, '#ff7a1a', 12 * s, true, true),
  );
  if (m?.flames && scene.textures.exists(frontendKey('flames'))) {
    const p = at(-129, 511, m.flames.frameWidth, m.flames.frameHeight);
    out.push(scene.add.sprite(p.x, p.y, frontendKey('flames')).setScale(s).setDepth(depth + 3).setBlendMode(Phaser.BlendModes.ADD).play(sheetAnim(scene, 'flames', m.flames, 20)));
  }
  return out;
}

/** The logo widget's height in game pixels at `scale`, flames included, for laying out what goes under it. */
export const LOGO_HEIGHT = 545;

export interface PauseButtonOptions {
  enabled?: boolean;
  scale?: number;
}

/**
 * D2R's pause-menu button (frames: normal, pressed, disabled, hover), Exocet label as
 * given (D2R does not upper-case these), at D2R's 1080p size unless scaled.
 */
export function pauseButton(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, opts: PauseButtonOptions = {}): Phaser.GameObjects.GameObject[] {
  const m = frontendManifest(scene);
  if (!m?.pauseButton || !scene.textures.exists(frontendKey('pauseButton'))) return stoneButton(scene, x, y, label, onClick, { width: 330, enabled: opts.enabled });
  const s = HD_SCALE * (opts.scale ?? 1);
  const enabled = opts.enabled ?? true;
  const img = scene.add.image(x, y, frontendKey('pauseButton'), enabled ? 0 : 2).setScale(s).setDepth(3100);
  const text = scene.add
    .text(x, y, label, { fontFamily: FONT, fontSize: `${Math.round(46 * s)}px`, color: enabled ? '#e4dccb' : '#6e6658' })
    .setOrigin(0.5)
    .setDepth(3101)
    .setShadow(1, 1, '#000000', 2);
  if (enabled) {
    img.setInteractive({ useHandCursor: true });
    img.on('pointerover', () => {
      img.setFrame(3);
      text.setColor('#fff4dc');
      uiSound(scene, 'hover');
    });
    img.on('pointerout', () => {
      img.setFrame(0);
      text.setColor('#e4dccb');
    });
    img.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      img.setFrame(1);
      text.setY(y + 1);
    });
    img.on('pointerup', () => {
      img.setFrame(3);
      text.setY(y);
      uiSound(scene, 'click');
      onClick();
    });
  }
  return [img, text];
}

/**
 * D2R's options panel as a backdrop: the in-game settings panel, or the front end's own
 * options panel, centred at (x, y) and scaled to `height`. Undefined without the art.
 */
export function optionsPanel(scene: Phaser.Scene, x: number, y: number, height: number, which: 'settingsPanel' | 'optionsBg'): Phaser.GameObjects.Image | undefined {
  const m = frontendManifest(scene);
  const sheet = m?.[which];
  if (!sheet || !scene.textures.exists(frontendKey(which))) return stonePanel(scene, x, y, height * 1.3, height);
  const scale = height / sheet.frameHeight;
  return scene.add.image(x, y, frontendKey(which), 0).setScale(scale).setDepth(3050);
}
