// The deterministic simulation. State changes only through step(), and step() takes only
// the commands for its tick. All values are integers; HP and damage are in 1/256 HP like D2.
//
// One ring, one or more players: single player and each FFA ring have one, a team ring one
// per player, each owning arcs. Monsters lap the ring until killed; the run is lost when
// the weight of everything alive reaches rules.aliveLimit.
//
// One tick, in order: commands, spawns, the aura field, monsters (abilities, movement),
// summons, towers, missiles, corpses, the alive count, then the win/loss check.

import { archetypeOf } from './archetypes/index.ts';
import type { SkillDef, TowerBuff } from './archetypes/types.ts';
import { activeSkill, computeAuras, EMPTY_FIELD } from './auras.ts';
import type { GameData, WaveDef } from './data.ts';
import { TICKS_PER_SECOND, idiv } from './fixed.ts';
import { ARC_COUNT, createMap } from './map.ts';
import { decayCorpses, spawnMonsters, updateMonsters } from './monsters.ts';
import { createRng } from './rng.ts';
import type { Command, Sim, TimedCommand, Tower } from './state.ts';
import { updateSummons } from './archetypes/summon.ts';
import { geared, gearOf, withGear } from './items/tower.ts';
import { collectCleared, pickup, sellDrop } from './items/loot.ts';
import { cowWavesDue, openCowPortal, startCowWave } from './cow.ts';
import { equip, fromBelt, hammer, loadInventory, moveItem, sellItem, socket, stashIn, stashOut, toBelt, unequip } from './items/inventory.ts';
import { build, evolve, pickBranch, pickSkill, sell, setTargeting, towerById, upgrade, upgradeTier } from './towers.ts';

export type * from './state.ts';
export { buildCostFor, canBuild, evolutionFor, pendingChoices, sellValue, tierCost, towerAt, towerById, upgradeCost } from './towers.ts';
export { activeSkill } from './auras.ts';
export { damageAgainst, effectiveResist } from './combat.ts';

export interface SimOptions {
  /**
   * Players sharing this ring (team mode), 1 to ARC_COUNT. Player p owns arc p; with fewer
   * players than arcs the rest go round, so the whole ring is always someone's.
   */
  players?: number;
}

export function createSim(data: GameData, seed: number, opts: SimOptions = {}): Sim {
  const players = opts.players ?? 1;
  if (players < 1 || players > ARC_COUNT) throw new Error(`A ring takes 1 to ${ARC_COUNT} players, not ${players}`);
  return {
    data,
    map: createMap(),
    players,
    arcOwners: Array.from({ length: ARC_COUNT }, (_, k) => k % players),
    fx: EMPTY_FIELD,
    actor: 0,
    actorTower: 0,
    state: {
      tick: 0,
      rng: createRng(seed),
      gold: Array.from({ length: players }, () => data.economy.startingGold),
      alive: 0,
      wave: 0,
      nextWaveTick: data.economy.firstWaveTicks,
      status: 'playing',
      kills: 0,
      killsBy: Array.from({ length: players }, () => 0),
      waveKillsBy: Array.from({ length: players }, () => 0),
      waveSize: 0,
      nextId: 1,
      monsters: [],
      towers: [],
      missiles: [],
      summons: [],
      corpses: [],
      dropRng: createRng((seed ^ 0x5eed_d209) >>> 0),
      drops: [],
      inventories: Array.from({ length: players }, () => []),
      homeward: Array.from({ length: players }, () => []),
      belts: Array.from({ length: players }, () => [null, null, null, null]),
      spawns: [],
      waves: [],
    },
  };
}

/** Advances one tick. `commands` are the ones stamped with the current tick, in log order. */
export function step(sim: Sim, commands: readonly Command[]): void {
  const s = sim.state;
  if (s.status === 'playing') {
    for (const command of commands) applyCommand(sim, command);
    // Waves run on a fixed timer, whether the last one is dead or not; an open cow portal
    // takes the timer for its three waves
    if (s.tick >= s.nextWaveTick) {
      if (cowWavesDue(sim)) startCowWave(sim);
      else startWave(sim);
    }
    spawnMonsters(sim);
    sim.fx = computeAuras(sim);
    updateMonsters(sim);
    updateSummons(sim);
    updateTowers(sim);
    updateMissiles(sim);
    decayCorpses(sim);
    collectCleared(sim);
    s.alive = aliveWeight(sim);
    checkEnd(sim);
  }
  s.tick++;
}

/** The weight of every monster on the ring (rules.aliveWeight by rank). */
export function aliveWeight(sim: Sim): number {
  const w = sim.data.rules.aliveWeight;
  // A cow weighs 1, the Cow King included
  return sim.state.monsters.reduce((n, m) => n + (m.hp > 0 ? (m.cow ? 1 : w[m.rank]) : 0), 0);
}

/** Runs a command log up to (not including) `untilTick`. The log must be sorted by tick. */
export function runLog(sim: Sim, log: readonly TimedCommand[], untilTick: number, onTick?: (sim: Sim) => void): void {
  let i = 0;
  while (i < log.length && log[i]!.tick < sim.state.tick) i++;
  while (sim.state.tick < untilTick) {
    const now: Command[] = [];
    while (i < log.length && log[i]!.tick === sim.state.tick) now.push(log[i++]!.command);
    step(sim, now);
    onTick?.(sim);
  }
}

function applyCommand(sim: Sim, command: Command): void {
  const player = command.player ?? 0;
  if (player < 0 || player >= sim.players) return;
  if (command.type === 'build') return build(sim, player, command.x, command.y, command.cls, command.skill);
  if (command.type === 'callWave') return sendEarly(sim);
  if (command.type === 'pickup') return pickup(sim, player, command.dropId);
  if (command.type === 'sellDrop') return sellDrop(sim, player, command.dropId);
  if (command.type === 'cowPortal') return openCowPortal(sim, player, command.uid);
  switch (command.type) {
    case 'loadInventory':
      return loadInventory(sim, player, command.items, command.belt);
    case 'toBelt':
      return toBelt(sim, player, command.uid, command.slot);
    case 'fromBelt':
      return fromBelt(sim, player, command.slot, command.x, command.y);
    case 'moveItem':
      return moveItem(sim, player, command.uid, command.x, command.y);
    case 'stashIn':
      return stashIn(sim, player, command.uid);
    case 'stashOut':
      return stashOut(sim, player, command.item, command.x, command.y);
    case 'equip':
      return equip(sim, player, command.towerId, command.slot, command.item);
    case 'unequip': {
      const to = command.toStash ? 'stash' : command.x !== undefined && command.y !== undefined ? { x: command.x, y: command.y } : undefined;
      return unequip(sim, player, command.towerId, command.slot, to);
    }
    case 'socket':
      return socket(sim, player, command.target, command.uid);
    case 'hammer':
      return hammer(sim, player, command.target, command.uid);
    case 'sellItem':
      return sellItem(sim, player, command.uid);
    case 'tradeOpen':
    case 'tradeOffer':
    case 'tradeAccept':
    case 'tradeCancel':
      // The match handles trades: they span rings
      return;
  }
  if (command.type === 'evolve') {
    const a = towerById(sim, command.towerA);
    const b = towerById(sim, command.towerB);
    if (a && b && a.owner === player) evolve(sim, a, b);
    return;
  }
  const tower = towerById(sim, command.towerId);
  if (!tower || tower.owner !== player) return;
  switch (command.type) {
    case 'pickSkill':
      return pickSkill(sim, tower, command.skill);
    case 'upgrade':
      return upgrade(sim, tower);
    case 'upgradeTier':
      return upgradeTier(sim, tower);
    case 'pickBranch':
      return pickBranch(sim, tower, command.skill);
    case 'setTargeting':
      return setTargeting(tower, command.mode);
    case 'sell':
      return sell(sim, tower);
  }
}

/**
 * Send Next Wave: the next wave starts now instead of when the timer runs out, and every
 * player on the ring is paid for the time it skipped (economy.earlySendGoldPerTenLevels a
 * second, per ten levels of the wave's monster).
 */
/** The wave at an index, building endless waves as the run reaches them. */
export function waveAt(sim: Sim, index: number): WaveDef | undefined {
  sim.data.extendWaves?.(index + 1);
  return sim.data.waves[index];
}

function sendEarly(sim: Sim): void {
  const s = sim.state;
  if (!waveAt(sim, s.wave)) return;
  const bonus = earlySendBonus(sim);
  for (let p = 0; p < s.gold.length; p++) s.gold[p]! += bonus;
  startWave(sim);
}

/** Gold Send Next Wave would pay each player right now. */
export function earlySendBonus(sim: Sim): number {
  const s = sim.state;
  const waveDef = waveAt(sim, s.wave);
  if (!waveDef) return 0;
  const seconds = idiv(Math.max(0, s.nextWaveTick - s.tick), TICKS_PER_SECOND);
  return idiv(seconds * sim.data.economy.earlySendGoldPerTenLevels * waveDef.level, 10);
}

/**
 * The next wave enters the ring, and the timer restarts for the one after. On a shared
 * ring every player's arc spawns the whole wave at its spawn point; a single player owns
 * every arc, so their wave is dealt out over the four spawn points a group at a time.
 */
function startWave(sim: Sim): void {
  const s = sim.state;
  const waveDef = waveAt(sim, s.wave);
  s.nextWaveTick = s.tick + sim.data.economy.waveTicks;
  if (!waveDef) return;
  const wave = s.wave;
  let count = 0;
  for (let p = 0; p < sim.players; p++) {
    let offset = 1;
    waveDef.groups.forEach((group, g) => {
      const arc = sim.players === 1 ? g % ARC_COUNT : p;
      const dist = sim.map.arcs[arc]!.spawn;
      offset += group.delayTicks ?? 0;
      for (let i = 0; i < group.count; i++) {
        s.spawns.push({ tick: s.tick + offset, def: group.monster, wave, rank: group.rank, mods: [...group.mods], dist, ...(group.pack ? { pack: group.pack } : {}) });
        offset += group.spacingTicks;
        count++;
      }
    });
  }
  s.spawns.sort((a, b) => a.tick - b.tick);
  s.waves.push({ remaining: count });
  s.wave++;
  s.waveSize = count;
  s.waveKillsBy.fill(0);
}

const NO_BUFF: TowerBuff = { damagePct: 0, attackSpeedPct: 0, fireMin: 0, fireMax: 0 };

/** Ticks between actions: the rate sped up by attack speed, but never under the skill's own delay. */
export function attackInterval(sim: Sim, tower: Tower, skill: SkillDef, lvl: number, buff: TowerBuff): number {
  const recipe = tower.evolved ? sim.data.evolutions.find((e) => e.id === tower.evolved) : undefined;
  const rate = Math.max(1, idiv((skill.rates[lvl] ?? skill.rateTicks) * 100, 100 + buff.attackSpeedPct));
  return Math.max(rate, recipe?.ignoreSkillDelay ? 0 : skill.delayTicks);
}

/**
 * Towers act. An evolved tower also casts its partner's skill on its own cooldown when
 * that skill does something by itself (a curse, Frozen Orb, Thunder Storm); a partner
 * aura instead projects from the tower at half radius (see auras.ts).
 */
function updateTowers(sim: Sim): void {
  for (const tower of sim.state.towers) {
    sim.actor = tower.owner;
    sim.actorTower = tower.id;
    if (tower.summonCooldown > 0) tower.summonCooldown--;
    const auraBuff = sim.fx.towers[tower.id] ?? NO_BUFF;
    const gear = gearOf(sim, tower);
    if (tower.evolved && tower.partnerSkill) {
      const partner = geared(sim, tower, sim.data.skills[tower.partnerSkill]!);
      const act = archetypeOf(partner).act;
      const buff = withGear(auraBuff, gear, partner);
      if (tower.partnerCooldown > 0) tower.partnerCooldown--;
      else if (act && act(sim, tower, partner, tower.partnerLevel, buff)) {
        tower.partnerCooldown = attackInterval(sim, tower, partner, tower.partnerLevel, buff) - 1;
      }
    }
    if (tower.cooldown > 0) {
      tower.cooldown--;
      continue;
    }
    const active = activeSkill(sim, tower);
    const act = active && archetypeOf(active.skill).act;
    if (!active || !act) continue;
    const buff = withGear(auraBuff, gear, active.skill);
    if (act(sim, tower, active.skill, active.lvl, buff)) {
      tower.cooldown = attackInterval(sim, tower, active.skill, active.lvl, buff) - 1;
    }
  }
}

function updateMissiles(sim: Sim): void {
  const s = sim.state;
  const gone = new Set<number>();
  for (const missile of [...s.missiles]) {
    sim.actor = towerById(sim, missile.towerId)?.owner ?? 0;
    sim.actorTower = missile.towerId;
    const skill = sim.data.skills[missile.skill]!;
    const update = archetypeOf(skill).updateMissile;
    if (!update || !update(sim, missile, skill)) gone.add(missile.id);
  }
  if (gone.size > 0) s.missiles = s.missiles.filter((m) => !gone.has(m.id));
}

function checkEnd(sim: Sim): void {
  const s = sim.state;
  if (s.alive >= sim.data.rules.aliveLimit) {
    s.status = 'lost';
  } else if (!sim.data.extendWaves && s.wave >= sim.data.waves.length && s.monsters.length === 0 && s.spawns.length === 0) {
    // A run with endless waves never ends in a win: only a fixed-length run (tests, tools) does
    s.status = 'won';
  }
}
