// The unattended part of the launcher's smoke run: once a tower stands, call wave 1, and
// report when it is cleared, lost or taking too long. Towers come from the autoplay opening,
// so every action is a normal player command.

import { startAutoplay } from '../render/autoplay.ts';
import type { GameScene } from '../render/GameScene.ts';
import type { SmokeResult } from './api.ts';

/** Two minutes of game time is far more than wave 1 needs. */
const LIMIT_TICKS = 20 * 120;

export function playWaveOne(scene: GameScene, onDone: (r: Omit<SmokeResult, 'setup'>) => void): void {
  const stopAutoplay = startAutoplay(scene, { waves: false });
  let called = false;
  const finish = (waveCleared: boolean, error?: string) => {
    scene.events.off('sim-tick', onTick);
    stopAutoplay();
    const s = scene.state!;
    onDone({ wave: s.wave, kills: s.kills, lives: s.lives, waveCleared, error });
  };
  const onTick = (tick: number) => {
    const s = scene.state;
    if (!s) return;
    if (!called && s.towers.length > 0) {
      scene.issue({ type: 'callWave' });
      called = true;
    } else if (s.status !== 'playing') {
      finish(false, `run ended: ${s.status}`);
    } else if (s.wave >= 1 && s.monsters.length === 0 && s.spawns.length === 0) {
      finish(true);
    } else if (tick > LIMIT_TICKS) {
      finish(false, 'wave 1 did not finish in time');
    }
  };
  scene.events.on('sim-tick', onTick);
}
