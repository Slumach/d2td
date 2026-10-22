// Corpse: consumes a corpse left by a kill. Corpse Explosion detonates one in range for a
// percent of the corpse's max HP, split between physical and the skill's element, hitting
// everything in radius. Kills leave corpses for corpseLifetimeTicks (balance.json).

import { aliveWithin, dealDamage, distSq, withBonus } from '../combat.ts';
import { lootCorpse } from '../items/loot.ts';
import { idiv } from '../fixed.ts';
import { rollInt } from '../rng.ts';
import type { Corpse, Element } from '../state.ts';
import { auraUnits, calcAt, common, fields, filterFrom, perLevel, tenthsToUnits } from './common.ts';
import type { ArchetypeModule, CorpseDef } from './types.ts';

interface CorpseJson {
  /** A skills.txt radius calc, or a design radius for a skill with none (Find Item). */
  radiusCalc?: string;
  radiusTenths?: number;
  minPctCalc: string;
  maxPctCalc: string;
  /** Share of the blast that is physical; the rest is the skill's damage type. */
  physicalPctCalc?: string;
  /** 'gold': the corpse is looted for minPct to maxPct percent of its bounty (Find Item). */
  mode?: 'explode' | 'gold';
}

export const corpse: ArchetypeModule<CorpseDef> = {
  id: 'corpse',

  resolve(json, ctx) {
    const f = fields<CorpseJson>(json);
    return {
      ...common(json, ctx, true),
      archetype: 'corpse',
      filter: filterFrom(undefined, ctx.filterOverride),
      mode: f.mode ?? 'explode',
      levels: perLevel(json, (level) => ({
        radiusUnits: f.radiusCalc ? auraUnits(calcAt(ctx.skillRow, f.radiusCalc, level), ctx.auraRangePerTile) : tenthsToUnits(f.radiusTenths ?? 0),
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
      // Find Item takes the oldest corpse in reach; an explosion wants the most monsters round it
      if (skill.mode === 'gold') {
        best = c;
        break;
      }
      const count = aliveWithin(sim, c, level.radiusUnits).length;
      if (count > bestCount) {
        best = c;
        bestCount = count;
      }
    }
    if (!best) return false;
    if (skill.mode === 'gold') {
      // Find Item, as D2 does it: with the skill's chance the corpse gives up what its monster
      // would have dropped again: its bounty, and a roll on its treasure class for the tower's owner
      const found = best;
      s.corpses = s.corpses.filter((c) => c.id !== found.id);
      if (rollInt(s.rng, 0, 99) < rollInt(s.rng, level.minPct, level.maxPct)) lootCorpse(sim, found, tower);
      return true;
    }
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
