import { describe, expect, it } from 'vitest';

import { validCommand } from '../../net/validate.ts';
import { createMatch, stepMatch } from '../match.ts';
import { step } from '../sim.ts';
import type { Command, Sim } from '../state.ts';
import { fixtureGameData } from '../fixture.ts';
import { placeTower, testSim } from '../testkit.ts';
import type { Item, StatRoll } from './item.ts';
import { sellPrice, vendorCap } from './price.ts';

let n = 0;
const item = (code: string, extra: Partial<Item> = {}, stats: StatRoll[] = []): Item => ({
  uid: `i${n++}`,
  code,
  quality: 'normal',
  ilvl: 30,
  sockets: 0,
  socketed: [],
  stats,
  ...extra,
});
const run = (sim: Sim, ...commands: Command[]) => step(sim, commands);
const inv = (sim: Sim, p = 0) => sim.state.inventories[p]!;
const codes = (sim: Sim, p = 0) => inv(sim, p).map((i) => i.item.code);

describe('inventory commands', () => {
  it('loads the profile inventory once, keeping only what fits', () => {
    const sim = testSim();
    const sword = item('tsw');
    run(sim, { type: 'loadInventory', items: [{ item: sword, x: 0, y: 0 }, { item: item('r01'), x: 0, y: 1 }, { item: item('r02'), x: 5, y: 0 }] });
    expect(codes(sim)).toEqual(['tsw', 'r02']);
    run(sim, { type: 'loadInventory', items: [{ item: item('r01'), x: 9, y: 3 }] });
    expect(codes(sim)).toEqual(['tsw', 'r02']);
  });

  it('moves items only to free cells inside the grid', () => {
    const sim = testSim();
    const sword = item('tsw');
    run(sim, { type: 'loadInventory', items: [{ item: sword, x: 0, y: 0 }, { item: item('r01'), x: 3, y: 0 }] });
    run(sim, { type: 'moveItem', uid: sword.uid, x: 3, y: 0 });
    expect(inv(sim)[0]).toMatchObject({ x: 0, y: 0 });
    run(sim, { type: 'moveItem', uid: sword.uid, x: 9, y: 2 });
    expect(inv(sim)[0]).toMatchObject({ x: 0, y: 0 });
    run(sim, { type: 'moveItem', uid: sword.uid, x: 9, y: 1 });
    expect(inv(sim)[0]).toMatchObject({ x: 9, y: 1 });
  });

  it('equips from the inventory or the stash, swapping the old item back, and only on own towers', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    const a = item('tsw');
    run(sim, { type: 'loadInventory', items: [{ item: a, x: 0, y: 0 }] });
    run(sim, { type: 'equip', towerId: tower.id, slot: 'weapon', item: a });
    expect(tower.gear?.weapon?.uid).toBe(a.uid);
    expect(inv(sim)).toEqual([]);
    const b = item('tsy');
    run(sim, { type: 'equip', towerId: tower.id, slot: 'weapon', item: b });
    expect(tower.gear?.weapon?.uid).toBe(b.uid);
    expect(codes(sim)).toEqual(['tsw']);
    // Another player's command does nothing
    run(sim, { type: 'unequip', towerId: tower.id, slot: 'weapon', player: 1 });
    expect(tower.gear?.weapon?.uid).toBe(b.uid);
    // A two-hander will not go on beside a shield, nor a shield beside it
    run(sim, { type: 'equip', towerId: tower.id, slot: 'shield', item: item('tsh') });
    run(sim, { type: 'equip', towerId: tower.id, slot: 'weapon', item: item('tst') });
    expect(tower.gear?.weapon?.code).toBe('tsy');
  });

  it('unequips into the inventory or out to the stash', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    run(sim, { type: 'equip', towerId: tower.id, slot: 'helm', item: item('thl') });
    run(sim, { type: 'unequip', towerId: tower.id, slot: 'helm', x: 4, y: 1 });
    expect(inv(sim)[0]).toMatchObject({ x: 4, y: 1 });
    expect(tower.gear?.helm).toBeUndefined();
    run(sim, { type: 'equip', towerId: tower.id, slot: 'helm', item: inv(sim)[0]!.item });
    run(sim, { type: 'unequip', towerId: tower.id, slot: 'helm', toStash: true });
    expect(inv(sim)).toEqual([]);
    expect(tower.gear?.helm).toBeUndefined();
  });

  it('sockets gems and makes runewords; sockets never unfill', () => {
    const sim = testSim();
    const sword = item('tsw', { sockets: 2 });
    const r1 = item('r01');
    const r2 = item('r02');
    run(sim, { type: 'loadInventory', items: [{ item: sword, x: 0, y: 0 }, { item: r1, x: 2, y: 0 }, { item: r2, x: 3, y: 0 }] });
    run(sim, { type: 'socket', target: { uid: sword.uid }, uid: r1.uid });
    run(sim, { type: 'socket', target: { uid: sword.uid }, uid: r2.uid });
    const made = inv(sim).find((i) => i.item.uid === sword.uid)!.item;
    expect(made.runeword).toBe('Runeword1');
    expect(made.socketed.map((s) => s.code)).toEqual(['r01', 'r02']);
    expect(codes(sim)).toEqual(['tsw']);
  });

  it("adds a socket with Smith's Hammer up to the item level's maximum, then refuses", () => {
    const sim = testSim();
    const helm = item('thl', { ilvl: 10 });
    const hammers = item('xsh', { quantity: 5 });
    run(sim, { type: 'loadInventory', items: [{ item: helm, x: 0, y: 0 }, { item: hammers, x: 3, y: 0 }] });
    for (let i = 0; i < 4; i++) run(sim, { type: 'hammer', target: { uid: helm.uid }, uid: hammers.uid });
    // The fixture helm type allows 2 sockets up to item level 25
    expect(inv(sim).find((i) => i.item.uid === helm.uid)!.item.sockets).toBe(2);
    expect(inv(sim).find((i) => i.item.code === 'xsh')!.item.quantity).toBe(3);
  });

  it('sells for a quarter of the D2 cost, capped by the stage', () => {
    const sim = testSim();
    const sword = item('tsw');
    run(sim, { type: 'loadInventory', items: [{ item: sword, x: 0, y: 0 }] });
    const gold = sim.state.gold[0]!;
    expect(sellPrice(sim, sword)).toBe(Math.min(vendorCap(sim), 25));
    run(sim, { type: 'sellItem', uid: sword.uid });
    expect(sim.state.gold[0]! - gold).toBe(25);
    expect(inv(sim)).toEqual([]);
    const unique = item('tsw', { quality: 'unique', unique: 'Test Blade' });
    expect(sellPrice(sim, unique)).toBe(vendorCap(sim));
  });
});

describe('selling a drop where it lies', () => {
  it('pays the owner the capped price and refuses other players', () => {
    const match = createMatch(fixtureGameData(3), 1, 'team', 2);
    const sim = match.zones[0]!;
    // A wave still out, so the drop is not collected as cleared
    while (sim.state.waves.length < 1) sim.state.waves.push({ remaining: 0 });
    sim.state.waves[0]!.remaining = 1;
    sim.state.drops.push({ id: 77, item: item('tsw'), owner: 0, wave: 0, x: 0, y: 0 });
    const gold = sim.state.gold[0]!;
    stepMatch(match, [{ player: 1, command: { type: 'sellDrop', dropId: 77 } }]);
    expect(sim.state.drops.length).toBe(1);
    stepMatch(match, [{ player: 0, command: { type: 'sellDrop', dropId: 77 } }]);
    expect(sim.state.drops).toEqual([]);
    expect(sim.state.gold[0]! - gold).toBe(25);
  });
});

describe('the loot filter', () => {
  it('collects only what the filter keeps when a wave clears; Everything keeps the whites too', () => {
    const sim = testSim();
    while (sim.state.waves.length < 1) sim.state.waves.push({ remaining: 0 });
    const white = item('tsw');
    const rune = item('r01');
    const socketed = item('thl', { sockets: 1 });
    sim.state.drops.push({ id: 1, item: white, owner: 0, wave: 0, x: 0, y: 0 }, { id: 2, item: rune, owner: 0, wave: 0, x: 0, y: 0 }, { id: 3, item: socketed, owner: 0, wave: 0, x: 0, y: 0 });
    run(sim);
    expect(codes(sim).sort()).toEqual(['r01', 'thl']);
    expect(sim.state.drops).toEqual([]);
    run(sim, { type: 'lootFilter', mode: 'all' });
    sim.state.drops.push({ id: 4, item: item('tsw'), owner: 0, wave: 0, x: 0, y: 0 });
    run(sim);
    expect(codes(sim).sort()).toEqual(['r01', 'thl', 'tsw']);
  });
});

describe('the belt', () => {
  it('holds gems, runes and jewels, sockets from its slots, and gives them back', () => {
    const sim = testSim();
    const sword = item('tsw', { sockets: 2 });
    const r1 = item('r01');
    const helm = item('thl');
    run(sim, { type: 'loadInventory', items: [{ item: sword, x: 0, y: 0 }, { item: r1, x: 2, y: 0 }, { item: helm, x: 3, y: 0 }] });
    run(sim, { type: 'toBelt', uid: helm.uid, slot: 0 });
    expect(sim.state.belts[0]![0]).toBeNull();
    run(sim, { type: 'toBelt', uid: r1.uid, slot: 2 });
    expect(sim.state.belts[0]![2]?.uid).toBe(r1.uid);
    expect(codes(sim)).toEqual(['tsw', 'thl']);
    run(sim, { type: 'socket', target: { uid: sword.uid }, uid: r1.uid });
    expect(sim.state.belts[0]![2]).toBeNull();
    expect(inv(sim)[0]!.item.socketed.map((s) => s.code)).toEqual(['r01']);
    const r2 = item('r02');
    run(sim, { type: 'loadInventory', items: [] });
    sim.state.belts[0]![1] = r2;
    run(sim, { type: 'fromBelt', slot: 1, x: 9, y: 3 });
    expect(sim.state.belts[0]![1]).toBeNull();
    expect(inv(sim).find((i) => i.item.uid === r2.uid)).toMatchObject({ x: 9, y: 3 });
  });
});

describe('trading', () => {
  it('swaps items and gold when both accept, and any change clears the accepts', () => {
    const match = createMatch(fixtureGameData(3), 1, 'team', 2);
    const sim = match.zones[0]!;
    const a = item('tsw');
    const b = item('r01');
    stepMatch(match, [
      { player: 0, command: { type: 'loadInventory', items: [{ item: a, x: 0, y: 0 }] } },
      { player: 1, command: { type: 'loadInventory', items: [{ item: b, x: 0, y: 0 }] } },
    ]);
    stepMatch(match, [{ player: 0, command: { type: 'tradeOpen', with: 1 } }]);
    stepMatch(match, [
      { player: 0, command: { type: 'tradeOffer', items: [a.uid], gold: 50 } },
      { player: 1, command: { type: 'tradeOffer', items: [b.uid], gold: 0 } },
    ]);
    stepMatch(match, [{ player: 0, command: { type: 'tradeAccept' } }]);
    stepMatch(match, [{ player: 1, command: { type: 'tradeOffer', items: [b.uid], gold: 10 } }]);
    expect(match.state.trades[0]!.sides.map((s) => s.accepted)).toEqual([false, false]);
    const gold = [...sim.state.gold];
    stepMatch(match, [{ player: 0, command: { type: 'tradeAccept' } }, { player: 1, command: { type: 'tradeAccept' } }]);
    expect(match.state.trades).toEqual([]);
    expect(codes(sim, 0)).toEqual(['r01']);
    expect(codes(sim, 1)).toEqual(['tsw']);
    expect(sim.state.gold[0]! - gold[0]!).toBe(-40);
    expect(sim.state.gold[1]! - gold[1]!).toBe(40);
  });

  it('moves items between rings in FFA', () => {
    const match = createMatch(fixtureGameData(3), 1, 'ffa', 2);
    const a = item('tsw');
    stepMatch(match, [{ player: 0, command: { type: 'loadInventory', items: [{ item: a, x: 0, y: 0 }] } }, { player: 0, command: { type: 'tradeOpen', with: 1 } }]);
    stepMatch(match, [{ player: 0, command: { type: 'tradeOffer', items: [a.uid], gold: 0 } }]);
    stepMatch(match, [{ player: 0, command: { type: 'tradeAccept' } }, { player: 1, command: { type: 'tradeAccept' } }]);
    expect(codes(match.zones[0]!)).toEqual([]);
    expect(codes(match.zones[1]!)).toEqual(['tsw']);
  });
});

describe('the relay', () => {
  it('passes item commands rebuilt and refuses malformed items', () => {
    const sword = item('tsw', { quality: 'rare', rareName: ['Grim', 'Bite'], prefixes: ['p0'] }, [{ stat: 'fireresist', value: -10 }]);
    expect(validCommand({ type: 'equip', towerId: 3, slot: 'weapon', item: { ...sword, junk: 1 } })).toEqual({ type: 'equip', towerId: 3, slot: 'weapon', item: sword });
    expect(validCommand({ type: 'equip', towerId: 3, slot: 'hand', item: sword })).toBeNull();
    expect(validCommand({ type: 'equip', towerId: 3, slot: 'weapon', item: { ...sword, quality: 'legendary' } })).toBeNull();
    expect(validCommand({ type: 'socket', target: { towerId: 1, slot: 'helm' }, uid: 'x' })).toEqual({ type: 'socket', target: { towerId: 1, slot: 'helm' }, uid: 'x' });
    expect(validCommand({ type: 'tradeOffer', items: ['a'], gold: -5 })).toBeNull();
  });
});
