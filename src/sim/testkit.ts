// Test helpers: put towers and monsters straight into a sim, bypassing commands and gold,
// so a test can set up one exact situation. Real play only ever goes through commands.

import { fixtureGameData } from './fixture.ts';
import type { GameData } from './data.ts';
import { tileCenter } from './map.ts';
import { createMonster } from './monsters.ts';
import { createSim, step } from './sim.ts';
import type { Command, Monster, MonsterMod, Rank, Sim, Tower } from './state.ts';

export function testSim(data: GameData = fixtureGameData(), seed = 1): Sim {
  return createSim(data, seed);
}

/** A tower on a tile with `skill` as its current skill at a tier and level. */
export function placeTower(sim: Sim, x: number, y: number, skill: string, opts: { tier?: number; level?: number } = {}): Tower {
  const s = sim.state;
  const tier = opts.tier ?? 1;
  const cls = Object.values(sim.data.classes).find((c) => Object.values(c.lines).some((l) => l.tiers.flat().includes(skill)));
  const lineEntry = cls && Object.entries(cls.lines).find(([, l]) => l.tiers.flat().includes(skill));
  // Fill earlier tiers with the line's first option so picks lines up with the tier
  const picks = lineEntry ? lineEntry[1].tiers.slice(0, tier - 1).map((options) => options[0]!) : [];
  picks[tier - 1] = skill;
  const center = tileCenter({ x, y });
  const tower: Tower = {
    id: s.nextId++,
    owner: 0,
    cls: cls?.id ?? 'paladin',
    tileX: x,
    tileY: y,
    x: center.x,
    y: center.y,
    line: lineEntry?.[0] ?? 'test',
    tier,
    level: opts.level ?? 1,
    picks,
    spent: 0,
    cooldown: 0,
    targeting: 'first',
    evolved: '',
    partnerSkill: '',
    partnerLevel: 0,
    summonCooldown: 0,
    partnerCooldown: 0,
  };
  s.towers.push(tower);
  return tower;
}

/** A monster at a ring distance, counted in wave 0. */
export function addMonster(
  sim: Sim,
  def: string,
  dist: number,
  opts: { rank?: Rank; mods?: MonsterMod[]; hp?: number } = {},
): Monster {
  const s = sim.state;
  if (s.waves.length === 0) s.waves.push({ remaining: 0, bounty: s.gold.map(() => 0), early: false });
  const m = createMonster(sim, def, 0, opts.rank ?? 'normal', opts.mods ?? [], dist, opts.hp);
  s.monsters.push(m);
  s.waves[0]!.remaining++;
  return m;
}

export function ticks(sim: Sim, n: number, commands: Command[] = []): void {
  for (let i = 0; i < n; i++) step(sim, i === 0 ? commands : []);
}

/** Stops monsters walking so a test can hold them in one spot. */
export function freeze(m: Monster): void {
  m.stunTicks = 1_000_000;
}
