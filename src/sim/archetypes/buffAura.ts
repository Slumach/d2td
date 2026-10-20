// Buff aura: boosts towers in radius. The bonuses are the skill's own aurastat columns:
// damagepercent becomes tower damage, attackrate becomes tower attack speed. Might,
// Concentration, Fanaticism, Enchant. Two of the same aura on a tower: strongest only.

import { auraStats, auraUnits, calcAt, common, fields, perLevel } from './common.ts';
import type { ArchetypeModule, BuffAuraDef } from './types.ts';

interface BuffAuraJson {
  radiusCalc?: string;
}

export const buffAura: ArchetypeModule<BuffAuraDef> = {
  id: 'buffAura',

  resolve(json, ctx) {
    const f = fields<BuffAuraJson>(json);
    return {
      ...common(json, ctx, false),
      archetype: 'buffAura',
      levels: perLevel(json, (level) => {
        const stats = auraStats(ctx.skillRow, level);
        return {
          radiusUnits: auraUnits(calcAt(ctx.skillRow, f.radiusCalc ?? 'aurarangecalc', level), ctx.auraRangePerTile),
          damagePct: stats['damagepercent'] ?? 0,
          attackSpeedPct: stats['attackrate'] ?? 0,
        };
      }),
    };
  },

  aura(skill, lvl) {
    const { radiusUnits, damagePct, attackSpeedPct } = skill.levels[lvl]!;
    return { radiusUnits, towers: { damagePct, attackSpeedPct } };
  },
};
