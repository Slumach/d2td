// Bot players for the balance harness and the replay test. A bot looks at sim state and
// returns commands, exactly what a human client sends; it never touches state itself.
//
//   BOLT      Holy Bolt towers only, levels but never tiers
//   HOLY      the Holy line (Holy Bolt, Blessed Hammer, Fist of the Heavens), no auras
//   TWOLINE   Holy plus Aura towers (Might; Concentration or Holy Freeze; Fanaticism or
//             Conviction), no evolution
//   PALADIN   Zealot, Holy and Aura towers; opens for a Hammerdin by wave 15
//   SORC      the four Sorceress lines, evolving whatever pair it can
//   NECRO     the Necromancer's bone and curse lines, evolving whatever pair it can
//   MIXED3    every class's lines, evolving whatever pair it can
//
// All share one engine, so they differ only in what they may use. Each decision takes the
// option with the most estimated power per gold among: a new tower on the best free tile,
// a level, a tier (with its best branch), and for the bots that may, an evolution. It then
// saves up for that option. Power is a rough damage-per-tick estimate from the resolved
// skill data, judged against the coming monsters' resistances; auras and curses are worth
// what they add to the towers they cover.

import type { HitFilter, SkillDef } from '../src/sim/archetypes/types.ts';
import { auraSources } from '../src/sim/auras.ts';
import { baseSkillId, EVOLVED_LEVEL_INDEX, MAX_TIER, MAX_TOWER_LEVEL, waveTotalHp, type GameData } from '../src/sim/data.ts';
import { tileCenter, isPathTile } from '../src/sim/map.ts';
import { activeSkill, aliveLimitOf, buildCostFor, canBuild, createSim, waveAt, evolutionFor, pendingChoices, step, tierCost, upgradeCost } from '../src/sim/sim.ts';
import { withMods } from '../src/sim/combat.ts';
import { freeSpot } from '../src/sim/items/loot.ts';
import { lootBuilds, lootPool, outfit, type LootSet } from './outfit.ts';
import type { Item } from '../src/sim/items/item.ts';
import { ELEMENTS, type Command, type Element, type Sim, type TimedCommand, type Tower } from '../src/sim/state.ts';

export type Strategy = 'BOLT' | 'HOLY' | 'TWOLINE' | 'PALADIN' | 'SORC' | 'NECRO' | 'MIXED3' | 'AMAZON' | 'BARB' | 'DRUID' | 'ASSASSIN' | 'LOOTBUILD';
/** The Normal balance targets' bots; the class bots play the Hell gate. */
export const STRATEGIES: Strategy[] = ['BOLT', 'HOLY', 'TWOLINE', 'PALADIN'];
export const HELL_STRATEGIES: Strategy[] = ['PALADIN', 'SORC', 'NECRO', 'MIXED3', 'AMAZON', 'BARB', 'DRUID', 'ASSASSIN'];

/** The class and line whose T1 options include a skill. */
function lineOf(sim: Sim, skill: string): { cls: string; line: string } {
  for (const c of Object.values(sim.data.classes)) {
    for (const [line, l] of Object.entries(c.lines)) if (l.tiers[0]!.includes(skill)) return { cls: c.id, line };
  }
  throw new Error(`no class has ${skill} at T1`);
}

/** Where a skill sits: its class, line and tier index, or undefined if no line has it. */
function placeOf(sim: Sim, skill: string): { cls: string; line: string; tier: number } | undefined {
  for (const c of Object.values(sim.data.classes)) {
    for (const [line, l] of Object.entries(c.lines)) {
      const tier = l.tiers.findIndex((opts) => opts.includes(skill));
      if (tier >= 0) return { cls: c.id, line, tier };
    }
  }
  return undefined;
}

/**
 * The gold a tower still needs to have `skill` picked at `minTier` or above, and the next
 * command toward it with that command's price; undefined if its line cannot get there (another
 * line, or another branch already picked).
 */
function pathTo(sim: Sim, t: Tower, skill: string, minTier: number): { gold: number; step?: { commands: Command[]; cost: number } } | undefined {
  const at = placeOf(sim, skill);
  if (t.evolved || !at || at.cls !== t.cls || at.line !== t.line) return undefined;
  if (t.picks.length > at.tier && t.picks[at.tier] !== skill) return undefined;
  const target = Math.max(minTier, at.tier + 1);
  if (t.tier >= target) return { gold: 0 };
  const e = sim.data.economy;
  let gold = 0;
  for (let lv = t.level; lv < MAX_TOWER_LEVEL; lv++) gold += e.levelCosts[t.tier - 1]![lv - 1]!;
  for (let tier = t.tier + 1; tier <= target; tier++) {
    gold += e.tierCosts[tier - 2]!;
    if (tier < target) gold += e.levelCosts[tier - 1]!.reduce((n, c) => n + c, 0);
  }
  let step: { commands: Command[]; cost: number };
  if (t.level < MAX_TOWER_LEVEL) step = { commands: [{ type: 'upgrade', towerId: t.id }], cost: upgradeCost(sim, t)! };
  else {
    const commands: Command[] = [{ type: 'upgradeTier', towerId: t.id }];
    const opts = sim.data.classes[t.cls]!.lines[t.line]!.tiers[t.tier] ?? [];
    // Take the recipe's branch when it is this tier's pick
    if (opts.length > 1) commands.push({ type: 'pickBranch', towerId: t.id, skill: opts.includes(skill) ? skill : opts[0]! });
    step = { commands, cost: e.tierCosts[t.tier - 1]! };
  }
  return { gold, step };
}

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
  return s.monsters.length === 0 && s.spawns.length === 0 && waveAt(sim, s.wave) ? [{ type: 'callWave' }] : [];
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
  fire: number;
}

/** Damage per tick by element. */
type Parts = Partial<Record<Element, number>>;

/**
 * A tower's attack as the bot plans it: bare, what it wears a bonus on top. Valued in its
 * gear, a Zeal tower with a found weapon looked four times as strong and the bot sank its gold
 * into that line and the auras around it, which paid far less in play: with Nightmare loot
 * MIXED3 died on 52 and 53, planning bare 55 to 76 (0.3.13).
 */
function bareSkill(sim: Sim, t: Tower): ReturnType<typeof activeSkill> {
  return activeSkill(sim, t.gear ? { ...t, gear: undefined } : t);
}

/** A volley or a blast counts for at most this many monsters in a typical crowd. */
const CROWD = 3;
/** The least floor the pulse cap counts with (see totalPower): Normal's is zero. */
const PULSE_FLOOR_MIN_PCT = 25;

/**
 * Damage per tick of a skill at a level against a typical crowd, by element. Each hit
 * counts for at most `hpCap` (the coming wave's average HP): overkill on a 4 HP Fallen is
 * wasted, so more hits beat bigger ones once damage outgrows the monsters. Enchant's fire
 * rides on every direct hit. Summons count for the damage they deal and the HP they put
 * in the way; corpse skills and pulses for what they take off a crowd.
 */
/** attackParts reads only the data, and a big build repeats the same few towers: memoised per data. */
const partsMemo = new WeakMap<GameData, Map<string, Parts>>();

function attackParts(sim: Sim, skill: SkillDef, lvl: number, ignoreDelay: boolean, buff: Buff, hpCap: number): Parts {
  let memo = partsMemo.get(sim.data);
  if (!memo) partsMemo.set(sim.data, (memo = new Map()));
  // Static Field cannot take a monster below the difficulty's floor (Hell: half its HP)
  const floor = sim.data.rules.staticFloorPct[sim.data.waves[sim.state.wave]?.difficulty ?? 0] ?? 0;
  const key = `${skill.id}|${lvl}|${ignoreDelay}|${buff.damagePct},${buff.attackSpeedPct},${buff.fire}|${hpCap}|${floor}`;
  let parts = memo.get(key);
  if (!parts) memo.set(key, (parts = computeParts(sim, skill, lvl, ignoreDelay, buff, hpCap, floor)));
  return parts;
}

function computeParts(sim: Sim, skill: SkillDef, lvl: number, ignoreDelay: boolean, buff: Buff, hpCap: number, floor: number): Parts {
  const rate = Math.max(1, ((skill.rates[lvl] ?? skill.rateTicks) * 100) / (100 + buff.attackSpeedPct));
  const interval = Math.max(rate, ignoreDelay ? 0 : skill.delayTicks);
  const hit = (damage: number, filter?: HitFilter) =>
    Math.min(hpCap, (damage * (100 + buff.damagePct) * (filter ? hitFactor(filter) : 1)) / 100);
  const el = skill.damageType === 'none' ? 'phys' : skill.damageType;
  const out: Parts = {};
  const add = (e: Element, v: number) => (out[e] = (out[e] ?? 0) + v);
  /** `hits` direct hits per attack of `damage` in the skill's element, plus Enchant's fire on each. */
  const direct = (damage: number, hits: number, filter?: HitFilter) => {
    add(el, (hit(damage, filter) * hits) / interval);
    if (buff.fire > 0) add('fire', (Math.min(hpCap, buff.fire) * hits) / interval);
  };
  const attackTicks = sim.data.rules.monsterAttackTicks;
  switch (skill.archetype) {
    case 'projectile': {
      const l = skill.levels[lvl]!;
      const weapon = skill.weapon ? (((avg(skill.weapon) * skill.weaponPct) / 100) * (100 + l.damagePct)) / 100 : 0;
      direct(avg(l) + weapon, Math.min(l.count, CROWD), skill.filter);
      break;
    }
    case 'pierce': {
      const l = skill.levels[lvl]!;
      direct(avg(l), skill.mode === 'chain' ? l.hops + 1 : 2, skill.filter);
      break;
    }
    case 'splash': {
      const l = skill.levels[lvl]!;
      const targets = skill.delivery === 'orbit' ? 3 : skill.delivery === 'nova' ? CROWD : 1 + l.radiusUnits / 1000;
      direct(avg(l), targets, skill.filter);
      if (skill.subFilter && l.subRadiusUnits > 0) add(skill.subElement, (hit(avg(l.sub), skill.subFilter) * 2) / interval);
      break;
    }
    case 'zone': {
      const l = skill.levels[lvl]!;
      add(el, (hit(avg(l), skill.filter) * (skill.durationTicks / skill.tickTicks) * 2) / interval);
      break;
    }
    case 'melee': {
      // One swing is clamped whole, then split by element
      const l = skill.levels[lvl]!;
      const weapon = avg(skill.weapon);
      const raw: Parts = { phys: (weapon * (100 + l.damagePct)) / 100 };
      for (const [e, pct] of Object.entries(l.elementalPct) as [Element, number][]) raw[e] = (weapon * pct) / 100;
      const whole = Object.values(raw).reduce((n, v) => n + (v ?? 0), 0);
      const swing = hit(whole);
      for (const [e, v] of Object.entries(raw) as [Element, number][]) add(e, (swing * (v / whole) * l.swings) / interval);
      if (buff.fire > 0) add('fire', (Math.min(hpCap, buff.fire) * l.swings) / interval);
      break;
    }
    case 'control': {
      const l = skill.levels[lvl]!;
      if (l.max > 0) add(el, (hit(avg(l), skill.filter) * (skill.mode === 'aura' ? 2 : 1)) / interval);
      break;
    }
    case 'debuff': {
      const l = skill.levels[lvl]!;
      // A pulse takes hpPct of what is left: about half that over a monster's life, on a crowd,
      // and nothing once the monster is at the difficulty's floor, so only the share above the
      // floor is there to take and the pulses soon stop paying (Hell: a quarter of the model)
      if (skill.mode === 'pulse') add(el, (((hpCap * Math.min(l.hpPct, 100 - floor)) / 100 / 2) * ((100 - floor) / 100) * CROWD) / interval);
      break;
    }
    case 'summon': {
      const l = skill.levels[lvl]!;
      if (skill.kind === 'trap') {
        // Every trap standing casts its shots: the shot skills' damage, count times
        for (const id of skill.shotSkills) {
          const shot = sim.data.skills[id];
          if (!shot) continue;
          for (const [e, v] of Object.entries(attackParts(sim, shot, lvl, ignoreDelay, buff, hpCap)) as [Element, number][]) add(e, (v * l.count) / 2);
        }
      } else if (skill.kind === 'ranged') {
        for (const b of l.bolts) add(b.element, (l.count * Math.min(hpCap, avg(b))) / attackTicks / l.bolts.length);
      } else if (skill.kind === 'revive') {
        // A revived corpse is about a wave monster's HP times hpPct, standing in the way
        add('phys', (l.count * ((hpCap * l.hpPct) / 100 / 4)) / attackTicks);
      } else {
        add('phys', (l.count * (Math.min(hpCap, avg(l)) + Math.min(hpCap, l.hp) / 4)) / attackTicks);
      }
      break;
    }
    case 'corpse': {
      const l = skill.levels[lvl]!;
      // Half the casts find a corpse; the blast is a share of a wave monster's HP
      const blast = (hpCap * (l.minPct + l.maxPct)) / 200;
      const physical = (blast * l.physicalPct) / 100;
      add('phys', (physical * CROWD) / 2 / interval);
      add(el, ((blast - physical) * CROWD) / 2 / interval);
      break;
    }
    default:
      break;
  }
  return out;
}

/** The next few waves, as the monster mix the bot plays against. */
const LOOKAHEAD_WAVES = 3;
/**
 * Bosses count from further out: the schedule is fixed and the player sees what is coming,
 * so buying an answer to a boss's immunities ahead of time is ordinary play.
 */
const BOSS_LOOKAHEAD_WAVES = 5;

interface Foe {
  /** HP share of this monster across the coming waves. */
  weight: number;
  resist: Record<Element, number>;
}

/**
 * The coming waves' monsters with their resistances, weighted by total HP. Champions,
 * uniques and bosses count with their mods' resistances, so an immune special (Hell's Magic
 * and Poison Immunes) is a foe the bot has to cover like any other; a boss counts from
 * BOSS_LOOKAHEAD_WAVES out.
 */
function comingFoes(sim: Sim): Foe[] {
  const byKey = new Map<string, { hp: number; resist: Record<Element, number> }>();
  const rules = sim.data.rules;
  waveAt(sim, sim.state.wave + BOSS_LOOKAHEAD_WAVES - 1);
  for (let w = sim.state.wave; w < Math.min(sim.data.waves.length, sim.state.wave + BOSS_LOOKAHEAD_WAVES); w++) {
    const wave = sim.data.waves[w]!;
    for (const g of wave.groups) {
      if (g.rank !== 'boss' && w >= sim.state.wave + LOOKAHEAD_WAVES) continue;
      const d = sim.data.monsters[g.monster]!;
      const rankPct = g.rank === 'champion' ? rules.championHpPct : g.rank === 'unique' ? rules.uniqueHpPct : 0;
      const each = avg({ min: d.minHp, max: d.maxHp }) * (1 + rankPct / 100);
      const key = `${g.monster}:${g.mods.join(',')}`;
      const foe = byKey.get(key) ?? { hp: 0, resist: { ...d.resist } };
      if (!byKey.has(key)) for (const e of ELEMENTS) foe.resist[e] = withMods(rules, d.resist[e], e, g.mods, g.rank, d.difficulty);
      foe.hp += each * g.count;
      byKey.set(key, foe);
    }
  }
  const total = [...byKey.values()].reduce((n, f) => n + f.hp, 0) || 1;
  return [...byKey.values()].map((f) => ({ weight: f.hp / total, resist: f.resist }));
}

/** Average HP of the next wave's normal monsters, in 1/256 HP. */
function nextWaveHp(sim: Sim): number {
  // A boss wave has no regular monsters: the nearest wave before it that has some stands in,
  // or every option looks worthless for a wave and the bot spends what it was saving
  for (let w = sim.state.wave; w >= 0; w--) {
    const wave = waveAt(sim, w) ?? sim.data.waves.at(-1)!;
    let total = 0;
    let count = 0;
    for (const g of wave.groups) {
      if (g.rank !== 'normal') continue;
      const d = sim.data.monsters[g.monster]!;
      total += ((d.minHp + d.maxHp) / 2) * g.count;
      count += g.count;
    }
    if (count > 0) return total / count;
  }
  return 256;
}

interface Coverage {
  ranged: Map<string, number>;
  /** Path tiles in a melee skill's own reach (a 1.1 tile swing misses the diagonals): see meleeShare. */
  melee: (rangeUnits: number, key: string) => number;
  best: number;
}

/** The coverage maps on an empty ring: ranged at 4 tiles, and melee at each melee skill's reach, worked out as asked. */
function coverageOf(sim: Sim): Coverage {
  const empty = sim.state.towers.length === 0 ? sim : createSim(sim.data, 0);
  const ranged = rankSpots(empty, 40);
  const byReach = new Map<number, Map<string, number>>();
  const melee = (rangeUnits: number, key: string) => {
    let map = byReach.get(rangeUnits);
    if (!map) byReach.set(rangeUnits, (map = new Map(rankSpots(empty, Math.trunc(rangeUnits / 100)).map((p) => [`${p.x},${p.y}`, p.score]))));
    return map.get(key) ?? 0;
  };
  return { ranged: new Map(ranged.map((p) => [`${p.x},${p.y}`, p.score])), melee, best: ranged[0]?.score ?? 1 };
}

/** A source of monster effects: an aura, or a curse cast around the tower's reach. */
interface MonsterSource {
  tower: Tower;
  radiusUnits: number;
  slowPct: number;
  resistDown: Partial<Record<Element, number>>;
  /** Extra gold from kills in it (Find Item). */
  goldPct: number;
}

/**
 * What income is worth against damage: a gold aura covering a share of the attack is
 * valued as that share of attack times its gold percent times this: the gold buys that
 * much more power over the coming waves.
 */
const INCOME_WEIGHT = 1;

function monsterSources(sim: Sim, towers: Tower[]): MonsterSource[] {
  const out: MonsterSource[] = [];
  for (const t of towers) {
    for (const { aura } of auraSources(sim, t)) {
      if (aura.monsters) out.push({ tower: t, radiusUnits: aura.radiusUnits, slowPct: aura.monsters.slowPct, resistDown: aura.monsters.resistDown, goldPct: aura.monsters.goldPct ?? 0 });
    }
    const active = activeSkill(sim, t);
    const curse = (s: SkillDef | undefined, lvl: number) => {
      if (s?.archetype !== 'debuff' || s.mode !== 'curse') return;
      const l = s.levels[lvl]!;
      out.push({ tower: t, radiusUnits: s.rangeUnits + l.radiusUnits, slowPct: l.slowPct, resistDown: l.resistDown, goldPct: 0 });
    };
    if (active) curse(active.skill, active.lvl);
    if (t.evolved && t.partnerSkill) curse(sim.data.skills[t.partnerSkill], t.partnerLevel);
  }
  return out;
}

/**
 * Total power of a set of towers, auras and curses included. Attack towers count for the
 * share of path they cover.
 *
 * With `foes` (the class bots): against the coming monster mix, the time to kill is the
 * sum of each monster's HP over the damage that can hurt it, so a monster nothing can hurt
 * (an immunity no tower covers) drags the total to nothing and the bot is pushed to mix
 * elements exactly when Hell asks for it. Resistance cuts and slows count for the attack
 * they cover.
 *
 * Without (the Normal bots, whose targets were tuned on it): the classic estimate, the sum
 * of attack plus what monster auras add to the attack they cover, resistances ignored.
 */
function totalPower(sim: Sim, towers: Tower[], cov: Coverage, hpCap: number, foes: Foe[] | undefined, perTower?: Map<number, number>): number {
  const buffs = new Map<number, Map<string, Buff>>();
  const sources = towers.flatMap((t) => auraSources(sim, t).map((src) => ({ ...src, tower: t })));
  for (const { tower, skill, aura } of sources) {
    if (!aura.towers) continue;
    for (const t of towers) {
      if ((t.x - tower.x) ** 2 + (t.y - tower.y) ** 2 > aura.radiusUnits ** 2) continue;
      const per = buffs.get(t.id) ?? new Map<string, Buff>();
      // The same aura from two towers counts once, whatever +skills either carries
      const prev = per.get(baseSkillId(skill.id)) ?? { damagePct: 0, attackSpeedPct: 0, fire: 0 };
      per.set(baseSkillId(skill.id), {
        damagePct: Math.max(prev.damagePct, aura.towers.damagePct),
        attackSpeedPct: Math.max(prev.attackSpeedPct, aura.towers.attackSpeedPct),
        fire: Math.max(prev.fire, avg({ min: aura.towers.fireMin, max: aura.towers.fireMax })),
      });
      buffs.set(t.id, per);
    }
  }

  const attack = new Map<number, Parts>();
  // Corpse skills and Revive feed on kills made by everything else; kept apart to cap them
  const feeders = new Map<number, Parts>();
  // Static Field's pulses share one pool, every monster's HP above the difficulty's floor:
  // kept apart to cap them too, with the share of current HP each one takes
  const pulses = new Map<number, { parts: Parts; hpPct: number }>();
  for (const t of towers) {
    const buff: Buff = { damagePct: 0, attackSpeedPct: 0, fire: 0 };
    for (const b of buffs.get(t.id)?.values() ?? []) {
      buff.damagePct += b.damagePct;
      buff.attackSpeedPct += b.attackSpeedPct;
      buff.fire += b.fire;
    }
    const recipe = t.evolved ? sim.data.evolutions.find((e) => e.id === t.evolved) : undefined;
    const key = `${t.tileX},${t.tileY}`;
    const parts: Parts = {};
    const fed: Parts = {};
    const pulsed: Parts = {};
    let pulseHpPct = 0;
    const addSkill = (skill: SkillDef, lvl: number) => {
      const share = skill.archetype === 'melee' ? cov.melee(skill.rangeUnits, key) : (cov.ranged.get(key) ?? 0);
      const pulse = skill.archetype === 'debuff' && skill.mode === 'pulse';
      if (pulse) pulseHpPct = Math.max(pulseHpPct, skill.levels[lvl]?.hpPct ?? 0);
      const into = skill.archetype === 'corpse' || (skill.archetype === 'summon' && skill.kind === 'revive') ? fed : pulse ? pulsed : parts;
      for (const [e, v] of Object.entries(attackParts(sim, skill, lvl, recipe?.ignoreSkillDelay ?? false, buff, hpCap)) as [Element, number][]) {
        into[e] = (into[e] ?? 0) + (v * share) / cov.best;
      }
    };
    const active = bareSkill(sim, t);
    if (active) addSkill(active.skill, active.lvl);
    if (t.evolved && t.partnerSkill) addSkill(sim.data.skills[t.partnerSkill]!, t.partnerLevel);
    attack.set(t.id, parts);
    if (Object.keys(fed).length > 0) feeders.set(t.id, fed);
    if (Object.keys(pulsed).length > 0) pulses.set(t.id, { parts: pulsed, hpPct: pulseHpPct });
  }
  const sum = (p: Parts) => Object.values(p).reduce((n, v) => n + (v ?? 0), 0);
  // Each pulse takes its share of what the ones before it left, so the strongest counts in
  // full and each further one less (Static Field at 25%: the second 75%, the fourth 42%).
  // However many pulse, they take only the HP above the floor and the rest of the towers do
  // the rest: together the pulses do at most (100 - floor) / floor times what the others deal
  // (floor counted as at least PULSE_FLOOR_MIN_PCT, so Normal's zero floor is not unbounded)
  if (pulses.size > 0) {
    let left = 1;
    const ranked = [...pulses].sort((a, b) => sum(b[1].parts) - sum(a[1].parts));
    const stacked = ranked.map(([id, p]) => {
      const share = left;
      left *= 1 - p.hpPct / 100;
      return { id, parts: p.parts, share };
    });
    const pulseTotal = stacked.reduce((n, p) => n + sum(p.parts) * p.share, 0);
    const floor = Math.max(PULSE_FLOOR_MIN_PCT, sim.data.rules.staticFloorPct[sim.data.waves[sim.state.wave]?.difficulty ?? 0] ?? 0);
    const direct = [...attack.values()].reduce((n, p) => n + sum(p), 0);
    const cap = pulseTotal > 0 ? Math.min(1, (direct * (100 - floor)) / floor / pulseTotal) : 0;
    for (const { id, parts: pulsed, share } of stacked) {
      const parts = attack.get(id)!;
      for (const [e, v] of Object.entries(pulsed) as [Element, number][]) parts[e] = (parts[e] ?? 0) + v * share * cap;
    }
  }
  // A kill is about hpCap of damage and leaves one corpse, worth at most a blast on a crowd:
  // together the corpse eaters do no more than CROWD times what the rest of the towers kill
  const fedTotal = [...feeders.values()].reduce((n, p) => n + sum(p), 0);
  if (fedTotal > 0) {
    const killing = [...attack.values()].reduce((n, p) => n + sum(p), 0);
    const scale = Math.min(1, (killing * CROWD) / fedTotal);
    for (const [id, fed] of feeders) {
      const parts = attack.get(id)!;
      for (const [e, v] of Object.entries(fed) as [Element, number][]) parts[e] = (parts[e] ?? 0) + v * scale;
    }
  }
  const allAttack = [...attack.values()].reduce((n, p) => n + sum(p), 0);
  if (perTower) for (const [id, p] of attack) perTower.set(id, sum(p));

  if (!foes) {
    let total = allAttack;
    for (const { tower, aura } of sources) {
      if (!aura.monsters) continue;
      const covered = towers
        .filter((t) => (t.x - tower.x) ** 2 + (t.y - tower.y) ** 2 <= aura.radiusUnits ** 2)
        .reduce((n, t) => n + sum(attack.get(t.id) ?? {}), 0);
      const resist = Object.values(aura.monsters.resistDown).reduce((n, v) => n + (v ?? 0), 0) / 3;
      total += (covered * (aura.monsters.slowPct / 2 + resist / 2 + (aura.monsters.goldPct ?? 0) * INCOME_WEIGHT)) / 100;
    }
    return total;
  }
  if (allAttack === 0) return 0;

  // Monster effects. A resistance cut counts on the towers whose attack lands inside it, at
  // its full value: an aura or curse is worth the damage it unlocks on the towers in its
  // reach, above all against monsters they could not hurt without it (an immunity broken at
  // a fifth of the cut), and nothing for damage of its own. Before 0.3.14 the cut was spread
  // over the whole ring by the share of attack it covered, so a Conviction covering a third
  // of the attack counted as -50 everywhere instead of -150 where it is, and the bot rarely
  // saved for it. Slows and gold still count by the share they cover.
  const cutOf = new Map<number, Partial<Record<Element, number>>>();
  let slowBonus = 0;
  let incomeBonus = 0;
  for (const src of monsterSources(sim, towers)) {
    const inside = towers.filter((t) => (t.x - src.tower.x) ** 2 + (t.y - src.tower.y) ** 2 <= src.radiusUnits ** 2);
    const share = inside.reduce((n, t) => n + sum(attack.get(t.id) ?? {}), 0) / allAttack;
    for (const t of inside) {
      const c = cutOf.get(t.id) ?? {};
      for (const [e, v] of Object.entries(src.resistDown) as [Element, number][]) c[e] = Math.max(c[e] ?? 0, v);
      cutOf.set(t.id, c);
    }
    slowBonus += (src.slowPct / 2 / 100) * share;
    incomeBonus = Math.max(incomeBonus, ((src.goldPct * INCOME_WEIGHT) / 100) * share);
  }

  // Attack by element, pooled by the cuts it lands under
  const groups = new Map<string, { cut: Partial<Record<Element, number>>; parts: Parts }>();
  for (const [id, p] of attack) {
    const cut = cutOf.get(id) ?? {};
    const key = ELEMENTS.map((e) => cut[e] ?? 0).join(',');
    const g = groups.get(key) ?? { cut, parts: {} };
    for (const [e, v] of Object.entries(p) as [Element, number][]) g.parts[e] = (g.parts[e] ?? 0) + v;
    groups.set(key, g);
  }
  let time = 0;
  for (const foe of foes) {
    let power = 0;
    for (const { cut, parts } of groups.values()) {
      for (const [e, v] of Object.entries(parts) as [Element, number][]) {
        const base = foe.resist[e];
        const down = cut[e] ?? 0;
        const resist = Math.max(-100, base >= 100 ? base - down / 5 : base - down);
        if (resist < 100) power += (v * (100 - resist)) / 100;
      }
    }
    time += foe.weight / Math.max(power, 1e-9);
  }
  const total = foes.length === 0 ? allAttack : 1 / time;
  return total * (1 + slowBonus) * (1 + incomeBonus);
}

// ---- options ----

interface Option {
  /** Total gold the option needs, used to rank it. */
  cost: number;
  /** Gold the first command needs now; defaults to cost. */
  stepCost?: number;
  gain: number;
  commands: Command[];
  /** Buys damage (anything but an aura or a debuff): what a bot in trouble spends on. */
  damage: boolean;
  /** The option ends with this tower at tier 3 on these picks: chosen, the bot saves for it (see decide). */
  toTop?: { towerId: number; picks: string[] };
}

/** True for a skill that kills by itself rather than helping others. */
const isDamage = (skill: SkillDef | undefined) => !!skill && skill.archetype !== 'buffAura' && skill.archetype !== 'debuff';

/** Share of the ring's alive limit past which a bot stops saving and buys the best damage it can afford now. */
const PANIC_PCT = 60;

interface Judge {
  cov: Coverage;
  hpCap: number;
  foes: Foe[] | undefined;
  before: number;
  /** Set while the bot's bossKill towers would not kill the coming boss within its wave. */
  boss?: LoneBoss;
}

/** The coming boss: its HP as it spawns, its resistances, and the bot's skills that count against it. */
interface LoneBoss {
  hp: number;
  resist: Record<Element, number>;
  skills: string[];
  /** What the bot's towers deal it over a wave now. */
  before: number;
}

/**
 * Damage per tick a skill deals one lone target: its estimate against a crowd, one hit an
 * attack (a Bone Spear pierces a boss once, a volley lands one missile).
 */
function loneParts(sim: Sim, skill: SkillDef, lvl: number, ignoreDelay: boolean): Parts {
  const parts = attackParts(sim, skill, lvl, ignoreDelay, { damagePct: 0, attackSpeedPct: 0, fire: 0 }, Infinity);
  const l = skill.levels[lvl] as { hops?: number; count?: number } | undefined;
  const hits = skill.archetype === 'pierce' ? (skill.mode === 'chain' ? (l?.hops ?? 0) + 1 : 2) : skill.archetype === 'projectile' ? Math.max(1, Math.min(l?.count ?? 1, CROWD)) : 1;
  const out: Parts = {};
  for (const [e, v] of Object.entries(parts) as [Element, number][]) out[e] = v / hits;
  return out;
}

/**
 * What a set of towers' bossKill skills deal the coming boss over one wave, in 1/256 HP: each
 * tower's lone-target damage through the boss's resistances, for the share of a lap it is in
 * range (the path tiles it covers over the ring's), for the wave's length. Auras and curses
 * are left out, so it errs toward more than enough.
 */
function bossDamage(sim: Sim, towers: Tower[], cov: Coverage, boss: Omit<LoneBoss, 'before'>): number {
  const ringTiles = sim.map.pathTiles.filter(Boolean).length || 1;
  let total = 0;
  for (const t of towers) {
    const recipe = t.evolved ? sim.data.evolutions.find((e) => e.id === t.evolved) : undefined;
    const share = (cov.ranged.get(`${t.tileX},${t.tileY}`) ?? 0) / ringTiles;
    const count = (skill: SkillDef | undefined, lvl: number) => {
      if (!skill || !boss.skills.includes(baseSkillId(skill.id))) return;
      for (const [e, v] of Object.entries(loneParts(sim, skill, lvl, recipe?.ignoreSkillDelay ?? false)) as [Element, number][]) {
        if (boss.resist[e] < 100) total += (v * (100 - boss.resist[e]) * share * sim.data.economy.waveTicks) / 100;
      }
    };
    const active = bareSkill(sim, t);
    if (active) count(active.skill, active.lvl);
    if (t.evolved && t.partnerSkill) count(sim.data.skills[t.partnerSkill], t.partnerLevel);
  }
  return total;
}

/**
 * A boss the bot's bossKill towers would not kill within a wave: one already lapping the ring
 * (its HP now), else the next within BOSS_LOOKAHEAD_WAVES. A lapping boss counts first: the
 * lookahead alone let Normal Baal walk past once and then never counted again, and the NECRO
 * bot carried him and the next four act bosses round the ring until they filled it (0.3.14,
 * Nightmare Diablo's wave with no Bone Spear built).
 */
function lonelyBoss(sim: Sim, config: BotConfig, towers: Tower[], cov: Coverage): LoneBoss | undefined {
  if (!config.bossKill) return undefined;
  const rules = sim.data.rules;
  const reachable = (resist: Record<Element, number>) => config.bossKill!.some((id) => resist[sim.data.skills[id]!.damageType as Element] < 100);
  let lapping: LoneBoss | undefined;
  for (const m of sim.state.monsters) {
    if (m.rank !== 'boss' || m.hp <= 0 || m.walked < sim.map.length) continue;
    const d = sim.data.monsters[m.def]!;
    const resist = { ...d.resist };
    for (const e of ELEMENTS) resist[e] = withMods(rules, d.resist[e], e, m.mods, m.rank, d.difficulty);
    if (!reachable(resist) || (lapping && lapping.hp >= m.hp)) continue;
    const boss = { hp: m.hp, resist, skills: config.bossKill };
    const before = bossDamage(sim, towers, cov, boss);
    if (before < m.hp) lapping = { ...boss, before };
  }
  if (lapping) return lapping;
  for (let w = sim.state.wave; w < sim.state.wave + BOSS_LOOKAHEAD_WAVES; w++) {
    const wave = waveAt(sim, w);
    const group = wave?.groups.find((g) => g.rank === 'boss');
    if (!wave || !group) continue;
    const d = sim.data.monsters[group.monster]!;
    const resist = { ...d.resist };
    for (const e of ELEMENTS) resist[e] = withMods(rules, d.resist[e], e, group.mods, group.rank, d.difficulty);
    // Nothing of the line could ever hurt it: no reason to build for it
    if (!reachable(resist)) return undefined;
    const hp = waveTotalHp({ ...wave, groups: [group] }, w, rules, sim.data.monsters);
    const boss = { hp, resist, skills: config.bossKill };
    const before = bossDamage(sim, towers, cov, boss);
    return before < hp ? { ...boss, before } : undefined;
  }
  return undefined;
}

/** The auras a tower projects, by base skill (its own skill, an evolved tower's partner). */
function aurasOf(sim: Sim, t: Tower): string[] {
  return auraSources(sim, t).map((s) => baseSkillId(s.skill.id));
}

/**
 * Gain from replacing (or adding) one tower, and removing others. A tower bringing an aura
 * another tower already projects is worth nothing: the same aura never counts twice.
 */
function gainOf(sim: Sim, towers: Tower[], judge: Judge, changed: Tower, removed: number[] = []): number {
  const after = towers.filter((t) => t.id !== changed.id && !removed.includes(t.id));
  const mine = aurasOf(sim, changed);
  if (mine.length > 0 && after.some((t) => aurasOf(sim, t).some((a) => mine.includes(a)))) return 0;
  after.push(changed);
  const gain = totalPower(sim, after, judge.cov, judge.hpCap, judge.foes) - judge.before;
  if (!judge.boss) return gain;
  // A boss that would outlive its wave: a tower may not branch away from the boss skills its
  // line offers, and the damage it adds on the boss counts on top, per tick like the rest
  const was = towers.find((t) => t.id === changed.id);
  const tiers = sim.data.classes[changed.cls]?.lines[changed.line]?.tiers ?? [];
  const away = changed.picks.some((p, i) => i >= (was?.picks.length ?? 1) && !judge.boss!.skills.includes(p) && (tiers[i] ?? []).some((o) => judge.boss!.skills.includes(o)));
  if (away) return 0;
  return gain + (bossDamage(sim, after, judge.cov, judge.boss) - judge.boss.before) / sim.data.economy.waveTicks;
}

/**
 * A new tower valued against a lone boss: as the first tier of its line with a bossKill skill
 * (a Teeth tower as the Bone Spear it becomes), undefined when its line has none.
 */
function bossAim(sim: Sim, boss: LoneBoss, fresh: Tower): Tower | undefined {
  const tiers = sim.data.classes[fresh.cls]?.lines[fresh.line]?.tiers ?? [];
  const k = tiers.findIndex((opts) => opts.some((o) => boss.skills.includes(o)));
  if (k <= 0) return undefined;
  const picks = tiers.slice(0, k + 1).map((opts, i) => (i === k ? opts.find((o) => boss.skills.includes(o))! : i === 0 ? fresh.picks[0]! : opts[0]!));
  return { ...fresh, tier: k + 1, level: 1, picks };
}

interface BotConfig {
  strategy: Strategy;
  /** T1 skills the bot may build. */
  builds: string[];
  tiers: boolean;
  /** Weigh evolving any pair on the ring that makes a recipe, and plan toward recipes. */
  evolve?: boolean;
  /** Judge power against the coming monsters' resistances (see totalPower). */
  elements?: boolean;
  /** Stop building new towers here and only improve the ones there are. */
  maxTowers?: number;
  /**
   * Single-target skills the bot keeps enough of to kill a lone boss within its wave: while
   * the next boss (BOSS_LOOKAHEAD_WAVES out) would outlive its wave, no tower branches away
   * from them and what they add on the boss counts on top (see bossDamage). The
   * Necromancer's Bone Spear line.
   */
  bossKill?: string[];
  opening?: (ctx: OpeningContext) => Goal[];
}

/** A payoff several purchases away is worth less than one now, and needs a defence first. */
const LOOKAHEAD_DISCOUNT_PCT = 50;
const LOOKAHEAD_MIN_TOWERS = 3;
/** Two tiers ahead (T1 to T3): further off, so worth less again. */
const FAR_LOOKAHEAD_PCT = 40;
/** An evolution whose remaining gold is within this many waves of the bot's income so far... */
const EVOLVE_SOON_WAVES = 3;
/** ...is weighed at this share of its gain, as a near purchase rather than a far one. */
const EVOLVE_SOON_PCT = 75;
/** A bot saves only for a purchase whose next payment is within this many waves of its recent income... */
const SAVE_WAVES = 3;
/** ...or this many for an evolution's fee, the big purchase a few high towers are built toward. */
const EVOLVE_SAVE_WAVES = 8;
/** Recent income: what the last this-many waves brought in, per wave. */
const INCOME_WAVES = 3;
/** An evolution ready to buy becomes the goal when its gain per gold is at least this share of the best option's. */
const EVOLVE_PRIORITY = 0.5;
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

function options(sim: Sim, config: BotConfig, ranged: Spot[], melee: Spot[], cov: Coverage): Option[] {
  const towers = sim.state.towers;
  const hpCap = nextWaveHp(sim);
  const foes = config.elements ? comingFoes(sim) : undefined;
  const judge: Judge = { cov, hpCap, foes, before: totalPower(sim, towers, cov, hpCap, foes), boss: lonelyBoss(sim, config, towers, cov) };
  const out: Option[] = [];
  const e = sim.data.economy;

  // New towers: each allowed T1 skill on its best free tile. Auras go where they cover
  // the most towers, which the gain itself measures, so try the top few tiles.
  for (const skill of towers.length < (config.maxTowers ?? Infinity) ? config.builds : []) {
    const archetype = sim.data.skills[skill]!.archetype;
    const list = archetype === 'melee' ? melee : ranged;
    const def = sim.data.skills[skill]!;
    const aura = archetype === 'buffAura' || (def.archetype === 'debuff' && def.mode === 'aura');
    const candidates = list.filter((p) => canBuild(sim, p.x, p.y)).slice(0, aura ? 16 : 1);
    const { cls, line } = lineOf(sim, skill);
    for (const spot of candidates) {
      const c = tileCenter(spot);
      const fresh: Tower = {
        id: -1, owner: 0, cls, tileX: spot.x, tileY: spot.y, x: c.x, y: c.y, line, tier: 1, level: 1,
        picks: [skill], spent: 0, cooldown: 0, targeting: 'first', evolved: '', partnerSkill: '', partnerLevel: 0, summonCooldown: 0, partnerCooldown: 0,
      };
      // Against a lone boss a new tower is worth what its line's boss skill will deal, a few buys off
      const aim = judge.boss && bossAim(sim, judge.boss, fresh);
      out.push({
        cost: buildCostFor(sim, 0),
        gain: aim ? (gainOf(sim, towers, judge, aim) * LOOKAHEAD_DISCOUNT_PCT) / 100 : gainOf(sim, towers, judge, fresh),
        commands: [{ type: 'build', x: spot.x, y: spot.y, cls, skill }],
        damage: isDamage(sim.data.skills[skill]),
      });
    }
  }

  // Evolutions: any pair on the ring that makes a recipe (no adjacency since 0.3.8), judged as
  // the evolved tower: the recipe's damage and its reach step, on the attack tower's tile
  if (config.evolve) {
    for (let i = 0; i < towers.length; i++) {
      for (let j = i + 1; j < towers.length; j++) {
        const match = evolutionFor(sim, towers[i]!, towers[j]!);
        if (!match) continue;
        const { recipe, attack, partner } = match;
        const partnerLevel = partner.picks[partner.tier - 1] === recipe.partner.skill ? Math.min(partner.level, MAX_TOWER_LEVEL) - 1 : EVOLVED_LEVEL_INDEX;
        const merged: Tower = { ...attack, tier: MAX_TIER + 1, level: MAX_TOWER_LEVEL, evolved: recipe.id, partnerSkill: recipe.partner.skill, partnerLevel };
        out.push({
          cost: e.evolveCost,
          gain: gainOf(sim, towers, judge, merged, [partner.id]),
          commands: [{ type: 'evolve', towerA: attack.id, towerB: partner.id }],
          damage: true,
        });
      }
    }
  }

  // Evolutions further off: a pair whose lines can still make a recipe is worth the evolved
  // tower over all the gold left to get there, at EVOLVE_SOON_PCT when that gold is within a
  // few waves of income and FAR_LOOKAHEAD_PCT when not; the step bought is the one on the
  // tower further behind. And a new tower of the missing line, on the best free spot.
  if (config.evolve && towers.length >= LOOKAHEAD_MIN_TOWERS) {
    const gold = sim.state.gold[0] ?? 0;
    const perWave = (gold + towers.reduce((n, t) => n + t.spent, 0)) / Math.max(1, sim.state.wave);
    const planned = (attack: Tower, partner: Tower, recipe: (typeof sim.data.evolutions)[number], extra: number, commandsIfNoStep?: Command[]): Option | undefined => {
      const pa = pathTo(sim, attack, recipe.attack.skill, recipe.attack.minTier);
      const pp = pathTo(sim, partner, recipe.partner.skill, recipe.partner.minTier);
      if (!pa || !pp || (pa.gold === 0 && pp.gold === 0 && !commandsIfNoStep)) return undefined;
      const behind = pa.gold >= pp.gold ? pa : pp;
      const commands = commandsIfNoStep ?? behind.step?.commands;
      const stepCost = commandsIfNoStep ? extra : behind.step?.cost;
      if (!commands || stepCost === undefined) return undefined;
      const merged: Tower = {
        ...attack, tier: MAX_TIER + 1, level: MAX_TOWER_LEVEL, evolved: recipe.id, partnerSkill: recipe.partner.skill,
        partnerLevel: EVOLVED_LEVEL_INDEX, picks: [...attack.picks],
      };
      const cost = extra + pa.gold + pp.gold + e.evolveCost;
      const soon = cost - gold <= EVOLVE_SOON_WAVES * perWave;
      const gain = (gainOf(sim, towers, judge, merged, [partner.id]) * (soon ? EVOLVE_SOON_PCT : FAR_LOOKAHEAD_PCT)) / 100;
      return { cost, stepCost, gain, commands, damage: true };
    };
    const lineIs = (t: Tower, at: { cls: string; line: string }) => !t.evolved && t.legendOf === undefined && t.cls === at.cls && t.line === at.line;
    for (const recipe of sim.data.evolutions) {
      const atA = placeOf(sim, recipe.attack.skill);
      const atP = placeOf(sim, recipe.partner.skill);
      if (!atA || !atP) continue;
      const attacks = towers.filter((t) => lineIs(t, atA));
      const partners = towers.filter((t) => lineIs(t, atP));
      // Pairs anywhere on the ring
      for (const t of attacks) {
        for (const u of partners) {
          if (u === t) continue;
          const o = planned(t, u, recipe, 0);
          if (o) out.push(o);
        }
      }
      // One side standing, the other line not yet built: a new tower of it on the best free spot
      for (const [have, missing, role] of [[attacks, atP, 'attack'], [partners, atA, 'partner']] as const) {
        if (have.length === 0 || (role === 'attack' ? partners : attacks).length > 0) continue;
        const t1 = sim.data.classes[missing.cls]!.lines[missing.line]!.tiers[0]![0]!;
        if (!config.builds.includes(t1) || towers.length >= (config.maxTowers ?? Infinity)) continue;
        const list = sim.data.skills[t1]!.archetype === 'melee' ? melee : ranged;
        const spot = list.find((p) => canBuild(sim, p.x, p.y));
        if (!spot) continue;
        const c = tileCenter(spot);
        const fresh: Tower = {
          id: -2, owner: 0, cls: missing.cls, tileX: spot.x, tileY: spot.y, x: c.x, y: c.y, line: missing.line, tier: 1, level: 1,
          picks: [t1], spent: 0, cooldown: 0, targeting: 'first', evolved: '', partnerSkill: '', partnerLevel: 0, summonCooldown: 0, partnerCooldown: 0,
        };
        const build: Command[] = [{ type: 'build', x: spot.x, y: spot.y, cls: missing.cls, skill: t1 }];
        for (const t of have) {
          const o = role === 'attack' ? planned(t, fresh, recipe, buildCostFor(sim, 0), build) : planned(fresh, t, recipe, buildCostFor(sim, 0), build);
          if (o) out.push(o);
        }
      }
    }
  }

  for (const t of towers) {
    const level = upgradeCost(sim, t);
    if (level !== undefined) {
      out.push({ cost: level, gain: gainOf(sim, towers, judge, { ...t, level: t.level + 1 }), commands: [{ type: 'upgrade', towerId: t.id }], damage: isDamage(activeSkill(sim, t)?.skill) });
    }
    // Toward the next tier: the remaining levels plus the tier, valued by what the next
    // tier's skill gives. Levels 3 to 5 can look worthless on their own (overkill), so
    // without this lookahead a bot never reaches the tier they unlock.
    if (t.evolved) continue;
    const line = sim.data.classes[t.cls]?.lines[t.line];
    const tierPrice = sim.data.economy.tierCosts[t.tier - 1];
    const established = towers.length >= LOOKAHEAD_MIN_TOWERS;
    if (config.tiers && established && line && tierPrice !== undefined && t.tier < line.tiers.length && t.picks.length >= t.tier) {
      let remaining = tierPrice;
      for (let lv = t.level; lv < MAX_TOWER_LEVEL; lv++) remaining += e.levelCosts[t.tier - 1]![lv - 1]!;
      const opts = line.tiers[t.tier] ?? [];
      for (const skill of opts) {
        const next = { ...t, tier: t.tier + 1, level: 1, picks: [...t.picks, skill] };
        const commands: Command[] =
          t.level < MAX_TOWER_LEVEL ? [{ type: 'upgrade', towerId: t.id }] : [{ type: 'upgradeTier', towerId: t.id }];
        if (t.level >= MAX_TOWER_LEVEL && opts.length > 1) commands.push({ type: 'pickBranch', towerId: t.id, skill });
        // Pay only for the next step now; the option is judged on the whole path, and a tier
        // bought now is a purchase, not a payoff several purchases away: it counts in full.
        // At half, a Fanaticism tier the next buy away lost to Blessed Hammer levels every
        // time and the PALADIN bot never reached tier 3 (0.3.13)
        const now = t.level >= MAX_TOWER_LEVEL;
        const stepCost = now ? tierPrice : level!;
        const damage = isDamage(sim.data.skills[skill]);
        const toTop = next.tier === MAX_TIER ? { towerId: t.id, picks: next.picks } : undefined;
        out.push({ cost: remaining, stepCost, gain: (gainOf(sim, towers, judge, next) * (now ? 100 : LOOKAHEAD_DISCOUNT_PCT)) / 100, commands, damage, toTop });
        // And the tier after it: the power sits in the top tier, and the tier between can
        // look no better than another tower, so a bot judging one tier ahead never climbs
        const after = line.tiers[t.tier + 1];
        const afterPrice = e.tierCosts[t.tier];
        if (!after || afterPrice === undefined) continue;
        const through = remaining + sum(e.levelCosts[t.tier]!) + afterPrice;
        for (const top of after) {
          const far = { ...t, tier: t.tier + 2, level: 1, picks: [...t.picks, skill, top] };
          const toTop = far.tier === MAX_TIER ? { towerId: t.id, picks: far.picks } : undefined;
          out.push({ cost: through, stepCost, gain: (gainOf(sim, towers, judge, far) * FAR_LOOKAHEAD_PCT) / 100, commands, damage, toTop });
        }
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
  const cov = coverageOf(sim);
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
    return cost !== undefined && (s.state.gold[0] ?? 0) >= cost ? [{ type: 'upgrade', towerId: t.id }] : [];
  };
  const tierUp = (s: Sim, t: Tower, skill: (options: string[]) => string): Command[] => {
    const cost = tierCost(s, t);
    if (cost === undefined || (s.state.gold[0] ?? 0) < cost) return [];
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
        if (!canBuild(s, spot.x, spot.y) || (s.state.gold[0] ?? 0) < buildCostFor(s, 0)) return [];
        tags[goal.tag] = s.state.nextId;
        return [{ type: 'build', x: spot.x, y: spot.y, cls: lineOf(s, goal.skill).cls, skill: goal.skill }];
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
      // A bot held to T3 (BOT_NO_EVOLVE) skips its opening's evolution too
      if (!a || !b || !match || !config.evolve) {
        goals.shift();
        continue;
      }
      // Not yet affordable: the engine plays on, and this fires once the gold is there
      if ((s.state.gold[0] ?? 0) < s.data.economy.evolveCost) return undefined;
      evolvedOn[match.recipe.id] = s.state.wave;
      goals.shift();
      return [{ type: 'evolve', towerA: a.id, towerB: b.id }];
    }
    return undefined;
  }

  // The best option depends only on the wave (the coming monsters) and the
  // towers, not on gold or the monsters out, so it is worked out again only when one changes
  let cached: { key: string; best: Option | undefined; all: Option[] } | undefined;
  // Gold earned by each wave's start (in hand and spent), for the income of the last few waves
  const earnedAt = new Map<number, number>();
  const recentIncome = (s: Sim): number => {
    const earned = (s.state.gold[0] ?? 0) + s.state.towers.reduce((n, t) => n + t.spent, 0);
    if (!earnedAt.has(s.state.wave)) earnedAt.set(s.state.wave, earned);
    const back = Math.max(0, s.state.wave - INCOME_WAVES);
    const then = earnedAt.get(back) ?? 0;
    return Math.max(1, (earned - then) / Math.max(1, s.state.wave - back));
  };
  // A tier 3 the bot has chosen to save for, and the picks that get it there: until it has the
  // gold for each step it buys nothing but emergency damage. Without it a stream of cheaper
  // levels, each the best buy per gold for a moment, spent the savings before the 10,000 for
  // the tier gathered (the PALADIN bot with Nightmare loot, twice in one run, 0.3.13)
  let goal: { towerId: number; picks: string[] } | undefined;
  /** The next command toward the goal and its price; undefined once it is met or cannot be. */
  const goalStep = (s: Sim): { commands: Command[]; cost: number } | undefined => {
    const t = s.state.towers.find((x) => x.id === goal!.towerId);
    if (!t || t.evolved || t.legendOf !== undefined || t.picks.some((p, i) => p !== goal!.picks[i])) return undefined;
    if (t.picks.length < t.tier) return { commands: [{ type: 'pickBranch', towerId: t.id, skill: goal!.picks[t.tier - 1]! }], cost: 0 };
    if (t.tier >= MAX_TIER) return undefined;
    if (t.level < MAX_TOWER_LEVEL) {
      const cost = upgradeCost(s, t);
      return cost === undefined ? undefined : { commands: [{ type: 'upgrade', towerId: t.id }], cost };
    }
    const cost = tierCost(s, t);
    if (cost === undefined) return undefined;
    const commands: Command[] = [{ type: 'upgradeTier', towerId: t.id }];
    if ((s.data.classes[t.cls]!.lines[t.line]!.tiers[t.tier] ?? []).length > 1) commands.push({ type: 'pickBranch', towerId: t.id, skill: goal!.picks[t.tier]! });
    return { commands, cost };
  };
  const keyOf = (s: Sim) =>
    `${s.state.wave}|${s.state.towers.map((t) => `${t.id}:${t.tileX},${t.tileY}:${t.tier}.${t.level}:${t.picks.join('+')}:${t.evolved}:${t.partnerSkill}.${t.partnerLevel}`).join(';')}`;

  return {
    strategy: config.strategy,
    evolvedOn,
    decide(s) {
      const out = callWaveIfClear(s);
      if (s.state.tick % DECISION_TICKS !== 0) return out;
      const opening = advance(s);
      if (opening) return [...opening, ...out];

      // Best power per gold; save up for it rather than buying something worse now
      const key = keyOf(s);
      if (cached?.key !== key) {
        let pick: Option | undefined;
        const all = options(s, config, ranged, melee, cov);
        // Save only for what a few waves of income can pay: a goal further off starves the defence
        const gold = s.state.gold[0] ?? 0;
        const perWave = recentIncome(s);
        // Until the ring has a defence (LOOKAHEAD_MIN_TOWERS towers), the next tower comes first
        // and is always worth saving for: on a seed whose first waves paid little, a second tower
        // looked out of reach on wave 2's income, the bot sank its gold into its one tower's
        // levels, and that tower alone stopped killing in Act 2 (MIXED3 seed 5 with no items died
        // on wave 10 with two towers, 0.3.13)
        const founding = s.state.towers.length < LOOKAHEAD_MIN_TOWERS && all.some((o) => o.gain > 0 && o.commands[0]?.type === 'build');
        const reachable = (o: Option) =>
          founding ? o.commands[0]?.type === 'build' : (o.stepCost ?? o.cost) - gold <= (o.commands[0]?.type === 'evolve' ? EVOLVE_SAVE_WAVES : SAVE_WAVES) * perWave;
        for (const o of all) {
          if (o.gain <= 0 || !reachable(o)) continue;
          if (!pick || o.gain / o.cost > pick.gain / pick.cost) pick = o;
        }
        // An evolution ready to buy is saved for when it is worth a fair share of the best buy
        // per gold: a stream of cheap levels would otherwise always come first, and the gold for
        // the fee never gather
        let evolve: Option | undefined;
        for (const o of all) {
          if (o.gain <= 0 || o.commands[0]?.type !== 'evolve') continue;
          if (!evolve || o.gain / o.cost > evolve.gain / evolve.cost) evolve = o;
        }
        // ...and the fee is within a few waves of income
        if (pick && evolve && reachable(evolve) && evolve.gain / evolve.cost >= (pick.gain / pick.cost) * EVOLVE_PRIORITY) pick = evolve;
        if (process.env['BOT_DEBUG']) console.error(`w${s.state.wave} gold ${s.state.gold[0]} pick ${pick?.commands[0]?.type} ${Math.round(((pick?.gain ?? 0) / (pick?.cost ?? 1)) * 1e6)} cost ${pick?.cost} ${JSON.stringify(pick?.commands[0])} | evolve ${evolve ? Math.round((evolve.gain / evolve.cost) * 1e6) : '-'}`);
        cached = { key, best: pick, all };
      }
      const gold = s.state.gold[0] ?? 0;
      const best = cached.best;
      // The ring is filling: no more saving, the best damage affordable now. (Buying the
      // cheapest thing when the model rates nothing was tried and made every bot worse.)
      const emergency = (): Command[] => {
        if (s.state.alive * 100 < aliveLimitOf(s) * PANIC_PCT) return [];
        let now: Option | undefined;
        for (const o of cached!.all) {
          if (o.gain <= 0 || !o.damage || gold < (o.stepCost ?? o.cost)) continue;
          if (!now || o.gain / o.cost > now.gain / now.cost) now = o;
        }
        return now?.commands ?? [];
      };
      if (!goal && best?.toTop && !process.env['BOT_NO_GOAL']) goal = best.toTop;
      if (goal) {
        const next = goalStep(s);
        if (next) return [...(gold >= next.cost ? next.commands : emergency()), ...out];
        goal = undefined;
      }
      if (best && gold >= (best.stepCost ?? best.cost)) return [...best.commands, ...out];
      return [...emergency(), ...out];
    },
  };
}

const CONFIGS: Partial<Record<Strategy, BotConfig>> = {
  BOLT: { strategy: 'BOLT', builds: ['holy-bolt'], tiers: false },
  HOLY: { strategy: 'HOLY', builds: ['holy-bolt'], tiers: true },
  TWOLINE: { strategy: 'TWOLINE', builds: ['holy-bolt', 'might'], tiers: true, evolve: true },
  PALADIN: {
    strategy: 'PALADIN',
    builds: ['sacrifice', 'holy-bolt', 'might'],
    tiers: true,
    evolve: true,
    // A Holy tower and a Might beside it, both to T2 (Blessed Hammer, Concentration),
    // evolved into a Hammerdin once the evolution is affordable from banked gold; one Zealot
    // on the path to hold the early waves. The bot never hoards for the evolution: until it
    // can pay, the engine spends as usual, so the price paces it like any other purchase.
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

const SORC_BUILDS = ['fire-bolt', 'ice-bolt', 'charged-bolt', 'static-field'];
const NECRO_BUILDS = ['raise-skeleton', 'teeth', 'amplify-damage'];
CONFIGS.SORC = { strategy: 'SORC', builds: SORC_BUILDS, tiers: true, evolve: true, elements: true };
// The Necromancer bot builds the bone and curse lines: its power model overrates the summoning
// line's skeletons, which build a ring that cannot hold Normal Act 5 (wave 23 with them, 108
// without; 0.3.8). BOT_BUILDS=a,b overrides any bot's T1 list for a run.
// It keeps enough of the Bone Spear line to kill a lone boss within its wave: Corpse Explosion
// needs kills, and a boss alone leaves none (Normal Baal and Nightmare Andariel lapped it to death)
CONFIGS.NECRO = { strategy: 'NECRO', builds: ['teeth', 'amplify-damage'], tiers: true, evolve: true, elements: true, bossKill: ['bone-spear', 'bone-spirit'] };
CONFIGS.AMAZON = { strategy: 'AMAZON', builds: ['magic-arrow', 'poison-javelin', 'critical-strike'], tiers: true, evolve: true, elements: true };
CONFIGS.BARB = {
  strategy: 'BARB',
  builds: ['bash', 'double-swing', 'battle-cry', 'find-item'],
  tiers: true,
  evolve: true,
  elements: true,
};
CONFIGS.DRUID = { strategy: 'DRUID', builds: ['firestorm', 'arctic-blast', 'raven'], tiers: true, evolve: true, elements: true };
CONFIGS.ASSASSIN = { strategy: 'ASSASSIN', builds: ['fire-blast', 'tiger-strike', 'cloak-of-shadows'], tiers: true, evolve: true, elements: true };
CONFIGS.MIXED3 = {
  strategy: 'MIXED3',
  builds: ['sacrifice', 'holy-bolt', 'might', ...SORC_BUILDS, ...NECRO_BUILDS],
  tiers: true,
  evolve: true,
  elements: true,
};

/**
 * LOOTBUILD builds around the loot it is handed (tools/outfit.ts lootBuilds): the attack lines
 * strongest in that gear and the aura that lifts them most; with no loot it plays MIXED3.
 */
export function createBot(strategy: Strategy, sim: Sim, pool?: readonly Item[]): Bot {
  if (strategy === 'LOOTBUILD') {
    const builds = pool && pool.length > 0 ? lootBuilds(sim, pool) : [];
    return engineBot({ ...CONFIGS.MIXED3!, strategy, ...(builds.length > 0 ? { builds } : {}) }, sim);
  }
  // BOT_MAX_TOWERS=n holds a bot to n towers: a few high towers against the bot's own choice
  // BOT_NO_EVOLVE holds a bot to T3 (it never evolves), the same bot otherwise
  // BOT_NO_GOAL lets a bot spend while it saves for a tier 3 (see decide), as before 0.3.14
  const cap = Number(process.env['BOT_MAX_TOWERS'] ?? 0);
  const builds = process.env['BOT_BUILDS']?.split(',');
  const noEvolve = !!process.env['BOT_NO_EVOLVE'];
  return engineBot({ ...CONFIGS[strategy]!, ...(cap > 0 ? { maxTowers: cap } : {}), ...(builds ? { builds } : {}), ...(noEvolve ? { evolve: false } : {}) }, sim);
}

/** Debug view: a bot's options right now, best power per gold first. */
export function explainOptions(sim: Sim, strategy: Strategy): { gainPerGold: number; cost: number; commands: Command[] }[] {
  const ranged = rankSpots(sim, 40);
  const melee = rankSpots(sim, 15);
  // Coverage needs the empty-map ranking, worked out the same way the bot does at start
  return options(sim, CONFIGS[strategy]!, ranged, melee, coverageOf(sim))
    .map((o) => ({ gainPerGold: o.gain / o.cost, cost: o.cost, commands: o.commands }))
    .sort((a, b) => b.gainPerGold - a.gainPerGold);
}

/** Debug view: each tower's attack as the bot's power model has it, before resistances and curses. */
export function explainPower(sim: Sim): Map<number, number> {
  const out = new Map<number, number>();
  totalPower(sim, sim.state.towers, coverageOf(sim), nextWaveHp(sim), undefined, out);
  return out;
}

export interface RunResult {
  strategy: Strategy;
  seed: number;
  won: boolean;
  /** Last wave called; the wave that ended the run on a loss. */
  wave: number;
  /** The most weight alive on the ring at any tick. */
  peakAlive: number;
  gold: number;
  towers: number;
  /** Sum of tower progress: (tier - 1) * 5 + level. */
  levels: number;
  /** Highest tier any tower reached; 4 means evolved. */
  topTier: number;
  /** The wave on which the first tower of each tier (2, 3, and 4 for an evolution) appeared. */
  tiersOn: Record<number, number>;
  /** Wave on which each evolution recipe was first bought, by recipe id. */
  evolvedOn: Record<string, number>;
  /** Every command the bot sent, stamped with its tick: a replayable log. */
  log: TimedCommand[];
  /** Per-wave margins, index 0 is wave 1, for the waves that finished. */
  margins: WaveMargin[];
}

/**
 * How close a wave came: the most weight alive on the ring while it was out, and how far
 * round the ring (per mille of a lap) its last monster walked before it died.
 */
export interface WaveMargin {
  wave: number;
  peakAlive: number;
  laps: number;
}

/** Watches state tick by tick to log margins, without touching the sim. */
class MarginLog {
  readonly margins: WaveMargin[] = [];
  private prev = new Map<number, { wave: number; walked: number }>();
  private peak = new Map<number, number>();
  private done = new Set<number>();

  observe(sim: Sim): void {
    const s = sim.state;
    for (const w of new Set(s.monsters.map((m) => m.wave))) this.peak.set(w, Math.max(this.peak.get(w) ?? 0, s.alive));
    const now = new Map(s.monsters.map((m) => [m.id, { wave: m.wave, walked: m.walked }]));
    for (const [id, m] of this.prev) {
      if (now.has(id)) continue;
      const w = s.waves[m.wave];
      if (w && w.remaining === 0 && !this.done.has(m.wave)) {
        this.done.add(m.wave);
        this.margins.push({ wave: m.wave + 1, peakAlive: this.peak.get(m.wave) ?? 0, laps: Math.round((m.walked * 1000) / sim.map.length) });
      }
    }
    this.prev = now;
  }
}

const MAX_TICKS = 600_000;
/** How often a looted bot re-dresses its towers: once a wave. */
const OUTFIT_TICKS = 900;

export interface RunExtras {
  /** Opens the Secret Cow Level (with a Wirt's Leg it is handed) as this wave, by number, starts. */
  cowAtWave?: number;
  /** Items the bot's towers wear (tools/outfit.ts). */
  loot?: LootSet;
}

/** Plays a run with one bot (to the end, or `maxTicks`), recording its commands as a replayable log. */
export function runBot(
  data: GameData,
  strategy: Strategy,
  seed: number,
  onTick?: (sim: Sim) => void,
  maxTicks = MAX_TICKS,
  extra: RunExtras = {},
): RunResult {
  const { cowAtWave } = extra;
  // Stage F: the bot's towers wear items from a loot set, re-dressed once a wave
  const loot = extra.loot && extra.loot !== 'none' ? lootPool(data, extra.loot) : undefined;
  const sim = createSim(data, seed);
  const bot = createBot(strategy, sim, loot?.pool);
  if (strategy === 'LOOTBUILD' && loot && process.env['LOOT_DEBUG']) console.error(`[lootbuild] ${extra.loot}: ${lootBuilds(sim, loot.pool).join(', ')}`);
  const log: TimedCommand[] = [];
  const margins = new MarginLog();
  let topTier = 0;
  let peakAlive = 0;
  const tiersOn: Record<number, number> = {};
  const evolvedOn: Record<string, number> = {};
  let cowOpened = false;
  while (sim.state.status === 'playing' && sim.state.tick < maxTicks) {
    const commands = bot.decide(sim);
    if (loot && sim.state.tick % OUTFIT_TICKS === 0) commands.push(...outfit(sim, loot.pool, loot.reuse));
    if (cowAtWave !== undefined && !cowOpened && sim.state.wave >= cowAtWave) {
      cowOpened = true;
      const leg = { uid: 'bot-leg', code: 'leg', quality: 'normal' as const, ilvl: 85, sockets: 0, socketed: [], stats: [] };
      // The leg comes out of the stash into a free spot, selling loot to make room
      const inv = () => sim.state.inventories[0]!;
      while (!freeSpot(sim.data.items, inv(), leg) && inv().length > 0) step(sim, [{ type: 'sellItem', uid: inv()[0]!.item.uid }]);
      const spot = freeSpot(sim.data.items, inv(), leg);
      if (spot) step(sim, [{ type: 'stashOut', item: leg, ...spot }]);
      commands.push({ type: 'cowPortal', uid: 'bot-leg' });
    }
    for (const command of commands) log.push({ tick: sim.state.tick, command });
    step(sim, commands);
    margins.observe(sim);
    peakAlive = Math.max(peakAlive, sim.state.alive);
    for (const t of sim.state.towers) {
      const tier = t.evolved ? MAX_TIER + 1 : t.tier;
      topTier = Math.max(topTier, tier);
      if (tier > 1) tiersOn[tier] ??= sim.state.wave;
      if (t.evolved) evolvedOn[t.evolved] ??= sim.state.wave;
    }
    onTick?.(sim);
  }
  const s = sim.state;
  return {
    strategy,
    seed,
    won: s.status === 'won',
    wave: s.wave,
    peakAlive,
    gold: s.gold[0] ?? 0,
    towers: s.towers.length,
    levels: s.towers.reduce((n, t) => n + progress(t), 0),
    topTier,
    tiersOn,
    evolvedOn: { ...evolvedOn, ...bot.evolvedOn },
    log,
    margins: margins.margins.sort((a, b) => a.wave - b.wave),
  };
}
