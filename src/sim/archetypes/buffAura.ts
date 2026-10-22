// Buff aura: boosts towers in radius. The bonuses are the skill's own aurastat columns:
// damagepercent becomes tower damage, attackrate becomes tower attack speed, and
// firemindam/firemaxdam add fire to every hit (Enchant). Might, Concentration,
// Fanaticism, Enchant. Two of the same aura on a tower: strongest only.

import { int } from '../tables.ts';
import { auraStats, auraUnits, calcAt, common, fields, perLevel, tenthsToUnits } from './common.ts';
import type { ArchetypeModule, BuffAuraDef } from './types.ts';

interface BuffAuraJson {
  radiusCalc?: string;
  /** For a skill with no radius in skills.txt (Enchant targets one ally in D2): a design radius. */
  radiusTenths?: number;
  /**
   * A passive (Critical Strike, Pierce): the bonus is in the passivestat columns rather
   * than aurastat, and is projected to the towers in radiusTenths as a support aura.
   * passive_critical_strike counts as damage percent (the chance to deal double), and
   * skill_pierce as the chance a bolt flies on.
   */
  passive?: boolean;
}

/** passivestatN / passivecalcN pairs of a skill at a level, by D2 stat name. */
function passiveStats(row: Parameters<typeof calcAt>[0], level: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 1; i <= 5; i++) {
    const stat = String(row[`passivestat${i}`] ?? '');
    if (stat) out[stat] = calcAt(row, `passivecalc${i}`, level);
  }
  return out;
}

export const buffAura: ArchetypeModule<BuffAuraDef> = {
  id: 'buffAura',

  resolve(json, ctx) {
    const f = fields<BuffAuraJson>(json);
    // Added elemental damage is in the skill's HitShift units, like its EMin
    const shift = 2 ** int(ctx.skillRow, 'HitShift');
    return {
      ...common(json, ctx, false),
      archetype: 'buffAura',
      levels: perLevel(json, (level) => {
        const stats = f.passive ? passiveStats(ctx.skillRow, level) : auraStats(ctx.skillRow, level);
        return {
          radiusUnits:
            f.radiusTenths !== undefined
              ? tenthsToUnits(f.radiusTenths)
              : auraUnits(calcAt(ctx.skillRow, f.radiusCalc ?? 'aurarangecalc', level), ctx.auraRangePerTile),
          damagePct: (stats['damagepercent'] ?? 0) + (stats['passive_critical_strike'] ?? 0),
          attackSpeedPct: stats['attackrate'] ?? 0,
          piercePct: Math.min(100, stats['skill_pierce'] ?? 0),
          fireMin: (stats['firemindam'] ?? 0) * shift,
          fireMax: (stats['firemaxdam'] ?? 0) * shift,
        };
      }),
    };
  },

  aura(skill, lvl) {
    const { radiusUnits, damagePct, attackSpeedPct, piercePct, fireMin, fireMax } = skill.levels[lvl]!;
    return { radiusUnits, towers: { damagePct, attackSpeedPct, piercePct, fireMin, fireMax } };
  },
};
