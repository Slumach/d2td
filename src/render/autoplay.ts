// Dev aid for screenshots and the launcher's smoke test: plays a short scripted opening
// through the same commands a player sends. ?autoplay in the URL turns it on. It acts on
// sim ticks, not wall-clock time, so it behaves the same at any game speed.

import type Phaser from 'phaser';

import type { Command, SimState } from '../sim/state.ts';

interface Driver {
  readonly state: SimState | undefined;
  readonly events: Phaser.Events.EventEmitter;
  issue(...commands: Command[]): void;
}

/** Build, level, tier and evolve on fixed tiles beside the path, then keep calling waves. */
const PLAN: { x: number; y: number; skill: string; tiers?: string[] }[] = [
  { x: 3, y: 4, skill: 'holy-bolt', tiers: ['blessed-hammer'] },
  { x: 4, y: 4, skill: 'might', tiers: ['concentration'] },
  { x: 5, y: 6, skill: 'sacrifice', tiers: ['zeal', 'vengeance'] },
  { x: 7, y: 8, skill: 'holy-bolt', tiers: ['blessed-hammer', 'fist-of-the-heavens'] },
  { x: 5, y: 9, skill: 'sacrifice' },
];

/** Every this many ticks the script takes its next step. */
const EVERY = 3;

export function startAutoplay(driver: Driver, opts: { waves: boolean; build?: boolean }): () => void {
  const onTick = (tick: number) => {
    const s = driver.state;
    if (!s || s.status !== 'playing' || tick % EVERY !== 0) return;
    if (opts.build !== false && planStep(driver, s)) return;
    if (opts.waves && s.monsters.length === 0 && s.spawns.length === 0) driver.issue({ type: 'callWave' });
  };
  driver.events.on('sim-tick', onTick);
  return () => driver.events.off('sim-tick', onTick);
}

/** Issues the plan's next command; false once the plan is done. */
function planStep(driver: Driver, s: SimState): boolean {
  const at = (x: number, y: number) => s.towers.find((t) => t.tileX === x && t.tileY === y);
  for (const p of PLAN) {
    const t = at(p.x, p.y);
    if (!t) {
      if (s.gold < 150) return true;
      driver.issue({ type: 'build', x: p.x, y: p.y, cls: 'paladin', skill: p.skill });
      return true;
    }
    if (t.evolved) continue;
    const wanted = (p.tiers?.length ?? 0) + 1;
    if (t.tier < wanted || t.level < 5) {
      if (t.level < 5) driver.issue({ type: 'upgrade', towerId: t.id });
      else driver.issue({ type: 'upgradeTier', towerId: t.id }, { type: 'pickBranch', towerId: t.id, skill: p.tiers![t.tier - 1]! });
      return true;
    }
  }
  const holy = at(3, 4);
  const conc = at(4, 4);
  if (holy && conc && !holy.evolved) {
    driver.issue({ type: 'evolve', towerA: holy.id, towerB: conc.id });
    return true;
  }
  return false;
}
