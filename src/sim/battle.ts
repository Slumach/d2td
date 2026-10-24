// Battle Mode (Legion TD style): two teams, each with a lane per player running into the
// team's king, the Worldstone, with Tyrael beside it striking whatever leaks. Every number
// is balance.json battle's.
//
// Each team's battlefield is one sim on a lane map (map.ts createLaneMap): a lane is an arc
// its player owns, so building, gold and kill credit work as on a shared team ring. The
// team's king, workers, Souls and income live on that sim (state.battle); the match runs the
// phases both teams share (build, then fight), carries sends from one team to the other and
// decides the winner (match.ts). A leak walks to its lane's end and takes its alive weight off
// the king; the first king to fall loses, and after the last wave the king with more life wins.
//
// Co-op: one team against the waves, with sends arriving on balance.json battle.coop's
// schedule instead of from an enemy team.

import { dealRaw, distSq, removeMonster } from './combat.ts';
import type { GameData, WaveDef, WaveGroup } from './data.ts';
import { idiv, UNITS_PER_TILE } from './fixed.ts';
import { laneOf, tileCenter } from './map.ts';
import type { BattleSimState, KingUpgrade, Monster, MonsterMod, Rank, Sim } from './state.ts';

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

/** A send: monsters the sender adds to an enemy lane's next wave, bought with Souls. */
export interface SendJson {
  id: string;
  /** superunique: the named monster and its minions; champions: `count` champions of a monster; boss: an act boss, once a match. */
  kind: 'superunique' | 'champions' | 'boss';
  /** The superunique, boss or champion monster. Several walk one after another (the Ancients). */
  monster: string | string[];
  count?: number;
  mods?: MonsterMod[];
  /** Souls at wave 1, and the percent it rises each wave after. */
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
  /** Per level: max life (and as much healed), life back per wave, or Tyrael's percent hit. */
  add: number;
  maxLevel: number;
}

export interface BattleJson {
  /** How long a wave's stream runs (a swarm monster a second, a tank every 1.5 s). */
  streamTicks: number;
  /** An act boss walks a lane at this percent of its pace: it passes a lane once, where the ring let it lap. */
  bossSpeedPct: number;
  /** Melee towers reach at least this far (tenths of a tile): beside a lane they would swing once at what passes. */
  meleeReachTenths: number;
  /** The first build phase, every later one, and the longest a fight may run before what is left leaks. */
  firstBuildTicks: number;
  buildTicks: number;
  fightMaxTicks: number;
  startingGold: number;
  startingSouls: number;
  /** Each tower a player owns raises their next build by this percent. */
  buildCostPctPerTower: number;
  /** Kill gold: monster level times this times the rank multiplier (balance.json rankBountyMultiplier). */
  bountyPerLevel: number;
  /** Base gold paid to every player at the end of each wave, by wave. */
  income: number[];
  /** A send raises its sender's income by this much gold a wave for every Soul it cost. */
  sendIncomePerSoul: number;
  worker: { cost: number; costPerWorker: number; soulsPerWave: number; max: number };
  king: { hp: number; regenPerWave: number; damagePerWeight: number; upgrades: Record<KingUpgrade, KingUpgradeJson> };
  /** Tyrael strikes a leak in range every rateTicks for hitPct of its life (bossHitPct on bosses), magic, through every resistance. */
  tyrael: { rateTicks: number; rangeTenths: number; hitPct: number; bossHitPct: number };
  /** Per race (class): percent on its base income and kill gold, the balance lever between races. */
  races: Record<string, { goldPct: number }>;
  waves: BattleWaveJson[];
  sends: SendJson[];
  /** Co-op: the sends that arrive with each wave, by wave, onto lanes in turn. */
  coop: { sends: string[][] };
}

/** What buildGameData makes of balance.json battle: the rules and the waves built from the tables. */
export interface BattleData {
  rules: BattleJson;
  waves: WaveDef[];
}

/** A finished battle wave count: every team has fought it. */
export function battleWaveCount(data: GameData): number {
  return data.battle?.waves.length ?? 0;
}

const battleCache = new WeakMap<GameData, GameData>();

/**
 * The game data a battlefield runs on: the battle's waves, no wave timer of its own (the
 * match starts each wave), battle bounty and starting gold, no HP curve and no loot.
 */
export function battleData(data: GameData): GameData {
  const cached = battleCache.get(data);
  if (cached) return cached;
  const b = data.battle;
  if (!b) throw new Error('balance.json has no battle section');
  const out: GameData = {
    ...data,
    waves: b.waves,
    economy: { ...data.economy, startingGold: b.rules.startingGold, bountyPerLevel: b.rules.bountyPerLevel },
    rules: { ...data.rules, bossHpPct: {}, stageHpPct: {} },
    noLoot: true,
  };
  delete out.extendWaves;
  battleCache.set(data, out);
  return out;
}

/** A battlefield's starting state for its team: each seat's race, and the king. */
export function battleStart(data: GameData, races: readonly string[]): BattleSimState {
  const r = data.battle!.rules;
  return {
    king: { hp: r.king.hp, maxHp: r.king.hp, hpLevel: 0, regenLevel: 0, tyraelLevel: 0 },
    tyraelCooldown: 0,
    races: [...races],
    workers: races.map(() => 0),
    souls: races.map(() => r.startingSouls),
    income: races.map(() => 0),
    sendsMade: races.map(() => 0),
    leaks: races.map(() => 0),
    leakDamage: races.map(() => 0),
    queued: [],
  };
}

function rulesOf(sim: Sim): BattleJson {
  return sim.data.battle!.rules;
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

function kingLevel(b: BattleSimState, upgrade: KingUpgrade): number {
  return upgrade === 'hp' ? b.king.hpLevel : upgrade === 'regen' ? b.king.regenLevel : b.king.tyraelLevel;
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
  else b.king.tyraelLevel++;
}

/** The king's life back at the end of a wave. */
export function kingRegen(sim: Sim): number {
  const b = sim.state.battle!;
  const k = rulesOf(sim).king;
  return k.regenPerWave + b.king.regenLevel * k.upgrades.regen.add;
}

/** Tyrael's hit, percent of a monster's life. */
export function tyraelHitPct(sim: Sim, rank: Rank): number {
  const t = rulesOf(sim).tyrael;
  const b = sim.state.battle!;
  const up = b.king.tyraelLevel * rulesOf(sim).king.upgrades.tyrael.add;
  return rank === 'boss' ? t.bossHitPct + idiv(up, 5) : t.hitPct + up;
}

/** The seat whose lane a monster walks. */
export function seatOfMonster(sim: Sim, m: Monster): number {
  return sim.arcOwners[laneOf(sim.map, m.dist)] ?? 0;
}

/** A monster at the end of its lane reaches the king and takes its alive weight off it. */
export function leak(sim: Sim, m: Monster): void {
  const b = sim.state.battle;
  if (!b) return;
  const seat = seatOfMonster(sim, m);
  const damage = sim.data.rules.aliveWeight[m.rank] * rulesOf(sim).king.damagePerWeight;
  b.king.hp -= damage;
  b.leaks[seat]!++;
  b.leakDamage[seat]! += damage;
  (sim.kingHits ??= []).push({ x: m.x, y: m.y, damage });
  m.hp = 0;
  removeMonster(sim, m);
}

/**
 * Tyrael strikes the leak nearest the king within his reach, on his own rate: a percent of
 * its life as magic, through every resistance. A kill pays the lane's player.
 */
export function tyraelStrikes(sim: Sim): void {
  const b = sim.state.battle;
  const at = sim.map.tyrael;
  if (!b || !at) return;
  if (b.tyraelCooldown > 0) {
    b.tyraelCooldown--;
    return;
  }
  const t = rulesOf(sim).tyrael;
  const centre = tileCenter(at);
  const king = tileCenter(sim.map.king ?? at);
  const range = idiv(t.rangeTenths * UNITS_PER_TILE, 10);
  let best: Monster | undefined;
  let bestKey = 0;
  for (const m of sim.state.monsters) {
    if (m.hp <= 0 || distSq(centre, m) > range * range) continue;
    const key = -distSq(king, m);
    if (!best || key > bestKey || (key === bestKey && m.id < best.id)) {
      best = m;
      bestKey = key;
    }
  }
  if (!best) return;
  b.tyraelCooldown = t.rateTicks - 1;
  sim.actor = seatOfMonster(sim, best);
  sim.actorTower = 0;
  (sim.tyraelHits ??= []).push({ x: best.x, y: best.y });
  dealRaw(sim, best, Math.max(256, idiv(best.maxHp * tyraelHitPct(sim, best.rank), 100)));
}

/** The send's def, by id. */
export function sendDef(data: GameData, id: string): SendJson | undefined {
  return data.battle?.rules.sends.find((s) => s.id === id);
}

/** A send's Soul cost when it joins wave `wave` (an index from 0). */
export function sendCost(send: SendJson, wave: number): number {
  return idiv(send.cost * (100 + send.costPctPerWave * Math.max(0, wave)), 100);
}

/** Whether a seat may still make a send for the coming wave: open by then, and a boss only once. */
export function sendOpen(send: SendJson, wave: number, made: readonly string[]): boolean {
  return wave + 1 >= send.fromWave && !(send.kind === 'boss' && made.includes(send.id));
}

/** The groups a send adds to a lane's wave, at that wave's difficulty and level. */
export function sendGroups(data: GameData, send: SendJson, wave: WaveDef): WaveGroup[] {
  const d = wave.difficulty;
  const groups: WaveGroup[] = [];
  const named = [send.monster].flat();
  for (const id of named) {
    const def = data.monsters[data.monsterVariant(id, d, wave.level)]!;
    if (send.kind === 'champions') {
      groups.push({ monster: def.id, count: send.count ?? 3, spacingTicks: 20, rank: 'champion', mods: [...(send.mods ?? [])], hpPct: send.hpPct, pack: send.id });
      continue;
    }
    if (def.minion) {
      const minion = data.monsterVariant(def.minion.monster, d, wave.level);
      groups.push({ monster: minion, count: def.minion.count, spacingTicks: 15, rank: 'normal', mods: [], hpPct: send.hpPct, pack: id });
    }
    groups.push({ monster: def.id, count: 1, spacingTicks: 20, rank: send.kind === 'boss' ? 'boss' : 'unique', mods: [...def.mods, ...(send.mods ?? [])], hpPct: send.hpPct, pack: id });
  }
  if (groups[0]) groups[0].delayTicks = 20;
  return groups;
}

/** Pays a seat's end-of-wave gold and Souls: base income for the wave, its sends' income, its workers' Souls. */
export function payWave(sim: Sim, wave: number): void {
  const b = sim.state.battle;
  if (!b) return;
  const r = rulesOf(sim);
  for (let seat = 0; seat < b.races.length; seat++) {
    const base = r.income[wave] ?? r.income.at(-1) ?? 0;
    sim.state.gold[seat]! += idiv((base + b.income[seat]!) * racePct(sim, seat), 100);
    b.souls[seat]! += b.workers[seat]! * r.worker.soulsPerWave;
  }
  b.king.hp = Math.min(b.king.maxHp, b.king.hp + kingRegen(sim));
}

/** A race's percent on its gold. */
export function racePct(sim: Sim, seat: number): number {
  const race = sim.state.battle?.races[seat];
  return race ? (sim.data.battle?.rules.races[race]?.goldPct ?? 100) : 100;
}

/** True once a battlefield's wave is over: nothing alive or still to come. */
export function fightOver(sim: Sim): boolean {
  return sim.state.monsters.length === 0 && sim.state.spawns.length === 0;
}

/** A fight that ran its time: whatever is left reaches the king at once. */
export function leakAll(sim: Sim): void {
  sim.state.spawns = [];
  for (const m of [...sim.state.monsters]) if (m.hp > 0) leak(sim, m);
}
