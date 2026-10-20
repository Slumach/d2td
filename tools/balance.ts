// Balance harness: plays the headless sim with every bot strategy and reports how far
// each gets. Reads the real tables from assets-extracted/data and src/data/balance.json.
//
//   npm run balance
//   npm run balance -- --waves 30 --seeds 1,2,3,4,5
//   npm run balance -- --hp 112 --bounty 105 --cost 160     try multipliers without editing the file
//
// Targets
//   BOLT loses on waves 10 to 12, HOLY on 18 to 24, TWOLINE on 25 to 28
//   PALADIN survives all 30 waves with 4 lives or fewer, and has a Hammerdin by wave 15

import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, type BalanceJson, type DesignData } from '../src/sim/data.ts';
import { STRATEGIES, runBot, type RunResult } from './bots.ts';
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

/** Waves on which each losing bot should fall. */
export const LOSS_WINDOWS: Record<'BOLT' | 'HOLY' | 'TWOLINE', [number, number]> = {
  BOLT: [10, 12],
  HOLY: [18, 24],
  TWOLINE: [25, 28],
};
export const PALADIN_MAX_LIVES = 4;
export const HAMMERDIN_BY_WAVE = 15;

export function checkTargets(results: RunResult[], waves: number): Targets {
  const notes: string[] = [];
  for (const r of results) {
    const where = `${r.strategy} seed ${r.seed}`;
    if (r.strategy === 'PALADIN') {
      if (!r.won) notes.push(`${where} lost on wave ${r.wave} of ${waves}`);
      else if (r.lives > PALADIN_MAX_LIVES) notes.push(`${where} kept ${r.lives} lives`);
      const hammerdin = r.evolvedOn['hammerdin'];
      if (hammerdin === undefined || hammerdin > HAMMERDIN_BY_WAVE) {
        notes.push(`${where} Hammerdin ${hammerdin === undefined ? 'never' : `on wave ${hammerdin}`}`);
      }
    } else {
      const [from, to] = LOSS_WINDOWS[r.strategy];
      if (r.won || r.wave < from || r.wave > to) notes.push(`${where} ${r.won ? 'survived' : `lost on wave ${r.wave}`}, wants ${from}-${to}`);
    }
  }
  return { ok: notes.length === 0, notes };
}

export function runAll(design: DesignData, waves: number, seeds: number[]): RunResult[] {
  const data = buildGameData(loadTables(), design, waves);
  const results: RunResult[] = [];
  for (const strategy of STRATEGIES) for (const seed of seeds) results.push(runBot(data, strategy, seed));
  return results;
}

function main(): void {
  const { values: args } = parseArgs({
    options: {
      waves: { type: 'string', default: '30' },
      seeds: { type: 'string', default: '1,2,3' },
      hp: { type: 'string' },
      bounty: { type: 'string' },
      cost: { type: 'string' },
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
  const results = runAll(design, waves, seeds);
  for (const r of results) {
    const evolutions = Object.entries(r.evolvedOn).map(([id, wave]) => `${id}@w${wave}`).join(' ');
    console.log(
      `${r.strategy.padEnd(8)}  ${String(r.seed).padStart(4)}  ${(r.won ? 'survived' : 'lost').padEnd(8)}  ` +
        `${String(r.wave).padStart(4)}  ${String(r.lives).padStart(5)}  ${String(r.gold).padStart(11)}  ` +
        `${String(r.towers).padStart(6)}  ${String(r.levels).padStart(8)}  ${String(r.topTier).padStart(8)}  ${evolutions}`,
    );
  }
  const targets = checkTargets(results, waves);
  console.log(targets.ok ? 'Targets met.' : `Targets missed:\n  ${targets.notes.join('\n  ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
