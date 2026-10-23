// Item harness (Stage F): bots play with no items, with the loot of three Normal and
// Nightmare clears at 50% magic find, with the loot of three full clears at 150%, and in
// best-in-slot gear (tools/outfit.ts has the sets), and this prints the wave
// each run ends on and its towers then, beside the targets. Every class's bot plays (PALADIN,
// SORC, NECRO, AMAZON, BARB, DRUID, ASSASSIN), and MIXED7 builds from all seven. MIXED3, the
// Paladin, Sorceress and Necromancer together, is the reference bot the targets were set on and
// is held to them:
//
//   none   dies in Hell Act 1 or 2
//   nm     reaches Hell Act 4 or 5
//   hell   clears Hell Baal and dies in endless Tier 3 to 6
//   bis    dies between waves 175 and 225
//
// A single-class bot may die anywhere from Hell Act 3 on without that counting as a miss
// (Hell's immunities are built to stop one class); it misses only when it dies before
// Hell Act 3 and short of the set's target.
//
// A bot is judged on the median of its seeds (eight by default), and the line shows the
// spread from the lowest seed to the highest beside it.
//
//   npm run loot
//   npm run loot -- --bots PALADIN,NECRO --seeds 1,2 --sets nm,bis --jobs 6
//   LOOTBUILD builds around the loot it is handed (tools/outfit.ts lootBuilds); LOOT_DEBUG=1 prints its lines
//   npm run loot -- --set endless.hpPctPerWave=4      try a balance.json number without editing it

import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, waveLabel, type BalanceJson } from '../src/sim/data.ts';
import { runBot, type Strategy } from './bots.ts';
import { LOOT_SETS, type LootSet } from './outfit.ts';
import { loadTables } from './lib/load-tables.ts';

const { values: args } = parseArgs({
  options: {
    bots: { type: 'string', default: 'TWOLINE,PALADIN,SORC,NECRO,AMAZON,BARB,DRUID,ASSASSIN,MIXED3,MIXED7,LOOTBUILD' },
    seeds: { type: 'string', default: '1,2,3,4,5,6,7,8' },
    sets: { type: 'string', default: LOOT_SETS.join(',') },
    jobs: { type: 'string', default: String(Math.max(1, availableParallelism() - 1)) },
    set: { type: 'string', multiple: true, default: [] },
    one: { type: 'string' },
  },
});

/** The furthest a run may go: wave 260, well past the best-in-slot target. */
const MAX_WAVE = 260;
/** The bot held to the targets. */
const REFERENCE_BOT: Strategy = 'MIXED3';

/** balance.json with --set overrides (key or key.sub = number or comma list). */
function balance(): BalanceJson {
  const b = structuredClone(DESIGN.balance) as unknown as Record<string, unknown>;
  for (const kv of args.set) {
    const [path, value] = kv.split('=') as [string, string];
    const keys = path.split('.');
    let at = b;
    for (const k of keys.slice(0, -1)) at = at[k] as Record<string, unknown>;
    at[keys.at(-1)!] = value.includes(',') ? value.split(',').map(Number) : Number(value);
  }
  return b as unknown as BalanceJson;
}

interface Result {
  bot: string;
  seed: number;
  set: LootSet;
  wave: number;
  label: string;
  towers: number;
  /** Items worn at the end, over all towers. */
  worn: number;
}

function runOne(bot: Strategy, seed: number, set: LootSet): Result {
  const data = buildGameData(loadTables(), { ...DESIGN, balance: balance() });
  let worn = 0;
  const r = runBot(data, bot, seed, (sim) => (worn = sim.state.towers.reduce((n, t) => n + Object.keys(t.gear ?? {}).length, 0)), MAX_WAVE * data.economy.waveTicks, { loot: set });
  data.extendWaves?.(r.wave);
  const w = data.waves[Math.max(0, r.wave - 1)];
  return { bot, seed, set, wave: r.wave, label: w ? waveLabel(w) : '', towers: r.towers, worn };
}

/** The target, as a wave range, and whether a result is in it. */
function target(set: LootSet, data: ReturnType<typeof buildGameData>): { text: string; lo: number; hi: number } {
  const first = (d: number, a: number) => data.waves.findIndex((w) => w.difficulty === d && w.act === a) + 1;
  const camp = data.waves.filter((w) => !w.tier).length;
  const tier = (k: number) => camp + (k - 1) * data.waves.filter((w) => w.tier === 1).length + 1;
  switch (set) {
    case 'none':
      return { text: 'Hell Act 1 or 2', lo: first(2, 1), hi: first(2, 3) - 1 };
    case 'nm':
      return { text: 'reaches Hell Act 4 or 5', lo: first(2, 4), hi: camp };
    case 'hell':
      return { text: 'endless Tier 3 to 6', lo: tier(3), hi: tier(7) - 1 };
    default:
      return { text: 'waves 175 to 225', lo: 175, hi: 225 };
  }
}

async function main(): Promise<void> {
  const bots = args.bots.split(',') as Strategy[];
  const seeds = args.seeds.split(',').map(Number);
  const sets = args.sets.split(',') as LootSet[];
  const tasks = sets.flatMap((set) => bots.flatMap((bot) => seeds.map((seed) => ({ bot, seed, set }))));
  const self = fileURLToPath(import.meta.url);
  const results: Result[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++]!;
      const out = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', self, '--one', `${t.bot},${t.seed},${t.set}`, ...args.set.flatMap((s) => ['--set', s])], { stdio: ['ignore', 'pipe', 'inherit'] });
        let text = '';
        child.stdout.on('data', (d: Buffer) => (text += d.toString()));
        child.on('exit', (code) => (code === 0 ? resolve(text) : reject(new Error(`${t.bot} ${t.seed} ${t.set} failed`))));
      });
      results.push(JSON.parse(out.trim().split('\n').at(-1)!) as Result);
      process.stderr.write('.');
    }
  };
  await Promise.all(Array.from({ length: Math.min(Number(args.jobs), tasks.length) }, worker));
  process.stderr.write('\n');
  const data = buildGameData(loadTables(), { ...DESIGN, balance: balance() });
  data.extendWaves?.(MAX_WAVE);
  const hellAct3 = data.waves.findIndex((w) => w.difficulty === 2 && w.act === 3) + 1;
  if (args.set.length > 0) console.log(`With ${args.set.join(', ')}\n`);
  for (const set of sets) {
    const t = target(set, data);
    console.log(`${set} (target for MIXED3: ${t.text}, waves ${t.lo} to ${t.hi}; other bots may die from Hell Act 3, wave ${hellAct3}, on)`);
    for (const bot of bots) {
      const rs = results.filter((r) => r.set === set && r.bot === bot).sort((a, b) => a.seed - b.seed);
      const waves = rs.map((r) => r.wave).sort((a, b) => a - b);
      const mid = waves.length >> 1;
      const median = waves.length % 2 ? waves[mid]! : (waves[mid - 1]! + waves[mid]!) / 2;
      const inTarget = median >= t.lo && median <= t.hi;
      const miss = bot === REFERENCE_BOT ? !inTarget : median < t.lo && median < hellAct3;
      console.log(`  ${bot.padEnd(9)} median ${median} (${waves[0]} to ${waves.at(-1)})${miss ? ' MISS' : ''}`);
      console.log(`            ${rs.map((r) => `s${r.seed} ${r.wave} ${r.label} (${r.towers}t ${r.worn}i)`).join('; ')}`);
    }
  }
}

if (args.one) {
  const [bot, seed, set] = args.one.split(',') as [Strategy, string, LootSet];
  console.log(JSON.stringify(runOne(bot, Number(seed), set)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
