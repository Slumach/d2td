// Corpse: consumes a corpse left by a kill. Corpse Explosion detonates one in range for a
// percent of the corpse's max HP, split between physical and the skill's element, hitting
// everything in radius. Kills leave corpses for corpseLifetimeTicks (balance.json).

import { aliveWithin, dealDamage, distSq, withBonus } from '../combat.ts';
import { idiv } from '../fixed.ts';
import { rollInt } from '../rng.ts';
import type { Corpse, Element } from '../state.ts';
import { auraUnits, calcAt, common, fields, filterFrom, perLevel } from './common.ts';
import type { ArchetypeModule, CorpseDef } from './types.ts';

interface CorpseJson {
  radiusCalc: string;
  minPctCalc: string;
  maxPctCalc: string;
  /** Share of the blast that is physical; the rest is the skill's damage type. */
  physicalPctCalc?: string;
}

export const corpse: ArchetypeModule<CorpseDef> = {
  id: 'corpse',

  resolve(json, ctx) {
    const f = fields<CorpseJson>(json);
    return {
      ...common(json, ctx, true),
      archetype: 'corpse',
      filter: filterFrom(undefined, ctx.filterOverride),
      levels: perLevel(json, (level) => ({
        radiusUnits: auraUnits(calcAt(ctx.skillRow, f.radiusCalc, level), ctx.auraRangePerTile),
        minPct: calcAt(ctx.skillRow, f.minPctCalc, level),
        maxPct: calcAt(ctx.skillRow, f.maxPctCalc, level),
        physicalPct: f.physicalPctCalc ? calcAt(ctx.skillRow, f.physicalPctCalc, level) : 0,
      })),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const s = sim.state;
    const level = skill.levels[lvl]!;
    // The corpse in range with the most monsters around it; ties to the oldest corpse
    let best: Corpse | undefined;
    let bestCount = 0;
    for (const c of s.corpses) {
      if (distSq(tower, c) > skill.rangeUnits * skill.rangeUnits) continue;
      const count = aliveWithin(sim, c, level.radiusUnits).length;
      if (count > bestCount) {
        best = c;
        bestCount = count;
      }
    }
    if (!best) return false;
    const blast = withBonus(idiv(rollInt(s.rng, level.minPct, level.maxPct) * best.maxHp, 100), buff.damagePct);
    const physical = idiv(blast * level.physicalPct, 100);
    const elemental = blast - physical;
    for (const m of aliveWithin(sim, best, level.radiusUnits)) {
      if (physical > 0) dealDamage(sim, m, physical, 'phys', skill.filter);
      if (elemental > 0 && skill.damageType !== 'none') dealDamage(sim, m, elemental, skill.damageType as Element, skill.filter);
    }
    const used = best;
    s.corpses = s.corpses.filter((c) => c.id !== used.id);
    return true;
  },
};
