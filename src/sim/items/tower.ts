// Worn gear in the sim: what a tower's items do to its skill, its attacks and its kills.
// The effects are a pure function of what the tower wears, cached by the gear object
// (equipping replaces it, never mutates it), so nothing here is state.

import type { SkillDef, TowerBuff } from '../archetypes/types.ts';
import { idiv } from '../fixed.ts';
import type { Sim, Tower } from '../state.ts';
import { NO_GEAR, towerGear, type Gear, type TowerGear } from './gear.ts';

const cache = new WeakMap<Gear, { cls: string; gear: TowerGear }>();

/** The effects of what a tower wears. */
export function gearOf(sim: Sim, tower: Tower): TowerGear {
  const worn = tower.gear;
  if (!worn) return NO_GEAR;
  const hit = cache.get(worn);
  if (hit && hit.cls === tower.cls) return hit.gear;
  const gear = towerGear(sim.data.items, worn, tower.cls);
  cache.set(worn, { cls: tower.cls, gear });
  return gear;
}

/** Skill levels the gear adds to a skill: +all and +class skills, +the skill itself, +fire skills on fire skills. */
export function plusLevels(sim: Sim, gear: TowerGear, skill: SkillDef): number {
  if (gear === NO_GEAR) return 0;
  const named = (gear.plusSkill[skill.name] ?? 0) + (gear.plusSkill[sim.data.skillIds[skill.name] ?? ''] ?? 0);
  return gear.plusSkills + named + (skill.damageType === 'fire' ? gear.fireSkills : 0);
}

/**
 * The skill as the tower casts it in its gear: its levels raised by the gear's +skills,
 * and a melee skill swinging the worn weapon instead of the class weapon.
 */
export function geared(sim: Sim, tower: Tower, skill: SkillDef): SkillDef {
  const gear = gearOf(sim, tower);
  const plus = plusLevels(sim, gear, skill);
  const weapon = skill.archetype === 'melee' ? gear.weapon : undefined;
  if (plus === 0 && !weapon) return skill;
  return sim.data.skills[sim.data.skillVariant(skill.id, plus, weapon)]!;
}

/** D2's diminishing returns on attack and cast speed: effective = 120 x speed / (120 + speed). */
export const effectiveSpeed = (pct: number) => (pct <= 0 ? 0 : idiv(120 * pct, 120 + pct));

/**
 * The tower's aura buff with its gear on top: melee skills take the gear's enhanced damage
 * and attack speed and carry the gear for its on-hit stats; every other skill is a spell
 * and takes only faster cast rate, as in D2.
 */
export function withGear(buff: TowerBuff, gear: TowerGear, skill: SkillDef): TowerBuff {
  if (gear === NO_GEAR) return buff;
  if (skill.archetype === 'melee') {
    return {
      ...buff,
      damagePct: buff.damagePct + gear.damagePct,
      attackSpeedPct: buff.attackSpeedPct + effectiveSpeed(gear.attackSpeedPct),
      gear,
    };
  }
  return { ...buff, attackSpeedPct: buff.attackSpeedPct + effectiveSpeed(gear.castSpeedPct) };
}
