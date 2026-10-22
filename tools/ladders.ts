// Prints every class line's tier ladders: the skills.txt level behind each tower level and
// the value a tier-up is judged on, so a tier-up can be checked to be a strict upgrade.
// Attack skills show standard-target DPS (plain monster: not undead, not a demon, no
// resistances) in HP per second; auras show the multiplier they give a level-5 reference
// tower (balance.json tierLadder.referenceSkill), resistance cuts against a target at
// tierLadder.debuffTargetResist.
//
//   npm run ladders             print
//   npm run ladders -- --write  write computed tierBonus values into the skill JSON files

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, type GameData } from '../src/sim/data.ts';
import { ladderMetric } from '../src/sim/dps.ts';
import { TICKS_PER_SECOND } from '../src/sim/fixed.ts';
import { loadTables } from './lib/load-tables.ts';

/** standardDps units (1/256 HP per 1000 ticks) to HP per second. */
export function hpPerSecond(dps: number): number {
  return (dps * TICKS_PER_SECOND) / (256 * 1000);
}

function show(metric: 'dps' | 'aura', v: number): string {
  return metric === 'aura' ? `x${(v / 1000).toFixed(2)}` : hpPerSecond(v).toFixed(1);
}

export function ladderReport(data: GameData): string[] {
  const out: string[] = [];
  const { dpsPct, auraPct, referenceSkill, debuffTargetResist } = DESIGN.balance.tierLadder;
  const reference = data.skills[referenceSkill]!;
  for (const cls of Object.values(data.classes)) {
    for (const [lineId, line] of Object.entries(cls.lines)) {
      out.push(`${cls.name} ${line.name} line: a tier-up must reach ${Object.entries(dpsPct).map(([t, p]) => `T${t} ${p}%`).join(', ')} of the strongest tower it replaces`);
      line.tiers.forEach((options, t) => {
        for (const id of options) {
          const skill = data.skills[id]!;
          const ladder = data.ladders.find((l) => l.cls === cls.id && l.line === lineId && l.skill === id);
          const metric = ladder?.metric ?? (data.ladders.find((l) => l.cls === cls.id && l.line === lineId)?.metric ?? 'dps');
          const cells = skill.skillLevels.map(
            (lvl, i) => `L${i + 1} slvl ${String(lvl).padStart(2)} ${show(metric, ladderMetric(skill, i, reference, debuffTargetResist)).padStart(6)}`,
          );
          let note = 'T1, levels from the skill JSON';
          if (ladder) {
            note = `floor ${show(metric, Math.ceil((ladder.previous * (ladder.metric === 'aura' ? auraPct : dpsPct[String(ladder.tier)]!)) / 100))}`;
            if (!ladder.reached && ladder.tierBonus === 1000) note += ', not reached by the cap: a debuff, so no bonus';
            else if (!ladder.reached) note += `, not reached by the cap: TIER BONUS x${(ladder.tierBonus / 1000).toFixed(3)}`;
          }
          out.push(`  T${t + 1} ${skill.name.padEnd(20)} ${cells.join(' | ')}  (${note})`);
        }
      });
    }
  }
  out.push(`DPS in HP/s against a plain target; auras as the DPS multiplier on a level-5 ${reference.name} tower.`);
  return out;
}

/** Writes each skill's computed tierBonus into its JSON file (or removes a stale one). */
function writeTierBonuses(data: GameData): string[] {
  const changed: string[] = [];
  for (const ladder of data.ladders) {
    const path = join('src', 'data', 'skills', `${ladder.skill}.json`);
    const text = readFileSync(path, 'utf8');
    let next = text.replace(/\n  "tierBonus": \d+,/, '');
    if (ladder.tierBonus !== 1000) {
      next = next.replace(/("damageType": "[a-z]+",)/, `$1\n  "tierBonus": ${ladder.tierBonus},`);
    }
    if (next !== text) {
      writeFileSync(path, next);
      changed.push(`${ladder.skill}: tierBonus ${ladder.tierBonus === 1000 ? 'removed' : ladder.tierBonus}`);
    }
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: args } = parseArgs({ options: { write: { type: 'boolean', default: false } } });
  const data = buildGameData(loadTables(), DESIGN, undefined, { checkTierBonus: !args.write });
  for (const line of ladderReport(data)) console.log(line);
  if (args.write) {
    const changed = writeTierBonuses(data);
    console.log(changed.length > 0 ? `Updated: ${changed.join('; ')}` : 'All tierBonus values already match.');
  }
}
