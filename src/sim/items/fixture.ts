// Item fixture tables for tests. The column names and property functions mirror the real
// tables so every code path runs; the codes, names and numbers are invented, none of them
// D2 data. Real items come from assets-extracted/data.

import type { TableRow, Tables } from '../tables.ts';

type ItemTables = Pick<
  Tables,
  | 'armor' | 'misc' | 'uniqueitems' | 'setitems' | 'sets' | 'magicprefix' | 'magicsuffix' | 'rareprefix' | 'raresuffix'
  | 'gems' | 'runes' | 'itemstatcost' | 'itemtypes' | 'properties' | 'treasureclassex' | 'itemratio' | 'qualityitems' | 'itemstrings'
>;

const type = (Code: string, Equiv1: string, extra: TableRow = {}): TableRow => ({ ItemType: Code, Code, Equiv1, Rare: 1, ...extra });
const worn = (BodyLoc1: string, sockets: [number, number, number] = [0, 0, 0]): TableRow => ({
  BodyLoc1,
  BodyLoc2: BodyLoc1,
  MaxSockets1: sockets[0],
  MaxSocketsLevelThreshold1: 25,
  MaxSockets2: sockets[1],
  MaxSocketsLevelThreshold2: 40,
  MaxSockets3: sockets[2],
});

/** One property: func N on a stat (properties.txt). */
const prop = (code: string, ...parts: [number, string?, number?][]): TableRow => {
  const row: TableRow = { code };
  parts.forEach(([func, stat, val], i) => {
    row[`func${i + 1}`] = func;
    if (stat) row[`stat${i + 1}`] = stat;
    if (val !== undefined) row[`val${i + 1}`] = val;
  });
  return row;
};

const base = (code: string, t: string, extra: TableRow): TableRow => ({
  code,
  namestr: code,
  type: t,
  level: 1,
  levelreq: 1,
  cost: 100,
  invwidth: 1,
  invheight: 1,
  spawnable: 1,
  normcode: code,
  ...extra,
});

/** Weapon rows to add to the fixture's weapons table (which already names the class weapons). */
export const FIXTURE_ITEM_WEAPONS: TableRow[] = [
  base('tsw', 'swor', { name: 'Test Sword', mindam: 2, maxdam: 8, rangeadder: 1, gemsockets: 3, invheight: 3, wclass: '1hs', ubercode: 'tsx', ultracode: 'tsy' }),
  base('tsy', 'swor', { name: 'Test Elite Sword', level: 50, mindam: 20, maxdam: 40, gemsockets: 6, invheight: 3, wclass: '1hs', normcode: 'tsw', ubercode: 'tsx', ultracode: 'tsy' }),
  base('tst', 'staf', { name: 'Test Staff', '2handed': 1, '2handmindam': 5, '2handmaxdam': 15, gemsockets: 6, invheight: 4, wclass: 'stf' }),
  base('tob', 'orb', { name: 'Test Orb', mindam: 1, maxdam: 3, gemsockets: 3, wclass: '1hs' }),
  base('tbw', 'bow', { name: 'Test Bow', '2handed': 1, '2handmindam': 30, '2handmaxdam': 60, gemsockets: 5, invheight: 4, wclass: 'bow' }),
];

export const FIXTURE_ITEM_TABLES: ItemTables = {
  itemtypes: [
    type('weap', ''),
    type('mele', 'weap'),
    type('swor', 'mele', worn('rarm', [3, 4, 6])),
    type('staf', 'mele', worn('rarm', [5, 6, 6])),
    type('orb', 'weap', { ...worn('rarm', [2, 3, 3]), Class: 'sor' }),
    type('miss', 'weap'),
    type('bow', 'miss', worn('rarm', [3, 4, 6])),
    type('armo', ''),
    type('shld', 'armo'),
    type('shie', 'shld', worn('rarm', [2, 3, 4])),
    type('ashd', 'shld', { ...worn('rarm', [3, 4, 4]), Class: 'pal' }),
    type('helm', 'armo', worn('head', [2, 2, 3])),
    type('tors', 'armo', worn('tors', [3, 4, 6])),
    type('misc', ''),
    type('ring', 'misc', { ...worn('rrin'), Magic: 1 }),
    type('amul', 'misc', { ...worn('neck'), Magic: 1 }),
    type('sock', ''),
    type('rune', 'sock', { Normal: 1, Rare: 0 }),
    type('gem', 'sock', { Normal: 1, Rare: 0 }),
    type('jewl', 'sock', { Magic: 1 }),
    type('hpot', 'misc', { Normal: 1, Rare: 0 }),
  ],
  armor: [
    base('tsh', 'shie', { name: 'Test Shield', minac: 10, maxac: 12, block: 20, gemsockets: 3, invheight: 2 }),
    base('tas', 'ashd', { name: 'Test Auric Shield', minac: 20, maxac: 24, block: 30, gemsockets: 4, invheight: 2 }),
    base('thl', 'helm', { name: 'Test Helm', minac: 4, maxac: 5, gemsockets: 2, invwidth: 2, invheight: 2 }),
    base('tar', 'tors', { name: 'Test Armor', minac: 30, maxac: 40, gemsockets: 4, invwidth: 2, invheight: 3 }),
  ],
  misc: [
    base('rin', 'ring', { name: 'Ring' }),
    base('amu', 'amul', { name: 'Amulet' }),
    base('r01', 'rune', { name: 'Rune One' }),
    base('r02', 'rune', { name: 'Rune Two', level: 5 }),
    base('gsr', 'gem', { name: 'Test Gem' }),
    base('jew', 'jewl', { name: 'Jewel' }),
    base('hp1', 'hpot', { name: 'Potion', stackable: 1, maxstack: 10 }),
  ],
  properties: [
    prop('dmg%', [7]),
    prop('dmg-min', [5]),
    prop('dmg-max', [6]),
    prop('dmg-fire', [15, 'firemindam'], [16, 'firemaxdam']),
    prop('dmg-cold', [15, 'coldmindam'], [16, 'coldmaxdam'], [17, 'coldlength']),
    prop('allskills', [1, 'item_allskills']),
    prop('pal', [21, 'item_addclassskills', 3]),
    prop('sor', [21, 'item_addclassskills', 1]),
    prop('skilltab', [10, 'item_addskill_tab']),
    prop('skill', [22, 'item_singleskill']),
    prop('swing2', [8, 'item_fasterattackrate']),
    prop('cast2', [8, 'item_fastercastrate']),
    prop('crush', [1, 'item_crushingblow']),
    prop('deadly', [1, 'item_deadlystrike']),
    prop('mag%', [1, 'item_magicbonus']),
    prop('gold%', [1, 'item_goldbonus']),
    prop('ac', [1, 'armorclass']),
    prop('ac%', [2, 'item_armor_percent']),
    prop('sock', [14, 'item_numsockets']),
    prop('ethereal', [23]),
    prop('hit-skill', [11, 'item_skillonhit']),
    prop('res-all', [1, 'fireresist'], [3, 'lightresist'], [3, 'coldresist'], [3, 'poisonresist']),
    prop('hp', [1, 'maxhp']),
  ],
  uniqueitems: [
    { index: 'Test Blade', code: 'tsw', lvl: 5, 'lvl req': 5, rarity: 1, 'cost mult': 5, 'cost add': 5000, prop1: 'dmg%', min1: 100, max1: 150, prop2: 'allskills', min2: 1, max2: 1, prop3: 'sock', min3: 2, max3: 2 },
    { index: 'Test Ring', code: 'rin', lvl: 10, 'lvl req': 10, rarity: 1, prop1: 'mag%', min1: 20, max1: 30, prop2: 'cast2', min2: 10, max2: 10 },
    { index: 'Disabled Unique', code: 'tsw', lvl: 1, rarity: 1, disabled: 1, prop1: 'dmg%', min1: 1, max1: 1 },
  ],
  setitems: [
    { index: 'Test Set Helm', set: 'Test Set', item: 'thl', lvl: 5, rarity: 1, prop1: 'ac', min1: 10, max1: 10, aprop1a: 'mag%', amin1a: 20, amax1a: 20 },
    { index: 'Test Set Shield', set: 'Test Set', item: 'tsh', lvl: 5, rarity: 1, prop1: 'ac', min1: 15, max1: 15 },
  ],
  sets: [{ index: 'Test Set', name: 'Test Set', PCode2a: 'gold%', PMin2a: 50, PMax2a: 50, FCode1: 'allskills', FMin1: 1, FMax1: 1 }],
  magicprefix: [
    { Name: 'Jagged', spawnable: 1, rare: 1, level: 1, maxlevel: 40, frequency: 2, group: 1, itype1: 'weap', mod1code: 'dmg%', mod1min: 10, mod1max: 20 },
    { Name: 'Sturdy', spawnable: 1, rare: 1, level: 1, frequency: 2, group: 2, itype1: 'armo', mod1code: 'ac%', mod1min: 10, mod1max: 20 },
    { Name: 'Holy', spawnable: 1, rare: 1, level: 1, frequency: 1, group: 3, class: 'pal', itype1: 'ashd', mod1code: 'pal', mod1min: 1, mod1max: 1 },
    { Name: 'Unspawnable', spawnable: 0, rare: 1, level: 1, frequency: 1, group: 4, itype1: 'weap', mod1code: 'dmg%', mod1min: 99, mod1max: 99 },
  ],
  magicsuffix: [
    { Name: 'of Speed', spawnable: 1, rare: 1, level: 1, frequency: 2, group: 11, itype1: 'weap', etype1: 'staf', mod1code: 'swing2', mod1min: 10, mod1max: 20 },
    { Name: 'of Fortune', spawnable: 1, rare: 1, level: 1, frequency: 2, group: 12, itype1: 'ring', itype2: 'amul', itype3: 'armo', mod1code: 'mag%', mod1min: 5, mod1max: 15 },
    { Name: 'of Crushing', spawnable: 1, rare: 1, level: 1, frequency: 1, group: 13, itype1: 'mele', mod1code: 'crush', mod1min: 10, mod1max: 10 },
  ],
  rareprefix: [{ name: 'Grim' }, { name: 'Dread' }],
  raresuffix: [{ name: 'Bite' }, { name: 'Ward' }],
  runes: [
    { Name: 'Runeword1', complete: 1, itype1: 'swor', Rune1: 'r01', Rune2: 'r02', T1Code1: 'dmg%', T1Min1: 50, T1Max1: 50, T1Code2: 'swing2', T1Min2: 20, T1Max2: 20 },
    { Name: 'Runeword2', complete: 0, itype1: 'swor', Rune1: 'r02', Rune2: 'r01', T1Code1: 'dmg%', T1Min1: 1, T1Max1: 1 },
  ],
  gems: [
    { code: 'gsr', weaponMod1Code: 'dmg-fire', weaponMod1Min: 1, weaponMod1Max: 3, helmMod1Code: 'mag%', helmMod1Min: 5, helmMod1Max: 5, shieldMod1Code: 'res-all', shieldMod1Min: 5, shieldMod1Max: 5 },
    { code: 'r01', weaponMod1Code: 'dmg-min', weaponMod1Min: 1, weaponMod1Max: 1, helmMod1Code: 'ac', helmMod1Min: 2, helmMod1Max: 2, shieldMod1Code: 'ac', shieldMod1Min: 2, shieldMod1Max: 2 },
    { code: 'r02', weaponMod1Code: 'dmg-max', weaponMod1Min: 2, weaponMod1Max: 2, helmMod1Code: 'hp', helmMod1Min: 5, helmMod1Max: 5, shieldMod1Code: 'hp', shieldMod1Min: 5, shieldMod1Max: 5 },
  ],
  itemstatcost: [],
  treasureclassex: [
    { 'Treasure Class': 'Runes 1', Picks: 1, Item1: 'r01', Prob1: 1 },
    { 'Treasure Class': 'Test Equip', Picks: 1, Item1: 'weap3', Prob1: 1 },
    { 'Treasure Class': 'Test Negative', Picks: -3, Item1: 'gsr', Prob1: 2, Item2: 'r01', Prob2: 5 },
    { 'Treasure Class': 'Test Group Low', group: 1, level: 0, Picks: 1, Item1: 'r01', Prob1: 1 },
    { 'Treasure Class': 'Test Group High', group: 1, level: 10, Picks: 1, Item1: 'r02', Prob1: 1 },
    { 'Treasure Class': 'Test Mixed', Picks: 1, Item1: 'Runes 1', Prob1: 1, Item2: 'tsw', Prob2: 1 },
    { 'Treasure Class': 'Test Nothing', Picks: 1, Item1: 'gld', Prob1: 3, Item2: 'hp1', Prob2: 3 },
    { 'Treasure Class': 'Test Kill', Picks: 2, NoDrop: 1, Item1: 'Runes 1', Prob1: 3, Item2: 'Test Equip', Prob2: 3 },
    { 'Treasure Class': 'Test Many', Picks: 9, Item1: 'r01', Prob1: 1 },
  ],
  itemratio: [
    { Version: 0, Uber: 0, 'Class Specific': 0, Unique: 900, UniqueDivisor: 1, UniqueMin: 9000 },
    ...[0, 1].flatMap((Uber) =>
      [0, 1].map((cls) => ({
        Version: 1, Uber, 'Class Specific': cls,
        Unique: 100, UniqueDivisor: 1, UniqueMin: 3000, Set: 80, SetDivisor: 2, SetMin: 2000, Rare: 50, RareDivisor: 2, RareMin: 1000,
        Magic: 10, MagicDivisor: 3, MagicMin: 100, HiQuality: 5, HiQualityDivisor: 4, Normal: 2, NormalDivisor: 2,
      })),
    ),
  ],
  qualityitems: [],
  itemstrings: [
    { Key: 'tsw', enUS: 'Test Sword' },
    { Key: 'Test Blade', enUS: 'The Test Blade' },
    { Key: 'Jagged', enUS: 'Jagged' },
    { Key: 'of Speed', enUS: 'of Speed' },
    { Key: 'Runeword1', enUS: 'First Word' },
  ],
};
