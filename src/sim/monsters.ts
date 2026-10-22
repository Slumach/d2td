// Monster spawning, abilities and movement. Monsters walk the ring and lap it until killed.

import { blockerAhead } from './archetypes/summon.ts';
import { dealRaw, distSq, monsterFx } from './combat.ts';
import { idiv } from './fixed.ts';
import { ahead, positionAt, wrap } from './map.ts';
import { rollInt } from './rng.ts';
import type { Monster, MonsterMod, Rank, Sim } from './state.ts';

/** How long a shoved summon shows it, for the renderer. */
const SHOVE_TICKS = 10;

/** HP bonus percent by rank, from monumod.txt. Bosses carry their HP in monstats. */
function rankHpPct(sim: Sim, rank: Rank): number {
  return rank === 'champion' ? sim.data.rules.championHpPct : rank === 'unique' ? sim.data.rules.uniqueHpPct : 0;
}

export function createMonster(sim: Sim, def: string, wave: number, rank: Rank, mods: MonsterMod[], dist: number, hp?: number): Monster {
  const s = sim.state;
  const d = sim.data.monsters[def]!;
  const rules = sim.data.rules;
  // HP is the monster's own at its level (monlvl), with its rank's bonus: no per-wave curve
  const maxHp = hp ?? Math.max(256, idiv(rollInt(s.rng, d.minHp, d.maxHp) * (100 + rankHpPct(sim, rank)), 100));
  let damagePct = rank === 'champion' || rank === 'unique' ? rules.championDamagePct : 0;
  for (const mod of mods) damagePct += rules.mods[mod].damagePct;
  const at = positionAt(sim.map, dist);
  return {
    id: s.nextId++,
    walked: 0,
    lastHit: 0,
    poisonBy: 0,
    def,
    wave,
    rank,
    mods,
    level: d.level,
    hp: maxHp,
    maxHp,
    minDamage: d.minDamage + idiv(d.minDamage * damagePct, 100),
    maxDamage: d.maxDamage + idiv(d.maxDamage * damagePct, 100),
    dist: wrap(sim.map, dist),
    x: at.x,
    y: at.y,
    slowPct: 0,
    slowTicks: 0,
    stunTicks: 0,
    chillTicks: 0,
    freezeTicks: 0,
    poisonTicks: 0,
    poisonPerTick: 0,
    curses: [],
    attackCooldown: 0,
    abilityCooldown: d.aiDelayTicks,
    castTicks: 0,
    castCorpse: 0,
    blockedBy: 0,
    blockedTicks: 0,
    brokeThrough: [],
  };
}

export function spawnMonsters(sim: Sim): void {
  const s = sim.state;
  while (s.spawns.length > 0 && s.spawns[0]!.tick <= s.tick) {
    const spawn = s.spawns.shift()!;
    s.monsters.push(createMonster(sim, spawn.def, spawn.wave, spawn.rank, spawn.mods, spawn.dist));
  }
}

/**
 * Fallen Shaman, from its monstats AI row: every AI decision (aidel) it has an aip1
 * percent chance to start raising a corpse of its monType within aip4. It stands still
 * for its resurrect sequence, then the corpse rises into the Shaman's own wave.
 * Returns true while it is casting, so it does not walk.
 */
function resurrect(sim: Sim, shaman: Monster): boolean {
  const ability = sim.data.monsters[shaman.def]!.resurrect;
  if (!ability) return false;
  const s = sim.state;

  if (shaman.castTicks > 0) {
    if (--shaman.castTicks > 0) return true;
    const corpse = s.corpses.find((c) => c.id === shaman.castCorpse);
    shaman.castCorpse = 0;
    if (corpse) {
      s.corpses = s.corpses.filter((c) => c.id !== corpse.id);
      s.monsters.push(createMonster(sim, corpse.def, shaman.wave, 'normal', [], corpse.dist, corpse.maxHp));
      s.waves[shaman.wave]!.remaining++;
    }
    return false;
  }

  if (--shaman.abilityCooldown > 0) return false;
  shaman.abilityCooldown = sim.data.monsters[shaman.def]!.aiDelayTicks;
  const corpse = s.corpses.find((c) => {
    const def = sim.data.monsters[c.def];
    return def && ability.monTypes.includes(def.monType) && !def.resurrect && distSq(shaman, c) <= ability.radiusUnits * ability.radiusUnits;
  });
  if (!corpse || rollInt(s.rng, 1, 100) > ability.chancePct) return false;
  shaman.castTicks = ability.castTicks;
  shaman.castCorpse = corpse.id;
  return true;
}

export function speedOf(sim: Sim, m: Monster): number {
  let speed = sim.data.monsters[m.def]!.speed;
  for (const mod of m.mods) speed += idiv(speed * sim.data.rules.mods[mod].speedPct, 100);
  const chill = m.chillTicks > 0 ? sim.data.rules.chillPct : 0;
  const slow = Math.min(90, Math.max(m.slowPct, chill, monsterFx(sim, m).slowPct));
  return idiv(speed * (100 - slow), 100);
}

/** Counts down timed statuses and curses, and lands this tick's poison. True if it died. */
function tickStatuses(sim: Sim, m: Monster): boolean {
  if (m.slowTicks > 0 && --m.slowTicks === 0) m.slowPct = 0;
  if (m.chillTicks > 0) m.chillTicks--;
  if (m.curses.length > 0) {
    for (const c of m.curses) c.ticksLeft--;
    m.curses = m.curses.filter((c) => c.ticksLeft > 0);
  }
  if (m.poisonTicks > 0) {
    m.poisonTicks--;
    sim.actor = m.poisonBy;
    dealRaw(sim, m, m.poisonPerTick);
    if (m.poisonTicks === 0) m.poisonPerTick = 0;
  }
  return m.hp <= 0;
}

export function updateMonsters(sim: Sim): void {
  const s = sim.state;
  const rules = sim.data.rules;
  for (const m of [...s.monsters]) {
    if (m.hp <= 0) continue;
    if (m.attackCooldown > 0) m.attackCooldown--;
    if (tickStatuses(sim, m)) continue;
    if (m.stunTicks > 0) {
      m.stunTicks--;
      continue;
    }
    if (m.freezeTicks > 0) {
      m.freezeTicks--;
      continue;
    }
    if (resurrect(sim, m)) continue;

    const speed = speedOf(sim, m);
    const blocker = blockerAhead(sim, m, speed);
    if (blocker && m.blockedBy !== blocker.id) {
      m.blockedBy = blocker.id;
      m.blockedTicks = 0;
    }
    if (blocker && m.blockedTicks >= rules.blockBreakTicks) {
      // Held long enough: it breaks through and shoves the summon aside, which survives
      m.brokeThrough = [...m.brokeThrough.filter((id) => s.summons.some((u) => u.id === id)), blocker.id];
      m.blockedBy = 0;
      m.blockedTicks = 0;
      blocker.shovedTicks = SHOVE_TICKS;
      walk(sim, m, speed);
    } else if (blocker) {
      // Stop at the blocker and fight it
      m.blockedTicks++;
      walk(sim, m, Math.max(0, ahead(sim.map, m.dist, blocker.dist) - rules.blockRangeUnits));
      if (m.attackCooldown === 0) {
        const hit = rollInt(s.rng, m.minDamage, m.maxDamage);
        blocker.hp -= hit - idiv(hit * Math.min(100, monsterFx(sim, m).damageDownPct), 100);
        m.attackCooldown = rules.monsterAttackTicks;
      }
    } else {
      m.blockedBy = 0;
      m.blockedTicks = 0;
      walk(sim, m, speed);
    }
    const p = positionAt(sim.map, m.dist);
    m.x = p.x;
    m.y = p.y;
  }
}

/** Moves a monster `step` units on around the ring. */
function walk(sim: Sim, m: Monster, step: number): void {
  m.dist = wrap(sim.map, m.dist + step);
  m.walked += step;
}

export function decayCorpses(sim: Sim): void {
  const s = sim.state;
  for (const c of s.corpses) c.ticksLeft--;
  s.corpses = s.corpses.filter((c) => c.ticksLeft > 0);
}

