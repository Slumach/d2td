// Dev aid for screenshots and the launcher's smoke test: plays a short scripted opening
// through the same commands a player sends. ?autoplay in the URL turns it on, and
// ?plan=sorceress or ?plan=necromancer shows those classes instead of the Paladin. It acts
// on sim ticks, not wall-clock time, so it behaves the same at any game speed.

import type Phaser from 'phaser';

import type { Command, SimState } from '../sim/state.ts';

interface Driver {
  readonly state: SimState | undefined;
  readonly events: Phaser.Events.EventEmitter;
  issue(...commands: Command[]): void;
}

interface Step {
  x: number;
  y: number;
  cls: string;
  skill: string;
  tiers?: string[];
}

interface Plan {
  steps: Step[];
  /** Tiles of an attack tower and its partner, evolved once both are ready. */
  evolve?: [number, number, number, number];
}

/**
 * Build, level, tier and evolve on fixed tiles of arc 0, round its U-bend: (31, 4) to (31, 6)
 * are the pocket inside it, (29, y) and (33, y) stand beside its legs. Then keep calling waves.
 */
const PLANS: Record<string, Plan> = {
  paladin: {
    steps: [
      { x: 31, y: 6, cls: 'paladin', skill: 'holy-bolt', tiers: ['blessed-hammer'] },
      { x: 31, y: 5, cls: 'paladin', skill: 'might', tiers: ['concentration'] },
      { x: 29, y: 4, cls: 'paladin', skill: 'sacrifice', tiers: ['zeal', 'vengeance'] },
      { x: 33, y: 5, cls: 'paladin', skill: 'holy-bolt', tiers: ['blessed-hammer', 'fist-of-the-heavens'] },
      { x: 33, y: 4, cls: 'paladin', skill: 'sacrifice' },
    ],
    evolve: [31, 6, 31, 5],
  },
  sorceress: {
    steps: [
      { x: 31, y: 6, cls: 'sorceress', skill: 'fire-bolt', tiers: ['fire-ball', 'meteor'] },
      { x: 31, y: 5, cls: 'sorceress', skill: 'ice-bolt', tiers: ['glacial-spike', 'frozen-orb'] },
      { x: 31, y: 4, cls: 'sorceress', skill: 'charged-bolt', tiers: ['lightning', 'chain-lightning'] },
      { x: 29, y: 5, cls: 'sorceress', skill: 'static-field', tiers: ['enchant', 'thunder-storm'] },
      { x: 33, y: 5, cls: 'sorceress', skill: 'ice-bolt', tiers: ['glacial-spike', 'blizzard'] },
    ],
  },
  necromancer: {
    steps: [
      { x: 29, y: 4, cls: 'necromancer', skill: 'raise-skeleton', tiers: ['raise-skeletal-mage', 'revive'] },
      { x: 31, y: 5, cls: 'necromancer', skill: 'amplify-damage', tiers: ['decrepify', 'lower-resist'] },
      { x: 31, y: 6, cls: 'necromancer', skill: 'teeth', tiers: ['corpse-explosion'] },
      { x: 33, y: 5, cls: 'necromancer', skill: 'teeth', tiers: ['bone-spear', 'bone-spirit'] },
      { x: 29, y: 6, cls: 'necromancer', skill: 'teeth', tiers: ['bone-spear', 'poison-nova'] },
      { x: 6, y: 4, cls: 'necromancer', skill: 'raise-skeleton' },
    ],
  },
};

/** Every this many ticks the script takes its next step. */
const EVERY = 3;

export function startAutoplay(driver: Driver, opts: { waves: boolean; build?: boolean; plan?: string }): () => void {
  const plan = PLANS[opts.plan ?? 'paladin'] ?? PLANS['paladin']!;
  const onTick = (tick: number) => {
    const s = driver.state;
    if (!s || s.status !== 'playing' || tick % EVERY !== 0) return;
    if (opts.build !== false && planStep(driver, s, plan)) return;
    if (opts.waves && s.monsters.length === 0 && s.spawns.length === 0) driver.issue({ type: 'callWave' });
  };
  driver.events.on('sim-tick', onTick);
  return () => driver.events.off('sim-tick', onTick);
}

/** Issues the plan's next command; false once the plan is done. */
function planStep(driver: Driver, s: SimState, plan: Plan): boolean {
  const at = (x: number, y: number) => s.towers.find((t) => t.tileX === x && t.tileY === y);
  for (const p of plan.steps) {
    const t = at(p.x, p.y);
    if (!t) {
      if ((s.gold[0] ?? 0) < 150) return true;
      driver.issue({ type: 'build', x: p.x, y: p.y, cls: p.cls, skill: p.skill });
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
  if (!plan.evolve) return false;
  const [ax, ay, bx, by] = plan.evolve;
  const a = at(ax, ay);
  const b = at(bx, by);
  if (a && b && !a.evolved) {
    driver.issue({ type: 'evolve', towerA: a.id, towerB: b.id });
    return true;
  }
  return false;
}
