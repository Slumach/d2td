// Eternal Conflict (Legion TD style): two teams, each with a build pad per player running
// into the team's king, Tyrael for Harrogath and Baal for the Pandemonium Fortress. Every
// number is balance.json battle's.
//
// Each team's battlefield is one sim on a lane map (map.ts createLaneMap): a lane is an arc
// its player owns, so building, gold and kill credit work as on a shared team ring. The
// team's king, workers, shards and income live on that sim (state.battle); the match runs
// the phases both teams share (build, then fight), carries sends from one team to the other
// and decides the winner (match.ts).
//
// Towers are fighters: each has life from its class's charstats row, blocks the creeps that
// reach it, and is hit by them with their monstats damage. A fighter at zero life is down
// for the round and stands again at the next build phase. When a lane is clear its fighters
// rally to the king and fight the leaks there. A creep whose lane has no living fighter
// walks on to the king, stands at its feet and hits it; the king strikes back.
//
// Co-op: one team against the waves, with sends arriving on balance.json battle.coop's
// schedule instead of from an enemy team.

import { activeSkill } from './auras.ts';
import { dealRaw, distSq } from './combat.ts';
import type { GameData, WaveDef, WaveGroup } from './data.ts';
import { TICKS_PER_SECOND, UNITS_PER_TILE, idiv } from './fixed.ts';
import { gearOf } from './items/tower.ts';
import { arcAt, laneOf, tileCenter } from './map.ts';
import { createRng, rollInt } from './rng.ts';
import type { BattleSimState, KingUpgrade, Monster, MonsterMod, Rank, Sim, Tower } from './state.ts';

/** One battle wave: a stream of one monster, or an act boss, at a fixed difficulty and level. */
export interface BattleWaveJson {
  monster?: string;
  kind?: 'swarm' | 'tank';
  boss?: string;
  superunique?: string | string[];
  /** The act it stands for (the HUD and the battlefield's look) and the table difficulty its monsters come from. */
  act: number;
  difficulty: number;
  /** Every monster of the wave walks at this level: HP, damage and bounty through monlvl. */
  level: number;
  /** Percent on its monsters' HP, and on the sends that join it. */
  hpPct: number;
  /** A boss wave: the percent on the boss alone, on top of hpPct. */
  bossHpPct?: number;
  /** The wave carries a champion pack of its own monster. */
  champions?: boolean;
  area?: string;
}

/** A send: monsters the sender adds to an enemy lane's next wave, bought with shards. */
export interface SendJson {
  id: string;
  /** superunique: the named monster and its minions; champions: `count` champions of a monster; boss: an act boss, once a match. */
  kind: 'superunique' | 'champions' | 'boss';
  /** The superunique, boss or champion monster. Several walk one after another (the Ancients). */
  monster: string | string[];
  count?: number;
  mods?: MonsterMod[];
  /** Shards at wave 1, and the percent it rises each wave after. */
  cost: number;
  costPctPerWave: number;
  /** The first wave it can join, from 1. */
  fromWave: number;
  /** Percent on its monsters' HP (they walk at the joined wave's level and HP percent). */
  hpPct: number;
  /** The name the panel shows, when it is not the monster's own. */
  name?: string;
}

interface KingUpgradeJson {
  cost: number;
  costPctPerLevel: number;
  /** Per level: max life (and as much healed), life back a second, or the king's percent hit. */
  add: number;
  maxLevel: number;
}

/** What the game setup screen sets for a match. */
export interface BattleOptions {
  /** 'all': every player picks a race and builds it; 'random': Legion's random builder, a fresh roll of lines from different classes every wave. */
  pick: 'random' | 'all';
  /** Every send walks this many times over. */
  sends: number;
  /** The second team plays the first team's races. */
  mirror: boolean;
  /** Weaker waves, a stronger king (battle.easy). */
  easy: boolean;
  /** Waves 22 to 30 are played too (battle.longWaves). */
  long: boolean;
  /** Champion packs walk in their waves. */
  champions: boolean;
}

export const DEFAULT_OPTIONS: BattleOptions = { pick: 'all', sends: 1, mirror: false, easy: false, long: false, champions: true };

/** Options from the wire or a save, every field checked. */
export function battleOptions(v: unknown): BattleOptions {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Partial<Record<keyof BattleOptions, unknown>>;
  return {
    pick: o.pick === 'random' ? 'random' : 'all',
    sends: typeof o.sends === 'number' && Number.isInteger(o.sends) ? Math.max(1, Math.min(4, o.sends)) : 1,
    mirror: o.mirror === true,
    easy: o.easy === true,
    long: o.long === true,
    champions: o.champions !== false,
  };
}

export interface BattleJson {
  /** How long a wave's stream runs (a swarm monster a second, a tank every 1.5 s). */
  streamTicks: number;
  /** An act boss walks a lane at this percent of its pace: it passes a lane once, where the ring let it lap. */
  bossSpeedPct: number;
  /** Melee towers reach at least this far (tenths of a tile): beside a lane they would swing once at what passes. */
  meleeReachTenths: number;
  /** The first build phase, and every later one: the countdown that starts once every creep on both sides is dead. */
  firstBuildTicks: number;
  buildTicks: number;
  startingGold: number;
  /** A tower's build price here: a match starts with little gold and Legion's fighters are cheap. */
  buildCost: number;
  /** A match is 21 waves, not a campaign: an evolution and a legend cost this much here. */
  evolveCost: number;
  legendCost: number;
  /** Kill gold: monster level times this times the rank multiplier (balance.json rankBountyMultiplier). */
  bountyPerLevel: number;
  /** Base gold paid to every player at the end of each wave, by wave. */
  income: number[];
  /** A send raises its sender's income by this much gold a wave for every shard it cost. */
  sendIncomePerShard: number;
  /** Workers mine shards all match long: shardsPerSecond is in thousandths of a shard, a multiple of 20 (a tick's share is whole). */
  worker: { cost: number; costPerWorker: number; shardsPerSecond: number; max: number };
  /**
   * Fighters: a tower's life is its class's charstats life at its skill's level (hpadd plus
   * vit, LifePerLevel a level in fourths), times lifePct, times tierPct for its tier (T1 to T3,
   * evolved, legend), its gear's durability on top. engageTenths is how far off the path a
   * creep steps to fight it; kingHoldTenths how far before the king rallied fighters hold.
   */
  fighter: { lifePct: number; tierPct: number[]; engageTenths: number; kingHoldTenths: number };
  /**
   * The king's life by its team's size (hp[0] alone, hp[3] for four). A creep at its feet hits
   * it for its alive weight times damagePerWeight, and damagePctPerWave more for each wave
   * before its own, every monsterAttackTicks. The king strikes the nearest creep in range every
   * rateTicks for hitPct of its life (bossHitPct on bosses), magic, through every resistance.
   */
  king: {
    hp: number[];
    regenPerSecond: number;
    damagePerWeight: number;
    damagePctPerWave: number;
    attack: { rateTicks: number; rangeTenths: number; hitPct: number; bossHitPct: number };
    upgrades: Record<KingUpgrade, KingUpgradeJson>;
  };
  /**
   * Per race (class): percent on its base income and kill gold, the balance lever between
   * races, and a second percent on top in a team game (two or more a side), which plays
   * differently: two senders can pile onto one lane. damagePct (100 when absent) is on every
   * hit its towers land.
   */
  races: Record<string, { goldPct: number; teamGoldPct?: number; damagePct?: number }>;
  waves: BattleWaveJson[];
  /** The long game's waves 22 on (the setup screen's Long game). */
  longWaves?: BattleWaveJson[];
  sends: SendJson[];
  /** A send joining wave fromWave or later walks with hpPctPerWave more HP for each wave past fromWave's. */
  sendPotency: { fromWave: number; hpPctPerWave: number };
  /** Easy mode: percent on every wave's HP, and on the king's life. */
  easy: { wavePct: number; kingPct: number };
  /** The random builder: how many lines a wave's roll holds, each from a different class. */
  randomRoll: { lines: number };
  /** Percent on every wave's HP by the team's size (one lane, two, three, four): more pads of fighters rally to one king. */
  teamWavePct: number[];
  /** Co-op: the sends that arrive with each wave, by wave, onto lanes in turn. */
  coop: { sends: string[][] };
}

/** What buildGameData makes of balance.json battle: the rules and the waves built from the tables. */
export interface BattleData {
  rules: BattleJson;
  /** The 21 waves as set up by default. */
  waves: WaveDef[];
  /** The waves for a setup: the long game's 30, with or without champion packs; memoised. */
  wavesFor: (long: boolean, champions: boolean) => WaveDef[];
}

/** A finished battle wave count: every team has fought it. */
export function battleWaveCount(data: GameData): number {
  return data.waves.length;
}

const battleCache = new WeakMap<GameData, Map<string, GameData>>();

/**
 * The game data a battlefield runs on: the setup's waves (easy mode's at their percent), no
 * wave timer of its own (the match starts each wave), battle bounty and starting gold, no HP
 * curve and no loot.
 */
export function battleData(data: GameData, options: BattleOptions = DEFAULT_OPTIONS, seats = 1): GameData {
  const b = data.battle;
  if (!b) throw new Error('balance.json has no battle section');
  const teamPct = b.rules.teamWavePct[Math.min(b.rules.teamWavePct.length, Math.max(1, seats)) - 1] ?? 100;
  const pct = idiv((options.easy ? b.rules.easy.wavePct : 100) * teamPct, 100);
  const key = JSON.stringify([options.long, options.champions, pct]);
  let per = battleCache.get(data);
  if (!per) battleCache.set(data, (per = new Map()));
  const cached = per.get(key);
  if (cached) return cached;
  let waves = b.wavesFor(options.long, options.champions);
  if (pct !== 100) waves = waves.map((w) => ({ ...w, hpPct: idiv((w.hpPct ?? 100) * pct, 100) }));
  const out: GameData = {
    ...data,
    waves,
    economy: { ...data.economy, startingGold: b.rules.startingGold, buildCost: b.rules.buildCost, bountyPerLevel: b.rules.bountyPerLevel, evolveCost: b.rules.evolveCost, legend: { ...data.economy.legend, cost: b.rules.legendCost } },
    rules: { ...data.rules, bossHpPct: {}, stageHpPct: {} },
    noLoot: true,
  };
  delete out.extendWaves;
  per.set(key, out);
  return out;
}

/** A team's king's starting life, for its number of seats. */
export function kingLife(r: BattleJson, seats: number, easy = false): number {
  const hp = r.king.hp[Math.min(r.king.hp.length, Math.max(1, seats)) - 1]!;
  return easy ? idiv(hp * r.easy.kingPct, 100) : hp;
}

/** A battlefield's starting state for its team: each seat's race (or its first roll), and the king. */
export function battleStart(data: GameData, races: readonly string[], options: BattleOptions = DEFAULT_OPTIONS, seed = 0, team = 0): BattleSimState {
  const r = data.battle!.rules;
  const hp = kingLife(r, races.length, options.easy);
  const state: BattleSimState = {
    king: { hp, maxHp: hp, hpLevel: 0, regenLevel: 0, attackLevel: 0 },
    kingCooldown: 0,
    races: [...races],
    rollSeed: seed >>> 0,
    team: options.mirror ? 0 : team,
    workers: races.map(() => 0),
    shards: races.map(() => 0),
    income: races.map(() => 0),
    sendsMade: races.map(() => 0),
    leaks: races.map(() => 0),
    leakDamage: races.map(() => 0),
    bounty: races.map(() => 0),
    queued: [],
  };
  if (options.pick === 'random') state.randomRolls = races.map((_, seat) => rollOf(data, state, seat, 0));
  return state;
}

/** The key a roll holds a line under. */
export function lineKey(cls: string, line: string): string {
  return `${cls}/${line}`;
}

/**
 * One seat's roll for a wave: battle.randomRoll.lines lines, each from a different class, from
 * a stream of the match seed, the wave, the seat and the team (both teams roll alike in mirror
 * mode), so every client rolls the same and the fight's dice are untouched.
 */
export function rollOf(data: GameData, b: BattleSimState, seat: number, wave: number): string[] {
  const n = data.battle!.rules.randomRoll.lines;
  const rng = createRng((b.rollSeed ^ Math.imul(wave + 1, 0x9e3779b1) ^ Math.imul(seat + 1, 0x85ebca6b) ^ Math.imul(b.team + 1, 0xc2b2ae35)) >>> 0);
  const classes = Object.keys(data.classes);
  const out: string[] = [];
  while (out.length < Math.min(n, classes.length) && classes.length > 0) {
    const cls = classes.splice(rollInt(rng, 0, classes.length - 1), 1)[0]!;
    const lines = Object.keys(data.classes[cls]!.lines);
    if (lines.length === 0) continue;
    out.push(lineKey(cls, lines[rollInt(rng, 0, lines.length - 1)]!));
  }
  return out;
}

/** The random builder: every seat's roll for the coming wave. */
export function rollLines(sim: Sim, wave: number): void {
  const b = sim.state.battle;
  if (!b?.randomRolls) return;
  b.randomRolls = b.races.map((_, seat) => rollOf(sim.data, b, seat, wave));
}

/** The lines a seat may build this wave, as 'class/line' keys: its roll, or every line of its race. */
export function allowedLines(sim: Sim, seat: number): Set<string> {
  const b = sim.state.battle;
  if (!b) return new Set(Object.entries(sim.data.classes).flatMap(([cls, c]) => Object.keys(c.lines).map((l) => lineKey(cls, l))));
  const roll = b.randomRolls?.[seat];
  if (roll) return new Set(roll);
  const race = b.races[seat] ?? '';
  return new Set(Object.keys(sim.data.classes[race]?.lines ?? {}).map((l) => lineKey(race, l)));
}

/** Whether a seat may build a tower of `cls` with `skill` as its first pick, under its race or its roll. */
export function mayBuild(sim: Sim, seat: number, cls: string, skill?: string): boolean {
  const b = sim.state.battle;
  if (!b) return true;
  if (!b.randomRolls) return b.races[seat] === cls;
  if (!skill) return false;
  const line = Object.entries(sim.data.classes[cls]?.lines ?? {}).find(([, l]) => l.tiers[0]?.includes(skill))?.[0];
  return line !== undefined && allowedLines(sim, seat).has(lineKey(cls, line));
}

function rulesOf(sim: Sim): BattleJson {
  return sim.data.battle!.rules;
}

/** Shards are kept in thousandths; the whole shards a seat can spend. */
export function wholeShards(milli: number): number {
  return idiv(milli, 1000);
}

/** Thousandths of a shard a seat mines each tick: its workers' rate (a multiple of 20 a second). */
export function shardsPerTick(sim: Sim, seat: number): number {
  const w = rulesOf(sim).worker;
  return idiv((sim.state.battle?.workers[seat] ?? 0) * w.shardsPerSecond, TICKS_PER_SECOND);
}

/** Every tick: the workers mine. */
export function mine(sim: Sim): void {
  const b = sim.state.battle;
  if (!b) return;
  for (let seat = 0; seat < b.shards.length; seat++) b.shards[seat]! += shardsPerTick(sim, seat);
}

/** Gold for this seat's next worker. */
export function workerCost(sim: Sim, seat: number): number {
  const w = rulesOf(sim).worker;
  return w.cost + w.costPerWorker * (sim.state.battle?.workers[seat] ?? 0);
}

/** Hires a worker into the seat's back row, if there is room and gold. */
export function hire(sim: Sim, seat: number): void {
  const b = sim.state.battle;
  if (!b) return;
  const w = rulesOf(sim).worker;
  const slots = sim.map.workerSlots?.[sim.arcOwners.indexOf(seat)]?.length ?? 0;
  if (b.workers[seat]! >= Math.min(w.max, slots)) return;
  const cost = workerCost(sim, seat);
  if (sim.state.gold[seat]! < cost) return;
  sim.state.gold[seat]! -= cost;
  b.workers[seat]!++;
}

/** Gold for the king's next level of an upgrade, or undefined at its top. */
export function kingUpgradeCost(sim: Sim, upgrade: KingUpgrade): number | undefined {
  const b = sim.state.battle;
  if (!b) return undefined;
  const u = rulesOf(sim).king.upgrades[upgrade];
  const level = kingLevel(b, upgrade);
  if (level >= u.maxLevel) return undefined;
  let cost = u.cost;
  for (let i = 0; i < level; i++) cost = idiv(cost * u.costPctPerLevel, 100);
  return cost;
}

export function kingLevel(b: BattleSimState, upgrade: KingUpgrade): number {
  return upgrade === 'hp' ? b.king.hpLevel : upgrade === 'regen' ? b.king.regenLevel : b.king.attackLevel;
}

/** Any player of the team pays; the king is the team's. */
export function upgradeKing(sim: Sim, seat: number, upgrade: KingUpgrade): void {
  const b = sim.state.battle;
  const cost = kingUpgradeCost(sim, upgrade);
  if (!b || cost === undefined || sim.state.gold[seat]! < cost) return;
  sim.state.gold[seat]! -= cost;
  const add = rulesOf(sim).king.upgrades[upgrade].add;
  if (upgrade === 'hp') {
    b.king.hpLevel++;
    b.king.maxHp += add;
    b.king.hp += add;
  } else if (upgrade === 'regen') b.king.regenLevel++;
  else b.king.attackLevel++;
}

/** The king's life back every second. */
export function kingRegen(sim: Sim): number {
  const b = sim.state.battle!;
  const k = rulesOf(sim).king;
  return k.regenPerSecond + b.king.regenLevel * k.upgrades.regen.add;
}

/** The king's hit, percent of a monster's life. */
export function kingHitPct(sim: Sim, rank: Rank): number {
  const k = rulesOf(sim).king;
  const b = sim.state.battle!;
  const up = b.king.attackLevel * k.upgrades.attack.add;
  return rank === 'boss' ? k.attack.bossHitPct + idiv(up, 5) : k.attack.hitPct + up;
}

/** The seat whose lane a monster walks. */
export function seatOfMonster(sim: Sim, m: Monster): number {
  return sim.arcOwners[laneOf(sim.map, m.dist)] ?? 0;
}

/** What a creep at the king's feet takes off it with each hit: its alive weight, rising by wave. */
export function leakDamage(sim: Sim, m: Monster): number {
  const k = rulesOf(sim).king;
  return Math.max(1, idiv(sim.data.rules.aliveWeight[m.rank] * k.damagePerWeight * (100 + k.damagePctPerWave * m.wave), 100));
}

/** A small, fixed scatter for a monster, so a crowd at one spot does not stand on one point. */
function scatter(id: number): { x: number; y: number } {
  const h = Math.imul(id + 1, 2654435761) >>> 0;
  return { x: idiv(((h % 7) - 3) * UNITS_PER_TILE, 10), y: idiv((((h >>> 8) % 7) - 3) * UNITS_PER_TILE, 10) };
}

/** Where a creep stands while it fights a fighter: part way from the path to it, scattered. */
export function engagedAt(sim: Sim, m: Monster, path: { x: number; y: number }, fighter: Tower): { x: number; y: number } {
  const e = rulesOf(sim).fighter.engageTenths;
  const dx = fighter.x - path.x;
  const dy = fighter.y - path.y;
  const d = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)));
  const reach = Math.min(d, idiv(e * UNITS_PER_TILE, 10));
  const s = scatter(m.id);
  return { x: path.x + idiv(dx * reach, d) + s.x, y: path.y + idiv(dy * reach, d) + s.y };
}

/** Where a creep stands at the king's feet. */
export function atKingPoint(sim: Sim, m: Monster): { x: number; y: number } {
  const k = tileCenter(sim.map.king!);
  const s = scatter(m.id);
  return { x: k.x + s.x * 2, y: k.y + UNITS_PER_TILE + s.y * 2 };
}

/**
 * A monster at the end of its lane has reached the king: it stands at its feet and fights it
 * (updateMonsters) until one of them dies. Counted as a leak once.
 */
export function leak(sim: Sim, m: Monster): void {
  const b = sim.state.battle;
  if (!b || m.atKing) return;
  m.atKing = true;
  b.leaks[seatOfMonster(sim, m)]!++;
  const at = atKingPoint(sim, m);
  m.x = at.x;
  m.y = at.y;
  // It swings as it arrives, then on its own rate
  hitKing(sim, m);
  m.attackCooldown = sim.data.rules.monsterAttackTicks;
}

/** A creep at the king's feet swings at it. */
export function hitKing(sim: Sim, m: Monster): void {
  const b = sim.state.battle;
  if (!b) return;
  const damage = leakDamage(sim, m);
  b.king.hp -= damage;
  b.leakDamage[seatOfMonster(sim, m)]! += damage;
  (sim.kingHits ??= []).push({ x: m.x, y: m.y, damage });
}

/**
 * The king strikes the creep nearest him within his reach, on his own rate: a percent of its
 * life as magic, through every resistance. A kill pays the lane's player. Every second he
 * heals by his regeneration.
 */
export function kingStrikes(sim: Sim): void {
  const b = sim.state.battle;
  const at = sim.map.king;
  if (!b || !at) return;
  if (b.king.hp > 0 && sim.state.tick % TICKS_PER_SECOND === 0) b.king.hp = Math.min(b.king.maxHp, b.king.hp + kingRegen(sim));
  if (b.kingCooldown > 0) {
    b.kingCooldown--;
    return;
  }
  const k = rulesOf(sim).king.attack;
  const centre = tileCenter(at);
  const range = idiv(k.rangeTenths * UNITS_PER_TILE, 10);
  let best: Monster | undefined;
  let bestKey = 0;
  for (const m of sim.state.monsters) {
    if (m.hp <= 0 || distSq(centre, m) > range * range) continue;
    const key = -distSq(centre, m);
    if (!best || key > bestKey || (key === bestKey && m.id < best.id)) {
      best = m;
      bestKey = key;
    }
  }
  if (!best) return;
  b.kingCooldown = k.rateTicks - 1;
  sim.actor = seatOfMonster(sim, best);
  sim.actorTower = 0;
  (sim.kingStrikes ??= []).push({ x: best.x, y: best.y });
  dealRaw(sim, best, Math.max(256, idiv(best.maxHp * kingHitPct(sim, best.rank), 100)));
}

/** The lane a tower stands beside, or -1 for a legend's rider. */
export function laneOfTower(sim: Sim, t: Tower): number {
  return t.legendOf === undefined ? arcAt(sim.map, t.tileX, t.tileY) : -1;
}

/**
 * A fighter's life: its class's charstats life at its skill's level, times the tier and
 * mode percents, with its gear's durability on top (in 1/256 HP, like a monster's).
 */
export function fighterLife(sim: Sim, t: Tower): number {
  const f = rulesOf(sim).fighter;
  const cls = sim.data.classes[t.cls];
  const life = cls?.life ?? { base: 50, perLevel: 8 };
  const active = activeSkill(sim, t);
  const level = active ? (active.skill.skillLevels[Math.min(active.lvl, active.skill.skillLevels.length - 1)] ?? 1) : 1;
  const whole = life.base + idiv(Math.max(0, level - 1) * life.perLevel, 4);
  const tier = f.tierPct[Math.min(f.tierPct.length, Math.max(1, t.tier)) - 1] ?? 100;
  const durability = t.gear ? gearOf(sim, t).durabilityPct : 0;
  return Math.max(256, idiv(idiv(idiv(whole * 256 * f.lifePct, 100) * tier, 100) * Math.max(1, 100 + durability), 100));
}

/**
 * Every tick: each tower's life follows what it is (a level or tier bought heals as much as
 * it adds; a fresh tower stands at full), and a fighter at zero stays down.
 */
export function syncFighters(sim: Sim): void {
  if (!sim.state.battle) return;
  for (const t of sim.state.towers) {
    if (t.legendOf !== undefined) continue;
    const max = fighterLife(sim, t);
    if (t.maxHp === max && t.hp !== undefined) continue;
    const was = t.maxHp;
    if (was === undefined || t.hp === undefined) t.hp = max;
    else if (t.hp > 0) t.hp = Math.max(1, Math.min(max, t.hp + (max - was)));
    t.maxHp = max;
  }
}

/** True while a fighter stands: a tower with life left (every tower, outside a battle). */
export function standing(sim: Sim, t: Tower): boolean {
  if (!sim.state.battle) return true;
  const body = t.legendOf !== undefined ? sim.state.towers.find((x) => x.id === t.legendOf) : t;
  return (body?.hp ?? 1) > 0;
}

/** The path distance on `lane` a fighter holds: its row, or just before the king once rallied. */
export function holdDist(sim: Sim, t: Tower, lane: number): number | undefined {
  const arc = sim.map.arcs[lane];
  if (!arc) return undefined;
  if (t.atKing) return (arc.end ?? sim.map.length) - idiv(rulesOf(sim).fighter.kingHoldTenths * UNITS_PER_TILE, 10);
  if (laneOfTower(sim, t) !== lane) return undefined;
  return arc.start + t.tileY * UNITS_PER_TILE;
}

/** The first standing fighter a monster walking `step` on would run into on its lane. */
export function fighterAhead(sim: Sim, m: Monster, step: number): Tower | undefined {
  if (!sim.state.battle) return undefined;
  const lane = laneOf(sim.map, m.dist);
  const block = sim.data.rules.blockRangeUnits;
  let best: Tower | undefined;
  let bestGap = 0;
  for (const t of sim.state.towers) {
    if (t.legendOf !== undefined || (t.hp ?? 0) <= 0) continue;
    const hold = holdDist(sim, t, lane);
    if (hold === undefined) continue;
    const gap = hold - m.dist;
    if (gap <= -block || gap - block > step) continue;
    if (!best || gap < bestGap || (gap === bestGap && t.id < best.id)) {
      best = t;
      bestGap = gap;
    }
  }
  return best;
}

/** Where the i-th fighter rallied to the king stands: a ring round it, widening as it fills. */
export function kingSlot(sim: Sim, i: number): { x: number; y: number } {
  const k = tileCenter(sim.map.king!);
  // Tenths of a tile round the king, the first ring at one and a half tiles
  const ring = Math.floor(i / 8);
  const r = 15 + ring * 8;
  const spots = [[-10, -5], [10, -5], [-12, 2], [12, 2], [-6, -10], [6, -10], [-4, 8], [4, 8]] as const;
  const [sx, sy] = spots[i % 8]!;
  return { x: k.x + idiv(sx * r * UNITS_PER_TILE, 100), y: k.y + idiv(sy * r * UNITS_PER_TILE, 100) };
}

/**
 * During a fight: a lane with nothing left to walk it (no creep on it short of the king,
 * none still to spawn) sends its standing fighters to the king, where they hold the road's
 * end against the leaks.
 */
export function rally(sim: Sim): void {
  const s = sim.state;
  if (!s.battle) return;
  const busy = new Set<number>();
  for (const m of s.monsters) if (m.hp > 0 && !m.atKing) busy.add(laneOf(sim.map, m.dist));
  for (const sp of s.spawns) busy.add(laneOf(sim.map, sp.dist));
  let n = s.towers.filter((t) => t.atKing).length;
  for (const t of s.towers) {
    if (t.atKing || t.legendOf !== undefined || (t.hp ?? 0) <= 0) continue;
    if (busy.has(laneOfTower(sim, t))) continue;
    t.atKing = true;
    const at = kingSlot(sim, n++);
    t.x = at.x;
    t.y = at.y;
    for (const r of s.towers) if (r.legendOf === t.id) Object.assign(r, { x: t.x, y: t.y });
  }
}

/** The fight is over: every fighter goes home and stands again at full life. */
export function recall(sim: Sim): void {
  const s = sim.state;
  if (!s.battle) return;
  for (const t of s.towers) {
    if (t.atKing) {
      delete t.atKing;
      const c = tileCenter({ x: t.tileX, y: t.tileY });
      t.x = c.x;
      t.y = c.y;
      for (const r of s.towers) if (r.legendOf === t.id) Object.assign(r, { x: t.x, y: t.y });
    }
    if (t.legendOf === undefined && t.maxHp !== undefined) t.hp = t.maxHp;
  }
}

/** The send's def, by id. */
export function sendDef(data: GameData, id: string): SendJson | undefined {
  return data.battle?.rules.sends.find((s) => s.id === id);
}

/** A send's shard cost when it joins wave `wave` (an index from 0). */
export function sendCost(send: SendJson, wave: number): number {
  return idiv(send.cost * (100 + send.costPctPerWave * Math.max(0, wave)), 100);
}

/** Whether a seat may still make a send for the coming wave: open by then, and a boss only once. */
export function sendOpen(send: SendJson, wave: number, made: readonly string[]): boolean {
  return wave + 1 >= send.fromWave && !(send.kind === 'boss' && made.includes(send.id));
}

/** A send's HP percent when it joins wave `wave` (an index from 0): its own, raised late in the match. */
export function sendHpPct(data: GameData, send: SendJson, wave: number): number {
  const p = data.battle?.rules.sendPotency;
  const past = p ? Math.max(0, wave + 1 - p.fromWave) : 0;
  return idiv(send.hpPct * (100 + (p?.hpPctPerWave ?? 0) * past), 100);
}

/** The groups a send adds to a lane's wave (`index` from 0), at that wave's difficulty and level, `times` over. */
export function sendGroups(data: GameData, send: SendJson, wave: WaveDef, index: number, times = 1): WaveGroup[] {
  const d = wave.difficulty;
  const groups: WaveGroup[] = [];
  const hpPct = sendHpPct(data, send, index);
  const named = [send.monster].flat();
  for (let k = 0; k < Math.max(1, times); k++) {
    for (const id of named) {
      const def = data.monsters[data.monsterVariant(id, d, wave.level)]!;
      if (send.kind === 'champions') {
        groups.push({ monster: def.id, count: send.count ?? 3, spacingTicks: 20, rank: 'champion', mods: [...(send.mods ?? [])], hpPct, pack: send.id });
        continue;
      }
      if (def.minion) {
        const minion = data.monsterVariant(def.minion.monster, d, wave.level);
        groups.push({ monster: minion, count: def.minion.count, spacingTicks: 15, rank: 'normal', mods: [], hpPct, pack: id });
      }
      groups.push({ monster: def.id, count: 1, spacingTicks: 20, rank: send.kind === 'boss' ? 'boss' : 'unique', mods: [...def.mods, ...(send.mods ?? [])], hpPct, pack: id });
    }
  }
  if (groups[0]) groups[0].delayTicks = 20;
  return groups;
}

/** Pays a seat's end-of-wave gold: base income for the wave and its sends' income. */
export function payWave(sim: Sim, wave: number): void {
  const b = sim.state.battle;
  if (!b) return;
  const r = rulesOf(sim);
  for (let seat = 0; seat < b.races.length; seat++) {
    const base = r.income[wave] ?? r.income.at(-1) ?? 0;
    sim.state.gold[seat]! += idiv((base + b.income[seat]!) * racePct(sim, seat), 100);
  }
}

/** A race's percent on its gold. */
export function racePct(sim: Sim, seat: number): number {
  const race = sim.state.battle?.races[seat];
  const r = race ? sim.data.battle?.rules.races[race] : undefined;
  if (!r) return 100;
  return sim.players > 1 ? idiv(r.goldPct * (r.teamGoldPct ?? 100), 100) : r.goldPct;
}

/** True once a battlefield's wave is over: nothing alive (the king's leaks included) or still to come. */
export function fightOver(sim: Sim): boolean {
  return sim.state.monsters.length === 0 && sim.state.spawns.length === 0;
}

/** Gold a seat has in towers: what its standing towers cost it, for the scoreboard's Value. */
export function towerValue(sim: Sim, seat: number): number {
  return sim.state.towers.reduce((n, t) => n + (t.owner === seat ? t.spent : 0), 0);
}
