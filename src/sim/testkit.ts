// Test helpers: put towers and monsters straight into a sim, bypassing commands and gold,
// so a test can set up one exact situation. Real play only ever goes through commands.

import { DESIGN } from '../data/design.ts';
import { FIXTURE_TABLES, fixtureGameData } from './fixture.ts';
import { monsterDef, type GameData, type MonsterDef } from './data.ts';
import { tileCenter } from './map.ts';
import { createMonster } from './monsters.ts';
import { createSim, step } from './sim.ts';
import type { Command, Monster, MonsterMod, Rank, Sim, Tower } from './state.ts';

const DIFFICULTY_IDS = ['normal', 'nightmare', 'hell'];

/**
 * A monster's entry, built from the fixture tables on first use when the schedule does not
 * use it: `brute1`, `brute1@hell`, `zombie2@hell:80`.
 */
export function monsterIn(data: GameData, id: string): MonsterDef {
  const [base, rest] = id.split('@') as [string, string | undefined];
  const [diff, level] = (rest ?? 'normal').split(':') as [string, string | undefined];
  return (data.monsters[id] ??= monsterDef(FIXTURE_TABLES, DESIGN.monsters, base, DESIGN.balance.auraRangePerTile, Math.max(0, DIFFICULTY_IDS.indexOf(diff)), level === undefined ? undefined : Number(level)));
}

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

/** A monster at a ring distance, counted in wave 0 (or `wave`). */
export function addMonster(
  sim: Sim,
  def: string,
  dist: number,
  opts: { rank?: Rank; mods?: MonsterMod[]; hp?: number; wave?: number } = {},
): Monster {
  const s = sim.state;
  const wave = opts.wave ?? 0;
  while (s.waves.length <= wave) s.waves.push({ remaining: 0 });
  monsterIn(sim.data, def);
  const m = createMonster(sim, def, wave, opts.rank ?? 'normal', opts.mods ?? [], dist, opts.hp);
  s.monsters.push(m);
  s.waves[wave]!.remaining++;
  return m;
}

export function ticks(sim: Sim, n: number, commands: Command[] = []): void {
  for (let i = 0; i < n; i++) step(sim, i === 0 ? commands : []);
}

/** Stops monsters walking so a test can hold them in one spot. */
export function freeze(m: Monster): void {
  m.stunTicks = 1_000_000;
}
