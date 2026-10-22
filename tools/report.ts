// Ring report: every bot plays the whole campaign (5 acts x 3 difficulties, 75 waves) on
// the ring in single player, and this reports what happened. No targets, no tuning: the
// numbers are for the rebalance pass to read.
//
//   npm run report
//   npm run report -- --seeds 1,2,3 --bots PALADIN,MIXED3
//   npm run report -- --csv out.csv                         alive weight every second, per run
//   npm run report -- --jobs 4                              runs at once (each in its own process)
//
// For each bot, over the seeds:
//   the wave each run dies on (or that it cleared the campaign)
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
import { buildGameData, stageName, type GameData } from '../src/sim/data.ts';
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
  /** Towers standing at the end, by spot, and how many of them touch the path. */
  towers: Record<Spot, number>;
  touching: number;
}

export function playRing(data: GameData, strategy: Strategy, seed: number): RingRun {
  const atStart: number[] = [];
  const peak: number[] = [];
  const perSecond: number[] = [];
  let last: Sim | undefined;
  const r = runBot(data, strategy, seed, (sim) => {
    last = sim;
    const s = sim.state;
    // s.wave is the number of waves started; a new one just went out
    while (atStart.length < s.wave) {
      atStart.push(s.alive);
      peak.push(s.alive);
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
  return { strategy, seed, won: r.won, stalled: last?.state.status === 'playing', wave: r.wave, atStart, peak, perSecond, towers, touching };
}

/** One run in a child process (a big tower-spam run takes minutes), its result as JSON on stdout. */
function playInChild(strategy: Strategy, seed: number): Promise<RingRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), '--one', `${strategy}:${seed}`], { stdio: ['ignore', 'pipe', 'inherit'] });
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
      jobs: { type: 'string' },
    },
  });
  const data = buildGameData(loadTables(), DESIGN);
  if (args.one) {
    const [strategy, seed] = args.one.split(':');
    process.stdout.write(JSON.stringify(playRing(data, strategy as Strategy, Number(seed))));
    return;
  }
  const seeds = args.seeds.split(',').map(Number);
  const bots = args.bots ? (args.bots.split(',') as Strategy[]) : [...new Set([...STRATEGIES, ...HELL_STRATEGIES])];
  const total = data.waves.length;
  const queue = bots.flatMap((strategy) => seeds.map((seed) => ({ strategy, seed })));
  const runs: RingRun[] = [];
  const started = Date.now();
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const run = await playInChild(job.strategy, job.seed);
      runs.push(run);
      console.error(`${job.strategy} seed ${job.seed}: ${run.won ? 'cleared' : `${run.stalled ? 'stalled at' : 'died on'} wave ${run.wave}`} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
  };
  const jobs = Number(args.jobs ?? Math.max(1, availableParallelism() - 2));
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, worker));
  // Children finish in any order; report in the order asked
  runs.sort((a, b) => bots.indexOf(a.strategy) - bots.indexOf(b.strategy) || a.seed - b.seed);
  const stage = (wave: number) => {
    const w = data.waves[wave - 1]!;
    return `${stageName(w.difficulty, w.act)} ${w.actWave}/${w.actWaves}${w.final ? ' boss' : ''}`;
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
