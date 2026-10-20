// Control: slows, freezes or stuns.
//   aura   slows every monster in radius and pulses the skill's elemental damage
//          every perdelay frames (Holy Freeze). The slow is skills.txt velocitypercent.
//   onHit  a homing shot that slows its target for a duration (Glacial Spike, Clay Golem).

import { aliveWithin, canHurt, dealDamage, findTarget, withBonus } from '../combat.ts';
import { d2FramesToTicks } from '../fixed.ts';
import { homeToward, spawnMissile, targetOf } from '../missiles.ts';
import { rollInt } from '../rng.ts';
import type { Element } from '../state.ts';
import { int } from '../tables.ts';
import {
  auraStats,
  auraUnits,
  calcAt,
  common,
  damageAt,
  elementalType,
  fields,
  filterFrom,
  missileLifetime,
  missileOf,
  missileSpeed,
  perLevel,
} from './common.ts';
import type { ArchetypeModule, ControlDef } from './types.ts';

interface ControlJson {
  mode: 'aura' | 'onHit';
  /** Aura mode: skills.txt column for the radius. */
  radiusCalc?: string;
  /** On-hit mode: slow percent and duration in ticks. */
  slowPct?: number;
  durationTicks?: number;
}

export const control: ArchetypeModule<ControlDef> = {
  id: 'control',

  resolve(json, ctx) {
    const f = fields<ControlJson>(json);
    elementalType(json, ctx.skillRow);
    if (f.mode === 'aura') {
      const pulseTicks = Math.max(1, d2FramesToTicks(int(ctx.skillRow, 'perdelay')));
      return {
        ...common(json, ctx, false),
        archetype: 'control',
        mode: 'aura',
        rateTicks: pulseTicks,
        pulseTicks,
        durationTicks: 0,
        missileSpeed: 0,
        missileLifetime: 0,
        filter: filterFrom(undefined, ctx.filterOverride),
        levels: perLevel(json, (level) => ({
          ...damageAt(ctx.skillRow, level, 'skill'),
          radiusUnits: auraUnits(calcAt(ctx.skillRow, f.radiusCalc ?? 'aurarangecalc', level), ctx.auraRangePerTile),
          slowPct: Math.max(0, -(auraStats(ctx.skillRow, level)['velocitypercent'] ?? 0)),
        })),
      };
    }
    const missile = missileOf(ctx.tables, ctx.skillRow);
    return {
      ...common(json, ctx, true),
      archetype: 'control',
      mode: 'onHit',
      pulseTicks: 0,
      durationTicks: f.durationTicks ?? 0,
      missileSpeed: missileSpeed(missile),
      missileLifetime: missileLifetime(missile),
      filter: filterFrom(missile, ctx.filterOverride),
      levels: perLevel(json, (level) => ({ ...damageAt(ctx.skillRow, level, 'skill'), radiusUnits: 0, slowPct: f.slowPct ?? 0 })),
    };
  },

  aura(skill, lvl) {
    if (skill.mode !== 'aura') return { radiusUnits: 0 };
    const { radiusUnits, slowPct } = skill.levels[lvl]!;
    return { radiusUnits, monsters: { slowPct, resistDown: {} } };
  },

  act(sim, tower, skill, lvl, buff) {
    const element = skill.damageType as Element;
    const range = skill.levels[lvl]!;
    if (skill.mode === 'aura') {
      const inside = aliveWithin(sim, tower, range.radiusUnits);
      if (range.max === 0 || inside.length === 0) return false;
      for (const m of inside) {
        dealDamage(sim, m, withBonus(rollInt(sim.state.rng, range.min, range.max), buff.damagePct), element, skill.filter);
      }
      return true;
    }
    const target = findTarget(sim, tower, skill.rangeUnits, (m) => canHurt(sim, m, element, skill.filter));
    if (!target) return false;
    spawnMissile(sim, tower, skill.id, lvl, buff.damagePct, { targetId: target.id, ticksLeft: skill.missileLifetime });
    return true;
  },

  updateMissile(sim, missile, skill) {
    const target = targetOf(sim, missile);
    if (!target || --missile.ticksLeft < 0) return false;
    if (!homeToward(missile, target, skill.missileSpeed)) return true;
    const range = skill.levels[missile.level]!;
    dealDamage(sim, target, withBonus(rollInt(sim.state.rng, range.min, range.max), missile.damagePct), skill.damageType as Element, skill.filter);
    if (target.hp > 0) {
      target.slowPct = Math.max(target.slowPct, range.slowPct);
      target.slowTicks = Math.max(target.slowTicks, skill.durationTicks);
    }
    return false;
  },
};
