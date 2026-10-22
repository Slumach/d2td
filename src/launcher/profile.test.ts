import { describe, expect, it } from 'vitest';

import { FIXTURE_TABLES } from '../sim/fixture.ts';
import { buildItemData } from '../sim/items/data.ts';
import type { Item } from '../sim/items/item.ts';
import { emptyProfile, parseProfile, settle, stashItem, STASH_H, STASH_W } from './profile.ts';

const data = buildItemData(FIXTURE_TABLES);
let n = 0;
const item = (code: string): Item => ({ uid: `u${n++}`, code, quality: 'normal', ilvl: 10, sockets: 0, socketed: [], stats: [] });

describe('the profile', () => {
  it('reads back only well-formed items of known bases', () => {
    const json = JSON.stringify({
      inventory: [{ item: item('tsw'), x: 0, y: 0 }, { item: { ...item('nope') }, x: 2, y: 0 }, { item: { uid: 'x' }, x: 3, y: 0 }],
      stash: [[{ item: item('r01'), x: 1, y: 1 }]],
      inPlay: [item('thl'), 'junk'],
      bestWave: 12,
    });
    const p = parseProfile(json, data);
    expect(p.inventory.map((i) => i.item.code)).toEqual(['tsw']);
    expect(p.stash[0]!.map((i) => i.item.code)).toEqual(['r01']);
    expect(p.inPlay.map((i) => i.code)).toEqual(['thl']);
    expect(p.bestWave).toBe(12);
    expect(parseProfile('not json', data)).toEqual(emptyProfile());
  });

  it('brings items in play home: the inventory first, then the stash', () => {
    const p = emptyProfile();
    // Ten swords (1 x 3) fill the inventory's ten columns
    for (let x = 0; x < 10; x++) p.inventory.push({ item: item('tsw'), x, y: 0 });
    p.inPlay = [item('r01'), item('thl')];
    settle(data, p);
    expect(p.inPlay).toEqual([]);
    expect(p.inventory.map((i) => i.item.code)).toContain('r01');
    expect(p.stash[0]!.map((i) => i.item.code)).toEqual(['thl']);
  });

  it('adds a stash page when every page is full', () => {
    const p = emptyProfile();
    for (let k = 0; k < STASH_W * STASH_H; k++) stashItem(data, p, item('r01'));
    expect(p.stash).toHaveLength(1);
    stashItem(data, p, item('r02'));
    expect(p.stash).toHaveLength(2);
    expect(p.stash[1]![0]!.item.code).toBe('r02');
  });
});
