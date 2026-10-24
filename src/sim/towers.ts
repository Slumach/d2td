// Tower commands and the rules behind them: build, T1 pick, levels, tiers and branches,
// targeting, evolution and selling. Invalid commands do nothing, deterministically. A
// player builds only on the arcs they own, pays from their own gold, and changes only
// their own towers.

import { mayBuild } from './battle.ts';
import { sendHome } from './items/loot.ts';
import { MAX_TIER, MAX_TOWER_LEVEL, type EvolutionDef, type LegendDef, type OverLevels } from './data.ts';
import { idiv } from './fixed.ts';
import { arcAt, inBounds, isBlocked, isPathTile, tileCenter } from './map.ts';
import { TARGETING_MODES, type Sim, type Targeting, type Tower } from './state.ts';

/** The tower on a tile: a legend's riders stand on its tile unseen, so it is the legend. */
export function towerAt(sim: Sim, x: number, y: number): Tower | undefined {
  return sim.state.towers.find((t) => t.tileX === x && t.tileY === y && t.legendOf === undefined);
}

export function towerById(sim: Sim, id: number): Tower | undefined {
  return sim.state.towers.find((t) => t.id === id);
}

/** A free tile off the path and the scenery, on an arc `player` owns. */
export function canBuild(sim: Sim, x: number, y: number, player = 0): boolean {
  return (
    inBounds(sim.map, x, y) &&
    !isPathTile(sim.map, x, y) &&
    !isBlocked(sim.map, x, y) &&
    sim.arcOwners[arcAt(sim.map, x, y)] === player &&
    towerAt(sim, x, y) === undefined
  );
}

/** Takes `cost` from the player's gold if they have it. */
function pay(sim: Sim, player: number, cost: number): boolean {
  const gold = sim.state.gold;
  if ((gold[player] ?? 0) < cost) return false;
  gold[player]! -= cost;
  return true;
}

function lineOf(sim: Sim, tower: Tower) {
  return sim.data.classes[tower.cls]?.lines[tower.line];
}

/** The skills offered at the tower's next pick: its T1 options, or a pending branch. */
export function pendingChoices(sim: Sim, tower: Tower): string[] {
  if (tower.evolved) return [];
  if (!tower.line) {
    const cls = sim.data.classes[tower.cls];
    return cls ? Object.values(cls.lines).flatMap((l) => l.tiers[0] ?? []) : [];
  }
  if (tower.picks.length === tower.tier - 1) return lineOf(sim, tower)?.tiers[tower.tier - 1] ?? [];
  return [];
}

export function upgradeCost(sim: Sim, tower: Tower): number | undefined {
  // A legend levels on its own ladder, its riders with it; a rider is never bought alone
  if (tower.legendOf !== undefined) return undefined;
  if (tower.legend) return overLevelCost(sim.data.economy.legend.levels, tower.level - MAX_TOWER_LEVEL);
  // An evolved tower keeps levelling past its base level 5 on its own steep ladder
  if (tower.evolved) return overLevelCost(sim.data.economy.evolvedLevels, tower.level - MAX_TOWER_LEVEL);
  if (!tower.picks[tower.tier - 1]) return undefined;
  // Past level 5 a line goes on growing at a rising price: it never has to tier out
  if (tower.level >= MAX_TOWER_LEVEL) {
    const curve = sim.data.economy.lineLevels[tower.tier - 1];
    return curve && overLevelCost(curve, tower.level - MAX_TOWER_LEVEL);
  }
  return sim.data.economy.levelCosts[tower.tier - 1]?.[tower.level - 1];
}

/** The gold for the (n + 1)th level past a ladder's top: costBase, then costPctPerLevel percent more each. */
export function overLevelCost(curve: OverLevels, n: number): number {
  let cost = curve.costBase;
  for (let i = 0; i < n; i++) cost = idiv(cost * curve.costPctPerLevel, 100);
  return cost;
}

/**
 * What the next tier costs, if the tower can take it: levels maxed and a tier left on the
 * line. Nothing else gates a tier; gold and the price curve do the pacing.
 */
export function tierCost(sim: Sim, tower: Tower): number | undefined {
  const line = lineOf(sim, tower);
  if (tower.evolved || !line || tower.level < MAX_TOWER_LEVEL || tower.tier >= MAX_TIER) return undefined;
  if (tower.tier >= line.tiers.length || tower.picks.length < tower.tier) return undefined;
  return sim.data.economy.tierCosts[tower.tier - 1];
}

/** The towers riding on a legend (its other two evolutions). */
export function ridersOf(sim: Sim, tower: Tower): Tower[] {
  return tower.legend ? sim.state.towers.filter((t) => t.legendOf === tower.id) : [];
}

export function sellValue(sim: Sim, tower: Tower): number {
  const spent = tower.spent + ridersOf(sim, tower).reduce((n, t) => n + t.spent, 0);
  return idiv(spent * sim.data.economy.sellRefundPct, 100);
}

/**
 * T5: the legend three towers make, if they do: three evolved towers of one player and one
 * class, three different recipes, anywhere on the ring (0.3.8). Hidden until it is true.
 */
export function legendFor(sim: Sim, a: Tower, b: Tower, c: Tower): LegendDef | undefined {
  const three = [a, b, c];
  if (new Set(three.map((t) => t.id)).size !== 3) return undefined;
  if (three.some((t) => !t.evolved || t.legend || t.legendOf !== undefined || t.owner !== a.owner || t.cls !== a.cls)) return undefined;
  if (new Set(three.map((t) => t.evolved)).size !== 3) return undefined;
  return sim.data.legends.find((l) => l.cls === a.cls);
}

/** Every pair of other towers that makes a legend with `tower`, for its panel's button and the bots. */
export function legendOptions(sim: Sim, tower: Tower): { legend: LegendDef; others: [Tower, Tower] }[] {
  if (!tower.evolved || tower.legend || tower.legendOf !== undefined) return [];
  const near = sim.state.towers.filter((t) => t.id !== tower.id && t.owner === tower.owner && t.evolved && t.legendOf === undefined && !t.legend);
  const out: { legend: LegendDef; others: [Tower, Tower] }[] = [];
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const legend = legendFor(sim, tower, near[i]!, near[j]!);
      if (legend) out.push({ legend, others: [near[i]!, near[j]!] });
    }
  }
  return out;
}

/**
 * T5: the three become the legend on a's tile, a being the tower selected. All three stay
 * towers, so every skill they had keeps acting: a shows (as the legend's NPC) and the other
 * two ride on it unseen, freeing their tiles. Their levels reset to 5 and the legend's ladder
 * takes them on.
 */
export function ascend(sim: Sim, a: Tower, b: Tower, c: Tower): void {
  const legend = legendFor(sim, a, b, c);
  const cost = sim.data.economy.legend.cost;
  if (!legend || !pay(sim, a.owner, cost)) return;
  a.legend = legend.id;
  a.tier = MAX_TIER + 2;
  a.spent += cost;
  for (const t of [a, b, c]) {
    t.level = MAX_TOWER_LEVEL;
    t.cooldown = 0;
    t.partnerCooldown = 0;
  }
  for (const t of [b, c]) Object.assign(t, { legendOf: a.id, tileX: a.tileX, tileY: a.tileY, x: a.x, y: a.y });
}

/** True if the tower has learned `skill` and has reached at least `minTier`. */
export function meets(sim: Sim, tower: Tower, req: { skill: string; minTier: number }): boolean {
  const line = lineOf(sim, tower);
  if (tower.evolved || !line || tower.tier < req.minTier) return false;
  const tierIndex = line.tiers.findIndex((options) => options.includes(req.skill));
  return tierIndex >= 0 && tower.picks[tierIndex] === req.skill;
}

export function adjacent(a: Tower, b: Tower): boolean {
  return a.id !== b.id && Math.abs(a.tileX - b.tileX) <= 1 && Math.abs(a.tileY - b.tileY) <= 1;
}

/**
 * The recipe two towers can evolve into, with which one is the attack tower: one player's,
 * anywhere on the ring (no adjacency since 0.3.8), neither evolved nor riding a legend.
 */
export function evolutionFor(sim: Sim, a: Tower, b: Tower): { recipe: EvolutionDef; attack: Tower; partner: Tower } | undefined {
  if (a.id === b.id || a.owner !== b.owner || a.legendOf !== undefined || b.legendOf !== undefined) return undefined;
  for (const recipe of sim.data.evolutions) {
    if (meets(sim, a, recipe.attack) && meets(sim, b, recipe.partner)) return { recipe, attack: a, partner: b };
    if (meets(sim, b, recipe.attack) && meets(sim, a, recipe.partner)) return { recipe, attack: b, partner: a };
  }
  return undefined;
}

function removeTower(sim: Sim, id: number): void {
  const s = sim.state;
  s.towers = s.towers.filter((t) => t.id !== id);
  s.summons = s.summons.filter((u) => u.towerId !== id);
}

/** What `player`'s next tower costs: buildCost, the same for every tower however many they own, in Eternal Conflict too. */
export function buildCostFor(sim: Sim, _player: number): number {
  return sim.data.economy.buildCost;
}

export function build(sim: Sim, player: number, x: number, y: number, cls: string, skill?: string): void {
  const s = sim.state;
  const cost = buildCostFor(sim, player);
  // Eternal Conflict: a player builds only their race's towers, or this wave's roll
  if (!mayBuild(sim, player, cls, skill)) return;
  if (!sim.data.classes[cls] || !canBuild(sim, x, y, player) || !pay(sim, player, cost)) return;
  const center = tileCenter({ x, y });
  const tower: Tower = {
    id: s.nextId++,
    owner: player,
    cls,
    tileX: x,
    tileY: y,
    x: center.x,
    y: center.y,
    line: '',
    tier: 1,
    level: 1,
    picks: [],
    spent: cost,
    cooldown: 0,
    targeting: 'first',
    evolved: '',
    partnerSkill: '',
    partnerLevel: 0,
    summonCooldown: 0,
    partnerCooldown: 0,
  };
  s.towers.push(tower);
  if (skill) pickSkill(sim, tower, skill);
}

export function pickSkill(sim: Sim, tower: Tower, skill: string): void {
  if (tower.line || tower.evolved) return;
  if (sim.state.battle?.randomRolls && !mayBuild(sim, tower.owner, tower.cls, skill)) return;
  const lines = sim.data.classes[tower.cls]?.lines ?? {};
  const line = Object.entries(lines).find(([, l]) => l.tiers[0]?.includes(skill));
  if (!line) return;
  tower.line = line[0];
  tower.picks = [skill];
}

export function upgrade(sim: Sim, tower: Tower): void {
  const cost = upgradeCost(sim, tower);
  if (cost === undefined || !pay(sim, tower.owner, cost)) return;
  tower.spent += cost;
  tower.level++;
  for (const r of ridersOf(sim, tower)) r.level = tower.level;
}

export function upgradeTier(sim: Sim, tower: Tower): void {
  const cost = tierCost(sim, tower);
  if (cost === undefined || !pay(sim, tower.owner, cost)) return;
  tower.spent += cost;
  tower.tier++;
  tower.level = 1;
  // A tier with one skill is taken at once; a branch waits for pickBranch
  const options = lineOf(sim, tower)!.tiers[tower.tier - 1]!;
  if (options.length === 1) tower.picks.push(options[0]!);
}

export function pickBranch(sim: Sim, tower: Tower, skill: string): void {
  if (!tower.line || tower.evolved || tower.picks.length !== tower.tier - 1) return;
  if (!lineOf(sim, tower)!.tiers[tower.tier - 1]?.includes(skill)) return;
  tower.picks.push(skill);
}

export function setTargeting(tower: Tower, mode: Targeting): void {
  if (TARGETING_MODES.includes(mode)) tower.targeting = mode;
}

/**
 * Evolves `a`, the tower the player selected, with `b`, the partner, anywhere on the ring:
 * `a` becomes the evolved tower on its own tile, keeping its id (so it stays selected) and
 * its gear; `b` is consumed, its tile freed and its gear sent home. Which recipe, and which
 * of the two is the attack, comes from evolutionFor whichever was selected.
 */
export function evolve(sim: Sim, a: Tower, b: Tower): void {
  const s = sim.state;
  const cost = sim.data.economy.evolveCost;
  const match = evolutionFor(sim, a, b);
  if (!match || !pay(sim, a.owner, cost)) return;
  const { recipe, attack, partner } = match;
  // The partner aura keeps the level it reached: its current level if it still has it,
  // otherwise it was maxed to tier past it
  const partnerLevel = partner.picks[partner.tier - 1] === recipe.partner.skill ? Math.min(partner.level, MAX_TOWER_LEVEL) - 1 : MAX_TOWER_LEVEL - 1;
  removeTower(sim, a.id);
  removeTower(sim, b.id);
  sendHome(sim, b.owner, Object.values(b.gear ?? {}));
  s.towers.push({
    ...attack,
    id: a.id,
    tileX: a.tileX,
    tileY: a.tileY,
    x: a.x,
    y: a.y,
    targeting: a.targeting,
    picks: [...attack.picks],
    tier: MAX_TIER + 1,
    level: MAX_TOWER_LEVEL,
    spent: attack.spent + partner.spent + cost,
    cooldown: 0,
    evolved: recipe.id,
    partnerSkill: recipe.partner.skill,
    partnerLevel,
    summonCooldown: 0,
    partnerCooldown: 0,
  });
  // It wears what the selected tower wore, nothing of the attack's if that was the partner
  const evolved = s.towers.at(-1)!;
  if (a.gear) evolved.gear = a.gear;
  else delete evolved.gear;
}

export function sell(sim: Sim, tower: Tower): void {
  if (tower.legendOf !== undefined) return;
  sim.state.gold[tower.owner]! += sellValue(sim, tower);
  // A legend goes with its riders, and their gear goes home with them
  for (const r of ridersOf(sim, tower)) {
    removeTower(sim, r.id);
    sendHome(sim, r.owner, Object.values(r.gear ?? {}));
  }
  removeTower(sim, tower.id);
  // What it wore goes back to its owner, not to the vendor
  sendHome(sim, tower.owner, Object.values(tower.gear ?? {}));
}
