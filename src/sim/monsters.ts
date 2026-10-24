// Monster spawning, abilities and movement. Monsters walk the ring and lap it until killed.

import { gearOf } from './items/tower.ts';
import { blockerAhead } from './archetypes/summon.ts';
import { dealRaw, distSq, monsterFx } from './combat.ts';
import { idiv } from './fixed.ts';
import { ahead, laneOf, positionAt, wrap } from './map.ts';
import { atKingPoint, engagedAt, fighterAhead, hitKing, holdDist, leak } from './battle.ts';
import { rollInt } from './rng.ts';
import type { Monster, MonsterMod, Rank, Sim, Summon } from './state.ts';

/** How long a shoved summon shows it, for the renderer. */
const SHOVE_TICKS = 10;

/**
 * HP bonus percent by rank, from monumod.txt. A boss carries its HP in monstats, scaled by
 * the campaign's boss ramp at its wave (balance.json bossHpPct).
 */
function rankHpPct(sim: Sim, rank: Rank, wave: number): number {
  if (rank === 'boss') return (sim.data.rules.bossHpPct[wave] ?? 100) - 100;
  return rank === 'champion' ? sim.data.rules.championHpPct : rank === 'unique' ? sim.data.rules.uniqueHpPct : 0;
}

export function createMonster(sim: Sim, def: string, wave: number, rank: Rank, mods: MonsterMod[], dist: number, hp?: number, groupHpPct = 100): Monster {
  const s = sim.state;
  const d = sim.data.monsters[def]!;
  const rules = sim.data.rules;
  // HP is the monster's own at its level (monlvl), with its rank's bonus: no per-wave curve
  // An endless wave scales its monsters' HP and damage on top (WaveDef hpPct, damagePct)
  const waveDef = sim.data.waves[wave];
  // and the stage's place on the HP curve (rules.stageHpPct): every rank, bosses keep their ramp on top
  // (an endless wave stands on the curve's last stage, Hell Act 5, its own ramp on top)
  const stageKey = waveDef ? (waveDef.tier !== undefined ? '2-5' : `${waveDef.difficulty}-${waveDef.act}`) : '';
  const stage = rules.stageHpPct[stageKey] ?? 100;
  // and its group's fit to the wave's pack budget (fitPacks)
  const waveHp = idiv(idiv((waveDef?.hpPct ?? 100) * stage, 100) * groupHpPct, 100);
  const maxHp = hp ?? Math.max(256, idiv(idiv(rollInt(s.rng, d.minHp, d.maxHp) * (100 + rankHpPct(sim, rank, wave)), 100) * waveHp, 100));
  let damagePct = rank === 'champion' || rank === 'unique' ? rules.championDamagePct : 0;
  for (const mod of mods) damagePct += rules.mods[mod].damagePct;
  damagePct += (waveDef?.damagePct ?? 100) - 100;
  const at = positionAt(sim.map, dist);
  return {
    id: s.nextId++,
    walked: 0,
    lastHit: 0,
    lastTower: 0,
    poisonTower: 0,
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
    bleedTicks: 0,
    bleedPerTick: 0,
    bleedBy: 0,
    bleedTower: 0,
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
    const m = createMonster(sim, spawn.def, spawn.wave, spawn.rank, spawn.mods, spawn.dist, undefined, spawn.hpPct ?? 100);
    if (spawn.cow) {
      m.cow = true;
      m.runeBoost = sim.data.cow.runeBoost;
    }
    if (spawn.pack) m.pack = spawn.pack;
    s.monsters.push(m);
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
  // Eternal Conflict: an act boss walks its one lane at a share of its pace (balance.json battle.bossSpeedPct)
  if (sim.state.battle && m.rank === 'boss') speed = idiv(speed * sim.data.battle!.rules.bossSpeedPct, 100);
  for (const mod of m.mods) speed += idiv(speed * sim.data.rules.mods[mod].speedPct, 100);
  const chill = m.chillTicks > 0 ? sim.data.rules.chillPct : 0;
  const slow = Math.min(90, Math.max(m.slowPct, chill, monsterFx(sim, m).slowPct));
  return idiv(speed * (100 - slow), 100);
}

/** Counts down timed statuses and curses, and lands this tick's poison and open wounds. True if it died. */
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
    sim.actorTower = m.poisonTower;
    dealRaw(sim, m, m.poisonPerTick);
    if (m.poisonTicks === 0) m.poisonPerTick = 0;
  }
  if (m.bleedTicks > 0 && m.hp > 0) {
    m.bleedTicks--;
    sim.actor = m.bleedBy;
    sim.actorTower = m.bleedTower;
    dealRaw(sim, m, m.bleedPerTick);
    if (m.bleedTicks === 0) m.bleedPerTick = 0;
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

    // Eternal Conflict: at the king's feet it stands and hits the king on its own rate
    if (m.atKing) {
      const at = atKingPoint(sim, m);
      m.x = at.x;
      m.y = at.y;
      if (m.attackCooldown === 0) {
        hitKing(sim, m);
        m.attackCooldown = rules.monsterAttackTicks;
      }
      continue;
    }
    const speed = speedOf(sim, m);
    // A fighter on its lane holds it: it steps off the path to fight the fighter, which it hits with its monstats damage
    const fighter = fighterAhead(sim, m, speed);
    if (fighter) {
      if (m.blockedBy !== fighter.id) {
        m.blockedBy = fighter.id;
        m.blockedTicks = 0;
      }
      m.blockedTicks++;
      const hold = holdDist(sim, fighter, laneOf(sim.map, m.dist)) ?? m.dist;
      walk(sim, m, Math.max(0, hold - m.dist - rules.blockRangeUnits));
      if (m.attackCooldown === 0) {
        const hit = rollInt(s.rng, m.minDamage, m.maxDamage);
        fighter.hp = Math.max(0, (fighter.hp ?? 0) - (hit - idiv(hit * Math.min(100, monsterFx(sim, m).damageDownPct), 100)));
        m.attackCooldown = rules.monsterAttackTicks;
      }
      const at = engagedAt(sim, m, positionAt(sim.map, m.dist), fighter);
      m.x = at.x;
      m.y = at.y;
      continue;
    }
    const blocker = blockerAhead(sim, m, speed);
    if (blocker && m.blockedBy !== blocker.id) {
      m.blockedBy = blocker.id;
      m.blockedTicks = 0;
    }
    if (blocker && m.blockedTicks >= holdTicks(sim, blocker)) {
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
        if (landsOn(sim, m, blocker)) {
          const hit = rollInt(s.rng, m.minDamage, m.maxDamage);
          blocker.hp -= hit - idiv(hit * Math.min(100, monsterFx(sim, m).damageDownPct), 100);
        }
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

/** Moves a monster `step` units on around the ring; on a battle lane, to its end and the king's feet. */
function walk(sim: Sim, m: Monster, step: number): void {
  if (sim.map.open) {
    const end = sim.map.arcs[laneOf(sim.map, m.dist)]!.end ?? sim.map.length;
    if (m.dist + step >= end - 1) {
      m.walked += Math.max(0, end - 1 - m.dist);
      m.dist = end - 1;
      m.blockedBy = 0;
      leak(sim, m);
      return;
    }
  }
  m.dist = wrap(sim.map, m.dist + step);
  m.walked += step;
}

export function decayCorpses(sim: Sim): void {
  const s = sim.state;
  for (const c of s.corpses) c.ticksLeft--;
  s.corpses = s.corpses.filter((c) => c.ticksLeft > 0);
}

/** How long a summon holds a monster before it breaks through: blockBreakTicks, and its tower's durability on top. */
function holdTicks(sim: Sim, unit: Summon): number {
  const tower = sim.state.towers.find((t) => t.id === unit.towerId);
  const durability = tower?.gear ? gearOf(sim, tower).durabilityPct : 0;
  return idiv(sim.data.rules.blockBreakTicks * Math.max(0, 100 + durability), 100);
}

/**
 * Whether a monster's swing lands on a summon, by D2's chance to hit: the monster's attack
 * rating against the summon's defence (its own monstats defence plus its tower's gear,
 * raised by Shout and other defence auras on the tower), 5% to 95%, then the gear's block.
 */
function landsOn(sim: Sim, m: Monster, unit: Summon): boolean {
  const tower = sim.state.towers.find((t) => t.id === unit.towerId);
  const gear = tower?.gear ? gearOf(sim, tower) : undefined;
  const own = sim.data.monsters[unit.def] ?? sim.data.monsters[sim.data.monsterVariant(unit.def, 0)];
  const shout = tower ? (sim.fx.towers[tower.id]?.defensePct ?? 0) : 0;
  const defense = idiv(((own?.defense ?? 0) + (gear?.defense ?? 0)) * (100 + shout), 100);
  const block = gear?.blockPct ?? 0;
  if (defense <= 0 && block <= 0) return true;
  const ar = sim.data.monsters[m.def]!.attackRating;
  const chance = defense > 0 ? Math.min(95, Math.max(5, idiv(100 * ar, Math.max(1, ar + defense)))) : 100;
  if (rollInt(sim.state.rng, 0, 99) >= chance) return false;
  return rollInt(sim.state.rng, 0, 99) >= block;
}
