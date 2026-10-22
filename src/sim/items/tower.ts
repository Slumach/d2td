// Worn gear in the sim: what a tower's items do to its skill, its attacks and its kills.
// The effects are a pure function of what the tower wears, cached by the gear object
// (equipping replaces it, never mutates it), so nothing here is state.

import { archetypeOf } from '../archetypes/registry.ts';
import type { SkillDef, TowerBuff } from '../archetypes/types.ts';
import { isAura } from '../dps.ts';
import { idiv } from '../fixed.ts';
import type { Element, Sim, Tower } from '../state.ts';
import { NO_GEAR, towerGear, type Gear, type TowerGear } from './gear.ts';

const cache = new WeakMap<Gear, { cls: string; gear: TowerGear }>();

/** The effects of what a tower wears. */
export function gearOf(sim: Sim, tower: Tower): TowerGear {
  const worn = tower.gear;
  if (!worn) return NO_GEAR;
  const hit = cache.get(worn);
  if (hit && hit.cls === tower.cls) return hit.gear;
  const gear = towerGear(sim.data.items, worn, tower.cls, sim.data.implicitGear);
  cache.set(worn, { cls: tower.cls, gear });
  return gear;
}

/** Skill levels the gear adds to a skill: +all and +class skills, +its tab, +the skill itself, +fire skills on fire skills. */
export function plusLevels(sim: Sim, gear: TowerGear, skill: SkillDef): number {
  if (gear === NO_GEAR) return 0;
  const named = (gear.plusSkill[skill.name] ?? 0) + (gear.plusSkill[sim.data.skillIds[skill.name] ?? ''] ?? 0);
  const tab = gear.plusTab[sim.data.skillTabs[skill.name] ?? ''] ?? 0;
  return gear.plusSkills + named + tab + (skill.damageType === 'fire' ? gear.fireSkills : 0);
}

/**
 * The skill as the tower casts it in its gear: its levels raised by the gear's +skills,
 * and a melee skill swinging the worn weapon instead of the class weapon.
 */
export function geared(sim: Sim, tower: Tower, skill: SkillDef): SkillDef {
  const gear = gearOf(sim, tower);
  const plus = plusLevels(sim, gear, skill);
  const weapon = skill.archetype === 'melee' ? gear.weapon : undefined;
  // An evolved tower's attack and its casting partner hit with the recipe's evolution bonus;
  // a partner aura or curse keeps its own effect
  const recipe = tower.evolved ? sim.data.evolutions.find((e) => e.id === tower.evolved) : undefined;
  const boosted = recipe && (skill.id === recipe.attack.skill || (skill.id === recipe.partner.skill && !isAura(skill)));
  const bonus = boosted ? recipe.bonus : 1000;
  if (plus === 0 && !weapon && bonus === 1000) return skill;
  return sim.data.skills[sim.data.skillVariant(skill.id, plus, weapon, bonus)]!;
}

/**
 * An item's skill (chance to cast, an aura) at its own skills.txt level: the SkillDef and the
 * level index to use with it, or undefined when no tower skill here has the name.
 */
export function itemSkill(sim: Sim, name: string, level: number): { skill: SkillDef; lvl: number } | undefined {
  const key = sim.data.itemSkill(name, level);
  const skill = key ? sim.data.skills[key] : undefined;
  return skill && { skill, lvl: 0 };
}

const NO_BUFF: TowerBuff = { damagePct: 0, attackSpeedPct: 0, fireMin: 0, fireMax: 0 };

/**
 * Chance to cast, when it rolls: the tower casts the item's skill once as that skill's own
 * act (its own target in its own range), at the item's level, with no bonuses. Skills no
 * tower casts here do nothing. Returns true when something was cast.
 */
export function castItemSkill(sim: Sim, tower: Tower, name: string, level: number): boolean {
  const it = itemSkill(sim, name, level);
  const act = it && archetypeOf(it.skill).act;
  return !!it && !!act && act(sim, tower, it.skill, it.lvl, NO_BUFF);
}

/** Open wounds lasts 8 seconds (200 D2 frames). */
export const OPEN_WOUNDS_TICKS = 160;

/**
 * D2's open wounds: the whole bleed over its 8 seconds, in 1/256 HP, from the attacker's
 * level (per frame 9L+31 to level 15, 18L-104 to 30, 27L-374 to 45, 36L-779 to 60, then
 * 45L-1319; 200 frames). A tower's level is its item's (see design.md).
 */
export function openWoundsDamage(level: number): number {
  const l = Math.max(1, Math.min(99, level));
  const perFrame = l <= 15 ? 9 * l + 31 : l <= 30 ? 18 * l - 104 : l <= 45 ? 27 * l - 374 : l <= 60 ? 36 * l - 779 : 45 * l - 1319;
  return perFrame * 200;
}

/** D2's diminishing returns on attack and cast speed: effective = 120 x speed / (120 + speed). */
export const effectiveSpeed = (pct: number) => (pct <= 0 ? 0 : idiv(120 * pct, 120 + pct));

/**
 * The tower's aura buff with its gear on top: melee skills take the gear's enhanced damage
 * and attack speed and carry the gear for its on-hit stats; every other skill is a spell
 * and takes faster cast rate and the facets' +% to its element's skill damage, as in D2.
 */
export function withGear(buff: TowerBuff, gear: TowerGear, skill: SkillDef): TowerBuff {
  if (gear === NO_GEAR) return buff;
  if (skill.archetype === 'melee') {
    return {
      ...buff,
      damagePct: buff.damagePct + gear.damagePct + gear.implicitDamagePct,
      attackSpeedPct: buff.attackSpeedPct + effectiveSpeed(gear.attackSpeedPct),
      gear,
    };
  }
  return {
    ...buff,
    damagePct: buff.damagePct + (gear.skillDamagePct[skill.damageType as Element] ?? 0) + gear.implicitDamagePct,
    attackSpeedPct: buff.attackSpeedPct + effectiveSpeed(gear.castSpeedPct),
  };
}
