// Starts the game: a Phaser instance running GameScene, or the M0 pipeline proof.

import Phaser from 'phaser';

import { DESIGN } from '../data/design.ts';
import type { DesignData } from '../sim/data.ts';
import { startAutoplay } from './autoplay.ts';
import { GAME_HEIGHT, GAME_WIDTH, GameScene } from './GameScene.ts';
import { ZombieWalkScene } from './ZombieWalkScene.ts';

export interface StartOptions {
  /** The M0 zombie and icons proof instead of the game. */
  m0?: boolean;
  /** Dev and smoke test: play a scripted opening and keep calling waves. */
  autoplay?: boolean;
  /** Dev: start with plenty of gold, so autoplay can afford tiers and an evolution. */
  rich?: boolean;
  /** Dev: ticks per frame multiplier, for previews. */
  speed?: number;
  /** 0 to 100. */
  volume?: number;
  parent?: string;
}

/** GameScene reads its design data from the registry, so a run can swap it. */
export const DESIGN_KEY = 'design';

export function startGame(opts: StartOptions = {}): Phaser.Game {
  const design: DesignData = opts.rich ? { ...DESIGN, balance: { ...DESIGN.balance, startingGold: 50_000 } } : DESIGN;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: opts.parent ?? 'game',
    // The map is 30 x 17 tiles of 64 px between a HUD bar and the tower panel
    width: opts.m0 ? 960 : GAME_WIDTH,
    height: opts.m0 ? 680 : GAME_HEIGHT,
    backgroundColor: '#2a2a22',
    // Nearest-neighbour sampling and whole-pixel positions for classic sprites at 2x
    pixelArt: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: opts.m0 ? [ZombieWalkScene] : [GameScene],
    callbacks: {
      preBoot: (g) => {
        g.registry.set(DESIGN_KEY, design);
        g.registry.set('speed', Math.max(1, Math.min(16, opts.speed ?? 1)));
      },
    },
  });
  game.sound.volume = (opts.volume ?? 80) / 100;
  if (opts.autoplay && !opts.m0) {
    game.events.once(Phaser.Core.Events.READY, () => {
      const scene = game.scene.getScene('Game') as GameScene;
      scene.events.once('game-ready', () => startAutoplay(scene, { waves: true }));
    });
  }
  return game;
}
