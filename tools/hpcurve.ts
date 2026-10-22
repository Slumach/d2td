// The monster HP curve by stage (balance.json hpCurve, computed at load time in data.ts):
// for every act of every difficulty, the tier the stage is tuned for, the median single hit
// of that tier's towers, the median regular monster's HP from the tables, and the percent
// that makes the one about hitsToKill of the other. Bosses keep their ramp on top.
//
//   npm run hpcurve

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, stageHpPctFrom } from '../src/sim/data.ts';
import { DIFFICULTIES } from '../src/sim/difficulty.ts';
import { loadTables } from './lib/load-tables.ts';

const data = buildGameData(loadTables(), DESIGN);
// Before the run extends it, the wave list is the campaign
const campaign = data.waves;
const { stages } = stageHpPctFrom(DESIGN.balance, campaign, data.monsters, DESIGN.classes, data.skills, data.evolutions, (id, plus, bonus) => data.skills[data.skillVariant(id, plus, undefined, bonus)]!);
const hp = (v: number) => Math.round(v / 256).toLocaleString('en-US');
const { hitsToKill } = DESIGN.balance.hpCurve;
console.log(`Monster HP by stage: a regular monster takes ${hitsToKill} single hits from the median tower of the stage's tier and level (T4: the evolved towers)`);
console.log('  stage            tower   median hit   regular HP (tables)   HP %   regular HP now');
for (const s of stages) {
  const name = `${DIFFICULTIES[s.difficulty]} act ${s.act}`;
  console.log(`  ${name.padEnd(16)} T${s.tier} L${s.level}   ${hp(s.hit).padStart(8)}   ${hp(s.hp).padStart(19)}   ${String(s.pct).padStart(4)}   ${hp((s.hp * s.pct) / 100).padStart(14)}`);
}
