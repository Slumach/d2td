// Targeting, resistance and damage. Every hit in the sim goes through dealDamage.

import type { HitFilter, MonsterAuraFx, SkillCommon, TowerBuff } from './archetypes/types.ts';
import { idiv } from './fixed.ts';
import { rollInt } from './rng.ts';
import type { Rules } from './data.ts';
import { baseMonsterId } from './difficulty.ts';
import type { Element, Monster, MonsterMod, Rank, Sim, Targeting, Tower } from './state.ts';

export interface Point {
  x: number;
  y: number;
}

export function distSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function within(a: Point, b: Point, radius: number): boolean {
  return distSq(a, b) <= radius * radius;
}

const NO_FX: MonsterAuraFx = { slowPct: 0, resistDown: {}, damageDownPct: 0 };

export function monsterFx(sim: Sim, monster: Monster): MonsterAuraFx {
  return sim.fx.monsters[monster.id] ?? NO_FX;
}

/**
 * A resistance with the mods on top, on one difficulty. A mod adds its amount, but never
 * takes the monster past its maxResist (Stone Skin on Nightmare and Hell stops short of
 * immune); on a champion, championResist lifts the resistance to at least that.
 */
export function withMods(rules: Rules, resist: number, element: Element, mods: readonly MonsterMod[], rank: Rank, difficulty: number): number {
  for (const mod of mods) {
    const r = rules.mods[mod].resist[difficulty]!;
    const add = r.add[element] ?? 0;
    if (add === 0) continue;
    const before = resist;
    resist += add;
    if (r.maxResist !== undefined) resist = Math.min(resist, Math.max(before, r.maxResist));
    if (r.championResist !== undefined && rank === 'champion') resist = Math.max(resist, r.championResist);
  }
  return resist;
}

/** Resistance before auras: monstats plus the monster's mods. */
export function baseResist(sim: Sim, monster: Monster, element: Element): number {
  const def = sim.data.monsters[monster.def]!;
  return withMods(sim.data.rules, def.resist[element], element, monster.mods, monster.rank, def.difficulty);
}


/**
 * Resistance after Conviction-style reductions. D2's rule for immunities: a monster at
 * 100% or more only loses a fifth of the reduction, so it takes a big aura to break one.
 * Monster resistance never drops below -100.
 */
export function effectiveResist(sim: Sim, monster: Monster, element: Element): number {
  const base = baseResist(sim, monster, element);
  const down = monsterFx(sim, monster).resistDown[element] ?? 0;
  const resist = base >= 100 ? base - idiv(down, 5) : base - down;
  return Math.max(-100, resist);
}

/** Damage after the hit filter (who takes full damage) and its undead/demon bonuses. */
export function filtered(sim: Sim, monster: Monster, amount: number, filter: HitFilter): number {
  const def = sim.data.monsters[monster.def]!;
  const full =
    filter.fullDamageTo === 'all' ||
    (filter.fullDamageTo === 'undead' && def.undead) ||
    (filter.fullDamageTo === 'demon' && def.demon) ||
    (filter.fullDamageTo === 'undeadDemon' && (def.undead || def.demon));
  let pct = full ? 100 : filter.otherDamagePct;
  if (def.undead) pct += idiv(pct * filter.bonusVsUndeadPct, 100);
  else if (def.demon) pct += idiv(pct * filter.bonusVsDemonPct, 100);
  return idiv(amount * pct, 100);
}

/** Final damage of one hit: filter, then resistance. 100% or more resistance is immunity. */
export function damageAgainst(sim: Sim, monster: Monster, amount: number, element: Element, filter: HitFilter): number {
  const resist = effectiveResist(sim, monster, element);
  if (resist >= 100) return 0;
  return idiv(filtered(sim, monster, amount, filter) * (100 - resist), 100);
}

/** True if a hit of this element and filter can hurt the monster at all. */
export function canHurt(sim: Sim, monster: Monster, element: Element, filter: HitFilter): boolean {
  return damageAgainst(sim, monster, 1 << 16, element, filter) > 0;
}

/** Applies a hit and kills the monster at 0 HP. Returns the damage dealt. */
export function dealDamage(
  sim: Sim,
  monster: Monster,
  amount: number,
  element: Element,
  filter: HitFilter,
): number {
  if (monster.hp <= 0) return 0;
  const dealt = damageAgainst(sim, monster, amount, element, filter);
  if (dealt > 0) monster.lastHit = sim.actor;
  monster.hp -= dealt;
  if (monster.hp <= 0) killMonster(sim, monster);
  return dealt;
}

/** Enchant's fire, as a tower's buff or a missile's snapshot of it. */
export type FireAdd = Pick<TowerBuff, 'fireMin' | 'fireMax'>;

/**
 * One hit of a skill: the damage, then what the skill carries. Poison spreads over the
 * skill's poison length instead of landing at once (a stronger dose replaces a weaker
 * one, as in D2). A hit that hurts chills for the skill's cold length and freezes for its
 * freeze length; bosses are chilled instead of frozen (house rule). Enchant's fire, when
 * the tower stands in it, lands with the hit. Returns the damage dealt now.
 */
export function strike(
  sim: Sim,
  monster: Monster,
  amount: number,
  element: Element,
  filter: HitFilter,
  skill: SkillCommon,
  lvl: number,
  fire?: FireAdd,
): number {
  if (monster.hp <= 0) return 0;
  let dealt = 0;
  const poisonTicks = element === 'pois' ? (skill.poisonTicks[lvl] ?? 0) : 0;
  if (poisonTicks > 0) {
    poison(sim, monster, damageAgainst(sim, monster, amount, element, filter), poisonTicks);
  } else {
    dealt = dealDamage(sim, monster, amount, element, filter);
  }
  if (fire && fire.fireMax > 0) dealDamage(sim, monster, rollInt(sim.state.rng, fire.fireMin, fire.fireMax), 'fire', filter);
  if (monster.hp <= 0 || (dealt === 0 && poisonTicks === 0)) return dealt;
  const freeze = skill.freezeTicks[lvl] ?? 0;
  const chill = Math.max(skill.chillTicks[lvl] ?? 0, monster.rank === 'boss' ? freeze : 0);
  if (freeze > 0 && monster.rank !== 'boss') monster.freezeTicks = Math.max(monster.freezeTicks, freeze);
  if (chill > 0) monster.chillTicks = Math.max(monster.chillTicks, chill);
  return dealt;
}

/** Poison over `ticks`, the acting player's; replaces what is left only if the new dose is bigger. */
export function poison(sim: Sim, monster: Monster, total: number, ticks: number): void {
  if (total <= 0 || total <= monster.poisonPerTick * monster.poisonTicks) return;
  monster.poisonPerTick = idiv(total + ticks - 1, ticks);
  monster.poisonTicks = ticks;
  monster.poisonBy = sim.actor;
}

/** Damage that already went through resistance (poison ticks, Static Field). */
export function dealRaw(sim: Sim, monster: Monster, amount: number): void {
  if (monster.hp <= 0 || amount <= 0) return;
  monster.lastHit = sim.actor;
  monster.hp -= amount;
  if (monster.hp <= 0) killMonster(sim, monster);
}

/** Applies the tower's aura damage bonus to a rolled amount. */
export function withBonus(amount: number, damagePct: number): number {
  return amount + idiv(amount * damagePct, 100);
}

export function bounty(sim: Sim, monster: Monster): number {
  const e = sim.data.economy;
  const mult = (monster.rank === 'boss' ? e.bossBountyMultiplier[baseMonsterId(monster.def)] : undefined) ?? e.rankBountyMultiplier[monster.rank];
  const base = monster.level * e.bountyPerLevel * mult;
  return idiv(base * sim.data.waves[monster.wave]!.bountyPermille, 1000);
}

/** A kill: its bounty goes to the player whose tower last hurt it. */
export function killMonster(sim: Sim, monster: Monster): void {
  const s = sim.state;
  monster.hp = 0;
  const gold = bounty(sim, monster);
  const killer = Math.min(monster.lastHit, s.gold.length - 1);
  s.gold[killer]! += gold;
  s.waves[monster.wave]!.bounty[killer]! += gold;
  s.kills++;
  s.corpses.push({
    id: s.nextId++,
    def: monster.def,
    rank: monster.rank,
    dist: monster.dist,
    x: monster.x,
    y: monster.y,
    maxHp: monster.maxHp,
    ticksLeft: sim.data.rules.corpseLifetimeTicks,
  });
  removeMonster(sim, monster);
}

/** Removes a killed monster and pays the wave bonus, on each player's share of its bounty, once the wave is gone. */
export function removeMonster(sim: Sim, monster: Monster): void {
  const s = sim.state;
  s.monsters = s.monsters.filter((m) => m.id !== monster.id);
  const wave = s.waves[monster.wave]!;
  wave.remaining--;
  if (wave.remaining === 0) {
    const e = sim.data.economy;
    const pct = e.waveClearBonusPct + (wave.early ? e.earlyCallBonusPct : 0);
    wave.bounty.forEach((b, p) => (s.gold[p]! += idiv(b * pct, 100)));
  }
}

export function aliveWithin(sim: Sim, center: Point, radius: number): Monster[] {
  return sim.state.monsters.filter((m) => m.hp > 0 && within(center, m, radius));
}

/** Picks a target in range by the tower's targeting mode. Ties go to the lowest id. */
export function findTarget(
  sim: Sim,
  tower: Tower,
  range: number,
  eligible: (m: Monster) => boolean,
  mode: Targeting = tower.targeting,
): Monster | undefined {
  let best: Monster | undefined;
  let bestKey = 0;
  for (const m of sim.state.monsters) {
    if (m.hp <= 0 || !within(tower, m, range) || !eligible(m)) continue;
    const key =
      mode === 'first' ? m.walked
      : mode === 'last' ? -m.walked
      : mode === 'strongest' ? m.hp
      : mode === 'weakest' ? -m.hp
      : -distSq(tower, m);
    if (!best || key > bestKey) {
      best = m;
      bestKey = key;
    }
  }
  return best;
}
