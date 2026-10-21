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
        const stats = auraStats(ctx.skillRow, level);
        return {
          radiusUnits:
            f.radiusTenths !== undefined
              ? tenthsToUnits(f.radiusTenths)
              : auraUnits(calcAt(ctx.skillRow, f.radiusCalc ?? 'aurarangecalc', level), ctx.auraRangePerTile),
          damagePct: stats['damagepercent'] ?? 0,
          attackSpeedPct: stats['attackrate'] ?? 0,
          fireMin: (stats['firemindam'] ?? 0) * shift,
          fireMax: (stats['firemaxdam'] ?? 0) * shift,
        };
      }),
    };
  },

  aura(skill, lvl) {
    const { radiusUnits, damagePct, attackSpeedPct, fireMin, fireMax } = skill.levels[lvl]!;
    return { radiusUnits, towers: { damagePct, attackSpeedPct, fireMin, fireMax } };
  },
};
