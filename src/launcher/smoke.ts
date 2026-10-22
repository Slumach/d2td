// The unattended part of the launcher's smoke run: once a tower stands, call wave 1, and
// report when its monsters are all dead, the run is lost, or it takes too long. Towers come from the autoplay opening,
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
    onDone({ wave: s.wave, kills: s.kills, alive: s.alive, waveCleared, error });
  };
  const onTick = (tick: number) => {
    const s = scene.state;
    if (!s) return;
    if (!called && s.towers.length > 0) {
      scene.issue({ type: 'callWave' });
      called = true;
    } else if (s.status !== 'playing') {
      finish(false, `run ended: ${s.status}`);
    } else if (s.wave >= 1 && s.waves[0]!.remaining === 0) {
      // Waves start on a timer, so later waves may already be out: wave 1's own monsters are all dead
      finish(true);
    } else if (tick > LIMIT_TICKS) {
      finish(false, 'wave 1 did not finish in time');
    }
  };
  scene.events.on('sim-tick', onTick);
}
