// Melee: weapon swings at monsters within reach (1.5 tiles: only towers touching the path
// connect). Weapon damage comes from weapons.txt, the skill adds a damage percent, extra
// swings (Zeal) and elemental damage as a percent of the weapon roll (Vengeance).

import { canHurt, dealDamage, findTarget, withBonus } from '../combat.ts';
import { idiv } from '../fixed.ts';
import { rollInt } from '../rng.ts';
import { ELEMENTS, type Element } from '../state.ts';
import { findRow, int } from '../tables.ts';
import { calcAt, common, fields, filterFrom, perLevel } from './common.ts';
import type { ArchetypeModule, MeleeDef } from './types.ts';

interface MeleeJson {
  swingsCalc?: string;
  damagePctCalc?: string;
  elementalPctCalcs?: Partial<Record<Element, string>>;
  stunTicks?: number;
}

const ALL = filterFrom(undefined);

export const melee: ArchetypeModule<MeleeDef> = {
  id: 'melee',

  resolve(json, ctx) {
    const f = fields<MeleeJson>(json);
    if (!ctx.weapon) throw new Error(`${json.id}: melee skills need a class weapon`);
    const weapon = findRow(ctx.tables.weapons, 'name', ctx.weapon);
    return {
      ...common(json, ctx, true),
      archetype: 'melee',
      weapon: { min: int(weapon, 'mindam') * 256, max: int(weapon, 'maxdam') * 256 },
      stunTicks: f.stunTicks ?? 0,
      levels: perLevel(json, (level) => {
        const elementalPct: Partial<Record<Element, number>> = {};
        for (const [element, column] of Object.entries(f.elementalPctCalcs ?? {}) as [Element, string][]) {
          elementalPct[element] = calcAt(ctx.skillRow, column, level);
        }
        return {
          swings: f.swingsCalc ? Math.max(1, calcAt(ctx.skillRow, f.swingsCalc, level)) : 1,
          damagePct: f.damagePctCalc ? calcAt(ctx.skillRow, f.damagePctCalc, level) : 0,
          elementalPct,
        };
      }),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const { swings, damagePct, elementalPct } = skill.levels[lvl]!;
    const elements = ELEMENTS.filter((e) => e === 'phys' || (elementalPct[e] ?? 0) > 0);
    let swung = false;
    for (let i = 0; i < swings; i++) {
      const target = findTarget(sim, tower, skill.rangeUnits, (m) => elements.some((e) => canHurt(sim, m, e, ALL)));
      if (!target) break;
      swung = true;
      const weaponRoll = rollInt(sim.state.rng, skill.weapon.min, skill.weapon.max);
      dealDamage(sim, target, withBonus(weaponRoll, damagePct + buff.damagePct), 'phys', ALL);
      for (const e of elements) {
        if (e === 'phys') continue;
        dealDamage(sim, target, withBonus(idiv(weaponRoll * elementalPct[e]!, 100), buff.damagePct), e, ALL);
      }
      if (skill.stunTicks > 0 && target.hp > 0) target.stunTicks = Math.max(target.stunTicks, skill.stunTicks);
    }
    return swung;
  },
};
