// Debuff: weakens monsters. The effects are the skill's own aurastat columns:
// fireresist, coldresist, lightresist, poisonresist, magicresist and damageresist
// (physical) lower resistances; velocitypercent slows; damagepercent cuts the damage a
// monster deals to summons.
//   aura   every monster in radius of the tower (Conviction)
//   curse  cast on the tower's target: monsters within the radius carry it for its
//          duration (auralencalc). Amplify Damage, Decrepify, Lower Resist. Curses do not
//          add up: a monster under several takes the strongest value of each effect.
//   pulse  takes a percent of current HP off everything in radius, as the skill's element
//          (Static Field). It cannot take a monster below the difficulty's floor.

import { baseSkillId, skillPlus } from '../data.ts';
import { aliveWithin, damageAgainst, dealRaw, findTarget } from '../combat.ts';
import { d2FramesToTicks, idiv } from '../fixed.ts';
import type { Element, Monster } from '../state.ts';
import { int } from '../tables.ts';
import { auraStats, auraUnits, calcAt, common, fields, filterFrom, perLevel } from './common.ts';
import type { ArchetypeModule, DebuffDef } from './types.ts';

interface DebuffJson {
  mode: 'aura' | 'curse' | 'pulse';
  radiusCalc?: string;
  /** Curse: skills.txt column with the duration in frames. */
  durationCalc?: string;
  /** Pulse: skills.txt columns with the percent of current HP and the least it takes. */
  hpPctCalc?: string;
  minDamageCalc?: string;
}

const ALL_FILTER = filterFrom(undefined);

const RESIST_STATS: Record<string, Element> = {
  fireresist: 'fire',
  coldresist: 'cold',
  lightresist: 'ltng',
  poisonresist: 'pois',
  magicresist: 'mag',
  damageresist: 'phys',
};

/** A curse is worth recasting on a monster that lacks it, or whose copy is weaker or half spent. */
/** A curse's strength: its tower level plus the +skills it was cast with. */
const strength = (skill: string, lvl: number) => lvl + skillPlus(skill);

function wantsCurse(m: Monster, skill: string, lvl: number, duration: number): boolean {
  const has = m.curses.find((c) => baseSkillId(c.skill) === baseSkillId(skill));
  return !has || strength(has.skill, has.lvl) < strength(skill, lvl) || has.ticksLeft * 2 < duration;
}

export const debuff: ArchetypeModule<DebuffDef> = {
  id: 'debuff',

  resolve(json, ctx) {
    const f = fields<DebuffJson>(json);
    const shift = 2 ** int(ctx.skillRow, 'HitShift');
    return {
      ...common(json, ctx, f.mode !== 'aura'),
      archetype: 'debuff',
      mode: f.mode,
      levels: perLevel(json, (level) => {
        const resistDown: Partial<Record<Element, number>> = {};
        const stats = auraStats(ctx.skillRow, level);
        for (const [stat, value] of Object.entries(stats)) {
          const element = RESIST_STATS[stat];
          if (element && value < 0) resistDown[element] = -value;
        }
        return {
          radiusUnits: auraUnits(calcAt(ctx.skillRow, f.radiusCalc ?? 'aurarangecalc', level), ctx.auraRangePerTile),
          resistDown,
          slowPct: Math.max(0, -(stats['velocitypercent'] ?? 0)),
          damageDownPct: Math.max(0, -(stats['damagepercent'] ?? 0)),
          durationTicks: f.durationCalc ? Math.max(1, d2FramesToTicks(calcAt(ctx.skillRow, f.durationCalc, level))) : 0,
          hpPct: f.hpPctCalc ? calcAt(ctx.skillRow, f.hpPctCalc, level) : 0,
          minDamage: f.minDamageCalc ? calcAt(ctx.skillRow, f.minDamageCalc, level) * shift : 0,
        };
      }),
    };
  },

  aura(skill, lvl) {
    if (skill.mode !== 'aura') return { radiusUnits: 0 };
    const { radiusUnits, resistDown, slowPct, damageDownPct } = skill.levels[lvl]!;
    return { radiusUnits, monsters: { slowPct, resistDown, damageDownPct } };
  },

  act(sim, tower, skill, lvl) {
    const level = skill.levels[lvl]!;
    if (skill.mode === 'curse') {
      const target = findTarget(sim, tower, skill.rangeUnits, (m) => wantsCurse(m, skill.id, lvl, level.durationTicks));
      if (!target) return false;
      for (const m of aliveWithin(sim, target, level.radiusUnits)) {
        const has = m.curses.find((c) => baseSkillId(c.skill) === baseSkillId(skill.id));
        if (has) {
          if (strength(skill.id, lvl) > strength(has.skill, has.lvl)) {
            has.skill = skill.id;
            has.lvl = lvl;
          }
          has.ticksLeft = Math.max(has.ticksLeft, level.durationTicks);
        } else {
          m.curses.push({ skill: skill.id, lvl, ticksLeft: level.durationTicks });
        }
      }
      return true;
    }
    if (skill.mode === 'pulse') {
      const element = skill.damageType as Element;
      const inside = aliveWithin(sim, tower, level.radiusUnits);
      if (inside.length === 0) return false;
      for (const m of inside) {
        const floorPct = sim.data.rules.staticFloorPct[sim.data.waves[m.wave]?.difficulty ?? 0] ?? 0;
        const floor = idiv(m.maxHp * floorPct, 100);
        const wanted = Math.max(level.minDamage, idiv(m.hp * level.hpPct, 100));
        const dealt = Math.min(damageAgainst(sim, m, wanted, element, ALL_FILTER), Math.max(0, m.hp - floor));
        dealRaw(sim, m, dealt);
      }
      return true;
    }
    return false;
  },
};
