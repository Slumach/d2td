// The battle bot: plays one slot of a battle or co-op match, inside the match step so every
// client runs it alike (integer math only, nothing but the match state in). It plays its
// race's two strongest attack lines, levels and tiers them by damage gained per gold, works
// toward one of its class's evolutions, hires workers early, spends its Souls on sends at
// the enemy lane that leaks most, and buys the king life when it is hurt.
//
// Every BOT_PERIOD ticks (staggered by slot) it looks once and issues what it can afford.
// Each bot slot has a temper drawn from the match seed: how many workers it hires, how far
// ahead it saves, whether it banks Souls for the dear sends, and a little taste in towers.

import { kingUpgradeCost, sendCost, sendOpen, workerCost } from './battle.ts';
import { standardDps } from './dps.ts';
import { MAX_TIER, MAX_TOWER_LEVEL, type EvolutionDef } from './data.ts';
import type { SkillDef } from './archetypes/types.ts';
import { idiv } from './fixed.ts';
import { activeSkill } from './auras.ts';
import { buildCostFor, canBuild, evolutionFor, meets, tierCost, upgradeCost } from './towers.ts';
import type { Command, Sim, Tower } from './state.ts';
import type { Match } from './match.ts';
import { enemyOf, joiningWave, ringOf, seatOf } from './match.ts';

const BOT_PERIOD = 10;
/** A plan step counts its value over the whole gold it takes: the next tier at level 5. */
const PER = 1000;

/** A bot's play style, fixed for the match from the seed and its slot. */
interface Temper {
  /** Workers above the wave count's half it aims for: 0 to 3. */
  workers: number;
  /** Waves of income it saves ahead for its best buy: 1 to 3. */
  saveWaves: number;
  /** Souls it keeps over a send's cost before sending: x1 to x3. */
  sendHold: number;
  /** Per mille on each line's worth, so the two lines it builds may differ. */
  taste: number;
}

/** A 32-bit mix of two numbers (deterministic, integer). */
function mix(a: number, b: number): number {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

function temperOf(seed: number, slot: number): Temper {
  const h = mix(seed, slot + 1);
  return { workers: h % 4, saveWaves: 1 + ((h >>> 4) % 3), sendHold: 1 + ((h >>> 8) % 3), taste: (h >>> 12) % 1000 };
}

interface Option {
  score: number;
  cost: number;
  command: Command;
}

/** The commands a bot slot issues this tick. */
export function botCommands(match: Match, slot: number): Command[] {
  const m = match.state;
  const b = m.battle;
  if (!b || m.status === 'over' || (m.tick + slot * 3) % BOT_PERIOD !== 0) return [];
  const sim = match.zones[ringOf(match, slot)]!;
  const bs = sim.state.battle;
  if (!bs || sim.state.status !== 'playing') return [];
  const seat = seatOf(match, slot);
  const race = bs.races[seat]!;
  const out: Command[] = [];
  let gold = sim.state.gold[seat]!;
  const mine = sim.state.towers.filter((t) => t.owner === seat && t.legendOf === undefined);
  const temper = temperOf(b.seed, slot);
  const lines = attackLines(sim, race, temper);
  const recipe = planRecipe(sim, race, lines);

  // Branches waiting to be picked: the stronger at its first level, or the plan's
  for (const t of mine) {
    const options = t.line && !t.evolved && t.picks.length === t.tier - 1 ? (sim.data.classes[t.cls]?.lines[t.line]?.tiers[t.tier - 1] ?? []) : [];
    if (options.length > 1) out.push({ type: 'pickBranch', towerId: t.id, skill: bestBranch(sim, options, recipe) });
  }

  // An evolution ready to make comes first
  if (recipe) {
    const pair = readyPair(sim, mine, recipe);
    if (pair && gold >= sim.data.economy.evolveCost) {
      out.push({ type: 'evolve', towerA: pair[0].id, towerB: pair[1].id });
      gold -= sim.data.economy.evolveCost;
    }
  }

  // Workers early, while they have waves left to pay back
  const rules = sim.data.battle!.rules;
  const wave = b.wave;
  const workerTarget = Math.min(rules.worker.max, wave < 2 ? 0 : temper.workers + idiv(wave, 2));
  if (mine.length >= 2 && bs.workers[seat]! < workerTarget && wave < 16) {
    const cost = workerCost(sim, seat);
    if (gold >= cost * 2) {
      out.push({ type: 'hire' });
      gold -= cost;
    }
  }

  // The king: life when it is hurt, Tyrael when gold is plentiful
  const king = bs.king;
  if (king.hp * 10 < king.maxHp * 7) {
    const cost = kingUpgradeCost(sim, 'hp');
    if (cost !== undefined && gold >= cost) {
      out.push({ type: 'king', upgrade: 'hp' });
      gold -= cost;
    }
  }

  // Towers: the best damage per gold, saving for it when it is close
  const options = towerOptions(sim, seat, race, mine, lines, recipe);
  options.sort((x, y) => y.score - x.score || x.cost - y.cost);
  const income = (rules.income[wave] ?? 0) + bs.income[seat]!;
  // Under pressure (two enemies sending at its lane, or the king badly hurt) it buys damage now instead of saving
  const lane = sim.arcOwners.indexOf(seat);
  const pressed = new Set(bs.queued.filter((q) => q.lane === lane).map((q) => q.from)).size >= 2 || king.hp * 10 < king.maxHp * 6;
  for (const o of options) {
    if (o.cost <= gold) {
      out.push(o.command);
      gold -= o.cost;
      // One tower bought a look: costs and values change with it
      break;
    }
    // Worth saving for: within the temper's waves of income, an evolution within four
    if (pressed) continue;
    if (o.cost <= gold + income * (o.command.type === 'evolve' ? 4 : temper.saveWaves)) break;
  }

  if (king.hp * 2 >= king.maxHp && wave >= 8 && gold > 0) {
    const cost = kingUpgradeCost(sim, 'tyrael');
    if (cost !== undefined && cost * 8 <= gold) out.push({ type: 'king', upgrade: 'tyrael' });
  }

  // Sends: the dearest open one the Souls buy, at the enemy lane that leaks most
  if (m.mode === 'battle' && b.phase === 'build') {
    const join = joiningWave(match);
    const souls = bs.souls[seat]!;
    let best: { id: string; cost: number } | undefined;
    for (const send of rules.sends) {
      if (!sendOpen(send, join, b.made[slot]!)) continue;
      const cost = sendCost(send, join);
      if (cost <= souls && (!best || cost > best.cost)) best = { id: send.id, cost };
    }
    // A patient bot holds its Souls for a dearer send than it can buy now
    if (best && best.cost * (1 + temper.sendHold) >= souls) {
      const enemy = match.zones[enemyOf(match, slot)]!;
      const eb = enemy.state.battle!;
      let lane = 0;
      for (let k = 1; k < enemy.map.arcs.length; k++) {
        const seatK = enemy.arcOwners[k]!;
        if (eb.leaks[seatK]! > eb.leaks[enemy.arcOwners[lane]!]!) lane = k;
      }
      out.push({ type: 'send', send: best.id, lane });
    }
  }
  return out;
}

/** The race's attack lines, strongest first by their top tier's damage, as the bot's taste weighs them. */
function attackLines(sim: Sim, race: string, temper: Temper): string[] {
  const cls = sim.data.classes[race];
  if (!cls) return [];
  const scored = Object.entries(cls.lines).map(([id, line]) => {
    const top = line.tiers.at(-1)!.map((s) => skillDps(sim, s, MAX_TOWER_LEVEL - 1));
    // Taste: up to half again on one line's worth, a different line for each slot
    const lean = mix(temper.taste, id.length * 31 + id.charCodeAt(0)) % 500;
    return { id, dps: idiv(Math.max(0, ...top) * (1000 + lean), 1000), first: skillDps(sim, line.tiers[0]![0]!, 0) };
  });
  return scored.filter((l) => l.dps > 0 && l.first > 0).sort((a, b) => b.dps - a.dps || (a.id < b.id ? -1 : 1)).slice(0, 2).map((l) => l.id);
}

function skillDps(sim: Sim, id: string, lvl: number): number {
  const skill = sim.data.skills[id];
  return skill ? worth(sim, skill, lvl) : 0;
}

function towerDps(sim: Sim, t: Tower): number {
  const a = activeSkill(sim, t);
  return a ? worth(sim, a.skill, Math.min(a.lvl, MAX_TOWER_LEVEL - 1)) : 0;
}

/** A skill's damage for the bot: its standard DPS, or for a trap the shots it sets (its bolt's). */
function worth(sim: Sim, skill: SkillDef, lvl: number): number {
  const dps = standardDps(skill, lvl);
  if (dps > 0 || skill.archetype !== 'summon') return dps;
  const shot = skill.shotSkills[0];
  const bolt = shot ? sim.data.skills[shot] : undefined;
  return bolt ? standardDps(bolt, lvl) : 0;
}

/** The evolution the bot works toward: one whose attack is on its lines, the partner on any line of its class. */
function planRecipe(sim: Sim, race: string, lines: string[]): EvolutionDef | undefined {
  const cls = sim.data.classes[race];
  if (!cls) return undefined;
  const lineOfSkill = (skill: string) => Object.entries(cls.lines).find(([, l]) => l.tiers.flat().includes(skill))?.[0];
  const ok = sim.data.evolutions.filter((r) => {
    const a = lineOfSkill(r.attack.skill);
    const p = lineOfSkill(r.partner.skill);
    return a !== undefined && p !== undefined && lines.includes(a) && skillDps(sim, r.attack.skill, MAX_TOWER_LEVEL - 1) > 0;
  });
  // The cheapest to reach: lowest tiers asked
  ok.sort((x, y) => x.attack.minTier + x.partner.minTier - (y.attack.minTier + y.partner.minTier) || (x.id < y.id ? -1 : 1));
  return ok[0];
}

function readyPair(sim: Sim, mine: Tower[], recipe: EvolutionDef): [Tower, Tower] | undefined {
  for (const a of mine) {
    if (!meets(sim, a, recipe.attack)) continue;
    for (const p of mine) if (p.id !== a.id && meets(sim, p, recipe.partner) && evolutionFor(sim, a, p)?.recipe.id === recipe.id) return [a, p];
  }
  return undefined;
}

function bestBranch(sim: Sim, options: string[], recipe: EvolutionDef | undefined): string {
  const planned = options.find((s) => s === recipe?.attack.skill || s === recipe?.partner.skill);
  if (planned) return planned;
  let best = options[0]!;
  for (const s of options) if (skillDps(sim, s, 0) > skillDps(sim, best, 0)) best = s;
  return best;
}

/** Whether a tower is on the evolution plan's partner line and not there yet. */
function partnerOf(sim: Sim, t: Tower, recipe: EvolutionDef | undefined): boolean {
  if (!recipe || t.evolved) return false;
  const line = sim.data.classes[t.cls]?.lines[t.line];
  return !!line?.tiers.flat().includes(recipe.partner.skill) && !meets(sim, t, recipe.partner);
}

/** Every purchase on the bot's towers, scored as damage gained per gold (per mille). */
function towerOptions(sim: Sim, seat: number, race: string, mine: Tower[], lines: string[], recipe: EvolutionDef | undefined): Option[] {
  const out: Option[] = [];
  const cls = sim.data.classes[race];
  if (!cls || lines.length === 0) return out;
  const attackers = mine.filter((t) => !partnerOf(sim, t, recipe) && towerDps(sim, t) > 0);
  const best = attackers.reduce((n, t) => Math.max(n, towerDps(sim, t)), 0);
  // The evolution's worth to the partner tower: three times the attack it lifts, over the gold to get there
  const planGain = 3 * best;

  for (const t of mine) {
    const partner = partnerOf(sim, t, recipe);
    const dps = towerDps(sim, t);
    const up = upgradeCost(sim, t);
    const skill = activeSkill(sim, t)?.skill;
    if (up !== undefined && skill) {
      const gain = partner ? idiv(planGain, 4) : levelGain(sim, t);
      if (gain > 0) out.push({ score: idiv(gain * PER, up), cost: up, command: { type: 'upgrade', towerId: t.id } });
    }
    const tc = tierCost(sim, t);
    if (tc !== undefined && t.tier < MAX_TIER) {
      const line = cls.lines[t.line]!;
      const next = line.tiers[t.tier]!;
      const nextSkill = next.find((s) => s === recipe?.attack.skill || s === recipe?.partner.skill) ?? next[0]!;
      const def = sim.data.skills[nextSkill];
      // Valued at the next tier's level 5, over all it costs to get there
      const path = tc + levelPath(sim, t.tier + 1);
      const gain = partner ? planGain : def ? worth(sim, def, MAX_TOWER_LEVEL - 1) - dps : 0;
      if (gain > 0) out.push({ score: idiv(gain * PER, path), cost: tc, command: { type: 'upgradeTier', towerId: t.id } });
    }
    // A level short of 5 is also a step toward the next tier: the whole path valued at its end
    const line = t.line && !t.evolved ? cls.lines[t.line] : undefined;
    const next = line?.tiers[t.tier];
    if (up !== undefined && next && t.level < MAX_TOWER_LEVEL && t.tier < MAX_TIER) {
      const nextSkill = next.find((s) => s === recipe?.attack.skill || s === recipe?.partner.skill) ?? next[0]!;
      const def = sim.data.skills[nextSkill];
      const levels = (sim.data.economy.levelCosts[t.tier - 1] ?? []).slice(t.level - 1).reduce((n, c) => n + c, 0);
      const path = levels + (sim.data.economy.tierCosts[t.tier - 1] ?? 0) + levelPath(sim, t.tier + 1);
      const gain = partner ? planGain : def ? worth(sim, def, MAX_TOWER_LEVEL - 1) - dps : 0;
      if (gain > 0) out.push({ score: idiv(gain * PER, path), cost: up, command: { type: 'upgrade', towerId: t.id } });
    }
  }

  // A ready evolution is the thing to save for
  if (recipe) {
    const pair = readyPair(sim, mine, recipe);
    const cost = sim.data.economy.evolveCost;
    if (pair) out.push({ score: Number.MAX_SAFE_INTEGER, cost, command: { type: 'evolve', towerA: pair[0].id, towerB: pair[1].id } });
  }

  // A new tower on the next line in turn, or the plan's partner when the attack is far enough
  const build = buildCostFor(sim, seat);
  const tile = freeTile(sim, seat, mine.length);
  if (tile) {
    const line = lines[mine.length % lines.length]!;
    const skill = cls.lines[line]!.tiers[0]![0]!;
    const gain = skillDps(sim, skill, 0);
    out.push({ score: idiv(gain * PER, build) + (mine.length < 2 ? PER * 100 : 0), cost: build, command: { type: 'build', x: tile.x, y: tile.y, cls: race, skill } });
    const hasPartner = mine.some((t) => recipe && sim.data.classes[t.cls]?.lines[t.line]?.tiers.flat().includes(recipe.partner.skill));
    if (recipe && !hasPartner && attackers.some((t) => t.tier >= recipe.attack.minTier) && mine.length >= 3) {
      const pLine = Object.entries(cls.lines).find(([, l]) => l.tiers.flat().includes(recipe.partner.skill))?.[0];
      if (pLine && !lines.includes(pLine)) {
        const pSkill = cls.lines[pLine]!.tiers[0]![0]!;
        out.push({ score: idiv(planGain * PER, build + 4 * levelPath(sim, 1)), cost: build, command: { type: 'build', x: tile.x, y: tile.y, cls: race, skill: pSkill } });
      }
    }
  }
  return out;
}

/** What the tower's next level adds to its damage: its skill a level on, past 5 the skill levels it buys. */
function levelGain(sim: Sim, t: Tower): number {
  const now = activeSkill(sim, t);
  const next = activeSkill(sim, { ...t, level: t.level + 1 });
  if (!now || !next) return 0;
  return worth(sim, next.skill, Math.min(next.lvl, MAX_TOWER_LEVEL - 1)) - worth(sim, now.skill, Math.min(now.lvl, MAX_TOWER_LEVEL - 1));
}

/** Gold for levels 1 to 5 of a tier. */
function levelPath(sim: Sim, tier: number): number {
  return (sim.data.economy.levelCosts[tier - 1] ?? []).reduce((n, c) => n + c, 0);
}

/**
 * Where the bot builds its next tower: beside its lane's path, the middle rows first, then
 * a column further out; deterministic.
 */
function freeTile(sim: Sim, seat: number, _count: number): { x: number; y: number } | undefined {
  const lane = sim.arcOwners.indexOf(seat);
  const map = sim.map;
  let cx = -1;
  for (let x = 0; x < map.width; x++) if (map.pathTiles[10 * map.width + x] && map.arcTiles[10 * map.width + x] === lane) cx = x;
  if (cx < 0) return undefined;
  const mid = 15;
  for (let d = 1; d <= 4; d++) {
    for (let r = 0; r <= 14; r++) {
      for (const y of r === 0 ? [mid] : [mid - r, mid + r]) {
        for (const x of [cx - d, cx + d]) if (canBuild(sim, x, y, seat)) return { x, y };
      }
    }
  }
  return undefined;
}

