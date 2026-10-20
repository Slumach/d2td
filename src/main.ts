import Phaser from 'phaser';

import { ZombieWalkScene } from './render/ZombieWalkScene.ts';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 680,
  backgroundColor: '#2a2a22',
  // Nearest-neighbour sampling and whole-pixel positions for classic sprites at 2x.
  pixelArt: true,
  scene: [ZombieWalkScene],
});
