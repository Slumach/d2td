// Zone: persistent damage on the ground at the target's spot. Blizzard, Fire Wall,
// Poison Nova's cloud, Thunder Storm. Lasts the missile's lifetime, hits every tickTicks.

import { aliveWithin, canHurt, dealDamage, findTarget, withBonus } from '../combat.ts';
import { spawnMissile } from '../missiles.ts';
import { rollInt } from '../rng.ts';
import type { Element } from '../state.ts';
import {
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
  radiusTenths: number;
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
      radiusUnits: tenthsToUnits(f.radiusTenths),
      tickTicks: Math.max(1, f.tickTicks),
      durationTicks: missileLifetime(missile),
      filter: filterFrom(missile, ctx.filterOverride),
      levels: perLevel(json, (level) => damageAt(ctx.skillRow, level, 'skill')),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const target = findTarget(sim, tower, skill.rangeUnits, (m) => canHurt(sim, m, skill.damageType as Element, skill.filter));
    if (!target) return false;
    spawnMissile(sim, tower, skill.id, lvl, buff.damagePct, { x: target.x, y: target.y, ticksLeft: skill.durationTicks });
    return true;
  },

  updateMissile(sim, missile, skill) {
    if (--missile.ticksLeft < 0) return false;
    if (++missile.value % skill.tickTicks !== 0) return true;
    const range = skill.levels[missile.level]!;
    for (const m of aliveWithin(sim, missile, skill.radiusUnits)) {
      const amount = withBonus(rollInt(sim.state.rng, range.min, range.max), missile.damagePct);
      dealDamage(sim, m, amount, skill.damageType as Element, skill.filter);
    }
    return true;
  },
};
