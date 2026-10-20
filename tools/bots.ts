// Bot players for the balance harness and the replay test. A bot looks at sim state and
// returns commands, exactly what a human client sends; it never touches state itself.
//
//   SPAM       a new level-1 Holy Bolt tower whenever affordable
//   UPGRADE    max existing Holy Bolt towers (levels only, T1) before building
//   MIXED      alternate building and levelling Holy Bolt towers (T1)
//   ONE-LINE   only the Holy line, but all of it: levels, tiers, Blessed Hammer, FoH
//   PALADIN    a mixed Paladin: a Hammerdin pair first, Zealots on the path, auras, a
//              Zealdin pair, then the cheapest improvement or a new tower in turn
//
// SPAM, UPGRADE and MIXED keep their M1 meaning (Holy Bolt T1, levels only) so their
// balance targets stay comparable.

import { MAX_TOWER_LEVEL, type GameData } from '../src/sim/data.ts';
import { isPathTile } from '../src/sim/map.ts';
import { canBuild, createSim, evolutionFor, pendingChoices, step, tierCost, upgradeCost } from '../src/sim/sim.ts';
import type { Command, Sim, TimedCommand, Tower } from '../src/sim/state.ts';

export type Strategy = 'SPAM' | 'UPGRADE' | 'MIXED' | 'ONE-LINE' | 'PALADIN';
export const STRATEGIES: Strategy[] = ['SPAM', 'UPGRADE', 'MIXED', 'ONE-LINE', 'PALADIN'];

/** Bots act every this many ticks, roughly a human's pace. */
export const DECISION_TICKS = 10;

export interface Bot {
  strategy: Strategy;
  decide(sim: Sim): Command[];
  /** Wave on which the bot evolved, by recipe id. */
  evolvedOn: Record<string, number>;
}

interface Spot {
  x: number;
  y: number;
  score: number;
}

/** Buildable tiles ranked by how many path tiles lie within `radius` tiles, best first. */
function rankSpots(sim: Sim, radiusTenths: number): Spot[] {
  const spots: Spot[] = [];
  const reach = Math.ceil(radiusTenths / 10);
  for (let y = 0; y < sim.map.height; y++) {
    for (let x = 0; x < sim.map.width; x++) {
      if (!canBuild(sim, x, y)) continue;
      let score = 0;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if ((dx * dx + dy * dy) * 100 <= radiusTenths * radiusTenths && isPathTile(sim.map, x + dx, y + dy)) score++;
        }
      }
      if (score > 0) spots.push({ x, y, score });
    }
  }
  return spots.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
}

function neighbours(spot: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) out.push({ x: spot.x + dx, y: spot.y + dy });
  return out;
}

function callWaveIfClear(sim: Sim): Command[] {
  const s = sim.state;
  return s.monsters.length === 0 && s.spawns.length === 0 && s.wave < sim.data.waves.length ? [{ type: 'callWave' }] : [];
}

function lowest(towers: Tower[], ok: (t: Tower) => boolean): Tower | undefined {
  let best: Tower | undefined;
  for (const t of towers) if (ok(t) && (!best || t.level < best.level)) best = t;
  return best;
}

function buildAt(sim: Sim, spot: { x: number; y: number } | undefined, skill: string): Command | undefined {
  if (!spot || !canBuild(sim, spot.x, spot.y) || sim.state.gold < sim.data.economy.buildCost) return undefined;
  return { type: 'build', x: spot.x, y: spot.y, cls: 'paladin', skill };
}

function levelUp(sim: Sim, tower: Tower | undefined): Command | undefined {
  const cost = tower && upgradeCost(sim, tower);
  return tower && cost !== undefined && sim.state.gold >= cost ? { type: 'upgrade', towerId: tower.id } : undefined;
}

/** Tier up, plus the branch pick in the same tick when the next tier branches. */
function tierUp(sim: Sim, tower: Tower, branch: (options: string[]) => string): Command[] {
  const cost = tierCost(sim, tower);
  if (cost === undefined || sim.state.gold < cost) return [];
  const line = sim.data.classes[tower.cls]!.lines[tower.line]!;
  const options = line.tiers[tower.tier] ?? [];
  const out: Command[] = [{ type: 'upgradeTier', towerId: tower.id }];
  if (options.length > 1) out.push({ type: 'pickBranch', towerId: tower.id, skill: branch(options) });
  return out;
}

function progress(t: Tower): number {
  return (t.tier - 1) * MAX_TOWER_LEVEL + t.level;
}

/**
 * The next level or tier step on the most advanced tower that can still progress, as
 * commands; [] while saving up for it. Focusing one tower is what reaches T2 and T3.
 */
function focusedImprovement(sim: Sim, towers: Tower[], branch: (t: Tower, options: string[]) => string): Command[] {
  let focus: Tower | undefined;
  for (const t of towers) {
    if (upgradeCost(sim, t) === undefined && tierCost(sim, t) === undefined) continue;
    if (!focus || progress(t) > progress(focus)) focus = t;
  }
  if (!focus) return [];
  const target = focus;
  const level = levelUp(sim, target);
  if (level) return [level];
  return upgradeCost(sim, target) === undefined ? tierUp(sim, target, (options) => branch(target, options)) : [];
}

/** True if some tower can still progress, whether or not it is affordable now. */
function canProgress(sim: Sim, towers: Tower[]): boolean {
  return towers.some((t) => upgradeCost(sim, t) !== undefined || tierCost(sim, t) !== undefined);
}

function legacyBot(strategy: 'SPAM' | 'UPGRADE' | 'MIXED', sim: Sim): Bot {
  const spots = rankSpots(sim, 40);
  let wantBuild = true;
  return {
    strategy,
    evolvedOn: {},
    decide(sim) {
      const out = callWaveIfClear(sim);
      if (sim.state.tick % DECISION_TICKS !== 0) return out;
      const towers = sim.state.towers;
      const free = () => spots.find((p) => canBuild(sim, p.x, p.y));
      const target = lowest(towers, (t) => t.level < MAX_TOWER_LEVEL);
      let command: Command | undefined;
      if (strategy === 'SPAM') command = buildAt(sim, free(), 'holy-bolt');
      else if (strategy === 'UPGRADE') command = target ? levelUp(sim, target) : buildAt(sim, free(), 'holy-bolt');
      else {
        command = wantBuild || !target ? buildAt(sim, free(), 'holy-bolt') : levelUp(sim, target);
        if (command) wantBuild = !wantBuild;
      }
      if (strategy === 'UPGRADE' && !command && towers.length === 0) command = buildAt(sim, free(), 'holy-bolt');
      return command ? [command, ...out] : out;
    },
  };
}

function oneLineBot(sim: Sim): Bot {
  const spots = rankSpots(sim, 40);
  let wantBuild = true;
  return {
    strategy: 'ONE-LINE',
    evolvedOn: {},
    decide(sim) {
      const out = callWaveIfClear(sim);
      if (sim.state.tick % DECISION_TICKS !== 0) return out;
      const towers = sim.state.towers;
      const build = buildAt(sim, spots.find((p) => canBuild(sim, p.x, p.y)), 'holy-bolt');
      if (wantBuild || !canProgress(sim, towers)) {
        if (build) wantBuild = false;
        return build ? [build, ...out] : out;
      }
      const improve = focusedImprovement(sim, towers, (_, options) => options[0]!);
      if (improve.length > 0) wantBuild = true;
      return [...improve, ...out];
    },
  };
}

type Goal =
  | { kind: 'build'; tag: string; spot: () => { x: number; y: number } | undefined; skill: string }
  /** Level and tier a tower up to `tier` at level 5; `branches[tier]` picks a branching tier. */
  | { kind: 'max'; tag: string; tier: number; branches?: Record<number, string> }
  | { kind: 'evolve'; a: string; b: string };

/**
 * PALADIN: a fixed opening, then a mixed loop.
 *   Opening: Holy Bolt on the best ranged tile, a Zealot on the best melee tile, a Might
 *   beside the Holy tower; max both to T2 (Blessed Hammer, Concentration) and evolve the
 *   Hammerdin. Then a Might beside the Zealot, Zealot to Zeal and the aura to Fanaticism
 *   for a Zealdin.
 *   Loop: alternate a new tower (cycling Zealot, Holy, Zealot, Aura) with the cheapest
 *   level or tier step on any normal tower.
 */
function paladinBot(sim: Sim): Bot {
  const ranged = rankSpots(sim, 40);
  const melee = rankSpots(sim, 15);
  const tags: Record<string, number> = {};
  const evolvedOn: Record<string, number> = {};
  const byTag = (s: Sim, tag: string) => s.state.towers.find((t) => t.id === tags[tag]);
  const firstFree = (s: Sim, list: Spot[]) => list.find((p) => canBuild(s, p.x, p.y));
  const besideTag = (s: Sim, tag: string) => {
    const anchor = byTag(s, tag);
    if (!anchor) return undefined;
    // The free neighbour with the best ranged score, so the aura also covers the path
    const free = neighbours({ x: anchor.tileX, y: anchor.tileY }).filter((p) => canBuild(s, p.x, p.y));
    return free.sort((a, b) => (ranged.find((r) => r.x === b.x && r.y === b.y)?.score ?? 0) - (ranged.find((r) => r.x === a.x && r.y === a.y)?.score ?? 0))[0];
  };

  const goals: Goal[] = [
    { kind: 'build', tag: 'holy', spot: () => firstFree(sim, ranged), skill: 'holy-bolt' },
    { kind: 'build', tag: 'zealot', spot: () => firstFree(sim, melee), skill: 'sacrifice' },
    { kind: 'build', tag: 'conc', spot: () => besideTag(sim, 'holy'), skill: 'might' },
    { kind: 'max', tag: 'holy', tier: 2 },
    { kind: 'max', tag: 'conc', tier: 2, branches: { 2: 'concentration' } },
    { kind: 'evolve', a: 'holy', b: 'conc' },
    { kind: 'build', tag: 'fana', spot: () => besideTag(sim, 'zealot'), skill: 'might' },
    { kind: 'max', tag: 'zealot', tier: 2 },
    { kind: 'max', tag: 'fana', tier: 3, branches: { 2: 'concentration', 3: 'fanaticism' } },
    { kind: 'evolve', a: 'zealot', b: 'fana' },
  ];
  const cycle = ['sacrifice', 'holy-bolt', 'sacrifice', 'might'];
  let cycleIndex = 0;
  let wantBuild = true;

  const branchFor = (_t: Tower, options: string[]) =>
    options.includes('concentration') ? 'concentration' : options.includes('fanaticism') ? 'fanaticism' : options[0]!;

  /** Next commands for the first unfinished goal, or [] if waiting for gold. Removes finished goals. */
  function advance(s: Sim): Command[] | undefined {
    while (goals.length > 0) {
      const goal = goals[0]!;
      if (goal.kind === 'build') {
        if (tags[goal.tag] !== undefined && byTag(s, goal.tag)) {
          goals.shift();
          continue;
        }
        const spot = goal.spot();
        if (!spot) {
          goals.shift();
          continue;
        }
        const cmd = buildAt(s, spot, goal.skill);
        if (cmd) tags[goal.tag] = s.state.nextId;
        return cmd ? [cmd] : [];
      }
      if (goal.kind === 'max') {
        const t = byTag(s, goal.tag);
        if (!t || t.evolved) {
          goals.shift();
          continue;
        }
        const branchAt = (tier: number, options: string[]) => goal.branches?.[tier] ?? options[0]!;
        if (t.picks.length < t.tier) {
          return [{ type: 'pickBranch', towerId: t.id, skill: branchAt(t.tier, pendingChoices(s, t)) }];
        }
        if (t.tier >= goal.tier) {
          goals.shift();
          continue;
        }
        if (t.level < MAX_TOWER_LEVEL) {
          const cmd = levelUp(s, t);
          return cmd ? [cmd] : [];
        }
        return tierUp(s, t, (options) => branchAt(t.tier + 1, options));
      }
      const a = byTag(s, goal.a);
      const b = byTag(s, goal.b);
      if (!a || !b || !evolutionFor(s, a, b)) {
        goals.shift();
        continue;
      }
      if (s.state.gold < s.data.economy.evolveCost) return [];
      const recipe = evolutionFor(s, a, b)!.recipe.id;
      evolvedOn[recipe] = s.state.wave;
      goals.shift();
      return [{ type: 'evolve', towerA: a.id, towerB: b.id }];
    }
    return undefined;
  }

  return {
    strategy: 'PALADIN',
    evolvedOn,
    decide(s) {
      const out = callWaveIfClear(s);
      if (s.state.tick % DECISION_TICKS !== 0) return out;
      const opening = advance(s);
      if (opening) return [...opening, ...out];

      const normal = s.state.towers.filter((t) => !t.evolved);
      const skill = cycle[cycleIndex % cycle.length]!;
      const spot = skill === 'sacrifice' ? (firstFree(s, melee) ?? firstFree(s, ranged)) : firstFree(s, ranged);
      if (wantBuild || !canProgress(s, normal)) {
        const build = buildAt(s, spot, skill);
        if (build) {
          cycleIndex++;
          wantBuild = false;
        }
        return build ? [build, ...out] : out;
      }
      const improve = focusedImprovement(s, normal, branchFor);
      if (improve.length > 0) wantBuild = true;
      return [...improve, ...out];
    },
  };
}

export function createBot(strategy: Strategy, sim: Sim): Bot {
  if (strategy === 'ONE-LINE') return oneLineBot(sim);
  if (strategy === 'PALADIN') return paladinBot(sim);
  return legacyBot(strategy, sim);
}

export interface RunResult {
  strategy: Strategy;
  seed: number;
  won: boolean;
  /** Last wave called; the wave that ended the run on a loss. */
  wave: number;
  lives: number;
  gold: number;
  towers: number;
  levels: number;
  evolvedOn: Record<string, number>;
  /** Every command the bot sent, stamped with its tick: a replayable log. */
  log: TimedCommand[];
}

const MAX_TICKS = 600_000;

/** Plays a whole run with one bot, recording its commands as a replayable log. */
export function runBot(data: GameData, strategy: Strategy, seed: number, onTick?: (sim: Sim) => void): RunResult {
  const sim = createSim(data, seed);
  const bot = createBot(strategy, sim);
  const log: TimedCommand[] = [];
  while (sim.state.status === 'playing' && sim.state.tick < MAX_TICKS) {
    const commands = bot.decide(sim);
    for (const command of commands) log.push({ tick: sim.state.tick, command });
    step(sim, commands);
    onTick?.(sim);
  }
  const s = sim.state;
  return {
    strategy,
    seed,
    won: s.status === 'won',
    wave: s.wave,
    lives: s.lives,
    gold: s.gold,
    towers: s.towers.length,
    levels: s.towers.reduce((n, t) => n + t.level + (t.tier - 1) * MAX_TOWER_LEVEL, 0),
    evolvedOn: bot.evolvedOn,
    log,
  };
}
