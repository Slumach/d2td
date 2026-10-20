// Debuff: weakens monsters in radius. The reductions are the skill's own aurastat
// columns: fireresist, coldresist, lightresist, poisonresist, magicresist and
// damageresist (physical). Conviction, Lower Resist, Amplify Damage.

import type { Element } from '../state.ts';
import { auraStats, auraUnits, calcAt, common, fields, perLevel } from './common.ts';
import type { ArchetypeModule, DebuffDef } from './types.ts';

interface DebuffJson {
  mode: 'aura';
  radiusCalc?: string;
}

const RESIST_STATS: Record<string, Element> = {
  fireresist: 'fire',
  coldresist: 'cold',
  lightresist: 'ltng',
  poisonresist: 'pois',
  magicresist: 'mag',
  damageresist: 'phys',
};

export const debuff: ArchetypeModule<DebuffDef> = {
  id: 'debuff',

  resolve(json, ctx) {
    const f = fields<DebuffJson>(json);
    return {
      ...common(json, ctx, false),
      archetype: 'debuff',
      mode: f.mode,
      levels: perLevel(json, (level) => {
        const resistDown: Partial<Record<Element, number>> = {};
        for (const [stat, value] of Object.entries(auraStats(ctx.skillRow, level))) {
          const element = RESIST_STATS[stat];
          if (element && value < 0) resistDown[element] = -value;
        }
        return {
          radiusUnits: auraUnits(calcAt(ctx.skillRow, f.radiusCalc ?? 'aurarangecalc', level), ctx.auraRangePerTile),
          resistDown,
        };
      }),
    };
  },

  aura(skill, lvl) {
    const { radiusUnits, resistDown } = skill.levels[lvl]!;
    return { radiusUnits, monsters: { slowPct: 0, resistDown } };
  },
};
