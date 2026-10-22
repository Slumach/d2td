import { describe, expect, it } from 'vitest';

import { activeSkill } from '../auras.ts';
import { effectiveResist } from '../combat.ts';
import { step } from '../sim.ts';
import type { Tower } from '../state.ts';
import { addMonster, freeze, placeTower, testSim, ticks } from '../testkit.ts';
import { canWear, type Item, type StatRoll } from './item.ts';
import { OPEN_WOUNDS_TICKS, openWoundsDamage } from './tower.ts';

const BESIDE = 3000;
let uid = 0;
const item = (code: string, stats: StatRoll[], ilvl = 30): Item => ({ uid: `s${uid++}`, code, quality: 'magic', ilvl, sockets: 0, socketed: [], stats });
const wear = (tower: Tower, gear: Tower['gear']) => {
  tower.gear = gear;
};

describe('the item stats that act on monsters', () => {
  it("cuts resistance with the items' -% to enemy resistance, at full value, once the monster is not immune", () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    wear(tower, { ring1: item('rin', [{ stat: 'passive_pois_pierce', value: 600 }, { stat: 'passive_fire_pierce', value: 80 }, { stat: 'passive_mag_pierce', value: 30 }]) });
    const andariel = addMonster(sim, 'andariel', 0);
    const rogue = addMonster(sim, 'corruptrogue1', 0);
    // Nobody acting: the items do nothing
    expect(effectiveResist(sim, andariel, 'pois')).toBe(100);
    sim.actorTower = tower.id;
    // Poison 100 is an immunity, and no amount of item pierce breaks one
    expect(effectiveResist(sim, andariel, 'pois')).toBe(100);
    // Fire -50 can only fall to -100
    expect(effectiveResist(sim, andariel, 'fire')).toBe(-100);
    // The rogue's 20 magic resistance takes the whole cut
    expect(effectiveResist(sim, rogue, 'mag')).toBe(-10);
    // Conviction breaks it at a fifth (50 takes 10 off), and then the items count in full
    sim.fx = { towers: {}, emitters: [], monsters: { [andariel.id]: { slowPct: 0, resistDown: { pois: 50 }, damageDownPct: 0 } } };
    expect(effectiveResist(sim, andariel, 'pois')).toBe(-100);
    wear(tower, { ring1: item('rin', [{ stat: 'passive_pois_pierce', value: 30 }]) });
    expect(effectiveResist(sim, andariel, 'pois')).toBe(60);
    // Too little Conviction leaves it immune, items or not
    sim.fx.monsters[andariel.id]!.resistDown = { pois: 4 };
    expect(effectiveResist(sim, andariel, 'pois')).toBe(100);
  });

  it("projects an item's aura at the item's level, on towers and on monsters", () => {
    const sim = testSim();
    const wearer = placeTower(sim, 6, 5, 'holy-bolt');
    const neighbour = placeTower(sim, 7, 5, 'holy-bolt');
    wear(wearer, { amulet: item('amu', [{ stat: 'item_aura', param: 'Fanaticism', value: 9 }]), ring1: item('rin', [{ stat: 'item_aura', param: 'Conviction', value: 12 }]) });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    step(sim, []);
    const fanaticism = sim.data.skills[sim.data.itemSkill('Fanaticism', 9)!]!;
    if (fanaticism.archetype !== 'buffAura') throw new Error('Fanaticism should be a buff aura');
    expect(fanaticism.skillLevels).toEqual([9, 9, 9, 9, 9]);
    expect(sim.fx.towers[neighbour.id]?.damagePct).toBe(fanaticism.levels[0]!.damagePct);
    expect(fanaticism.levels[0]!.damagePct).toBeGreaterThan(0);
    const conviction = sim.data.skills[sim.data.itemSkill('Conviction', 12)!]!;
    if (conviction.archetype !== 'debuff') throw new Error('Conviction should be a debuff');
    expect(sim.fx.monsters[m.id]?.resistDown.fire).toBe(conviction.levels[0]!.resistDown.fire);
    // A skill no tower casts does nothing
    expect(sim.data.itemSkill('Holy Shock', 15)).toBeUndefined();
  });

  it("casts an item's skill on striking, at the item's level, with no tower bonuses", () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    wear(tower, { weapon: item('tsw', [{ stat: 'item_skillonhit', param: 'Holy Bolt', value: 100, level: 5 }, { stat: 'item_allskills', value: 3 }]) });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000 });
    freeze(m);
    step(sim, []);
    const bolts = sim.state.missiles.filter((ms) => ms.skill === 'holy-bolt+4#item');
    expect(bolts.length).toBe(1);
    expect(bolts[0]!.damagePct).toBe(0);
    expect(sim.data.skills['holy-bolt+4#item']!.skillLevels).toEqual([5, 5, 5, 5, 5]);
  });

  it("bleeds a struck monster with open wounds for eight seconds at the item's level", () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    wear(tower, { gloves: item('thl', [{ stat: 'item_openwounds', value: 100 }], 40) });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 100_000_000 });
    freeze(m);
    step(sim, []);
    expect(m.bleedTicks).toBe(OPEN_WOUNDS_TICKS);
    expect(m.bleedPerTick).toBe(Math.ceil(openWoundsDamage(40) / OPEN_WOUNDS_TICKS));
    // D2's numbers: 27 x 40 - 374 per frame over 200 frames
    expect(openWoundsDamage(40)).toBe((27 * 40 - 374) * 200);
    expect(openWoundsDamage(99)).toBe((45 * 99 - 1319) * 200);
    // The bleed bypasses physical resistance: a physical immune still loses it
    sim.data.rules.mods.stoneSkin.resist[0]!.add = { phys: 100 };
    const immune = addMonster(sim, 'zombie1', BESIDE, { hp: 100_000_000, mods: ['stoneSkin'] });
    freeze(immune);
    m.hp = 0;
    ticks(sim, 2);
    // The tower cannot hurt it, so there is no hit to bleed from
    expect(immune.bleedTicks).toBe(0);
    const before = m.bleedPerTick;
    expect(before).toBeGreaterThan(0);
  });

  it("lets a bolt fly on through what it hit with the items' pierce", () => {
    const flewOn = (pierce: number) => {
      const sim = testSim();
      const tower = placeTower(sim, 6, 5, 'holy-bolt');
      if (pierce > 0) wear(tower, { ring1: item('rin', [{ stat: 'item_pierce', value: pierce }]) });
      const m = addMonster(sim, 'zombie1', BESIDE, { hp: 100_000_000 });
      freeze(m);
      let pierced = false;
      for (let i = 0; i < 40 && !pierced; i++) {
        step(sim, []);
        pierced = sim.state.missiles.some((ms) => ms.targetId === 0 && ms.hits.includes(m.id));
      }
      return pierced;
    };
    expect(flewOn(100)).toBe(true);
    expect(flewOn(0)).toBe(false);
  });

  it('cuts crushing blow by physical resistance and adds +% damage to undead to the hit', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    wear(tower, { gloves: item('thl', [{ stat: 'item_crushingblow', value: 100 }]) });
    // Stone Skin on Normal: 50% physical resistance, so crushing blow takes an eighth
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000, mods: ['stoneSkin'] });
    freeze(m);
    step(sim, []);
    expect(m.hp).toBeLessThanOrEqual(875_000);
    expect(m.hp).toBeGreaterThan(800_000);

    const lost = (stats: StatRoll[]) => {
      const s2 = testSim();
      const t = placeTower(s2, 6, 4, 'sacrifice');
      wear(t, { ring1: item('rin', stats) });
      const z = addMonster(s2, 'zombie1', BESIDE, { hp: 1_000_000 });
      freeze(z);
      step(s2, []);
      return 1_000_000 - z.hp;
    };
    // +100% to undead adds to the hit's enhanced damage: one more weapon roll, the same again at +200%
    const sacrifice = sim.data.skills['sacrifice']!;
    if (sacrifice.archetype !== 'melee') throw new Error('sacrifice should be melee');
    const plain = lost([]);
    const once = lost([{ stat: 'item_undeaddamage_percent', value: 100 }]);
    const twice = lost([{ stat: 'item_undeaddamage_percent', value: 200 }]);
    expect(once - plain).toBeGreaterThanOrEqual(sacrifice.weapon.min);
    expect(once - plain).toBeLessThanOrEqual(sacrifice.weapon.max);
    expect(twice - once).toBe(once - plain);
    // Zombies are not demons
    expect(lost([{ stat: 'item_demondamage_percent', value: 100 }])).toBe(plain);
  });

  it('leaves no corpse when the killer wears Slain Monsters Rest in Peace', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    wear(tower, { ring1: item('rin', [{ stat: 'item_restinpeace', value: 1 }]) });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 256 });
    freeze(m);
    ticks(sim, 5);
    expect(m.hp).toBeLessThanOrEqual(0);
    expect(sim.state.kills).toBe(1);
    expect(sim.state.corpses).toEqual([]);
  });

  it('raises a skill by +skill tab only when the skill sits on that tab', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 5, 'holy-bolt');
    // Tab 9 is the Paladin's combat skills (Holy Bolt), 10 his offensive auras (Might), 3 the Sorceress' fire skills
    wear(tower, { amulet: item('amu', [{ stat: 'item_addskill_tab', param: '9', value: 2 }]) });
    expect(activeSkill(sim, tower)!.skill.id).toBe('holy-bolt+2');
    wear(tower, { amulet: item('amu', [{ stat: 'item_addskill_tab', param: '10', value: 2 }, { stat: 'item_addskill_tab', param: '3', value: 2 }]) });
    expect(activeSkill(sim, tower)!.skill.id).toBe('holy-bolt');
    const aura = placeTower(sim, 7, 5, 'might');
    wear(aura, { amulet: item('amu', [{ stat: 'item_addskill_tab', param: '10', value: 3 }]) });
    expect(activeSkill(sim, aura)!.skill.id).toBe('might+3');
  });

  it('refuses missile weapons on every tower: nothing here shoots a bow', () => {
    const sim = testSim();
    expect(canWear(sim.data.items, item('tbw', []), 'weapon', 'paladin', {})).toBe(false);
    expect(canWear(sim.data.items, item('tsw', []), 'weapon', 'paladin', {})).toBe(true);
  });

  it("adds the facets' +% to elemental skill damage to spells of that element", () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 5, 'holy-bolt');
    wear(tower, { ring1: item('rin', [{ stat: 'passive_mag_mastery', value: 25 }, { stat: 'passive_fire_mastery', value: 25 }]) });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 100_000_000 });
    freeze(m);
    step(sim, []);
    expect(sim.state.missiles[0]?.damagePct).toBe(25);
  });
});
