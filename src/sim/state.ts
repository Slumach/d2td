// Sim state. Plain records and arrays of integers and strings only, so stateHash can walk
// it generically and a snapshot is just a deep copy.

import type { MonsterAuraFx, TowerBuff } from './archetypes/types.ts';
import type { GameData } from './data.ts';
import type { GameMap } from './map.ts';
import type { Rng } from './rng.ts';

export type Element = 'phys' | 'mag' | 'fire' | 'ltng' | 'cold' | 'pois';
export const ELEMENTS: readonly Element[] = ['phys', 'mag', 'fire', 'ltng', 'cold', 'pois'];

export type Targeting = 'first' | 'last' | 'strongest' | 'weakest' | 'closest';
export const TARGETING_MODES: readonly Targeting[] = ['first', 'last', 'strongest', 'weakest', 'closest'];

export type Rank = 'normal' | 'champion' | 'unique' | 'boss';
export type MonsterMod = 'extraFast' | 'extraStrong' | 'stoneSkin' | 'magicResistant';
export const MONSTER_MODS: readonly MonsterMod[] = ['extraFast', 'extraStrong', 'stoneSkin', 'magicResistant'];

export type Command =
  /** `skill` makes the T1 pick in the same command; without it the tower is inert until pickSkill. */
  | { type: 'build'; x: number; y: number; cls: string; skill?: string }
  | { type: 'pickSkill'; towerId: number; skill: string }
  | { type: 'upgrade'; towerId: number }
  | { type: 'upgradeTier'; towerId: number }
  | { type: 'pickBranch'; towerId: number; skill: string }
  | { type: 'setTargeting'; towerId: number; mode: Targeting }
  | { type: 'evolve'; towerA: number; towerB: number }
  | { type: 'sell'; towerId: number }
  | { type: 'callWave' };

export interface TimedCommand {
  tick: number;
  command: Command;
}

export interface Monster {
  id: number;
  def: string;
  wave: number;
  rank: Rank;
  mods: MonsterMod[];
  level: number;
  hp: number;
  maxHp: number;
  /** Attack damage against summons, 1/256 HP. */
  minDamage: number;
  maxDamage: number;
  /** Distance walked along the path, in units. */
  dist: number;
  x: number;
  y: number;
  /** Timed statuses from on-hit control skills. */
  slowPct: number;
  slowTicks: number;
  stunTicks: number;
  attackCooldown: number;
  /** Ticks until the next AI decision. */
  abilityCooldown: number;
  /** A raiser mid-cast stands still; the corpse rises when this reaches 0. */
  castTicks: number;
  castCorpse: number;
}

export interface Tower {
  id: number;
  cls: string;
  tileX: number;
  tileY: number;
  x: number;
  y: number;
  /** Chosen with the T1 pick; empty while the tower is inert. */
  line: string;
  tier: number;
  level: number;
  /** Skill picked at each tier so far; the current skill is picks[tier - 1]. */
  picks: string[];
  spent: number;
  cooldown: number;
  targeting: Targeting;
  /** Evolution recipe id, empty for a normal tower. */
  evolved: string;
  /** Built-in partner aura of an evolved tower, and the level it carries. */
  partnerSkill: string;
  partnerLevel: number;
  /** Summon towers: ticks until the next summon may be raised. */
  summonCooldown: number;
}

export interface Missile {
  id: number;
  skill: string;
  towerId: number;
  /** Tower level index 0 to 4 the missile was fired at. */
  level: number;
  /** Aura damage bonus snapshot at fire time. */
  damagePct: number;
  x: number;
  y: number;
  /** Origin, for orbits and line missiles. */
  ox: number;
  oy: number;
  /** Line velocity in units per tick. */
  vx: number;
  vy: number;
  targetId: number;
  age: number;
  ticksLeft: number;
  /** Monster ids already hit, for pierce, chain and orbit missiles. */
  hits: number[];
  /** Remaining pierces or chain hops. */
  remaining: number;
  /** Archetype-specific counter: chain damage, zone tick timer. */
  value: number;
}

export interface Summon {
  id: number;
  towerId: number;
  def: string;
  dist: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  minDamage: number;
  maxDamage: number;
  cooldown: number;
}

export interface Corpse {
  id: number;
  def: string;
  dist: number;
  x: number;
  y: number;
  maxHp: number;
  ticksLeft: number;
}

export interface Spawn {
  tick: number;
  def: string;
  wave: number;
  rank: Rank;
  mods: MonsterMod[];
  /** Fixed HP (1/256) for bosses, 0 to roll from monstats. */
  hp: number;
}

export interface WaveProgress {
  /** Monsters queued or alive. */
  remaining: number;
  /** Bounty earned from this wave's kills; the clear bonus is a percentage of it. */
  bounty: number;
  early: boolean;
}

export type Status = 'playing' | 'won' | 'lost';

export interface SimState {
  tick: number;
  rng: Rng;
  gold: number;
  lives: number;
  /** Waves called so far; the current wave number for the HUD. */
  wave: number;
  status: Status;
  kills: number;
  leaks: number;
  nextId: number;
  monsters: Monster[];
  towers: Tower[];
  missiles: Missile[];
  summons: Summon[];
  corpses: Corpse[];
  spawns: Spawn[];
  waves: WaveProgress[];
}

/** An aura source this tick, kept for the renderer's radius rings. */
export interface AuraEmitter {
  towerId: number;
  skill: string;
  radiusUnits: number;
}

/**
 * Aura effects for the current tick. Derived from state at the start of every tick
 * (same state in, same field out), so it is not hashed and never replayed.
 */
export interface AuraField {
  towers: Record<number, TowerBuff>;
  monsters: Record<number, MonsterAuraFx>;
  emitters: AuraEmitter[];
}

export interface Sim {
  readonly data: GameData;
  readonly map: GameMap;
  state: SimState;
  fx: AuraField;
}
