// Bot players for the balance harness and the replay test. A bot looks at sim state and
// returns commands, exactly what a human client sends; it never touches state itself.
//
//   BOLT      Holy Bolt towers only, levels but never tiers
//   HOLY      the Holy line (Holy Bolt, Blessed Hammer, Fist of the Heavens), no auras
//   TWOLINE   Holy plus Aura towers (Might; Concentration or Holy Freeze; Fanaticism or
//             Conviction), no evolution
//   PALADIN   Zealot, Holy and Aura towers; opens for a Hammerdin by wave 15
//
// All four share one engine, so they differ only in what they may use. Each decision
// takes the option with the most estimated power per gold among: a new tower on the best
// free tile, a level, a tier (with its best branch). It then saves up for that option.
// Power is a rough damage-per-tick estimate from the resolved skill data; auras are worth
// what they add to the towers they cover.

import type { HitFilter, SkillDef } from '../src/sim/archetypes/types.ts';
import { auraSources } from '../src/sim/auras.ts';
import { MAX_TOWER_LEVEL, type GameData } from '../src/sim/data.ts';
import { tileCenter, isPathTile } from '../src/sim/map.ts';
import { activeSkill, canBuild, createSim, evolutionFor, pendingChoices, step, tierCost, upgradeCost } from '../src/sim/sim.ts';
import type { Command, Sim, TimedCommand, Tower } from '../src/sim/state.ts';

export type Strategy = 'BOLT' | 'HOLY' | 'TWOLINE' | 'PALADIN';
export const STRATEGIES: Strategy[] = ['BOLT', 'HOLY', 'TWOLINE', 'PALADIN'];

/** Bots act every this many ticks, roughly a human's pace. */
export const DECISION_TICKS = 10;

export interface Bot {
  strategy: Strategy;
  decide(sim: Sim): Command[];
  /** Wave on which the bot evolved, by recipe id. */
  evolvedOn: Record<string, number>;
}

interface Spot {
  x: number;
  y: number;
  score: number;
}

/** Buildable tiles ranked by how many path tiles lie within `radiusTenths`, best first. */
function rankSpots(sim: Sim, radiusTenths: number): Spot[] {
  const spots: Spot[] = [];
  const reach = Math.ceil(radiusTenths / 10);
  for (let y = 0; y < sim.map.height; y++) {
    for (let x = 0; x < sim.map.width; x++) {
      if (!canBuild(sim, x, y)) continue;
      let score = 0;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          if ((dx * dx + dy * dy) * 100 <= radiusTenths * radiusTenths && isPathTile(sim.map, x + dx, y + dy)) score++;
        }
      }
      if (score > 0) spots.push({ x, y, score });
    }
  }
  return spots.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
}

function callWaveIfClear(sim: Sim): Command[] {
  const s = sim.state;
  return s.monsters.length === 0 && s.spawns.length === 0 && s.wave < sim.data.waves.length ? [{ type: 'callWave' }] : [];
}

function progress(t: Tower): number {
  return (t.tier - 1) * MAX_TOWER_LEVEL + t.level;
}

// ---- power estimate ----

/** Rough share of hits that land on undead, demons and the rest across the Act 1 roster. */
const UNDEAD_SHARE = 30;
const DEMON_SHARE = 50;

function hitFactor(filter: HitFilter): number {
  const pct = (full: boolean, bonus: number) => (full ? 100 : filter.otherDamagePct) * (100 + bonus) / 100;
  const f = filter.fullDamageTo;
  const undead = pct(f === 'all' || f === 'undead' || f === 'undeadDemon', filter.bonusVsUndeadPct);
  const demon = pct(f === 'all' || f === 'demon' || f === 'undeadDemon', filter.bonusVsDemonPct);
  const other = pct(f === 'all', 0);
  return (undead * UNDEAD_SHARE + demon * DEMON_SHARE + other * (100 - UNDEAD_SHARE - DEMON_SHARE)) / 10000;
}

const avg = (r: { min: number; max: number }) => (r.min + r.max) / 2;

interface Buff {
  damagePct: number;
  attackSpeedPct: number;
}

/**
 * Damage per tick of a skill at a level against a typical crowd. Each hit counts for at
 * most `hpCap` (the coming wave's average HP): overkill on a 4 HP Fallen is wasted, so
 * more hits beat bigger ones once damage outgrows the monsters.
 */
function attackPower(skill: SkillDef, lvl: number, ignoreDelay: boolean, buff: Buff, hpCap: number): number {
  const rate = Math.max(1, (skill.rateTicks * 100) / (100 + buff.attackSpeedPct));
  const interval = Math.max(rate, ignoreDelay ? 0 : skill.delayTicks);
  const hit = (damage: number, filter?: HitFilter) =>
    Math.min(hpCap, (damage * (100 + buff.damagePct) * (filter ? hitFactor(filter) : 1)) / 100);
  switch (skill.archetype) {
    case 'projectile': {
      const l = skill.levels[lvl]!;
      return (hit(avg(l), skill.filter) * l.count) / interval;
    }
    case 'pierce': {
      const l = skill.levels[lvl]!;
      return (hit(avg(l), skill.filter) * (skill.mode === 'chain' ? l.hops + 1 : 2)) / interval;
    }
    case 'splash': {
      const l = skill.levels[lvl]!;
      const targets = skill.delivery === 'orbit' ? 3 : 1 + skill.radiusUnits / 1000;
      const sub = skill.subFilter && l.subRadiusUnits > 0 ? hit(avg(l.sub), skill.subFilter) * 2 : 0;
      return (hit(avg(l), skill.filter) * targets + sub) / interval;
    }
    case 'zone': {
      const l = skill.levels[lvl]!;
      return (hit(avg(l), skill.filter) * (skill.durationTicks / skill.tickTicks) * 2) / interval;
    }
    case 'melee': {
      const l = skill.levels[lvl]!;
      const weapon = avg(skill.weapon);
      const elemental = Object.values(l.elementalPct).reduce((n, pct) => n + (weapon * (pct ?? 0)) / 100, 0);
      return (hit((weapon * (100 + l.damagePct)) / 100 + elemental) * l.swings) / interval;
    }
    case 'control': {
      const l = skill.levels[lvl]!;
      return l.max === 0 ? 0 : (hit(avg(l), skill.filter) * (skill.mode === 'aura' ? 2 : 1)) / interval;
    }
    default:
      return 0;
  }
}

/** Average HP of the next wave's normal monsters, in 1/256 HP. */
function nextWaveHp(sim: Sim): number {
  const wave = sim.data.waves[Math.min(sim.state.wave, sim.data.waves.length - 1)]!;
  let total = 0;
  let count = 0;
  for (const g of wave.groups) {
    if (g.rank !== 'normal') continue;
    const d = sim.data.monsters[g.monster]!;
    total += ((d.minHp + d.maxHp) / 2) * (wave.hpPermille / 1000) * g.count;
    count += g.count;
  }
  return count > 0 ? total / count : 256;
}

interface Coverage {
  ranged: Map<string, number>;
  melee: Map<string, number>;
  best: number;
}

/**
 * Total power of a set of towers, auras included. Attack towers count for the share of
 * path they cover; buff auras count for what they add to covered towers (same aura:
 * strongest only); monster auras for the time and resistance they take off.
 */
function totalPower(sim: Sim, towers: Tower[], cov: Coverage, hpCap: number): number {
  const buffs = new Map<number, Map<string, Buff>>();
  const sources = towers.flatMap((t) => auraSources(sim, t).map((src) => ({ ...src, tower: t })));
  for (const { tower, skill, aura } of sources) {
    if (!aura.towers) continue;
    for (const t of towers) {
      if ((t.x - tower.x) ** 2 + (t.y - tower.y) ** 2 > aura.radiusUnits ** 2) continue;
      const per = buffs.get(t.id) ?? new Map<string, Buff>();
      const prev = per.get(skill.id) ?? { damagePct: 0, attackSpeedPct: 0 };
      per.set(skill.id, {
        damagePct: Math.max(prev.damagePct, aura.towers.damagePct),
        attackSpeedPct: Math.max(prev.attackSpeedPct, aura.towers.attackSpeedPct),
      });
      buffs.set(t.id, per);
    }
  }

  const attack = new Map<number, number>();
  for (const t of towers) {
    const active = activeSkill(sim, t);
    if (!active) continue;
    const buff: Buff = { damagePct: 0, attackSpeedPct: 0 };
    for (const b of buffs.get(t.id)?.values() ?? []) {
      buff.damagePct += b.damagePct;
      buff.attackSpeedPct += b.attackSpeedPct;
    }
    const recipe = t.evolved ? sim.data.evolutions.find((e) => e.id === t.evolved) : undefined;
    const key = `${t.tileX},${t.tileY}`;
    const share = (active.skill.archetype === 'melee' ? cov.melee.get(key) : cov.ranged.get(key)) ?? 0;
    attack.set(t.id, (attackPower(active.skill, active.lvl, recipe?.ignoreSkillDelay ?? false, buff, hpCap) * share) / cov.best);
  }

  let total = [...attack.values()].reduce((n, v) => n + v, 0);
  for (const { tower, aura } of sources) {
    if (!aura.monsters) continue;
    const covered = towers
      .filter((t) => (t.x - tower.x) ** 2 + (t.y - tower.y) ** 2 <= aura.radiusUnits ** 2)
      .reduce((n, t) => n + (attack.get(t.id) ?? 0), 0);
    const resist = Object.values(aura.monsters.resistDown).reduce((n, v) => n + (v ?? 0), 0) / 3;
    total += (covered * (aura.monsters.slowPct / 2 + resist / 2)) / 100;
  }
  return total;
}

// ---- options ----

interface Option {
  /** Total gold the option needs, used to rank it. */
  cost: number;
  /** Gold the first command needs now; defaults to cost. */
  stepCost?: number;
  gain: number;
  commands: Command[];
}

/** Gain from replacing (or adding) one tower. */
function gainOf(sim: Sim, towers: Tower[], before: number, changed: Tower, cov: Coverage, hpCap: number): number {
  const after = towers.filter((t) => t.id !== changed.id);
  after.push(changed);
  return totalPower(sim, after, cov, hpCap) - before;
}

interface BotConfig {
  strategy: Strategy;
  /** T1 skills the bot may build. */
  builds: string[];
  tiers: boolean;
  opening?: (ctx: OpeningContext) => Goal[];
}

/** A payoff several purchases away is worth less than one now, and needs a defence first. */
const LOOKAHEAD_DISCOUNT_PCT = 50;
const LOOKAHEAD_MIN_TOWERS = 3;

function options(sim: Sim, config: BotConfig, ranged: Spot[], melee: Spot[], cov: Coverage): Option[] {
  const towers = sim.state.towers;
  const hpCap = nextWaveHp(sim);
  const before = totalPower(sim, towers, cov, hpCap);
  const out: Option[] = [];
  const e = sim.data.economy;

  // New towers: each allowed T1 skill on its best free tile. Auras go where they cover
  // the most towers, which the gain itself measures, so try the top few tiles.
  for (const skill of config.builds) {
    const archetype = sim.data.skills[skill]!.archetype;
    const list = archetype === 'melee' ? melee : ranged;
    const candidates = list.filter((p) => canBuild(sim, p.x, p.y)).slice(0, archetype === 'buffAura' ? 16 : 1);
    const line = Object.entries(sim.data.classes['paladin']!.lines).find(([, l]) => l.tiers[0]!.includes(skill))![0];
    for (const spot of candidates) {
      const c = tileCenter(spot);
      const fresh: Tower = {
        id: -1, cls: 'paladin', tileX: spot.x, tileY: spot.y, x: c.x, y: c.y, line, tier: 1, level: 1,
        picks: [skill], spent: 0, cooldown: 0, targeting: 'first', evolved: '', partnerSkill: '', partnerLevel: 0, summonCooldown: 0,
      };
      out.push({
        cost: e.buildCost,
        gain: gainOf(sim, towers, before, fresh, cov, hpCap),
        commands: [{ type: 'build', x: spot.x, y: spot.y, cls: 'paladin', skill }],
      });
    }
  }

  for (const t of towers) {
    if (t.evolved) continue;
    const level = upgradeCost(sim, t);
    if (level !== undefined) {
      out.push({ cost: level, gain: gainOf(sim, towers, before, { ...t, level: t.level + 1 }, cov, hpCap), commands: [{ type: 'upgrade', towerId: t.id }] });
    }
    // Toward the next tier: the remaining levels plus the tier, valued by what the next
    // tier's skill gives. Levels 3 to 5 can look worthless on their own (overkill), so
    // without this lookahead a bot never reaches the tier they unlock.
    const line = sim.data.classes[t.cls]?.lines[t.line];
    const tierPrice = sim.data.economy.tierCosts[t.tier - 1];
    const established = towers.length >= LOOKAHEAD_MIN_TOWERS;
    if (config.tiers && established && line && tierPrice !== undefined && t.tier < line.tiers.length && t.picks.length >= t.tier) {
      let remaining = tierPrice;
      for (let lv = t.level; lv < MAX_TOWER_LEVEL; lv++) remaining += sim.data.economy.levelCosts[t.tier - 1]![lv - 1]!;
      const opts = line.tiers[t.tier] ?? [];
      for (const skill of opts) {
        const next = { ...t, tier: t.tier + 1, level: 1, picks: [...t.picks, skill] };
        const commands: Command[] =
          t.level < MAX_TOWER_LEVEL ? [{ type: 'upgrade', towerId: t.id }] : [{ type: 'upgradeTier', towerId: t.id }];
        if (t.level === MAX_TOWER_LEVEL && opts.length > 1) commands.push({ type: 'pickBranch', towerId: t.id, skill });
        // Pay only for the next step now; the option is judged on the whole path
        const stepCost = t.level < MAX_TOWER_LEVEL ? level! : tierPrice;
        const gain = (gainOf(sim, towers, before, next, cov, hpCap) * LOOKAHEAD_DISCOUNT_PCT) / 100;
        out.push({ cost: remaining, stepCost, gain, commands });
      }
    }
  }
  return out;
}

// ---- scripted openings ----

type Goal =
  | { kind: 'build'; tag: string; spot: () => { x: number; y: number } | undefined; skill: string }
  /** Level and tier a tower up to `tier`; `branches[tier]` picks a branching tier. */
  | { kind: 'max'; tag: string; tier: number; branches?: Record<number, string> }
  | { kind: 'evolve'; a: string; b: string };

interface OpeningContext {
  sim: Sim;
  ranged: Spot[];
  melee: Spot[];
  besideTag: (s: Sim, tag: string) => { x: number; y: number } | undefined;
  firstFree: (s: Sim, list: Spot[]) => Spot | undefined;
}

function engineBot(config: BotConfig, sim: Sim): Bot {
  const ranged = rankSpots(sim, 40);
  const melee = rankSpots(sim, 15);
  const cov: Coverage = {
    ranged: new Map(ranged.map((p) => [`${p.x},${p.y}`, p.score])),
    melee: new Map(melee.map((p) => [`${p.x},${p.y}`, p.score])),
    best: ranged[0]?.score ?? 1,
  };
  const tags: Record<string, number> = {};
  const evolvedOn: Record<string, number> = {};
  const byTag = (s: Sim, tag: string) => s.state.towers.find((t) => t.id === tags[tag]);
  const firstFree = (s: Sim, list: Spot[]) => list.find((p) => canBuild(s, p.x, p.y));
  const scoreOf = (p: { x: number; y: number }) => ranged.find((r) => r.x === p.x && r.y === p.y)?.score ?? 0;
  const besideTag = (s: Sim, tag: string) => {
    const anchor = byTag(s, tag);
    if (!anchor) return undefined;
    const free: { x: number; y: number }[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = { x: anchor.tileX + dx, y: anchor.tileY + dy };
        if ((dx || dy) && canBuild(s, p.x, p.y)) free.push(p);
      }
    }
    return free.sort((a, b) => scoreOf(b) - scoreOf(a))[0];
  };

  const goals = config.opening?.({ sim, ranged, melee, besideTag, firstFree }) ?? [];

  const levelUp = (s: Sim, t: Tower): Command[] => {
    const cost = upgradeCost(s, t);
    return cost !== undefined && s.state.gold >= cost ? [{ type: 'upgrade', towerId: t.id }] : [];
  };
  const tierUp = (s: Sim, t: Tower, skill: (options: string[]) => string): Command[] => {
    const cost = tierCost(s, t);
    if (cost === undefined || s.state.gold < cost) return [];
    const opts = s.data.classes[t.cls]!.lines[t.line]!.tiers[t.tier] ?? [];
    const out: Command[] = [{ type: 'upgradeTier', towerId: t.id }];
    if (opts.length > 1) out.push({ type: 'pickBranch', towerId: t.id, skill: skill(opts) });
    return out;
  };

  /** Commands for the first unfinished opening goal, [] while saving, undefined once done. */
  function advance(s: Sim): Command[] | undefined {
    while (goals.length > 0) {
      const goal = goals[0]!;
      if (goal.kind === 'build') {
        if (tags[goal.tag] !== undefined && byTag(s, goal.tag)) {
          goals.shift();
          continue;
        }
        const spot = goal.spot();
        if (!spot) {
          goals.shift();
          continue;
        }
        if (!canBuild(s, spot.x, spot.y) || s.state.gold < s.data.economy.buildCost) return [];
        tags[goal.tag] = s.state.nextId;
        return [{ type: 'build', x: spot.x, y: spot.y, cls: 'paladin', skill: goal.skill }];
      }
      if (goal.kind === 'max') {
        const t = byTag(s, goal.tag);
        if (!t || t.evolved) {
          goals.shift();
          continue;
        }
        const branchAt = (tier: number, opts: string[]) => goal.branches?.[tier] ?? opts[0]!;
        if (t.picks.length < t.tier) return [{ type: 'pickBranch', towerId: t.id, skill: branchAt(t.tier, pendingChoices(s, t)) }];
        if (t.tier >= goal.tier) {
          goals.shift();
          continue;
        }
        if (t.level < MAX_TOWER_LEVEL) return levelUp(s, t);
        return tierUp(s, t, (opts) => branchAt(t.tier + 1, opts));
      }
      const a = byTag(s, goal.a);
      const b = byTag(s, goal.b);
      const match = a && b && evolutionFor(s, a, b);
      if (!a || !b || !match) {
        goals.shift();
        continue;
      }
      if (s.state.gold < s.data.economy.evolveCost) return [];
      evolvedOn[match.recipe.id] = s.state.wave;
      goals.shift();
      return [{ type: 'evolve', towerA: a.id, towerB: b.id }];
    }
    return undefined;
  }

  return {
    strategy: config.strategy,
    evolvedOn,
    decide(s) {
      const out = callWaveIfClear(s);
      if (s.state.tick % DECISION_TICKS !== 0) return out;
      const opening = advance(s);
      if (opening) return [...opening, ...out];

      // Best power per gold; save up for it rather than buying something worse now
      let best: Option | undefined;
      for (const o of options(s, config, ranged, melee, cov)) {
        if (o.gain <= 0) continue;
        if (!best || o.gain / o.cost > best.gain / best.cost) best = o;
      }
      if (!best || s.state.gold < (best.stepCost ?? best.cost)) return out;
      return [...best.commands, ...out];
    },
  };
}

const CONFIGS: Record<Strategy, BotConfig> = {
  BOLT: { strategy: 'BOLT', builds: ['holy-bolt'], tiers: false },
  HOLY: { strategy: 'HOLY', builds: ['holy-bolt'], tiers: true },
  TWOLINE: { strategy: 'TWOLINE', builds: ['holy-bolt', 'might'], tiers: true },
  PALADIN: {
    strategy: 'PALADIN',
    builds: ['sacrifice', 'holy-bolt', 'might'],
    tiers: true,
    // A Holy tower and a Might beside it, both to T2 (Blessed Hammer, Concentration),
    // evolved into a Hammerdin; one Zealot on the path to hold the early waves.
    opening: ({ sim, ranged, melee, besideTag, firstFree }) => [
      { kind: 'build', tag: 'holy', spot: () => firstFree(sim, ranged), skill: 'holy-bolt' },
      { kind: 'build', tag: 'zealot', spot: () => firstFree(sim, melee), skill: 'sacrifice' },
      { kind: 'build', tag: 'conc', spot: () => besideTag(sim, 'holy'), skill: 'might' },
      { kind: 'max', tag: 'holy', tier: 2 },
      { kind: 'max', tag: 'conc', tier: 2, branches: { 2: 'concentration' } },
      { kind: 'evolve', a: 'holy', b: 'conc' },
    ],
  },
};

export function createBot(strategy: Strategy, sim: Sim): Bot {
  return engineBot(CONFIGS[strategy], sim);
}

export interface RunResult {
  strategy: Strategy;
  seed: number;
  won: boolean;
  /** Last wave called; the wave that ended the run on a loss. */
  wave: number;
  lives: number;
  gold: number;
  towers: number;
  /** Sum of tower progress: (tier - 1) * 5 + level. */
  levels: number;
  /** Highest tier any tower reached; 4 means evolved. */
  topTier: number;
  evolvedOn: Record<string, number>;
  /** Every command the bot sent, stamped with its tick: a replayable log. */
  log: TimedCommand[];
}

const MAX_TICKS = 600_000;

/** Plays a run with one bot (to the end, or `maxTicks`), recording its commands as a replayable log. */
export function runBot(
  data: GameData,
  strategy: Strategy,
  seed: number,
  onTick?: (sim: Sim) => void,
  maxTicks = MAX_TICKS,
): RunResult {
  const sim = createSim(data, seed);
  const bot = createBot(strategy, sim);
  const log: TimedCommand[] = [];
  let topTier = 0;
  while (sim.state.status === 'playing' && sim.state.tick < maxTicks) {
    const commands = bot.decide(sim);
    for (const command of commands) log.push({ tick: sim.state.tick, command });
    step(sim, commands);
    for (const t of sim.state.towers) topTier = Math.max(topTier, t.tier);
    onTick?.(sim);
  }
  const s = sim.state;
  return {
    strategy,
    seed,
    won: s.status === 'won',
    wave: s.wave,
    lives: s.lives,
    gold: s.gold,
    towers: s.towers.length,
    levels: s.towers.reduce((n, t) => n + progress(t), 0),
    topTier,
    evolvedOn: bot.evolvedOn,
    log,
  };
}
