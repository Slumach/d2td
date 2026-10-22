// Ring report: every bot plays the whole campaign (5 acts x 3 difficulties, 75 waves) on
// the ring in single player, and this reports what happened. No targets, no tuning: the
// numbers are for the rebalance pass to read.
//
//   npm run report
//   npm run report -- --seeds 1,2,3 --bots PALADIN,MIXED3
//   npm run report -- --csv out.csv                         alive weight every second, per run
//   npm run report -- --jobs 4                              runs at once (each in its own process)
//   npm run report -- --set tierCosts=400,3000 --set evolveCost=12000   try prices without editing balance.json
//
// For each bot, over the seeds:
//   the wave each run dies on (or that it cleared the campaign)
//   the wave it first bought each tier and each evolution, and gold earned by each act
//   alive weight over time: at each wave's start and its peak while that wave was the newest
//   where its towers stood at the end: in a U-bend pocket, round the outside of the U-bend,
//   on the run into a handoff corner, or along a long straight (by the nearest path leg)

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import ring from '../src/data/map/ring.json';
import { DESIGN } from '../src/data/design.ts';
import { buildGameData, stageName, waveLabel, type GameData } from '../src/sim/data.ts';
import { ARC_COUNT, createMap, isBlocked, isPathTile, ringWaypoints, type Point } from '../src/sim/map.ts';
import type { Sim } from '../src/sim/sim.ts';
import { median } from './balance.ts';
import { HELL_STRATEGIES, STRATEGIES, runBot, type Strategy } from './bots.ts';
import { loadTables } from './lib/load-tables.ts';

export type Spot = 'pocket' | 'bend' | 'corner' | 'straight' | 'inland';
export const SPOTS: Spot[] = ['pocket', 'bend', 'corner', 'straight', 'inland'];
/** Further than this from every leg, a tile is inland: no one leg is "its" leg. */
const NEAR = 2;

/**
 * Where a tile sits against the ring, by the leg of path nearest it. Each arc's legs in
 * walking order are its long straight, the U-bend's three (in, across, out), and the short
 * run into the corner that hands off to the next arc. A pocket tile lies inside the U, between
 * its corners. Ties go to the U, then the corner, so a tile where the straight meets the
 * bend counts as the bend. More than NEAR tiles from every leg is inland.
 */
export function spotOf(tile: Point): { spot: Spot; distance: number } {
  const corners = ringWaypoints();
  const perArc = ring.arc.length;
  // Chebyshev distance from the tile to an axis-aligned leg
  const dist = (i: number) => {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const dx = Math.max(0, Math.min(a.x, b.x) - tile.x, tile.x - Math.max(a.x, b.x));
    const dy = Math.max(0, Math.min(a.y, b.y) - tile.y, tile.y - Math.max(a.y, b.y));
    return Math.max(dx, dy);
  };
  const legs = corners.map((_, i) => ({ role: i % perArc, d: dist(i), arc: Math.floor(i / perArc) }));
  const nearest = Math.min(...legs.map((l) => l.d));
  for (let k = 0; k < ARC_COUNT; k++) {
    // The U's four corners are the arc's waypoints 1 to 4
    const u = corners.slice(k * perArc + 1, k * perArc + 5);
    const inX = tile.x >= Math.min(...u.map((p) => p.x)) && tile.x <= Math.max(...u.map((p) => p.x));
    const inY = tile.y >= Math.min(...u.map((p) => p.y)) && tile.y <= Math.max(...u.map((p) => p.y));
    if (nearest > 0 && inX && inY) return { spot: 'pocket', distance: nearest };
  }
  if (nearest > NEAR) return { spot: 'inland', distance: nearest };
  const roles = legs.filter((l) => l.d === nearest).map((l) => l.role);
  const spot: Spot = roles.some((r) => r >= 1 && r <= 3) ? 'bend' : roles.includes(perArc - 1) ? 'corner' : 'straight';
  return { spot, distance: nearest };
}

export interface RingRun {
  strategy: Strategy;
  seed: number;
  won: boolean;
  /** Still playing at runBot's tick cap: monsters it cannot kill lapping under the alive limit. */
  stalled: boolean;
  /** The wave the run ended on: the last one started. */
  wave: number;
  /** Alive weight when each wave started, index 0 is wave 1. */
  atStart: number[];
  /** The most weight alive while each wave was the newest out. */
  peak: number[];
  /** Alive weight once a second, for --csv. */
  perSecond: number[];
  /** The wave the first tower of each tier appeared (4 is an evolution), and each recipe. */
  tiersOn: Record<number, number>;
  evolvedOn: Record<string, number>;
  /** Gold earned (bounties and send bonuses) before each wave started, index 0 is wave 1. */
  incomeAtStart: number[];
  /** Towers standing and gold unspent as each boss wave started, by wave number. */
  atBoss: Record<number, { towers: number; gold: number }>;
  /** Towers standing at the end, by spot, and how many of them touch the path. */
  towers: Record<Spot, number>;
  touching: number;
}

export function playRing(data: GameData, strategy: Strategy, seed: number): RingRun {
  const atStart: number[] = [];
  const peak: number[] = [];
  const perSecond: number[] = [];
  const incomeAtStart: number[] = [];
  const atBoss: RingRun['atBoss'] = {};
  let income = 0;
  let prevGold = data.economy.startingGold;
  let last: Sim | undefined;
  const r = runBot(data, strategy, seed, (sim) => {
    last = sim;
    const s = sim.state;
    // Gold only rises by income (a purchase and a kill on one tick undercounts a little)
    const gold = s.gold[0] ?? 0;
    if (gold > prevGold) income += gold - prevGold;
    prevGold = gold;
    // s.wave is the number of waves started; a new one just went out
    while (atStart.length < s.wave) {
      atStart.push(s.alive);
      peak.push(s.alive);
      incomeAtStart.push(income);
      if (data.waves[atStart.length - 1]?.final) atBoss[atStart.length] = { towers: s.towers.length, gold };
    }
    if (s.wave > 0) peak[s.wave - 1] = Math.max(peak[s.wave - 1]!, s.alive);
    if (s.tick % 20 === 0) perSecond.push(s.alive);
  });
  const towers: Record<Spot, number> = { pocket: 0, bend: 0, corner: 0, straight: 0, inland: 0 };
  let touching = 0;
  for (const t of last?.state.towers ?? []) {
    const { spot, distance } = spotOf({ x: t.tileX, y: t.tileY });
    towers[spot]++;
    if (distance <= 1) touching++;
  }
  return { strategy, seed, won: r.won, stalled: last?.state.status === 'playing', wave: r.wave, atStart, peak, perSecond, tiersOn: r.tiersOn, evolvedOn: r.evolvedOn, incomeAtStart, atBoss, towers, touching };
}

/** One run in a child process (a big tower-spam run takes minutes), its result as JSON on stdout. */
function playInChild(strategy: Strategy, seed: number, sets: string[]): Promise<RingRun> {
  return new Promise((resolve, reject) => {
    const args = [...process.execArgv, fileURLToPath(import.meta.url), '--one', `${strategy}:${seed}`, ...sets.flatMap((s) => ['--set', s])];
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let json = '';
    child.stdout.on('data', (d: Buffer) => (json += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(JSON.parse(json) as RingRun) : reject(new Error(`${strategy} seed ${seed} exited ${code}`))));
  });
}

async function main(): Promise<void> {
  const { values: args } = parseArgs({
    options: {
      seeds: { type: 'string', default: '1,2,3' },
      bots: { type: 'string' },
      csv: { type: 'string' },
      one: { type: 'string' },
      set: { type: 'string', multiple: true, default: [] },
      jobs: { type: 'string' },
    },
  });
  // --set key=value overrides a balance.json number or number list for this run
  const balance = { ...DESIGN.balance } as Record<string, unknown>;
  for (const s of args.set) {
    // key=value, or key.field=value for a field of an object (bossHpPct.last=500)
    const [path, value] = s.split('=') as [string, string];
    const keys = path.split('.');
    let at = balance;
    for (const k of keys.slice(0, -1)) {
      if (typeof at[k] !== 'object' || at[k] === null) throw new Error(`--set ${path}: no such balance.json field`);
      at = at[k] = { ...(at[k] as Record<string, unknown>) };
    }
    const last = keys.at(-1)!;
    if (!(last in at)) throw new Error(`--set ${path}: no such balance.json field`);
    at[last] = value.includes(',') ? value.split(',').map(Number) : Number(value);
  }
  const data = buildGameData(loadTables(), { ...DESIGN, balance: balance as unknown as typeof DESIGN.balance });
  if (args.one) {
    const [strategy, seed] = args.one.split(':');
    process.stdout.write(JSON.stringify(playRing(data, strategy as Strategy, Number(seed))));
    return;
  }
  if (args.set.length) console.log(`balance overrides: ${args.set.join('  ')}`);
  const seeds = args.seeds.split(',').map(Number);
  const bots = args.bots ? (args.bots.split(',') as Strategy[]) : [...new Set([...STRATEGIES, ...HELL_STRATEGIES])];
  // The campaign's waves; endless waves past it are reported by the wave a run ends on
  const total = data.waves.length;
  const queue = bots.flatMap((strategy) => seeds.map((seed) => ({ strategy, seed })));
  const runs: RingRun[] = [];
  const started = Date.now();
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const run = await playInChild(job.strategy, job.seed, args.set);
      runs.push(run);
      console.error(`${job.strategy} seed ${job.seed}: ${run.won ? 'cleared' : `${run.stalled ? 'stalled at' : 'died on'} wave ${run.wave}`} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
  };
  const jobs = Number(args.jobs ?? Math.max(1, availableParallelism() - 2));
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, worker));
  // Children finish in any order; report in the order asked
  runs.sort((a, b) => bots.indexOf(a.strategy) - bots.indexOf(b.strategy) || a.seed - b.seed);
  const stage = (wave: number) => {
    data.extendWaves?.(wave);
    const w = data.waves[wave - 1]!;
    return `${waveLabel(w)}${w.final ? ' boss' : ''}`;
  };
  const pad = (s: string | number, n: number) => String(s).padStart(n);

  console.log(`Ring report: ${bots.length} bots x seeds ${seeds.join(',')}, ${total} waves, single player, alive limit ${data.rules.aliveLimit}`);
  console.log('');
  console.log('Where each run ends');
  for (const strategy of bots) {
    const mine = runs.filter((r) => r.strategy === strategy);
    const ends = mine.map((r) => (r.won ? 'cleared' : `${r.stalled ? 'stalled at' : 'died on'} w${r.wave} ${stage(r.wave)}`));
    console.log(`  ${strategy.padEnd(8)} ${ends.join('  |  ')}`);
  }

  console.log('');
  console.log('First purchase of each tier, by seed (T4 is the first evolution); the stage is the median');
  for (const strategy of bots) {
    const mine = runs.filter((r) => r.strategy === strategy);
    const cells = [2, 3, 4].map((tier) => {
      const waves = mine.map((r) => r.tiersOn[tier]);
      if (waves.every((w) => w === undefined)) return `T${tier} never`.padEnd(42);
      const bought = waves.filter((w): w is number => w !== undefined);
      const med = median(bought);
      return `T${tier} w${waves.map((w) => w ?? '-').join('/')} ${stage(med)}`.padEnd(42);
    });
    const recipes = [...new Set(mine.flatMap((r) => Object.keys(r.evolvedOn)))].map((id) => `${id} w${mine.map((r) => r.evolvedOn[id] ?? '-').join('/')}`);
    console.log(`  ${strategy.padEnd(8)} ${cells.join('')}${recipes.join('  ')}`);
  }

  console.log('');
  console.log('Towers / unspent gold as each boss wave starts, median over seeds that got there');
  const bossWaves = data.waves.map((w, i) => (w.final ? i + 1 : 0)).filter((n) => n > 0);
  console.log(`  ${'bot'.padEnd(8)} ${bossWaves.map((n) => stage(n).replace(/ \d+\/\d+ boss$/, '').replace('Normal ', 'N').replace('Nightmare ', 'NM').replace('Hell ', 'H').replace('Act ', '').padStart(11)).join('')}`);
  for (const strategy of bots) {
    const mine = runs.filter((r) => r.strategy === strategy);
    const cells = bossWaves.map((n) => {
      const have = mine.filter((r) => r.atBoss[n]);
      return (have.length ? `${median(have.map((r) => r.atBoss[n]!.towers))}/${median(have.map((r) => r.atBoss[n]!.gold))}` : '').padStart(11);
    });
    console.log(`  ${strategy.padEnd(8)} ${cells.join('')}`);
  }

  console.log('');
  console.log('Gold earned before each act started, median over seeds (the price curve is set against this)');
  const actStarts = data.waves.map((w, i) => (w.actWave === 1 ? i : -1)).filter((i) => i >= 0);
  console.log(`  ${'bot'.padEnd(8)} ${actStarts.map((i) => `${stageName(data.waves[i]!.difficulty, data.waves[i]!.act).replace('Normal ', 'N').replace('Nightmare ', 'NM').replace('Hell ', 'H').replace('Act ', '')}`.padStart(7)).join('')}`);
  for (const strategy of bots) {
    const mine = runs.filter((r) => r.strategy === strategy);
    const cells = actStarts.map((i) => {
      const have = mine.filter((r) => r.incomeAtStart.length > i);
      return (have.length ? String(median(have.map((r) => r.incomeAtStart[i]!))) : '').padStart(7);
    });
    console.log(`  ${strategy.padEnd(8)} ${cells.join('')}`);
  }

  console.log('');
  console.log('Alive weight, median over seeds: at the wave start / peak while it was the newest wave');
  console.log(`  ${'wave'.padEnd(36)}${bots.map((b) => b.padStart(12)).join('')}`);
  for (let w = 1; w <= total; w++) {
    const cells = bots.map((b) => {
      const mine = runs.filter((r) => r.strategy === b && r.atStart.length >= w);
      if (mine.length === 0) return pad('', 12);
      const label = `${median(mine.map((r) => r.atStart[w - 1]!))}/${median(mine.map((r) => r.peak[w - 1]!))}`;
      return pad(mine.length < seeds.length ? `${label}*` : label, 12);
    });
    console.log(`  ${`${pad(w, 2)} ${stage(w)}`.padEnd(36)}${cells.join('')}`);
  }
  console.log('  * fewer runs than seeds reached this wave; the median is of those that did');

  console.log('');
  console.log('Towers standing at the end, summed over seeds (by nearest path leg)');
  console.log(`  ${'bot'.padEnd(10)}${SPOTS.map((s) => s.padStart(10)).join('')}${'total'.padStart(8)}${'touching'.padStart(10)}${'pocket %'.padStart(10)}`);
  for (const strategy of bots) {
    const mine = runs.filter((r) => r.strategy === strategy);
    const sum = (s: Spot) => mine.reduce((n, r) => n + r.towers[s], 0);
    const all = SPOTS.reduce((n, s) => n + sum(s), 0);
    const touching = mine.reduce((n, r) => n + r.touching, 0);
    console.log(
      `  ${strategy.padEnd(10)}${SPOTS.map((s) => pad(sum(s), 10)).join('')}${pad(all, 8)}${pad(touching, 10)}${pad(all ? `${Math.round((sum('pocket') * 100) / all)}%` : '-', 10)}`,
    );
  }
  const tiles = countSpots();
  console.log(`  ${'map'.padEnd(10)}${SPOTS.map((s) => pad(tiles[s], 10)).join('')}${pad(SPOTS.reduce((n, s) => n + tiles[s], 0), 8)}    buildable tiles of each kind`);

  if (args.csv) {
    const longest = Math.max(...runs.map((r) => r.perSecond.length));
    const head = ['second', ...runs.map((r) => `${r.strategy}-${r.seed}`)].join(',');
    const rows = Array.from({ length: longest }, (_, i) => [i, ...runs.map((r) => r.perSecond[i] ?? '')].join(','));
    writeFileSync(args.csv, [head, ...rows].join('\n'));
    console.log(`\nAlive weight per second written to ${args.csv}`);
  }
}

/** How many buildable tiles the map has of each spot, for scale. */
export function countSpots(): Record<Spot, number> {
  const map = createMap();
  const out: Record<Spot, number> = { pocket: 0, bend: 0, corner: 0, straight: 0, inland: 0 };
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (!isPathTile(map, x, y) && !isBlocked(map, x, y)) out[spotOf({ x, y }).spot]++;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
