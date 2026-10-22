// Starts the game: a Phaser instance running GameScene, the Electron launcher's setup and
// menu scenes in front of it, or the M0 pipeline proof.

import Phaser from 'phaser';

import { DESIGN } from '../data/design.ts';
import type { LauncherApi } from '../launcher/api.ts';
import { LobbyScene } from '../launcher/LobbyScene.ts';
import { MenuScene } from '../launcher/MenuScene.ts';
import { LAUNCHER_KEY, SetupScene } from '../launcher/SetupScene.ts';
import type { DesignData } from '../sim/data.ts';
import { startAutoplay } from './autoplay.ts';
import { GameScene } from './GameScene.ts';
import { PauseScene } from './PauseScene.ts';
import { GAME_HEIGHT, GAME_WIDTH } from './layout.ts';
import { ZombieWalkScene } from './ZombieWalkScene.ts';
import { letterbox } from './zoom.ts';

export interface StartOptions {
  /** The M0 zombie and icons proof instead of the game. */
  m0?: boolean;
  /** Dev and smoke test: play a scripted opening and keep calling waves. */
  autoplay?: boolean;
  /** Dev: start with plenty of gold, so autoplay can afford tiers and an evolution. */
  rich?: boolean;
  /** Dev: which class autoplay builds (paladin, sorceress, necromancer). */
  plan?: string;
  /** Dev: ticks per frame multiplier, for previews. */
  speed?: number;
  /** Browser preview: start the run at this wave of the campaign. */
  startWave?: number;
  /** 0 to 100. */
  volume?: number;
  /** Inside Electron: setup and the main menu come before the game. */
  launcher?: LauncherApi;
  parent?: string;
}

/** GameScene reads its design data from the registry, so a run can swap it. */
export const DESIGN_KEY = 'design';

/**
 * Phaser zooms in CSS pixels. Counting the window in device pixels and dividing back keeps
 * the zoom whole on the actual screen, even under Windows display scaling; the canvas is
 * then placed on a device pixel boundary, so nothing resamples it (zoom.ts letterbox).
 */
function fit(width: number, height: number) {
  return letterbox(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, width, height);
}

/** Puts the canvas's parent at the letterbox margins, whole device pixels from the window's edge. */
function place(parent: string, width: number, height: number): number {
  const box = fit(width, height);
  const el = document.getElementById(parent);
  if (el) {
    el.style.margin = '0';
    el.style.marginLeft = `${box.left}px`;
    el.style.marginTop = `${box.top}px`;
  }
  return box.cssZoom;
}

export function startGame(opts: StartOptions = {}): Phaser.Game {
  const width = opts.m0 ? 960 : GAME_WIDTH;
  const height = opts.m0 ? 680 : GAME_HEIGHT;
  const design: DesignData = opts.rich ? { ...DESIGN, balance: { ...DESIGN.balance, startingGold: 50_000 } } : DESIGN;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: opts.parent ?? 'game',
    // The map is 30 x 17 tiles of 48 px between a HUD bar and the tower panel
    width,
    height,
    backgroundColor: '#2a2a22',
    // Nearest-neighbour sampling and whole-pixel positions for classic sprites at 1x
    pixelArt: true,
    // No Scale.FIT: the whole canvas zooms by a whole number and the page letterboxes it
    scale: { mode: Phaser.Scale.NONE, zoom: place(opts.parent ?? 'game', width, height) },
    // Only the first scene starts on its own; the launcher's scenes start the rest
    scene: opts.m0 ? [ZombieWalkScene] : opts.launcher ? [SetupScene, MenuScene, LobbyScene, GameScene, PauseScene] : [GameScene, PauseScene],
    callbacks: {
      preBoot: (g) => {
        g.registry.set(DESIGN_KEY, design);
        g.registry.set('speed', Math.max(1, Math.min(16, opts.speed ?? 1)));
        if (opts.startWave && opts.startWave > 1) g.registry.set('startWave', Math.floor(opts.startWave));
        if (opts.launcher) g.registry.set(LAUNCHER_KEY, opts.launcher);
      },
    },
  });
  // The dev server exposes the game for the screenshot scripts' probes
  if (import.meta.env.DEV) (window as unknown as { __game?: Phaser.Game }).__game = game;
  game.sound.volume = (opts.volume ?? 80) / 100;
  window.addEventListener('resize', () => game.scale.setZoom(place(opts.parent ?? 'game', width, height)));
  if (opts.autoplay && !opts.m0) {
    game.events.once(Phaser.Core.Events.READY, () => {
      const scene = game.scene.getScene('Game') as GameScene;
      scene.events.once('game-ready', () => startAutoplay(scene, { waves: true, plan: opts.plan }));
    });
  }
  return game;
}
