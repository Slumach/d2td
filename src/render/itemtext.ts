// An item's tooltip as D2R writes it: the name in its quality's colour, the base under a
// unique, set or rare, damage or defence, requirements, the magic properties in blue in
// itemstatcost.txt's order with D2R's own strings (item-modifiers), sockets and ethereal,
// set bonuses, and for a gem or rune what it gives in each kind of item. A rune also
// lists every runeword that uses it, in rune order: green when this player holds every rune
// it takes, and otherwise the runes still missing in grey.

import type { ItemConversions } from '../sim/data.ts';
import type { ItemData } from '../sim/items/data.ts';
import { convertedHundredths } from '../sim/items/gear.ts';
import { CLASS_CODES, maxSocketsAt } from '../sim/items/data.ts';
import { itemName, itemStats, propertyStats, type Item, type StatRoll } from '../sim/items/item.ts';

/** D2R's item name colours. */
export const QUALITY_COLOURS: Record<string, string> = {
  low: '#8a8a8a',
  normal: '#ffffff',
  superior: '#ffffff',
  magic: '#6d6dff',
  rare: '#ffff64',
  set: '#00ff00',
  unique: '#c7b377',
  runeword: '#c7b377',
};
/** Runes and our consumables show orange, as D2R shows runes; socketed and ethereal whites grey. */
const RUNE = '#ffa800';
const GREY = '#8a8a8a';

export function nameColour(data: ItemData, item: Item): string {
  const base = data.bases[item.code];
  if (base?.isRune || base?.consumable) return RUNE;
  if ((item.quality === 'normal' || item.quality === 'superior') && (item.sockets > 0 || item.ethereal)) return GREY;
  return QUALITY_COLOURS[item.quality] ?? '#ffffff';
}

/** The label: the item's name, and the count of a stack. */
export function labelText(data: ItemData, item: Item): string {
  const name = itemName(data, item);
  const qty = (item.quantity ?? 1) > 1 ? ` (${item.quantity})` : '';
  return `${name}${qty}`;
}

export interface Line {
  text: string;
  colour: string;
}

export const TIP = { white: '#ffffff', blue: '#6d6dff', gold: '#c7b377', green: '#00ff00', yellow: '#ffff64', grey: '#8a8a8a', red: '#ff4d4d', orange: '#ffa800' };

/** D2R's strings are printf formats: %d, %+d, %i, %s and %%. */
export function sprintf(fmt: string, ...args: (number | string)[]): string {
  let i = 0;
  return fmt.replace(/%(\+?)([dis%])/g, (_m, plus: string, kind: string) => {
    if (kind === '%') return '%';
    const v = args[i++];
    if (kind === 's') return String(v ?? '');
    const n = Number(v ?? 0);
    return plus && n >= 0 ? `+${n}` : String(n);
  });
}

const CLASS_NAMES = ['Amazon', 'Sorceress', 'Necromancer', 'Paladin', 'Barbarian', 'Druid', 'Assassin'];
/** Where each class's three skill tab strings start among StrSklTabItem1..21. */
const TAB_START = [1, 13, 7, 4, 10, 16, 19];
const ONLY_KEYS: Record<string, string> = { ama: 'AmaOnly', sor: 'SorOnly', nec: 'NecOnly', pal: 'PalOnly', bar: 'BarOnly', dru: 'DruOnly', ass: 'AssOnly', war: 'WarOnly' };

export interface TextContext {
  /** A skill's name from an item stat's param (a skills.txt name or Id). */
  skillName: (param: string) => string;
  /** The game's conversions of stats a tower has no direct use for (balance.json itemConversions, itemProcs). */
  conversions?: ItemConversions;
  procs?: Record<string, number>;
}

const ELEMENT_NAMES: Record<string, string> = { fire: 'Fire', cold: 'Cold', ltng: 'Lightning', pois: 'Poison', mag: 'Magic' };

/** A converted stat's tower effect, in words: what the line shows, D2's own wording after it. */
export function effectText(effect: string, hundredths: number): string {
  const pct = hundredths / 100;
  const n = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  const signed = pct >= 0 ? `+${n}` : n;
  switch (effect) {
    case 'durability':
      return `${signed}% Durability`;
    case 'rate':
      return `${signed}% Cast Rate`;
    case 'damage':
      return `${signed}% Damage`;
    case 'elite':
      return `${signed}% Damage to Champions and Uniques`;
    case 'slow':
      return `Slows Target by ${n}%`;
    case 'stun':
      return `${n}% Chance to Stun`;
    case 'goldFind':
      return `${n}% Extra Gold from Monsters`;
    case 'openWounds':
      return `${n}% Chance of Open Wounds`;
    case 'allElements':
      return `${signed}% Damage of Every Element`;
    default:
      return `${signed}% ${ELEMENT_NAMES[effect] ?? effect} Damage`;
  }
}

/** The blue property lines for a set of stats, merged and ordered as D2R shows them. */
export function statLines(data: ItemData, stats: readonly StatRoll[], ctx: TextContext): Line[] {
  const s = data.strings;
  const merged = new Map<string, StatRoll>();
  for (const st of stats) {
    const key = `${st.stat}|${st.param ?? ''}|${st.level ?? ''}`;
    const had = merged.get(key);
    merged.set(key, had ? { ...had, value: had.value + st.value } : { ...st });
  }
  const take = (stat: string): number | undefined => {
    const k = [...merged.keys()].find((x) => x.startsWith(`${stat}|`));
    if (!k) return undefined;
    const v = merged.get(k)!.value;
    merged.delete(k);
    return v;
  };
  const out: { priority: number; text: string }[] = [];
  const push = (priority: number, text: string) => text && out.push({ priority, text });
  const prio = (stat: string) => data.statDescs[stat]?.priority ?? 0;

  // Pairs D2 writes as one line
  const edMax = merged.get('item_maxdamage_percent||')?.value;
  if (edMax !== undefined && merged.get('item_mindamage_percent||')?.value === edMax) {
    take('item_maxdamage_percent');
    take('item_mindamage_percent');
    push(prio('item_maxdamage_percent'), sprintf(s['strModEnhancedDamage'] ?? '%+d%% Enhanced Damage', edMax));
  }
  for (const [min, max, key] of [
    ['firemindam', 'firemaxdam', 'strModFireDamageRange'],
    ['coldmindam', 'coldmaxdam', 'strModColdDamageRange'],
    ['lightmindam', 'lightmaxdam', 'strModLightningDamageRange'],
    ['magicmindam', 'magicmaxdam', 'strModMagicDamageRange'],
    ['mindamage', 'maxdamage', 'strModMinDamageRange'],
  ] as const) {
    const lo = merged.get(`${min}||`)?.value;
    const hi = merged.get(`${max}||`)?.value;
    if (lo !== undefined && hi !== undefined) {
      take(min);
      take(max);
      push(prio(max), sprintf(s[key] ?? 'Adds %d-%d damage', lo, hi));
    }
  }
  take('coldlength');
  const plo = take('poisonmindam');
  const phi = take('poisonmaxdam');
  const plen = take('poisonlength') ?? 0;
  if (phi !== undefined) {
    const secs = Math.max(1, Math.round(plen / 25));
    const total = (v: number) => Math.round((v * plen) / 256);
    const a = total(plo ?? phi);
    const b = total(phi);
    push(prio('poisonmaxdam'), a === b ? sprintf(s['strModPoisonDamage'] ?? '%+d poison damage over %d seconds', b, secs) : `Adds ${a}-${b} poison damage over ${secs} seconds`);
  }
  const res = ['fireresist', 'lightresist', 'coldresist', 'poisonresist'].map((r) => merged.get(`${r}||`)?.value);
  if (res.every((v) => v !== undefined && v === res[0])) {
    for (const r of ['fireresist', 'lightresist', 'coldresist', 'poisonresist']) take(r);
    const d2 = sprintf(s['strModAllResistances'] ?? 'All Resistances %+d', res[0]!);
    const c = ctx.conversions && convertedHundredths(ctx.conversions, 'fireresist', res[0]!);
    push(prio('fireresist'), c && c.hundredths !== 0 ? `${effectText('allElements', c.hundredths).replace('Every Element', 'Fire, Cold, Lightning and Poison')} (${d2})` : d2);
  }

  for (const st of merged.values()) {
    const d = data.statDescs[st.stat];
    if (!d || !d.pos) continue;
    const fmt = (st.value < 0 ? s[d.neg] : s[d.pos]) ?? s[d.pos] ?? '';
    if (!fmt) continue;
    const cls = Number(st.param);
    // A stat a tower converts: its tower effect, D2's wording after it
    const c = ctx.conversions && convertedHundredths(ctx.conversions, st.stat, st.value);
    if (c) {
      push(d.priority, `${effectText(c.effect, c.hundredths)} (${sprintf(fmt, st.value).trim()})`);
      continue;
    }
    // A cast a tower is never in a position for (when struck, on kill, on death, on level up) comes on hit
    const share = ctx.procs?.[st.stat];
    if (share !== undefined) {
      const onHit = data.statDescs['item_skillonhit'];
      const hitFmt = onHit && (s[onHit.pos] ?? '');
      if (hitFmt) {
        push(d.priority, sprintf(hitFmt, Math.max(1, Math.trunc((st.value * share) / 100)), st.level ?? 1, ctx.skillName(st.param ?? '')));
        continue;
      }
    }
    switch (d.func) {
      case 13:
        push(d.priority, sprintf((s['ModStr3a'] ?? '%+d to Amazon Skill Levels').replace('Amazon', CLASS_NAMES[cls] ?? 'Class'), st.value));
        break;
      case 14: {
        const c = Math.floor(cls / 8);
        const key = `StrSklTabItem${(TAB_START[c] ?? 1) + (cls % 8)}`;
        push(d.priority, sprintf(s[key] ?? fmt, st.value));
        break;
      }
      case 15:
        push(d.priority, sprintf(fmt, st.value, st.level ?? 1, ctx.skillName(st.param ?? '')));
        break;
      case 16:
        push(d.priority, sprintf(fmt, st.value, ctx.skillName(st.param ?? '')));
        break;
      case 27:
        push(d.priority, sprintf(fmt, st.value, ctx.skillName(st.param ?? ''), ''));
        break;
      case 28:
        push(d.priority, sprintf(fmt, st.value, ctx.skillName(st.param ?? '')));
        break;
      default:
        push(d.priority, sprintf(fmt, st.value));
    }
  }
  return out.sort((a, b) => b.priority - a.priority).map((l) => ({ text: l.text.trim(), colour: TIP.blue }));
}

export interface ItemTextOptions extends TextContext {
  /** How many of each rune this player has (inventory and stash), for a rune's runeword list. */
  owned?: ReadonlyMap<string, number>;
  /** The vendor's price, shown while selling. */
  sellPrice?: number;
  /** Set pieces worn beside it on the same tower, for its set bonuses. */
  setWorn?: number;
}

/** Every line of an item's tooltip, top to bottom. */
export function itemLines(data: ItemData, item: Item, o: ItemTextOptions): Line[] {
  const s = data.strings;
  const base = data.bases[item.code];
  const lines: Line[] = [];
  const add = (text: string, colour: string = TIP.white) => lines.push({ text, colour });
  const name = itemName(data, item);
  const colour = nameColour(data, item);
  add(name, colour);
  if (base && (item.unique || item.setItem || item.rareName || item.runeword)) add(base.name, item.runeword ? TIP.grey : colour);
  if (item.runeword) add(`'${item.socketed.map((r) => (data.bases[r.code]?.name ?? r.code).replace(/ Rune$/, '')).join('')}'`, TIP.gold);
  if (!base) return lines;

  const own = itemStats(data, item);
  const sum = (stat: string) => own.filter((x) => x.stat === stat).reduce((n, x) => n + x.value, 0);
  if (base.kind === 'weapon') {
    const ed = sum('item_maxdamage_percent');
    const eth = item.ethereal ? 150 : 100;
    const lo = Math.trunc((((base.minDamage * eth) / 100) * (100 + ed)) / 100) + sum('mindamage');
    const hi = Math.trunc((((base.maxDamage * eth) / 100) * (100 + ed)) / 100) + sum('maxdamage');
    add(sprintf(s[base.twoHanded ? 'ItemStats1m' : 'ItemStats1l'] ?? 'Damage: %d to %d', lo, Math.max(lo, hi)), ed || sum('maxdamage') ? TIP.blue : TIP.white);
  }
  if (base.kind === 'armor' && base.maxAc > 0) {
    const ac = Math.trunc((((base.maxAc * (item.ethereal ? 150 : 100)) / 100) * (100 + sum('item_armor_percent'))) / 100) + sum('armorclass');
    add(sprintf(s['ItemStats1h'] ?? 'Defense: %d', ac), sum('item_armor_percent') || sum('armorclass') ? TIP.blue : TIP.white);
    if (base.block > 0) add(sprintf(s['ItemStats1r'] ?? 'Chance to Block: %d%%', base.block));
  }
  if (base.stackable && (item.quantity ?? 1) > 0) add(sprintf(s['ItemStats1i'] ?? 'Quantity: %d of %d', item.quantity ?? 1, base.maxStack));
  if (base.classOnly) add(s[ONLY_KEYS[base.classOnly] ?? ''] ?? `(${base.classOnly} only)`, Object.values(CLASS_CODES).includes(base.classOnly) ? TIP.white : TIP.red);
  const req = Math.max(
    base.levelReq,
    data.uniques.find((u) => u.id === item.unique)?.levelReq ?? 0,
    data.setItems.find((x) => x.id === item.setItem)?.levelReq ?? 0,
    ...[...(item.prefixes ?? []), ...(item.suffixes ?? [])].map((id) => [...data.prefixes, ...data.suffixes].find((a) => a.id === id)?.levelReq ?? 0),
  );
  if (req > 1) add(sprintf(s['ItemStats1p'] ?? 'Required Level: %d', req));

  if (base.isGem || base.isRune) {
    lines.push(...socketEffects(data, item.code, o));
    if (base.isRune) lines.push(...runewordLines(data, item.code, o.owned));
  } else if (base.consumable === 'socket') {
    add('Adds a socket to an item, up to the most its base can have at its item level', TIP.white);
  } else if (base.consumable === 'cowPortal') {
    add('Right-click to open a portal to the Secret Cow Level', TIP.white);
  }

  // The item's own properties with what fills its sockets folded in, as D2R shows them
  lines.push(...statLines(data, own, o));
  if (item.ethereal && item.sockets > 0) add(sprintf(s['strItemModEtherealSocketed'] ?? 'Ethereal, Socketed (%i)', item.sockets), TIP.blue);
  else if (item.ethereal) add(s['strethereal'] ?? 'Ethereal', TIP.blue);
  else if (item.sockets > 0) add(sprintf(s['Socketable'] ?? 'Socketed (%i)', item.sockets), TIP.blue);

  const setDef = item.setItem ? data.setItems.find((x) => x.id === item.setItem) : undefined;
  if (setDef) {
    const worn = o.setWorn ?? 1;
    setDef.partial.forEach((props, k) => {
      if (props.length === 0) return;
      const live = worn >= k + 2;
      for (const l of statLines(data, props.flatMap((p) => propertyStats(data, p, undefined, item.ilvl)), o)) add(`${l.text} (${k + 2} Items)`, live ? TIP.green : TIP.grey);
    });
    const set = data.sets[setDef.set];
    if (set) add(set.name, TIP.gold);
  }
  if (o.sellPrice !== undefined) add(`Sell value: ${o.sellPrice} gold`, TIP.white);
  return lines;
}

/** What a gem or rune gives: in weapons, in helms and body armour, in shields. */
function socketEffects(data: ItemData, code: string, o: TextContext): Line[] {
  const g = data.gems[code];
  if (!g) return [];
  const one = (props: typeof g.weapon) => statLines(data, props.flatMap((p) => propertyStats(data, p, undefined)), o).map((l) => l.text).join(', ');
  return [
    { text: `Weapons: ${one(g.weapon)}`, colour: TIP.white },
    { text: `Armor: ${one(g.helm)}`, colour: TIP.white },
    { text: `Helms: ${one(g.helm)}`, colour: TIP.white },
    { text: `Shields: ${one(g.shield)}`, colour: TIP.white },
  ];
}

/** Item type names as D2R gives them (itemtypes ItemType for types without a string). */
function typeName(data: ItemData, type: string): string {
  return data.strings[type] ?? data.typeNames[type] ?? type;
}

/**
 * Every runeword a rune is part of, in rune order: its runes, green when this player holds
 * all of them (a rune it takes twice, twice), orange with the missing ones listed in grey
 * when not; then the bases it goes in and the sockets it needs.
 */
export function runewordLines(data: ItemData, rune: string, owned: ReadonlyMap<string, number> | undefined): Line[] {
  const words = data.runewords.filter((rw) => rw.runes.includes(rune));
  if (words.length === 0) return [];
  const runeName = (c: string) => (data.bases[c]?.name ?? c).replace(/ Rune$/, '');
  const order = (rw: (typeof words)[number]) => Math.max(...rw.runes.map((r) => data.runeOrder.indexOf(r)));
  const lines: Line[] = [{ text: `Runewords with ${runeName(rune)}:`, colour: TIP.gold }];
  for (const rw of [...words].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))) {
    const missing = missingRunes(rw.runes, owned);
    const bases = rw.itypes.map((t) => typeName(data, t)).join(', ');
    lines.push({ text: `${rw.name}: ${rw.runes.map(runeName).join(' ')}`, colour: missing.length === 0 ? TIP.green : TIP.orange });
    if (missing.length > 0) lines.push({ text: `  Missing: ${missing.map(runeName).join(' ')}`, colour: TIP.grey });
    lines.push({ text: `  ${rw.runes.length} sockets in ${bases}`, colour: TIP.grey });
  }
  return lines;
}

/** The runes of a runeword the player lacks, in its order: a rune it takes twice needs two. */
export function missingRunes(runes: readonly string[], owned: ReadonlyMap<string, number> | undefined): string[] {
  const left = new Map(owned ?? []);
  const missing: string[] = [];
  for (const r of runes) {
    const n = left.get(r) ?? 0;
    if (n > 0) left.set(r, n - 1);
    else missing.push(r);
  }
  return missing;
}

/** How many more sockets Smith's Hammer could add to an item. */
export function socketsLeft(data: ItemData, item: Item): number {
  const base = data.bases[item.code];
  return base ? Math.max(0, maxSocketsAt(base, item.ilvl) - item.sockets) : 0;
}
