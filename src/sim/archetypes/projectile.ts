// Projectile: a homing shot that hits its target. Holy Bolt, Fire Bolt, Ice Bolt, Bone
// Spirit; Charged Bolt and Teeth fire several at once (a count or a count calc), one per
// target. Shots with no target of their own fly past: a volley shreds a crowd, not a boss.
// Pierce on the tower's items lets a bolt that hit fly on in a straight line.

import { canHurt, findTarget, strike, withBonus } from '../combat.ts';
import { flyOn, homeToward, pierceOn, spawnMissile, targetOf } from '../missiles.ts';
import { rollInt } from '../rng.ts';
import type { Element, Monster } from '../state.ts';
import { idiv } from '../fixed.ts';
import { findRow, int } from '../tables.ts';
import { calcAt, common, damageAt, elementalType, extraTargets, fields, filterFrom, missileLifetime, missileOf, missileSpeed, perLevel, reachCount } from './common.ts';
import type { ArchetypeModule, DamageRange, ProjectileDef } from './types.ts';

interface ProjectileJson {
  /** Shots per attack. Defaults to 1. */
  count?: number;
  /** skills.txt column with the shot count per level, instead of count. */
  countCalc?: string;
  /**
   * Bow skills: every arrow carries the class weapon's damage at skills.txt SrcDam
   * (128ths; Multiple Shot's 96 is three quarters), dealt as the skill's damage type,
   * with the skill's damage percent column on top.
   */
  weapon?: boolean;
  damagePctCalc?: string;
  /** The missiles.txt row, when the skill row names no server missile (Lightning Sentry's bolt is its trap's). */
  missile?: string;
  /** Damage from the missile row rather than the skill row (Phoenix Strike's chaos ice). */
  damageFromMissile?: boolean;
}

export const projectile: ArchetypeModule<ProjectileDef> = {
  id: 'projectile',

  resolve(json, ctx) {
    const f = fields<ProjectileJson>(json);
    const missile = missileOf(ctx.tables, ctx.skillRow, f.missile);
    if (json.damageType === 'none') throw new Error(`${json.id}: projectile needs a damage type`);
    if (!f.weapon && !f.damageFromMissile) elementalType(json, ctx.skillRow);
    let weapon: DamageRange | undefined;
    if (f.weapon) {
      if (!ctx.weapon) throw new Error(`${json.id}: a weapon projectile needs a class weapon`);
      const row = findRow(ctx.tables.weapons, 'name', ctx.weapon);
      const two = int(row, '2handed') === 1 && int(row, '2handmaxdam') > 0;
      weapon = { min: int(row, two ? '2handmindam' : 'mindam') * 256, max: int(row, two ? '2handmaxdam' : 'maxdam') * 256 };
    }
    const srcDam = int(ctx.skillRow, 'SrcDam');
    return {
      ...common(json, ctx, true),
      archetype: 'projectile',
      missileSpeed: missileSpeed(missile),
      missileLifetime: missileLifetime(missile),
      filter: filterFrom(missile, ctx.filterOverride),
      ...(weapon ? { weapon } : {}),
      weaponPct: srcDam > 0 ? Math.trunc((srcDam * 100) / 128) : 100,
      levels: perLevel(json, (level) => ({
        ...(f.damageFromMissile ? damageAt(missile, level, 'missile') : damageAt(ctx.skillRow, level, 'skill')),
        count: Math.max(1, f.countCalc ? reachCount(ctx.skillRow, f.countCalc, level, ctx.reach, ctx.reachOffset) : (f.count ?? 1) + extraTargets(ctx.reach, level + ctx.reachOffset)),
        damagePct: f.damagePctCalc ? calcAt(ctx.skillRow, f.damagePctCalc, level) : 0,
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
    if (--missile.ticksLeft < 0) return false;
    const hit = (m: Monster) => {
      const range = skill.levels[missile.level]!;
      // A bow skill's arrow: the weapon at its share with the skill's percent, then the skill's own damage
      const weapon = skill.weapon ? idiv(rollInt(sim.state.rng, skill.weapon.min, skill.weapon.max) * skill.weaponPct, 100) : 0;
      const amount = withBonus(weapon, range.damagePct) + rollInt(sim.state.rng, range.min, range.max);
      strike(sim, m, withBonus(amount, missile.damagePct), skill.damageType as Element, skill.filter, skill, missile.level, missile);
    };
    // A bolt that pierced flies on in a straight line
    if (missile.targetId === 0) return flyOn(sim, missile, skill.missileSpeed, hit);
    const target = targetOf(sim, missile);
    if (!target) return false;
    const from = { x: missile.x, y: missile.y };
    if (!homeToward(missile, target, skill.missileSpeed)) return true;
    hit(target);
    return pierceOn(sim, missile, target, from, skill.missileSpeed);
  },
};
