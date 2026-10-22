// Pierce / chain: a line missile that passes through targets (Bone Spear), or a bolt that
// jumps from target to target (Lightning, Chain Lightning) with a falloff per hop.

import { canHurt, distSq, findTarget, strike, withBonus } from '../combat.ts';
import { idiv } from '../fixed.ts';
import { LINE_HIT_RADIUS, pierceOn, spawnMissile, velocityToward } from '../missiles.ts';
import { rollInt } from '../rng.ts';
import type { Element, Monster, Sim } from '../state.ts';
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
  missileSpeed,
  perLevel,
} from './common.ts';
import type { ArchetypeModule, PierceDef } from './types.ts';

interface PierceJson {
  mode: 'pierce' | 'chain';
  /** Pierce mode: targets a missile can pass through, 0 for unlimited. */
  pierceCount?: number;
  /** Chain mode: skills.txt columns for the hop count and jump range. */
  hopsCalc?: string;
  jumpCalc?: string;
  falloffPct?: number;
}

function element(skill: PierceDef): Element {
  return skill.damageType as Element;
}

function roll(sim: Sim, skill: PierceDef, lvl: number, damagePct: number): number {
  const range = skill.levels[lvl]!;
  return withBonus(rollInt(sim.state.rng, range.min, range.max), damagePct);
}

export const pierce: ArchetypeModule<PierceDef> = {
  id: 'pierce',

  resolve(json, ctx) {
    const f = fields<PierceJson>(json);
    const missile = missileOf(ctx.tables, ctx.skillRow);
    elementalType(json, ctx.skillRow);
    return {
      ...common(json, ctx, true),
      archetype: 'pierce',
      mode: f.mode,
      missileSpeed: missileSpeed(missile),
      missileLifetime: missileLifetime(missile),
      pierceCount: f.pierceCount ?? 0,
      falloffPct: f.falloffPct ?? 0,
      filter: filterFrom(missile, ctx.filterOverride),
      levels: perLevel(json, (level) => ({
        ...damageAt(ctx.skillRow, level, 'skill'),
        hops: f.mode === 'chain' && f.hopsCalc ? calcAt(ctx.skillRow, f.hopsCalc, level) : 0,
        jumpUnits: f.mode === 'chain' && f.jumpCalc ? auraUnits(calcAt(ctx.skillRow, f.jumpCalc, level), ctx.auraRangePerTile) : 0,
      })),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const hurtable = (m: Monster) => canHurt(sim, m, element(skill), skill.filter);
    const target = findTarget(sim, tower, skill.rangeUnits, hurtable);
    if (!target) return false;

    if (skill.mode === 'pierce') {
      spawnMissile(sim, tower, skill.id, lvl, buff, {
        ...velocityToward(tower, target, skill.missileSpeed),
        ticksLeft: skill.missileLifetime,
        remaining: skill.pierceCount,
      });
      return true;
    }

    // Chain: hit the target, then jump to the nearest monster not hit yet
    const { hops, jumpUnits } = skill.levels[lvl]!;
    const hit: number[] = [];
    let current: Monster | undefined = target;
    let amount = roll(sim, skill, lvl, buff.damagePct);
    for (let hop = 0; current && hop <= hops; hop++) {
      hit.push(current.id);
      const from: Monster = current;
      strike(sim, from, amount, element(skill), skill.filter, skill, lvl, buff);
      amount = idiv(amount * (100 - skill.falloffPct), 100);
      current = undefined;
      let best = 0;
      for (const m of sim.state.monsters) {
        if (m.hp <= 0 || hit.includes(m.id) || !hurtable(m)) continue;
        const d = distSq(from, m);
        if (d <= jumpUnits * jumpUnits && (!current || d < best)) {
          current = m;
          best = d;
        }
      }
    }
    return true;
  },

  updateMissile(sim, missile, skill) {
    if (--missile.ticksLeft < 0) return false;
    missile.x += missile.vx;
    missile.y += missile.vy;
    for (const m of [...sim.state.monsters]) {
      if (m.hp <= 0 || missile.hits.includes(m.id) || distSq(missile, m) > LINE_HIT_RADIUS * LINE_HIT_RADIUS) continue;
      missile.hits.push(m.id);
      strike(sim, m, roll(sim, skill, missile.level, missile.damagePct), element(skill), skill.filter, skill, missile.level, missile);
      // Item pierce lets a limited missile pass without spending one of its passes
      const from = { x: missile.x - missile.vx, y: missile.y - missile.vy };
      if (skill.pierceCount > 0 && !pierceOn(sim, missile, m, from, skill.missileSpeed) && --missile.remaining <= 0) return false;
    }
    return true;
  },
};
