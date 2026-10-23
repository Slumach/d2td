// The monster HP curve by stage (balance.json hpCurve, computed at load time in data.ts):
// for every act of every difficulty, the tier the stage is tuned for, the median single hit
// of that tier's towers, the median regular monster's HP from the tables, and the percent
// that makes the one about hitsToKill of the other. Bosses keep their ramp on top.
//
//   npm run hpcurve

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, stageHpPctFrom, waveLabel, waveTargetHp, waveTotalHp } from '../src/sim/data.ts';
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

// Every wave's target (its own HP from the tables, packs aside) and its total as it spawns,
// the packs fitted within packBudget of the target: no wave is cut, so each sits at its target
const { regularMaxPct, bossMaxPct } = DESIGN.balance.packBudget;
const upTo = Number(process.argv[2] ?? 160);
const sim = createSim(data, 1);
console.log('');
console.log(`Waves 1 to ${upTo}: target HP (the tables), total as spawned, the packs' share; packs fit within ${regularMaxPct}% of the target, ${bossMaxPct}% for a boss`);
console.log('  wave  stage                        target HP     total HP   total/target   step from previous   packs');
let prev = 0;
let worst = { regular: 0, boss: 0 };
let over = 0;
for (let n = 1; n <= upTo; n++) {
  const w = waveAt(sim, n - 1)!;
  const target = waveTargetHp(w, n - 1, data.rules, data.monsters);
  const total = waveTotalHp(w, n - 1, data.rules, data.monsters);
  const ratio = target > 0 ? total / target : 1;
  if (ratio > (w.final ? bossMaxPct : regularMaxPct) / 100 + 0.005) over++;
  worst = w.final ? { ...worst, boss: Math.max(worst.boss, ratio) } : { ...worst, regular: Math.max(worst.regular, ratio) };
  const fitted = w.groups.find((g) => g.hpPct !== undefined);
  const m = (v: number) => `${(v / 256 / 1e6).toFixed(2)}M`;
  console.log(`  ${String(n).padStart(4)}  ${(waveLabel(w) + (w.final ? ' (boss)' : '')).padEnd(27)} ${m(target).padStart(10)}   ${m(total).padStart(10)}   ${ratio.toFixed(2).padStart(12)}   ${prev > 0 ? (total / prev).toFixed(2).padStart(18) : '                 -'}   ${fitted ? `fitted to ${fitted.hpPct}%` : ''}`);
  prev = total;
}
console.log(`  every wave at its target (no cut but packs); largest pack-caused step ${worst.regular.toFixed(2)}x of target in a regular wave, ${worst.boss.toFixed(2)}x in a boss wave; over budget: ${over}`);
