// Splash: area damage at the point of impact, with linear falloff to edgeDamagePct.
//   missile  a shot that explodes where it lands (Fire Ball)
//   strike   a delayed hit on the target's spot (Meteor, Fist of the Heavens)
//   orbit    hammers spiralling out from the tower, hitting what they pass (Blessed Hammer)
//   nova     a ring from the tower out to its range, hitting everything in it once (Poison Nova)
// Strikes can pick a random monster in range instead of the tower's target (Thunder Storm).
// The radius is a design value in tenths of a tile, or a skills.txt calc (Fire Ball, Meteor).
// An optional sub-missile hits everything its own filter allows within a radius of the
// impact, like the holy bolts Fist of the Heavens sprays at undead and demons.

import { aliveWithin, canHurt, dealDamage, distSq, findTarget, strike, within, withBonus } from '../combat.ts';
import { d2FramesToTicks, idiv, isqrt } from '../fixed.ts';
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
  lengthAt,
  missileLifetime,
  missileOf,
  missileSpeed,
  perLevel,
  tenthsToUnits,
} from './common.ts';
import type { ArchetypeModule, SplashDef } from './types.ts';

interface SplashJson {
  delivery: 'missile' | 'strike' | 'orbit' | 'nova';
  /** The missiles.txt row to use when the skill names none a server missile (Mind Blast's cltmissile). */
  missile?: string;
  /** Damage from the missile row rather than the skill row (Phoenix Strike's meteor). */
  damageFromMissile?: boolean;
  /** Stun on hit: a skills.txt column in frames (War Cry's calc4), or the row's ELen (Mind Blast). */
  stunCalc?: string;
  stunLen?: boolean;
  radiusTenths?: number;
  /** skills.txt column with the radius in D2 units, instead of radiusTenths. */
  radiusCalc?: string;
  randomTarget?: boolean;
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
    strike(sim, m, idiv(amount * pct, 100), element(skill), skill.filter, skill, missile.level, missile);
    // War Cry and Mind Blast stun what they hit; bosses shrug it off
    const stun = skill.stunTicks[missile.level] ?? 0;
    if (stun > 0 && m.hp > 0 && m.rank !== 'boss') m.stunTicks = Math.max(m.stunTicks, stun);
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
    const missile = missileOf(ctx.tables, ctx.skillRow, f.missile);
    const sub = f.subMissile ? missileOf(ctx.tables, ctx.skillRow, f.subMissile.missile) : undefined;
    if (!f.damageFromMissile) elementalType(json, ctx.skillRow);
    const frames = (v: number) => (v > 0 ? Math.max(1, d2FramesToTicks(v)) : 0);
    const radius = f.radiusCalc
      ? auraUnits(calcAt(ctx.skillRow, f.radiusCalc, json.skillLevels?.[0] ?? 1), ctx.auraRangePerTile)
      : tenthsToUnits(f.radiusTenths ?? 0);
    return {
      ...common(json, ctx, true),
      archetype: 'splash',
      delivery: f.delivery,
      randomTarget: f.randomTarget === true,
      radiusUnits: f.delivery === 'nova' ? tenthsToUnits(json.rangeTenths ?? 0) : radius,
      edgeDamagePct: f.edgeDamagePct ?? 100,
      missileSpeed: missileSpeed(missile),
      missileLifetime: missileLifetime(missile),
      impactTicks: missileLifetime(missile),
      orbitTurns: f.orbitTurns ?? 1,
      filter: filterFrom(missile, ctx.filterOverride),
      subFilter: sub ? filterFrom(sub) : undefined,
      subElement: (sub && etype(sub)) || 'mag',
      stunTicks: perLevel(json, (level) => (f.stunCalc ? frames(calcAt(ctx.skillRow, f.stunCalc, level)) : f.stunLen ? frames(lengthAt(ctx.skillRow, level)) : 0)),
      levels: perLevel(json, (level) => ({
        ...(f.damageFromMissile ? damageAt(missile, level, 'missile') : damageAt(ctx.skillRow, level, 'skill')),
        sub: sub ? damageAt(sub, level, 'missile') : { min: 0, max: 0 },
        subRadiusUnits:
          sub && f.subMissile ? auraUnits(calcAt(ctx.skillRow, f.subMissile.radiusCalc, level), ctx.auraRangePerTile) : 0,
      })),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const hurtable = (m: Monster) => canHurt(sim, m, element(skill), skill.filter);
    if (skill.delivery === 'nova') {
      if (!sim.state.monsters.some((m) => m.hp > 0 && within(tower, m, skill.radiusUnits) && hurtable(m))) return false;
      // The ring expands at missile speed; it lives until it reaches the edge
      const speed = Math.max(1, skill.missileSpeed);
      const ticks = Math.max(1, idiv(skill.radiusUnits + speed - 1, speed));
      spawnMissile(sim, tower, skill.id, lvl, buff, { ticksLeft: ticks });
      return true;
    }
    const reach = skill.rangeUnits + skill.radiusUnits;
    let target: Monster | undefined;
    if (skill.randomTarget) {
      const pool = sim.state.monsters.filter((m) => m.hp > 0 && within(tower, m, reach) && hurtable(m));
      target = pool.length > 0 ? pool[rollInt(sim.state.rng, 0, pool.length - 1)] : undefined;
    } else {
      target = findTarget(sim, tower, reach, hurtable);
    }
    if (!target) return false;
    const base = { targetId: target.id, ticksLeft: skill.missileLifetime };
    if (skill.delivery === 'strike') {
      spawnMissile(sim, tower, skill.id, lvl, buff, { ...base, x: target.x, y: target.y, ticksLeft: skill.impactTicks });
    } else {
      spawnMissile(sim, tower, skill.id, lvl, buff, base);
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

    if (skill.delivery === 'nova') {
      // The ring's radius grows each tick; it hits each monster it passes once
      const radius = Math.min(skill.radiusUnits, skill.missileSpeed * missile.age);
      for (const m of aliveWithin(sim, missile, radius)) {
        if (missile.hits.includes(m.id)) continue;
        missile.hits.push(m.id);
        const range = skill.levels[missile.level]!;
        const amount = withBonus(rollInt(sim.state.rng, range.min, range.max), missile.damagePct);
        strike(sim, m, amount, element(skill), skill.filter, skill, missile.level, missile);
      }
      return --missile.ticksLeft > 0;
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
