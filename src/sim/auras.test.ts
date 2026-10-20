import { describe, expect, it } from 'vitest';

import type { BuffAuraDef, ControlDef, DebuffDef } from './archetypes/types.ts';
import { auraSources, computeAuras } from './auras.ts';
import { effectiveResist } from './combat.ts';
import { EVOLVED_LEVEL_INDEX } from './data.ts';
import { speedOf } from './monsters.ts';
import { attackInterval } from './sim.ts';
import { addMonster, freeze, placeTower, testSim } from './testkit.ts';

function skill<T>(sim: ReturnType<typeof testSim>, id: string): T {
  return sim.data.skills[id] as T;
}

describe('aura stacking', () => {
  it('counts the same aura from two towers once, strongest only', () => {
    const sim = testSim();
    const target = placeTower(sim, 5, 5, 'holy-bolt');
    placeTower(sim, 4, 5, 'might', { level: 1 });
    placeTower(sim, 6, 5, 'might', { level: 4 });
    const might = skill<BuffAuraDef>(sim, 'might');
    const fx = computeAuras(sim);
    expect(fx.towers[target.id]!.damagePct).toBe(might.levels[3]!.damagePct);
  });

  it('adds different auras together', () => {
    const sim = testSim();
    const target = placeTower(sim, 5, 5, 'holy-bolt');
    placeTower(sim, 4, 5, 'might', { level: 2 });
    placeTower(sim, 6, 5, 'concentration', { tier: 2, level: 3 });
    const fx = computeAuras(sim);
    const expected =
      skill<BuffAuraDef>(sim, 'might').levels[1]!.damagePct + skill<BuffAuraDef>(sim, 'concentration').levels[2]!.damagePct;
    expect(fx.towers[target.id]!.damagePct).toBe(expected);
  });

  it('only reaches towers inside the radius', () => {
    const sim = testSim();
    const aura = placeTower(sim, 4, 5, 'might', { level: 1 });
    const far = placeTower(sim, 28, 15, 'holy-bolt');
    const fx = computeAuras(sim);
    expect(fx.towers[far.id]).toBeUndefined();
    // An aura tower is inside its own radius
    expect(fx.towers[aura.id]!.damagePct).toBeGreaterThan(0);
  });

  it('turns Fanaticism attack speed into a shorter attack interval', () => {
    const sim = testSim();
    const zealot = placeTower(sim, 5, 4, 'sacrifice');
    placeTower(sim, 5, 5, 'fanaticism', { tier: 3, level: 5 });
    sim.fx = computeAuras(sim);
    const buff = sim.fx.towers[zealot.id]!;
    const sacrifice = sim.data.skills['sacrifice']!;
    expect(buff.attackSpeedPct).toBeGreaterThan(0);
    expect(attackInterval(sim, zealot, sacrifice, buff)).toBeLessThan(sacrifice.rateTicks);
  });

  it('Holy Freeze slows monsters in its radius; two of them do not stack', () => {
    const sim = testSim();
    const m = addMonster(sim, 'zombie1', 3000);
    freeze(m);
    const base = speedOf(sim, m);
    placeTower(sim, 2, 4, 'holy-freeze', { tier: 2, level: 5 });
    placeTower(sim, 3, 4, 'holy-freeze', { tier: 2, level: 2 });
    sim.fx = computeAuras(sim);
    const slow = skill<ControlDef>(sim, 'holy-freeze').levels[4]!.slowPct;
    expect(sim.fx.monsters[m.id]!.slowPct).toBe(slow);
    expect(speedOf(sim, m)).toBe(Math.trunc((base * (100 - slow)) / 100));
  });

  it('Conviction lowers fire, cold and lightning resistance of monsters in radius', () => {
    const sim = testSim();
    const near = addMonster(sim, 'fallenshaman1', 3000);
    const far = addMonster(sim, 'fallenshaman1', 40_000);
    placeTower(sim, 2, 4, 'conviction', { tier: 3, level: 1 });
    sim.fx = computeAuras(sim);
    const down = skill<DebuffDef>(sim, 'conviction').levels[0]!.resistDown.fire!;
    expect(effectiveResist(sim, near, 'fire')).toBe(Math.max(-100, 20 - down));
    expect(effectiveResist(sim, far, 'fire')).toBe(20);
    expect(effectiveResist(sim, near, 'mag')).toBe(0);
  });

  it('projects an evolved tower partner aura at half radius', () => {
    const sim = testSim();
    const tower = placeTower(sim, 5, 5, 'blessed-hammer', { tier: 2 });
    tower.evolved = 'hammerdin';
    tower.tier = 4;
    tower.partnerSkill = 'concentration';
    tower.partnerLevel = EVOLVED_LEVEL_INDEX;
    const sources = auraSources(sim, tower);
    const full = skill<BuffAuraDef>(sim, 'concentration').levels[EVOLVED_LEVEL_INDEX]!.radiusUnits;
    expect(sources).toHaveLength(1);
    expect(sources[0]!.aura.radiusUnits).toBe(Math.trunc(full / 2));
    // The evolved tower buffs itself with the built-in aura
    expect(computeAuras(sim).towers[tower.id]!.damagePct).toBeGreaterThan(0);
  });
});
