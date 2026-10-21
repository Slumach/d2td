// Builds the sim's game data from the pipeline's tables plus our design data (skill
// entries, classes, evolutions, monsters, balance). Pure: no I/O, so the render layer,
// the tests and the balance harness all feed it.

import { ARCHETYPES } from './archetypes/index.ts';
import type { HitFilter, SkillDef, SkillJson } from './archetypes/types.ts';
import { auraMultiplier, isAura, standardDps, withTierBonus } from './dps.ts';
import { VELOCITY_TO_UNITS_PER_TICK, UNITS_PER_TILE, d2FramesToTicks, idiv } from './fixed.ts';
import { DIFFICULTIES, DIFFICULTY_NAMES, levelVariantId, variantId, type DifficultyName } from './difficulty.ts';
import { ELEMENTS, MONSTER_MODS, type Element, type MonsterMod, type Rank } from './state.ts';
import { createMap } from './map.ts';
import { findRow, int, monumodConstant, str, type TableRow, type Tables } from './tables.ts';

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
  /** Corpses of this monstats MonType can be raised (never other raisers). */
  monType: string;
  /** monstats AI parameter columns: percent chance per AI decision, and corpse search range. */
  chanceColumn: string;
  rangeColumn: string;
  /** monseq.txt sequence the raiser plays, standing still, before the corpse rises. */
  sequence: string;
}

/**
 * One wave of the schedule: a stream of one monster (swarms 1 s apart, tanks 1.5 s), with
 * a superunique's pack inside it when it names one, or an act boss behind its pack.
 */
export type WaveJson =
  | { monster: string; kind: 'swarm' | 'tank'; area?: string; superunique?: string }
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
  /** Monsters with an ability, by monstats id. */
  roster: Record<string, { resurrect?: ResurrectJson }>;
  /** The five acts; the run plays all of them on Normal, then Nightmare, then Hell. */
  acts: ActJson[];
  /** Act 1 on each difficulty: its waves in order, the last its act boss. */
  act1: Record<DifficultyName, WaveJson[]>;
  /** Acts 2 to 5 have no content yet: their waves cycle these Act 1 monsters at the act's own levels. */
  placeholder: { monster: string; kind: 'swarm' | 'tank' }[];
  /** Act 1's superuniques: each appears as the unique pack inside a wave. */
  superuniques: NamedJson[];
  /** Act bosses: each closes its act behind its pack. */
  bosses: NamedJson[];
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
  /** The stage each tier opens at, by tier: [difficulty, act]. T2 from Normal Act 2 and so on. */
  tierGates: Record<string, [number, number]>;
  /**
   * The placeholder acts' monster levels: the act's areas in levels.txt (MonLvlEx per
   * difficulty), from this low percentile on its first wave to this high one on its last.
   */
  placeholderLevelPercentiles: [number, number];
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
  /** Ticks between AI decisions (monstats aidel). */
  aiDelayTicks: number;
  resurrect?: { monType: string; chancePct: number; radiusUnits: number; castTicks: number };
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
}

export interface Economy {
  startingGold: number;
  buildCost: number;
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
  /** Per mod: its speed and damage, and its resistances by difficulty. */
  mods: Record<MonsterMod, { speedPct: number; damagePct: number; resist: ModResist[] }>;
}

/** A stage of the campaign: where a tier opens. */
export interface StageGate {
  difficulty: number;
  act: number;
  /** The run's wave number that starts it: the tier opens once that wave has started. */
  wave: number;
}

export interface GameData {
  /** The five acts, for the map and the HUD. */
  acts: ActJson[];
  /** Where each tier opens, by tier (2 to 5). */
  tierGates: Record<number, StageGate>;
  skills: Record<string, SkillDef>;
  classes: Record<string, ClassDef>;
  evolutions: EvolutionDef[];
  monsters: Record<string, MonsterDef>;
  waves: WaveDef[];
  ladders: Ladder[];
  economy: Economy;
  rules: Rules;
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
};

/** Midway through a min-max range of two table columns. */
const midway = (row: TableRow, min: string, max: string) => idiv(int(row, min) + int(row, max), 2);

/**
 * A monster's entry for one difficulty, from monstats (and superuniques.txt for a
 * superunique: its class's stats with its own name, mods and pack; its unique rank adds the
 * unique HP bonus when it spawns).
 */
export function monsterDef(tables: Tables, design: MonstersJson, id: string, auraRangePerTile: number, difficulty = 0, atLevel?: number): MonsterDef {
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
  // (its difficulty's Level column, or a placeholder act's level), at the difficulty's columns
  const level = atLevel ?? int(row, col('Level'));
  const lvlRow = findRow(tables.monlvl, 'Level', level);
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
  return {
    id: atLevel === undefined ? variantId(id, difficulty) : levelVariantId(id, difficulty, atLevel),
    base,
    difficulty,
    name: su ? str(su, 'Name') : str(row, 'NameStr') || id,
    ...(su ? { artVariant: `su_${id}` } : {}),
    flying: int(row, 'flying') === 1,
    mods,
    ...(minion ? { minion } : {}),
    monType: str(row, 'MonType'),
    level,
    minHp: hpOf(minCol!, 'minHP'),
    maxHp: hpOf(maxCol!, 'maxHP'),
    minDamage: pct(col('A1MinD'), lvlCol('DM')),
    maxDamage: pct(col('A1MaxD'), lvlCol('DM')),
    speed: int(row, 'Velocity') * VELOCITY_TO_UNITS_PER_TICK,
    resist,
    undead: int(row, 'lUndead') === 1 || int(row, 'hUndead') === 1,
    demon: int(row, 'demon') === 1,
    aiDelayTicks: Math.max(1, d2FramesToTicks(int(row, col('aidel')))),
    resurrect: resurrect && {
      monType: resurrect.monType,
      chancePct: int(row, resurrect.chanceColumn),
      radiusUnits: idiv(int(row, resurrect.rangeColumn) * UNITS_PER_TILE, auraRangePerTile),
      // The sequence plays at 25 fps, one row per frame
      castTicks: Math.max(1, d2FramesToTicks(tables.monseq.filter((r) => r['sequence'] === resurrect.sequence).length)),
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
 * act's last wave its act boss. Act 1's waves are its own on each difficulty; Acts 2 to 5
 * have no content yet, so their waves cycle the placeholder monsters at the act's own levels
 * (`actLevels`) and end on that difficulty's Act 1 boss.
 *
 * A wave is a stream of one monster for waves.streamTicks: swarms a monster a second, tanks
 * one every 1.5 s. A superunique's pack (it, and its minions) walks in the middle of its
 * wave as the wave's unique, and so does each act's champion pack (the wave's own monster),
 * in its last wave before the boss. An act boss's wave is its pack, then the boss. Every
 * special's mods come from its table row and the schedule, with the difficulty's additions
 * and the immune-over-resistant rule.
 */
export function campaignWaves(
  balance: BalanceJson,
  monsters: MonstersJson,
  defOf: DefOf,
  actLevels: (act: number, difficulty: number) => [number, number],
): WaveDef[] {
  const w = balance.waves;
  const schedule = balance.modSchedule;
  const waves: WaveDef[] = [];
  let number = 0;
  for (let d = 0; d < DIFFICULTIES.length; d++) {
    const added = schedule.added[DIFFICULTIES[d]!] ?? {};
    const act1 = monsters.act1[DIFFICULTIES[d]!];
    const boss = act1.at(-1);
    if (!boss || !('boss' in boss)) throw new Error(`monsters.json act1.${DIFFICULTIES[d]} must end on its act boss`);
    if (act1.length !== monsters.acts[0]!.waves) throw new Error(`monsters.json act1.${DIFFICULTIES[d]} has ${act1.length} waves, Act 1 ${monsters.acts[0]!.waves}`);
    // The placeholder cycle starts at a different monster on each difficulty
    let cursor = d * 5;
    // A named monster's mods: its table's, Normal's schedule, the difficulty's on top, resolved
    const namedMods = (id: string, own: MonsterMod[]) => resolveMods(balance, [...own, ...(schedule.named[id] ?? []), ...(added.named?.[id] ?? [])]);
    /** A named monster and its pack, as groups `spacing` apart. */
    const pack = (id: string, rank: Rank, spacing: number, level?: number): WaveGroup[] => {
      const def = defOf(id, d, level);
      const out: WaveGroup[] = [];
      if (def.minion) out.push({ monster: defOf(def.minion.monster, d, level).id, count: def.minion.count, spacingTicks: spacing, rank: 'normal', mods: [] });
      out.push({ monster: def.id, count: 1, spacingTicks: spacing, rank, mods: namedMods(id, def.mods) });
      return out;
    };

    monsters.acts.forEach((act, a) => {
      const n = act.waves;
      const [lo, hi] = a === 0 ? [0, 0] : actLevels(a + 1, d);
      for (let i = 0; i < n; i++) {
        number++;
        // Act 1's own wave, or a placeholder: the cycle's next monster, the boss last
        const entry: WaveJson = a === 0 ? act1[i]! : i === n - 1 ? boss : monsters.placeholder[cursor++ % monsters.placeholder.length]!;
        const level = a === 0 ? undefined : lo + idiv((hi - lo) * i, Math.max(1, n - 1));
        let groups: WaveGroup[];
        let kind: WaveDef['kind'];
        let lead: MonsterDef;
        if ('boss' in entry) {
          kind = 'boss';
          groups = pack(entry.boss, 'boss', w.swarm.spacingTicks, level);
          lead = defOf(entry.boss, d, level);
        } else {
          kind = entry.kind;
          const spacing = w[kind].spacingTicks;
          lead = defOf(entry.monster, d, level);
          const monster = lead.id;
          const size = Math.max(1, idiv(w.streamTicks, spacing));
          const half = idiv(size, 2);
          const specials: WaveGroup[] = [];
          if (entry.superunique) specials.push(...pack(entry.superunique, 'unique', spacing, level));
          if (i === n - 2) {
            const mods = resolveMods(balance, [...(schedule.champions[String(a + 1)] ?? []), ...(added.champions ?? [])]);
            specials.push({ monster, count: w.championPackSize, spacingTicks: spacing, rank: 'champion', mods });
          }
          const stream = (c: number): WaveGroup => ({ monster, count: c, spacingTicks: spacing, rank: 'normal', mods: [] });
          groups = [stream(half), ...specials, stream(size - half)].filter((g) => g.count > 0);
        }
        waves.push({
          kind,
          area: entry.area ?? `${a === 0 ? '' : 'placeholder: '}${i === n - 1 ? act.lair : act.field}`,
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

/** Where each tier opens: balance.json tierGates as the run's wave that starts each stage. */
export function tierGatesFrom(balance: BalanceJson, monsters: MonstersJson): Record<number, StageGate> {
  const perDifficulty = monsters.acts.reduce((n, a) => n + a.waves, 0);
  const out: Record<number, StageGate> = {};
  for (const [tier, [difficulty, act]] of Object.entries(balance.tierGates)) {
    const before = monsters.acts.slice(0, act - 1).reduce((n, a) => n + a.waves, 0);
    out[Number(tier)] = { difficulty, act, wave: difficulty * perDifficulty + before + 1 };
  }
  return out;
}

/** "Normal Act 2": a stage's name. */
export function stageName(difficulty: number, act: number): string {
  return `${DIFFICULTY_NAMES[difficulty]} Act ${act}`;
}

export function economyFrom(balance: BalanceJson): Economy {
  const steps = compound(balance.levelCostPctPerLevel, MAX_TOWER_LEVEL - 1);
  return {
    startingGold: balance.startingGold,
    buildCost: balance.buildCost,
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

/**
 * Each act's level range per difficulty, from levels.txt: the MonLvlEx column of the act's
 * areas that have monsters, from the low percentile to the high one.
 */
export function actLevelsFrom(tables: Tables, [lowPct, highPct]: [number, number]): (act: number, difficulty: number) => [number, number] {
  const columns = ['MonLvlEx', 'MonLvlEx(N)', 'MonLvlEx(H)'];
  return (act, difficulty) => {
    const values = tables.levels
      .filter((r) => int(r, 'Act') === act - 1 && str(r, 'mon1') !== '')
      .map((r) => int(r, columns[difficulty]!))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    if (values.length === 0) throw new Error(`levels.txt has no Act ${act} areas with monsters`);
    const at = (pct: number) => values[idiv((values.length - 1) * pct, 100)]!;
    return [at(lowPct), at(highPct)];
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
    return (monsters[key] ??= monsterDef(tables, m, id, design.balance.auraRangePerTile, difficulty, level));
  };
  // Every monster of the roster at its own level on every difficulty (tests and tools look them up)
  const everyone = [
    ...Object.keys(m.roster),
    ...Object.values(m.act1).flatMap((ws) => ws.flatMap((w) => ('monster' in w ? [w.monster] : []))),
    ...m.placeholder.map((p) => p.monster),
    ...[...m.superuniques, ...m.bosses].flatMap((b) => [b.id, ...(b.minion ? [b.minion] : [])]),
  ];
  for (let d = 0; d < DIFFICULTIES.length; d++) for (const id of new Set(everyone)) defOf(id, d);
  const levels = actLevelsFrom(tables, design.balance.placeholderLevelPercentiles);
  const waves = campaignWaves(design.balance, m, defOf, levels).slice(0, waveCount);

  return {
    acts: m.acts,
    tierGates: tierGatesFrom(design.balance, m),
    skills,
    classes,
    evolutions,
    monsters,
    waves,
    ladders,
    economy: economyFrom(design.balance),
    rules: rulesFrom(tables, design.balance),
  };
}
