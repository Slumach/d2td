// Single-target DPS: one tower beside one frozen dummy with no resistances and HP to spare,
// in the sim itself (its auras, delays and swings all count), reach switched off so extra
// targets cannot help. For a skill: its T3 tower at level 5, the evolution it makes (T4,
// at level 5), and its class's legend (T5, the three evolutions acting together).
//
//   npm run single

import { DESIGN } from '../src/data/design.ts';
import { buildGameData, MAX_TOWER_LEVEL, type GameData } from '../src/sim/data.ts';
import { isPathTile, nearestPathDist, tileCenter } from '../src/sim/map.ts';
import { canBuild, createSim, step, towerAt } from '../src/sim/sim.ts';
import type { Sim, Tower } from '../src/sim/state.ts';
import { addMonster, freeze } from '../src/sim/testkit.ts';
import { TICKS_PER_SECOND } from '../src/sim/fixed.ts';
import { raise } from './legends.ts';
import { loadTables } from './lib/load-tables.ts';

const DUMMY = 'single-target-dummy';
const WARMUP_TICKS = 100;
const MEASURE_TICKS = 600;

/** The game data with a dummy monster (no resistances, a billion HP) and every reach step off. */
export function dummyData(): GameData {
  const data = buildGameData(loadTables(), DESIGN);
  const base = data.monsters['zombie1']!;
  data.monsters[DUMMY] = { ...base, id: DUMMY, minHp: 1e12, maxHp: 1e12, resist: { phys: 0, fire: 0, cold: 0, ltng: 0, pois: 0, mag: 0 }, defense: 0 };
  data.economy.evolutionReach = { levels: 0, perLevel: 0 };
  data.economy.legend = { ...data.economy.legend, reachLevels: 0 };
  return data;
}

/** Free tiles beside the path: the first is the measured tower's, the rest for its partners. */
function spots(sim: Sim, n: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const m = sim.map;
  for (let y = 0; y < m.height && out.length < 1; y++) {
    for (let x = 0; x < m.width && out.length < 1; x++) {
      if (!canBuild(sim, x, y)) continue;
      const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isPathTile(m, x + dx!, y + dy!));
      if (beside) out.push({ x, y });
    }
  }
  for (let y = 0; y < m.height && out.length < n; y++) for (let x = 0; x < m.width && out.length < n; x++) if (canBuild(sim, x, y) && !out.some((p) => p.x === x && p.y === y)) out.push({ x, y });
  return out;
}

/** Damage per second, in HP, that the towers standing deal to a dummy on the path beside the first spot. */
function measure(sim: Sim, at: { x: number; y: number }): number {
  sim.state.gold[0] = 0;
  const m = addMonster(sim, DUMMY, nearestPathDist(sim.map, tileCenter(at)), { hp: 1e12 });
  freeze(m);
  for (let i = 0; i < WARMUP_TICKS; i++) step(sim, []);
  const before = m.hp;
  for (let i = 0; i < MEASURE_TICKS; i++) step(sim, []);
  return Math.round(((before - m.hp) / 256) / (MEASURE_TICKS / TICKS_PER_SECOND));
}

function fresh(data: GameData): Sim {
  const sim = createSim(data, 1);
  sim.state.gold[0] = 1e12;
  return sim;
}

export interface SingleTarget {
  skill: string;
  t3: number;
  t4?: { name: string; dps: number };
  t5?: { name: string; dps: number };
}

/** One skill's tower, its evolution and its class's legend, each against the dummy. */
export function singleTarget(data: GameData, skill: string): SingleTarget {
  const out: SingleTarget = { skill: data.skills[skill]!.name, t3: 0 };
  {
    const sim = fresh(data);
    const [at] = spots(sim, 1);
    const t = raise(sim, at!.x, at!.y, skill, 1);
    while (t && t.level < MAX_TOWER_LEVEL) step(sim, [{ type: 'upgrade', towerId: t.id }]);
    out.t3 = measure(sim, at!);
  }
  const recipe = data.evolutions.find((r) => r.attack.skill === skill);
  if (!recipe) return out;
  const evolveAt = (sim: Sim, r: typeof recipe, a: { x: number; y: number }, p: { x: number; y: number }): Tower | undefined => {
    const attack = raise(sim, a.x, a.y, r.attack.skill, r.attack.minTier);
    const partner = raise(sim, p.x, p.y, r.partner.skill, r.partner.minTier);
    if (!attack || !partner) return undefined;
    step(sim, [{ type: 'evolve', towerA: attack.id, towerB: partner.id }]);
    const e = towerAt(sim, a.x, a.y);
    return e?.evolved === r.id ? e : undefined;
  };
  {
    const sim = fresh(data);
    const [a, p] = spots(sim, 2);
    if (evolveAt(sim, recipe, a!, p!)) out.t4 = { name: recipe.name, dps: measure(sim, a!) };
  }
  // The legend: this evolution and two more of its class, anywhere on the ring, on this tile
  const cls = Object.values(data.classes).find((c) => Object.values(c.lines).some((l) => l.tiers.flat().includes(skill)))!;
  const legend = data.legends.find((l) => l.cls === cls.id);
  const ofClass = new Set(Object.values(cls.lines).flatMap((l) => l.tiers.flat()));
  const three = [recipe, ...data.evolutions.filter((r) => r !== recipe && ofClass.has(r.attack.skill))].slice(0, 3);
  if (legend && three.length === 3) {
    const sim = fresh(data);
    const s = spots(sim, 6);
    const evolved = three.map((r, i) => evolveAt(sim, r, s[i * 2]!, s[i * 2 + 1]!));
    if (evolved.every(Boolean)) {
      const [x, y, z] = evolved as [Tower, Tower, Tower];
      step(sim, [{ type: 'ascend', towerA: x.id, towerB: y.id, towerC: z.id }]);
      if (x.legend) out.t5 = { name: legend.name, dps: measure(sim, s[0]!) };
    }
  }
  return out;
}

function main(): void {
  const data = dummyData();
  const skills = process.argv.slice(2).length ? process.argv.slice(2) : ['zeal', 'chain-lightning', 'blizzard', 'bone-spear', 'bone-spirit'];
  console.log('Single-target DPS (one frozen dummy, no resistances, reach off; towers at level 5)');
  console.log('  skill                 T3 (level 5)    T4 (evolved)                     x T3    T5 (legend)                      x T3');
  for (const id of skills) {
    const r = singleTarget(data, id);
    const ratio = (v?: number) => (v && r.t3 > 0 ? `${(v / r.t3).toFixed(2)}x` : '-');
    const col = (v?: { name: string; dps: number }) => (v ? `${v.name} ${v.dps.toLocaleString('en-US')}` : 'none');
    console.log(`  ${r.skill.padEnd(20)} ${r.t3.toLocaleString('en-US').padStart(12)}    ${col(r.t4).padEnd(30)} ${ratio(r.t4?.dps).padStart(6)}    ${col(r.t5).padEnd(30)} ${ratio(r.t5?.dps).padStart(6)}`);
  }
}

if (process.argv[1]?.endsWith('singletarget.ts')) main();
