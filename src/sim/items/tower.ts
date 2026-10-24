// Worn gear in the sim: what a tower's items do to its skill, its attacks and its kills.
// The effects are a pure function of what the tower wears, cached by the gear object
// (equipping replaces it, never mutates it), so nothing here is state.

import { archetypeOf } from '../archetypes/registry.ts';
import type { SkillDef, TowerBuff } from '../archetypes/types.ts';
import { MAX_TOWER_LEVEL } from '../levels.ts';
import { isAura } from '../dps.ts';
import { idiv } from '../fixed.ts';
import type { Element, Sim, Tower } from '../state.ts';
import { NO_GEAR, towerGear, type Gear, type TowerGear } from './gear.ts';

const cache = new WeakMap<Gear, { cls: string; blocks: boolean; gear: TowerGear }>();

/**
 * The effects of what a tower wears. Durability is how long its summons hold; a tower with
 * no summons that block takes it as damage instead (balance.json itemDurabilityDamagePct).
 */
export function gearOf(sim: Sim, tower: Tower): TowerGear {
  const worn = tower.gear;
  if (!worn) return NO_GEAR;
  const hit = cache.get(worn);
  const blocks = raisesBlockers(sim, tower);
  if (hit && hit.cls === tower.cls && hit.blocks === blocks) return hit.gear;
  let gear = towerGear(sim.data.items, worn, tower.cls, sim.data.implicitGear, sim.data.itemConversions, sim.data.itemProcs, sim.data.itemQualityPct);
  if (!blocks && gear.durabilityPct > 0) gear = { ...gear, durabilityPct: 0, allDamagePct: gear.allDamagePct + idiv(gear.durabilityPct * sim.data.itemDurabilityDamagePct, 100) };
  cache.set(worn, { cls: tower.cls, blocks, gear });
  return gear;
}

/** Whether a skill the tower casts raises summons that block the path (melee summons and revives). */
function raisesBlockers(sim: Sim, tower: Tower): boolean {
  const recipe = tower.evolved ? sim.data.evolutions.find((e) => e.id === tower.evolved) : undefined;
  const ids = recipe ? [recipe.attack.skill, recipe.partner.skill] : [tower.picks[tower.tier - 1]];
  return ids.some((id) => {
    const skill = id ? sim.data.skills[id] : undefined;
    return skill?.archetype === 'summon' && (skill.kind === 'melee' || skill.kind === 'revive');
  });
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
 * a melee skill swinging the worn weapon instead of the class weapon, and a bow skill firing a
 * worn bow or crossbow instead of the class bow.
 */
export function geared(sim: Sim, tower: Tower, skill: SkillDef): SkillDef {
  const gear = gearOf(sim, tower);
  const plus = plusLevels(sim, gear, skill) + boughtLevels(sim, tower);
  const bowSkill = skill.archetype === 'projectile' && skill.weapon !== undefined;
  const weapon = (skill.archetype === 'melee' && !gear.missile) || (bowSkill && gear.missile) ? gear.weapon : undefined;
  // An evolved tower's attack and its casting partner hit with the recipe's evolution bonus;
  // a partner aura or curse keeps its own effect
  const recipe = tower.evolved ? sim.data.evolutions.find((e) => e.id === tower.evolved) : undefined;
  const own = skill.castBy ?? skill.id;
  const boosted = recipe && (own === recipe.attack.skill || (own === recipe.partner.skill && !isAura(skill)));
  // A legend's three evolutions hit harder again, every damaging skill they cast
  // (an aura that only buffs or curses keeps its effect; Hurricane's damage counts)
  const harms = skill.archetype !== 'buffAura' && skill.archetype !== 'debuff';
  const legend = (tower.legend || tower.legendOf !== undefined) && harms ? sim.data.economy.legend.dpsPct : 100;
  const bonus = idiv((boosted ? recipe.bonus : 1000) * legend, 100);
  // Reach only for what has targets or area to grow; an aura or curse keeps its own
  const reach = skill.archetype === 'buffAura' || skill.archetype === 'debuff' ? 0 : reachOf(sim, tower);
  if (plus === 0 && !weapon && bonus === 1000 && reach === 0) return skill;
  return sim.data.skills[sim.data.skillVariant(skill.id, plus, weapon, bonus, reach)]!;
}

/**
 * An evolved tower's reach step, in skills.txt levels counted for targets, jumps, arrows,
 * swings and area alone: balance.json evolution.reachLevels on evolving, reachLevelsPerLevel
 * more each level past 5; a legend's legend.reachLevels instead, with the same per level.
 */
export function reachOf(sim: Sim, tower: Tower): number {
  if (!tower.evolved) return 0;
  const { evolutionReach, legend } = sim.data.economy;
  const past = Math.max(0, tower.level - MAX_TOWER_LEVEL) * evolutionReach.perLevel;
  const step = tower.legend || tower.legendOf !== undefined ? legend.reachLevels : evolutionReach.levels;
  return step + past;
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

/** skills.txt levels a tower has bought past its ladder's top (levels past 5, evolved or not), on every skill it casts. */
export function boughtLevels(sim: Sim, tower: Tower): number {
  const past = tower.level - MAX_TOWER_LEVEL;
  if (past <= 0) return 0;
  const e = sim.data.economy;
  if (tower.legend || tower.legendOf !== undefined) return past * e.legend.levels.skillLevelsPerLevel;
  return past * (tower.evolved ? e.evolvedLevels.skillLevelsPerLevel : (e.lineLevels[tower.tier - 1]?.skillLevelsPerLevel ?? 0));
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
      damagePct: buff.damagePct + gear.damagePct + gear.implicitDamagePct + gear.allDamagePct,
      attackSpeedPct: buff.attackSpeedPct + effectiveSpeed(gear.attackSpeedPct),
      gear,
    };
  }
  return {
    ...buff,
    damagePct: buff.damagePct + (gear.skillDamagePct[skill.damageType as Element] ?? 0) + gear.implicitDamagePct + gear.allDamagePct,
    attackSpeedPct: buff.attackSpeedPct + effectiveSpeed(gear.castSpeedPct),
  };
}
