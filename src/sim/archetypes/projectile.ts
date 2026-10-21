// Projectile: a homing shot that hits its target. Holy Bolt, Fire Bolt, Ice Bolt, Bone
// Spirit; Charged Bolt and Teeth fire several at once (a count or a count calc), one per
// target. Shots with no target of their own fly past: a volley shreds a crowd, not a boss.

import { canHurt, findTarget, strike, withBonus } from '../combat.ts';
import { homeToward, spawnMissile, targetOf } from '../missiles.ts';
import { rollInt } from '../rng.ts';
import type { Element, Monster } from '../state.ts';
import { calcAt, common, damageAt, elementalType, fields, filterFrom, missileLifetime, missileOf, missileSpeed, perLevel } from './common.ts';
import type { ArchetypeModule, ProjectileDef } from './types.ts';

interface ProjectileJson {
  /** Shots per attack. Defaults to 1. */
  count?: number;
  /** skills.txt column with the shot count per level, instead of count. */
  countCalc?: string;
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
      levels: perLevel(json, (level) => ({
        ...damageAt(ctx.skillRow, level, 'skill'),
        count: Math.max(1, f.countCalc ? calcAt(ctx.skillRow, f.countCalc, level) : (f.count ?? 1)),
      })),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const element = skill.damageType as Element;
    const count = skill.levels[lvl]!.count;
    const chosen: Monster[] = [];
    for (let i = 0; i < count; i++) {
      const target = findTarget(sim, tower, skill.rangeUnits, (m) => !chosen.includes(m) && canHurt(sim, m, element, skill.filter));
      if (!target) break;
      chosen.push(target);
      spawnMissile(sim, tower, skill.id, lvl, buff, { targetId: target.id, ticksLeft: skill.missileLifetime });
    }
    return chosen.length > 0;
  },

  updateMissile(sim, missile, skill) {
    const target = targetOf(sim, missile);
    if (!target || --missile.ticksLeft < 0) return false;
    if (!homeToward(missile, target, skill.missileSpeed)) return true;
    const range = skill.levels[missile.level]!;
    const amount = withBonus(rollInt(sim.state.rng, range.min, range.max), missile.damagePct);
    strike(sim, target, amount, skill.damageType as Element, skill.filter, skill, missile.level, missile);
    return false;
  },
};
