import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, GameScene } from './render/GameScene.ts';
import { ZombieWalkScene } from './render/ZombieWalkScene.ts';

// ?m0 opens the M0 pipeline proof (zombie walk and Paladin icons) instead of the game.
const m0 = new URLSearchParams(window.location.search).has('m0');

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // The map is 30 x 17 tiles of 64 px between a HUD bar and the tower panel
  width: m0 ? 960 : GAME_WIDTH,
  height: m0 ? 680 : GAME_HEIGHT,
  backgroundColor: '#2a2a22',
  // Nearest-neighbour sampling and whole-pixel positions for classic sprites at 2x.
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: m0 ? [ZombieWalkScene] : [GameScene],
});
