// Monster spawning, abilities, movement and leaks.

import { blockerAhead } from './archetypes/summon.ts';
import { distSq, monsterFx, removeMonster } from './combat.ts';
import { idiv } from './fixed.ts';
import { positionAt } from './map.ts';
import { rollInt } from './rng.ts';
import type { Monster, MonsterMod, Rank, Sim } from './state.ts';

/** HP bonus percent by rank, from monumod.txt. Bosses carry their HP in monstats. */
function rankHpPct(sim: Sim, rank: Rank): number {
  return rank === 'champion' ? sim.data.rules.championHpPct : rank === 'unique' ? sim.data.rules.uniqueHpPct : 0;
}

export function createMonster(sim: Sim, def: string, wave: number, rank: Rank, mods: MonsterMod[], dist: number, hp?: number): Monster {
  const s = sim.state;
  const d = sim.data.monsters[def]!;
  const rules = sim.data.rules;
  const rolled = hp ?? idiv(rollInt(s.rng, d.minHp, d.maxHp) * (100 + rankHpPct(sim, rank)), 100);
  const maxHp = hp ?? Math.max(256, idiv(rolled * sim.data.waves[wave]!.hpPermille, 1000));
  let damagePct = rank === 'champion' || rank === 'unique' ? rules.championDamagePct : 0;
  for (const mod of mods) damagePct += rules.mods[mod].damagePct;
  const at = positionAt(sim.map, dist);
  return {
    id: s.nextId++,
    def,
    wave,
    rank,
    mods,
    level: d.level,
    hp: maxHp,
    maxHp,
    minDamage: d.minDamage + idiv(d.minDamage * damagePct, 100),
    maxDamage: d.maxDamage + idiv(d.maxDamage * damagePct, 100),
    dist,
    x: at.x,
    y: at.y,
    slowPct: 0,
    slowTicks: 0,
    stunTicks: 0,
    attackCooldown: 0,
    abilityCooldown: d.aiDelayTicks,
    castTicks: 0,
    castCorpse: 0,
  };
}

export function spawnMonsters(sim: Sim): void {
  const s = sim.state;
  while (s.spawns.length > 0 && s.spawns[0]!.tick <= s.tick) {
    const spawn = s.spawns.shift()!;
    s.monsters.push(createMonster(sim, spawn.def, spawn.wave, spawn.rank, spawn.mods, 0, spawn.hp || undefined));
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
    return def && def.monType === ability.monType && !def.resurrect && distSq(shaman, c) <= ability.radiusUnits * ability.radiusUnits;
  });
  if (!corpse || rollInt(s.rng, 1, 100) > ability.chancePct) return false;
  shaman.castTicks = ability.castTicks;
  shaman.castCorpse = corpse.id;
  return true;
}

export function speedOf(sim: Sim, m: Monster): number {
  let speed = sim.data.monsters[m.def]!.speed;
  for (const mod of m.mods) speed += idiv(speed * sim.data.rules.mods[mod].speedPct, 100);
  const slow = Math.min(90, Math.max(m.slowPct, monsterFx(sim, m).slowPct));
  return idiv(speed * (100 - slow), 100);
}

export function updateMonsters(sim: Sim): void {
  const s = sim.state;
  const rules = sim.data.rules;
  for (const m of [...s.monsters]) {
    if (m.hp <= 0) continue;
    if (m.attackCooldown > 0) m.attackCooldown--;
    if (m.slowTicks > 0 && --m.slowTicks === 0) m.slowPct = 0;
    if (m.stunTicks > 0) {
      m.stunTicks--;
      continue;
    }
    if (resurrect(sim, m)) continue;

    const speed = speedOf(sim, m);
    const blocker = blockerAhead(sim, m.dist, m.dist + speed);
    if (blocker) {
      // Stop at the blocker and fight it
      m.dist = Math.max(m.dist, blocker.dist - rules.blockRangeUnits);
      if (m.attackCooldown === 0) {
        blocker.hp -= rollInt(s.rng, m.minDamage, m.maxDamage);
        m.attackCooldown = rules.monsterAttackTicks;
      }
    } else {
      m.dist += speed;
    }
    const p = positionAt(sim.map, m.dist);
    m.x = p.x;
    m.y = p.y;
  }

  for (const m of s.monsters.filter((x) => x.dist >= sim.map.length)) {
    const e = sim.data.economy;
    s.lives = Math.max(0, s.lives - (m.rank === 'boss' ? e.bossLeakCost : e.leakCost));
    s.leaks++;
    removeMonster(sim, m);
  }
}

export function decayCorpses(sim: Sim): void {
  const s = sim.state;
  for (const c of s.corpses) c.ticksLeft--;
  s.corpses = s.corpses.filter((c) => c.ticksLeft > 0);
}
