// Wave timing report: for chosen waves, how many monsters, how they are spaced, and how
// long the wave lasts with no towers, from the first spawn to the last monster leaving the
// path. Uses the real tables. Balance-free: no tower ever fires.
//
//   npm run waves                 waves 1, 10, 20, 30
//   npm run waves -- 5 10 15

import { DESIGN } from '../src/data/design.ts';
import { buildGameData } from '../src/sim/data.ts';
import { TICKS_PER_SECOND, UNITS_PER_TILE } from '../src/sim/fixed.ts';
import { createSim, step } from '../src/sim/sim.ts';
import { loadTables } from './lib/load-tables.ts';

const data = buildGameData(loadTables(), DESIGN);
const picks = process.argv.slice(2).map(Number).filter((n) => n > 0);
const waves = picks.length > 0 ? picks : [1, 10, 20, 30];
const secs = (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(1);

const probe = createSim(data, 1);
console.log(`Path: ${(probe.map.length / UNITS_PER_TILE).toFixed(2)} tiles on a ${probe.map.width} x ${probe.map.height} grid`);
const speeds = [...new Set(data.waves.flatMap((w) => w.groups.map((g) => g.monster)))].map((id) => {
  const tilesPerSec = (data.monsters[id]!.speed * TICKS_PER_SECOND) / UNITS_PER_TILE;
  return `${id} ${tilesPerSec.toFixed(2)} t/s (${(probe.map.length / UNITS_PER_TILE / tilesPerSec).toFixed(0)} s to walk)`;
});
console.log(`Speeds: ${speeds.join(', ')}`);

for (const n of waves) {
  const def = data.waves[n - 1];
  if (!def) continue;
  const sim = createSim(data, 1);
  // Nothing is killed here, so the alive count would end the run: lift its limit
  (sim.data.rules as { aliveLimit: number }).aliveLimit = 1_000_000;
  // Jump straight to wave n with nothing on the map
  sim.state.wave = n - 1;
  for (let i = 0; i < n - 1; i++) sim.state.waves.push({ remaining: 0, bounty: [0], early: false });
  step(sim, [{ type: 'callWave' }]);
  const spawnTicks = sim.state.spawns.map((s) => s.tick);
  const first = Math.min(...spawnTicks);
  const lastSpawn = Math.max(...spawnTicks);
  let t = 0;
  while ((sim.state.monsters.length > 0 || sim.state.spawns.length > 0) && t < 20 * 60 * 20) {
    step(sim, []);
    t++;
  }
  const end = sim.state.tick;
  const count = spawnTicks.length;
  const tally = new Map<string, number>();
  for (const g of def.groups) {
    const key = `${g.monster}${g.rank === 'normal' ? '' : ` (${g.rank})`}`;
    tally.set(key, (tally.get(key) ?? 0) + g.count);
  }
  const normal = def.groups.filter((g) => g.rank === 'normal');
  const shape =
    def.kind === 'boss' ? (normal.length > 0 ? `a pack of ${normal[0]!.count}, then the boss` : 'the boss alone')
    : def.kind === 'swarm' ? `packs ${normal.map((g) => g.count).join('-')}`
    : `one every ${secs(normal[0]!.spacingTicks)} s`;
  const groups = `${[...tally].map(([k, c]) => `${c}x ${k}`).join(', ')}; ${shape}`;
  console.log(`Wave ${n} (${def.kind}): ${count} monsters; spawns over ${secs(lastSpawn - first)} s; first spawn to last exit ${secs(end - first)} s`);
  console.log(`  ${groups}`);
}
