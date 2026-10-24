// What a tower's worn items do. Every D2 stat the items give is summed (D2's own values),
// set bonuses are added for the set pieces worn on the same tower, and the totals become
// tower effects. The mapping (documented in design.md):
//
//   enhanced damage (item_maxdamage_percent)      damage percent on the tower's attacks
//   +min/+max damage, + elemental min-max          added to each hit, of that element
//   +all skills, +class skills, +skill tab           skill levels on the tower's line skills
//     (when the skill sits on that tab),
//     +a named skill (when it is the tower's)
//   increased attack speed / faster cast rate     attack speed: IAS for melee towers, FCR for the rest
//   weapon rangeadder                              melee reach, half a tile a point
//   crushing blow, deadly strike, open wounds,     on hit, D2's rules (melee towers)
//     slow, freeze
//   pierce                                         bolt missiles fly on through what they hit
//   -% to enemy resistance (the pierce stats)      the tower's hits cut that resistance, in full,
//                                                   once the monster is not immune (combat.ts)
//   +% to elemental skill damage (facets)          damage percent on spells of that element
//   +% damage to demons, to undead                 melee towers, on the physical hit
//   chance to cast on hit / on attack             casts the skill, at its level, when the game has it
//   an aura (item_aura: Infinity, Beast, Pride)    the tower projects it at the item's level
//   slain monsters rest in peace                   the tower's kills leave no corpse
//   the armour slot itself (balance.json              1 to 3% damage, attack speed or cast rate by the
//     implicitGear)                                   base's tier, so every slot is worth filling
//   magic find, gold find                          on the tower's kills, stacking additively as in D2
//   defence (armorclass, enhanced defence),        how often monsters miss the tower's blocking
//     block                                        summons, by D2's chance to hit
//   every other stat (balance.json                 converted, per 100 points: resistances to that
//     itemConversions)                             element's damage, life and defences to durability
//                                                   (how long its summons hold; damage on a tower with
//                                                   none, items/tower.ts), mana to cast rate,
//                                                   attack rating to damage on champions and uniques,
//                                                   knockback and flee to slow, blind to a stun chance,
//                                                   strength to damage; when-struck, kill, death and
//                                                   level-up casts cast on hit (balance.json itemProcs);
//                                                   magic, rare and set items convert at a higher rate
//                                                   (balance.json itemQualityPct)
//
// Weapons also carry their base damage: a melee tower swings its worn weapon instead of its
// class weapon, enhanced damage on it as in D2.

import type { ImplicitGear, ItemConversions } from '../data.ts';
import type { Element } from '../state.ts';
import { CLASS_CODES, isType, SLOTS, type ItemBase, type ItemData, type Slot } from './data.ts';
import { idiv } from '../fixed.ts';
import { itemStats, propertyStats, type Item, type Quality, type StatRoll } from './item.ts';

export type Gear = Partial<Record<Slot, Item>>;

/** itemtypes.txt class order, as item_addclassskills params count them. */
const CLASS_INDEX: Record<string, number> = { ama: 0, sor: 1, nec: 2, pal: 3, bar: 4, dru: 5, ass: 6 };

export interface TowerGear {
  damagePct: number;
  /** Flat damage added to each hit, whole HP, by element ('phys' for +min/+max damage). */
  adds: Partial<Record<Element, [number, number]>>;
  coldTicks: number;
  poisonTicks: number;
  /** Skill levels added to the tower's line skills: +all and +class skills. */
  plusSkills: number;
  /** +levels to single skills by skills.txt name or Id. */
  plusSkill: Record<string, number>;
  /** +skill tab levels by the tab stat's param (0 to 20; see GameData.skillTabs). */
  plusTab: Record<string, number>;
  /** +fire skills (item_elemskill): levels on towers whose skill deals fire. */
  fireSkills: number;
  attackSpeedPct: number;
  castSpeedPct: number;
  /** Melee reach added, in tenths of a tile. */
  rangeTenths: number;
  crushingBlowPct: number;
  deadlyStrikePct: number;
  openWoundsPct: number;
  /** The level open wounds bleeds at: the highest item level among the items giving it (see design.md). */
  openWoundsLevel: number;
  piercePct: number;
  /** -% to enemy resistance, by element (passive_*_pierce). */
  resistDown: Partial<Record<Element, number>>;
  /** +% to skill damage of an element (passive_*_mastery, the facets). */
  skillDamagePct: Partial<Record<Element, number>>;
  /** The armour slots' built-in bonus: damage percent on every tower's hits (balance.json implicitGear). */
  implicitDamagePct: number;
  demonDamagePct: number;
  undeadDamagePct: number;
  /** Auras the items carry (item_aura), by skills.txt name, at the highest level worn. */
  auras: { skill: string; level: number }[];
  restInPeace: boolean;
  slowPct: number;
  freezeTicks: number;
  castOnHit: { skill: string; chancePct: number; level: number }[];
  magicFindPct: number;
  goldFindPct: number;
  defense: number;
  blockPct: number;
  /** Converted stats (balance.json itemConversions): */
  /** +% on how long the tower's summons hold a monster, and on their life. */
  durabilityPct: number;
  /** +% damage on the tower's hits of an element, every tower (the resistances). */
  elementDamagePct: Partial<Record<Element, number>>;
  /** +% damage against champions and uniques (attack rating). */
  eliteDamagePct: number;
  /** +% damage on every tower's hits (strength). */
  allDamagePct: number;
  /** Chance a hit stuns for itemStunTicks (blind); never bosses. */
  stunChancePct: number;
  /**
   * The worn weapon's damage for melee towers, whole HP: its base damage (ethereal +50%)
   * plus the gear's flat +min and +max damage. Enhanced damage is damagePct, on top. A bow or
   * crossbow (missile: true) is the Amazon's: her bow skills fire it, and no tower swings it.
   */
  weapon?: { min: number; max: number };
  missile?: boolean;
}

export const NO_GEAR: TowerGear = {
  damagePct: 0,
  adds: {},
  coldTicks: 0,
  poisonTicks: 0,
  plusSkills: 0,
  plusSkill: {},
  plusTab: {},
  fireSkills: 0,
  attackSpeedPct: 0,
  castSpeedPct: 0,
  rangeTenths: 0,
  crushingBlowPct: 0,
  deadlyStrikePct: 0,
  openWoundsPct: 0,
  openWoundsLevel: 0,
  piercePct: 0,
  resistDown: {},
  skillDamagePct: {},
  implicitDamagePct: 0,
  demonDamagePct: 0,
  undeadDamagePct: 0,
  auras: [],
  restInPeace: false,
  slowPct: 0,
  freezeTicks: 0,
  castOnHit: [],
  magicFindPct: 0,
  goldFindPct: 0,
  defense: 0,
  blockPct: 0,
  durabilityPct: 0,
  elementDamagePct: {},
  eliteDamagePct: 0,
  allDamagePct: 0,
  stunChancePct: 0,
};

/**
 * Stats the item model reads itself rather than the tower: ethereal and sockets (item.ts), the
 * min half of enhanced damage (one roll with the max), and set items' visual states.
 */
export const ITEM_MECHANICS = ['ethereal', 'item_numsockets', 'item_mindamage_percent', 'state'];

/** The -% to enemy resistance stats, by element. */
const PIERCE_STATS: Record<string, Element> = {
  passive_fire_pierce: 'fire',
  passive_ltng_pierce: 'ltng',
  passive_cold_pierce: 'cold',
  passive_pois_pierce: 'pois',
  passive_mag_pierce: 'mag',
  passive_dmg_pierce: 'phys',
};

/** The +% to elemental skill damage stats (the facets' and the masteries'), by element. */
const MASTERY_STATS: Record<string, Element> = {
  passive_fire_mastery: 'fire',
  passive_ltng_mastery: 'ltng',
  passive_cold_mastery: 'cold',
  passive_pois_mastery: 'pois',
  passive_mag_mastery: 'mag',
};

/** D2 frames (25 a second) to sim ticks (20 a second). */
const framesToTicks = (frames: number) => Math.trunc((frames * 20) / 25);

/** Every stat the gear gives, set bonuses included. */
export function gearStats(data: ItemData, gear: Gear): StatRoll[] {
  return gearSources(data, gear).flatMap((g) => g.stats);
}

/** The gear's stats by the quality that gives them: each item's own (sockets included), and set bonuses as set. */
function gearSources(data: ItemData, gear: Gear): { quality: Quality; stats: StatRoll[] }[] {
  const worn = SLOTS.map((s) => gear[s]).filter((i): i is Item => i !== undefined);
  const out = worn.map((i) => ({ quality: i.quality, stats: itemStats(data, i) }));
  const bonus: StatRoll[] = [];
  // Set bonuses: each set piece's own partial bonus for the count worn, and the set's
  const bySet = new Map<string, Item[]>();
  for (const i of worn) {
    const def = i.setItem ? data.setItems.find((s) => s.id === i.setItem) : undefined;
    if (def) bySet.set(def.set, [...(bySet.get(def.set) ?? []), i]);
  }
  for (const [setId, pieces] of bySet) {
    const n = pieces.length;
    for (const piece of pieces) {
      const def = data.setItems.find((s) => s.id === piece.setItem)!;
      for (let k = 2; k <= n; k++) for (const p of def.partial[k - 2] ?? []) bonus.push(...propertyStats(data, p, undefined, piece.ilvl));
    }
    const set = data.sets[setId];
    if (!set) continue;
    const clvl = Math.max(...pieces.map((p) => p.ilvl));
    for (let k = 2; k <= n; k++) for (const p of set.partial[k - 2] ?? []) bonus.push(...propertyStats(data, p, undefined, clvl));
    if (n >= set.items.length && set.items.length > 0) for (const p of set.full) bonus.push(...propertyStats(data, p, undefined, clvl));
  }
  if (bonus.length > 0) out.push({ quality: 'set', stats: bonus });
  return out;
}

/** The tower effects of the gear a tower of class `towerClass` wears (see the table above). */
export function towerGear(
  data: ItemData,
  gear: Gear,
  towerClass: string,
  implicit: ImplicitGear = {},
  conversions: ItemConversions = {},
  procs: Record<string, number> = {},
  qualityPct: Partial<Record<string, number>> = {},
): TowerGear {
  const g: TowerGear = { ...NO_GEAR, adds: {}, plusSkill: {}, plusTab: {}, castOnHit: [], resistDown: {}, skillDamagePct: {}, auras: [], elementDamagePct: {} };
  const sources = gearSources(data, gear);
  const stats = sources.flatMap((x) => x.stats);
  const sum = (stat: string) => stats.filter((s) => s.stat === stat).reduce((n, s) => n + s.value, 0);
  const myClass = CLASS_INDEX[CLASS_CODES[towerClass] ?? ''] ?? -1;
  const add = (e: Element, min: number, max: number) => {
    if (min === 0 && max === 0) return;
    const [a, b] = g.adds[e] ?? [0, 0];
    g.adds[e] = [a + min, b + Math.max(min, max)];
  };
  g.damagePct = sum('item_maxdamage_percent');
  // item_normaldamage is D2's "+X damage": on both ends of the hit
  add('phys', sum('mindamage') + sum('secondary_mindamage') + sum('item_mindamage') + sum('item_normaldamage'), sum('maxdamage') + sum('secondary_maxdamage') + sum('item_maxdamage') + sum('item_normaldamage'));
  add('fire', sum('firemindam'), sum('firemaxdam'));
  add('cold', sum('coldmindam'), sum('coldmaxdam'));
  add('ltng', sum('lightmindam'), sum('lightmaxdam'));
  add('mag', sum('magicmindam'), sum('magicmaxdam'));
  // D2 poison is given per frame over its length (x256 in the table); total over the length
  const poisonLen = sum('poisonlength');
  if (sum('poisonmaxdam') > 0) add('pois', Math.trunc((sum('poisonmindam') * Math.max(1, poisonLen)) / 256), Math.trunc((sum('poisonmaxdam') * Math.max(1, poisonLen)) / 256));
  g.coldTicks = framesToTicks(sum('coldlength'));
  g.poisonTicks = framesToTicks(poisonLen);
  g.plusSkills = sum('item_allskills');
  for (const s of stats) {
    if (s.stat === 'item_addclassskills' && Number(s.param) === myClass) g.plusSkills += s.value;
    // +skill tab: the param is the tab, 0 to 20, three a class; the tower's skill must sit on it
    if (s.stat === 'item_addskill_tab' && s.param !== undefined && Math.floor(Number(s.param) / 3) === myClass) g.plusTab[s.param] = (g.plusTab[s.param] ?? 0) + s.value;
    if (s.stat === 'item_elemskill' && s.param === '1') g.fireSkills += s.value;
    if ((s.stat === 'item_singleskill' || s.stat === 'item_nonclassskill') && s.param) g.plusSkill[s.param] = (g.plusSkill[s.param] ?? 0) + s.value;
    if ((s.stat === 'item_skillonhit' || s.stat === 'item_skillonattack') && s.param) g.castOnHit.push({ skill: s.param, chancePct: s.value, level: s.level ?? 1 });
    // Towers are never struck, never die and never level: those casts come on hit instead, at a share of their chance
    const share = procs[s.stat];
    if (share !== undefined && s.param) g.castOnHit.push({ skill: s.param, chancePct: Math.max(1, idiv(s.value * share, 100)), level: s.level ?? 1 });
    // Two items with the same aura: the higher level, as in D2
    if (s.stat === 'item_aura' && s.param) {
      const has = g.auras.find((a) => a.skill === s.param);
      if (has) has.level = Math.max(has.level, s.value);
      else g.auras.push({ skill: s.param, level: s.value });
    }
  }
  for (const [stat, e] of Object.entries(PIERCE_STATS)) if (sum(stat) !== 0) g.resistDown[e] = (g.resistDown[e] ?? 0) + sum(stat);
  for (const [stat, e] of Object.entries(MASTERY_STATS)) if (sum(stat) !== 0) g.skillDamagePct[e] = (g.skillDamagePct[e] ?? 0) + sum(stat);
  g.demonDamagePct = sum('item_demondamage_percent');
  g.undeadDamagePct = sum('item_undeaddamage_percent');
  g.restInPeace = sum('item_restinpeace') > 0;
  g.attackSpeedPct = sum('item_fasterattackrate');
  g.castSpeedPct = sum('item_fastercastrate');
  g.crushingBlowPct = Math.min(100, sum('item_crushingblow'));
  g.deadlyStrikePct = Math.min(100, sum('item_deadlystrike'));
  g.openWoundsPct = Math.min(100, sum('item_openwounds'));
  if (g.openWoundsPct > 0) {
    for (const s of SLOTS) {
      const item = gear[s];
      if (item && itemStats(data, item).some((x) => x.stat === 'item_openwounds')) g.openWoundsLevel = Math.max(g.openWoundsLevel, Math.min(99, item.ilvl));
    }
  }
  g.piercePct = Math.min(100, sum('item_pierce'));
  g.slowPct = Math.min(50, sum('item_slow'));
  g.freezeTicks = framesToTicks(sum('item_freeze') * 25);
  g.magicFindPct = sum('item_magicbonus');
  g.goldFindPct = sum('item_goldbonus');
  g.blockPct = Math.min(75, sum('toblock'));

  const weaponItem = gear.weapon;
  const weaponBase: ItemBase | undefined = weaponItem && data.bases[weaponItem.code];
  if (weaponItem && weaponBase) {
    const eth = (v: number) => Math.trunc((v * (weaponItem.ethereal ? 150 : 100)) / 100);
    const [addMin, addMax] = g.adds.phys ?? [0, 0];
    const min = Math.max(1, eth(weaponBase.minDamage) + addMin);
    g.weapon = { min, max: Math.max(min, eth(weaponBase.maxDamage) + addMax) };
    if (isType(data, weaponBase, 'miss')) g.missile = true;
    // rangeadder counts D2 subtiles; a sim tile is two of them
    g.rangeTenths = weaponBase.rangeAdder * 5;
  }
  // Defence: each armour piece's base defence (its top roll; ethereal +50%), with enhanced defence on it, plus flat defence
  let defense = sum('armorclass');
  for (const s of SLOTS) {
    const item = gear[s];
    const base = item && data.bases[item.code];
    if (!item || !base || base.kind !== 'armor') continue;
    const own = itemStats(data, item);
    const edef = own.filter((x) => x.stat === 'item_armor_percent').reduce((n, x) => n + x.value, 0);
    defense += Math.trunc((base.maxAc * (100 + (item.ethereal ? 50 : 0)) * (100 + edef)) / 10_000);
    if (base.block > 0) g.blockPct = Math.min(75, g.blockPct + base.block);
  }
  g.defense = defense;
  convert(g, sources, conversions, qualityPct);
  // Every armour slot carries a small built-in bonus by its base's tier, so nothing worn is nothing
  for (const s of SLOTS) {
    const item = gear[s];
    const base = item && data.bases[item.code];
    const rule = implicit[s];
    if (!item || !base || !rule || base.kind !== 'armor') continue;
    const pct = rule.pct[Math.max(0, Math.min(2, base.tier))] ?? 0;
    if (rule.stat === 'damage') g.implicitDamagePct += pct;
    else if (rule.stat === 'attackSpeed') g.attackSpeedPct += pct;
    else g.castSpeedPct += pct;
  }
  return g;
}

/**
 * A converted stat's tower effect, in hundredths of a percent: its value times its rate
 * (balance.json itemConversions, percent per 100 points) and its item quality's percent
 * (itemQualityPct). Undefined for a stat read directly.
 */
export function convertedHundredths(conversions: ItemConversions, stat: string, value: number, qualityPct = 100): { effect: ItemConversions[string][0]; hundredths: number } | undefined {
  const rule = conversions[stat];
  return rule && { effect: rule[0], hundredths: idiv(value * rule[1] * qualityPct, 100) };
}

/**
 * The stats a tower has no direct use for, as tower effects: each effect sums its stats'
 * values times their rates and rounds down once, so many small rolls still count.
 */
function convert(g: TowerGear, sources: readonly { quality: Quality; stats: readonly StatRoll[] }[], conversions: ItemConversions, qualityPct: Partial<Record<string, number>>): void {
  const total = new Map<ItemConversions[string][0], number>();
  for (const { quality, stats } of sources) {
    for (const s of stats) {
      const c = convertedHundredths(conversions, s.stat, s.value, qualityPct[quality] ?? 100);
      if (c) total.set(c.effect, (total.get(c.effect) ?? 0) + c.hundredths);
    }
  }
  for (const [effect, hundredths] of total) {
    const pct = Math.trunc(hundredths / 100);
    if (pct === 0) continue;
    switch (effect) {
      case 'durability':
        g.durabilityPct += pct;
        break;
      case 'rate':
        // Cast rate for a caster, swing rate for a melee tower: each reads only its own
        g.castSpeedPct += pct;
        g.attackSpeedPct += pct;
        break;
      case 'damage':
        g.allDamagePct += pct;
        break;
      case 'elite':
        g.eliteDamagePct += pct;
        break;
      case 'slow':
        g.slowPct = Math.min(50, g.slowPct + pct);
        break;
      case 'stun':
        g.stunChancePct = Math.min(100, g.stunChancePct + pct);
        break;
      case 'goldFind':
        g.goldFindPct += pct;
        break;
      case 'openWounds':
        g.openWoundsPct = Math.min(100, g.openWoundsPct + pct);
        break;
      case 'allElements':
        for (const e of ['fire', 'cold', 'ltng', 'pois', 'mag'] as const) g.elementDamagePct[e] = (g.elementDamagePct[e] ?? 0) + pct;
        break;
      default:
        g.elementDamagePct[effect] = (g.elementDamagePct[effect] ?? 0) + pct;
    }
  }
}
