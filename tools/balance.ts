// Balance harness: plays the headless sim with every bot strategy and reports how far
// each gets. Reads the real tables from assets-extracted/data and src/data/balance.json.
//
//   npm run balance
//   npm run balance -- --waves 30 --seeds 1,2,3,4,5
//   npm run balance -- --hp 112 --bounty 105 --cost 160     try multipliers without editing the file
//   npm run balance -- --hell                               the M6 gate: the class bots at Hell
//
// Targets, by median over the seeds (default 5)
//   BOLT loses on wave 10 or 15, HOLY on 20, TWOLINE on 30
//   PALADIN survives all 30 waves with 4 lives or fewer, and has a Hammerdin by wave 15
// The Hell gate, started at Hell
//   no single-class bot (PALADIN, SORC, NECRO) clears it on any seed; MIXED3 does, by median

import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, type BalanceJson, type DesignData } from '../src/sim/data.ts';
import { HELL_STRATEGIES, STRATEGIES, runBot, type RunResult, type Strategy } from './bots.ts';
import { loadTables } from './lib/load-tables.ts';

export interface Multipliers {
  hp?: number;
  bounty?: number;
  cost?: number;
}

export function withMultipliers(design: DesignData, m: Multipliers): DesignData {
  const balance: BalanceJson = {
    ...design.balance,
    hpPctPerWave: m.hp ?? design.balance.hpPctPerWave,
    bountyPctPerWave: m.bounty ?? design.balance.bountyPctPerWave,
    levelCostPctPerLevel: m.cost ?? design.balance.levelCostPctPerLevel,
  };
  return { ...design, balance };
}

export interface Targets {
  ok: boolean;
  notes: string[];
}

/** The walls each losing bot should fall on, judged by its median over the seeds. */
export const LOSS_WAVES: Record<'BOLT' | 'HOLY' | 'TWOLINE', number[]> = {
  BOLT: [10, 15],
  HOLY: [20],
  TWOLINE: [30],
};
export const PALADIN_MAX_LIVES = 4;
export const HAMMERDIN_BY_WAVE = 15;
/** A survived run counts as this wave when taking medians. */
const SURVIVED = 31;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** The wave a run ended on, or SURVIVED. */
export function endWave(r: RunResult): number {
  return r.won ? SURVIVED : r.wave;
}

export function checkTargets(results: RunResult[], waves: number): Targets {
  const notes: string[] = [];
  for (const strategy of [...new Set(results.map((r) => r.strategy))]) {
    const runs = results.filter((r) => r.strategy === strategy);
    const wave = median(runs.map(endWave));
    if (strategy === 'PALADIN') {
      const lives = median(runs.map((r) => r.lives));
      if (wave !== SURVIVED) notes.push(`PALADIN median: lost on wave ${wave} of ${waves}`);
      else if (lives > PALADIN_MAX_LIVES) notes.push(`PALADIN median: kept ${lives} lives`);
      const late = runs.filter((r) => (r.evolvedOn['hammerdin'] ?? 99) > HAMMERDIN_BY_WAVE).map((r) => r.seed);
      if (late.length > 0) notes.push(`PALADIN Hammerdin after wave ${HAMMERDIN_BY_WAVE} on seeds ${late.join(', ')}`);
    } else {
      const want = LOSS_WAVES[strategy as keyof typeof LOSS_WAVES];
      if (!want) continue;
      if (!want.includes(wave)) {
        notes.push(`${strategy} median: ${wave === SURVIVED ? 'survived' : `lost on wave ${wave}`}, wants ${want.join(' or ')}`);
      }
    }
  }
  return { ok: notes.length === 0, notes };
}

/**
 * Per-wave margins for each bot, median over seeds: lives lost, and how far along the
 * path the wave's last monster got (percent; 100 means it leaked). The sawtooth shows as
 * finish points creeping toward 100 before each wall.
 */
export function marginTable(results: RunResult[], waves: number): string[] {
  const out: string[] = [];
  const header = Array.from({ length: waves }, (_, i) => String(i + 1).padStart(6)).join('');
  out.push(`per-wave margin, median over seeds: lives lost / % of path where the last monster died`);
  out.push(`${'wave'.padEnd(8)}${header}`);
  for (const strategy of [...new Set(results.map((r) => r.strategy))]) {
    const runs = results.filter((r) => r.strategy === strategy);
    const cell = (n: number, pick: (m: { livesLost: number; finish: number }) => number) => {
      const values = runs.map((r) => r.margins.find((m) => m.wave === n)).filter((m) => m !== undefined).map(pick);
      return values.length === 0 ? '' : String(median(values));
    };
    const lives = Array.from({ length: waves }, (_, i) => cell(i + 1, (m) => m.livesLost).padStart(6)).join('');
    const finish = Array.from({ length: waves }, (_, i) => cell(i + 1, (m) => Math.round(m.finish / 10)).padStart(6)).join('');
    out.push(`${strategy.padEnd(8)}${lives}`);
    out.push(`${'  path %'.padEnd(8)}${finish}`);
  }
  return out;
}

/** One line per bot: median end wave and lives, plus the spread over seeds. */
export function summarise(results: RunResult[]): string[] {
  const out: string[] = [];
  for (const strategy of [...new Set(results.map((r) => r.strategy))]) {
    const runs = results.filter((r) => r.strategy === strategy);
    const ends = runs.map(endWave);
    const fmt = (w: number) => (w === SURVIVED ? 'survived' : `w${w}`);
    out.push(
      `${strategy.padEnd(8)}  median ${fmt(median(ends)).padEnd(8)}  lives ${median(runs.map((r) => r.lives))}  ` +
        `spread ${runs.map((r) => `${fmt(endWave(r))}/${r.lives}`).join(' ')}`,
    );
  }
  return out;
}

export const SINGLE_CLASS: Strategy[] = ['PALADIN', 'SORC', 'NECRO'];

/** The M6 gate: Hell cannot be cleared with one class; all three together can. */
export function checkHellGate(results: RunResult[]): Targets {
  const notes: string[] = [];
  for (const strategy of SINGLE_CLASS) {
    const cleared = results.filter((r) => r.strategy === strategy && r.won).map((r) => r.seed);
    if (cleared.length > 0) notes.push(`${strategy} cleared Hell on seeds ${cleared.join(', ')}`);
  }
  const mixed = results.filter((r) => r.strategy === 'MIXED3');
  if (mixed.length > 0 && median(mixed.map(endWave)) !== SURVIVED) notes.push(`MIXED3 median: lost on wave ${median(mixed.map(endWave))}`);
  return { ok: notes.length === 0, notes };
}

export function runAll(design: DesignData, waves: number, seeds: number[], strategies = STRATEGIES, difficulty = 0): RunResult[] {
  const data = buildGameData(loadTables(), design, waves, { difficulty });
  const results: RunResult[] = [];
  for (const strategy of strategies) for (const seed of seeds) results.push(runBot(data, strategy, seed));
  return results;
}

function main(): void {
  const { values: args } = parseArgs({
    options: {
      waves: { type: 'string', default: '30' },
      seeds: { type: 'string', default: '1,2,3,4,5' },
      hp: { type: 'string' },
      bounty: { type: 'string' },
      cost: { type: 'string' },
      hell: { type: 'boolean', default: false },
      bots: { type: 'string' },
    },
  });
  const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));
  const design = withMultipliers(DESIGN, { hp: num(args.hp), bounty: num(args.bounty), cost: num(args.cost) });
  const waves = Number(args.waves);
  const seeds = args.seeds.split(',').map(Number);
  const b = design.balance;

  console.log(
    `hp ${b.hpPctPerWave}%/wave  bounty ${b.bountyPctPerWave}%/wave  ` +
      `level cost ${b.levelCostBase.join('/')} x${b.levelCostPctPerLevel}%  tiers ${b.tierCosts.join('/')}  ` +
      `evolve ${b.evolveCost}  start ${b.startingGold}g  ${waves} waves`,
  );
  console.log('strategy  seed  result    wave  lives  gold banked  towers  progress  top tier  evolutions');
  const strategies = args.bots ? (args.bots.split(',') as Strategy[]) : args.hell ? HELL_STRATEGIES : STRATEGIES;
  const results = runAll(design, waves, seeds, strategies, args.hell ? 2 : 0);
  for (const r of results) {
    const evolutions = Object.entries(r.evolvedOn).map(([id, wave]) => `${id}@w${wave}`).join(' ');
    console.log(
      `${r.strategy.padEnd(8)}  ${String(r.seed).padStart(4)}  ${(r.won ? 'survived' : 'lost').padEnd(8)}  ` +
        `${String(r.wave).padStart(4)}  ${String(r.lives).padStart(5)}  ${String(r.gold).padStart(11)}  ` +
        `${String(r.towers).padStart(6)}  ${String(r.levels).padStart(8)}  ${String(r.topTier).padStart(8)}  ${evolutions}`,
    );
  }
  console.log('');
  for (const line of marginTable(results, waves)) console.log(line);
  console.log('');
  for (const line of summarise(results)) console.log(line);
  const targets = args.hell ? checkHellGate(results) : checkTargets(results, waves);
  console.log(targets.ok ? 'Targets met.' : `Targets missed:\n  ${targets.notes.join('\n  ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
