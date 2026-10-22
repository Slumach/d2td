import { describe, expect, it } from 'vitest';
import { FIXTURE_TABLES } from '../fixture.ts';
import { createRng } from '../rng.ts';
import { buildItemData, maxSocketsAt } from './data.ts';
import { towerGear } from './gear.ts';
import { canWear, itemName, itemStats, makeRuneword, rollItem, runewordFor, type Item } from './item.ts';

const data = buildItemData(FIXTURE_TABLES);
const plain = (code: string, extra: Partial<Item> = {}): Item => ({ uid: code, code, quality: 'normal', ilvl: 30, sockets: 0, socketed: [], stats: [], ...extra });

describe('item data', () => {
  it('reads every worn base, gem, rune and jewel, and leaves potions out', () => {
    expect(Object.keys(data.bases).sort()).toEqual(['amu', 'gsr', 'jew', 'leg', 'r01', 'r02', 'rin', 'tar', 'tas', 'thl', 'tob', 'tsh', 'tst', 'tsw', 'tsy', 'xsh'].sort());
    expect(data.bases['tst']!.twoHanded).toBe(true);
    expect(data.bases['tsw']!.twoHanded).toBe(false);
    expect(data.bases['tsy']!.tier).toBe(2);
    expect(data.bases['tas']!.classOnly).toBe('pal');
    expect(data.bases['tsh']!.slots).toEqual(['shield']);
    expect(data.bases['rin']!.slots).toEqual(['ring1', 'ring2']);
    expect(data.bases['r01']!.isRune).toBe(true);
    expect(data.runeOrder).toEqual(['r01', 'r02']);
  });

  it('keeps disabled uniques, unspawnable affixes and incomplete runewords out', () => {
    expect(data.uniques.map((u) => u.id)).toEqual(['Test Blade', 'Test Ring']);
    expect(data.prefixes.map((a) => a.name)).not.toContain('Unspawnable');
    expect(data.runewords.map((r) => r.id)).toEqual(['Runeword1']);
    expect(data.sets['Test Set']!.items).toEqual(['Test Set Helm', 'Test Set Shield']);
  });

  it('caps sockets by the type limit for the item level and the base', () => {
    expect(maxSocketsAt(data.bases['tsw']!, 10)).toBe(3);
    expect(maxSocketsAt(data.bases['tsw']!, 30)).toBe(3);
    expect(maxSocketsAt(data.bases['tsy']!, 30)).toBe(4);
    expect(maxSocketsAt(data.bases['tsy']!, 60)).toBe(6);
  });
});

describe('rolling items', () => {
  it('is the same item for the same seed', () => {
    const a = rollItem(data, createRng(7), { uid: 'a', code: 'tsw', ilvl: 30, quality: 'rare' });
    const b = rollItem(data, createRng(7), { uid: 'a', code: 'tsw', ilvl: 30, quality: 'rare' });
    expect(a).toEqual(b);
    expect(a.quality).toBe('rare');
    expect(a.rareName).toBeDefined();
  });

  it('rolls a unique with its properties in range and its sockets', () => {
    const u = rollItem(data, createRng(1), { uid: 'u', code: 'tsw', ilvl: 30, quality: 'unique' });
    expect(u.unique).toBe('Test Blade');
    expect(itemName(data, u)).toBe('The Test Blade');
    const ed = u.stats.find((s) => s.stat === 'item_maxdamage_percent')!.value;
    expect(ed).toBeGreaterThanOrEqual(100);
    expect(ed).toBeLessThanOrEqual(150);
    expect(u.sockets).toBe(2);
  });

  it('falls back from unique to rare when no unique fits the base or level', () => {
    expect(rollItem(data, createRng(1), { uid: 'x', code: 'tar', ilvl: 30, quality: 'unique' }).quality).toBe('rare');
    expect(rollItem(data, createRng(1), { uid: 'x', code: 'tsw', ilvl: 1, quality: 'unique' }).quality).toBe('rare');
  });

  it('rolls magic affixes only from the item type, never excluded types', () => {
    for (let seed = 1; seed < 40; seed++) {
      const staff = rollItem(data, createRng(seed), { uid: 's', code: 'tst', ilvl: 20, quality: 'magic' });
      expect(staff.suffixes ?? []).not.toContain(data.suffixes.find((a) => a.name === 'of Speed')!.id);
      expect(staff.stats.some((s) => s.stat === 'item_armor_percent')).toBe(false);
    }
  });

  it('never rolls a class affix on another class item', () => {
    for (let seed = 1; seed < 40; seed++) {
      const shield = rollItem(data, createRng(seed), { uid: 's', code: 'tsh', ilvl: 20, quality: 'rare' });
      expect(shield.stats.some((s) => s.stat === 'item_addclassskills')).toBe(false);
    }
  });

  it('makes gems and runes plain', () => {
    expect(rollItem(data, createRng(3), { uid: 'r', code: 'r01', ilvl: 80, quality: 'unique' }).quality).toBe('normal');
  });
});

describe('sockets and runewords', () => {
  it('gives a gem its weapon, helm or shield stats by where it sits', () => {
    const gem = plain('gsr');
    expect(itemStats(data, plain('tsw', { sockets: 1, socketed: [gem] })).map((s) => s.stat)).toEqual(['firemindam', 'firemaxdam']);
    expect(itemStats(data, plain('thl', { sockets: 1, socketed: [gem] })).map((s) => s.stat)).toEqual(['item_magicbonus']);
    expect(itemStats(data, plain('tsh', { sockets: 1, socketed: [gem] })).map((s) => s.stat)).toContain('coldresist');
  });

  it('spells a runeword from the runes in order on a fitting base with exactly that many sockets', () => {
    const sword = plain('tsw', { sockets: 2, socketed: [plain('r01'), plain('r02')] });
    const rw = runewordFor(data, sword)!;
    expect(rw.id).toBe('Runeword1');
    makeRuneword(data, createRng(1), sword, rw);
    expect(itemName(data, sword)).toBe('First Word');
    expect(itemStats(data, sword).map((s) => s.stat)).toEqual(['item_maxdamage_percent', 'item_mindamage_percent', 'item_fasterattackrate', 'mindamage', 'maxdamage']);
    expect(runewordFor(data, plain('tsw', { sockets: 2, socketed: [plain('r02'), plain('r01')] }))).toBeUndefined();
    expect(runewordFor(data, plain('tsw', { sockets: 3, socketed: [plain('r01'), plain('r02')] }))).toBeUndefined();
    expect(runewordFor(data, plain('tsh', { sockets: 2, socketed: [plain('r01'), plain('r02')] }))).toBeUndefined();
    expect(runewordFor(data, plain('tsw', { quality: 'magic', sockets: 2, socketed: [plain('r01'), plain('r02')] }))).toBeUndefined();
  });
});

describe('wearing', () => {
  it('keeps two-handed weapons and shields apart, and class items to their class', () => {
    expect(canWear(data, plain('tsh'), 'shield', 'paladin', { weapon: plain('tst') })).toBe(false);
    expect(canWear(data, plain('tst'), 'weapon', 'paladin', { shield: plain('tsh') })).toBe(false);
    expect(canWear(data, plain('tsw'), 'weapon', 'paladin', { shield: plain('tsh') })).toBe(true);
    expect(canWear(data, plain('tas'), 'shield', 'paladin', {})).toBe(true);
    expect(canWear(data, plain('tas'), 'shield', 'sorceress', {})).toBe(false);
    expect(canWear(data, plain('tob'), 'weapon', 'sorceress', {})).toBe(true);
    expect(canWear(data, plain('rin'), 'ring2', 'necromancer', {})).toBe(true);
    expect(canWear(data, plain('rin'), 'helm', 'necromancer', {})).toBe(false);
  });

  it('sums stats into tower effects, with +class skills only for that class', () => {
    const ring = plain('rin', { quality: 'magic', stats: [{ stat: 'item_magicbonus', value: 10 }, { stat: 'item_addclassskills', param: '3', value: 2 }] });
    const amu = plain('amu', { quality: 'magic', stats: [{ stat: 'item_allskills', value: 1 }, { stat: 'item_fastercastrate', value: 20 }] });
    const pal = towerGear(data, { ring1: ring, ring2: { ...ring, uid: 'r2' }, amulet: amu }, 'paladin');
    expect(pal.plusSkills).toBe(5);
    expect(pal.magicFindPct).toBe(20);
    expect(pal.castSpeedPct).toBe(20);
    expect(towerGear(data, { ring1: ring, amulet: amu }, 'sorceress').plusSkills).toBe(1);
  });

  it('scales the worn weapon by its enhanced damage and adds set bonuses for pieces worn', () => {
    const sword = plain('tsw', { stats: [{ stat: 'item_maxdamage_percent', value: 100 }, { stat: 'item_mindamage_percent', value: 100 }] });
    expect(towerGear(data, { weapon: sword }, 'paladin').weapon).toEqual({ min: 2, max: 8 });
    expect(towerGear(data, { weapon: sword }, 'paladin').damagePct).toBe(100);
    const jewel = plain('jew', { stats: [{ stat: 'mindamage', value: 3 }, { stat: 'maxdamage', value: 5 }] });
    expect(towerGear(data, { weapon: { ...sword, ethereal: true, sockets: 1, socketed: [jewel] } }, 'paladin').weapon).toEqual({ min: 6, max: 17 });
    const helm = plain('thl', { quality: 'set', setItem: 'Test Set Helm', stats: [{ stat: 'armorclass', value: 10 }] });
    const shield = plain('tsh', { quality: 'set', setItem: 'Test Set Shield', stats: [{ stat: 'armorclass', value: 15 }] });
    const one = towerGear(data, { helm }, 'paladin');
    expect(one.magicFindPct).toBe(0);
    const both = towerGear(data, { helm, shield }, 'paladin');
    expect(both.magicFindPct).toBe(20);
    expect(both.goldFindPct).toBe(50);
    expect(both.plusSkills).toBe(1);
    expect(both.defense).toBe(10 + 15 + 5 + 12);
    expect(both.blockPct).toBe(20);
  });
});
