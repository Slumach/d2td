// The monster HP curve by stage (balance.json hpCurve, computed at load time in data.ts):
// for every act of every difficulty, the tier the stage is tuned for, the median single hit
// of that tier's towers, the median regular monster's HP from the tables, and the percent
// that makes the one about hitsToKill of the other. Bosses keep their ramp on top.
//
//   npm run hpcurve

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, stageHpPctFrom, waveLabel, waveTotalHp } from '../src/sim/data.ts';
import { createSim, waveAt } from '../src/sim/sim.ts';
import { DIFFICULTIES } from '../src/sim/difficulty.ts';
import { loadTables } from './lib/load-tables.ts';

const data = buildGameData(loadTables(), DESIGN);
// Before the run extends it, the wave list is the campaign
const campaign = data.waves.slice();
const { stages } = stageHpPctFrom(DESIGN.balance, campaign, data.monsters, DESIGN.classes, data.skills, data.evolutions, (id, plus, bonus) => data.skills[data.skillVariant(id, plus, undefined, bonus)]!);
const hp = (v: number) => Math.round(v / 256).toLocaleString('en-US');
const { hitsToKill } = DESIGN.balance.hpCurve;
console.log(`Monster HP by stage: a regular monster takes ${hitsToKill} single hits from the median tower of the stage's tier and level (T4: the evolved towers)`);
console.log('  stage            tower   median hit   regular HP (tables)   HP %   regular HP now');
for (const s of stages) {
  const name = `${DIFFICULTIES[s.difficulty]} act ${s.act}`;
  console.log(`  ${name.padEnd(16)} T${s.tier} L${s.level}   ${hp(s.hit).padStart(8)}   ${hp(s.hp).padStart(19)}   ${String(s.pct).padStart(4)}   ${hp((s.hp * s.pct) / 100).padStart(14)}`);
}

// Every wave's total HP as it spawns, campaign and endless, against the wave before it, with
// the schedule's fit (smoothWave): no regular wave over regularMaxPct, no boss wave over bossMaxPct
const { regularMaxPct, bossMaxPct } = DESIGN.balance.waveSmoothing;
const upTo = Number(process.argv[2] ?? 160);
const sim = createSim(data, 1);
console.log('');
console.log(`Total HP by wave as spawned (stage curve, endless ramp, the schedule's fit); budget ${regularMaxPct}% of the wave before, ${bossMaxPct}% for a boss`);
console.log('  wave  stage                       total HP     x prev   fit');
let prev = 0;
let worst = { regular: 0, boss: 0 };
let over = 0;
for (let n = 1; n <= upTo; n++) {
  const w = waveAt(sim, n - 1)!;
  const total = waveTotalHp(w, n - 1, data.rules, data.monsters);
  const ratio = prev > 0 ? total / prev : 0;
  const limit = (w.final ? bossMaxPct : regularMaxPct) / 100;
  if (prev > 0 && ratio > limit + 0.005) over++;
  if (prev > 0) worst = w.final ? { ...worst, boss: Math.max(worst.boss, ratio) } : { ...worst, regular: Math.max(worst.regular, ratio) };
  const packs = w.groups.some((g) => g.hpPct !== undefined) ? `packs at ${w.groups.find((g) => g.hpPct !== undefined)!.hpPct}%` : '';
  const fit = [packs, w.smoothPermille !== undefined ? `wave at ${(w.smoothPermille / 10).toFixed(1)}%` : ''].filter(Boolean).join(', ');
  console.log(`  ${String(n).padStart(4)}  ${(waveLabel(w) + (w.final ? ' (boss)' : '')).padEnd(26)} ${(total / 256 / 1e6).toFixed(2).padStart(9)}M   ${prev > 0 ? ratio.toFixed(2).padStart(6) : '     -'}   ${fit}`);
  prev = total;
}
console.log(`  largest step: ${worst.regular.toFixed(2)}x into a regular wave, ${worst.boss.toFixed(2)}x into a boss wave; waves over budget: ${over}`);
