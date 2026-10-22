// Ladder metrics. A tier-up must be a strict upgrade, and "better" is measured from data:
//
//   Attack skills: single-target damage per tick against the standard target, a plain
//   monster (not undead, not a demon, no resistances). In 1/256 HP per 1000 ticks.
//
//   Auras: the DPS multiplier the aura gives a reference neighbour (a level-5 tower of
//   balance.json tierLadder.referenceSkill) against that same target, per mille:
//     damage %             x (100 + damage) / 100
//     attack speed %       the neighbour's interval shortened by that attack speed
//     resistance cut       against a target at balance.json debuffTargetResist (50%):
//                          x (100 - (50 - cut)) / (100 - 50), resistance floored at -100
//     slow %               x 100 / (100 - slow), extra time under fire
//     added fire           x (hit + fire) / hit, against the neighbour's average hit
// Curses count like debuff auras.
//
// Per archetype for attack skills: one projectile shot (a volley has one per target); a pierce or chain bolt
// hits the target once; a splash hits it once per cast (the sub-missile only if its
// filter allows plain monsters); a zone hits every tickTicks while it lasts; melee is
// weapon damage with the skill's percent and elemental adds, times swings; a control
// aura pulses its damage. Summons, corpse skills and pulses (a percent of current HP)
// have no standard-target number and score 0.

import type { DamageRange, HitFilter, SkillDef } from './archetypes/types.ts';
import { idiv } from './fixed.ts';

const PER = 1000;

/** Percent of a hit the standard target takes. */
function plainPct(filter: HitFilter): number {
  return filter.fullDamageTo === 'all' ? 100 : filter.otherDamagePct;
}

function avg(r: DamageRange): number {
  return idiv(r.min + r.max, 2);
}

function interval(skill: SkillDef, lvl: number, attackSpeedPct = 0, ignoreDelay = false): number {
  return Math.max(1, idiv((skill.rates[lvl] ?? skill.rateTicks) * 100, 100 + attackSpeedPct), ignoreDelay ? 0 : skill.delayTicks);
}

export function standardDps(skill: SkillDef, lvl: number, ignoreDelay = false): number {
  const per = (damage: number) => idiv(damage * PER, interval(skill, lvl, 0, ignoreDelay));
  switch (skill.archetype) {
    case 'projectile': {
      // One shot per target: a volley lands one shot on the standard target; a bow skill's
      // arrow carries the weapon at its share with the skill's damage percent
      const l = skill.levels[lvl]!;
      const weapon = skill.weapon ? idiv(idiv(avg(skill.weapon) * skill.weaponPct, 100) * (100 + l.damagePct), 100) : 0;
      return per(idiv((avg(l) + weapon) * plainPct(skill.filter), 100));
    }
    case 'pierce':
      return per(idiv(avg(skill.levels[lvl]!) * plainPct(skill.filter), 100));
    case 'splash': {
      const l = skill.levels[lvl]!;
      const sub = skill.subFilter && l.subRadiusUnits > 0 ? idiv(avg(l.sub) * plainPct(skill.subFilter), 100) : 0;
      return per(idiv(avg(l) * plainPct(skill.filter), 100) + sub);
    }
    case 'zone': {
      const hits = Math.max(1, idiv(skill.durationTicks, skill.tickTicks));
      return per(idiv(avg(skill.levels[lvl]!) * hits * plainPct(skill.filter), 100));
    }
    case 'melee': {
      const l = skill.levels[lvl]!;
      const weapon = avg(skill.weapon);
      let hit = idiv(weapon * (100 + l.damagePct), 100);
      for (const pct of Object.values(l.elementalPct)) hit += idiv(weapon * (pct ?? 0), 100);
      return per(hit * l.swings);
    }
    case 'control':
      return per(idiv(avg(skill.levels[lvl]!) * plainPct(skill.filter), 100));
    default:
      return 0;
  }
}

/** True for skills whose worth is what they do to others: buff, debuff and control auras, and curses. */
export function isAura(skill: SkillDef): boolean {
  return (
    skill.archetype === 'buffAura' ||
    (skill.archetype === 'debuff' && skill.mode !== 'pulse') ||
    (skill.archetype === 'control' && skill.mode === 'aura')
  );
}

/** The reference neighbour's average hit at its top level, for added flat damage. */
function averageHit(reference: SkillDef): number {
  const top = reference.levels.length - 1;
  const l = reference.levels[top] as Partial<DamageRange>;
  return l.min !== undefined && l.max !== undefined ? Math.max(1, avg(l as DamageRange)) : 1;
}

/**
 * The DPS multiplier (per mille) an aura gives the reference neighbour. A resistance cut is
 * worth what it does to a resistant target (`debuffResist` percent): against a plain
 * monster a cut past its 0% looks smaller than it plays.
 */
export function auraMultiplier(skill: SkillDef, lvl: number, reference: SkillDef, debuffResist = 0): number {
  let m = PER;
  const times = (pct: number) => {
    m = idiv(m * (100 + pct), 100);
  };
  const top = reference.levels.length - 1;
  if (skill.archetype === 'buffAura') {
    const l = skill.levels[lvl]!;
    times(l.damagePct);
    // Pierce: a bolt that flies on hits one more monster that often, on a crowd
    times(Math.min(100, l.piercePct ?? 0));
    m = idiv(m * interval(reference, top), interval(reference, top, l.attackSpeedPct));
    const hit = averageHit(reference);
    m = idiv(m * (hit + avg({ min: l.fireMin, max: l.fireMax })), hit);
  } else if (skill.archetype === 'debuff') {
    const l = skill.levels[lvl]!;
    const cuts = Object.values(l.resistDown).map((v) => v ?? 0);
    const after = Math.max(-100, debuffResist - (cuts.length > 0 ? Math.max(...cuts) : 0));
    m = idiv(m * (100 - after), 100 - debuffResist);
    m = idiv(m * 100, 100 - Math.min(90, l.slowPct));
  } else if (skill.archetype === 'control') {
    const slow = Math.min(90, skill.levels[lvl]!.slowPct);
    m = idiv(m * 100, 100 - slow);
  }
  return m;
}

/** What a tier-up compares: DPS for attack skills, the neighbour multiplier for auras. */
export function ladderMetric(skill: SkillDef, lvl: number, reference: SkillDef, debuffResist = 0): number {
  return isAura(skill) ? auraMultiplier(skill, lvl, reference, debuffResist) : standardDps(skill, lvl);
}

const scaled = (r: DamageRange, permille: number): DamageRange => ({ min: idiv(r.min * permille, PER), max: idiv(r.max * permille, PER) });
const scalePct = (v: number, permille: number) => idiv(v * permille, PER);

/**
 * What a recipe's two parents are worth together at their top levels (per mille of DPS
 * against the standard target): the attack under the partner's aura or curse, plus the
 * partner's own damage when it casts by itself. With `ignoreDelay` the attack's own delay
 * is dropped, as an evolution with ignoreSkillDelay plays it.
 */
export function pairValue(attack: SkillDef, partner: SkillDef, lvl: number, ignoreDelay = false): number {
  const a = standardDps(attack, lvl, ignoreDelay);
  const mult = isAura(partner) ? auraMultiplier(partner, lvl, attack, 50) : PER;
  return idiv(a * mult, PER) + (isAura(partner) ? 0 : standardDps(partner, lvl));
}

/**
 * A skill's damage, and only its damage, times `permille`: an evolution's bonus. Auras and
 * curses keep their effects (the partner aura's strength is the partner's, not the bonus's).
 */
export function withDamageBonus(skill: SkillDef, permille: number): SkillDef {
  if (permille === PER) return skill;
  switch (skill.archetype) {
    case 'projectile':
      return { ...skill, ...(skill.weapon ? { weapon: scaled(skill.weapon, permille) } : {}), levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille) })) };
    case 'pierce':
    case 'zone':
      return { ...skill, levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille) })) } as SkillDef;
    case 'splash':
      return { ...skill, levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille), sub: scaled(l.sub, permille) })) };
    case 'melee':
      return { ...skill, weapon: scaled(skill.weapon, permille) };
    case 'control':
      return { ...skill, levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille) })) };
    case 'summon':
      return {
        ...skill,
        levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille), hp: scalePct(l.hp, permille), bolts: l.bolts.map((b) => ({ ...b, ...scaled(b, permille) })) })),
      };
    case 'corpse':
      return { ...skill, levels: skill.levels.map((l) => ({ ...l, minPct: scalePct(l.minPct, permille), maxPct: scalePct(l.maxPct, permille) })) };
    default:
      return skill;
  }
}

/**
 * A skill with a flat tier bonus (per mille): damage for attack skills, the aura's
 * effects for auras. Used when a tier cannot out-damage the one before it by its cap.
 */
export function withTierBonus(skill: SkillDef, permille: number): SkillDef {
  if (permille === PER) return skill;
  switch (skill.archetype) {
    case 'projectile':
      return { ...skill, ...(skill.weapon ? { weapon: scaled(skill.weapon, permille) } : {}), levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille) })) };
    case 'pierce':
    case 'zone':
      return { ...skill, levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille) })) } as SkillDef;
    case 'splash':
      return { ...skill, levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille), sub: scaled(l.sub, permille) })) };
    case 'melee':
      return { ...skill, weapon: scaled(skill.weapon, permille) };
    case 'control':
      return {
        ...skill,
        levels: skill.levels.map((l) => ({ ...l, ...scaled(l, permille), slowPct: Math.min(90, scalePct(l.slowPct, permille)) })),
      };
    case 'buffAura':
      return {
        ...skill,
        levels: skill.levels.map((l) => ({
          ...l,
          damagePct: scalePct(l.damagePct, permille),
          attackSpeedPct: scalePct(l.attackSpeedPct, permille),
          piercePct: Math.min(100, scalePct(l.piercePct ?? 0, permille)),
          fireMin: scalePct(l.fireMin, permille),
          fireMax: scalePct(l.fireMax, permille),
        })),
      };
    case 'debuff':
      return {
        ...skill,
        levels: skill.levels.map((l) => ({
          ...l,
          slowPct: Math.min(90, scalePct(l.slowPct, permille)),
          resistDown: Object.fromEntries(Object.entries(l.resistDown).map(([e, v]) => [e, scalePct(v ?? 0, permille)])),
          goldPct: scalePct(l.goldPct, permille),
        })),
      };
    default:
      return skill;
  }
}
