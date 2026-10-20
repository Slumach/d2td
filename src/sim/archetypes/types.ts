// The archetype contract. A skill is one JSON entry naming an archetype; the archetype's
// resolve() turns it plus its skills.txt and missiles.txt rows into a SkillDef with all
// five tower levels precomputed, and its behaviour hooks run that SkillDef in the sim.

import type { Element, Missile, Sim, Tower } from '../state.ts';
import type { TableRow, Tables } from '../tables.ts';

export type ArchetypeId =
  | 'projectile'
  | 'pierce'
  | 'splash'
  | 'zone'
  | 'melee'
  | 'control'
  | 'buffAura'
  | 'debuff'
  | 'summon'
  | 'corpse';

export type DamageType = Element | 'none';

/** Which monsters take full damage; the rest take otherDamagePct. */
export type DamageFilter = 'all' | 'undead' | 'demon' | 'undeadDemon';

export interface HitFilter {
  fullDamageTo: DamageFilter;
  otherDamagePct: number;
  bonusVsUndeadPct: number;
  bonusVsDemonPct: number;
}

/** Fields every skill JSON entry has. Archetype fields sit under a key named after it. */
export interface SkillJson {
  id: string;
  /** skills.txt "skill" column. */
  skill: string;
  archetype: ArchetypeId;
  damageType: DamageType;
  /**
   * skills.txt levels used for tower levels 1 to 5. Only T1 and non-class skills have
   * them; T2 and T3 skills get a ladder computed at load time (see buildLadders).
   */
  skillLevels?: number[];
  /** Attack range in tenths of a tile; auras use their radius calc instead. */
  rangeTenths?: number;
  /** Ticks between attacks before attack speed bonuses. */
  rateTicks?: number;
  /**
   * Per mille flat bonus for a T2/T3 skill that cannot reach its tier floor by the cap.
   * Computed from data at load time; stored here so it is visible, and checked to match.
   */
  tierBonus?: number;
  [archetypeFields: string]: unknown;
}

export interface SkillCommon {
  id: string;
  name: string;
  archetype: ArchetypeId;
  damageType: DamageType;
  skillLevels: number[];
  rangeUnits: number;
  rateTicks: number;
  /** skills.txt delay or localdelay as ticks: a cooldown that attack speed cannot beat. */
  delayTicks: number;
}

/** Damage range at one tower level, in 1/256 HP. */
export interface DamageRange {
  min: number;
  max: number;
}

export interface ProjectileDef extends SkillCommon {
  archetype: 'projectile';
  missileSpeed: number;
  missileLifetime: number;
  filter: HitFilter;
  levels: (DamageRange & { count: number })[];
}

export interface PierceDef extends SkillCommon {
  archetype: 'pierce';
  mode: 'pierce' | 'chain';
  missileSpeed: number;
  missileLifetime: number;
  /** Pierce mode: monsters a missile may pass through, 0 for unlimited. */
  pierceCount: number;
  falloffPct: number;
  filter: HitFilter;
  levels: (DamageRange & { hops: number; jumpUnits: number })[];
}

export interface SplashDef extends SkillCommon {
  archetype: 'splash';
  delivery: 'missile' | 'strike' | 'orbit';
  radiusUnits: number;
  /** Damage percent at the edge of the radius; linear falloff from the centre. */
  edgeDamagePct: number;
  missileSpeed: number;
  missileLifetime: number;
  /** Strike delivery: ticks from cast to impact. */
  impactTicks: number;
  orbitTurns: number;
  filter: HitFilter;
  subFilter: HitFilter | undefined;
  /** The sub-missile's own EType. */
  subElement: Element;
  levels: (DamageRange & { sub: DamageRange; subRadiusUnits: number })[];
}

export interface ZoneDef extends SkillCommon {
  archetype: 'zone';
  radiusUnits: number;
  tickTicks: number;
  durationTicks: number;
  filter: HitFilter;
  levels: DamageRange[];
}

export interface MeleeDef extends SkillCommon {
  archetype: 'melee';
  /** Weapon damage from weapons.txt, 1/256 HP. */
  weapon: DamageRange;
  stunTicks: number;
  levels: { swings: number; damagePct: number; elementalPct: Partial<Record<Element, number>> }[];
}

export interface ControlDef extends SkillCommon {
  archetype: 'control';
  mode: 'aura' | 'onHit';
  /** Aura mode: ticks between damage pulses (skills.txt perdelay). */
  pulseTicks: number;
  /** On-hit mode: how long the slow lasts. */
  durationTicks: number;
  missileSpeed: number;
  missileLifetime: number;
  filter: HitFilter;
  levels: (DamageRange & { radiusUnits: number; slowPct: number })[];
}

export interface TowerBuff {
  damagePct: number;
  attackSpeedPct: number;
}

export interface BuffAuraDef extends SkillCommon {
  archetype: 'buffAura';
  levels: (TowerBuff & { radiusUnits: number })[];
}

export interface DebuffDef extends SkillCommon {
  archetype: 'debuff';
  mode: 'aura';
  levels: { radiusUnits: number; resistDown: Partial<Record<Element, number>> }[];
}

export interface SummonDef extends SkillCommon {
  archetype: 'summon';
  monster: string;
  respawnTicks: number;
  levels: (DamageRange & { count: number; hp: number })[];
}

export interface CorpseDef extends SkillCommon {
  archetype: 'corpse';
  filter: HitFilter;
  levels: { radiusUnits: number; minPct: number; maxPct: number; physicalPct: number }[];
}

export type SkillDef =
  | ProjectileDef
  | PierceDef
  | SplashDef
  | ZoneDef
  | MeleeDef
  | ControlDef
  | BuffAuraDef
  | DebuffDef
  | SummonDef
  | CorpseDef;

/** What resolve() can read: the parsed tables plus the bits of balance.json skills use. */
export interface ResolveContext {
  tables: Tables;
  skillRow: TableRow;
  /** Paladin melee weapon from the class JSON, a weapons.txt "name". */
  weapon: string | undefined;
  auraRangePerTile: number;
  /** balance.json skillOverrides for this skill, if any. */
  filterOverride: Partial<HitFilter> | undefined;
}

/** Monster-side aura effects on one monster for this tick. */
export interface MonsterAuraFx {
  slowPct: number;
  resistDown: Partial<Record<Element, number>>;
}

/** One emitter's contribution, before "same aura: strongest only". */
export interface AuraContribution {
  radiusUnits: number;
  towers?: TowerBuff;
  monsters?: MonsterAuraFx;
}

export interface ArchetypeModule<D extends SkillDef = SkillDef> {
  id: D['archetype'];
  resolve(json: SkillJson, ctx: ResolveContext): D;
  /**
   * Attack or pulse once if there is something to do. Returns true when it acted, which
   * restarts the tower's cooldown. `lvl` is the tower level index, 0 to 4.
   */
  act?(sim: Sim, tower: Tower, skill: D, lvl: number, buff: TowerBuff): boolean;
  /** Aura emitters: the effect this skill projects at a level. */
  aura?(skill: D, lvl: number): AuraContribution;
  /** Advances one of this skill's missiles. Returns false when it is gone. */
  updateMissile?(sim: Sim, missile: Missile, skill: D): boolean;
}
