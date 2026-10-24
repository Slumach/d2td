// Battle harness (Battle Mode, src/sim/battle.ts): the battle bot plays bot against bot, a
// 1v1 for every race pairing on every seed, each pairing played from both sides of the map
// so neither team's side counts. It prints each race's win rate against every other, the
// wave the losing king fell on, and flags any race above 60% or below 40% overall or
// against any one race.
//
//   npm run battle
//   npm run battle -- --seeds 1,2 --races paladin,sorceress --jobs 4
//   npm run battle -- --team 2                     2v2, each team one race
//   npm run battle -- --set battle.worker.cost=300  try a balance.json number without editing it
//   npm run battle -- --one paladin,sorceress,1     one match, its wave by wave log

import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, type BalanceJson, type GameData } from '../src/sim/data.ts';
import { createMatch, stepMatch, type Match } from '../src/sim/match.ts';
import { loadTables } from './lib/load-tables.ts';

const { values: args } = parseArgs({
  options: {
    races: { type: 'string', default: 'paladin,sorceress,necromancer,amazon,barbarian,druid,assassin' },
    seeds: { type: 'string', default: '1,2,3,4' },
    team: { type: 'string', default: '1' },
    jobs: { type: 'string', default: String(Math.max(1, Math.min(6, availableParallelism() >> 1))) },
    set: { type: 'string', multiple: true, default: [] },
    one: { type: 'string' },
    batch: { type: 'string' },
    log: { type: 'boolean', default: false },
  },
});

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

export interface BattleResult {
  a: string;
  b: string;
  seed: number;
  /** The team that won (0 is a's), or -1 for a draw. */
  winner: number;
  /** Waves started when it ended, and the kings' life then. */
  wave: number;
  kings: number[];
  leaks: number[];
  sends: number[];
  towers: number[];
  ticks: number;
}

/** The longest a match may run: every wave at its longest fight and build. */
function tickCap(data: GameData): number {
  const r = data.battle!.rules;
  return r.firstBuildTicks + r.waves.length * (r.buildTicks + r.fightMaxTicks) + 100;
}

/** One match, bots on every slot: race a's team on the first side, b's on the second. */
export function playBattle(data: GameData, a: string, b: string, seed: number, team = 1, onWave?: (m: Match) => void): BattleResult {
  const races = [...Array<string>(team).fill(a), ...Array<string>(team).fill(b)];
  const match = createMatch(data, seed, 'battle', team * 2, { teamSize: team, races, bots: races.map((_, i) => i) });
  const cap = tickCap(data);
  let wave = 0;
  while (match.state.status !== 'over' && match.state.tick < cap) {
    stepMatch(match, []);
    const bs = match.state.battle!;
    if (bs.phase === 'build' && bs.wave !== wave) {
      wave = bs.wave;
      onWave?.(match);
    }
  }
  const winners = match.state.winners;
  const winner = winners.length === 0 ? -1 : winners[0]! < team ? 0 : 1;
  const z = match.zones.map((s) => s.state.battle!);
  return {
    a,
    b,
    seed,
    winner,
    wave: match.state.battle!.wave,
    kings: z.map((k) => k.king.hp),
    leaks: z.map((k) => k.leaks.reduce((n, x) => n + x, 0)),
    sends: z.map((k) => k.sendsMade.reduce((n, x) => n + x, 0)),
    towers: match.zones.map((s) => s.state.towers.filter((t) => t.legendOf === undefined).length),
    ticks: match.state.tick,
  };
}

function logWave(m: Match): void {
  const parts = m.zones.map((z, t) => {
    const b = z.state.battle!;
    const towers = z.state.towers.filter((tw) => tw.legendOf === undefined);
    const tiers = towers.map((tw) => (tw.evolved ? 'E' : `${tw.tier}.${tw.level}`)).join(' ');
    return `T${t} king ${b.king.hp}/${b.king.maxHp} gold ${z.state.gold.join('/')} souls ${b.souls.join('/')} workers ${b.workers.join('/')} leaks ${b.leaks.join('/')} sends ${b.sendsMade.join('/')} [${tiers}]`;
  });
  console.log(`wave ${m.state.battle!.wave} tick ${m.state.tick}: ${parts.join(' | ')}`);
}

interface Task {
  a: string;
  b: string;
  seed: number;
}

async function main(): Promise<void> {
  const races = args.races.split(',');
  const seeds = args.seeds.split(',').map(Number);
  const team = Number(args.team);
  // Every unordered pairing, the mirror match included, each from both sides
  const tasks: Task[] = [];
  for (let i = 0; i < races.length; i++) {
    for (let j = i; j < races.length; j++) {
      for (const seed of seeds) {
        tasks.push({ a: races[i]!, b: races[j]!, seed });
        tasks.push({ a: races[j]!, b: races[i]!, seed });
      }
    }
  }
  const self = fileURLToPath(import.meta.url);
  const results: BattleResult[] = [];
  const jobs = Math.max(1, Math.min(Number(args.jobs), tasks.length));
  // Each child plays a batch, so the game data is built once a child
  const batches: Task[][] = Array.from({ length: jobs * 3 }, () => []);
  tasks.forEach((t, i) => batches[i % batches.length]!.push(t));
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      if (batch.length === 0) continue;
      const out = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', self, '--batch', batch.map((t) => `${t.a},${t.b},${t.seed}`).join(';'), '--team', String(team), ...args.set.flatMap((s) => ['--set', s])], { stdio: ['ignore', 'pipe', 'inherit'] });
        let text = '';
        child.stdout.on('data', (d: Buffer) => (text += d.toString()));
        child.on('exit', (code) => (code === 0 ? resolve(text) : reject(new Error(`batch ${next} failed`))));
      });
      for (const line of out.trim().split('\n')) if (line.startsWith('{')) results.push(JSON.parse(line) as BattleResult);
      process.stderr.write('.');
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  process.stderr.write('\n');
  report(races, results, team);
}

/** Win rates by race against race, the losers' wave, and the flags. */
function report(races: string[], results: BattleResult[], team: number): void {
  if (args.set.length > 0) console.log(`With ${args.set.join(', ')}`);
  console.log(`${team}v${team}, ${results.length} matches`);
  const wins = (r: string, o: string) => {
    let w = 0;
    let n = 0;
    for (const x of results) {
      if (x.a === r && x.b === o) {
        n++;
        w += x.winner === 0 ? 1 : x.winner === -1 ? 0.5 : 0;
      }
      if (x.b === r && x.a === o) {
        n++;
        w += x.winner === 1 ? 1 : x.winner === -1 ? 0.5 : 0;
      }
    }
    // A mirror counts each match twice, once from each side: half each
    return { w, n };
  };
  const short = (r: string) => r.slice(0, 5).padStart(6);
  console.log(`win %     ${races.map(short).join('')}   overall`);
  const flags: string[] = [];
  for (const r of races) {
    let tw = 0;
    let tn = 0;
    const cells = races.map((o) => {
      const { w, n } = wins(r, o);
      if (o !== r) {
        tw += w;
        tn += n;
      }
      const pct = n ? Math.round((100 * w) / n) : 0;
      if (o !== r && n && (pct > 60 || pct < 40)) flags.push(`${r} ${pct}% against ${o}`);
      return (o === r ? '-' : String(pct)).padStart(6);
    });
    const overall = tn ? Math.round((100 * tw) / tn) : 0;
    if (overall > 60 || overall < 40) flags.push(`${r} ${overall}% overall`);
    console.log(`${r.padEnd(10)}${cells.join('')}   ${String(overall).padStart(4)}${overall > 60 || overall < 40 ? ' FLAG' : ''}`);
  }
  const decided = results.filter((x) => x.winner >= 0);
  const fell = decided.filter((x) => x.kings[1 - x.winner]! <= 0).map((x) => x.wave).sort((p, q) => p - q);
  const draws = results.length - decided.length;
  const median = fell.length ? fell[fell.length >> 1] : undefined;
  console.log(`Kings fell in ${fell.length} of ${results.length} matches (median wave ${median ?? '-'}, ${fell[0] ?? '-'} to ${fell.at(-1) ?? '-'}); ${decided.length - fell.length} went the distance on life; ${draws} draws`);
  const side = results.filter((x) => x.winner === 0).length - results.filter((x) => x.winner === 1).length;
  console.log(`First side won ${results.filter((x) => x.winner === 0).length}, second ${results.filter((x) => x.winner === 1).length} (difference ${side})`);
  const byWave = new Map<number, number>();
  for (const w of fell) byWave.set(w, (byWave.get(w) ?? 0) + 1);
  console.log(`Falls by wave: ${[...byWave].map(([w, n]) => `${w}:${n}`).join(' ')}`);
  // A king that falls before the last wave ended the match early; mirrors are the even matches
  const last = balance().battle!.waves.length;
  const early = (xs: BattleResult[]) => xs.filter((x) => x.winner >= 0 && x.kings[1 - x.winner]! <= 0 && x.wave < last).length;
  const pctOf = (n: number, of: number) => (of ? Math.round((100 * n) / of) : 0);
  const mirrors = results.filter((x) => x.a === x.b);
  const lost = (x: BattleResult) => (x.winner === 0 ? x.b : x.a);
  const fallsOf = (r: string) => results.filter((x) => x.winner >= 0 && x.kings[1 - x.winner]! <= 0 && lost(x) === r).map((x) => x.wave).sort((p, q) => p - q);
  console.log(`Kings fell by race: ${races.map((r) => { const f = fallsOf(r); return `${r} ${f.length}${f.length ? ` (from wave ${f[0]}, median ${f[f.length >> 1]})` : ''}`; }).join(', ')}`);
  console.log(`Kings fell before wave ${last}: ${pctOf(early(results), results.length)}% of all matches, ${pctOf(early(mirrors), mirrors.length)}% of mirror matches (${early(mirrors)} of ${mirrors.length})`);
  console.log(flags.length ? `Flags: ${flags.join('; ')}` : 'No race outside 40 to 60%.');
}

if (args.one) {
  const [a, b, seed] = args.one.split(',') as [string, string, string];
  const data = buildGameData(loadTables(), { ...DESIGN, balance: balance() });
  console.log(JSON.stringify(playBattle(data, a, b, Number(seed), Number(args.team), logWave)));
} else if (args.batch) {
  const data = buildGameData(loadTables(), { ...DESIGN, balance: balance() });
  for (const t of args.batch.split(';')) {
    const [a, b, seed] = t.split(',') as [string, string, string];
    console.log(JSON.stringify(playBattle(data, a, b, Number(seed), Number(args.team), args.log ? logWave : undefined)));
  }
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
