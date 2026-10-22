// Cow level report: ordinary bots play the campaign with and without opening the Secret Cow
// Level as Hell Act 5 begins, and the wave each run ends on is printed side by side. The
// design wants the portal at Hell Act 5 to usually lose the run: the cows overrun the ring.
//
//   npm run cow                          PALADIN, seeds 1 to 3
//   npm run cow -- --bots PALADIN,TWOLINE --seeds 1,2,3,4

import { parseArgs } from 'node:util';

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, waveLabel } from '../src/sim/data.ts';
import { runBot, type Strategy } from './bots.ts';
import { loadTables } from './lib/load-tables.ts';

const { values: args } = parseArgs({ options: { bots: { type: 'string', default: 'PALADIN' }, seeds: { type: 'string', default: '1,2,3' } } });
const bots = args.bots.split(',') as Strategy[];
const seeds = args.seeds.split(',').map(Number);
const tables = loadTables();
const data = () => buildGameData(tables, DESIGN);
const probe = data();
const at = probe.waves.findIndex((w) => w.difficulty === 2 && w.act === 5 && w.actWave === 1) + 1;
console.log(`Portal opens as wave ${at} (${waveLabel(probe.waves[at - 1]!)}) starts\n`);
// The run ends in the first endless Tiers either way; stop a little past Hell
const maxTicks = (probe.waves.length + 12) * probe.economy.waveTicks;
let losses = 0;
let reached = 0;
for (const bot of bots) {
  for (const seed of seeds) {
    const plain = runBot(data(), bot, seed, undefined, maxTicks);
    let inCow = false;
    let peak = 0;
    const cow = runBot(data(), bot, seed, (sim) => {
      inCow = sim.state.cow !== undefined;
      if (inCow) peak = Math.max(peak, sim.state.alive);
    }, maxTicks, at);
    const diedInCow = !cow.won && inCow;
    const label = (r: typeof plain) => (r.won ? 'won' : `wave ${r.wave}`);
    const got = plain.wave >= at;
    if (got) {
      reached++;
      if (diedInCow) losses++;
    }
    const how = diedInCow ? ', lost to the cows' : `, cleared the cows (peak alive ${peak})`;
    console.log(`${bot} seed ${seed}: without the portal ${label(plain)}, with it ${label(cow)}${got ? how : ' (never reached Hell Act 5)'}`);
  }
}
console.log(`\n${losses} of ${reached} runs that reached Hell Act 5 lost the run to the cows.`);
