// Summon: raises units onto the path tile nearest the tower. They block it: monsters stop
// and fight them (Kingdom Rush barracks). Raise Skeleton, Skeletal Mage, Revive.
// The unit is the skill's skills.txt "summon" monster. Unlike wild monsters, D2 pets take
// monstats HP and damage as absolute values (a skeleton has 21 HP and hits for 1-2); the
// skill adds its EMin per level to the damage (passivecalc2 + edmn) and its damage percent.

import { aliveWithin, dealDamage, distSq, withBonus } from '../combat.ts';
import { UNITS_PER_TILE } from '../fixed.ts';
import { nearestPathDist, positionAt } from '../map.ts';
import { rollInt } from '../rng.ts';
import type { Sim, Summon } from '../state.ts';
import { findRow, int, str } from '../tables.ts';
import { calcAt, common, elementalAtLevel, fields, filterFrom, perLevel } from './common.ts';
import type { ArchetypeModule, SummonDef } from './types.ts';

interface SummonJson {
  countCalc: string;
  /** skills.txt column with the summons' damage percent bonus. */
  damagePctCalc?: string;
  respawnTicks: number;
}

const ALL = filterFrom(undefined);
/** Summons reach monsters this far beyond the blocking distance. */
const REACH = UNITS_PER_TILE / 2;

export const summon: ArchetypeModule<SummonDef> = {
  id: 'summon',

  resolve(json, ctx) {
    const f = fields<SummonJson>(json);
    const monster = str(ctx.skillRow, 'summon');
    const stats = findRow(ctx.tables.monstats, 'Id', monster);
    return {
      ...common(json, ctx, true),
      archetype: 'summon',
      monster,
      respawnTicks: f.respawnTicks,
      levels: perLevel(json, (level) => {
        const bonus = f.damagePctCalc ? calcAt(ctx.skillRow, f.damagePctCalc, level) : 0;
        const added = elementalAtLevel(ctx.skillRow, 'min', level, 'skill');
        const dmg = (col: string) => withBonus((int(stats, col) + added) * 256, bonus);
        return {
          count: Math.max(0, calcAt(ctx.skillRow, f.countCalc, level)),
          hp: Math.max(1, int(stats, 'minHP')) * 256,
          min: dmg('A1MinD'),
          max: dmg('A1MaxD'),
        };
      }),
    };
  },

  act(sim, tower, skill, lvl) {
    const s = sim.state;
    const alive = s.summons.filter((u) => u.towerId === tower.id).length;
    const level = skill.levels[lvl]!;
    if (alive >= level.count || tower.summonCooldown > 0) return false;
    const dist = nearestPathDist(sim.map, tower);
    const spot = positionAt(sim.map, dist);
    if (distSq(tower, spot) > skill.rangeUnits * skill.rangeUnits) return false;
    s.summons.push({
      id: s.nextId++,
      towerId: tower.id,
      def: skill.monster,
      dist,
      x: spot.x,
      y: spot.y,
      hp: level.hp,
      maxHp: level.hp,
      minDamage: level.min,
      maxDamage: level.max,
      cooldown: 0,
    });
    return true;
  },
};

/** Summons swing at the nearest monster in reach; dead ones free their tower to respawn. */
export function updateSummons(sim: Sim): void {
  const s = sim.state;
  const reach = sim.data.rules.blockRangeUnits + REACH;
  for (const unit of s.summons) {
    if (unit.hp <= 0 || --unit.cooldown > 0) continue;
    const near = aliveWithin(sim, unit, reach);
    if (near.length === 0) continue;
    const target = near.reduce((a, b) => (distSq(unit, b) < distSq(unit, a) ? b : a));
    dealDamage(sim, target, rollInt(s.rng, unit.minDamage, unit.maxDamage), 'phys', ALL);
    unit.cooldown = sim.data.rules.monsterAttackTicks;
  }
  const dead = s.summons.filter((u) => u.hp <= 0);
  if (dead.length === 0) return;
  for (const unit of dead) {
    const tower = s.towers.find((t) => t.id === unit.towerId);
    const skill = tower && sim.data.skills[tower.picks[tower.tier - 1] ?? ''];
    if (tower && skill?.archetype === 'summon') tower.summonCooldown = skill.respawnTicks;
  }
  s.summons = s.summons.filter((u) => u.hp > 0);
}

/** The first living summon ahead of `dist` that a monster walking to `next` would run into. */
export function blockerAhead(sim: Sim, dist: number, next: number): Summon | undefined {
  const block = sim.data.rules.blockRangeUnits;
  let best: Summon | undefined;
  for (const unit of sim.state.summons) {
    if (unit.hp <= 0 || unit.dist <= dist - block || unit.dist - block > next) continue;
    if (!best || unit.dist < best.dist) best = unit;
  }
  return best;
}
