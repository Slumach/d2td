// Item data, read from the D2 tables (assets-extracted/data): every equippable base in
// weapons.txt, armor.txt and misc.txt (rings, amulets, jewels, gems, runes), with its type
// chain from itemtypes.txt; uniques, set items and set bonuses; magic and rare affixes;
// runewords and gem socket effects; and properties.txt, which turns a property code into
// the D2 stats it sets. Nothing is hand-listed: what the tables hold is what can drop.
// Charms, potions, scrolls, keys and quest items are left out.

import { findRow, int, str, type TableRow, type Tables } from '../tables.ts';

/** D2's paperdoll: where an item is worn. */
export type Slot = 'weapon' | 'shield' | 'helm' | 'armor' | 'gloves' | 'boots' | 'belt' | 'ring1' | 'ring2' | 'amulet';
export const SLOTS: readonly Slot[] = ['weapon', 'shield', 'helm', 'armor', 'gloves', 'boots', 'belt', 'ring1', 'ring2', 'amulet'];

/** itemtypes.txt BodyLoc1 to our slot. */
const BODY_LOC: Record<string, Slot[]> = {
  rarm: ['weapon', 'shield'],
  larm: ['shield', 'weapon'],
  head: ['helm'],
  tors: ['armor'],
  glov: ['gloves'],
  feet: ['boots'],
  belt: ['belt'],
  rrin: ['ring1', 'ring2'],
  lrin: ['ring1', 'ring2'],
  neck: ['amulet'],
};

/** itemtypes.txt Class codes, by our tower classes; the other four classes' items fit no tower. */
export const CLASS_CODES: Record<string, string> = { amazon: 'ama', sorceress: 'sor', necromancer: 'nec', paladin: 'pal', barbarian: 'bar', druid: 'dru', assassin: 'ass' };

export type BaseKind = 'weapon' | 'armor' | 'misc';

export interface ItemBase {
  code: string;
  name: string;
  kind: BaseKind;
  /** Its itemtypes.txt type and every type it counts as (Equiv1, Equiv2, up the chain). */
  type: string;
  types: string[];
  /** The slots it can be worn in, in order of preference; none for gems, runes and jewels. */
  slots: Slot[];
  /** Two-handed weapons fill the shield slot too (1or2handed weapons count as one-handed). */
  twoHanded: boolean;
  /** itemtypes.txt Class (pal, sor, nec, ...): only that class's towers may wear it. */
  classOnly?: string;
  /** Normal, exceptional or elite (weapons.txt and armor.txt normcode, ubercode, ultracode). */
  tier: 0 | 1 | 2;
  level: number;
  levelReq: number;
  /** misc.txt / weapons.txt / armor.txt magic lvl: added to the item level for affixes. */
  magicLevel: number;
  cost: number;
  /** The base's own socket limit (gemsockets) and its type's limits by item level. */
  gemSockets: number;
  maxSockets: [number, number, number];
  socketLevels: [number, number];
  /** Inventory size and art. */
  width: number;
  height: number;
  invFile: string;
  /** Weapons: one-hand (or two-hand) damage, D2 speed, rangeadder; armour: defence and block. */
  minDamage: number;
  maxDamage: number;
  speed: number;
  rangeAdder: number;
  minAc: number;
  maxAc: number;
  block: number;
  /** weapons.txt wclass, for the hero layer it draws with. */
  wclass: string;
  /** Can be magic or rare (itemtypes Magic/Rare), or only normal (gems, runes). */
  canMagic: boolean;
  /** Rings, amulets and jewels: never normal (itemtypes Magic). */
  alwaysMagic: boolean;
  /** Sound names (dropsound, usesound): landing on the ground, going into the inventory. */
  dropSound: string;
  useSound: string;
  /** weapons.txt / armor.txt rarity: its weight in an automatic treasure class. */
  rarity: number;
  /** Our own consumables: Smith's Hammer adds a socket, Wirt's Leg opens the cow portal. */
  consumable?: 'socket' | 'cowPortal';
  canRare: boolean;
  stackable: boolean;
  maxStack: number;
  /** misc.txt type/code for gems and runes. */
  isGem: boolean;
  isRune: boolean;
  isJewel: boolean;
  /** The base's own stats (misc.txt stat1-3: a rune or gem's description holder; empty for most). */
  autoPrefix: number;
}

/** A property as an item carries it: code, param, min, max (uniqueitems prop1/par1/min1/max1). */
export interface PropRoll {
  code: string;
  param: string;
  min: number;
  max: number;
}

export interface UniqueDef {
  id: string;
  name: string;
  code: string;
  level: number;
  levelReq: number;
  rarity: number;
  props: PropRoll[];
  costMult: number;
  costAdd: number;
}

export interface SetItemDef {
  id: string;
  name: string;
  set: string;
  code: string;
  level: number;
  levelReq: number;
  rarity: number;
  props: PropRoll[];
  /** Bonuses for wearing more of the set: [2 items worn, 3, 4, 5, 6], each a list. */
  partial: PropRoll[][];
  costMult: number;
  costAdd: number;
}

export interface SetDef {
  id: string;
  name: string;
  /** Bonuses by items worn: index 0 for 2 items ... 3 for 5 items. */
  partial: PropRoll[][];
  full: PropRoll[];
  items: string[];
}

export interface AffixDef {
  id: string;
  name: string;
  prefix: boolean;
  level: number;
  maxLevel: number;
  levelReq: number;
  frequency: number;
  group: number;
  rare: boolean;
  classOnly?: string;
  itypes: string[];
  etypes: string[];
  props: PropRoll[];
  /** Price columns: cost x multiply / 1024 + add. */
  multiply: number;
  add: number;
}

export interface RunewordDef {
  id: string;
  name: string;
  itypes: string[];
  etypes: string[];
  runes: string[];
  props: PropRoll[];
}

export interface GemDef {
  code: string;
  weapon: PropRoll[];
  helm: PropRoll[];
  shield: PropRoll[];
}

/** properties.txt: what a property code sets. func 15/16/17 take min, max and param. */
export interface PropertyDef {
  code: string;
  parts: { func: number; stat: string; set: number; val: number }[];
}

export interface ItemData {
  bases: Record<string, ItemBase>;
  uniques: UniqueDef[];
  setItems: SetItemDef[];
  sets: Record<string, SetDef>;
  prefixes: AffixDef[];
  suffixes: AffixDef[];
  runewords: RunewordDef[];
  gems: Record<string, GemDef>;
  properties: Record<string, PropertyDef>;
  /** itemtypes.txt: a type's Equiv chain (itself first), and its name. */
  typeChain: Record<string, string[]>;
  typeNames: Record<string, string>;
  /** D2R's English strings by key. */
  strings: Record<string, string>;
  /** Rune codes in order of rarity: r01 (El) to r33 (Zod). */
  runeOrder: string[];
  /** Rare names' two words (rareprefix.txt, raresuffix.txt). */
  rarePrefixes: RareName[];
  /** treasureclassex.txt by name, and each group's classes by level (for D2's level upgrade). */
  treasureClasses: Record<string, TreasureClass>;
  tcGroups: Record<number, TreasureClass[]>;
  /** Automatic treasure classes (weap3 ... armo87): bases of a type by level, built when first asked for. */
  autoTc: Record<string, ItemBase[]>;
  /** itemratio.txt, the expansion rows. */
  itemRatios: ItemRatio[];
  /** itemstatcost.txt: how each stat reads in a tooltip. */
  statDescs: Record<string, StatDesc>;
  rareSuffixes: RareName[];
}

/** treasureclassex.txt: a class's picks, its NoDrop weight, its quality bonuses and its entries. */
export interface TreasureClass {
  name: string;
  picks: number;
  noDrop: number;
  group: number;
  level: number;
  /** Unique, Set, Rare, Magic columns: x/1024 off each quality's roll (higher is better). */
  quality: { unique: number; set: number; rare: number; magic: number };
  items: { name: string; prob: number }[];
}

/** itemstatcost.txt's tooltip columns: priority (higher first), function and string keys, and the group a stat shares a line with. */
export interface StatDesc {
  priority: number;
  func: number;
  pos: string;
  neg: string;
  str2: string;
  group: number;
  groupFunc: number;
  groupPos: string;
}

/** itemratio.txt: the quality odds for normal, exceptional and elite, and class items. */
export interface ItemRatio {
  uber: boolean;
  classSpecific: boolean;
  unique: [number, number, number];
  set: [number, number, number];
  rare: [number, number, number];
  magic: [number, number, number];
  hiQuality: [number, number];
}

/** itemtypes.txt types with TreasureClass 1: the game builds weap3, armo87 and so on from them. */
export const AUTO_TC_TYPES = ['weap', 'armo', 'bow', 'mele', 'abow'];

/** Item types that never drop or equip here: charms, potions, scrolls, keys, quest items, gold, arrows and bolts (no tower needs ammunition). */
const EXCLUDED_TYPES = new Set(['char', 'scha', 'mcha', 'lcha', 'hpot', 'mpot', 'rpot', 'spot', 'apot', 'wpot', 'scro', 'book', 'key', 'quest', 'gold', 'body', 'elix', 'herb', 'torch', 'tpot', 'play', 'ques', 'bowq', 'xboq']);

function props(row: TableRow, code: (i: number) => string, param: (i: number) => string, min: (i: number) => string, max: (i: number) => string, count: number): PropRoll[] {
  const out: PropRoll[] = [];
  for (let i = 1; i <= count; i++) {
    const c = str(row, code(i));
    if (!c) continue;
    out.push({ code: c, param: String(row[param(i)] ?? ''), min: num(row, min(i)), max: num(row, max(i)) });
  }
  return out;
}

/** A number column, empty as 0; tolerant of text in odd rows. */
function num(row: TableRow, key: string): number {
  const v = row[key];
  return typeof v === 'number' ? v : 0;
}

/** A rare name word and the item types it may name (rareprefix.txt, raresuffix.txt itype columns). */
export interface RareName {
  name: string;
  itypes: string[];
}

export function buildItemData(tables: Tables): ItemData {
  const strings: Record<string, string> = {};
  for (const r of tables.itemstrings ?? []) strings[str(r, 'Key')] = str(r, 'enUS');
  const nameOf = (key: string) => strings[key] ?? key;

  // Type chains through Equiv1/Equiv2
  const typeRows = new Map((tables.itemtypes ?? []).filter((r) => str(r, 'Code')).map((r) => [str(r, 'Code'), r]));
  const typeChain: Record<string, string[]> = {};
  const chainOf = (code: string): string[] => {
    if (typeChain[code]) return typeChain[code]!;
    const seen: string[] = [];
    const walk = (c: string) => {
      if (!c || seen.includes(c)) return;
      seen.push(c);
      const r = typeRows.get(c);
      if (r) {
        walk(str(r, 'Equiv1'));
        walk(str(r, 'Equiv2'));
      }
    };
    walk(code);
    return (typeChain[code] = seen);
  };
  for (const code of typeRows.keys()) chainOf(code);
  const classOf = (types: string[]) => types.map((t) => str(typeRows.get(t) ?? {}, 'Class')).find((c) => c);
  const flag = (types: string[], col: string) => types.some((t) => num(typeRows.get(t) ?? {}, col) === 1);

  const bases: Record<string, ItemBase> = {};
  const addBase = (row: TableRow, kind: BaseKind) => {
    const code = str(row, 'code');
    const type = str(row, 'type');
    if (!code || !type || (num(row, 'spawnable') === 0 && kind !== 'misc') || num(row, 'quest') > 0) return;
    const types = chainOf(type);
    if (types.some((t) => EXCLUDED_TYPES.has(t))) return;
    const typeRow = typeRows.get(type) ?? {};
    const loc = str(typeRow, 'BodyLoc1');
    const isGem = types.includes('gem');
    const isRune = types.includes('rune');
    const isJewel = types.includes('jewl');
    const slots = BODY_LOC[loc] ?? [];
    // misc.txt holds much more than this game uses: only worn items, gems, runes and jewels
    if (kind === 'misc' && slots.length === 0 && !isGem && !isRune && !isJewel) return;
    const tierOf = (): 0 | 1 | 2 => (code === str(row, 'ultracode') ? 2 : code === str(row, 'ubercode') ? 1 : 0);
    const twoHanded = kind === 'weapon' && num(row, '2handed') === 1 && num(row, '1or2handed') !== 1;
    bases[code] = {
      code,
      name: nameOf(str(row, 'namestr') || code),
      kind,
      type,
      types,
      slots: kind === 'weapon' ? ['weapon'] : types.includes('shld') ? ['shield'] : slots.filter((s) => s !== 'weapon'),
      twoHanded,
      classOnly: classOf(types),
      tier: kind === 'misc' ? 0 : tierOf(),
      level: num(row, 'level'),
      levelReq: num(row, 'levelreq'),
      magicLevel: num(row, 'magic lvl'),
      cost: num(row, 'cost'),
      gemSockets: num(row, 'gemsockets'),
      maxSockets: [num(typeRow, 'MaxSockets1'), num(typeRow, 'MaxSockets2'), num(typeRow, 'MaxSockets3')],
      socketLevels: [num(typeRow, 'MaxSocketsLevelThreshold1') || 25, num(typeRow, 'MaxSocketsLevelThreshold2') || 40],
      width: num(row, 'invwidth') || 1,
      height: num(row, 'invheight') || 1,
      invFile: str(row, 'invfile'),
      minDamage: twoHanded ? num(row, '2handmindam') : num(row, 'mindam') || num(row, '2handmindam') || num(row, 'minmisdam'),
      maxDamage: twoHanded ? num(row, '2handmaxdam') : num(row, 'maxdam') || num(row, '2handmaxdam') || num(row, 'maxmisdam'),
      speed: num(row, 'speed'),
      rangeAdder: num(row, 'rangeadder'),
      minAc: num(row, 'minac'),
      maxAc: num(row, 'maxac'),
      block: num(row, 'block'),
      wclass: str(row, 'wclass'),
      canMagic: flag(types, 'Magic') || num(typeRow, 'Normal') !== 1,
      alwaysMagic: flag(types, 'Magic'),
      dropSound: str(row, 'dropsound'),
      useSound: str(row, 'usesound'),
      rarity: num(row, 'rarity') || 1,
      canRare: flag(types, 'Rare'),
      stackable: num(row, 'stackable') === 1,
      maxStack: num(row, 'maxstack') || 1,
      isGem,
      isRune,
      isJewel,
      autoPrefix: num(row, 'auto prefix'),
    };
  };
  for (const r of tables.weapons ?? []) addBase(r, 'weapon');
  for (const r of tables.armor ?? []) addBase(r, 'armor');
  for (const r of tables.misc ?? []) addBase(r, 'misc');

  const p4 = (pre: string) => [(i: number) => `${pre}prop${i}`, (i: number) => `${pre}par${i}`, (i: number) => `${pre}min${i}`, (i: number) => `${pre}max${i}`] as const;
  const live = (r: TableRow) => num(r, 'disabled') !== 1 && (r['spawnable'] === undefined || num(r, 'spawnable') === 1);

  const uniques: UniqueDef[] = (tables.uniqueitems ?? [])
    .filter((r) => str(r, 'index') && str(r, 'code') && live(r) && bases[str(r, 'code')])
    .map((r) => {
      const [c, p, mi, ma] = p4('');
      return {
        id: str(r, 'index'),
        name: nameOf(str(r, 'index')),
        code: str(r, 'code'),
        level: num(r, 'lvl'),
        levelReq: num(r, 'lvl req'),
        rarity: Math.max(1, num(r, 'rarity')),
        props: props(r, c, p, mi, ma, 12),
        costMult: num(r, 'cost mult') || 1,
        costAdd: num(r, 'cost add'),
      };
    });

  const setItems: SetItemDef[] = (tables.setitems ?? [])
    .filter((r) => str(r, 'index') && str(r, 'item') && live(r) && bases[str(r, 'item')])
    .map((r) => {
      const [c, p, mi, ma] = p4('');
      // aprop1a/aprop1b: worn with 2 of the set, aprop2a/b with 3, and so on
      const partial = [1, 2, 3, 4, 5].map((n) =>
        ['a', 'b'].flatMap((x) => props(r, () => `aprop${n}${x}`, () => `apar${n}${x}`, () => `amin${n}${x}`, () => `amax${n}${x}`, 1)),
      );
      return {
        id: str(r, 'index'),
        name: nameOf(str(r, 'index')),
        set: str(r, 'set'),
        code: str(r, 'item'),
        level: num(r, 'lvl'),
        levelReq: num(r, 'lvl req'),
        rarity: Math.max(1, num(r, 'rarity')),
        props: props(r, c, p, mi, ma, 9),
        partial,
        costMult: num(r, 'cost mult') || 1,
        costAdd: num(r, 'cost add'),
      };
    });

  const sets: Record<string, SetDef> = {};
  for (const r of tables.sets ?? []) {
    const id = str(r, 'index');
    if (!id) continue;
    const partial = [2, 3, 4, 5].map((n) => ['a', 'b'].flatMap((x) => props(r, () => `PCode${n}${x}`, () => `PParam${n}${x}`, () => `PMin${n}${x}`, () => `PMax${n}${x}`, 1)));
    sets[id] = {
      id,
      name: nameOf(str(r, 'name') || id),
      partial,
      full: props(r, (i) => `FCode${i}`, (i) => `FParam${i}`, (i) => `FMin${i}`, (i) => `FMax${i}`, 8),
      items: setItems.filter((s) => s.set === id).map((s) => s.id),
    };
  }

  const affixes = (rows: TableRow[], prefix: boolean): AffixDef[] =>
    rows
      .filter((r) => str(r, 'Name') && num(r, 'spawnable') === 1 && num(r, 'frequency') > 0)
      .map((r, i) => ({
        id: `${prefix ? 'p' : 's'}${i}`,
        name: nameOf(str(r, 'Name')),
        prefix,
        level: num(r, 'level'),
        maxLevel: num(r, 'maxlevel') || 999,
        levelReq: num(r, 'levelreq'),
        frequency: num(r, 'frequency'),
        group: num(r, 'group'),
        rare: num(r, 'rare') === 1,
        classOnly: str(r, 'class') || undefined,
        itypes: [1, 2, 3, 4, 5, 6, 7].map((k) => str(r, `itype${k}`)).filter((t) => t),
        etypes: [1, 2, 3, 4, 5].map((k) => str(r, `etype${k}`)).filter((t) => t),
        props: props(r, (k) => `mod${k}code`, (k) => `mod${k}param`, (k) => `mod${k}min`, (k) => `mod${k}max`, 3),
        multiply: num(r, 'multiply'),
        add: num(r, 'add'),
      }));

  const runewords: RunewordDef[] = (tables.runes ?? [])
    .filter((r) => num(r, 'complete') === 1)
    .map((r) => ({
      id: str(r, 'Name'),
      name: nameOf(str(r, 'Name')),
      itypes: [1, 2, 3, 4, 5, 6].map((k) => str(r, `itype${k}`)).filter((t) => t),
      etypes: [1, 2, 3].map((k) => str(r, `etype${k}`)).filter((t) => t),
      runes: [1, 2, 3, 4, 5, 6].map((k) => str(r, `Rune${k}`)).filter((t) => t),
      props: props(r, (k) => `T1Code${k}`, (k) => `T1Param${k}`, (k) => `T1Min${k}`, (k) => `T1Max${k}`, 7),
    }));

  const gems: Record<string, GemDef> = {};
  for (const r of tables.gems ?? []) {
    const code = str(r, 'code');
    if (!code) continue;
    const of = (pre: string) => props(r, (k) => `${pre}Mod${k}Code`, (k) => `${pre}Mod${k}Param`, (k) => `${pre}Mod${k}Min`, (k) => `${pre}Mod${k}Max`, 3);
    gems[code] = { code, weapon: of('weapon'), helm: of('helm'), shield: of('shield') };
  }

  const properties: Record<string, PropertyDef> = {};
  for (const r of tables.properties ?? []) {
    const code = str(r, 'code');
    if (!code) continue;
    const parts: PropertyDef['parts'] = [];
    for (let i = 1; i <= 7; i++) {
      const func = num(r, `func${i}`);
      if (!func) continue;
      parts.push({ func, stat: str(r, `stat${i}`), set: num(r, `set${i}`), val: num(r, `val${i}`) });
    }
    properties[code] = { code, parts };
  }

  // Our consumables, drawn with D2 art: Smith's Hammer as the Hellforge Hammer, Wirt's Leg as itself
  const special = (code: string, from: string | undefined, name: string, consumable: ItemBase['consumable']) => {
    const row = from ? (tables.weapons ?? []).find((r) => str(r, 'code') === from) : undefined;
    bases[code] = {
      ...emptyBase(code, name),
      invFile: row ? str(row, 'invfile') : '',
      dropSound: row ? str(row, 'dropsound') : '',
      useSound: row ? str(row, 'usesound') : '',
      width: row ? num(row, 'invwidth') || 1 : 1,
      height: row ? num(row, 'invheight') || 1 : 1,
      stackable: true,
      maxStack: 99,
      consumable,
    };
  };
  special(SMITHS_HAMMER, 'hfh', "Smith's Hammer", 'socket');
  const leg = (tables.weapons ?? []).find((r) => str(r, 'code') === 'leg');
  special(WIRTS_LEG, 'leg', leg ? nameOf(str(leg, 'namestr') || 'leg') : "Wirt's Leg", 'cowPortal');

  const treasureClasses: Record<string, TreasureClass> = {};
  const tcGroups: Record<number, TreasureClass[]> = {};
  for (const r of tables.treasureclassex ?? []) {
    const name = str(r, 'Treasure Class');
    if (!name) continue;
    const items: TreasureClass['items'] = [];
    for (let i = 1; i <= 10; i++) {
      const item = str(r, `Item${i}`);
      if (item) items.push({ name: item, prob: num(r, `Prob${i}`) });
    }
    const tc: TreasureClass = {
      name,
      picks: num(r, 'Picks') || 1,
      noDrop: num(r, 'NoDrop'),
      group: num(r, 'group'),
      level: num(r, 'level'),
      quality: { unique: num(r, 'Unique'), set: num(r, 'Set'), rare: num(r, 'Rare'), magic: num(r, 'Magic') },
      items,
    };
    treasureClasses[name] = tc;
    if (tc.group > 0) (tcGroups[tc.group] ??= []).push(tc);
  }
  for (const g of Object.values(tcGroups)) g.sort((a, b) => a.level - b.level);

  const rareNames = (rows: TableRow[]): RareName[] =>
    rows
      .filter((r) => str(r, 'name'))
      .map((r) => ({ name: nameOf(str(r, 'name')), itypes: [1, 2, 3, 4, 5, 6, 7].map((k) => str(r, `itype${k}`)).filter((t) => t) }));

  const runeOrder = Object.values(bases)
    .filter((b) => b.isRune)
    .map((b) => b.code)
    .sort();

  return {
    bases,
    uniques,
    setItems,
    sets,
    prefixes: affixes(tables.magicprefix ?? [], true),
    suffixes: affixes(tables.magicsuffix ?? [], false),
    runewords,
    gems,
    properties,
    typeChain,
    typeNames: Object.fromEntries([...typeRows].map(([code, r]) => [code, str(r, 'ItemType') || code])),
    strings,
    runeOrder,
    rarePrefixes: rareNames(tables.rareprefix ?? []),
    rareSuffixes: rareNames(tables.raresuffix ?? []),
    treasureClasses,
    tcGroups,
    statDescs: Object.fromEntries(
      (tables.itemstatcost ?? [])
        .filter((r) => str(r, 'Stat'))
        .map((r) => [
          str(r, 'Stat'),
          {
            priority: num(r, 'descpriority'),
            func: num(r, 'descfunc'),
            pos: str(r, 'descstrpos'),
            neg: str(r, 'descstrneg'),
            str2: str(r, 'descstr2'),
            group: num(r, 'dgrp'),
            groupFunc: num(r, 'dgrpfunc'),
            groupPos: str(r, 'dgrpstrpos'),
          },
        ]),
    ),
    autoTc: {},
    itemRatios: (tables.itemratio ?? [])
      .filter((r) => num(r, 'Version') === 1)
      .map((r) => ({
        uber: num(r, 'Uber') === 1,
        classSpecific: num(r, 'Class Specific') === 1,
        unique: [num(r, 'Unique'), Math.max(1, num(r, 'UniqueDivisor')), num(r, 'UniqueMin')],
        set: [num(r, 'Set'), Math.max(1, num(r, 'SetDivisor')), num(r, 'SetMin')],
        rare: [num(r, 'Rare'), Math.max(1, num(r, 'RareDivisor')), num(r, 'RareMin')],
        magic: [num(r, 'Magic'), Math.max(1, num(r, 'MagicDivisor')), num(r, 'MagicMin')],
        hiQuality: [num(r, 'HiQuality'), Math.max(1, num(r, 'HiQualityDivisor'))],
      })),
  };
}

/** Our consumables' codes (not D2 items; drawn with D2 art). */
export const SMITHS_HAMMER = 'xsh';
export const WIRTS_LEG = 'leg';

function emptyBase(code: string, name: string): ItemBase {
  return {
    code, name, kind: 'misc', type: code, types: [code], slots: [], twoHanded: false, tier: 0, level: 0, levelReq: 0, magicLevel: 0,
    dropSound: '', useSound: '', cost: 0, gemSockets: 0, maxSockets: [0, 0, 0], socketLevels: [25, 40], width: 1, height: 1, invFile: '', minDamage: 0, maxDamage: 0,
    speed: 0, rangeAdder: 0, minAc: 0, maxAc: 0, block: 0, wclass: '', canMagic: false, canRare: false, alwaysMagic: false, rarity: 0,
    stackable: false, maxStack: 1, isGem: false, isRune: false, isJewel: false, autoPrefix: 0,
  };
}

/**
 * An automatic treasure class (weap33: weapons of levels 31 to 33), built from the bases
 * the first time a drop asks for it. Undefined when the name is not one.
 */
export function autoTreasure(data: ItemData, name: string): ItemBase[] | undefined {
  const hit = data.autoTc[name];
  if (hit) return hit;
  const m = /^([a-z]+)(\d+)$/.exec(name);
  if (!m || !AUTO_TC_TYPES.includes(m[1]!)) return undefined;
  const type = m[1]!;
  const top = Number(m[2]);
  const list = Object.values(data.bases).filter((b) => !b.consumable && b.types.includes(type) && b.level > top - 3 && b.level <= top && b.rarity > 0);
  data.autoTc[name] = list;
  return list;
}

/** True when an item of `base` is of type `t` (through its Equiv chain). */
export function isType(data: ItemData, base: ItemBase, t: string): boolean {
  return base.types.includes(t) || base.types.some((x) => (data.typeChain[x] ?? []).includes(t));
}

/** The base's socket limit at an item level: its type's limit by level, capped by its own gemsockets. */
export function maxSocketsAt(base: ItemBase, ilvl: number): number {
  const byLevel = ilvl <= base.socketLevels[0] ? base.maxSockets[0] : ilvl <= base.socketLevels[1] ? base.maxSockets[1] : base.maxSockets[2];
  return Math.min(base.gemSockets, byLevel);
}

export { findRow, int };
