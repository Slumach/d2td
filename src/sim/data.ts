// Builds the sim's game data from the pipeline's tables plus our design data (skill
// entries, classes, evolutions, monsters, balance). Pure: no I/O, so the render layer,
// the tests and the balance harness all feed it.

import { ARCHETYPES } from './archetypes/index.ts';
import type { HitFilter, SkillDef, SkillJson } from './archetypes/types.ts';
import { VELOCITY_TO_UNITS_PER_TICK, UNITS_PER_TILE, d2FramesToTicks, idiv } from './fixed.ts';
import { ELEMENTS, MONSTER_MODS, type Element, type MonsterMod, type Rank } from './state.ts';
import { findRow, int, monumodConstant, str, type Tables } from './tables.ts';

export type { TableRow, Tables } from './tables.ts';

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
  base: number;
  perWave: number;
  spacingTicks: number;
}

/** src/data/balance.json. Multipliers are integer percents so the sim stays integer. */
export interface BalanceJson {
  startingGold: number;
  lives: number;
  leakCost: number;
  bossLeakCost: number;
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
  auraRangePerTile: number;
  corpseLifetimeTicks: number;
  monsterAttackTicks: number;
  blockRangeTenths: number;
  waves: {
    count: number;
    minTypes: number;
    maxTypes: number;
    championEvery: number;
    championPackSize: number;
    uniqueEvery: number;
    /** Mods a wave's unique always carries, by wave number; the rest are rolled. */
    uniqueForcedMods: Record<string, MonsterMod[]>;
    swarm: WaveKindJson;
    tank: WaveKindJson;
  };
  /** D2 hardcodes these mod effects, so they are design values. */
  monsterMods: Record<MonsterMod, { speedPct?: number; damagePct?: number; resist?: Partial<Record<Element, number>> }>;
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
  id: string;
  name: string;
  monType: string;
  /** monstats Level (normal). Sets base HP and damage through monlvl, and the bounty. */
  level: number;
  /** HP range at that level, in 1/256 HP: monstats minHP/maxHP percent of monlvl HP. */
  minHp: number;
  maxHp: number;
  /** Attack damage (A1MinD/A1MaxD percent of monlvl DM), 1/256 HP. */
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
  rank: Rank;
  /** Mods for the group when the wave is called; a pack shares its mods. */
  modCount: number;
  /** Mods the group always gets; the rest of modCount is rolled from the others. */
  forcedMods: MonsterMod[];
}

export interface WaveDef {
  kind: 'swarm' | 'tank';
  /** HP multiplier for this wave, per mille (1000 = x1). */
  hpPermille: number;
  /** Bounty multiplier for this wave, per mille. */
  bountyPermille: number;
  groups: WaveGroup[];
}

export interface Economy {
  startingGold: number;
  lives: number;
  leakCost: number;
  bossLeakCost: number;
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
}

export interface Rules {
  corpseLifetimeTicks: number;
  monsterAttackTicks: number;
  blockRangeUnits: number;
  /** monumod.txt constants. */
  championHpPct: number;
  uniqueHpPct: number;
  championDamagePct: number;
  mods: Record<MonsterMod, { speedPct: number; damagePct: number; resist: Partial<Record<Element, number>> }>;
}

export interface GameData {
  skills: Record<string, SkillDef>;
  classes: Record<string, ClassDef>;
  evolutions: EvolutionDef[];
  monsters: Record<string, MonsterDef>;
  waves: WaveDef[];
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

export function monsterDef(tables: Tables, design: MonstersJson, id: string, auraRangePerTile: number): MonsterDef {
  const row = findRow(tables.monstats, 'Id', id);
  const level = int(row, 'Level');
  // D2: monstats HP and damage are percentages of the monlvl values for the monster's level
  const lvl = findRow(tables.monlvl, 'Level', level);
  const pctOf = (column: string, of: string) => Math.max(1, idiv(int(row, column) * int(lvl, of), 100)) * 256;
  const resist = {} as Record<Element, number>;
  for (const element of ELEMENTS) resist[element] = int(row, RESIST_COLUMNS[element]);
  const resurrect = design.roster[id]?.resurrect;
  return {
    id,
    name: str(row, 'NameStr') || id,
    monType: str(row, 'MonType'),
    level,
    minHp: pctOf('minHP', 'HP'),
    maxHp: pctOf('maxHP', 'HP'),
    minDamage: pctOf('A1MinD', 'DM'),
    maxDamage: pctOf('A1MaxD', 'DM'),
    speed: int(row, 'Velocity') * VELOCITY_TO_UNITS_PER_TICK,
    resist,
    undead: int(row, 'lUndead') === 1 || int(row, 'hUndead') === 1,
    demon: int(row, 'demon') === 1,
    aiDelayTicks: Math.max(1, d2FramesToTicks(int(row, 'aidel'))),
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
 * consecutive waves differ. Champion packs every championEvery waves, a unique with
 * two mods every uniqueEvery, and the bosses from monsters.json on their waves.
 */
export function generateWaves(balance: BalanceJson, monsters: MonstersJson, count: number): WaveDef[] {
  const hp = compound(balance.hpPctPerWave, count);
  const bounty = compound(balance.bountyPctPerWave, count);
  const w = balance.waves;
  const waves: WaveDef[] = [];
  for (let n = 1; n <= count; n++) {
    const kind = n % 2 === 1 ? 'swarm' : 'tank';
    const spec = w[kind];
    const pool = monsters.pools[kind].filter((p) => p.minWave <= n).map((p) => p.id);
    const types = Math.min(pool.length, w.minTypes + (Math.floor(n / 2) % (w.maxTypes - w.minTypes + 1)));
    const picked = Array.from({ length: types }, (_, i) => pool[(Math.floor(n / 2) + i) % pool.length]!);
    const size = spec.base + spec.perWave * n;

    // Round-robin through the picked types so every wave has even proportions
    const counts = new Map<string, number>();
    for (let i = 0; i < size; i++) {
      const id = picked[i % picked.length]!;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const groups: WaveGroup[] = [...counts].map(([monster, c]) => ({
      monster,
      count: c,
      spacingTicks: spec.spacingTicks,
      rank: 'normal',
      modCount: 0,
      forcedMods: [],
    }));

    const lead = picked[0]!;
    if (n % w.uniqueEvery === 0) {
      const forcedMods = w.uniqueForcedMods[String(n)] ?? [];
      groups.push({ monster: lead, count: 1, spacingTicks: spec.spacingTicks, rank: 'unique', modCount: 2, forcedMods });
    } else if (n % w.championEvery === 0) {
      groups.push({
        monster: lead,
        count: w.championPackSize,
        spacingTicks: spec.spacingTicks,
        rank: 'champion',
        modCount: 1,
        forcedMods: [],
      });
    }
    const boss = monsters.bosses[String(n)];
    if (boss) groups.push({ monster: boss, count: 1, spacingTicks: spec.spacingTicks, rank: 'boss', modCount: 0, forcedMods: [] });

    waves.push({ kind, hpPermille: hp[n - 1]!, bountyPermille: bounty[n - 1]!, groups });
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
  };
}

export function rulesFrom(tables: Tables, balance: BalanceJson): Rules {
  const mods = {} as Rules['mods'];
  for (const mod of MONSTER_MODS) {
    const m = balance.monsterMods[mod];
    mods[mod] = { speedPct: m.speedPct ?? 0, damagePct: m.damagePct ?? 0, resist: m.resist ?? {} };
  }
  return {
    corpseLifetimeTicks: balance.corpseLifetimeTicks,
    monsterAttackTicks: balance.monsterAttackTicks,
    blockRangeUnits: idiv(balance.blockRangeTenths * UNITS_PER_TILE, 10),
    championHpPct: monumodConstant(tables, 'Champion HP % Bonus'),
    uniqueHpPct: monumodConstant(tables, 'Unique HP % Bonus'),
    championDamagePct: monumodConstant(tables, 'Champion Damage % Bonus'),
    mods,
  };
}

export function resolveSkill(tables: Tables, json: SkillJson, design: DesignData, weapon: string | undefined): SkillDef {
  const archetype = ARCHETYPES[json.archetype];
  if (!archetype) throw new Error(`${json.id}: unknown archetype ${json.archetype}`);
  return archetype.resolve(json, {
    tables,
    skillRow: findRow(tables.skills, 'skill', json.skill),
    weapon,
    auraRangePerTile: design.balance.auraRangePerTile,
    filterOverride: design.balance.skillOverrides[json.id],
  });
}

export function buildGameData(tables: Tables, design: DesignData, waveCount: number = design.balance.waves.count): GameData {
  // A skill takes the weapon of the class whose lines use it
  const weaponFor = (skillId: string) =>
    design.classes.find((c) => Object.values(c.lines).some((l) => l.tiers.flat().includes(skillId)))?.weapon;
  const skills: Record<string, SkillDef> = {};
  for (const json of design.skills) skills[json.id] = resolveSkill(tables, json, design, weaponFor(json.id));

  const classes: Record<string, ClassDef> = {};
  for (const c of design.classes) {
    for (const line of Object.values(c.lines)) {
      for (const id of line.tiers.flat()) if (!skills[id]) throw new Error(`${c.id}: no skill entry ${id}`);
    }
    classes[c.id] = { id: c.id, name: c.name, lines: c.lines };
  }

  const evolutions = Object.entries(design.evolutions).map(([id, e]) => {
    for (const skill of [e.attack.skill, e.partner.skill]) if (!skills[skill]) throw new Error(`${id}: no skill ${skill}`);
    return { id, name: e.name, attack: e.attack, partner: e.partner, ignoreSkillDelay: e.ignoreSkillDelay === true };
  });

  const waves = generateWaves(design.balance, design.monsters, waveCount);
  const monsterIds = new Set([...Object.keys(design.monsters.roster), ...waves.flatMap((w) => w.groups.map((g) => g.monster))]);
  const monsters: Record<string, MonsterDef> = {};
  for (const id of monsterIds) monsters[id] = monsterDef(tables, design.monsters, id, design.balance.auraRangePerTile);

  return { skills, classes, evolutions, monsters, waves, economy: economyFrom(design.balance), rules: rulesFrom(tables, design.balance) };
}
