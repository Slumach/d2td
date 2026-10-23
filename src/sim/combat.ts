// Targeting, resistance and damage. Every hit in the sim goes through dealDamage.

import { dropLoot } from './items/loot.ts';
import { cowGone } from './cow.ts';
import { gearOf } from './items/tower.ts';
import { NO_GEAR, type TowerGear } from './items/gear.ts';
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


/** The gear of the tower acting now (sim.actorTower): its hits carry its items' resistance cuts and pierce. */
export function actorGear(sim: Sim): TowerGear {
  if (!sim.actorTower) return NO_GEAR;
  const tower = sim.state.towers.find((t) => t.id === sim.actorTower);
  return tower ? gearOf(sim, tower) : NO_GEAR;
}

/**
 * Resistance after the reductions, by D2's rules. The reductions on the monster (Conviction,
 * Lower Resist and the other curses) are the only ones that break an immunity: a monster at
 * 100% or more loses a fifth of them, and is immune still unless that fifth brings it under
 * 100. The acting tower's -% to enemy resistance from its items then applies at full value,
 * but only to a monster that is not immune. Monster resistance never drops below -100.
 */
export function effectiveResist(sim: Sim, monster: Monster, element: Element): number {
  const base = baseResist(sim, monster, element);
  const down = monsterFx(sim, monster).resistDown[element] ?? 0;
  let resist = base >= 100 ? base - idiv(down, 5) : base - down;
  if (resist < 100) resist -= actorGear(sim).resistDown[element] ?? 0;
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
  if (dealt > 0) {
    monster.lastHit = sim.actor;
    monster.lastTower = sim.actorTower;
  }
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
  monster.poisonTower = sim.actorTower;
}

/**
 * Open wounds: D2's bleed, `total` over `ticks`, unreduced by resistance. A new wound
 * refreshes the time and never stacks; a stronger bleed replaces a weaker one.
 */
export function bleed(sim: Sim, monster: Monster, total: number, ticks: number): void {
  if (total <= 0 || monster.hp <= 0) return;
  monster.bleedPerTick = Math.max(monster.bleedPerTick, idiv(total + ticks - 1, ticks));
  monster.bleedTicks = ticks;
  monster.bleedBy = sim.actor;
  monster.bleedTower = sim.actorTower;
}

/** Damage that already went through resistance (poison ticks, Static Field, open wounds). */
export function dealRaw(sim: Sim, monster: Monster, amount: number): void {
  if (monster.hp <= 0 || amount <= 0) return;
  monster.lastHit = sim.actor;
  monster.lastTower = sim.actorTower;
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
  return monster.level * e.bountyPerLevel * mult;
}

/** A kill: its bounty goes to the player whose tower last hurt it. */
export function killMonster(sim: Sim, monster: Monster): void {
  const s = sim.state;
  monster.hp = 0;
  // Gold find on the killing tower's gear adds to the bounty, as in D2
  const by = monster.lastTower ? s.towers.find((t) => t.id === monster.lastTower) : undefined;
  const gear = by ? gearOf(sim, by) : NO_GEAR;
  // Find Item's aura on the monster adds to the killer's gold find
  const gold = bounty(sim, monster) + idiv(bounty(sim, monster) * (gear.goldFindPct + (monsterFx(sim, monster).goldPct ?? 0)), 100);
  const killer = Math.min(monster.lastHit, s.gold.length - 1);
  s.gold[killer]! += gold;
  sim.paid.push({ x: monster.x, y: monster.y, gold, player: killer, hp: monster.maxHp, tower: monster.lastTower });
  s.kills++;
  s.killsBy[killer]!++;
  s.waveKillsBy[killer]!++;
  // Slain Monsters Rest in Peace: the killer's gear leaves no corpse to raise or explode
  if (!gear.restInPeace) {
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
  }
  dropLoot(sim, monster);
  removeMonster(sim, monster);
}

/** Takes a killed monster off the ring and off its wave's count. */
export function removeMonster(sim: Sim, monster: Monster): void {
  const s = sim.state;
  s.monsters = s.monsters.filter((m) => m.id !== monster.id);
  // A cow counts on the cow level, not on the campaign wave whose scaling it carries
  if (monster.cow) cowGone(sim);
  else s.waves[monster.wave]!.remaining--;
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
