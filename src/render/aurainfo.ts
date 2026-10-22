// What the auras do, spelled out for the panels: which auras reach a tower and what each
// adds (the field's own rule, the same aura from two sources counts once, strongest value
// per stat), and which towers an aura tower reaches. Reads the sim, writes nothing.

import { auraSources } from '../sim/auras.ts';
import { within } from '../sim/combat.ts';
import { baseSkillId } from '../sim/data.ts';
import { ELEMENTS, type Element, type Sim, type Tower } from '../sim/state.ts';

export interface AuraEffect {
  /** The aura's base skill id (conviction, fanaticism). */
  skill: string;
  /** The tower projecting it, and whether it comes from an item the tower wears. */
  towerId: number;
  item: boolean;
  damagePct: number;
  attackSpeedPct: number;
  fireMax: number;
  resistDown: Partial<Record<Element, number>>;
  slowPct: number;
  goldPct: number;
  radiusUnits: number;
}

/** Every aura a tower projects (its own skill, its partner's, its items'). */
export function projected(sim: Sim, tower: Tower): AuraEffect[] {
  return auraSources(sim, tower).map(({ skill, aura }) => ({
    skill: baseSkillId(skill.id),
    towerId: tower.id,
    item: skill.id.includes('#item'),
    damagePct: aura.towers?.damagePct ?? 0,
    attackSpeedPct: aura.towers?.attackSpeedPct ?? 0,
    fireMax: aura.towers?.fireMax ?? 0,
    resistDown: aura.monsters?.resistDown ?? {},
    slowPct: aura.monsters?.slowPct ?? 0,
    goldPct: aura.monsters?.goldPct ?? 0,
    radiusUnits: aura.radiusUnits,
  }));
}

/**
 * The tower-side auras reaching a tower, as the field counts them: one entry per aura, the
 * strongest source of it. The sum of their damagePct and attackSpeedPct is the tower's buff.
 */
export function effectsOn(sim: Sim, tower: Tower): AuraEffect[] {
  const best = new Map<string, AuraEffect>();
  for (const src of sim.state.towers) {
    for (const e of projected(sim, src)) {
      if (e.damagePct === 0 && e.attackSpeedPct === 0 && e.fireMax === 0) continue;
      if (!within(src, tower, e.radiusUnits)) continue;
      const have = best.get(e.skill);
      if (!have || e.damagePct + e.attackSpeedPct + e.fireMax > have.damagePct + have.attackSpeedPct + have.fireMax) best.set(e.skill, e);
    }
  }
  return [...best.values()];
}

/** The towers an aura from `source` reaches, and whether each takes it or is under a stronger copy. */
export function reachOf(sim: Sim, source: Tower, effect: AuraEffect): { tower: Tower; counts: boolean }[] {
  return sim.state.towers
    .filter((t) => within(source, t, effect.radiusUnits))
    .map((t) => ({ tower: t, counts: effectsOn(sim, t).some((e) => e.skill === effect.skill && e.towerId === source.id) }));
}

/** An aura's numbers in its own terms: "+33% damage, +20% attack speed", "-85% fire, cold, lightning resistance". */
export function terms(e: AuraEffect): string {
  const out: string[] = [];
  if (e.damagePct) out.push(`+${e.damagePct}% damage`);
  if (e.attackSpeedPct) out.push(`+${e.attackSpeedPct}% attack speed`);
  if (e.fireMax) out.push(`+${Math.round(e.fireMax / 256)} fire a hit`);
  const cuts = ELEMENTS.filter((el) => (e.resistDown[el] ?? 0) > 0);
  if (cuts.length) {
    const same = cuts.every((el) => e.resistDown[el] === e.resistDown[cuts[0]!]);
    out.push(same ? `-${e.resistDown[cuts[0]!]}% ${cuts.map(elementName).join(', ')} resistance on monsters hit` : cuts.map((el) => `-${e.resistDown[el]}% ${elementName(el)}`).join(', ') + ' resistance on monsters hit');
  }
  if (e.slowPct) out.push(`monsters ${e.slowPct}% slower`);
  if (e.goldPct) out.push(`+${e.goldPct}% gold from monsters killed in reach, by any tower`);
  return out.join(', ');
}

function elementName(el: Element): string {
  return el === 'ltng' ? 'lightning' : el === 'pois' ? 'poison' : el === 'mag' ? 'magic' : el === 'phys' ? 'physical' : el;
}
