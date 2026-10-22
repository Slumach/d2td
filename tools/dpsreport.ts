// DPS report: what best-in-slot gear is worth on each tower, naked against dressed, as a
// ratio, so the item stages are tuned on a measurement rather than on the bots' deaths.
// For every class line, the line's T3 skill at tower level 5, and every evolution at its
// top level: standard damage per second (dps.ts) with the aura buff gear gives (enhanced
// damage, attack or cast speed, the facets' skill damage) and the +skills on the skill,
// naked and then dressed from the best-in-slot catalogue by the harness outfitter. Aura,
// summon and pulse skills have no standard number and show their +skills instead.
//
//   npm run dps

import { DESIGN } from '../src/data/design.ts';
import { activeSkill } from '../src/sim/auras.ts';
import { buildGameData, EVOLVED_LEVEL_INDEX, MAX_TIER, MAX_TOWER_LEVEL, type GameData } from '../src/sim/data.ts';
import { standardDps } from '../src/sim/dps.ts';
import { SLOTS } from '../src/sim/items/data.ts';
import { itemName } from '../src/sim/items/item.ts';
import { gearOf, plusLevels, withGear } from '../src/sim/items/tower.ts';
import { tileCenter } from '../src/sim/map.ts';
import { createSim } from '../src/sim/sim.ts';
import type { Sim, Tower } from '../src/sim/state.ts';
import { bisCatalogue, dress } from './outfit.ts';
import { loadTables } from './lib/load-tables.ts';

const NO_BUFF = { damagePct: 0, attackSpeedPct: 0, fireMin: 0, fireMax: 0 };

function tower(sim: Sim, cls: string, line: string, picks: string[], tier: number, evolved = '', partnerSkill = '', partnerLevel = 0): Tower {
  const c = tileCenter({ x: 6, y: 5 });
  return {
    id: 1, owner: 0, cls, tileX: 6, tileY: 5, x: c.x, y: c.y, line, tier, level: MAX_TOWER_LEVEL, picks, spent: 0, cooldown: 0, targeting: 'first',
    evolved, partnerSkill, partnerLevel, summonCooldown: 0, partnerCooldown: 0,
  };
}

interface Row {
  label: string;
  nakedDps: number;
  bisDps: number;
  plus: number;
  speedPct: number;
  damagePct: number;
  worn: string[];
}

function measure(sim: Sim, t: Tower, pool: ReturnType<typeof bisCatalogue>): Row {
  const dps = (tw: Tower) => {
    const active = activeSkill(sim, tw)!;
    const g = gearOf(sim, tw);
    const buff = withGear(NO_BUFF, g, active.skill);
    const base = standardDps(active.skill, active.lvl);
    return { dps: Math.trunc((base * (100 + buff.attackSpeedPct) * (100 + buff.damagePct)) / 10_000), plus: plusLevels(sim, g, active.skill), buff };
  };
  const naked = dps(t);
  const dressed: Tower = { ...t, gear: dress(sim, t, pool) };
  const bis = dps(dressed);
  return {
    label: `${t.cls} ${t.line} ${t.evolved || t.picks.at(-1)}`,
    nakedDps: naked.dps,
    bisDps: bis.dps,
    plus: bis.plus,
    speedPct: bis.buff.attackSpeedPct,
    damagePct: bis.buff.damagePct,
    worn: SLOTS.flatMap((s) => (dressed.gear?.[s] ? [itemName(sim.data.items, dressed.gear[s]!)] : [])),
  };
}

function main(): void {
  const data: GameData = buildGameData(loadTables(), DESIGN);
  const sim = createSim(data, 1);
  const pool = bisCatalogue(data.items);
  const rows: { tier: string; row: Row }[] = [];
  for (const cls of Object.values(data.classes)) {
    for (const [lineId, line] of Object.entries(cls.lines)) {
      const picks = line.tiers.map((options) => options[0]!);
      for (const skill of line.tiers[2] ?? []) {
        rows.push({ tier: 'T3', row: measure(sim, tower(sim, cls.id, lineId, [picks[0]!, picks[1]!, skill], 3), pool) });
      }
    }
  }
  for (const recipe of data.evolutions) {
    const attack = data.skills[recipe.attack.skill]!;
    const cls = Object.values(data.classes).find((c) => Object.values(c.lines).some((l) => l.tiers.flat().includes(recipe.attack.skill)));
    const lineId = cls ? Object.entries(cls.lines).find(([, l]) => l.tiers.flat().includes(recipe.attack.skill))![0] : '';
    const t = tower(sim, cls?.id ?? 'paladin', lineId, [attack.id], MAX_TIER + 1, recipe.id, recipe.partner.skill, EVOLVED_LEVEL_INDEX);
    rows.push({ tier: 'evolved', row: measure(sim, t, pool) });
  }
  const ratios: number[] = [];
  for (const tier of ['T3', 'evolved']) {
    console.log(`\n${tier === 'T3' ? 'T3 skills at tower level 5' : 'Evolved towers (T4, the top tier built; T5 does not exist yet)'}`);
    console.log('  skill                                         naked dps     bis dps   ratio  +skills  speed%  dmg%  worn');
    for (const { row } of rows.filter((r) => r.tier === tier)) {
      const ratio = row.nakedDps > 0 ? row.bisDps / row.nakedDps : 0;
      if (ratio > 0) ratios.push(ratio);
      const r = row.nakedDps > 0 ? `${ratio.toFixed(2)}x` : '(no dps)';
      console.log(`  ${row.label.padEnd(44)} ${String(row.nakedDps).padStart(10)} ${String(row.bisDps).padStart(10)}  ${r.padStart(7)}  ${String(row.plus).padStart(7)}  ${String(row.speedPct).padStart(6)}  ${String(row.damagePct).padStart(4)}  ${row.worn.join(', ')}`);
    }
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  console.log(`\nAttack skills: ${ratios.length}; bis over naked from ${sorted[0]?.toFixed(2)}x to ${sorted.at(-1)?.toFixed(2)}x, median ${median.toFixed(2)}x (target 8x or better)`);
}

main();
