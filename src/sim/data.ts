// Builds the sim's game data from the pipeline's tables plus our design data (skill
// entries, classes, evolutions, monsters, balance). Pure: no I/O, so the render layer,
// the tests and the balance harness all feed it.

import { ARCHETYPES } from './archetypes/index.ts';
import type { HitFilter, SkillDef, SkillJson } from './archetypes/types.ts';
import { auraMultiplier, isAura, standardDps, withTierBonus } from './dps.ts';
import { VELOCITY_TO_UNITS_PER_TICK, UNITS_PER_TILE, d2FramesToTicks, idiv } from './fixed.ts';
import { DIFFICULTIES, variantId, type DifficultyName } from './difficulty.ts';
import { ELEMENTS, MONSTER_MODS, type Element, type MonsterMod, type Rank } from './state.ts';
import { createMap } from './map.ts';
import { findRow, int, monumodConstant, str, type TableRow, type Tables } from './tables.ts';

export type { TableRow, Tables } from './tables.ts';

export { DIFFICULTIES, DIFFICULTY_NAMES, baseMonsterId, variantId, type DifficultyName } from './difficulty.ts';

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

/** One normal wave of the Act 1 schedule: its monster, how it comes, and where D2 has it. */
export interface WaveJson {
  monster: string;
  kind: 'swarm' | 'tank';
  area: string;
}

/**
 * A boss of the schedule, in campaign order (the last one closes the act). A superunique
 * names its superuniques.txt row; `class` and `minion` repeat what the tables say (the
 * monstats class and its minion1, or the class itself) so the renderer knows what art to
 * load, and the build checks them against the tables.
 */
export interface BossJson {
  id: string;
  superunique?: string;
  class: string;
  minion?: string;
  area: string;
}

export interface MonstersJson {
  /** Monsters with an ability, by monstats id. */
  roster: Record<string, { resurrect?: ResurrectJson }>;
  waves: WaveJson[];
  bosses: BossJson[];
}

interface WaveKindJson {
  /** Normal monsters in wave n: min(cap, base + floor(n / addEvery)). */
  base: number;
  addEvery: number;
  cap: number;
  /** Ticks between monsters; for a swarm, between monsters of one pack. */
  spacingTicks: number;
  /**
   * Swarms come in packs, as D2's Fallen do: sizes cycle from min to max, and gapTicks
   * pass from one pack's last monster to the next pack's first.
   */
  pack?: { min: number; max: number; gapTicks: number };
}

interface ModScheduleJson {
  champions: Record<string, MonsterMod[]>;
  uniques: Record<string, MonsterMod[]>;
  bosses: Record<string, MonsterMod[]>;
}

/** src/data/balance.json. Multipliers are integer percents so the sim stays integer. */
export interface BalanceJson {
  startingGold: number;
  lives: number;
  /** Lives a leaked monster costs by rank; bossLeakCost overrides a boss by id, where "all" ends the run. */
  leakCost: Record<Rank, number>;
  bossLeakCost: Record<string, number | 'all'>;
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
  /** Compounding per wave after the first. */
  bountyPctPerWave: number;
  hpPctPerWave: number;
  waveClearBonusPct: number;
  earlyCallBonusPct: number;
  /**
   * Multiplayer wave clock: waves start in every lane together, when every player has
   * pressed Call Wave or when the clock runs out, whichever is first.
   */
  multiplayer: { firstWaveTicks: number; waveGapTicks: number };
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
    count: number;
    /**
     * The act's bosses but the last are spread evenly over these waves, in campaign order;
     * the last boss closes the act on its final wave.
     */
    bossWaves: { first: number; last: number };
    championPackSize: number;
    /**
     * A short wave grows past its base count, one monster at a time up to the cap, until its
     * stream plus the slowest monster's walk down the path lasts this long. Slow waves keep
     * their base count; fast swarms get more monsters.
     */
    targetTicks: number;
    swarm: WaveKindJson;
    tank: WaveKindJson;
  };
  /**
   * The fixed specials, keyed by wave number: champion packs and uniques with their mods,
   * and the mods each wave's boss carries. `added` holds the mods Nightmare and Hell put on
   * top: Hell's immunities and Nightmare's resistant versions of them. Rolled mods return
   * with Random mode.
   */
  modSchedule: ModScheduleJson & { added: Partial<Record<DifficultyName, Partial<ModScheduleJson>>> };
  /**
   * Per difficulty, percent of Normal's average HP its wave monsters are scaled to (see
   * buildGameData): Nightmare and Hell monsters are tougher than Normal ones, by this much.
   */
  difficultyHpPct: number[];
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
  /**
   * monstats Level (normal): sets the bounty, in every difficulty, so gold follows the
   * wave curve rather than jumping with Nightmare's levels.
   */
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
  /** 0 Normal, 1 Nightmare, 2 Hell; and the wave's number within its difficulty, from 1. */
  difficulty: number;
  number: number;
  /** HP multiplier for this wave, per mille (1000 = x1). */
  hpPermille: number;
  /** Bounty multiplier for this wave, per mille. */
  bountyPermille: number;
  groups: WaveGroup[];
}

export interface Economy {
  startingGold: number;
  lives: number;
  leakCost: Record<Rank, number>;
  bossLeakCost: Record<string, number | 'all'>;
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
  waveClearBonusPct: number;
  earlyCallBonusPct: number;
  /** Ticks from the start of a multiplayer match to wave 1, and between later waves. */
  firstWaveTicks: number;
  waveGapTicks: number;
}

/** A mod's resistances on one difficulty (see BalanceJson monsterMods). */
export interface ModResist {
  add: Partial<Record<Element, number>>;
  maxResist?: number;
  championResist?: number;
}

export interface Rules {
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

export interface GameData {
  /** The difficulty the run starts at; later difficulties follow its 30 waves. */
  difficulty: number;
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
  fire: 'fireEnchanted',
  cold: 'coldEnchanted',
  lightning: 'lightningEnchanted',
  stoneskin: 'stoneSkin',
};

/** Midway through a min-max range of two table columns. */
const midway = (row: TableRow, min: string, max: string) => idiv(int(row, min) + int(row, max), 2);

/**
 * A monster's entry for one difficulty, from monstats (and superuniques.txt for a named
 * boss: its class's stats, its own name and mods, and the unique HP bonus).
 */
export function monsterDef(tables: Tables, design: MonstersJson, id: string, auraRangePerTile: number, difficulty = 0): MonsterDef {
  const boss = design.bosses.find((b) => b.id === id);
  const su = boss?.superunique ? findRow(tables.superuniques, 'Superunique', boss.superunique) : undefined;
  if (boss && su && str(su, 'Class') !== boss.class) throw new Error(`${id}: superuniques.txt class is ${str(su, 'Class')}, not ${boss.class}`);
  const base = boss?.class ?? id;
  const row = findRow(tables.monstats, 'Id', base);
  const sfx = SUFFIX[difficulty]!;
  // A difficulty column the row leaves out falls back to Normal's (resistances excepted:
  // an empty resistance is 0, as in the game)
  const col = (name: string, normal = name) => (row[`${name}${sfx}`] !== undefined ? `${name}${sfx}` : normal);
  const level = int(row, 'Level');
  // D2: monstats HP and damage are percentages of the monlvl values for the monster's
  // level, both at the difficulty's level and columns
  const lvlRow = findRow(tables.monlvl, 'Level', int(row, col('Level')));
  const lvlCol = (name: string) => (lvlRow[`${name}${sfx}`] !== undefined ? `${name}${sfx}` : name);
  const pct = (column: string, of: string) => Math.max(1, idiv(int(row, column) * int(lvlRow, of), 100)) * 256;
  const [minCol, maxCol] = HP_COLUMNS[difficulty]!;
  // A superunique takes monumod's unique HP bonus on its class's HP
  const hpBonus = su ? monumodConstant(tables, 'Unique HP % Bonus') : 0;
  const hpOf = (column: string, normal: string) =>
    idiv(pct(row[column] !== undefined ? column : normal, lvlCol('HP')) * (100 + hpBonus), 100);
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
    id: variantId(id, difficulty),
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

/**
 * The wave numbers the bosses stand on, in order: all but the last spread evenly over
 * bossWaves first to last (rounded to the nearest wave), the last on the final wave.
 */
export function bossWaveNumbers(balance: BalanceJson, bosses: number): number[] {
  const { first, last } = balance.waves.bossWaves;
  const spread = bosses - 1;
  const out: number[] = [];
  for (let i = 0; i < spread; i++) out.push(spread === 1 ? first : first + idiv(i * (last - first) * 2 + (spread - 1), (spread - 1) * 2));
  out.push(balance.waves.count);
  return out;
}

/** Compounds a percent per step: permille[0] = 1000, permille[n] = permille[n-1] * pct / 100. */
export function compound(pct: number, steps: number): number[] {
  const out = [1000];
  for (let i = 1; i < steps; i++) out.push(idiv(out[i - 1]! * pct, 100));
  return out;
}

/**
 * The act's schedule (monsters.json): the bosses on bossWaveNumbers, each with its D2 pack,
 * and the normal waves in between, one monster each in the order the player meets them.
 * A normal wave is a stream of its monster, packs for swarms and one at a time for tanks.
 * Champion packs and uniques (the wave's own monster) and every special's mods come from the
 * balance.json schedule, with the difficulty's additions and the immune-over-resistant rule.
 */
export function generateWaves(
  balance: BalanceJson,
  monsters: MonstersJson,
  count: number,
  defs: Record<string, MonsterDef>,
  difficulty = 0,
): WaveDef[] {
  const plan = balance.waves.count;
  if (count > plan) throw new Error(`the Act 1 schedule has ${plan} waves, not ${count}`);
  const bossAt = new Map(bossWaveNumbers(balance, monsters.bosses.length).map((n, i) => [n, monsters.bosses[i]!]));
  if (monsters.waves.length !== plan - bossAt.size) {
    throw new Error(`monsters.json has ${monsters.waves.length} normal waves; the schedule needs ${plan - bossAt.size}`);
  }
  const hp = compound(balance.hpPctPerWave, count);
  const bounty = compound(balance.bountyPctPerWave, count);
  const pathUnits = createMap().length;
  const w = balance.waves;
  const schedule = balance.modSchedule;
  const added = schedule.added[DIFFICULTIES[difficulty]!] ?? {};
  // A rank's scheduled mods on a wave: Normal's, the difficulty's on top, resolved
  const modsOf = (rank: keyof ModScheduleJson, key: string, own: MonsterMod[] = []): MonsterMod[] =>
    resolveMods(balance, [...own, ...(schedule[rank][key] ?? []), ...(added[rank]?.[key] ?? [])]);
  const waves: WaveDef[] = [];
  let normalIndex = 0;
  for (let n = 1; n <= count; n++) {
    const key = String(n);
    const groups: WaveGroup[] = [];
    const boss = bossAt.get(n);
    const wave = boss ? undefined : monsters.waves[normalIndex++]!;
    const kind: WaveDef['kind'] = boss ? 'boss' : wave!.kind;
    const spec = w[boss ? 'swarm' : wave!.kind];
    // Specials arrive after a pause, like a pack of their own
    const pause = (spec.pack?.gapTicks ?? spec.spacingTicks * 2) - spec.spacingTicks;

    if (boss) {
      // The boss's pack walks first, the boss behind it
      const def = defs[variantId(boss.id, difficulty)]!;
      if (def.minion) {
        groups.push({ monster: variantId(def.minion.monster, difficulty), count: def.minion.count, spacingTicks: spec.spacingTicks, rank: 'normal', mods: [] });
      }
      groups.push({
        monster: def.id,
        count: 1,
        spacingTicks: spec.spacingTicks,
        ...(groups.length > 0 ? { delayTicks: pause } : {}),
        rank: 'boss',
        mods: modsOf('bosses', key, def.mods),
      });
    } else {
      const monster = variantId(wave!.monster, difficulty);
      // A stream of the wave's monster: one at a time for tanks, packs of min to max for
      // swarms with a gap between packs
      const pack = spec.pack;
      const stream = (size: number): WaveGroup[] => {
        const out: WaveGroup[] = [];
        const add = (c: number, delayTicks: number) =>
          out.push({ monster, count: c, spacingTicks: spec.spacingTicks, rank: 'normal', mods: [], ...(delayTicks > 0 ? { delayTicks } : {}) });
        if (pack) {
          for (let k = 0, left = size; left > 0; k++) {
            const c = Math.min(left, pack.min + (k % (pack.max - pack.min + 1)));
            add(c, k === 0 ? 0 : pack.gapTicks - spec.spacingTicks);
            left -= c;
          }
        } else {
          for (let i = 0; i < size; i++) add(1, 0);
        }
        return out;
      };
      const span = (gs: WaveGroup[]) => gs.reduce((t, g) => t + (g.delayTicks ?? 0) + g.count * g.spacingTicks, 0) - spec.spacingTicks;
      // How long the monster takes to walk the whole path
      const walk = idiv(pathUnits, Math.max(1, defs[monster]!.speed));
      let size = Math.min(spec.cap, spec.base + Math.floor(n / spec.addEvery));
      let normal = stream(size);
      while (size < spec.cap && span(normal) + walk < w.targetTicks) normal = stream(++size);
      groups.push(...normal);
      if (schedule.uniques[key] || added.uniques?.[key]) {
        groups.push({ monster, count: 1, spacingTicks: spec.spacingTicks, delayTicks: pause, rank: 'unique', mods: modsOf('uniques', key) });
      }
      if (schedule.champions[key] || added.champions?.[key]) {
        groups.push({ monster, count: w.championPackSize, spacingTicks: spec.spacingTicks, delayTicks: pause, rank: 'champion', mods: modsOf('champions', key) });
      }
    }
    waves.push({ kind, area: boss ? boss.area : wave!.area, difficulty, number: n, hpPermille: hp[n - 1]!, bountyPermille: bounty[n - 1]!, groups });
  }
  return waves;
}

export function economyFrom(balance: BalanceJson): Economy {
  const steps = compound(balance.levelCostPctPerLevel, MAX_TOWER_LEVEL - 1);
  return {
    startingGold: balance.startingGold,
    lives: balance.lives,
    leakCost: balance.leakCost,
    bossLeakCost: balance.bossLeakCost,
    buildCost: balance.buildCost,
    levelCosts: balance.levelCostBase.map((base) => steps.map((permille) => idiv(base * permille, 1000))),
    tierCosts: balance.tierCosts,
    evolveCost: balance.evolveCost,
    sellRefundPct: balance.sellRefundPct,
    bountyPerLevel: balance.bountyPerLevel,
    rankBountyMultiplier: balance.rankBountyMultiplier,
    bossBountyMultiplier: balance.bossBountyMultiplier,
    waveClearBonusPct: balance.waveClearBonusPct,
    earlyCallBonusPct: balance.earlyCallBonusPct,
    firstWaveTicks: balance.multiplayer.firstWaveTicks,
    waveGapTicks: balance.multiplayer.waveGapTicks,
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
  /** The difficulty the run starts at (default Normal). */
  difficulty?: number;
  /** After the last wave the map loops at the next difficulty, up to Hell (default off). */
  loop?: boolean;
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
  waveCount: number = design.balance.waves.count,
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
  const monsterIds = new Set([
    ...Object.keys(m.roster),
    ...m.waves.map((w) => w.monster),
    ...m.bosses.flatMap((b) => [b.id, ...(b.minion ? [b.minion] : [])]),
  ]);
  const start = options.difficulty ?? 0;
  const last = options.loop ? DIFFICULTIES.length - 1 : start;
  const monsters: Record<string, MonsterDef> = {};
  const waves: WaveDef[] = [];
  const normal = [...monsterIds].map((id) => monsterDef(tables, m, id, design.balance.auraRangePerTile));
  // Averaged over the normal waves' monsters, so the bosses do not drag the scale
  const pooled = new Set(m.waves.map((w) => w.monster));
  const average = (defs: MonsterDef[]) => defs.filter((d) => pooled.has(d.base)).reduce((n, d) => n + d.minHp + d.maxHp, 0);
  for (let d = start; d <= last; d++) {
    const defs = d === 0 ? normal : [...monsterIds].map((id) => monsterDef(tables, m, id, design.balance.auraRangePerTile, d));
    // The difficulty's wave monsters scaled to its percent of Normal's average HP: its
    // columns set who is tough against whom, the wave curve and this percent how tough
    const pct = design.balance.difficultyHpPct[d] ?? 100;
    const scale = idiv(average(normal) * 10 * pct, Math.max(1, average(defs)));
    for (const def of defs) {
      monsters[def.id] = d === 0 && pct === 100 ? def : { ...def, minHp: Math.max(256, idiv(def.minHp * scale, 1000)), maxHp: Math.max(256, idiv(def.maxHp * scale, 1000)) };
    }
    waves.push(...generateWaves(design.balance, m, waveCount, monsters, d));
  }

  return {
    difficulty: start,
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
