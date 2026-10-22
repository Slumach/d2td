// Builds the sim's game data from the pipeline's tables plus our design data (skill
// entries, classes, evolutions, monsters, balance). Pure: no I/O, so the render layer,
// the tests and the balance harness all feed it.

import { ARCHETYPES } from './archetypes/index.ts';
import type { HitFilter, SkillDef, SkillJson } from './archetypes/types.ts';
import { auraMultiplier, isAura, standardDps, withTierBonus } from './dps.ts';
import { VELOCITY_TO_UNITS_PER_TICK, UNITS_PER_TILE, compoundPct, d2FramesToTicks, idiv } from './fixed.ts';
import { DIFFICULTIES, DIFFICULTY_NAMES, levelVariantId, variantId, type DifficultyName } from './difficulty.ts';
import { ELEMENTS, MONSTER_MODS, type Element, type MonsterMod, type Rank } from './state.ts';
import { createMap } from './map.ts';
import { findRow, int, monumodConstant, str, type TableRow, type Tables } from './tables.ts';
import { buildItemData, type ItemData } from './items/data.ts';

export type { TableRow, Tables } from './tables.ts';

export { DIFFICULTIES, DIFFICULTY_NAMES, baseMonsterId, levelVariantId, variantId, type DifficultyName } from './difficulty.ts';

export const MAX_TOWER_LEVEL = 5;
export const MAX_TIER = 3;
/** Evolved towers attack at this tower level index: T3 level 5 power. */
export const EVOLVED_LEVEL_INDEX = MAX_TOWER_LEVEL - 1;

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
  | { boss: string; area?: string };

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
  buildCost: number;
  /**
   * Each tower a player owns multiplies the price of their next build by this percent: the
   * first costs buildCost, the second buildCost x pct / 100, and so on. It is the only brake
   * on the number of towers.
   */
  buildCostGrowthPct: number;
  /**
   * An act boss's HP is this percent of its monstats HP, climbing in a straight line by wave
   * number from `first` on the run's first boss wave to `last` on its last campaign boss
   * wave: early bosses are easier than the tables, late ones harder.
   */
  bossHpPct: { first: number; last: number };
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
  cow: CowRules;
  /** Cost of the first level-up at T1, T2, T3. */
  levelCostBase: number[];
  /** Each further level-up within a tier costs this percent of the previous one. */
  levelCostPctPerLevel: number;
  /** Cost to reach T2 and T3. */
  tierCosts: number[];
  evolveCost: number;
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
   * Tier ladders: a tier must reach dpsPct of the tower it replaces; caps by tier. Auras
   * are valued by the multiplier they give a level-5 referenceSkill tower.
   */
  tierLadder: { dpsPct: number; caps: Record<string, number>; referenceSkill: string; debuffTargetResist: number };
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
  monsters: MonstersJson;
  balance: BalanceJson;
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
  buildCostGrowthPct: number;
  /** levelCosts[tier - 1][n] is the gold to go from level n + 1 to n + 2 in that tier. */
  levelCosts: number[][];
  /** tierCosts[0] reaches T2, tierCosts[1] reaches T3. */
  tierCosts: number[];
  evolveCost: number;
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
  /** skills.txt skill name to its Id, for items that name a skill by number. */
  skillIds: Record<string, string>;
  /**
   * A skill as a geared tower casts it: its skills.txt levels raised by `plus`, and a melee
   * skill swinging `weapon` (whole HP). Built once and kept in `skills` under the returned
   * id, so missiles and curses look it up like any skill.
   */
  skillVariant: (id: string, plus: number, weapon?: { min: number; max: number }) => string;
}

export interface VendorCap {
  /** Normal, Nightmare, Hell: the cap in Act 1 and in Act 5, in a straight line between by act. */
  byDifficulty: [number, number][];
  /** Each endless Tier raises Hell's cap by this percent, compounding. */
  tierPct: number;
}

export interface DropRules {
  /** Weight of rune entries in a treasure class, percent of D2R's (125: a quarter more runes). */
  runeMultiplierPct: number;
  /** Each endless Tier multiplies the drop rate by this percent more, compounding (shrinks NoDrop). */
  tierDropPct: number;
  /** Smith's Hammer's chance per kill, parts per million, before Tier scaling. */
  smithsHammerPpm: number;
}

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
 * monlvl.txt's row for a level; past its last row (110) every number climbs on in a straight
 * line from the last two rows, which is how the endless Tiers keep scaling.
 */
function monlvlRow(tables: Tables, level: number): TableRow {
  const rows = tables.monlvl;
  const top = rows.reduce((n, r) => Math.max(n, int(r, 'Level')), 0);
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
export function monsterDef(tables: Tables, design: MonstersJson, id: string, auraRangePerTile: number, difficulty = 0, atLevel?: number, stationaryVelocity = 3): MonsterDef {
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
    speed: (int(row, 'Velocity') || stationaryVelocity) * VELOCITY_TO_UNITS_PER_TICK,
    resist,
    undead: int(row, 'lUndead') === 1 || int(row, 'hUndead') === 1,
    demon: int(row, 'demon') === 1,
    attackRating: idiv(int(row, col('A1TH')) * int(lvlRow, lvlCol('TH')), 100),
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
    return { kind: 'boss', groups: pack(entry.boss, 'boss', w.swarm.spacingTicks), lead: defOf(entry.boss, d, levelOf(entry.boss)) };
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

export function economyFrom(balance: BalanceJson): Economy {
  const steps = compound(balance.levelCostPctPerLevel, MAX_TOWER_LEVEL - 1);
  return {
    startingGold: balance.startingGold,
    buildCost: balance.buildCost,
    buildCostGrowthPct: balance.buildCostGrowthPct,
    levelCosts: balance.levelCostBase.map((base) => steps.map((permille) => idiv(base * permille, 1000))),
    tierCosts: balance.tierCosts,
    evolveCost: balance.evolveCost,
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
    mods,
  };
}

export function resolveSkill(
  tables: Tables,
  json: SkillJson,
  design: DesignData,
  weapon: string | undefined,
  skillLevels: number[] | undefined = json.skillLevels,
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
  const { dpsPct, caps, referenceSkill, debuffTargetResist } = design.balance.tierLadder;
  const reference = skills[referenceSkill];
  if (!reference) throw new Error(`tierLadder referenceSkill ${referenceSkill} is not a T1 or non-class skill`);
  const top = MAX_TOWER_LEVEL - 1;
  const ladders: Ladder[] = [];
  for (const c of design.classes) {
    for (const [lineId, line] of Object.entries(c.lines)) {
      for (let t = 1; t < line.tiers.length; t++) {
        const tier = t + 1;
        const cap = caps[String(tier)];
        if (cap === undefined) throw new Error(`balance.json tierLadder has no cap for T${tier}`);
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
          const floor = Math.ceil((previous * dpsPct) / 100);

          // Summons, corpse skills and pulses have no standard-target number; they climb
          // the whole range, as does anything replacing a tier that had none
          const measurable = value(resolveAt(Array(MAX_TOWER_LEVEL).fill(cap)), 0) > 0;
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
          if (!reached && json.archetype !== 'debuff') {
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
    if (!laddered.has(json.id)) skills[json.id] = resolveSkill(tables, json, design, weaponFor(json.id));
  }

  const classes: Record<string, ClassDef> = {};
  for (const c of design.classes) {
    for (const line of Object.values(c.lines)) {
      for (const id of line.tiers.flat()) if (!jsonById.has(id)) throw new Error(`${c.id}: no skill entry ${id}`);
    }
    classes[c.id] = { id: c.id, name: c.name, lines: c.lines };
  }
  const ladders = buildLadders(tables, design, skills, jsonById, weaponFor, options.checkTierBonus ?? true);

  const evolutions = Object.entries(design.evolutions).map(([id, e]) => {
    for (const skill of [e.attack.skill, e.partner.skill]) if (!skills[skill]) throw new Error(`${id}: no skill ${skill}`);
    return { id, name: e.name, attack: e.attack, partner: e.partner, ignoreSkillDelay: e.ignoreSkillDelay === true };
  });

  const m = design.monsters;
  const monsters: Record<string, MonsterDef> = {};
  const defOf: DefOf = (id, difficulty, level) => {
    const key = level === undefined ? variantId(id, difficulty) : levelVariantId(id, difficulty, level);
    return (monsters[key] ??= monsterDef(tables, m, id, design.balance.auraRangePerTile, difficulty, level, design.balance.stationaryVelocity));
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
  const rules = { ...rulesFrom(tables, design.balance), bossHpPct: bossHpPctFrom(design.balance, waves) };
  // The run goes on past Hell Baal: endless waves are built as the run reaches them
  const extendWaves =
    waveCount === Infinity
      ? (upTo: number) => {
          while (waves.length < upTo) {
            const wave = endlessWave(design.balance, m, defOf, campaign.length, waves.length - campaign.length + 1);
            if (wave.final) rules.bossHpPct[waves.length] = design.balance.bossHpPct.last;
            waves.push(wave);
          }
        }
      : undefined;

  const skillVariant = (id: string, plus: number, weapon?: { min: number; max: number }) => {
    const key = `${id}+${plus}${weapon ? `@${weapon.min}-${weapon.max}` : ''}`;
    if (skills[key]) return key;
    const json = jsonById.get(id);
    if (!json) throw new Error(`No skill ${id} to raise`);
    const ladder = ladders.find((l) => l.skill === id);
    const levels = (ladder?.levels ?? json.skillLevels ?? []).map((l) => l + plus);
    let def = resolveSkill(tables, json, design, weaponFor(id), levels);
    if (ladder) def = withTierBonus(def, ladder.tierBonus);
    if (weapon && def.archetype === 'melee') def = { ...def, weapon: { min: weapon.min * 256, max: weapon.max * 256 } };
    skills[key] = { ...def, id: key };
    return key;
  };
  const skillIds: Record<string, string> = {};
  for (const r of tables.skills) {
    const name = str(r, 'skill');
    const num = r['*Id'] ?? r['Id'];
    if (name && num !== undefined) skillIds[name] = String(num);
  }

  return {
    acts: m.acts,
    skills,
    classes,
    evolutions,
    monsters,
    waves,
    ladders,
    economy: economyFrom(design.balance),
    rules,
    items: buildItemData(tables),
    drops: design.balance.drops,
    vendorCap: design.balance.vendorCap,
    cow: { ...m.cow, ...design.balance.cow },
    monsterVariant: (id: string, difficulty: number, level?: number) => defOf(id, difficulty, level).id,
    skillIds,
    skillVariant,
    ...(extendWaves ? { extendWaves } : {}),
  };
}
