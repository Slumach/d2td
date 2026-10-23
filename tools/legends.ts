// T5 legends: for every class, three of its evolutions built from nothing through the game's
// own commands (build, levels, tiers, branches, evolve), placed so the three evolved towers
// stand beside each other, then ascended. Reports whether each legend is reachable that way
// and its damage per second against the three evolved towers it was made from.
//
//   npm run legends

import { DESIGN } from '../src/data/design.ts';
import { activeSkill } from '../src/sim/auras.ts';
import { MAX_TOWER_LEVEL, buildGameData, type GameData } from '../src/sim/data.ts';
import { isAura, standardDps } from '../src/sim/dps.ts';
import { geared } from '../src/sim/items/tower.ts';
import { canBuild, createSim, legendFor, step, towerAt } from '../src/sim/sim.ts';
import type { Command, Sim, Tower } from '../src/sim/state.ts';
import { TICKS_PER_SECOND } from '../src/sim/fixed.ts';
import { loadTables } from './lib/load-tables.ts';

/** Standard damage per second of a tower, in HP: its attack, and its partner's casts when they hit. */
export function towerDps(sim: Sim, t: Tower): number {
  const active = activeSkill(sim, t);
  if (!active) return 0;
  const recipe = sim.data.evolutions.find((r) => r.id === t.evolved);
  let base = standardDps(active.skill, active.lvl, recipe?.ignoreSkillDelay === true);
  if (t.partnerSkill) {
    const partner = geared(sim, t, sim.data.skills[t.partnerSkill]!);
    if (!isAura(partner)) base += standardDps(partner, t.partnerLevel);
  }
  return Math.round((base * TICKS_PER_SECOND) / 1000 / 256);
}

function run(sim: Sim, ...commands: Command[]): void {
  for (const c of commands) step(sim, [c]);
}

/** Builds a tower on a tile and climbs its line until it has `skill` at `minTier` or above. */
export function raise(sim: Sim, x: number, y: number, skill: string, minTier: number): Tower | undefined {
  for (const cls of Object.values(sim.data.classes)) {
    for (const line of Object.values(cls.lines)) {
      const at = line.tiers.findIndex((opts) => opts.includes(skill));
      if (at < 0) continue;
      run(sim, { type: 'build', x, y, cls: cls.id, skill: at === 0 ? skill : line.tiers[0]![0]! });
      const t = towerAt(sim, x, y);
      if (!t) return undefined;
      const target = Math.max(minTier, at + 1);
      while (t.tier < target) {
        while (t.level < MAX_TOWER_LEVEL) run(sim, { type: 'upgrade', towerId: t.id });
        run(sim, { type: 'upgradeTier', towerId: t.id });
        const opts = line.tiers[t.tier - 1]!;
        if (opts.length > 1) run(sim, { type: 'pickBranch', towerId: t.id, skill: opts.includes(skill) ? skill : opts[0]! });
      }
      return t;
    }
  }
  return undefined;
}

export interface LegendCheck {
  cls: string;
  legend: string;
  recipes: string[];
  reachable: boolean;
  why?: string;
  parentsDps: number;
  legendDps: number;
}

/** One class's legend, built the way a player would, on the first stretch of ring with room for it. */
export function checkLegend(data: GameData, cls: string): LegendCheck {
  const legend = data.legends.find((l) => l.cls === cls)!;
  const classSkills = new Set(Object.values(data.classes[cls]!.lines).flatMap((l) => l.tiers.flat()));
  const recipes = data.evolutions.filter((r) => classSkills.has(r.attack.skill)).slice(0, 3);
  const out: LegendCheck = { cls, legend: legend.name, recipes: recipes.map((r) => r.name), reachable: false, parentsDps: 0, legendDps: 0 };
  const sim = createSim(data, 1);
  sim.state.gold[0] = 1e12;
  // Attack towers on three tiles each beside the other two, each partner beside its attack
  const probe = createSim(data, 1);
  let spot: { x: number; y: number } | undefined;
  for (let y = 0; y < probe.map.height && !spot; y++) {
    for (let x = 0; x < probe.map.width && !spot; x++) {
      const tiles = [[x, y], [x + 1, y], [x, y + 1], [x - 1, y], [x + 2, y], [x, y + 2]];
      if (tiles.every(([tx, ty]) => canBuild(probe, tx!, ty!))) spot = { x, y };
    }
  }
  if (!spot) return { ...out, why: 'no room on the ring' };
  const { x, y } = spot;
  const attacks: [number, number][] = [[x, y], [x + 1, y], [x, y + 1]];
  const partners: [number, number][] = [[x - 1, y], [x + 2, y], [x, y + 2]];
  const evolved: Tower[] = [];
  for (const [i, r] of recipes.entries()) {
    const a = raise(sim, attacks[i]![0], attacks[i]![1], r.attack.skill, r.attack.minTier);
    const p = raise(sim, partners[i]![0], partners[i]![1], r.partner.skill, r.partner.minTier);
    if (!a || !p) return { ...out, why: `could not build ${r.name}'s towers` };
    run(sim, { type: 'evolve', towerA: a.id, towerB: p.id });
    const e = towerAt(sim, attacks[i]![0], attacks[i]![1]);
    if (!e || e.evolved !== r.id) return { ...out, why: `${r.name} did not evolve (got ${e?.evolved || 'nothing'})` };
    evolved.push(e);
  }
  const [a, b, c] = evolved as [Tower, Tower, Tower];
  if (!legendFor(sim, a, b, c)) return { ...out, why: 'the three do not make the legend' };
  const parentsDps = evolved.reduce((n, t) => n + towerDps(sim, t), 0);
  run(sim, { type: 'ascend', towerA: a.id, towerB: b.id, towerC: c.id });
  if (a.legend !== legend.id) return { ...out, parentsDps, why: 'ascend did nothing' };
  const legendDps = [a, b, c].reduce((n, t) => n + towerDps(sim, t), 0);
  return { ...out, reachable: true, parentsDps, legendDps };
}

function main(): void {
  const data = buildGameData(loadTables(), DESIGN);
  // The same legends with a legend's reach held to an evolution's: what is left is the damage
  // multiplier alone (legend.dpsPct). The full ratio adds the reach step, more swings and hits.
  const balance = structuredClone(DESIGN.balance);
  balance.legend.reachLevels = data.economy.evolutionReach.levels;
  const sameReach = buildGameData(loadTables(), { ...DESIGN, balance });
  const x = (a: number, b: number) => (b > 0 ? `${(a / b).toFixed(2)}x` : '(no dps)');
  console.log('T5 legends: three evolutions built through the commands, then ascended');
  console.log('  class        legend                from                                          reachable   parents dps   legend dps   ratio   damage alone');
  for (const cls of Object.keys(data.classes)) {
    const r = checkLegend(data, cls);
    const d = checkLegend(sameReach, cls);
    console.log(
      `  ${r.cls.padEnd(12)} ${r.legend.padEnd(21)} ${r.recipes.join(', ').padEnd(45)} ${(r.reachable ? 'yes' : `no: ${r.why}`).padEnd(11)} ${String(r.parentsDps).padStart(11)} ${String(r.legendDps).padStart(12)} ${x(r.legendDps, r.parentsDps).padStart(7)} ${x(d.legendDps, d.parentsDps).padStart(14)}`,
    );
  }
}

if (process.argv[1]?.endsWith('legends.ts')) main();
