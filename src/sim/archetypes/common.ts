// Resolve helpers shared by the archetypes: table lookups, D2 damage-by-level, calcs,
// missile speed and lifetime, and hit filters.

import { evalCalc } from '../calc.ts';
import { UNITS_PER_TILE, VELOCITY_TO_UNITS_PER_TICK, d2FramesToTicks, idiv } from '../fixed.ts';
import type { Element } from '../state.ts';
import { findRow, int, str, type TableRow, type Tables } from '../tables.ts';
import type { DamageRange, DamageFilter, HitFilter, ResolveContext, SkillCommon, SkillJson } from './types.ts';

export const TOWER_LEVELS = 5;

const ETYPES: Record<string, Element> = { mag: 'mag', fire: 'fire', ltng: 'ltng', cold: 'cold', pois: 'pois' };

/** skills.txt EType as an element, or undefined for physical skills. */
export function etype(row: TableRow): Element | undefined {
  return ETYPES[str(row, 'EType')];
}

/**
 * D2's per-level elemental damage: the base at level 1, then the Lev1 increment for
 * levels 2 to 8, Lev2 for 9 to 16, Lev3 for 17 to 22, Lev4 for 23 to 28, Lev5 beyond.
 * skills.txt names the increments EMinLev1; missiles.txt names them MinELev1.
 */
export function elementalAtLevel(row: TableRow, which: 'min' | 'max', level: number, table: 'skill' | 'missile'): number {
  const base = which === 'min' ? 'EMin' : 'EMax';
  const step = (i: number) =>
    table === 'skill' ? `${base}Lev${i}` : `${which === 'min' ? 'Min' : 'Max'}ELev${i}`;
  const brackets: [number, number][] = [
    [2, 8],
    [9, 16],
    [17, 22],
    [23, 28],
    [29, 1000],
  ];
  let value = int(row, base);
  brackets.forEach(([from, to], i) => {
    value += Math.max(0, Math.min(level, to) - from + 1) * int(row, step(i + 1));
  });
  return value;
}

/**
 * D2's per-level length in frames (cold length, poison length): ELen at level 1, then
 * ELevLen1 for levels 2 to 8, ELevLen2 for 9 to 16, ELevLen3 beyond. Both tables use
 * the same column names.
 */
export function lengthAt(row: TableRow, level: number): number {
  const brackets: [number, number][] = [
    [2, 8],
    [9, 16],
    [17, 1000],
  ];
  let value = int(row, 'ELen');
  brackets.forEach(([from, to], i) => {
    value += Math.max(0, Math.min(level, to) - from + 1) * int(row, `ELevLen${i + 1}`);
  });
  return value;
}

/**
 * D2's per-level physical damage of a skill (MinDam, MaxDam and the MinLevDam1 to 5
 * increments, the same brackets as the elemental columns; missiles.txt names them
 * MinDamage and MinLevDam1).
 */
export function physicalAtLevel(row: TableRow, which: 'min' | 'max', level: number, table: 'skill' | 'missile'): number {
  const base = table === 'skill' ? (which === 'min' ? 'MinDam' : 'MaxDam') : which === 'min' ? 'MinDamage' : 'MaxDamage';
  const step = (i: number) => `${which === 'min' ? 'Min' : 'Max'}LevDam${i}`;
  const brackets: [number, number][] = [
    [2, 8],
    [9, 16],
    [17, 22],
    [23, 28],
    [29, 1000],
  ];
  let value = int(row, base);
  brackets.forEach(([from, to], i) => {
    value += Math.max(0, Math.min(level, to) - from + 1) * int(row, step(i + 1));
  });
  return value;
}

/**
 * Damage at a level in 1/256 HP: the elemental columns shifted by HitShift, or the
 * physical columns for a row with no element (Tornado, War Cry, Mind Blast). Poison
 * values are per frame in D2; this returns the whole dose over the poison length.
 */
export function damageAt(row: TableRow, level: number, table: 'skill' | 'missile'): DamageRange {
  const shift = 2 ** int(row, 'HitShift');
  const frames = etype(row) === 'pois' ? Math.max(1, lengthAt(row, level)) : 1;
  const physical = !etype(row) && elementalAtLevel(row, 'max', level, table) === 0;
  const at = physical ? physicalAtLevel : elementalAtLevel;
  return {
    min: at(row, 'min', level, table) * shift * frames,
    max: at(row, 'max', level, table) * shift * frames,
  };
}

export function params(row: TableRow): number[] {
  return Array.from({ length: 9 }, (_, i) => int(row, `Param${i + 1}`));
}

/** Evaluates the calc in a skills.txt column (calc1, aurarangecalc, petmax...) at a level. */
export function calcAt(row: TableRow, column: string, level: number): number {
  return evalCalc(row[column], {
    lvl: level,
    params: params(row),
    elementalMin: elementalAtLevel(row, 'min', level, 'skill'),
    elementalMax: elementalAtLevel(row, 'max', level, 'skill'),
  });
}

/** The skill's server missile row. */
export function missileOf(tables: Tables, skillRow: TableRow, name?: string): TableRow {
  const id = name ?? (str(skillRow, 'srvmissile') || str(skillRow, 'srvmissilea'));
  if (!id) throw new Error(`${str(skillRow, 'skill')} has no server missile`);
  return findRow(tables.missiles, 'Missile', id);
}

export function missileSpeed(missile: TableRow): number {
  return int(missile, 'Vel') * VELOCITY_TO_UNITS_PER_TICK;
}

export function missileLifetime(missile: TableRow): number {
  return Math.max(1, d2FramesToTicks(int(missile, 'Range')));
}

export function tenthsToUnits(tenths: number): number {
  return idiv(tenths * UNITS_PER_TILE, 10);
}

/** Aura and jump ranges are in D2 units; balance.json says how many make a tile. */
export function auraUnits(value: number, perTile: number): number {
  return idiv(value * UNITS_PER_TILE, perTile);
}

const FILTERS: DamageFilter[] = ['all', 'undead', 'demon', 'undeadDemon'];

/**
 * Hit filter from a missile row. Damage function 15 (Holy Bolt and the FoH bolts) uses
 * sHitPar2 for who takes full damage and dParam1 for the percent everyone else takes.
 * Damage function 5 (Blessed Hammer) reads as bonus damage: dParam1 percent against
 * undead, dParam2 against demons. balance.json skillOverrides replace either.
 */
export function filterFrom(missile: TableRow | undefined, override?: Partial<HitFilter>): HitFilter {
  const filter: HitFilter = { fullDamageTo: 'all', otherDamagePct: 100, bonusVsUndeadPct: 0, bonusVsDemonPct: 0 };
  if (missile) {
    const fn = int(missile, 'pSrvDmgFunc');
    if (fn === 15) {
      filter.fullDamageTo = FILTERS[int(missile, 'sHitPar2')] ?? 'all';
      filter.otherDamagePct = int(missile, 'dParam1');
    } else if (fn === 5) {
      filter.bonusVsUndeadPct = int(missile, 'dParam1');
      filter.bonusVsDemonPct = int(missile, 'dParam2');
    }
  }
  return { ...filter, ...override };
}

/** Cooldown the skill itself imposes (skills.txt delay or localdelay), in ticks. */
export function skillDelayTicks(row: TableRow): number {
  return d2FramesToTicks(Math.max(int(row, 'delay'), int(row, 'localdelay')));
}

/** The common fields, validating the JSON's damage type against skills.txt where it has one. */
export function common(json: SkillJson, ctx: ResolveContext, needsRange: boolean): SkillCommon {
  const skillLevels = levelsOf(json);
  if (needsRange && (json.rangeTenths === undefined || json.rateTicks === undefined)) {
    throw new Error(`${json.id}: rangeTenths and rateTicks are required for ${json.archetype}`);
  }
  const row = ctx.skillRow;
  const rateTicks = json.rateTicks ?? 0;
  const frames = (level: number) => (level > 0 ? Math.max(1, d2FramesToTicks(level)) : 0);
  return {
    id: json.id,
    name: str(row, 'skill'),
    displayName: json.displayName ?? str(row, 'skill'),
    archetype: json.archetype,
    damageType: json.damageType,
    skillLevels,
    rangeUnits: tenthsToUnits(json.rangeTenths ?? 0),
    rateTicks,
    rates: skillLevels.map((l) => (json.rateCalc ? frames(calcAt(row, json.rateCalc, l)) : rateTicks)),
    delayTicks: skillDelayTicks(row),
    chillTicks: skillLevels.map((l) => (json.damageType === 'cold' ? frames(lengthAt(row, l)) : 0)),
    freezeTicks: skillLevels.map((l) => (json.freezeCalc ? frames(calcAt(row, json.freezeCalc, l)) : 0)),
    poisonTicks: skillLevels.map((l) => (etype(row) === 'pois' ? frames(Math.max(1, lengthAt(row, l))) : 0)),
  };
}

/** The JSON's elemental damage type must match skills.txt EType when the skill has one. */
export function elementalType(json: SkillJson, row: TableRow): Element {
  const fromTable = etype(row);
  if (json.damageType === 'none') throw new Error(`${json.id}: ${json.archetype} needs a damage type`);
  if (fromTable && fromTable !== json.damageType) {
    throw new Error(`${json.id}: damageType ${json.damageType} but skills.txt EType is ${fromTable}`);
  }
  return json.damageType;
}

/** The archetype's own block, e.g. json.splash for a splash skill. */
export function fields<T>(json: SkillJson): T {
  const block = json[json.archetype];
  if (block === undefined || typeof block !== 'object') throw new Error(`${json.id}: missing "${json.archetype}" block`);
  return block as T;
}

/** aurastatN / aurastatcalcN pairs of a skill at a level, by D2 stat name. */
export function auraStats(row: TableRow, level: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 1; i <= 6; i++) {
    const stat = str(row, `aurastat${i}`);
    if (stat) out[stat] = calcAt(row, `aurastatcalc${i}`, level);
  }
  return out;
}

/** The five skills.txt levels a skill resolves at (its JSON ones, or its tier ladder). */
function levelsOf(json: SkillJson): number[] {
  if (!json.skillLevels || json.skillLevels.length !== TOWER_LEVELS) {
    throw new Error(`${json.id}: needs ${TOWER_LEVELS} skill levels`);
  }
  return json.skillLevels;
}

export function perLevel<T>(json: SkillJson, fn: (skillLevel: number) => T): T[] {
  return levelsOf(json).map(fn);
}
