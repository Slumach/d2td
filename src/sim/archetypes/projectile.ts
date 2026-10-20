// Projectile: a homing shot that hits its target. Holy Bolt, Fire Bolt, Ice Bolt; Teeth
// fires `count` at once, one per target.

import { canHurt, dealDamage, findTarget, withBonus } from '../combat.ts';
import { homeToward, spawnMissile, targetOf } from '../missiles.ts';
import { rollInt } from '../rng.ts';
import type { Monster } from '../state.ts';
import { common, damageAt, elementalType, fields, filterFrom, missileLifetime, missileOf, missileSpeed, perLevel } from './common.ts';
import type { ArchetypeModule, ProjectileDef } from './types.ts';

interface ProjectileJson {
  /** Shots per attack, each at a different target. Defaults to 1. */
  count?: number;
}

export const projectile: ArchetypeModule<ProjectileDef> = {
  id: 'projectile',

  resolve(json, ctx) {
    const f = fields<ProjectileJson>(json);
    const missile = missileOf(ctx.tables, ctx.skillRow);
    elementalType(json, ctx.skillRow);
    return {
      ...common(json, ctx, true),
      archetype: 'projectile',
      missileSpeed: missileSpeed(missile),
      missileLifetime: missileLifetime(missile),
      filter: filterFrom(missile, ctx.filterOverride),
      levels: perLevel(json, (level) => ({ ...damageAt(ctx.skillRow, level, 'skill'), count: f.count ?? 1 })),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const element = skill.damageType as Exclude<typeof skill.damageType, 'none'>;
    const chosen: Monster[] = [];
    for (let i = 0; i < skill.levels[lvl]!.count; i++) {
      const target = findTarget(
        sim,
        tower,
        skill.rangeUnits,
        (m) => !chosen.includes(m) && canHurt(sim, m, element, skill.filter),
      );
      if (!target) break;
      chosen.push(target);
      spawnMissile(sim, tower, skill.id, lvl, buff.damagePct, {
        targetId: target.id,
        ticksLeft: skill.missileLifetime,
      });
    }
    return chosen.length > 0;
  },

  updateMissile(sim, missile, skill) {
    const target = targetOf(sim, missile);
    if (!target || --missile.ticksLeft < 0) return false;
    if (!homeToward(missile, target, skill.missileSpeed)) return true;
    const range = skill.levels[missile.level]!;
    const element = skill.damageType as Exclude<typeof skill.damageType, 'none'>;
    const amount = withBonus(rollInt(sim.state.rng, range.min, range.max), missile.damagePct);
    dealDamage(sim, target, amount, element, skill.filter);
    return false;
  },
};
