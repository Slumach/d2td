// Drop report: what the campaign's monsters drop, from the real tables, without playing.
// Every monster of every wave is killed once per run (by a tower with the given magic
// find), and the drops are counted by difficulty: items, qualities, runes, Smith's Hammers.
// The last table is each rune's chance per Hell kill, to set Smith's Hammer beside them.
//
//   npm run drops                       5 runs, no magic find
//   npm run drops -- --runs 20 --mf 300
//   npm run drops -- --sample 10000000    a bigger sample for the per-rune table

import { parseArgs } from 'node:util';

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, DIFFICULTY_NAMES } from '../src/sim/data.ts';
import { compoundPct } from '../src/sim/fixed.ts';
import { rollKillDrops } from '../src/sim/items/drops.ts';
import { createRng } from '../src/sim/rng.ts';
import { loadTables } from './lib/load-tables.ts';

const { values: args } = parseArgs({
  options: { runs: { type: 'string', default: '5' }, mf: { type: 'string', default: '0' }, tier: { type: 'string', default: '0' }, sample: { type: 'string', default: '400000' } },
});
const runs = Number(args.runs);
const mf = Number(args.mf);
const tier = Number(args.tier);

const data = buildGameData(loadTables(), DESIGN);
const items = data.items;
const scale = compoundPct(100 + data.drops.tierDropPct, tier);

interface Tally {
  kills: number;
  items: number;
  quality: Record<string, number>;
  runes: Record<string, number>;
  hammers: number;
  best: string[];
}
const tallies: Tally[] = DIFFICULTY_NAMES.map(() => ({ kills: 0, items: 0, quality: {}, runes: {}, hammers: 0, best: [] }));
const rng = createRng(12345);
let uid = 0;

for (let run = 0; run < runs; run++) {
  for (const wave of data.waves) {
    const t = tallies[wave.difficulty]!;
    for (const g of wave.groups) {
      const def = data.monsters[g.monster]!;
      const tc = g.rank === 'champion' ? def.treasure[1] : g.rank === 'unique' ? def.treasure[2] : def.treasure[0];
      for (let k = 0; k < g.count; k++) {
        t.kills++;
        const drops = rollKillDrops(items, rng, {
          tc,
          ctx: { mlvl: def.level, magicFind: mf, runePct: data.drops.runeMultiplierPct, noDropPct: Math.trunc(10_000 / scale) },
          hammerPpm: Math.trunc((data.drops.smithsHammerPpm * scale) / 100),
          uid: String(uid++),
        });
        for (const it of drops) {
          const base = items.bases[it.code]!;
          t.items++;
          if (base.consumable === 'socket') t.hammers++;
          else if (base.isRune) t.runes[it.code] = (t.runes[it.code] ?? 0) + 1;
          else t.quality[it.quality] = (t.quality[it.quality] ?? 0) + 1;
          if ((it.quality === 'unique' || it.quality === 'set') && t.best.length < 6) t.best.push(it.unique ?? it.setItem ?? '');
        }
      }
    }
  }
}

const runeName = (code: string) => items.bases[code]?.name ?? code;
console.log(`${runs} runs, magic find ${mf}, endless Tier ${tier} scaling (${scale}% drop rate), rune multiplier ${data.drops.runeMultiplierPct}%\n`);
for (const [d, t] of tallies.entries()) {
  const per = (n: number) => (n / runs).toFixed(1);
  const q = ['normal', 'superior', 'magic', 'rare', 'set', 'unique'].map((k) => `${k} ${per(t.quality[k] ?? 0)}`).join(', ');
  const runes = Object.entries(t.runes).sort(([a], [b]) => a.localeCompare(b));
  const top = runes.slice(-4).map(([c, n]) => `${runeName(c)} ${per(n)}`).join(', ');
  console.log(`${DIFFICULTY_NAMES[d]}: ${per(t.kills)} kills, ${per(t.items)} items a run (${q})`);
  console.log(`  runes ${per(runes.reduce((n, [, c]) => n + c, 0))} a run, highest: ${top || 'none'}; Smith's Hammers ${per(t.hammers)}`);
  if (t.best.length > 0) console.log(`  e.g. ${t.best.map((id) => items.strings[id] ?? id).join(', ')}`);
}

// Each rune's chance per Hell kill, over a large sample of Hell's monsters
const hell = data.waves.filter((w) => w.difficulty === 2).flatMap((w) => w.groups.filter((g) => g.rank === 'normal').map((g) => data.monsters[g.monster]!));
const sample = Number(args.sample);
const counts: Record<string, number> = {};
for (let i = 0; i < sample; i++) {
  const def = hell[i % hell.length]!;
  for (const it of rollKillDrops(items, rng, { tc: def.treasure[0], ctx: { mlvl: def.level, magicFind: 0, runePct: data.drops.runeMultiplierPct, noDropPct: 100 }, hammerPpm: data.drops.smithsHammerPpm, uid: 'x' })) {
    counts[it.code] = (counts[it.code] ?? 0) + 1;
  }
}
const ppm = (code: string) => Math.round(((counts[code] ?? 0) * 1_000_000) / sample);
console.log(`\nPer Hell kill, parts per million (${sample} kills): ${items.runeOrder.filter((c) => c >= 'r15').map((c) => `${runeName(c)} ${ppm(c)}`).join(', ')}; Smith's Hammer ${ppm('xsh')}`);
