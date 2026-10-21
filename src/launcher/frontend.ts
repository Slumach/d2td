// D2's frontend art and sounds for the menus: the stone backdrop, the flame strip, stone
// buttons and the modal panel, all from the extraction (ui/frontend/frontend.json), plus the
// click, hover and title music from the sound manifest.

import Phaser from 'phaser';

import { SOUND_MANIFEST, type SoundManifest } from '../render/sound.ts';
import { FONT } from '../render/ui.ts';

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
}

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
    });
    img.on('pointerout', () => {
      img.setFrame(0);
      text.setColor('#d8c89a');
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
