// Melee: weapon swings at monsters within reach (1.5 tiles: only towers touching the path
// connect). Weapon damage comes from weapons.txt, the skill adds a damage percent, extra
// swings (Zeal) and elemental damage as a percent of the weapon roll (Vengeance).

import { bleed, canHurt, crushingBlow, damageAgainst, dealDamage, findTarget, poison, withBonus, within } from '../combat.ts';
import { idiv } from '../fixed.ts';
import { rollInt } from '../rng.ts';
import type { TowerGear } from '../items/gear.ts';
import { castItemSkill, OPEN_WOUNDS_TICKS, openWoundsDamage } from '../items/tower.ts';
import { ELEMENTS, type Element, type Monster, type Sim, type Tower } from '../state.ts';
import { findRow, int } from '../tables.ts';
import { auraStats, calcAt, common, extraTargets, fields, filterFrom, perLevel, reachCount } from './common.ts';
import type { ArchetypeModule, MeleeDef } from './types.ts';

interface MeleeJson {
  swingsCalc?: string;
  /** A fixed swing count (Double Swing, Frenzy), when the table has no calc for it. */
  swings?: number;
  damagePctCalc?: string;
  elementalPctCalcs?: Partial<Record<Element, string>>;
  stunTicks?: number;
  /** Every swing hits everything in reach (Whirlwind). */
  hitsAll?: boolean;
  /** The physical hit lands as this element (Berserk: magic). */
  convert?: Element;
  /** An aurastat that is the skill's own attack speed (Frenzy's attackrate, its stacks at their height). */
  speedStat?: string;
}

const ALL = filterFrom(undefined);

export const melee: ArchetypeModule<MeleeDef> = {
  id: 'melee',

  resolve(json, ctx) {
    const f = fields<MeleeJson>(json);
    if (!ctx.weapon) throw new Error(`${json.id}: melee skills need a class weapon`);
    const weapon = findRow(ctx.tables.weapons, 'name', ctx.weapon);
    const base = common(json, ctx, true);
    // A skill that speeds its own swings (Frenzy) attacks that much faster, as attack speed does
    const rates = f.speedStat
      ? base.skillLevels.map((l, i) => Math.max(1, idiv((base.rates[i] ?? base.rateTicks) * 100, 100 + Math.max(0, auraStats(ctx.skillRow, l)[f.speedStat!] ?? 0))))
      : base.rates;
    return {
      ...base,
      rates,
      archetype: 'melee',
      weapon: { min: int(weapon, 'mindam') * 256, max: int(weapon, 'maxdam') * 256 },
      stunTicks: f.stunTicks ?? 0,
      hitsAll: f.hitsAll === true,
      ...(f.convert ? { convert: f.convert } : {}),
      levels: perLevel(json, (level) => {
        const elementalPct: Partial<Record<Element, number>> = {};
        for (const [element, column] of Object.entries(f.elementalPctCalcs ?? {}) as [Element, string][]) {
          elementalPct[element] = calcAt(ctx.skillRow, column, level);
        }
        return {
          swings: f.swingsCalc ? Math.max(1, reachCount(ctx.skillRow, f.swingsCalc, level, ctx.reach, ctx.reachOffset)) : Math.max(1, f.swings ?? 1) + extraTargets(ctx.reach, level + ctx.reachOffset),
          damagePct: f.damagePctCalc ? calcAt(ctx.skillRow, f.damagePctCalc, level) : 0,
          elementalPct,
        };
      }),
    };
  },

  act(sim, tower, skill, lvl, buff) {
    const { swings, damagePct, elementalPct } = skill.levels[lvl]!;
    // Eternal Conflict: a lane is walked once, so melee reaches at least balance.json battle.meleeReachTenths
    const reach = sim.state.battle ? Math.max(skill.rangeUnits, idiv((sim.data.battle?.rules.meleeReachTenths ?? 0) * 1000, 10)) : skill.rangeUnits;
    const elements = ELEMENTS.filter((e) => e === (skill.convert ?? 'phys') || (elementalPct[e] ?? 0) > 0);
    // The gear's added damage can hurt what the weapon cannot
    const hurting = buff.gear ? ELEMENTS.filter((e) => elements.includes(e) || buff.gear!.adds[e]) : elements;
    let swung = false;
    const physical = skill.convert ?? 'phys';
    const inReach = (m: Monster) => hurting.some((e) => canHurt(sim, m, e, ALL));
    for (let i = 0; i < swings; i++) {
      const first = findTarget(sim, tower, reach, inReach);
      if (!first) break;
      swung = true;
      // Whirlwind sweeps everything in reach; other skills hit the tower's target
      const targets = skill.hitsAll ? sim.state.monsters.filter((m) => m.hp > 0 && inReach(m) && within(tower, m, reach)) : [first];
      for (const target of targets) {
      const gear = buff.gear;
      const roll = rollInt(sim.state.rng, skill.weapon.min, skill.weapon.max);
      // The physical hit: +% damage to demons or undead adds to its enhanced damage, and
      // deadly strike doubles it; neither touches the skill's elemental shares of the roll
      const def = sim.data.monsters[target.def]!;
      const versus = gear ? (def.demon ? gear.demonDamagePct : 0) + (def.undead ? gear.undeadDamagePct : 0) : 0;
      const deadly = gear && gear.deadlyStrikePct > 0 && rollInt(sim.state.rng, 0, 99) < gear.deadlyStrikePct ? 2 : 1;
      const hpBefore = target.hp;
      const hit = withBonus(roll, damagePct + buff.damagePct + versus) * deadly;
      dealDamage(sim, target, hit, physical, ALL);
      if (gear) onHit(sim, tower, target, gear, hpBefore, hit);
      for (const e of elements) {
        if (e === 'phys') continue;
        dealDamage(sim, target, withBonus(idiv(roll * elementalPct[e]!, 100), buff.damagePct), e, ALL);
      }
      if (buff.fireMax > 0) dealDamage(sim, target, rollInt(sim.state.rng, buff.fireMin, buff.fireMax), 'fire', ALL);
      if (skill.stunTicks > 0 && target.hp > 0 && target.rank !== 'boss') target.stunTicks = Math.max(target.stunTicks, skill.stunTicks);
      }
    }
    return swung;
  },
};

/**
 * A melee tower's gear on a hit: its added elemental damage, then crushing blow (combat.ts
 * crushingBlow, against the swing's physical hit), open wounds and freeze, and its chance to cast
 * skills (slow and stun ride on every tower's hit, combat.ts). Bosses are never frozen.
 */
function onHit(sim: Sim, tower: Tower, target: Monster, gear: TowerGear, hpBefore: number, hit: number): void {
  for (const e of ELEMENTS) {
    const add = gear.adds[e];
    if (e === 'phys' || !add || target.hp <= 0) continue;
    const amount = rollInt(sim.state.rng, add[0], add[1]) * 256;
    if (e === 'pois') poison(sim, target, damageAgainst(sim, target, amount, e, ALL), Math.max(1, gear.poisonTicks));
    else dealDamage(sim, target, amount, e, ALL);
    if (e === 'cold' && target.hp > 0 && gear.coldTicks > 0) target.chillTicks = Math.max(target.chillTicks, gear.coldTicks);
  }
  // Chance to cast on striking rolls whether or not the blow killed
  for (const c of gear.castOnHit) if (rollInt(sim.state.rng, 0, 99) < c.chancePct) castItemSkill(sim, tower, c.skill, c.level);
  if (target.hp <= 0) return;
  crushingBlow(sim, target, gear, hpBefore, hit, false);
  if (target.hp <= 0) return;
  if (gear.openWoundsPct > 0 && rollInt(sim.state.rng, 0, 99) < gear.openWoundsPct) bleed(sim, target, openWoundsDamage(gear.openWoundsLevel), OPEN_WOUNDS_TICKS);
  if (gear.freezeTicks > 0 && target.rank !== 'boss') target.freezeTicks = Math.max(target.freezeTicks, gear.freezeTicks);
}

