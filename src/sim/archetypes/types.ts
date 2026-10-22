// The archetype contract. A skill is one JSON entry naming an archetype; the archetype's
// resolve() turns it plus its skills.txt and missiles.txt rows into a SkillDef with all
// five tower levels precomputed, and its behaviour hooks run that SkillDef in the sim.

import type { TowerGear } from '../items/gear.ts';
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
  /** The name players know when skills.txt spells it otherwise (Eruption is Fissure). */
  displayName?: string;
  /**
   * A skill no tower picks, cast by another (a trap's shots, Phoenix Strike's charges): it
   * takes that skill's levels and its +skills, bought levels and evolution bonus.
   */
  castBy?: string;
  /** Skills cast in turn, one a cast, instead of this one's own act (Phoenix Strike's charges). */
  charges?: string[];
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
  /** skills.txt column whose calc gives the attack interval in frames per level (Thunder Storm's perdelay). */
  rateCalc?: string;
  /** skills.txt column whose calc gives a freeze length in frames (Glacial Spike's auralencalc). */
  freezeCalc?: string;
  [archetypeFields: string]: unknown;
}

export interface SkillCommon {
  id: string;
  /** skills.txt name: the key items, tabs and strings use. */
  name: string;
  /** The name shown to players. */
  displayName: string;
  /** See SkillJson castBy and charges. */
  castBy?: string;
  charges?: string[];
  archetype: ArchetypeId;
  damageType: DamageType;
  skillLevels: number[];
  rangeUnits: number;
  rateTicks: number;
  /** Ticks between attacks at each tower level: rateTicks, or the rateCalc's frames. */
  rates: number[];
  /** skills.txt delay or localdelay as ticks: a cooldown that attack speed cannot beat. */
  delayTicks: number;
  /**
   * What a hit carries besides its damage, per tower level, all in ticks (0 for none):
   * cold skills chill for their ELen, freezeCalc skills freeze, and poison spreads its
   * damage over its ELen instead of landing at once.
   */
  chillTicks: number[];
  freezeTicks: number[];
  poisonTicks: number[];
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
  /** Bow skills: the class weapon each arrow carries (1/256 HP), at weaponPct percent, plus the skill's damage percent. */
  weapon?: DamageRange;
  weaponPct: number;
  levels: (DamageRange & { count: number; damagePct: number })[];
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
  /** Stun on everything hit, per tower level, in ticks (War Cry, Mind Blast); never bosses. */
  stunTicks: number[];
  /** nova: a ring from the tower out to its range, hitting everything once (Poison Nova). */
  delivery: 'missile' | 'strike' | 'orbit' | 'nova';
  /** Strikes a random monster in range instead of the tower's target (Thunder Storm). */
  randomTarget: boolean;
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
  /** Every swing hits everything in reach (Whirlwind). */
  hitsAll: boolean;
  /** The physical hit lands as this element instead (Berserk's magic). */
  convert?: Element;
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
  /** A melee tower's worn gear, for its on-hit stats (crushing blow, deadly strike, added damage). */
  gear?: TowerGear;
  damagePct: number;
  attackSpeedPct: number;
  /** Bolts fly on through what they hit with this chance (the Amazon's Pierce). */
  piercePct?: number;
  /** Defence percent for the tower's summons (Shout): monsters hit them less often. */
  defensePct?: number;
  /** Fire added to every hit, 1/256 HP (Enchant). */
  fireMin: number;
  fireMax: number;
}

export interface BuffAuraDef extends SkillCommon {
  archetype: 'buffAura';
  levels: (TowerBuff & { radiusUnits: number })[];
}

/**
 *   aura   weakens every monster in radius of the tower (Conviction)
 *   curse  cast on a spot in range: monsters within the radius carry it for its duration
 *          (Amplify Damage, Decrepify, Lower Resist)
 *   pulse  takes a percent of current HP off everything in radius (Static Field)
 */
export interface DebuffDef extends SkillCommon {
  archetype: 'debuff';
  mode: 'aura' | 'curse' | 'pulse';
  levels: {
    radiusUnits: number;
    resistDown: Partial<Record<Element, number>>;
    slowPct: number;
    /** Less damage dealt by the monster, to summons. */
    damageDownPct: number;
    durationTicks: number;
    /** Pulse: percent of current HP, and the least it takes (1/256 HP). */
    hpPct: number;
    minDamage: number;
    /** Aura: more gold from monsters killed in it (Find Item's chance, as a percent). */
    goldPct: number;
  }[];
}

/** A curse riding on a monster. */
export interface CurseFx {
  slowPct: number;
  damageDownPct: number;
  resistDown: Partial<Record<Element, number>>;
}

/**
 *   melee   blocks the path tile nearest its tower and fights what it stops (Raise Skeleton)
 *   ranged  stands on the tower's side of the path and shoots; never blocks (Skeletal Mage)
 *   revive  raises a corpse in range as an ally that blocks where it rose, for durationTicks
 */
export interface SummonDef extends SkillCommon {
  archetype: 'summon';
  /** trap: placed on the path in range, fires its shot skills from there, gone when its shots are spent. */
  kind: 'melee' | 'ranged' | 'revive' | 'trap';
  /** Trap: the skills each shot casts, from the trap's spot. */
  shotSkills: string[];
  /** The skills.txt summon monster; empty for revive, which raises the corpse's own monster. */
  monster: string;
  respawnTicks: number;
  durationTicks: number;
  /** Ranged: how far a summon shoots. */
  shotRangeUnits: number;
  levels: (DamageRange & {
    count: number;
    /** Trap: shots before it is gone. */
    shots: number;
    hp: number;
    /** HP percent (revive: of the corpse's max HP; others: the bonus already in hp), and the damage bonus. */
    hpPct: number;
    damagePct: number;
    /** Ranged: one bolt per element; each summon picks one when raised. */
    bolts: (DamageRange & { element: Element; lengthTicks: number })[];
  })[];
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
  /** Less damage dealt to summons (Decrepify). */
  damageDownPct: number;
  /** More gold when it is killed, by any tower (Find Item): added to the killer's gold find. */
  goldPct?: number;
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
