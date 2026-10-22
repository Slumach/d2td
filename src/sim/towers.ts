// Tower commands and the rules behind them: build, T1 pick, levels, tiers and branches,
// targeting, evolution and selling. Invalid commands do nothing, deterministically. A
// player builds only on the arcs they own, pays from their own gold, and changes only
// their own towers.

import { MAX_TIER, MAX_TOWER_LEVEL, type EvolutionDef } from './data.ts';
import { idiv } from './fixed.ts';
import { arcAt, inBounds, isBlocked, isPathTile, tileCenter } from './map.ts';
import { TARGETING_MODES, type Sim, type Targeting, type Tower } from './state.ts';

export function towerAt(sim: Sim, x: number, y: number): Tower | undefined {
  return sim.state.towers.find((t) => t.tileX === x && t.tileY === y);
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
  if (tower.evolved || !tower.picks[tower.tier - 1] || tower.level >= MAX_TOWER_LEVEL) return undefined;
  return sim.data.economy.levelCosts[tower.tier - 1]?.[tower.level - 1];
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

export function sellValue(sim: Sim, tower: Tower): number {
  return idiv(tower.spent * sim.data.economy.sellRefundPct, 100);
}

/** True if the tower has learned `skill` and has reached at least `minTier`. */
function meets(sim: Sim, tower: Tower, req: { skill: string; minTier: number }): boolean {
  const line = lineOf(sim, tower);
  if (tower.evolved || !line || tower.tier < req.minTier) return false;
  const tierIndex = line.tiers.findIndex((options) => options.includes(req.skill));
  return tierIndex >= 0 && tower.picks[tierIndex] === req.skill;
}

export function adjacent(a: Tower, b: Tower): boolean {
  return a.id !== b.id && Math.abs(a.tileX - b.tileX) <= 1 && Math.abs(a.tileY - b.tileY) <= 1;
}

/** The recipe two adjacent towers can evolve into, with which one is the attack tower. */
export function evolutionFor(sim: Sim, a: Tower, b: Tower): { recipe: EvolutionDef; attack: Tower; partner: Tower } | undefined {
  if (!adjacent(a, b)) return undefined;
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

/**
 * What `player`'s next tower costs: buildCost, multiplied by buildCostGrowthPct for each
 * tower they already own.
 */
export function buildCostFor(sim: Sim, player: number): number {
  const e = sim.data.economy;
  const owned = sim.state.towers.filter((t) => t.owner === player).length;
  let cost = e.buildCost;
  for (let i = 0; i < owned; i++) cost = idiv(cost * e.buildCostGrowthPct, 100);
  return cost;
}

export function build(sim: Sim, player: number, x: number, y: number, cls: string, skill?: string): void {
  const s = sim.state;
  const cost = buildCostFor(sim, player);
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

export function evolve(sim: Sim, a: Tower, b: Tower): void {
  const s = sim.state;
  const cost = sim.data.economy.evolveCost;
  const match = evolutionFor(sim, a, b);
  if (!match || a.owner !== b.owner || !pay(sim, a.owner, cost)) return;
  const { recipe, attack, partner } = match;
  // The partner aura keeps the level it reached: its current level if it still has it,
  // otherwise it was maxed to tier past it
  const partnerLevel = partner.picks[partner.tier - 1] === recipe.partner.skill ? partner.level - 1 : MAX_TOWER_LEVEL - 1;
  removeTower(sim, attack.id);
  removeTower(sim, partner.id);
  s.towers.push({
    ...attack,
    id: s.nextId++,
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
}

export function sell(sim: Sim, tower: Tower): void {
  sim.state.gold[tower.owner]! += sellValue(sim, tower);
  removeTower(sim, tower.id);
}
