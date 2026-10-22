// The aura field for one tick. Every aura emitter (an aura tower's own skill, an evolved
// tower's built-in partner aura at half radius, or an aura on an item the tower wears)
// contributes to towers and monsters in its radius. The same aura from two towers counts once, strongest value per stat; different
// auras add up. Curses ride on the monsters themselves and count as one more source:
// across every curse a monster carries, the strongest value of each effect.

import { archetypeOf } from './archetypes/index.ts';
import type { AuraContribution, MonsterAuraFx, SkillDef, TowerBuff } from './archetypes/types.ts';
import { within } from './combat.ts';
import { baseSkillId, EVOLVED_LEVEL_INDEX, MAX_TOWER_LEVEL } from './data.ts';
import { gearOf, geared, itemSkill } from './items/tower.ts';
import { idiv } from './fixed.ts';
import { ELEMENTS, type AuraEmitter, type AuraField, type Monster, type Sim, type Tower } from './state.ts';

/** The key all of a monster's curses share in the field, so they never add up. */
const CURSES = 'curses';

/** The skill a tower attacks or pulses with, and its level index, or undefined if inert. */
export function activeSkill(sim: Sim, tower: Tower): { skill: SkillDef; lvl: number } | undefined {
  if (tower.evolved) {
    const recipe = sim.data.evolutions.find((e) => e.id === tower.evolved)!;
    return { skill: geared(sim, tower, sim.data.skills[recipe.attack.skill]!), lvl: EVOLVED_LEVEL_INDEX };
  }
  const id = tower.picks[tower.tier - 1];
  const skill = id ? sim.data.skills[id] : undefined;
  // Levels past 5 play the ladder's top level raised by the bought skill levels (geared)
  return skill && { skill: geared(sim, tower, skill), lvl: Math.min(tower.level, MAX_TOWER_LEVEL) - 1 };
}

interface Source {
  tower: Tower;
  skill: SkillDef;
  aura: AuraContribution;
}

/** Every aura this tower projects this tick. */
export function auraSources(sim: Sim, tower: Tower): Source[] {
  const out: Source[] = [];
  const own = activeSkill(sim, tower);
  const ownAura = own && archetypeOf(own.skill).aura?.(own.skill, own.lvl);
  if (own && ownAura && ownAura.radiusUnits > 0) out.push({ tower, skill: own.skill, aura: ownAura });
  // Item auras (Infinity's Conviction, Beast's Fanaticism, Doom's Holy Freeze): the tower
  // projects each at the item's level; the same aura from the tower's own skill counts once
  for (const a of gearOf(sim, tower).auras) {
    const it = itemSkill(sim, a.skill, a.level);
    const aura = it && archetypeOf(it.skill).aura?.(it.skill, it.lvl);
    if (it && aura && aura.radiusUnits > 0) out.push({ tower, skill: it.skill, aura });
  }
  if (tower.evolved && tower.partnerSkill) {
    const partner = geared(sim, tower, sim.data.skills[tower.partnerSkill]!);
    const aura = archetypeOf(partner).aura?.(partner, tower.partnerLevel);
    if (aura) out.push({ tower, skill: partner, aura: { ...aura, radiusUnits: idiv(aura.radiusUnits, 2) } });
  }
  return out;
}

const noBuff = (): TowerBuff => ({ damagePct: 0, attackSpeedPct: 0, fireMin: 0, fireMax: 0 });
const noFx = (): MonsterAuraFx => ({ slowPct: 0, resistDown: {}, damageDownPct: 0 });

function strongestTower(into: TowerBuff, add: TowerBuff): void {
  into.damagePct = Math.max(into.damagePct, add.damagePct);
  into.attackSpeedPct = Math.max(into.attackSpeedPct, add.attackSpeedPct);
  into.piercePct = Math.max(into.piercePct ?? 0, add.piercePct ?? 0);
  if (add.fireMax > into.fireMax) {
    into.fireMin = add.fireMin;
    into.fireMax = add.fireMax;
  }
}

function strongestMonster(into: MonsterAuraFx, add: MonsterAuraFx): void {
  into.slowPct = Math.max(into.slowPct, add.slowPct);
  into.damageDownPct = Math.max(into.damageDownPct, add.damageDownPct);
  for (const e of ELEMENTS) {
    const v = add.resistDown[e];
    if (v !== undefined) into.resistDown[e] = Math.max(into.resistDown[e] ?? 0, v);
  }
}

/** Every curse on a monster folded into one effect: strongest value per stat. */
function curseFx(sim: Sim, m: Monster): MonsterAuraFx | undefined {
  if (m.curses.length === 0) return undefined;
  const fx = noFx();
  for (const c of m.curses) {
    const skill = sim.data.skills[c.skill];
    if (skill?.archetype !== 'debuff') continue;
    const l = skill.levels[c.lvl]!;
    strongestMonster(fx, { slowPct: l.slowPct, resistDown: l.resistDown, damageDownPct: l.damageDownPct });
  }
  return fx;
}

export function computeAuras(sim: Sim): AuraField {
  const s = sim.state;
  // target id -> aura skill id -> strongest effect of that aura
  const towerBy: Record<number, Record<string, TowerBuff>> = {};
  const monsterBy: Record<number, Record<string, MonsterAuraFx>> = {};
  const emitters: AuraEmitter[] = [];

  for (const tower of s.towers) {
    for (const { skill, aura } of auraSources(sim, tower)) {
      emitters.push({ towerId: tower.id, skill: skill.id, radiusUnits: aura.radiusUnits });
      if (aura.towers) {
        for (const t of s.towers) {
          if (!within(tower, t, aura.radiusUnits)) continue;
          const per = (towerBy[t.id] ??= {});
          strongestTower((per[baseSkillId(skill.id)] ??= noBuff()), aura.towers);
        }
      }
      if (aura.monsters) {
        for (const m of s.monsters) {
          if (m.hp <= 0 || !within(tower, m, aura.radiusUnits)) continue;
          const per = (monsterBy[m.id] ??= {});
          strongestMonster((per[baseSkillId(skill.id)] ??= noFx()), aura.monsters);
        }
      }
    }
  }
  for (const m of s.monsters) {
    const fx = m.hp > 0 ? curseFx(sim, m) : undefined;
    if (fx) (monsterBy[m.id] ??= {})[CURSES] = fx;
  }

  // Different auras stack
  const towers: Record<number, TowerBuff> = {};
  for (const [id, per] of Object.entries(towerBy)) {
    const sum = noBuff();
    for (const b of Object.values(per)) {
      sum.damagePct += b.damagePct;
      sum.attackSpeedPct += b.attackSpeedPct;
      sum.piercePct = Math.min(100, (sum.piercePct ?? 0) + (b.piercePct ?? 0));
      sum.fireMin += b.fireMin;
      sum.fireMax += b.fireMax;
    }
    towers[Number(id)] = sum;
  }
  const monsters: Record<number, MonsterAuraFx> = {};
  for (const [id, per] of Object.entries(monsterBy)) {
    const sum = noFx();
    for (const fx of Object.values(per)) {
      sum.slowPct += fx.slowPct;
      sum.damageDownPct += fx.damageDownPct;
      for (const e of ELEMENTS) {
        const v = fx.resistDown[e];
        if (v !== undefined) sum.resistDown[e] = (sum.resistDown[e] ?? 0) + v;
      }
    }
    monsters[Number(id)] = sum;
  }
  return { towers, monsters, emitters };
}

export const EMPTY_FIELD: AuraField = { towers: {}, monsters: {}, emitters: [] };
