// Builds the sim's game data from the pipeline's tables plus our design data (skill
// entries, classes, evolutions, monsters, balance). Pure: no I/O, so the render layer,
// the tests and the balance harness all feed it.

import { ARCHETYPES } from './archetypes/index.ts';
import type { HitFilter, SkillDef, SkillJson } from './archetypes/types.ts';
import { auraMultiplier, isAura, standardDps, withTierBonus } from './dps.ts';
import { VELOCITY_TO_UNITS_PER_TICK, UNITS_PER_TILE, d2FramesToTicks, idiv } from './fixed.ts';
import { ELEMENTS, MONSTER_MODS, type Element, type MonsterMod, type Rank } from './state.ts';
import { createMap } from './map.ts';
import { findRow, int, monumodConstant, str, type TableRow, type Tables } from './tables.ts';

export type { TableRow, Tables } from './tables.ts';

/**
 * D2's three difficulties. A monster's Nightmare and Hell stats are their own entries,
 * keyed `${id}@nightmare` and `${id}@hell`, so the sim reads them like any other monster.
 */
export const DIFFICULTIES = ['normal', 'nightmare', 'hell'] as const;
export type DifficultyName = (typeof DIFFICULTIES)[number];
export const DIFFICULTY_NAMES = ['Normal', 'Nightmare', 'Hell'] as const;

export function variantId(id: string, difficulty: number): string {
  return difficulty === 0 ? id : `${id}@${DIFFICULTIES[difficulty]}`;
}

/** The monstats id behind a difficulty variant: what sprites, names and sounds key on. */
export function baseMonsterId(def: string): string {
  const at = def.indexOf('@');
  return at < 0 ? def : def.slice(0, at);
}

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

export interface MonstersJson {
  roster: Record<string, { role: string; resurrect?: ResurrectJson }>;
  pools: Record<'swarm' | 'tank', { id: string; minWave: number }[]>;
  bosses: Record<string, string>;
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
  /** Lives a leaked monster costs by rank; a boss by id, where "all" ends the run. */
  leakCost: Record<'normal' | 'champion' | 'unique', number>;
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
  rankBountyMultiplier: Record<'normal' | 'champion' | 'unique', number>;
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
    minTypes: number;
    maxTypes: number;
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
  /** Boss HP as a multiple of its wave's average monster HP, by monster id. */
  bossHpMultiplier: Record<string, number>;
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
  /** The difficulty variant's id; `base` is the monstats id. */
  id: string;
  base: string;
  difficulty: number;
  name: string;
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
  /** Fixed HP (1/256) for bosses: a multiple of the wave's average monster HP. */
  hp?: number;
}

export interface WaveDef {
  kind: 'swarm' | 'tank';
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
  leakCost: Record<'normal' | 'champion' | 'unique', number>;
  bossLeakCost: Record<string, number | 'all'>;
  buildCost: number;
  /** levelCosts[tier - 1][n] is the gold to go from level n + 1 to n + 2 in that tier. */
  levelCosts: number[][];
  /** tierCosts[0] reaches T2, tierCosts[1] reaches T3. */
  tierCosts: number[];
  evolveCost: number;
  sellRefundPct: number;
  bountyPerLevel: number;
  rankBountyMultiplier: Record<'normal' | 'champion' | 'unique', number>;
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

export function monsterDef(tables: Tables, design: MonstersJson, id: string, auraRangePerTile: number, difficulty = 0): MonsterDef {
  const row = findRow(tables.monstats, 'Id', id);
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
  const hpOf = (column: string, normal: string) => pct(row[column] !== undefined ? column : normal, lvlCol('HP'));
  const resist = {} as Record<Element, number>;
  for (const element of ELEMENTS) resist[element] = int(row, `${RESIST_COLUMNS[element]}${sfx}`);
  const resurrect = design.roster[id]?.resurrect;
  return {
    id: variantId(id, difficulty),
    base: id,
    difficulty,
    name: str(row, 'NameStr') || id,
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

/** Compounds a percent per step: permille[0] = 1000, permille[n] = permille[n-1] * pct / 100. */
export function compound(pct: number, steps: number): number[] {
  const out = [1000];
  for (let i = 1; i < steps; i++) out.push(idiv(out[i - 1]! * pct, 100));
  return out;
}

/**
 * Wave n (1-based): odd waves are swarms, even waves tanks. Each mixes 2 to 4 monster
 * types from its pool (those unlocked by minWave), rotating through the pool so
 * consecutive waves differ. Champion packs, uniques and boss mods come from the
 * balance.json schedule; a boss's HP is a multiple of its wave's average monster HP.
 */
export function generateWaves(
  balance: BalanceJson,
  monsters: MonstersJson,
  count: number,
  defs: Record<string, MonsterDef>,
  difficulty = 0,
): WaveDef[] {
  const hp = compound(balance.hpPctPerWave, count);
  const bounty = compound(balance.bountyPctPerWave, count);
  const pathUnits = createMap().length;
  const w = balance.waves;
  const waves: WaveDef[] = [];
  for (let n = 1; n <= count; n++) {
    const kind = n % 2 === 1 ? 'swarm' : 'tank';
    const spec = w[kind];
    const pool = monsters.pools[kind].filter((p) => p.minWave <= n).map((p) => variantId(p.id, difficulty));
    const types = Math.min(pool.length, w.minTypes + (Math.floor(n / 2) % (w.maxTypes - w.minTypes + 1)));
    const picked = Array.from({ length: types }, (_, i) => pool[(Math.floor(n / 2) + i) % pool.length]!);
    // A stream that takes turns through the picked types: one monster at a time for tanks,
    // packs of min to max for swarms with a gap between packs
    const pack = spec.pack;
    const stream = (size: number): WaveGroup[] => {
      const out: WaveGroup[] = [];
      const add = (monster: string, count: number, delayTicks: number) =>
        out.push({ monster, count, spacingTicks: spec.spacingTicks, rank: 'normal', mods: [], ...(delayTicks > 0 ? { delayTicks } : {}) });
      if (pack) {
        for (let k = 0, left = size; left > 0; k++) {
          const c = Math.min(left, pack.min + (k % (pack.max - pack.min + 1)));
          add(picked[k % picked.length]!, c, k === 0 ? 0 : pack.gapTicks - spec.spacingTicks);
          left -= c;
        }
      } else {
        for (let i = 0; i < size; i++) add(picked[i % picked.length]!, 1, 0);
      }
      return out;
    };
    const span = (gs: WaveGroup[]) => gs.reduce((t, g) => t + (g.delayTicks ?? 0) + g.count * g.spacingTicks, 0) - spec.spacingTicks;
    // How long the slowest monster actually in the stream takes to walk the whole path
    const walk = (gs: WaveGroup[]) => idiv(pathUnits, Math.max(1, Math.min(...gs.map((g) => defs[g.monster]!.speed))));
    let size = Math.min(spec.cap, spec.base + Math.floor(n / spec.addEvery));
    let groups = stream(size);
    while (size < spec.cap && span(groups) + walk(groups) < w.targetTicks) groups = stream(++size);
    const counts = new Map<string, number>();
    for (const g of groups) counts.set(g.monster, (counts.get(g.monster) ?? 0) + g.count);
    // Champions, uniques and bosses arrive after a pause, like a pack of their own
    const pause = (pack?.gapTicks ?? spec.spacingTicks * 2) - spec.spacingTicks;

    const key = String(n);
    const lead = picked[0]!;
    const schedule = balance.modSchedule;
    const added = schedule.added[DIFFICULTIES[difficulty]!] ?? {};
    // The difficulty's mods on top of Normal's, each mod once
    const modsOf = (rank: keyof ModScheduleJson): MonsterMod[] | undefined => {
      const base = schedule[rank][key];
      const more = added[rank]?.[key];
      return base || more ? [...new Set([...(base ?? []), ...(more ?? [])])] : undefined;
    };
    const uniqueMods = modsOf('uniques');
    const championMods = modsOf('champions');
    if (uniqueMods) groups.push({ monster: lead, count: 1, spacingTicks: spec.spacingTicks, delayTicks: pause, rank: 'unique', mods: uniqueMods });
    if (championMods) {
      groups.push({ monster: lead, count: w.championPackSize, spacingTicks: spec.spacingTicks, delayTicks: pause, rank: 'champion', mods: championMods });
    }

    const bossId = monsters.bosses[key];
    const boss = bossId && variantId(bossId, difficulty);
    if (boss && bossId) {
      // The wall scales with the curve: a multiple of this wave's average monster HP
      let total = 0;
      let monstersInWave = 0;
      for (const [id, c] of counts) {
        const d = defs[id]!;
        total += idiv((d.minHp + d.maxHp) * hp[n - 1]!, 2000) * c;
        monstersInWave += c;
      }
      const multiplier = balance.bossHpMultiplier[bossId];
      if (multiplier === undefined) throw new Error(`balance.json bossHpMultiplier has no ${bossId}`);
      groups.push({
        monster: boss,
        count: 1,
        spacingTicks: spec.spacingTicks,
        delayTicks: pause,
        rank: 'boss',
        mods: modsOf('bosses') ?? [],
        hp: Math.max(256, idiv(total, monstersInWave) * multiplier),
      });
    }

    waves.push({ kind, difficulty, number: n, hpPermille: hp[n - 1]!, bountyPermille: bounty[n - 1]!, groups });
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
    ...Object.values(m.pools).flatMap((pool) => pool.map((p) => p.id)),
    ...Object.values(m.bosses),
  ]);
  const start = options.difficulty ?? 0;
  const last = options.loop ? DIFFICULTIES.length - 1 : start;
  const monsters: Record<string, MonsterDef> = {};
  const waves: WaveDef[] = [];
  const normal = [...monsterIds].map((id) => monsterDef(tables, m, id, design.balance.auraRangePerTile));
  // Averaged over the wave pools: a boss's HP is a multiple of its wave's average anyway
  const pooled = new Set(Object.values(m.pools).flatMap((pool) => pool.map((p) => p.id)));
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
