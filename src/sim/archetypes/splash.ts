// Splash: area damage at the point of impact, with linear falloff to edgeDamagePct.
//   missile  a shot that explodes where it lands (Fire Ball)
//   strike   a delayed hit on the target's spot (Meteor, Fist of the Heavens)
//   orbit    hammers spiralling out from the tower, hitting what they pass (Blessed Hammer)
// An optional sub-missile hits everything its own filter allows within a radius of the
// impact, like the holy bolts Fist of the Heavens sprays at undead and demons.

import { aliveWithin, canHurt, dealDamage, distSq, findTarget, withBonus } from '../combat.ts';
import { idiv, isqrt } from '../fixed.ts';
import { TRIG_SCALE, TRIG_STEPS, cos64, homeToward, sin64, spawnMissile, targetOf } from '../missiles.ts';
import { rollInt } from '../rng.ts';
import type { Element, Missile, Monster, Sim } from '../state.ts';
import {
  auraUnits,
  calcAt,
  common,
  damageAt,
  elementalType,
  etype,
  fields,
  filterFrom,
  missileLifetime,
  missileOf,
  missileSpeed,
  perLevel,
  tenthsToUnits,
} from './common.ts';
import type { ArchetypeModule, SplashDef } from './types.ts';

interface SplashJson {
  delivery: 'missile' | 'strike' | 'orbit';
  radiusTenths: number;
  edgeDamagePct?: number;
  orbitTurns?: number;
  subMissile?: { missile: string; radiusCalc: string };
}

function element(skill: SplashDef): Element {
  return skill.damageType as Element;
}

/** Damages everything within the radius of `center`, scaled by distance. */
function explode(sim: Sim, skill: SplashDef, missile: Missile, center: { x: number; y: number }, skip: number[] = []): Monster[] {
  const range = skill.levels[missile.level]!;
  const hit: Monster[] = [];
  for (const m of aliveWithin(sim, center, skill.radiusUnits)) {
    if (skip.includes(m.id)) continue;
    const d = isqrt(distSq(center, m));
    const pct = skill.radiusUnits === 0 ? 100 : 100 - idiv((100 - skill.edgeDamagePct) * d, skill.radiusUnits);
    const amount = withBonus(rollInt(sim.state.rng, range.min, range.max), missile.damagePct);
    dealDamage(sim, m, idiv(amount * pct, 100), element(skill), skill.filter);
    hit.push(m);
  }
  if (skill.subFilter && range.subRadiusUnits > 0) {
    for (const m of aliveWithin(sim, center, range.subRadiusUnits)) {
      if (!canHurt(sim, m, skill.subElement, skill.subFilter)) continue;
      const amount = withBonus(rollInt(sim.state.rng, range.sub.min, range.sub.max), missile.damagePct);
      dealDamage(sim, m, amount, skill.subElement, skill.subFilter);
    }
  }
  return hit;
}

export const splash: ArchetypeModule<SplashDef> = {
  id: 'splash',

  resolve(json, ctx) {
    const f = fields<SplashJson>(json);
    const missile = missileOf(ctx.tables, ctx.skillRow);
    const sub = f.subMissile ? missileOf(ctx.tables, ctx.skillRow, f.subMissile.missile) : undefined;
    elementalType(json, ctx.skillRow);
    return {
      ...common(json, ctx, true),
      archetype: 'splash',
      delivery: f.delivery,
      radiusUnits: tenthsToUnits(f.radiusTenths),
      edgeDamagePct: f.edgeDamagePct ?? 100,
      missileSpeed: missileSpeed(missile),
      missileLifetime: missileLifetime(missile),
      impactTicks: missileLifetime(missile),
      orbitTurns: f.orbitTurns ?? 1,
      filter: filterFrom(missile, ctx.filterOverride),
      subFilter: sub ? filterFrom(sub) : undefined,
      subElement: (sub && etype(sub)) || 'mag',
      levels: perLevel(json, (level) => ({
        ...damageAt(ctx.skillRow, level, 'skill'),
        sub: sub ? damageAt(sub, level, 'missile') : { min: 0, max: 0 },
        subRadiusUnits:
          sub && f.subMissile ? auraUnits(calcAt(ctx.skillRow, f.subMissile.radiusCalc, level), ctx.auraRangePerTile) : 0,
      })),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const hurtable = (m: Monster) => canHurt(sim, m, element(skill), skill.filter);
    const target = findTarget(sim, tower, skill.rangeUnits + skill.radiusUnits, hurtable);
    if (!target) return false;
    const base = { targetId: target.id, ticksLeft: skill.missileLifetime };
    if (skill.delivery === 'strike') {
      spawnMissile(sim, tower, skill.id, lvl, buff.damagePct, { ...base, x: target.x, y: target.y, ticksLeft: skill.impactTicks });
    } else {
      spawnMissile(sim, tower, skill.id, lvl, buff.damagePct, base);
    }
    return true;
  },

  updateMissile(sim, missile, skill) {
    missile.age++;
    if (skill.delivery === 'missile') {
      const target = targetOf(sim, missile);
      if (!target || --missile.ticksLeft < 0) return false;
      if (!homeToward(missile, target, skill.missileSpeed)) return true;
      explode(sim, skill, missile, missile);
      return false;
    }

    if (skill.delivery === 'strike') {
      // Track the target until impact, then hit where it stands
      const target = targetOf(sim, missile);
      if (target) {
        missile.x = target.x;
        missile.y = target.y;
      }
      if (--missile.ticksLeft > 0) return true;
      explode(sim, skill, missile, missile);
      return false;
    }

    // Orbit: spiral out to the tower's range over the hammer's lifetime
    if (missile.age > skill.missileLifetime) return false;
    const step = idiv(missile.age * skill.orbitTurns * TRIG_STEPS, skill.missileLifetime);
    const radius = idiv(skill.rangeUnits * missile.age, skill.missileLifetime);
    missile.x = missile.ox + idiv(radius * cos64(step), TRIG_SCALE);
    missile.y = missile.oy + idiv(radius * sin64(step), TRIG_SCALE);
    // Each hammer hits a monster once
    for (const m of explode(sim, skill, missile, missile, missile.hits)) missile.hits.push(m.id);
    return true;
  },
};
