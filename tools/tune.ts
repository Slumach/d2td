// Multiplier search for the balance harness: tries every combination of wave HP, bounty
// and level-cost growth on a grid, plays all four bots on each, and lists the combinations
// closest to the targets in tools/balance.ts. Nothing is written; copy the winner into
// src/data/balance.json by hand and confirm with npm run balance.
//
//   npm run tune -- --hp 112:124:2 --bounty 105:125:5 --cost 160:220:20 --seeds 1,2,3

import { parseArgs } from 'node:util';

import { DESIGN } from '../src/data/design.ts';
import { HAMMERDIN_BY_WAVE, LOSS_WAVES, checkTargets, endWave, median, runAll, withMultipliers } from './balance.ts';

const { values: args } = parseArgs({
  options: {
    hp: { type: 'string', default: '114:126:2' },
    bounty: { type: 'string', default: '105:125:5' },
    cost: { type: 'string', default: '160:220:20' },
    seeds: { type: 'string', default: '1,2,3' },
    waves: { type: 'string', default: '30' },
    top: { type: 'string', default: '8' },
  },
});

const range = (spec: string) => {
  const [from, to, by] = spec.split(':').map(Number) as [number, number, number?];
  const out: number[] = [];
  for (let v = from; v <= (to ?? from); v += by ?? 1) out.push(v);
  return out;
};
const seeds = args.seeds.split(',').map(Number);
const waves = Number(args.waves);

/** How far a combination is from the targets: waves off for each bot, plus Hammerdin timing. */
function score(results: ReturnType<typeof runAll>): number {
  let miss = 0;
  for (const [bot, wanted] of Object.entries(LOSS_WAVES)) {
    const m = median(results.filter((r) => r.strategy === bot).map(endWave));
    miss += Math.min(...wanted.map((w) => Math.abs(m - w)));
  }
  const pal = results.filter((r) => r.strategy === 'PALADIN');
  const palEnd = median(pal.map(endWave));
  miss += Math.max(0, waves + 1 - palEnd) * 2;
  const late = pal.filter((r) => (r.evolvedOn['hammerdin'] ?? 99) > HAMMERDIN_BY_WAVE).length;
  return miss + late * 0.5;
}

const rows: { hp: number; bounty: number; cost: number; score: number; ok: boolean; summary: string }[] = [];
const t0 = Date.now();
for (const hp of range(args.hp)) {
  for (const bounty of range(args.bounty)) {
    for (const cost of range(args.cost)) {
      const results = runAll(withMultipliers(DESIGN, { hp, bounty, cost }), waves, seeds);
      const t = checkTargets(results, waves);
      const summary = ['BOLT', 'HOLY', 'TWOLINE', 'PALADIN']
        .map((b) => {
          const rs = results.filter((r) => r.strategy === b);
          const m = median(rs.map(endWave));
          return `${b} ${m > waves ? `won/${median(rs.map((r) => r.peakAlive))}` : `w${m}`}`;
        })
        .join('  ');
      rows.push({ hp, bounty, cost, score: score(results), ok: t.ok, summary });
      process.stdout.write('.');
    }
  }
}
console.log(`\n${rows.length} combinations in ${((Date.now() - t0) / 1000).toFixed(0)} s, seeds ${seeds.join(',')}`);
for (const r of rows.sort((a, b) => a.score - b.score).slice(0, Number(args.top))) {
  console.log(`hp ${r.hp} bounty ${r.bounty} cost ${r.cost}  miss ${r.score.toFixed(1)}${r.ok ? '  ALL TARGETS' : ''}  | ${r.summary}`);
}
