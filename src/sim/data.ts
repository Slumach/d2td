// Builds the sim's game data from the pipeline's tables plus our design data (skill
// entries, classes, evolutions, monsters, balance). Pure: no I/O, so the render layer,
// the tests and the balance harness all feed it.

import { ARCHETYPES } from './archetypes/index.ts';
import type { HitFilter, SkillDef, SkillJson } from './archetypes/types.ts';
import { auraMultiplier, isAura, pairValue, singleHit, standardDps, withDamageBonus, withTierBonus } from './dps.ts';
import { VELOCITY_TO_UNITS_PER_TICK, UNITS_PER_TILE, compoundPct, d2FramesToTicks, idiv } from './fixed.ts';
import { DIFFICULTIES, DIFFICULTY_NAMES, levelVariantId, variantId, type DifficultyName } from './difficulty.ts';
import { ELEMENTS, MONSTER_MODS, type Element, type MonsterMod, type Rank } from './state.ts';
import { createMap } from './map.ts';
import { findRow, int, monumodConstant, str, type TableRow, type Tables } from './tables.ts';
import { buildItemData, type ItemData } from './items/data.ts';

export type { TableRow, Tables } from './tables.ts';

export { DIFFICULTIES, DIFFICULTY_NAMES, baseMonsterId, levelVariantId, variantId, type DifficultyName } from './difficulty.ts';

import { EVOLVED_LEVEL_INDEX, MAX_TIER, MAX_TOWER_LEVEL } from './levels.ts';
export { EVOLVED_LEVEL_INDEX, MAX_TIER, MAX_TOWER_LEVEL };

// ---- design data JSON ----

export interface ClassJson {
  id: string;
  name: string;
  /** weapons.txt "name" for this class's melee skills. */
  weapon?: string;
  lines: Record<string, { name: string; tiers: string[][] }>;
}

export interface EvolutionJson {
  name: string;
  attack: { skill: string; minTier: number };
  partner: { skill: string; minTier: number };
  ignoreSkillDelay?: boolean;
}

export interface ResurrectJson {
  /** Corpses of this monstats MonType, or these, can be raised (never other raisers). */
  monType: string | string[];
  /** monstats AI parameter columns: percent chance per AI decision, and corpse search range. */
  chanceColumn: string;
  rangeColumn: string;
  /** monseq.txt sequence the raiser plays, standing still, before the corpse rises; a second without one. */
  sequence?: string;
}

/**
 * One wave of the schedule: a stream of one monster (swarms 1 s apart, tanks 1.5 s), with
 * a superunique's pack inside it when it names one (several walk one after another, as
 * the Council or the Ancients do), or an act boss behind its pack.
 */
export type WaveJson =
  | { monster: string; kind: 'swarm' | 'tank'; area?: string; superunique?: string | string[] }
  /** An act boss's wave; superuniques named here walk in before its pack (the Durance's three before Mephisto). */
  | { boss: string; area?: string; superunique?: string | string[] };

/**
 * A named monster: a superunique (its superuniques.txt row) or an act boss (a monstats
 * boss). `class` and `minion` repeat what the tables say (the monstats class and its
 * minion1, or the class itself) so the renderer knows what art to load, and the build
 * checks them against the tables.
 */
export interface NamedJson {
  id: string;
  superunique?: string;
  class: string;
  minion?: string;
}

/** An act of the campaign: how many waves, and the field and boss lair its map shows. */
export interface ActJson {
  name: string;
  waves: number;
  field: string;
  lair: string;
}

export interface MonstersJson {
  /**
   * Monsters with an ability, by monstats id. A raiser's `party` is its monstats minion1,
   * which walks with it (PartyMin-PartyMax, midway, in the middle of its wave), as D2
   * spawns it with its group: it gives the raiser corpses of its own kind to raise.
   */
  roster: Record<string, { resurrect?: ResurrectJson; party?: string }>;
  /** The five acts; the run plays all of them on Normal, then Nightmare, then Hell. */
  acts: ActJson[];
  /** Every act, by act number, on each difficulty: its waves in order, the last its act boss. */
  campaign: Record<string, Record<DifficultyName, WaveJson[]>>;
  /** Superuniques and other named monsters: each appears as a unique pack inside a wave. */
  superuniques: NamedJson[];
  /** Act bosses: each closes its act behind its pack. */
  bosses: NamedJson[];
  /** The Secret Cow Level's waves (src/sim/cow.ts). */
  cow: CowJson;
}

export interface CowJson {
  /** The cow, by monstats id, and the Cow King, by superunique id. */
  monster: string;
  king: string;
  waves: number;
  packs: number;
  packSize: number;
}

/** balance.json cow: Wirt's Leg's drop rates and the cow waves' pacing and loot. */
export interface CowRules {
  /** Parts per million: any Hell (and endless) kill, and a kill from `pack` (Griswold's). */
  legPpm: number;
  griswoldLegPpm: number;
  pack: string;
  /** Rune entries weigh this many times more on cows' drops. */
  runeBoost: number;
  /** The Cow King: a second leg's chance, and the lowest rune he always drops. */
  kingLegPct: number;
  kingRuneMin: string;
  /** Ticks from opening the portal to the first cow wave. */
  portalTicks: number;
  /** Ticks between packs, and between cows in a pack. */
  packGapTicks: number;
  packSpacingTicks: number;
}

interface WaveKindJson {
  /** Ticks between monsters in the stream. */
  spacingTicks: number;
}

interface ModScheduleJson {
  /** The champion pack in each act's last wave before its boss, by act number: the wave's own monster with these mods. */
  champions: Record<string, MonsterMod[]>;
  /** Mods a named monster (superunique or act boss, by id) carries on top of its table mods. */
  named: Record<string, MonsterMod[]>;
}

/** src/data/balance.json. Multipliers are integer percents so the sim stays integer. */
export interface BalanceJson {
  startingGold: number;
  /** The run is lost when the weight of everything alive on the ring reaches aliveLimit; weights by rank. */
  aliveLimit: number;
  aliveWeight: Record<Rank, number>;
  /** Every tower costs this to build, however many the player owns. */
  buildCost: number;
  /**
   * An act boss's HP is this percent of its monstats HP, climbing in a straight line by wave
   * number from `first` on the run's first boss wave to `last` on its last campaign boss
   * wave: early bosses are easier than the tables, late ones harder.
   */
  bossHpPct: { first: number; last: number };
  /**
   * The packs' budget: a wave's target HP is its own from the tables (its stream, or a boss
   * with its minions); its superunique and champion packs scale their members and HP so the
   * wave stays within regularMaxPct of its target (a boss wave bossMaxPct). Nothing else is cut.
   */
  packBudget: { regularMaxPct: number; bossMaxPct: number };
  /**
   * Monster HP by stage, against the towers of the stage: at each act of each difficulty a
   * regular monster takes about hitsToKill single hits (dps.ts singleHit) from the median
   * tower of the tier and level the stage is tuned for (by difficulty, one per act; tier 4
   * is the evolved towers, and a level past 5 their bought levels), so the curve climbs act
   * by act as the towers do. Bosses keep bossHpPct on top. Computed at load time from the
   * tables (rules.stageHpPct); npm run hpcurve prints it.
   */
  /**
   * difficultyPct: a percent on each difficulty's stages after the curve (Hell's carries into
   * the endless Tiers, which take Hell Act 5's stage): the curve sizes HP to the towers a stage
   * expects, and this sets how hard the difficulty is for them.
   */
  hpCurve: { hitsToKill: number; tiers: Record<string, number[]>; levels: Record<string, number[]>; difficultyPct?: Record<string, number> };
  /**
   * Past Hell Baal the run goes on forever. Every `tierWaves` waves is a Tier (Tier 1 is
   * waves 76 to 85). Waves 1 to 9 of a Tier walk Hell's regular waves in campaign order,
   * round all five acts; wave 10 brings an act boss back with its pack (Andariel, Duriel,
   * Mephisto, Diablo, Baal in turn), at bossHpPct.last. Endless wave n (from 1) has its
   * monsters at level startLevel + n x levelPerWave (monlvl.txt extrapolated past its last
   * row), and HP and damage multiplied by hpPctPerWave and damagePctPerWave compounded n times.
   */
  endless: { tierWaves: number; startLevel: number; levelPerWave: number; hpPctPerWave: number; damagePctPerWave: number };
  /** Drops (src/sim/items/drops.ts): the rune multiplier, endless Tier scaling and Smith's Hammer's rarity. */
  drops: DropRules;
  vendorCap: VendorCap;
  /** Every armour slot's small built-in tower bonus by base tier (normal, exceptional, elite); src/sim/items/gear.ts. */
  implicitGear: ImplicitGear;
  /** Every D2 stat the gear does not read directly, as a tower effect at a percent per 100 points (gear.ts). */
  itemConversions: ItemConversions;
  /** Chance-to-cast triggers a tower has no use for (when struck, on kill, on death, on level up), cast on hit at this percent of their chance. */
  itemProcs: Record<string, number>;
  /** How long a blind's stun holds. */
  itemStunTicks: number;
  /** The conversion rates on an item of each quality, percent (100 when absent): magic, rare and set items convert at a higher rate. */
  itemQualityPct: Partial<Record<string, number>>;
  /** Durability on a tower with no blocking summons becomes damage at this percent of it. */
  itemDurabilityDamagePct: number;
  cow: CowRules;
  /** Cost of the first level-up at T1, T2, T3. */
  levelCostBase: number[];
  /** Each further level-up within a tier costs this percent of the previous one. */
  levelCostPctPerLevel: number;
  /** Cost to reach T2 and T3. */
  tierCosts: number[];
  evolveCost: number;
  /**
   * T5 legends: the fee to combine three evolved towers, the damage they then do (percent of
   * what the three did), and the legend's own level ladder past its level 5.
   */
  legend: { cost: number; dpsPct: number; reachLevels: number; levels: OverLevels };
  evolvedLevels: OverLevels;
  /**
   * Levels past 5 within a tier, by tier (T1, T2, T3): steep below the top so a line climbs,
   * gentler at T3 so the top tier keeps taking gold at a fair price.
   */
  lineLevels: { costPctPerLevel: number[]; skillLevelsPerLevel: number[] };
  sellRefundPct: number;
  bountyPerLevel: number;
  /** Bounty multiplier by rank; bossBountyMultiplier overrides a boss by id. */
  rankBountyMultiplier: Record<Rank, number>;
  bossBountyMultiplier: Record<string, number>;
  /** Build time before wave 1 starts on its own. */
  firstWaveTicks: number;
  /**
   * Sending the next wave early pays every player on the ring this much per second the
   * timer still had left, per ten levels of the wave's monster.
   */
  earlySendGoldPerTenLevels: number;
  /**
   * An act's level floor: this percentile of its areas' MonLvlEx in levels.txt for the
   * difficulty. A monster the tables make weaker than the act it walks in is lifted to it.
   */
  actFloorPercentile: number;
  /**
   * The walk speed (monstats Velocity units) of a monster the tables leave stationary (the
   * Trapped Soul, Velocity 0): on the ring everything walks, at the slowest walkers' pace.
   */
  stationaryVelocity: number;
  /**
   * Monster types (monstats MonType) that walk the ring faster than their Velocity, by this
   * percent of the way to their monstats Run speed: zombies, whose walk is the game's slowest.
   */
  runningMonTypes: Record<string, number>;
  /** How top-tier skills hit more per attack where skills.txt has no growth (archetypes/common.ts Reach). */
  reach: import('./archetypes/common.ts').Reach;
  auraRangePerTile: number;
  /** D2 hardcodes how much a chilled monster slows: a design value. */
  chillPct: number;
  /**
   * Per difficulty: Static Field cannot take a monster below this percent of its max HP
   * (D2 hardcodes the floors).
   */
  staticFloorPct: number[];
  corpseLifetimeTicks: number;
  monsterAttackTicks: number;
  blockRangeTenths: number;
  /** A monster held this long by blockers breaks through, shoving the summon aside. */
  blockBreakTicks: number;
  waves: {
    /** A wave starts this long after the one before, whether that one is dead or not. */
    intervalTicks: number;
    /** How long a wave's stream of monsters lasts: its count is this over its spacing. */
    streamTicks: number;
    championPackSize: number;
    swarm: WaveKindJson;
    tank: WaveKindJson;
  };
  /**
   * The fixed specials: champion packs by wave number, and mods named monsters carry. `added`
   * holds the mods Nightmare and Hell put on top: Hell's immunities and Nightmare's resistant
   * versions of them. Rolled mods return with Random mode.
   */
  modSchedule: ModScheduleJson & {
    /** Per difficulty: mods on every champion pack, and on named monsters by id. */
    added: Partial<Record<DifficultyName, { champions?: MonsterMod[]; named?: Record<string, MonsterMod[]> }>>;
  };
  /**
   * Per difficulty, percent of Normal's average HP its wave monsters are scaled to (see
   * buildGameData): Nightmare and Hell monsters are tougher than Normal ones, by this much.
   */
  /**
   * Tier ladders: an attack tier must reach dpsPct of the tower it replaces, by tier (the
   * top tier jumps further than T2, so power sits in it); an aura tier must reach auraPct
   * of the aura it replaces, valued by the multiplier it gives a level-5 referenceSkill
   * tower. Caps by tier. Summons, corpse skills and pulses, which have no standard number,
   * take the top tier's extra jump (its dpsPct over T2's) as a flat bonus.
   */
  tierLadder: { dpsPct: Record<string, number>; auraPct: number; caps: Record<string, number>; referenceSkill: string; debuffTargetResist: number };
  /** An evolved tower is worth dpsPct of its two parents together at their top levels. */
  /**
   * An evolution's damage over its parents (dpsPct), and its reach: reachLevels extra skills.txt
   * levels on its skills' targets, jumps, arrows, swings and area alone, reachLevelsPerLevel
   * more for each evolved level past 5 (a legend: legend.reachLevels).
   */
  evolution?: { dpsPct: number; reachLevels?: number; reachLevelsPerLevel?: number };
  /**
   * D2 hardcodes these mod effects, so they are design values; resistances add to the
   * monster's own. House rule: Magic Resistant also resists magic (D2's only covers fire,
   * cold and lightning), the wall for pure Holy builds. Magic Immune and Poison Immune are
   * ours (Hell's walls): +100, so the monster is immune, not just resistant. byDifficulty
   * overrides a mod's resistances on Nightmare or Hell: maxResist is as far as the mod takes
   * a monster, championResist is where it lifts a champion to.
   */
  monsterMods: Record<
    MonsterMod,
    {
      speedPct?: number;
      damagePct?: number;
      resist?: Partial<Record<Element, number>>;
      /** An immune mod replaces these resistant mods: they never stack (Magic Immune over Magic Resistant). */
      replaces?: MonsterMod[];
      byDifficulty?: Partial<Record<DifficultyName, { resist?: Partial<Record<Element, number>>; maxResist?: number; championResist?: number }>>;
    }
  >;
  skillOverrides: Record<string, Partial<HitFilter>>;
}

/** Everything authored by us, as opposed to the game's tables. */
export interface DesignData {
  skills: SkillJson[];
  classes: ClassJson[];
  evolutions: Record<string, EvolutionJson>;
  /** T5 legends, one per class (src/data/legends.json); hidden from every list until buildable. */
  legends?: Record<string, LegendJson>;
  monsters: MonstersJson;
  balance: BalanceJson;
}

export interface LegendJson {
  name: string;
  class: string;
  /** monstats.txt Id of the NPC or monster it is drawn as. */
  monster: string;
}

export interface LegendDef {
  id: string;
  name: string;
  cls: string;
  monster: string;
}

// ---- resolved game data ----

export interface MonsterDef {
  /**
   * The difficulty variant's id; `base` is the monstats id its stats and art come from (a
   * superunique's class). baseMonsterId(id) is the monster or boss without the difficulty.
   */
  id: string;
  base: string;
  difficulty: number;
  name: string;
  /** A superunique's own palette (its Utrans), as the atlas variant `su_${boss id}`. */
  artVariant?: string;
  /** monstats flying: flyers walk the path for now. */
  flying: boolean;
  /** A superunique's mods from superuniques.txt (Mod1 to Mod3). */
  mods: MonsterMod[];
  /** A boss's pack: monstats minion1 (or its own class), PartyMin-PartyMax or the superunique's MinGrp-MaxGrp, midway. */
  minion?: { monster: string; count: number };
  monType: string;
  /** Its level on its difficulty: sets HP, damage and bounty (through monlvl and bountyPerLevel). */
  level: number;
  /**
   * HP range in 1/256 HP: monstats minHP/maxHP percent of monlvl HP at the difficulty's
   * level and columns, scaled so the difficulty's roster averages Normal's (see
   * buildGameData): the wave curve sets how tough a wave is, the columns how tough each
   * monster is against the others.
   */
  minHp: number;
  maxHp: number;
  /**
   * Attack damage (A1MinD/A1MaxD percent of monlvl DM at the difficulty's level and
   * columns), 1/256 HP. Monsters only ever hit summons, so this is what Hell's tougher
   * monsters do to a skeleton.
   */
  minDamage: number;
  maxDamage: number;
  speed: number;
  resist: Record<Element, number>;
  undead: boolean;
  demon: boolean;
  /** D2 attack rating: A1TH percent of monlvl TH at the difficulty's level. Decides hits on armoured summons. */
  attackRating: number;
  /** Defence: monstats AC percent of monlvl.txt AC at its level (a summon's counts in the hit roll). */
  defense: number;
  /** Treasure classes for the difficulty: as a normal monster, a champion, a unique (a superunique's own TC). */
  treasure: [string, string, string];
  /** Ticks between AI decisions (monstats aidel). */
  aiDelayTicks: number;
  resurrect?: { monTypes: string[]; chancePct: number; radiusUnits: number; castTicks: number };
  /** The group a raiser walks with (monsters.json roster party): its monstats minion1. */
  party?: { monster: string; count: number };
}

export interface ClassDef {
  id: string;
  name: string;
  lines: Record<string, { name: string; tiers: string[][] }>;
}

export interface EvolutionDef {
  id: string;
  name: string;
  attack: { skill: string; minTier: number };
  partner: { skill: string; minTier: number };
  ignoreSkillDelay: boolean;
  /**
   * Per mille on the evolved tower's damage (attack, and the partner when it casts): what
   * lifts the two parents together, at their top levels, to balance.json evolution.dpsPct
   * of what they were. Computed from the tables at load time, like the tier bonuses.
   */
  bonus: number;
}

export interface WaveGroup {
  monster: string;
  count: number;
  spacingTicks: number;
  /** Extra ticks before this group's first monster: the gap before a pack, champions or a boss. */
  delayTicks?: number;
  rank: Rank;
  /** Mods every monster of the group carries, from the schedule. */
  mods: MonsterMod[];
  /** A named monster's pack (its id): the leader and its minions. */
  pack?: string;
  /** Percent on its monsters' HP: a superunique or champion pack fitted to its wave's budget (see fitPacks). */
  hpPct?: number;
}

export interface WaveDef {
  kind: 'swarm' | 'tank' | 'boss';
  /** The D2 area the wave's monster comes from. */
  area: string;
  /** 0 Normal, 1 Nightmare, 2 Hell; the act (1 to 5); the wave in its act, from 1, of how many. */
  difficulty: number;
  act: number;
  actWave: number;
  actWaves: number;
  /** The act's last wave: its boss, in the boss lair. */
  final: boolean;
  /** The wave's number in the whole run, from 1. */
  number: number;
  /** The level of the wave's monster: it sets HP, damage and bounty through monlvl. */
  level: number;
  groups: WaveGroup[];
  /** Endless waves: the Tier (1 for waves 76 to 85), and the percent on its monsters' HP and damage. */
  tier?: number;
  hpPct?: number;
  damagePct?: number;
}

export interface Economy {
  startingGold: number;
  buildCost: number;
  /** levelCosts[tier - 1][n] is the gold to go from level n + 1 to n + 2 in that tier. */
  levelCosts: number[][];
  /** tierCosts[0] reaches T2, tierCosts[1] reaches T3. */
  tierCosts: number[];
  /** An evolution's reach step and its growth per evolved level, in skills.txt levels for reach alone. */
  evolutionReach: { levels: number; perLevel: number };
  evolveCost: number;
  /**
   * T5 legends: the fee to combine three evolved towers, the damage they then do (percent of
   * what the three did), and the legend's own level ladder past its level 5.
   */
  legend: { cost: number; dpsPct: number; reachLevels: number; levels: OverLevels };
  /**
   * An evolved tower's levels past its base level 5: the first costs costBase, each next one
   * costPctPerLevel percent of the one before, and each adds skillLevelsPerLevel skills.txt
   * levels to both its skills (attack and partner), the way +skills do.
   */
  evolvedLevels: OverLevels;
  /**
   * Any tower's levels past 5 in its tier: the line never has to tier out to grow. The first
   * costs costPctPerLevel percent of the tier's last level, each next one that much more,
   * and each adds skillLevelsPerLevel skills.txt levels. lineLevels[tier - 1].costBase is
   * filled in from levelCosts.
   */
  lineLevels: OverLevels[];
  sellRefundPct: number;
  bountyPerLevel: number;
  rankBountyMultiplier: Record<Rank, number>;
  bossBountyMultiplier: Record<string, number>;
  /** Ticks to wave 1, between wave starts, and the gold an early send pays per second skipped per ten levels. */
  firstWaveTicks: number;
  waveTicks: number;
  earlySendGoldPerTenLevels: number;
}

/** A mod's resistances on one difficulty (see BalanceJson monsterMods). */
export interface ModResist {
  add: Partial<Record<Element, number>>;
  maxResist?: number;
  championResist?: number;
}

export interface Rules {
  aliveLimit: number;
  aliveWeight: Record<Rank, number>;
  chillPct: number;
  staticFloorPct: number[];
  corpseLifetimeTicks: number;
  monsterAttackTicks: number;
  blockRangeUnits: number;
  blockBreakTicks: number;
  /** monumod.txt constants. */
  championHpPct: number;
  uniqueHpPct: number;
  championDamagePct: number;
  /** A boss's HP percent at each boss wave, by the wave's index in the run (see BalanceJson bossHpPct). */
  bossHpPct: Record<number, number>;
  /** Every monster's HP percent by stage, "difficulty-act" (see BalanceJson hpCurve). */
  stageHpPct: Record<string, number>;
  /** Per mod: its speed and damage, and its resistances by difficulty. */
  mods: Record<MonsterMod, { speedPct: number; damagePct: number; resist: ModResist[] }>;
}

export interface GameData {
  /**
   * Builds the endless waves on demand: makes data.waves at least `upTo` long. Missing when
   * the run was built with a fixed wave count (tests, tools).
   */
  extendWaves?: (upTo: number) => void;
  /** The five acts, for the map and the HUD. */
  acts: ActJson[];
  skills: Record<string, SkillDef>;
  classes: Record<string, ClassDef>;
  evolutions: EvolutionDef[];
  legends: LegendDef[];
  monsters: Record<string, MonsterDef>;
  waves: WaveDef[];
  ladders: Ladder[];
  economy: Economy;
  rules: Rules;
  /** Every item the tables hold (src/sim/items/data.ts). */
  items: ItemData;
  /** Drop tuning (balance.json drops). */
  drops: DropRules;
  /** The Secret Cow Level: its waves (monsters.json cow) and its rules (balance.json cow). */
  cow: CowJson & CowRules;
  /**
   * A monster's entry at a difficulty and level, built the first time it is asked for and
   * kept in `monsters` under the returned id (the cow level's cows at the run's level).
   */
  monsterVariant: (id: string, difficulty: number, level?: number) => string;
  /** The most a vendor pays for one item, by stage (balance.json vendorCap; src/sim/items/price.ts). */
  vendorCap: VendorCap;
  implicitGear: ImplicitGear;
  /** Every D2 stat the gear does not read directly, as a tower effect at a percent per 100 points (gear.ts). */
  itemConversions: ItemConversions;
  /** Chance-to-cast triggers a tower has no use for (when struck, on kill, on death, on level up), cast on hit at this percent of their chance. */
  itemProcs: Record<string, number>;
  /** How long a blind's stun holds. */
  itemStunTicks: number;
  /** The conversion rates on an item of each quality, percent (100 when absent): magic, rare and set items convert at a higher rate. */
  itemQualityPct: Partial<Record<string, number>>;
  /** Durability on a tower with no blocking summons becomes damage at this percent of it. */
  itemDurabilityDamagePct: number;
  /** skills.txt skill name to its Id, for items that name a skill by number. */
  skillIds: Record<string, string>;
  /**
   * skills.txt skill name to the tab it sits on, as items' +skill tab stats count tabs: 0 to
   * 20, three a class in itemtypes.txt class order (Amazon 0 to 2, Sorceress 3 to 5: fire,
   * lightning, cold ...), from skills.txt charclass and skilldesc.txt SkillPage.
   */
  skillTabs: Record<string, string>;
  /**
   * A skill as a geared tower casts it: its skills.txt levels raised by `plus`, and a melee
   * skill swinging `weapon` (whole HP). Built once and kept in `skills` under the returned
   * id, so missiles and curses look it up like any skill.
   */
  /** A skill at +plus levels, with a worn weapon, a damage bonus (per mille) and a reach offset (skill levels for reach alone). */
  skillVariant: (id: string, plus: number, weapon?: { min: number; max: number }, bonus?: number, reach?: number) => string;
  /**
   * A skill an item casts or projects (chance to cast, item auras), by its skills.txt name
   * at a skills.txt level: the key of a SkillDef kept in `skills` whose level index 0 is
   * that level, or undefined when no tower skill here has the name (items name many skills
   * no tower casts).
   */
  itemSkill: (name: string, level: number) => string | undefined;
}

/** A converted stat's tower effect: an element's damage, or one of the rest (see gear.ts). */
export type ConversionEffect = 'durability' | 'rate' | 'damage' | 'elite' | 'slow' | 'stun' | 'goldFind' | 'openWounds' | 'allElements' | 'fire' | 'cold' | 'ltng' | 'pois' | 'mag';
/** By D2 stat: its effect and the percent of it per 100 points of the stat. */
export type ItemConversions = Record<string, [ConversionEffect, number]>;

/** An armour slot's implicit bonus: which tower stat, and the percent at each base tier. */
export type ImplicitGear = Partial<Record<string, { stat: 'damage' | 'attackSpeed' | 'castRate'; pct: [number, number, number] }>>;

export interface VendorCap {
  /** Normal, Nightmare, Hell: the cap in Act 1 and in Act 5, in a straight line between by act. */
  byDifficulty: [number, number][];
  /** Each endless Tier raises Hell's cap by this percent, compounding. */
  tierPct: number;
}

export interface DropRules {
  /**
   * The share of D2R's drops that fall, percent: each item a treasure class rolls is kept
   * with this chance before its quality roll, so every rarity keeps D2R's own ratio to the
   * rest. Gems and runes keep their own share (gemRunePct) so the rune supply stands.
   */
  dropPct: number;
  gemRunePct: number;
  /** Weight of rune entries in a treasure class, percent of D2R's (125: a quarter more runes). */
  runeMultiplierPct: number;
  /** Each endless Tier multiplies the drop rate by this percent more, compounding (shrinks NoDrop). */
  tierDropPct: number;
  /** Smith's Hammer's chance per kill, parts per million, before Tier scaling. */
  smithsHammerPpm: number;
}

/** skills.txt charclass codes in itemtypes.txt class order, the order the item stats count classes and tabs. */
const SKILL_CLASSES = ['ama', 'sor', 'nec', 'pal', 'bar', 'dru', 'ass'];

/** The skill a variant id (blessed-hammer+3) was built from. */
export function baseSkillId(id: string): string {
  const at = id.indexOf('+');
  return at < 0 ? id : id.slice(0, at);
}

/** The +skill levels a variant id carries (0 for a plain skill). */
export function skillPlus(id: string): number {
  const at = id.indexOf('+');
  return at < 0 ? 0 : parseInt(id.slice(at + 1), 10) || 0;
}

const RESIST_COLUMNS: Record<Element, string> = {
  phys: 'ResDm',
  mag: 'ResMa',
  fire: 'ResFi',
  ltng: 'ResLi',
  cold: 'ResCo',
  pois: 'ResPo',
};

/** monstats and monlvl column suffixes per difficulty. */
const SUFFIX = ['', '(N)', '(H)'];
/** monstats spells Normal's HP columns in lower case and the others capitalised. */
const HP_COLUMNS = [
  ['minHP', 'maxHP'],
  ['MinHP(N)', 'MaxHP(N)'],
  ['MinHP(H)', 'MaxHP(H)'],
];

/** superuniques.txt Mod columns name monumod.txt rows; these are the ones the sim knows. */
const UNIQUE_MODS: Record<string, MonsterMod> = {
  strong: 'extraStrong',
  fast: 'extraFast',
  curse: 'cursed',
  resist: 'magicResistant',
  spectralhit: 'spectralHit',
  fire: 'fireEnchanted',
  cold: 'coldEnchanted',
  lightning: 'lightningEnchanted',
  stoneskin: 'stoneSkin',
  manahit: 'manaBurn',
  teleport: 'teleportation',
  aura: 'auraEnchanted',
};

/** monumod rows a superunique may carry that mean nothing here: a random name, stealing potions. */
const NO_EFFECT_MODS = new Set(['rndname', 'thief']);

/** A monster's name as D2R shows it: monstats NameStr and superunique Name are string keys. */
const namesOf = new WeakMap<Tables, Map<string, string>>();
function displayName(tables: Tables, key: string): string {
  let names = namesOf.get(tables);
  if (!names) namesOf.set(tables, (names = new Map((tables.monstrings ?? []).map((r) => [str(r, 'Key'), str(r, 'enUS')]))));
  return names.get(key) ?? key;
}

/** A raiser with no monseq.txt sequence stands this long before the corpse rises: a second. */
const RAISE_TICKS = 20;

/**
 * monlvl.txt's row for a level; past its last real row (109) every number climbs on in a
 * straight line from the last two, which is how the endless Tiers keep scaling. Before 0.3.12
 * the line ran from 109 to the placeholder at 110, so every column grew 30 to 40 times too fast
 * above level 110 (Hell HP 3,293% a level instead of 87%).
 */
function monlvlRow(tables: Tables, level: number): TableRow {
  const rows = tables.monlvl;
  let top = rows.reduce((n, r) => Math.max(n, int(r, 'Level')), 0);
  // monlvl.txt's last row (level 110) is a placeholder, every column a round cap (HP 10000, AC
  // 2100), not a step on the curve: the curve goes on from the row before it
  const step = (l: number) => int(findRow(rows, 'Level', l), 'HP(H)') - int(findRow(rows, 'Level', l - 1), 'HP(H)');
  if (top > 2 && step(top) > 10 * Math.max(1, step(top - 1))) top--;
  if (level <= top) return findRow(rows, 'Level', level);
  const last = findRow(rows, 'Level', top);
  const prev = findRow(rows, 'Level', top - 1);
  const out: TableRow = { Level: level };
  for (const [k, v] of Object.entries(last)) {
    if (k === 'Level' || typeof v !== 'number') continue;
    const p = prev[k];
    out[k] = v + (typeof p === 'number' ? (v - p) * (level - top) : 0);
  }
  return out;
}

/** Midway through a min-max range of two table columns. */
const midway = (row: TableRow, min: string, max: string) => idiv(int(row, min) + int(row, max), 2);

/**
 * A monster's entry for one difficulty, from monstats (and superuniques.txt for a
 * superunique: its class's stats with its own name, mods and pack; its unique rank adds the
 * unique HP bonus when it spawns).
 */
/**
 * A monster's speed on the ring, in units per tick: its monstats Velocity (a stationary monster
 * walks at stationaryVelocity), or for a running type that percent of the way to its Run speed.
 */
function walkSpeed(row: TableRow, running: Record<string, number>, stationaryVelocity: number): number {
  const walk = int(row, 'Velocity') || stationaryVelocity;
  const run = int(row, 'Run');
  const pct = running[str(row, 'MonType')];
  const gain = pct === undefined || run <= walk ? 0 : idiv((run - walk) * VELOCITY_TO_UNITS_PER_TICK * pct, 100);
  return walk * VELOCITY_TO_UNITS_PER_TICK + gain;
}

export function monsterDef(tables: Tables, design: MonstersJson, id: string, auraRangePerTile: number, difficulty = 0, atLevel?: number, stationaryVelocity = 3, runningMonTypes: Record<string, number> = {}): MonsterDef {
  const boss = [...design.superuniques, ...design.bosses].find((b) => b.id === id);
  const su = boss?.superunique ? findRow(tables.superuniques, 'Superunique', boss.superunique) : undefined;
  if (boss && su && str(su, 'Class') !== boss.class) throw new Error(`${id}: superuniques.txt class is ${str(su, 'Class')}, not ${boss.class}`);
  const base = boss?.class ?? id;
  const row = findRow(tables.monstats, 'Id', base);
  const sfx = SUFFIX[difficulty]!;
  // A difficulty column the row leaves out falls back to Normal's (resistances excepted:
  // an empty resistance is 0, as in the game)
  const col = (name: string, normal = name) => (row[`${name}${sfx}`] !== undefined ? `${name}${sfx}` : normal);
  // D2: monstats HP and damage are percentages of the monlvl values for the monster's level
  // (its difficulty's Level column, or its act's floor), at the difficulty's columns
  const level = atLevel ?? int(row, col('Level'));
  const lvlRow = monlvlRow(tables, level);
  const lvlCol = (name: string) => (lvlRow[`${name}${sfx}`] !== undefined ? `${name}${sfx}` : name);
  const pct = (column: string, of: string) => Math.max(1, idiv(int(row, column) * int(lvlRow, of), 100)) * 256;
  const [minCol, maxCol] = HP_COLUMNS[difficulty]!;
  const hpOf = (column: string, normal: string) => pct(row[column] !== undefined ? column : normal, lvlCol('HP'));
  const resist = {} as Record<Element, number>;
  for (const element of ELEMENTS) resist[element] = int(row, `${RESIST_COLUMNS[element]}${sfx}`);
  const resurrect = design.roster[id]?.resurrect;

  const mods: MonsterMod[] = [];
  for (const column of ['Mod1', 'Mod2', 'Mod3']) {
    const modId = su ? int(su, column) : 0;
    if (modId === 0) continue;
    const name = str(findRow(tables.monumod, 'id', modId), 'uniquemod');
    if (NO_EFFECT_MODS.has(name)) continue;
    const mod = UNIQUE_MODS[name];
    if (!mod) throw new Error(`${id}: superuniques.txt ${column} is monumod ${name}, which the sim does not know`);
    mods.push(mod);
  }
  // The pack: a superunique's MinGrp-MaxGrp of its class's minion1 (or its own class), a
  // monstats boss's PartyMin-PartyMax of its minion1
  let minion: MonsterDef['minion'];
  if (boss) {
    const count = su ? midway(su, 'MinGrp', 'MaxGrp') : midway(row, 'PartyMin', 'PartyMax');
    const monster = str(row, 'minion1') || (su ? base : '');
    if (count > 0 && monster) minion = { monster, count };
    if ((minion?.monster ?? undefined) !== boss.minion) {
      throw new Error(`${id}: the tables give its pack as ${minion?.monster ?? 'none'}, monsters.json says ${boss.minion ?? 'none'}`);
    }
  }
  const partyOf = design.roster[id]?.party;
  if (partyOf !== undefined && partyOf !== str(row, 'minion1')) throw new Error(`${id}: monstats gives its party as ${str(row, 'minion1') || 'none'}, monsters.json says ${partyOf}`);
  const party = partyOf ? { monster: partyOf, count: midway(row, 'PartyMin', 'PartyMax') } : undefined;
  return {
    id: atLevel === undefined ? variantId(id, difficulty) : levelVariantId(id, difficulty, atLevel),
    base,
    difficulty,
    name: displayName(tables, su ? str(su, 'Name') : str(row, 'NameStr') || id),
    ...(su ? { artVariant: `su_${id}` } : {}),
    flying: int(row, 'flying') === 1,
    mods,
    ...(minion ? { minion } : {}),
    ...(party && party.count > 0 ? { party } : {}),
    monType: str(row, 'MonType'),
    level,
    minHp: hpOf(minCol!, 'minHP'),
    maxHp: hpOf(maxCol!, 'maxHP'),
    minDamage: pct(col('A1MinD'), lvlCol('DM')),
    maxDamage: pct(col('A1MaxD'), lvlCol('DM')),
    speed: walkSpeed(row, runningMonTypes, stationaryVelocity),
    resist,
    undead: int(row, 'lUndead') === 1 || int(row, 'hUndead') === 1,
    demon: int(row, 'demon') === 1,
    attackRating: idiv(int(row, col('A1TH')) * int(lvlRow, lvlCol('TH')), 100),
    defense: idiv(int(row, col('AC')) * int(lvlRow, lvlCol('AC')), 100),
    treasure: [
      str(row, col('TreasureClass')),
      str(row, col('TreasureClassChamp')),
      (su && str(su, `TC${sfx}`)) || str(row, col('TreasureClassUnique')),
    ],
    aiDelayTicks: Math.max(1, d2FramesToTicks(int(row, col('aidel')))),
    resurrect: resurrect && {
      monTypes: [resurrect.monType].flat(),
      chancePct: int(row, col(resurrect.chanceColumn)),
      radiusUnits: idiv(int(row, col(resurrect.rangeColumn)) * UNITS_PER_TILE, auraRangePerTile),
      // The sequence plays at 25 fps, one row per frame
      castTicks: resurrect.sequence ? Math.max(1, d2FramesToTicks(tables.monseq.filter((r) => r['sequence'] === resurrect.sequence).length)) : RAISE_TICKS,
    },
  };
}

/**
 * A mod list as a monster carries it: each mod once, and an immune mod in place of the
 * resistant mods it replaces (balance.json monsterMods replaces), never both.
 */
export function resolveMods(balance: BalanceJson, mods: MonsterMod[]): MonsterMod[] {
  const unique = [...new Set(mods)];
  const replaced = new Set(unique.flatMap((m) => balance.monsterMods[m].replaces ?? []));
  return unique.filter((m) => !replaced.has(m));
}

/** Compounds a percent per step: permille[0] = 1000, permille[n] = permille[n-1] * pct / 100. */
export function compound(pct: number, steps: number): number[] {
  const out = [1000];
  for (let i = 1; i < steps; i++) out.push(idiv(out[i - 1]! * pct, 100));
  return out;
}

/** A monster's entry on a difficulty, optionally at a level of its own; made once and kept. */
export type DefOf = (id: string, difficulty: number, level?: number) => MonsterDef;

/**
 * The campaign: five acts on Normal, then Nightmare, then Hell (monsters.json acts), each
 * act's last wave its act boss. Every act plays its own waves (monsters.json campaign) on
 * each difficulty, every monster at its monstats level for the difficulty, lifted to the
 * act's floor (`actFloor`) when the table has it weaker than the act it walks in.
 *
 * A wave is a stream of one monster for waves.streamTicks: swarms a monster a second, tanks
 * one every 1.5 s. A superunique's pack (it, and its minions) walks in the middle of its
 * wave as the wave's unique, and so does each act's champion pack (the wave's own monster),
 * in its last wave before the boss. An act boss's wave is its pack, then the boss. Every
 * special's mods come from its table row and the schedule, with the difficulty's additions
 * and the immune-over-resistant rule.
 */
/** What one wave needs to build its groups. */
interface WaveBuild {
  balance: BalanceJson;
  defOf: DefOf;
  difficulty: number;
  /** The act whose champion mods it takes (1 to 5). */
  act: number;
  entry: WaveJson;
  /** True for an act's last wave before its boss: it carries the champion pack. */
  championPack: boolean;
  /** A monster's level, or undefined for its own table level. */
  levelOf: (id: string) => number | undefined;
}

/**
 * One wave's groups. A regular wave is a stream of one monster for waves.streamTicks, with
 * a raiser's party, any superunique packs and the act's champion pack in its middle; an
 * act boss's wave is its pack, then the boss.
 */
function buildWave(b: WaveBuild): { kind: WaveDef['kind']; groups: WaveGroup[]; lead: MonsterDef } {
  const { balance, defOf, difficulty: d, entry, levelOf } = b;
  const w = balance.waves;
  const schedule = balance.modSchedule;
  const added = schedule.added[DIFFICULTIES[d]!] ?? {};
  // A named monster's mods: its table's, Normal's schedule, the difficulty's on top, resolved
  const namedMods = (id: string, own: MonsterMod[]) => resolveMods(balance, [...own, ...(schedule.named[id] ?? []), ...(added.named?.[id] ?? [])]);
  /** A named monster and its pack, as groups `spacing` apart. */
  const pack = (id: string, rank: Rank, spacing: number): WaveGroup[] => {
    const def = defOf(id, d, levelOf(id));
    const out: WaveGroup[] = [];
    if (def.minion) out.push({ monster: defOf(def.minion.monster, d, levelOf(def.minion.monster)).id, count: def.minion.count, spacingTicks: spacing, rank: 'normal', mods: [], pack: id });
    out.push({ monster: def.id, count: 1, spacingTicks: spacing, rank, mods: namedMods(id, def.mods), pack: id });
    return out;
  };
  if ('boss' in entry) {
    const before = [entry.superunique ?? []].flat().flatMap((su) => pack(su, 'unique', w.swarm.spacingTicks));
    return { kind: 'boss', groups: [...before, ...pack(entry.boss, 'boss', w.swarm.spacingTicks)], lead: defOf(entry.boss, d, levelOf(entry.boss)) };
  }
  const kind = entry.kind;
  const spacing = w[kind].spacingTicks;
  const lead = defOf(entry.monster, d, levelOf(entry.monster));
  const monster = lead.id;
  const size = Math.max(1, idiv(w.streamTicks, spacing));
  const half = idiv(size, 2);
  const specials: WaveGroup[] = [];
  // A raiser's party walks first, then the packs
  if (lead.party) specials.push({ monster: defOf(lead.party.monster, d, levelOf(lead.party.monster)).id, count: lead.party.count, spacingTicks: spacing, rank: 'normal', mods: [] });
  for (const su of [entry.superunique ?? []].flat()) specials.push(...pack(su, 'unique', spacing));
  if (b.championPack) {
    const mods = resolveMods(balance, [...(schedule.champions[String(b.act)] ?? []), ...(added.champions ?? [])]);
    specials.push({ monster, count: w.championPackSize, spacingTicks: spacing, rank: 'champion', mods });
  }
  const stream = (c: number): WaveGroup => ({ monster, count: c, spacingTicks: spacing, rank: 'normal', mods: [] });
  return { kind, groups: [stream(half), ...specials, stream(size - half)].filter((g) => g.count > 0), lead };
}

/** An act's own waves on a difficulty, checked: one per wave of the act, the last its boss. */
function actContent(monsters: MonstersJson, a: number, d: number): WaveJson[] {
  const where = `monsters.json campaign.${a + 1}.${DIFFICULTIES[d]}`;
  const own = monsters.campaign[String(a + 1)]?.[DIFFICULTIES[d]!];
  if (!own) throw new Error(`${where} is missing`);
  const last = own.at(-1);
  if (!last || !('boss' in last)) throw new Error(`${where} must end on its act boss`);
  if (own.length !== monsters.acts[a]!.waves) throw new Error(`${where} has ${own.length} waves, Act ${a + 1} ${monsters.acts[a]!.waves}`);
  return own;
}

/**
 * The campaign: five acts on Normal, then Nightmare, then Hell (monsters.json acts), each
 * act's last wave its act boss. Every act plays its own waves (monsters.json campaign) on
 * each difficulty, every monster at its monstats level for the difficulty, lifted to the
 * act's floor (`actFloor`) when the table has it weaker than the act it walks in. Every
 * special's mods come from its table row and the schedule, with the difficulty's additions
 * and the immune-over-resistant rule.
 */
export function campaignWaves(
  balance: BalanceJson,
  monsters: MonstersJson,
  defOf: DefOf,
  actFloor: (act: number, difficulty: number) => number,
): WaveDef[] {
  const waves: WaveDef[] = [];
  let number = 0;
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    monsters.acts.forEach((act, a) => {
      const n = act.waves;
      const own = actContent(monsters, a, d);
      const floor = a === 0 ? 0 : actFloor(a + 1, d);
      for (let i = 0; i < n; i++) {
        number++;
        const entry = own[i]!;
        // A monster at its table level, lifted to the act's floor when the table has it weaker than the act
        const levelOf = (id: string): number | undefined => (defOf(id, d).level < floor ? floor : undefined);
        const { kind, groups, lead } = buildWave({ balance, defOf, difficulty: d, act: a + 1, entry, championPack: i === n - 2, levelOf });
        waves.push({
          kind,
          area: entry.area ?? (i === n - 1 ? act.lair : act.field),
          difficulty: d,
          act: a + 1,
          actWave: i + 1,
          actWaves: n,
          final: i === n - 1,
          number,
          level: lead.level,
          groups,
        });
      }
    });
  }
  return waves;
}

/** Compounds a percent `n` times on 100, in integers: 103 three times is 109. */
/**
 * Endless wave `n` (1 for the run's wave 76), built from Hell's content (see BalanceJson
 * endless). Deterministic in `n` alone, so every sim builds the same wave.
 */
export function endlessWave(balance: BalanceJson, monsters: MonstersJson, defOf: DefOf, campaignLength: number, n: number): WaveDef {
  const e = balance.endless;
  const d = DIFFICULTIES.length - 1;
  const tier = Math.floor((n - 1) / e.tierWaves) + 1;
  const inTier = ((n - 1) % e.tierWaves) + 1;
  const level = e.startLevel + n * e.levelPerWave;
  const levelOf = (id: string) => Math.max(level, defOf(id, d).level);
  // Hell's regular waves in campaign order, and its bosses, act by act
  const regular: { entry: WaveJson; act: number }[] = [];
  const bosses: { entry: WaveJson; act: number }[] = [];
  monsters.acts.forEach((_, a) => {
    const own = actContent(monsters, a, d);
    for (const entry of own) ('boss' in entry ? bosses : regular).push({ entry, act: a + 1 });
  });
  const final = inTier === e.tierWaves;
  const pick = final ? bosses[(tier - 1) % bosses.length]! : regular[((tier - 1) * (e.tierWaves - 1) + inTier - 1) % regular.length]!;
  const { kind, groups, lead } = buildWave({ balance, defOf, difficulty: d, act: pick.act, entry: pick.entry, championPack: inTier === e.tierWaves - 1, levelOf });
  const act = monsters.acts[pick.act - 1]!;
  return {
    kind,
    area: pick.entry.area ?? (final ? act.lair : act.field),
    difficulty: d,
    act: pick.act,
    actWave: inTier,
    actWaves: e.tierWaves,
    final,
    number: campaignLength + n,
    level: lead.level,
    groups,
    tier,
    hpPct: compoundPct(100 + e.hpPctPerWave, n),
    damagePct: compoundPct(100 + e.damagePctPerWave, n),
  };
}

/** Each boss wave's boss HP percent: a straight line by wave index from the first boss wave to the last. */
/** The stage curve's working: each stage's tier, the median hit, the median regular monster's HP and the percent. */
export interface StageHp {
  stage: string;
  difficulty: number;
  act: number;
  tier: number;
  level: number;
  hit: number;
  hp: number;
  pct: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[idiv(s.length - 1, 2)]!;
}

/** The monster HP curve by stage (BalanceJson hpCurve), and the working behind it. */
export function stageHpPctFrom(
  balance: BalanceJson,
  campaign: WaveDef[],
  monsters: Record<string, MonsterDef>,
  classes: ClassJson[],
  skills: Record<string, SkillDef>,
  evolutions: EvolutionDef[],
  variant: (id: string, plus: number, bonus: number) => SkillDef,
): { pct: Record<string, number>; stages: StageHp[] } {
  const { hitsToKill, tiers, levels } = balance.hpCurve;
  // The hits a stage's towers land: every class line's skills of the tier at the level; tier 4
  // is the evolved towers' attacks, recipe bonus included, their bought levels past 5 added
  const hitsOf = (tier: number, level: number): number[] => {
    if (tier >= 4) {
      const plus = Math.max(0, level - MAX_TOWER_LEVEL) * balance.evolvedLevels.skillLevelsPerLevel;
      return evolutions.map((r) => singleHit(variant(r.attack.skill, plus, r.bonus), MAX_TOWER_LEVEL - 1)).filter((h) => h > 0);
    }
    // A line's level past 5 is its bought skills.txt levels (lineLevels)
    const plus = Math.max(0, level - MAX_TOWER_LEVEL) * (balance.lineLevels.skillLevelsPerLevel[tier - 1] ?? 0);
    return classes.flatMap((c) => Object.values(c.lines).flatMap((l) => l.tiers[tier - 1] ?? [])).flatMap((id) => {
      const s = plus > 0 ? variant(id, plus, 1000) : skills[id];
      return s ? [singleHit(s, Math.min(level, MAX_TOWER_LEVEL) - 1)] : [];
    }).filter((h) => h > 0);
  };
  const pct: Record<string, number> = {};
  const stages: StageHp[] = [];
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    for (let act = 1; act <= 5; act++) {
      const tier = tiers[DIFFICULTIES[d]!]?.[act - 1];
      const level = levels[DIFFICULTIES[d]!]?.[act - 1];
      // Tier 0: the stage keeps the tables' HP (Normal Act 1, before a player owns a second tower)
      if (tier === undefined || level === undefined || tier === 0) continue;
      const hps: number[] = [];
      for (const w of campaign) {
        if (w.difficulty !== d || w.act !== act) continue;
        for (const g of w.groups) {
          if (g.rank !== 'normal') continue;
          const m = monsters[g.monster];
          if (m) for (let i = 0; i < g.count; i++) hps.push(idiv(m.minHp + m.maxHp, 2));
        }
      }
      const hit = median(hitsOf(tier, level));
      const hp = median(hps);
      if (hit <= 0 || hp <= 0) continue;
      const stage = `${d}-${act}`;
      pct[stage] = Math.max(1, Math.round((100 * hitsToKill * hit * (balance.hpCurve.difficultyPct?.[DIFFICULTIES[d]!] ?? 100)) / 100 / hp));
      stages.push({ stage, difficulty: d, act, tier, level, hit, hp, pct: pct[stage]! });
    }
  }
  return { pct, stages };
}

/**
 * A wave's total HP as it spawns, in 1/256 HP: every group's monsters at their average HP,
 * their rank's bonus (a boss's ramp at its wave), the group's and the wave's percents and its
 * stage on the HP curve. `index` is the wave's place in the run.
 */
export function waveTotalHp(wave: WaveDef, index: number, rules: Pick<Rules, 'stageHpPct' | 'bossHpPct' | 'championHpPct' | 'uniqueHpPct'>, monsters: Record<string, MonsterDef>): number {
  const stage = rules.stageHpPct[wave.tier !== undefined ? '2-5' : `${wave.difficulty}-${wave.act}`] ?? 100;
  const wavePct = idiv((wave.hpPct ?? 100) * stage, 100);
  let total = 0;
  for (const g of wave.groups) {
    const d = monsters[g.monster];
    if (!d) continue;
    const rank = g.rank === 'boss' ? (rules.bossHpPct[index] ?? 100) - 100 : g.rank === 'champion' ? rules.championHpPct : g.rank === 'unique' ? rules.uniqueHpPct : 0;
    const one = idiv(idiv(idiv(idiv(d.minHp + d.maxHp, 2) * (100 + rank), 100) * (g.hpPct ?? 100), 100) * wavePct, 100);
    total += one * g.count;
  }
  return total;
}

/** True for a group in a pack the budget scales: a superunique's pack (not a boss's), or a champion pack. */
export function inPack(wave: WaveDef, g: WaveGroup): boolean {
  if (g.rank === 'champion') return true;
  if (g.rank === 'boss' || g.pack === undefined) return false;
  return wave.groups.some((h) => h.pack === g.pack && h.rank === 'unique');
}

/** A wave's target HP: its own from the tables, everything but its superunique and champion packs. */
export function waveTargetHp(wave: WaveDef, index: number, rules: Pick<Rules, 'stageHpPct' | 'bossHpPct' | 'championHpPct' | 'uniqueHpPct'>, monsters: Record<string, MonsterDef>): number {
  return waveTotalHp({ ...wave, groups: wave.groups.filter((g) => !inPack(wave, g)) }, index, rules, monsters);
}

/**
 * Fits a wave's packs to its budget: its superunique and champion packs scale their members'
 * count and every member's and leader's HP, by one percent, so the wave's total stays within
 * packBudget.regularMaxPct of its target (bossMaxPct for a boss wave). The target itself, the
 * stream or the boss, is never cut. Mutates the wave; returns its total after.
 */
export function fitPacks(
  wave: WaveDef,
  index: number,
  balance: BalanceJson,
  rules: Pick<Rules, 'stageHpPct' | 'bossHpPct' | 'championHpPct' | 'uniqueHpPct'>,
  monsters: Record<string, MonsterDef>,
): number {
  const total = waveTotalHp(wave, index, rules, monsters);
  const target = waveTargetHp(wave, index, rules, monsters);
  const cap = idiv(target * (wave.final ? balance.packBudget.bossMaxPct : balance.packBudget.regularMaxPct), 100);
  const packHp = total - target;
  if (total <= cap || packHp <= 0) return total;
  const pct = Math.max(1, Math.min(100, Math.floor(((cap - target) * 100) / packHp)));
  for (const g of wave.groups) {
    if (!inPack(wave, g)) continue;
    // A superunique leader keeps its place at less HP; members come fewer and weaker; a
    // champion pack keeps at least one champion
    if (g.rank === 'champion') g.count = Math.max(1, idiv(g.count * pct, 100));
    else if (g.rank !== 'unique') g.count = idiv(g.count * pct, 100);
    g.hpPct = pct;
  }
  wave.groups = wave.groups.filter((g) => g.count > 0);
  // Rounding a champion pack up to one can leave it over: its HP comes down the rest of the way
  let after = waveTotalHp(wave, index, rules, monsters);
  if (after > cap) {
    const left = waveTotalHp({ ...wave, groups: wave.groups.filter((g) => inPack(wave, g)) }, index, rules, monsters);
    if (left > 0) {
      const extra = Math.max(1, Math.floor(((cap - target) * 100) / left));
      for (const g of wave.groups) if (inPack(wave, g)) g.hpPct = Math.max(1, idiv((g.hpPct ?? 100) * extra, 100));
      after = waveTotalHp(wave, index, rules, monsters);
    }
  }
  return after;
}

export function bossHpPctFrom(balance: BalanceJson, waves: WaveDef[]): Record<number, number> {
  const bosses = waves.map((w, i) => (w.final ? i : -1)).filter((i) => i >= 0);
  const first = bosses[0] ?? 0;
  const span = Math.max(1, (bosses.at(-1) ?? 0) - first);
  const { first: lo, last: hi } = balance.bossHpPct;
  return Object.fromEntries(bosses.map((i) => [i, lo + idiv((hi - lo) * (i - first), span)]));
}

/** "Normal Act 2": a stage's name. */
export function stageName(difficulty: number, act: number): string {
  return `${DIFFICULTY_NAMES[difficulty]} Act ${act}`;
}

/** "Hell Act 3 2/5", or "Endless Tier 2 4/10" past Hell Baal: where a wave stands in the run. */
export function waveLabel(wave: WaveDef): string {
  return wave.tier ? `Endless Tier ${wave.tier} ${wave.actWave}/${wave.actWaves}` : `${stageName(wave.difficulty, wave.act)} ${wave.actWave}/${wave.actWaves}`;
}

/** Levels bought past a ladder's top: their price curve and what each adds. */
export interface OverLevels {
  costBase: number;
  costPctPerLevel: number;
  skillLevelsPerLevel: number;
}

export function economyFrom(balance: BalanceJson): Economy {
  const steps = compound(balance.levelCostPctPerLevel, MAX_TOWER_LEVEL - 1);
  return {
    startingGold: balance.startingGold,
    buildCost: balance.buildCost,
    levelCosts: balance.levelCostBase.map((base) => steps.map((permille) => idiv(base * permille, 1000))),
    tierCosts: balance.tierCosts,
    evolveCost: balance.evolveCost,
    evolutionReach: { levels: balance.evolution?.reachLevels ?? 0, perLevel: balance.evolution?.reachLevelsPerLevel ?? 0 },
    legend: balance.legend,
    evolvedLevels: balance.evolvedLevels,
    lineLevels: balance.levelCostBase.map((base, i) => {
      const last = idiv(base * steps.at(-1)!, 1000);
      const pct = balance.lineLevels.costPctPerLevel[i]!;
      return { costBase: idiv(last * pct, 100), costPctPerLevel: pct, skillLevelsPerLevel: balance.lineLevels.skillLevelsPerLevel[i]! };
    }),
    sellRefundPct: balance.sellRefundPct,
    bountyPerLevel: balance.bountyPerLevel,
    rankBountyMultiplier: balance.rankBountyMultiplier,
    bossBountyMultiplier: balance.bossBountyMultiplier,
    firstWaveTicks: balance.firstWaveTicks,
    waveTicks: balance.waves.intervalTicks,
    earlySendGoldPerTenLevels: balance.earlySendGoldPerTenLevels,
  };
}

export function rulesFrom(tables: Tables, balance: BalanceJson): Rules {
  const mods = {} as Rules['mods'];
  for (const mod of MONSTER_MODS) {
    const m = balance.monsterMods[mod];
    const resist = DIFFICULTIES.map((d): ModResist => {
      const over = m.byDifficulty?.[d];
      return { add: over?.resist ?? m.resist ?? {}, maxResist: over?.maxResist, championResist: over?.championResist };
    });
    mods[mod] = { speedPct: m.speedPct ?? 0, damagePct: m.damagePct ?? 0, resist };
  }
  return {
    aliveLimit: balance.aliveLimit,
    aliveWeight: balance.aliveWeight,
    chillPct: balance.chillPct,
    staticFloorPct: balance.staticFloorPct,
    corpseLifetimeTicks: balance.corpseLifetimeTicks,
    monsterAttackTicks: balance.monsterAttackTicks,
    blockRangeUnits: idiv(balance.blockRangeTenths * UNITS_PER_TILE, 10),
    blockBreakTicks: balance.blockBreakTicks,
    championHpPct: monumodConstant(tables, 'Champion HP % Bonus'),
    uniqueHpPct: monumodConstant(tables, 'Unique HP % Bonus'),
    championDamagePct: monumodConstant(tables, 'Champion Damage % Bonus'),
    bossHpPct: {},
    stageHpPct: {},
    mods,
  };
}

export function resolveSkill(
  tables: Tables,
  json: SkillJson,
  design: DesignData,
  weapon: string | undefined,
  skillLevels: number[] | undefined = json.skillLevels,
  reachOffset = 0,
): SkillDef {
  const archetype = ARCHETYPES[json.archetype];
  if (!archetype) throw new Error(`${json.id}: unknown archetype ${json.archetype}`);
  if (!skillLevels) throw new Error(`${json.id}: no skillLevels and no tier ladder`);
  return archetype.resolve(
    { ...json, skillLevels },
    {
      tables,
      skillRow: findRow(tables.skills, 'skill', json.skill),
      weapon,
      auraRangePerTile: design.balance.auraRangePerTile,
      reach: design.balance.reach,
      reachOffset,
      filterOverride: design.balance.skillOverrides[json.id],
    },
  );
}

/** One computed tier ladder, kept for reports. */
export interface Ladder {
  cls: string;
  line: string;
  tier: number;
  skill: string;
  /** 'dps' for attack skills, 'aura' for the reference-neighbour multiplier. */
  metric: 'dps' | 'aura';
  /** skills.txt levels for tower levels 1 to 5. */
  levels: number[];
  /** The previous tier's best value at its top level, and this tier's value at its level 1. */
  previous: number;
  start: number;
  /** False when no level up to the cap reached the floor and a tierBonus was needed. */
  reached: boolean;
  /** False for skills with no standard-target number (summons, corpses, pulses): they climb 1 to the cap. */
  measured: boolean;
  /** Per mille; 1000 unless the skill needed a bonus to reach the floor. */
  tierBonus: number;
}

export interface BuildOptions {
  /** Check skill JSON tierBonus values against the computed ones (default true). */
  checkTierBonus?: boolean;
  /** False builds the waves as the content writes them, packs unfitted to their budget (tests of their makeup). */
  smooth?: boolean;
}

/** An act's level floor on a difficulty: `pct` percentile of its areas' MonLvlEx in levels.txt. */
export function actFloorFrom(tables: Tables, pct: number): (act: number, difficulty: number) => number {
  const columns = ['MonLvlEx', 'MonLvlEx(N)', 'MonLvlEx(H)'];
  return (act, difficulty) => {
    const values = tables.levels
      .filter((r) => int(r, 'Act') === act - 1 && str(r, 'mon1') !== '')
      .map((r) => int(r, columns[difficulty]!))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (values.length === 0) throw new Error(`levels.txt has no Act ${act} areas with monsters`);
    return values[idiv((values.length - 1) * pct, 100)]!;
  };
}

/**
 * Tier ladders. A T2 or T3 skill starts at the lowest skills.txt level whose value is at
 * least dpsPct of the strongest tower it can replace (the previous tier's options at their
 * top level), then climbs to the tier's cap in five equal steps. Value is standard DPS for
 * attack skills and the reference-neighbour multiplier for auras (see dps.ts). A skill
 * that cannot reach the floor by its cap climbs cap-4 to cap instead, with a flat
 * tierBonus that lifts its level 1 to the floor; the bonus is stored in the skill JSON and
 * must match what the data needs. Debuffs never take a bonus: their values are skills.txt's
 * own, so a resistance cut stays one the game could cast (an unreached floor still climbs
 * cap-4 to cap).
 */
function buildLadders(
  tables: Tables,
  design: DesignData,
  skills: Record<string, SkillDef>,
  jsonById: Map<string, SkillJson>,
  weaponFor: (id: string) => string | undefined,
  checkTierBonus: boolean,
): Ladder[] {
  const { dpsPct, auraPct, caps, referenceSkill, debuffTargetResist } = design.balance.tierLadder;
  const reference = skills[referenceSkill];
  if (!reference) throw new Error(`tierLadder referenceSkill ${referenceSkill} is not a T1 or non-class skill`);
  const top = MAX_TOWER_LEVEL - 1;
  const ladders: Ladder[] = [];
  for (const c of design.classes) {
    for (const [lineId, line] of Object.entries(c.lines)) {
      for (let t = 1; t < line.tiers.length; t++) {
        const tier = t + 1;
        const cap = caps[String(tier)];
        const attackPct = dpsPct[String(tier)];
        if (cap === undefined || attackPct === undefined) throw new Error(`balance.json tierLadder has no cap or dpsPct for T${tier}`);
        const before = line.tiers[t - 1]!.map((id) => skills[id]!);
        for (const id of line.tiers[t]!) {
          const json = jsonById.get(id)!;
          if (json.skillLevels) throw new Error(`${id}: T${tier} skills get a computed ladder; remove skillLevels`);
          const resolveAt = (levels: number[]) => resolveSkill(tables, json, design, weaponFor(id), levels);
          const probe = resolveAt(Array(MAX_TOWER_LEVEL).fill(1));
          // Compare like with like: auras against auras, attacks against attacks
          const metric: Ladder['metric'] = isAura(probe) && before.every(isAura) ? 'aura' : 'dps';
          const value = (s: SkillDef, lvl: number) =>
            metric === 'aura' ? auraMultiplier(s, lvl, reference, debuffTargetResist) : standardDps(s, lvl);
          const previous = Math.max(...before.map((s) => value(s, top)));
          const pct = metric === 'aura' ? auraPct : attackPct;
          const floor = Math.ceil((previous * pct) / 100);

          // Summons, corpse skills and pulses have no standard-target number; they climb
          // the whole range, as does anything replacing a tier that had none
          // An aura whose effect the reference neighbour does not feel (Shout's defence for
          // summons) has no number either: x1.000 at its cap
          const measurable = value(resolveAt(Array(MAX_TOWER_LEVEL).fill(cap)), 0) > (metric === 'aura' ? 1000 : 0);
          let start = 0;
          for (let level = 1; level <= cap && previous > 0 && measurable; level++) {
            if (value(resolveAt(Array(MAX_TOWER_LEVEL).fill(level)), 0) >= floor) {
              start = level;
              break;
            }
          }
          if (previous === 0 || !measurable) start = 1;
          const reached = start > 0;
          // Five equal steps to the cap; an unreachable floor climbs cap-4 to cap instead
          const levels = reached
            ? Array.from({ length: MAX_TOWER_LEVEL }, (_, i) => start + idiv(i * (cap - start) + 2, 4))
            : Array.from({ length: MAX_TOWER_LEVEL }, (_, i) => cap - (MAX_TOWER_LEVEL - 1) + i);
          const base = resolveAt(levels);

          let tierBonus = 1000;
          if (!measurable && metric === 'dps' && ['summon', 'corpse', 'control'].includes(json.archetype)) {
            // No standard number to climb to: the top tier's extra jump over T2's, flat
            tierBonus = Math.max(1000, idiv(1000 * attackPct, dpsPct['2'] ?? attackPct));
          } else if (!reached && json.archetype !== 'debuff') {
            // The lowest flat bonus that lifts level 1 to the floor
            let lo = 1000;
            let hi = 1000;
            while (value(withTierBonus(base, hi), 0) < floor) {
              hi *= 2;
              if (hi > 1 << 20) throw new Error(`${id}: no tierBonus reaches the T${tier} floor (the effect saturates)`);
            }
            while (lo < hi) {
              const mid = idiv(lo + hi, 2);
              if (value(withTierBonus(base, mid), 0) >= floor) hi = mid;
              else lo = mid + 1;
            }
            tierBonus = lo;
          }
          if (checkTierBonus && (json.tierBonus ?? 1000) !== tierBonus) {
            throw new Error(
              `${id}: tierBonus in its JSON is ${json.tierBonus ?? 'missing'}, the data needs ${tierBonus}. Run npm run ladders -- --write`,
            );
          }
          skills[id] = withTierBonus(base, tierBonus);
          ladders.push({ cls: c.id, line: lineId, tier, skill: id, metric, levels, previous, start: value(skills[id]!, 0), reached, measured: measurable, tierBonus });
        }
      }
    }
  }
  return ladders;
}

export function buildGameData(
  tables: Tables,
  design: DesignData,
  waveCount: number = Infinity,
  options: BuildOptions = {},
): GameData {
  // A skill takes the weapon of the class whose lines use it
  const weaponFor = (skillId: string) =>
    design.classes.find((c) => Object.values(c.lines).some((l) => l.tiers.flat().includes(skillId)))?.weapon;
  const jsonById = new Map(design.skills.map((s) => [s.id, s]));
  const laddered = new Set(design.classes.flatMap((c) => Object.values(c.lines).flatMap((l) => l.tiers.slice(1).flat())));
  const skills: Record<string, SkillDef> = {};
  for (const json of design.skills) {
    if (!laddered.has(json.id) && !json.castBy) skills[json.id] = resolveSkill(tables, json, design, weaponFor(json.id));
  }

  const classes: Record<string, ClassDef> = {};
  for (const c of design.classes) {
    for (const line of Object.values(c.lines)) {
      for (const id of line.tiers.flat()) if (!jsonById.has(id)) throw new Error(`${c.id}: no skill entry ${id}`);
    }
    classes[c.id] = { id: c.id, name: c.name, lines: c.lines };
  }
  const ladders = buildLadders(tables, design, skills, jsonById, weaponFor, options.checkTierBonus ?? true);
  // Skills no tower picks, cast by another (trap shots, charges): at their caster's levels
  for (const json of design.skills) {
    if (!json.castBy) continue;
    const caster = skills[json.castBy];
    if (!caster) throw new Error(`${json.id}: castBy ${json.castBy} is no skill`);
    const casterLadder = ladders.find((l) => l.skill === json.castBy);
    const def = resolveSkill(tables, json, design, weaponFor(json.castBy), caster.skillLevels);
    skills[json.id] = casterLadder ? withTierBonus(def, casterLadder.tierBonus) : def;
  }

  const evolutionPct = design.balance.evolution?.dpsPct ?? 250;
  const evolutions = Object.entries(design.evolutions).map(([id, e]) => {
    for (const skill of [e.attack.skill, e.partner.skill]) if (!skills[skill]) throw new Error(`${id}: no skill ${skill}`);
    // The evolved tower is the pair at their top levels (attack, partner's aura or curse, partner's casts),
    // its attack's delay dropped when the recipe says so; the bonus lifts that to the target over the pair.
    // Summon and corpse pairs have no standard number: they take the target as it stands.
    const top = MAX_TOWER_LEVEL - 1;
    const attack = skills[e.attack.skill]!;
    const partner = skills[e.partner.skill]!;
    const pair = pairValue(attack, partner, top);
    const evolved = pairValue(attack, partner, top, e.ignoreSkillDelay === true);
    const bonus = pair > 0 && evolved > 0 ? Math.max(1000, Math.ceil((pair * evolutionPct * 10) / evolved)) : evolutionPct * 10;
    return { id, name: e.name, attack: e.attack, partner: e.partner, ignoreSkillDelay: e.ignoreSkillDelay === true, bonus };
  });

  const m = design.monsters;
  const monsters: Record<string, MonsterDef> = {};
  const defOf: DefOf = (id, difficulty, level) => {
    const key = level === undefined ? variantId(id, difficulty) : levelVariantId(id, difficulty, level);
    return (monsters[key] ??= monsterDef(tables, m, id, design.balance.auraRangePerTile, difficulty, level, design.balance.stationaryVelocity, design.balance.runningMonTypes));
  };
  // Every monster of the roster at its own level on every difficulty (tests and tools look them up)
  const everyone = [
    ...Object.keys(m.roster),
    ...Object.values(m.roster).flatMap((r) => (r.party ? [r.party] : [])),
    ...Object.values(m.campaign).flatMap((byDifficulty) => Object.values(byDifficulty).flatMap((ws) => ws.flatMap((w) => ('monster' in w ? [w.monster] : [])))),
    ...[...m.superuniques, ...m.bosses].flatMap((b) => [b.id, ...(b.minion ? [b.minion] : [])]),
  ];
  for (let d = 0; d < DIFFICULTIES.length; d++) for (const id of new Set(everyone)) defOf(id, d);
  const levels = actFloorFrom(tables, design.balance.actFloorPercentile);
  const campaign = campaignWaves(design.balance, m, defOf, levels);
  const waves = campaign.slice(0, waveCount);
  const rules = {
    ...rulesFrom(tables, design.balance),
    bossHpPct: bossHpPctFrom(design.balance, waves),
    // Filled in once skill variants exist, below
    stageHpPct: {} as Record<string, number>,
  };
  // The run goes on past Hell Baal: endless waves are built as the run reaches them
  const extendWaves =
    waveCount === Infinity
      ? (upTo: number) => {
          while (waves.length < upTo) {
            const wave = endlessWave(design.balance, m, defOf, campaign.length, waves.length - campaign.length + 1);
            if (wave.final) rules.bossHpPct[waves.length] = design.balance.bossHpPct.last;
            if (smooth) fitPacks(wave, waves.length, design.balance, rules, monsters);
            waves.push(wave);
          }
        }
      : undefined;

  const skillVariant = (id: string, plus: number, weapon?: { min: number; max: number }, bonus = 1000, reach = 0) => {
    const key = `${id}+${plus}${weapon ? `@${weapon.min}-${weapon.max}` : ''}${bonus !== 1000 ? `*${bonus}` : ''}${reach ? `~${reach}` : ''}`;
    if (skills[key]) return key;
    const json = jsonById.get(id);
    if (!json) throw new Error(`No skill ${id} to raise`);
    const ladder = ladders.find((l) => l.skill === (json.castBy ?? id));
    const levels = (ladder?.levels ?? json.skillLevels ?? (json.castBy ? jsonById.get(json.castBy)?.skillLevels : undefined) ?? []).map((l) => l + plus);
    let def = resolveSkill(tables, json, design, weaponFor(id), levels, reach);
    // A worn weapon replaces the class weapon before the tier bonus, which multiplies whatever the tower swings
    if (weapon && def.archetype === 'melee') def = { ...def, weapon: { min: weapon.min * 256, max: weapon.max * 256 } };
    if (ladder) def = withTierBonus(def, ladder.tierBonus);
    def = withDamageBonus(def, bonus);
    skills[key] = { ...def, id: key };
    return key;
  };
  // The HP curve reads the evolved towers' attacks at their bought levels
  rules.stageHpPct = stageHpPctFrom(design.balance, campaign, monsters, design.classes, skills, evolutions, (id, plus, bonus) => skills[skillVariant(id, plus, undefined, bonus)]!).pct;
  // Then each wave's packs fit its budget over its own target (never another wave's)
  const smooth = options.smooth !== false;
  if (smooth) campaign.forEach((w, i) => fitPacks(w, i, design.balance, rules, monsters));
  const skillIds: Record<string, string> = {};
  for (const r of tables.skills) {
    const name = str(r, 'skill');
    const num = r['*Id'] ?? r['Id'];
    if (name && num !== undefined) skillIds[name] = String(num);
  }
  const pages = new Map(tables.skilldesc.map((r) => [str(r, 'skilldesc'), int(r, 'SkillPage')]));
  const skillTabs: Record<string, string> = {};
  for (const r of tables.skills) {
    const cls = SKILL_CLASSES.indexOf(str(r, 'charclass'));
    const page = pages.get(str(r, 'skilldesc')) ?? 0;
    if (cls >= 0 && page > 0) skillTabs[str(r, 'skill')] = String(cls * 3 + page - 1);
  }
  // Items name a skill by its skills.txt name ("Fire Ball") or its Id ("47", the affixes' way)
  const byName = new Map(design.skills.flatMap((s) => [[s.skill, s.id] as const, [skillIds[s.skill] ?? '', s.id] as const]));
  const itemSkill = (name: string, level: number) => {
    const id = name ? byName.get(name) : undefined;
    if (!id) return undefined;
    const lvl = Math.max(1, level);
    // '+n' so baseSkillId and skillPlus read it like any variant; '#item' keeps it apart from the tower ladders
    const key = `${id}+${lvl - 1}#item`;
    if (!skills[key]) skills[key] = { ...resolveSkill(tables, jsonById.get(id)!, design, weaponFor(id), Array<number>(MAX_TOWER_LEVEL).fill(lvl)), id: key };
    return key;
  };

  return {
    acts: m.acts,
    skills,
    classes,
    evolutions,
    legends: Object.entries(design.legends ?? {}).map(([id, l]) => ({ id, name: l.name, cls: l.class, monster: l.monster })),
    monsters,
    waves,
    ladders,
    economy: economyFrom(design.balance),
    rules,
    items: buildItemData(tables),
    drops: design.balance.drops,
    vendorCap: design.balance.vendorCap,
    implicitGear: design.balance.implicitGear,
    itemConversions: design.balance.itemConversions,
    itemProcs: design.balance.itemProcs,
    itemStunTicks: design.balance.itemStunTicks,
    itemQualityPct: design.balance.itemQualityPct,
    itemDurabilityDamagePct: design.balance.itemDurabilityDamagePct,
    cow: { ...m.cow, ...design.balance.cow },
    monsterVariant: (id: string, difficulty: number, level?: number) => defOf(id, difficulty, level).id,
    skillIds,
    skillTabs,
    skillVariant,
    itemSkill,
    ...(extendWaves ? { extendWaves } : {}),
  };
}
