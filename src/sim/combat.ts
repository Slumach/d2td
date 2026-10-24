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

/**
 * Final damage of one hit: filter, then resistance (100% or more is immunity), then the acting
 * tower's converted gear: +% of the hit's element (the resistances) and +% against champions
 * and uniques (attack rating).
 */
export function damageAgainst(sim: Sim, monster: Monster, amount: number, element: Element, filter: HitFilter): number {
  const resist = effectiveResist(sim, monster, element);
  if (resist >= 100) return 0;
  const dealt = raceDamage(sim, idiv(filtered(sim, monster, amount, filter) * (100 - resist), 100));
  const gear = actorGear(sim);
  if (gear === NO_GEAR) return dealt;
  const elite = monster.rank === 'champion' || monster.rank === 'unique' ? gear.eliteDamagePct : 0;
  return idiv(dealt * Math.max(0, 100 + (gear.elementDamagePct[element] ?? 0) + elite), 100);
}

/**
 * Eternal Conflict: a tower's hit takes its race's damage percent (balance.json battle.races
 * damagePct), the lever for a class whose towers lean on the items Eternal Conflict leaves out.
 */
function raceDamage(sim: Sim, amount: number): number {
  const race = sim.state.battle && sim.actorTower ? sim.state.battle.races[sim.actor] : undefined;
  const pct = race ? (sim.data.battle?.rules.races[race]?.damagePct ?? 100) : 100;
  return pct === 100 ? amount : idiv(amount * pct, 100);
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
  else if (dealt > 0) gearOnHit(sim, monster);
  return dealt;
}

/** How long an item's slow holds after a hit: D2 keeps it while the hits keep coming; two seconds here. */
export const ITEM_SLOW_TICKS = 40;

/**
 * Every tower's hit that hurts carries its gear's slow (slow target, knockback, flee) and its
 * blind's chance to stun for itemStunTicks; bosses are slowed but never stunned.
 */
function gearOnHit(sim: Sim, monster: Monster): void {
  const gear = actorGear(sim);
  if (gear === NO_GEAR) return;
  if (gear.slowPct > 0) {
    monster.slowPct = Math.max(monster.slowPct, gear.slowPct);
    monster.slowTicks = Math.max(monster.slowTicks, ITEM_SLOW_TICKS);
  }
  if (gear.stunChancePct > 0 && monster.rank !== 'boss' && rollInt(sim.state.rng, 0, 99) < gear.stunChancePct) {
    monster.stunTicks = Math.max(monster.stunTicks, sim.data.itemStunTicks);
  }
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

/** Crushing blow never takes more than this many times the hit's own damage. */
export const CRUSHING_BLOW_CAP = 25;

/**
 * Crushing blow, by D2's rules: on its chance, a quarter of the monster's life before the hit
 * (an eighth for champions, uniques and bosses), halved for a ranged attack, less its physical
 * resistance and nothing on a physical immune. It is capped at CRUSHING_BLOW_CAP times the
 * hit's own damage (before resistance), so endless monsters' life cannot make it the whole kill.
 */
export function crushingBlow(sim: Sim, monster: Monster, gear: TowerGear, hpBefore: number, hit: number, ranged: boolean): void {
  if (gear.crushingBlowPct <= 0 || monster.hp <= 0 || rollInt(sim.state.rng, 0, 99) >= gear.crushingBlowPct) return;
  const resist = effectiveResist(sim, monster, 'phys');
  if (resist >= 100) return;
  const share = (monster.rank === 'normal' ? 4 : 8) * (ranged ? 2 : 1);
  const blow = Math.min(idiv(hpBefore, share), hit * CRUSHING_BLOW_CAP);
  dealRaw(sim, monster, idiv(blow * (100 - resist), 100));
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
  const found = bounty(sim, monster) + idiv(bounty(sim, monster) * (gear.goldFindPct + (monsterFx(sim, monster).goldPct ?? 0)), 100);
  const killer = Math.min(monster.lastHit, s.gold.length - 1);
  // Eternal Conflict: the race's gold percent, the lever between races (balance.json battle.races)
  const race = s.battle?.races[killer];
  const r = race ? sim.data.battle?.rules.races[race] : undefined;
  const pct = r ? (sim.players > 1 ? idiv(r.goldPct * (r.teamGoldPct ?? 100), 100) : r.goldPct) : 100;
  const gold = idiv(found * pct, 100);
  s.gold[killer]! += gold;
  if (s.battle) s.battle.bounty[killer]! += gold;
  sim.paid.push({ x: monster.x, y: monster.y, gold, player: killer, hp: monster.maxHp });
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
