// The deterministic simulation. State changes only through step(), and step() takes only
// the commands for its tick. All values are integers; HP and damage are in 1/256 HP like D2.
//
// One tick, in order: commands, spawns, the aura field, monsters (abilities, movement,
// leaks), summons, towers, missiles, corpses, then the win/loss check.

import { archetypeOf } from './archetypes/index.ts';
import type { SkillDef, TowerBuff } from './archetypes/types.ts';
import { activeSkill, computeAuras, EMPTY_FIELD } from './auras.ts';
import type { GameData } from './data.ts';
import { idiv } from './fixed.ts';
import { createMap } from './map.ts';
import { decayCorpses, spawnMonsters, updateMonsters } from './monsters.ts';
export { injectMonster } from './monsters.ts';
import { createRng } from './rng.ts';
import type { Command, Sim, TimedCommand, Tower } from './state.ts';
import { updateSummons } from './archetypes/summon.ts';
import { build, evolve, pickBranch, pickSkill, sell, setTargeting, towerById, upgrade, upgradeTier } from './towers.ts';

export type * from './state.ts';
export { canBuild, evolutionFor, pendingChoices, sellValue, tierCost, towerAt, towerById, upgradeCost } from './towers.ts';
export { activeSkill } from './auras.ts';
export { damageAgainst, effectiveResist } from './combat.ts';

export interface SimOptions {
  /** Team mode zones before the last: leaks are handed on instead of costing lives. */
  passLeaks?: boolean;
}

export function createSim(data: GameData, seed: number, opts: SimOptions = {}): Sim {
  return {
    data,
    map: createMap(),
    passLeaks: opts.passLeaks ?? false,
    fx: EMPTY_FIELD,
    state: {
      tick: 0,
      rng: createRng(seed),
      gold: data.economy.startingGold,
      lives: data.economy.lives,
      wave: 0,
      status: 'playing',
      kills: 0,
      leaks: 0,
      nextId: 1,
      monsters: [],
      towers: [],
      missiles: [],
      summons: [],
      corpses: [],
      spawns: [],
      waves: [],
      passed: [],
    },
  };
}

/** Advances one tick. `commands` are the ones stamped with the current tick, in log order. */
export function step(sim: Sim, commands: readonly Command[]): void {
  const s = sim.state;
  if (s.status === 'playing') {
    for (const command of commands) applyCommand(sim, command);
    spawnMonsters(sim);
    sim.fx = computeAuras(sim);
    updateMonsters(sim);
    updateSummons(sim);
    updateTowers(sim);
    updateMissiles(sim);
    decayCorpses(sim);
    checkEnd(sim);
  }
  s.tick++;
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
  if (command.type === 'build') return build(sim, command.x, command.y, command.cls, command.skill);
  if (command.type === 'callWave') return callWave(sim);
  if (command.type === 'evolve') {
    const a = towerById(sim, command.towerA);
    const b = towerById(sim, command.towerB);
    if (a && b) evolve(sim, a, b);
    return;
  }
  const tower = towerById(sim, command.towerId);
  if (!tower) return;
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

function callWave(sim: Sim): void {
  const s = sim.state;
  const waveDef = sim.data.waves[s.wave];
  if (!waveDef) return;
  const early = s.monsters.length > 0 || s.spawns.length > 0;
  const wave = s.wave;
  let count = 0;
  let offset = 1;
  for (const group of waveDef.groups) {
    for (let i = 0; i < group.count; i++) {
      s.spawns.push({ tick: s.tick + offset, def: group.monster, wave, rank: group.rank, mods: [...group.mods], hp: group.hp ?? 0 });
      offset += group.spacingTicks;
      count++;
    }
  }
  s.spawns.sort((a, b) => a.tick - b.tick);
  s.waves.push({ remaining: count, bounty: 0, early });
  s.wave++;
}

const NO_BUFF: TowerBuff = { damagePct: 0, attackSpeedPct: 0 };

/** Ticks between actions: the rate sped up by attack speed, but never under the skill's own delay. */
export function attackInterval(sim: Sim, tower: Tower, skill: SkillDef, buff: TowerBuff): number {
  const recipe = tower.evolved ? sim.data.evolutions.find((e) => e.id === tower.evolved) : undefined;
  const rate = Math.max(1, idiv(skill.rateTicks * 100, 100 + buff.attackSpeedPct));
  return Math.max(rate, recipe?.ignoreSkillDelay ? 0 : skill.delayTicks);
}

function updateTowers(sim: Sim): void {
  for (const tower of sim.state.towers) {
    if (tower.summonCooldown > 0) tower.summonCooldown--;
    if (tower.cooldown > 0) {
      tower.cooldown--;
      continue;
    }
    const active = activeSkill(sim, tower);
    const act = active && archetypeOf(active.skill).act;
    if (!active || !act) continue;
    const buff = sim.fx.towers[tower.id] ?? NO_BUFF;
    if (act(sim, tower, active.skill, active.lvl, buff)) {
      tower.cooldown = attackInterval(sim, tower, active.skill, buff) - 1;
    }
  }
}

function updateMissiles(sim: Sim): void {
  const s = sim.state;
  const gone = new Set<number>();
  for (const missile of [...s.missiles]) {
    const skill = sim.data.skills[missile.skill]!;
    const update = archetypeOf(skill).updateMissile;
    if (!update || !update(sim, missile, skill)) gone.add(missile.id);
  }
  if (gone.size > 0) s.missiles = s.missiles.filter((m) => !gone.has(m.id));
}

function checkEnd(sim: Sim): void {
  const s = sim.state;
  if (s.lives <= 0) {
    s.status = 'lost';
  } else if (s.wave >= sim.data.waves.length && s.monsters.length === 0 && s.spawns.length === 0) {
    s.status = 'won';
  }
}
