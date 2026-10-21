// Wave timing report: for chosen waves, how many monsters, how they are spaced, how long
// the stream lasts, and how long its slowest monster takes to lap the ring. Uses the real
// tables. Balance-free: no tower ever fires.
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
  // Jump straight to wave n with nothing on the map
  sim.state.wave = n - 1;
  for (let i = 0; i < n - 1; i++) sim.state.waves.push({ remaining: 0 });
  step(sim, [{ type: 'callWave' }]);
  const spawnTicks = sim.state.spawns.map((s) => s.tick);
  const first = Math.min(...spawnTicks);
  const lastSpawn = Math.max(...spawnTicks);
  const slowest = Math.min(...def.groups.map((g) => data.monsters[g.monster]!.speed));
  const lap = Math.round(probe.map.length / Math.max(1, slowest));
  const tally = new Map<string, number>();
  for (const g of def.groups) {
    const key = `${g.monster}${g.rank === 'normal' ? '' : ` (${g.rank})`}`;
    tally.set(key, (tally.get(key) ?? 0) + g.count);
  }
  const spacing = def.groups[0]!.spacingTicks;
  const groups = `${[...tally].map(([k, c]) => `${c}x ${k}`).join(', ')}; one every ${secs(spacing)} s`;
  console.log(`Wave ${n} (${def.kind}): ${spawnTicks.length} monsters; spawns over ${secs(lastSpawn - first)} s; slowest laps the ring in ${secs(lap)} s`);
  console.log(`  ${groups}`);
}
