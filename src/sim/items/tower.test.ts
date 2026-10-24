import { describe, expect, it } from 'vitest';

import { activeSkill } from '../auras.ts';
import { CRUSHING_BLOW_CAP } from '../combat.ts';
import { baseSkillId } from '../data.ts';
import { attackInterval, step } from '../sim.ts';
import type { Tower } from '../state.ts';
import { addMonster, freeze, placeTower, testSim, ticks } from '../testkit.ts';
import type { Item, StatRoll } from './item.ts';
import { gearOf, withGear } from './tower.ts';

const BESIDE = 3000;
let uid = 0;
const item = (code: string, stats: StatRoll[] = [], extra: Partial<Item> = {}): Item => ({
  uid: `t${uid++}`,
  code,
  quality: 'magic',
  ilvl: 30,
  sockets: 0,
  socketed: [],
  stats,
  ...extra,
});
const wear = (tower: Tower, gear: Tower['gear']) => {
  tower.gear = gear;
};

describe('gear on towers', () => {
  it('raises the tower skill by +all skills and +class skills, keeping its id for art and curses', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 5, 'holy-bolt', { level: 2 });
    const plain = activeSkill(sim, tower)!.skill;
    wear(tower, { amulet: item('amu', [{ stat: 'item_allskills', value: 1 }]), ring1: item('rin', [{ stat: 'item_addclassskills', param: '3', value: 2 }]) });
    const raised = activeSkill(sim, tower)!.skill;
    expect(raised.id).toBe('holy-bolt+3');
    expect(baseSkillId(raised.id)).toBe('holy-bolt');
    expect(raised.skillLevels).toEqual(plain.skillLevels.map((l) => l + 3));
    // A Sorceress ring does nothing for a Paladin
    wear(tower, { ring1: item('rin', [{ stat: 'item_addclassskills', param: '1', value: 2 }]) });
    expect(activeSkill(sim, tower)!.skill).toBe(plain);
  });

  it('raises a laddered tier skill from its own ladder', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'zeal', { tier: 2 });
    const plain = activeSkill(sim, tower)!.skill;
    wear(tower, { helm: item('thl', [{ stat: 'item_allskills', value: 2 }]) });
    expect(activeSkill(sim, tower)!.skill.skillLevels).toEqual(plain.skillLevels.map((l) => l + 2));
  });

  it('swings the worn weapon on a melee tower, its enhanced damage on top', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    wear(tower, { weapon: item('tsw', [{ stat: 'item_maxdamage_percent', value: 50 }, { stat: 'item_mindamage_percent', value: 50 }]) });
    const skill = activeSkill(sim, tower)!.skill;
    if (skill.archetype !== 'melee') throw new Error('sacrifice should be melee');
    expect(skill.weapon).toEqual({ min: 2 * 256, max: 8 * 256 });
    expect(withGear({ damagePct: 0, attackSpeedPct: 0, fireMin: 0, fireMax: 0 }, gearOf(sim, tower), skill).damagePct).toBe(50);
  });

  it('casts faster with faster cast rate, on D2 diminishing returns', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 5, 'holy-bolt');
    const skill = activeSkill(sim, tower)!.skill;
    const none = { damagePct: 0, attackSpeedPct: 0, fireMin: 0, fireMax: 0 };
    wear(tower, { amulet: item('amu', [{ stat: 'item_fastercastrate', value: 120 }]) });
    const buff = withGear(none, gearOf(sim, tower), skill);
    expect(buff.attackSpeedPct).toBe(60);
    expect(attackInterval(sim, tower, skill, 0, buff)).toBeLessThanOrEqual(attackInterval(sim, tower, skill, 0, none));
    // Enhanced damage does nothing for a spell
    wear(tower, { amulet: item('amu', [{ stat: 'item_maxdamage_percent', value: 200 }]) });
    expect(withGear(none, gearOf(sim, tower), skill).damagePct).toBe(0);
  });

  it('pays gold find on the killing tower', () => {
    const goldFrom = (gf: number) => {
      const sim = testSim();
      const tower = placeTower(sim, 6, 4, 'sacrifice');
      if (gf > 0) wear(tower, { ring1: item('rin', [{ stat: 'item_goldbonus', value: gf }]) });
      const m = addMonster(sim, 'zombie1', BESIDE, { hp: 256 });
      freeze(m);
      const before = sim.state.gold[0]!;
      ticks(sim, 5);
      expect(m.hp).toBeLessThanOrEqual(0);
      return sim.state.gold[0]! - before;
    };
    expect(goldFrom(100)).toBe(goldFrom(0) * 2);
  });

  it('crushes a quarter of a monster life with crushing blow', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    wear(tower, { gloves: item('thl', [{ stat: 'item_crushingblow', value: 100 }]) });
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 100_000 });
    freeze(m);
    step(sim, []);
    expect(m.hp).toBeLessThanOrEqual(75_000);
  });

  it("crushes an eighth of a champion's life, and never more than 25 times the hit", () => {
    const lost = (rank: 'normal' | 'champion', hp: number, crush: number) => {
      const sim = testSim();
      const tower = placeTower(sim, 6, 4, 'sacrifice');
      wear(tower, { gloves: item('thl', [{ stat: 'item_crushingblow', value: crush }]) });
      const m = addMonster(sim, 'zombie1', BESIDE, { hp, rank });
      freeze(m);
      step(sim, []);
      return hp - m.hp;
    };
    const hit = lost('normal', 100_000, 0);
    expect(lost('champion', 100_000, 100) - hit).toBe(12_500);
    // A life whose quarter is far past the cap: the blow is 25 times the hit
    expect(lost('normal', 1_000_000_000, 100)).toBeLessThanOrEqual(hit * (CRUSHING_BLOW_CAP + 1));
    expect(lost('normal', 1_000_000_000, 100)).toBeGreaterThan(hit * (CRUSHING_BLOW_CAP - 5));
  });

  it('adds elemental damage to a melee hit', () => {
    const sim = testSim();
    const tower = placeTower(sim, 6, 4, 'sacrifice');
    const m = addMonster(sim, 'zombie1', BESIDE, { hp: 1_000_000, mods: ['stoneSkin'] });
    freeze(m);
    sim.data.rules.mods.stoneSkin.resist[0]!.add = { phys: 100 };
    wear(tower, { ring1: item('rin', [{ stat: 'firemindam', value: 10 }, { stat: 'firemaxdam', value: 10 }]) });
    step(sim, []);
    expect(m.hp).toBe(1_000_000 - 10 * 256);
  });
});
