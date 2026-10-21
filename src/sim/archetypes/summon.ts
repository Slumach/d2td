// Summon: raises units near the path. Raise Skeleton, Skeletal Mage, Revive.
//   melee   stands on the path tile nearest the tower and blocks it: monsters stop and
//           fight it (Kingdom Rush barracks)
//   ranged  stands on the tower's side of the path and shoots; it never blocks and
//           monsters never reach it
//   revive  raises a fresh corpse in range (normal monsters only) as an ally that blocks
//           where it rose, for durationTicks. Corpses are shared: Corpse Explosion and the
//           Fallen Shaman take them too.
// The unit is the skill's skills.txt "summon" monster. Unlike wild monsters, D2 pets take
// monstats HP and damage as absolute values (a skeleton has 21 HP and hits for 1-2); the
// skill adds its EMin per level to the damage (passivecalc2 + edmn) and its damage percent.
// A Skeletal Mage shoots one of its skill's missiles (fire, cold, lightning or poison,
// picked when it is raised) at the missile level of its summon skill calc.

import { aliveWithin, damageAgainst, dealDamage, distSq, poison, withBonus } from '../combat.ts';
import { UNITS_PER_TILE, d2FramesToTicks, idiv, isqrt } from '../fixed.ts';
import { nearestPathDist, positionAt } from '../map.ts';
import { rollInt } from '../rng.ts';
import type { Corpse, Element, Monster, Sim, Summon, Tower } from '../state.ts';
import { findRow, int, str } from '../tables.ts';
import { calcAt, common, damageAt, elementalAtLevel, etype, fields, filterFrom, lengthAt, perLevel, tenthsToUnits } from './common.ts';
import type { ArchetypeModule, SummonDef } from './types.ts';

interface SummonJson {
  kind?: 'melee' | 'ranged' | 'revive';
  countCalc: string;
  /** skills.txt column with the summons' damage percent bonus. */
  damagePctCalc?: string;
  respawnTicks: number;
  /** Ranged: the missiles a summon may shoot, the calc for their level, and its reach. */
  bolts?: string[];
  boltLevelCalc?: string;
  shotRangeTenths?: number;
  /** Revive: the calc for the percent of the corpse's HP, and how long the ally lasts. */
  hpPctCalc?: string;
  durationTicks?: number;
}

const ALL = filterFrom(undefined);
/** Summons reach monsters this far beyond the blocking distance. */
const REACH = UNITS_PER_TILE / 2;
/** Ranged summons stand this far from the path toward their tower, and this far apart along it. */
const SIDE_OFFSET = (UNITS_PER_TILE * 6) / 10;
const SPREAD = (UNITS_PER_TILE * 4) / 10;

/** Where a tower's next ranged summon stands: beside the path, on the tower's side. */
function rangedSpot(sim: Sim, tower: Tower, index: number): { dist: number; x: number; y: number } {
  const base = nearestPathDist(sim.map, tower);
  const step = Math.ceil(index / 2) * (index % 2 === 1 ? 1 : -1);
  const dist = Math.max(0, Math.min(sim.map.length, base + step * SPREAD));
  const p = positionAt(sim.map, dist);
  const d = Math.max(1, isqrt(distSq(p, tower)));
  const off = Math.min(SIDE_OFFSET, d);
  return { dist, x: p.x + idiv((tower.x - p.x) * off, d), y: p.y + idiv((tower.y - p.y) * off, d) };
}

/** The fresh corpse in range a revive raises: the toughest, then the oldest. */
function corpseToRevive(sim: Sim, tower: Tower, range: number): Corpse | undefined {
  let best: Corpse | undefined;
  for (const c of sim.state.corpses) {
    if (c.rank !== 'normal' || distSq(tower, c) > range * range) continue;
    if (!best || c.maxHp > best.maxHp) best = c;
  }
  return best;
}

export const summon: ArchetypeModule<SummonDef> = {
  id: 'summon',

  resolve(json, ctx) {
    const f = fields<SummonJson>(json);
    const kind = f.kind ?? 'melee';
    const monster = kind === 'revive' ? '' : str(ctx.skillRow, 'summon');
    const stats = monster ? findRow(ctx.tables.monstats, 'Id', monster) : undefined;
    const bolts = (f.bolts ?? []).map((id) => findRow(ctx.tables.missiles, 'Missile', id));
    return {
      ...common(json, ctx, true),
      archetype: 'summon',
      kind,
      monster,
      respawnTicks: f.respawnTicks,
      durationTicks: f.durationTicks ?? 0,
      shotRangeUnits: tenthsToUnits(f.shotRangeTenths ?? 0),
      levels: perLevel(json, (level) => {
        const bonus = f.damagePctCalc ? calcAt(ctx.skillRow, f.damagePctCalc, level) : 0;
        const added = elementalAtLevel(ctx.skillRow, 'min', level, 'skill');
        const dmg = (col: string) => (stats ? withBonus((int(stats, col) + added) * 256, bonus) : 0);
        const boltLevel = Math.max(1, f.boltLevelCalc ? calcAt(ctx.skillRow, f.boltLevelCalc, level) : level);
        return {
          count: Math.max(0, calcAt(ctx.skillRow, f.countCalc, level)),
          hp: stats ? Math.max(1, int(stats, 'minHP')) * 256 : 0,
          min: dmg('A1MinD'),
          max: dmg('A1MaxD'),
          hpPct: f.hpPctCalc ? calcAt(ctx.skillRow, f.hpPctCalc, level) : 100,
          damagePct: bonus,
          bolts: bolts.map((row) => ({
            ...damageAt(row, boltLevel, 'missile'),
            element: etype(row) ?? 'mag',
            lengthTicks: d2FramesToTicks(lengthAt(row, boltLevel)),
          })),
        };
      }),
    };
  },

  act(sim, tower, skill, lvl) {
    const s = sim.state;
    const mine = s.summons.filter((u) => u.towerId === tower.id);
    const level = skill.levels[lvl]!;
    if (mine.length >= level.count || tower.summonCooldown > 0) return false;
    const unit = { towerId: tower.id, cooldown: 0, ticksLeft: 0, targetId: 0, element: 'phys' as Element, rangeUnits: 0, effectTicks: 0 };

    if (skill.kind === 'revive') {
      const corpse = corpseToRevive(sim, tower, skill.rangeUnits);
      if (!corpse) return false;
      s.corpses = s.corpses.filter((c) => c.id !== corpse.id);
      const def = sim.data.monsters[corpse.def]!;
      const hp = Math.max(256, idiv(corpse.maxHp * level.hpPct, 100));
      s.summons.push({
        ...unit,
        id: s.nextId++,
        kind: 'revive',
        def: corpse.def,
        dist: corpse.dist,
        x: corpse.x,
        y: corpse.y,
        hp,
        maxHp: hp,
        minDamage: withBonus(def.minDamage, level.damagePct),
        maxDamage: withBonus(def.maxDamage, level.damagePct),
        ticksLeft: skill.durationTicks,
      });
      return true;
    }

    let spot: { dist: number; x: number; y: number };
    if (skill.kind === 'ranged') {
      spot = rangedSpot(sim, tower, mine.length);
    } else {
      const dist = nearestPathDist(sim.map, tower);
      spot = { dist, ...positionAt(sim.map, dist) };
    }
    if (distSq(tower, spot) > skill.rangeUnits * skill.rangeUnits) return false;
    const bolt = level.bolts.length > 0 ? level.bolts[rollInt(s.rng, 0, level.bolts.length - 1)] : undefined;
    s.summons.push({
      ...unit,
      id: s.nextId++,
      kind: skill.kind,
      def: skill.monster,
      dist: spot.dist,
      x: spot.x,
      y: spot.y,
      hp: level.hp,
      maxHp: level.hp,
      minDamage: bolt ? bolt.min : level.min,
      maxDamage: bolt ? bolt.max : level.max,
      element: bolt ? bolt.element : 'phys',
      rangeUnits: skill.shotRangeUnits,
      effectTicks: bolt ? bolt.lengthTicks : 0,
    });
    return true;
  },
};

/** The skill that raised a tower's summons: its current one, or its evolved attack. */
function summonSkillOf(sim: Sim, tower: Tower): SummonDef | undefined {
  const id = tower.evolved ? sim.data.evolutions.find((e) => e.id === tower.evolved)?.attack.skill : tower.picks[tower.tier - 1];
  const skill = id ? sim.data.skills[id] : undefined;
  return skill?.archetype === 'summon' ? skill : undefined;
}

/** A ranged summon's shot: poison spreads over the bolt's length, cold chills for it. */
function shoot(sim: Sim, unit: Summon, target: Monster): void {
  const amount = rollInt(sim.state.rng, unit.minDamage, unit.maxDamage);
  if (unit.element === 'pois' && unit.effectTicks > 0) {
    // Like a skill's poison: resisted once, then spread
    poison(target, damageAgainst(sim, target, amount, 'pois', ALL), unit.effectTicks);
    return;
  }
  const dealt = dealDamage(sim, target, amount, unit.element, ALL);
  if (unit.element === 'cold' && dealt > 0 && target.hp > 0) target.chillTicks = Math.max(target.chillTicks, unit.effectTicks);
}

/** Summons fight; revived allies fall when their time runs out; dead ones free their tower to raise again. */
export function updateSummons(sim: Sim): void {
  const s = sim.state;
  const reach = sim.data.rules.blockRangeUnits + REACH;
  for (const unit of s.summons) {
    if (unit.kind === 'revive' && unit.ticksLeft > 0 && --unit.ticksLeft === 0) unit.hp = 0;
    if (unit.hp <= 0 || --unit.cooldown > 0) continue;
    const near = aliveWithin(sim, unit, unit.kind === 'ranged' ? unit.rangeUnits : reach);
    if (near.length === 0) continue;
    const target = near.reduce((a, b) => (distSq(unit, b) < distSq(unit, a) ? b : a));
    unit.targetId = target.id;
    if (unit.kind === 'ranged') shoot(sim, unit, target);
    else dealDamage(sim, target, rollInt(s.rng, unit.minDamage, unit.maxDamage), 'phys', ALL);
    unit.cooldown = sim.data.rules.monsterAttackTicks;
  }
  const dead = s.summons.filter((u) => u.hp <= 0);
  if (dead.length === 0) return;
  for (const unit of dead) {
    const tower = s.towers.find((t) => t.id === unit.towerId);
    const skill = tower && summonSkillOf(sim, tower);
    if (tower && skill) tower.summonCooldown = skill.respawnTicks;
  }
  s.summons = s.summons.filter((u) => u.hp > 0);
}

/** The first living blocker ahead of `dist` that a monster walking to `next` would run into. */
export function blockerAhead(sim: Sim, dist: number, next: number): Summon | undefined {
  const block = sim.data.rules.blockRangeUnits;
  let best: Summon | undefined;
  for (const unit of sim.state.summons) {
    if (unit.kind === 'ranged' || unit.hp <= 0 || unit.dist <= dist - block || unit.dist - block > next) continue;
    if (!best || unit.dist < best.dist) best = unit;
  }
  return best;
}
