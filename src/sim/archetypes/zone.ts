// Zone: persistent damage on the ground at the target's spot. Blizzard, Fire Wall,
// Poison Nova's cloud, Thunder Storm. Lasts the missile's lifetime, hits every tickTicks.

import { aliveWithin, canHurt, findTarget, strike, withBonus } from '../combat.ts';
import { spawnMissile } from '../missiles.ts';
import { rollInt } from '../rng.ts';
import type { Element } from '../state.ts';
import {
  auraUnits,
  calcAt,
  common,
  damageAt,
  elementalType,
  fields,
  filterFrom,
  missileLifetime,
  missileOf,
  perLevel,
  tenthsToUnits,
} from './common.ts';
import type { ArchetypeModule, ZoneDef } from './types.ts';

interface ZoneJson {
  radiusTenths?: number;
  /** skills.txt column with the radius in D2 units, instead of radiusTenths. */
  radiusCalc?: string;
  tickTicks: number;
}

export const zone: ArchetypeModule<ZoneDef> = {
  id: 'zone',

  resolve(json, ctx) {
    const f = fields<ZoneJson>(json);
    const missile = missileOf(ctx.tables, ctx.skillRow);
    elementalType(json, ctx.skillRow);
    return {
      ...common(json, ctx, true),
      archetype: 'zone',
      radiusUnits: f.radiusCalc
        ? auraUnits(calcAt(ctx.skillRow, f.radiusCalc, json.skillLevels?.[0] ?? 1), ctx.auraRangePerTile)
        : tenthsToUnits(f.radiusTenths ?? 0),
      tickTicks: Math.max(1, f.tickTicks),
      durationTicks: missileLifetime(missile),
      filter: filterFrom(missile, ctx.filterOverride),
      levels: perLevel(json, (level) => damageAt(ctx.skillRow, level, 'skill')),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const target = findTarget(sim, tower, skill.rangeUnits, (m) => canHurt(sim, m, skill.damageType as Element, skill.filter));
    if (!target) return false;
    // Ground zones take the tower's damage bonus but not Enchant's fire
    spawnMissile(sim, tower, skill.id, lvl, { ...buff, fireMin: 0, fireMax: 0 }, { x: target.x, y: target.y, ticksLeft: skill.durationTicks });
    return true;
  },

  updateMissile(sim, missile, skill) {
    if (--missile.ticksLeft < 0) return false;
    if (++missile.value % skill.tickTicks !== 0) return true;
    const range = skill.levels[missile.level]!;
    for (const m of aliveWithin(sim, missile, skill.radiusUnits)) {
      const amount = withBonus(rollInt(sim.state.rng, range.min, range.max), missile.damagePct);
      strike(sim, m, amount, skill.damageType as Element, skill.filter, skill, missile.level);
    }
    return true;
  },
};
