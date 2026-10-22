// Items as the game holds them: a plain JSON record (so a lockstep command, a profile or a
// trade can carry it whole), rolled once through the seeded RNG. Rolling follows D2: an
// item level, a quality, affixes for magic and rare items chosen by affix level and
// frequency, a unique or set item by rarity, every property's value rolled once between
// its min and max. A property code becomes D2 stats through properties.txt; the stats are
// stored with the item, so it never needs re-rolling.

import { rollInt, type Rng } from '../rng.ts';
import { CLASS_CODES, isType, maxSocketsAt, type AffixDef, type RareName, type ItemBase, type ItemData, type PropRoll, type RunewordDef, type Slot } from './data.ts';

export type Quality = 'low' | 'normal' | 'superior' | 'magic' | 'rare' | 'set' | 'unique' | 'runeword';

/** A D2 stat an item gives: itemstatcost name, its param (a class, skill or skill tab), its value. */
export interface StatRoll {
  stat: string;
  param?: string;
  value: number;
  /** Chance-to-cast stats: the skill's level (the chance is `value`). */
  level?: number;
}

export interface Item {
  uid: string;
  code: string;
  quality: Quality;
  ilvl: number;
  ethereal?: boolean;
  /** Sockets the item has, and what fills them in order. */
  sockets: number;
  socketed: Item[];
  /** The item's own stats, rolled when it dropped (and when it became a runeword). */
  stats: StatRoll[];
  prefixes?: string[];
  suffixes?: string[];
  /** Rare names from rareprefix and raresuffix. */
  rareName?: [string, string];
  unique?: string;
  setItem?: string;
  runeword?: string;
  /** Stackable items (Smith's Hammer, Wirt's Leg). */
  quantity?: number;
}

/**
 * Per-level stats ("based on character level") as the flat stat they add. The param is in
 * eighths a level; a tower has no character level, so the wearer's level is the item's
 * level (capped at 99). See Overnight decisions in design.md.
 */
const PER_LEVEL: Record<string, string> = {
  item_find_magic_perlevel: 'item_magicbonus',
  item_find_gold_perlevel: 'item_goldbonus',
  item_armor_perlevel: 'armorclass',
  item_maxdamage_perlevel: 'maxdamage',
  item_maxdamage_percent_perlevel: 'item_maxdamage_percent',
  item_deadlystrike_perlevel: 'item_deadlystrike',
};

/**
 * A property's stats with one rolled value (D2 rolls min to max once per property). `clvl`
 * is the wearer level per-level stats use; without an rng the top of the range is taken
 * (gem and set bonuses, which are fixed).
 */
export function propertyStats(data: ItemData, prop: PropRoll, rng: Rng | undefined, clvl = 1): StatRoll[] {
  const def = data.properties[prop.code];
  if (!def) return [];
  const lo = Math.min(prop.min, prop.max);
  const hi = Math.max(prop.min, prop.max);
  const v = rng ? rollInt(rng, lo, hi) : hi;
  const out: StatRoll[] = [];
  for (const part of def.parts) {
    switch (part.func) {
      case 5:
        out.push({ stat: 'mindamage', value: v });
        break;
      case 6:
        out.push({ stat: 'maxdamage', value: v });
        break;
      case 7:
        // Enhanced damage: both min and max percent, one roll
        out.push({ stat: 'item_maxdamage_percent', value: v }, { stat: 'item_mindamage_percent', value: v });
        break;
      case 11:
        // Chance to cast: param is the skill, min the chance, max the skill level
        out.push({ stat: part.stat, param: prop.param, value: prop.min || 5, level: Math.max(1, prop.max) });
        break;
      case 14:
        out.push({ stat: 'item_numsockets', value: v || Number(prop.param) || 1 });
        break;
      case 15:
        out.push({ stat: part.stat, value: prop.min });
        break;
      case 16:
        out.push({ stat: part.stat, value: prop.max });
        break;
      case 17: {
        const flat = PER_LEVEL[part.stat];
        if (flat) out.push({ stat: flat, value: Math.trunc((Number(prop.param) * Math.min(99, clvl)) / 8) });
        else if (!part.stat.endsWith('_perlevel')) out.push({ stat: part.stat, value: Number(prop.param) || v });
        break;
      }
      case 21:
        // +class skills: the class index is the property's val (ama 0 ... ass 6)
        out.push({ stat: part.stat, param: String(part.val), value: v });
        break;
      case 22:
      case 10:
        out.push({ stat: part.stat, param: prop.param, value: v });
        break;
      case 23:
        out.push({ stat: 'ethereal', value: 1 });
        break;
      case 19:
      case 20:
      case 12:
      case 36:
        // Charges, indestructible, random skills: nothing a tower uses
        break;
      default:
        if (part.stat) out.push({ stat: part.stat, value: v, ...(prop.param ? { param: prop.param } : {}) });
    }
  }
  return out;
}

/** D2's affix level: the item level adjusted by the base's quality level and magic level. */
export function affixLevel(base: ItemBase, ilvl: number): number {
  const i = Math.min(99, Math.max(ilvl, base.level));
  if (base.magicLevel > 0) return Math.min(99, i + base.magicLevel);
  const q = base.level;
  return i < 99 - Math.floor(q / 2) ? i - Math.floor(q / 2) : 2 * i - 99;
}

/** Affixes that can roll on a base at an affix level. */
function candidates(data: ItemData, list: AffixDef[], base: ItemBase, alvl: number, rare: boolean, taken: number[]): AffixDef[] {
  return list.filter(
    (a) =>
      a.level <= alvl &&
      a.maxLevel >= alvl &&
      (!rare || a.rare) &&
      !taken.includes(a.group) &&
      a.itypes.some((t) => isType(data, base, t)) &&
      !a.etypes.some((t) => isType(data, base, t)) &&
      (!a.classOnly || a.classOnly === base.classOnly || !base.classOnly),
  );
}

function weighted<T>(rng: Rng, list: T[], weight: (t: T) => number): T | undefined {
  const total = list.reduce((n, t) => n + weight(t), 0);
  if (total <= 0) return undefined;
  let r = rollInt(rng, 0, total - 1);
  for (const t of list) {
    r -= weight(t);
    if (r < 0) return t;
  }
  return list.at(-1);
}

export interface RollOptions {
  uid: string;
  code: string;
  ilvl: number;
  quality: Quality;
}

/**
 * A new item of a base at an item level and quality, rolled as D2 rolls it. A unique or set
 * quality with nothing that fits the base and level becomes rare, as in D2; a rare on a base
 * that cannot be rare becomes magic.
 */
export function rollItem(data: ItemData, rng: Rng, opts: RollOptions): Item {
  const base = data.bases[opts.code];
  if (!base) throw new Error(`No item base ${opts.code}`);
  const item: Item = { uid: opts.uid, code: base.code, quality: 'normal', ilvl: opts.ilvl, sockets: 0, socketed: [], stats: [] };
  if (base.stackable) item.quantity = 1;
  const addProps = (props: PropRoll[]) => {
    for (const p of props) item.stats.push(...propertyStats(data, p, rng, opts.ilvl));
  };
  let quality = opts.quality;
  if (base.isGem || base.isRune || base.consumable) quality = 'normal';
  if (base.alwaysMagic && (quality === 'normal' || quality === 'superior' || quality === 'low')) quality = 'magic';

  if (quality === 'unique') {
    const pick = weighted(rng, data.uniques.filter((u) => u.code === base.code && u.level <= opts.ilvl), (u) => u.rarity);
    if (pick) {
      item.quality = 'unique';
      item.unique = pick.id;
      addProps(pick.props);
      return finishSockets(data, item, base);
    }
    quality = 'rare';
  }
  if (quality === 'set') {
    const pick = weighted(rng, data.setItems.filter((s) => s.code === base.code && s.level <= opts.ilvl), (s) => s.rarity);
    if (pick) {
      item.quality = 'set';
      item.setItem = pick.id;
      addProps(pick.props);
      return finishSockets(data, item, base);
    }
    quality = 'magic';
  }
  if (quality === 'rare' && !base.canRare) quality = 'magic';
  if (quality === 'magic' && !base.canMagic) quality = 'normal';
  const alvl = affixLevel(base, opts.ilvl);
  if (quality === 'magic') {
    item.quality = 'magic';
    // D2: a magic item has a prefix, a suffix, or both, each about half the time
    const both = rollInt(rng, 0, 3);
    const wantPrefix = both !== 1;
    const wantSuffix = both !== 0;
    const pre = wantPrefix ? weighted(rng, candidates(data, data.prefixes, base, alvl, false, []), (a) => a.frequency) : undefined;
    const suf = wantSuffix ? weighted(rng, candidates(data, data.suffixes, base, alvl, false, []), (a) => a.frequency) : undefined;
    if (pre) {
      item.prefixes = [pre.id];
      addProps(pre.props);
    }
    if (suf) {
      item.suffixes = [suf.id];
      addProps(suf.props);
    }
    return finishSockets(data, item, base);
  }
  if (quality === 'rare') {
    item.quality = 'rare';
    // D2: 3 to 6 affixes, at most 3 prefixes and 3 suffixes, one per group
    const count = rollInt(rng, 3, 6);
    const groups: number[] = [];
    item.prefixes = [];
    item.suffixes = [];
    for (let i = 0; i < count; i++) {
      const prefix = item.prefixes.length < 3 && (item.suffixes.length >= 3 || rollInt(rng, 0, 1) === 0);
      const pick = weighted(rng, candidates(data, prefix ? data.prefixes : data.suffixes, base, alvl, true, groups), (a) => a.frequency);
      if (!pick) continue;
      groups.push(pick.group);
      (prefix ? item.prefixes : item.suffixes).push(pick.id);
      addProps(pick.props);
    }
    item.rareName = rareName(data, rng, base);
    return finishSockets(data, item, base);
  }
  // Normal or superior: white items may come socketed, as D2 rolls them
  if (quality === 'superior' || quality === 'low') item.quality = quality;
  const max = maxSocketsAt(base, opts.ilvl);
  if (max > 0 && !base.isGem && !base.isRune && rollInt(rng, 0, 2) === 0) item.sockets = rollInt(rng, 1, max);
  return item;
}

/** A unique, set or rare's sockets come from its own stats (item_numsockets), up to the base's limit. */
function finishSockets(_data: ItemData, item: Item, base: ItemBase): Item {
  const want = item.stats.filter((s) => s.stat === 'item_numsockets').reduce((n, s) => n + s.value, 0);
  if (want > 0) item.sockets = Math.min(want, Math.max(1, maxSocketsAt(base, item.ilvl)));
  if (item.stats.some((s) => s.stat === 'ethereal')) item.ethereal = true;
  return item;
}

/** A rare's two-word name, from rareprefix.txt and raresuffix.txt. */
function rareName(data: ItemData, rng: Rng, base: ItemBase): [string, string] {
  const fits = (list: RareName[]) => list.filter((n) => n.itypes.length === 0 || n.itypes.some((t) => isType(data, base, t)));
  const pick = (list: RareName[], fallback: string) => list[rollInt(rng, 0, Math.max(0, list.length - 1))]?.name ?? fallback;
  return [pick(fits(data.rarePrefixes), 'Rare'), pick(fits(data.rareSuffixes), 'Item')];
}

/** Which gem column applies to an item: weapons take weaponMod, helms and body armour helmMod, shields shieldMod. */
export function gemColumn(base: ItemBase): 'weapon' | 'helm' | 'shield' {
  if (base.kind === 'weapon') return 'weapon';
  if (base.slots.includes('shield')) return 'shield';
  return 'helm';
}

/**
 * Every stat an item gives when worn: its own, and what fills its sockets (a gem or rune
 * by the item's gem column, a jewel by its own stats). A runeword's runes give their stats
 * on top of the runeword's own, as in D2.
 */
export function itemStats(data: ItemData, item: Item): StatRoll[] {
  const base = data.bases[item.code]!;
  const out = [...item.stats];
  for (const s of item.socketed) {
    const g = data.gems[s.code];
    if (g) for (const p of g[gemColumn(base)]) out.push(...propertyStats(data, p, undefined, item.ilvl));
    else out.push(...s.stats);
  }
  return out;
}

/**
 * Runes in a socketed item make it a runeword when, in order, they spell one whose allowed
 * types include the base, whose excluded types do not, with exactly that many sockets, on
 * a normal or superior item. Returns the runeword, or undefined.
 */
export function runewordFor(data: ItemData, item: Item): RunewordDef | undefined {
  const base = data.bases[item.code];
  if (!base || item.runeword || (item.quality !== 'normal' && item.quality !== 'superior')) return undefined;
  if (item.socketed.length !== item.sockets || item.socketed.some((s) => !data.bases[s.code]?.isRune)) return undefined;
  const codes = item.socketed.map((s) => s.code);
  return data.runewords.find(
    (rw) =>
      rw.runes.length === codes.length &&
      rw.runes.every((r, i) => r === codes[i]) &&
      rw.itypes.some((t) => isType(data, base, t)) &&
      !rw.etypes.some((t) => isType(data, base, t)),
  );
}

/** Makes an item its runeword, rolling the runeword's stats once. */
export function makeRuneword(data: ItemData, rng: Rng, item: Item, rw: RunewordDef): void {
  item.runeword = rw.id;
  item.quality = 'runeword';
  for (const p of rw.props) item.stats.push(...propertyStats(data, p, rng, item.ilvl));
}

/** An item's display name as D2R shows it. */
export function itemName(data: ItemData, item: Item): string {
  const base = data.bases[item.code];
  const baseName = base?.name ?? item.code;
  if (item.runeword) return data.runewords.find((r) => r.id === item.runeword)?.name ?? item.runeword;
  if (item.unique) return data.uniques.find((u) => u.id === item.unique)?.name ?? baseName;
  if (item.setItem) return data.setItems.find((s) => s.id === item.setItem)?.name ?? baseName;
  if (item.rareName) return `${item.rareName[0]} ${item.rareName[1]}`;
  const affix = (ids: string[] | undefined, list: AffixDef[]) => (ids ?? []).map((id) => list.find((a) => a.id === id)?.name ?? '').filter((n) => n);
  if (item.quality === 'magic') return [...affix(item.prefixes, data.prefixes), baseName, ...affix(item.suffixes, data.suffixes)].join(' ');
  if (item.quality === 'superior') return `${data.strings['Hiquality'] ?? 'Superior'} ${baseName}`;
  return baseName;
}

/** Whether an item can be worn in a slot by a tower of a class, given what the tower already wears. */
export function canWear(data: ItemData, item: Item, slot: Slot, towerClass: string, worn: Partial<Record<Slot, Item>>): boolean {
  const base = data.bases[item.code];
  if (!base || !base.slots.includes(slot)) return false;
  if (base.classOnly && base.classOnly !== CLASS_CODES[towerClass]) return false;
  // Two-handed weapons need the shield hand free, and a shield needs a one-handed weapon
  if (slot === 'shield' && worn.weapon && data.bases[worn.weapon.code]?.twoHanded) return false;
  if (slot === 'weapon' && base.twoHanded && worn.shield) return false;
  return true;
}

