// A match: the rings the players defend, stepped together, plus the rules that tie them
// into a game. Every client runs the same match from the same seed and the same per-tick
// command lists, so the match is deterministic exactly as each ring is.
//
//   solo  one ring, one player who owns all of it
//   team  one shared ring, an arc per player: one alive count, kill gold to the killer
//   ffa   a ring per player from the same seed; each ring keeps its own alive count, and
//         the last ring standing wins
//   battle  two teams, a battlefield each with a lane per player and a king at the back
//         (src/sim/battle.ts); slots 0 to n-1 are the first team, n to 2n-1 the second
//   coop  one team's battlefield against the waves, sends arriving on a schedule
//
// Waves run on each ring's own timer (sim.ts). Send Next Wave starts a ring's next wave
// early: on a team ring any player may press it, in FFA it is your own ring.

import type { GameData } from './data.ts';
import { hashValue } from './hash.ts';
import { ARC_COUNT, createLaneMap } from './map.ts';
import { createSim, startWave, step } from './sim.ts';
import type { Command, Sim } from './state.ts';
import { applyTrade, isTradeCommand, type Trade } from './items/trade.ts';
import { battleData, battleOptions, battleStart, battleWaveCount, DEFAULT_OPTIONS, fightOver, payWave, rally, recall, sendCost, sendDef, sendGroups, sendOpen, wholeShards, type BattleOptions } from './battle.ts';
import { botCommands } from './battlebot.ts';
import { createRng, rollInt } from './rng.ts';

export type MatchMode = 'solo' | 'ffa' | 'team' | 'battle' | 'coop';
export const MATCH_MODES: readonly MatchMode[] = ['solo', 'ffa', 'team', 'battle', 'coop'];
/** A battle team: one lane per player. */
export const MAX_BATTLE_TEAM = ARC_COUNT;

/** How a battle or co-op match is set up in the lobby. */
export interface BattleSetup {
  /** Players a team, 1 to 4. */
  teamSize: number;
  /** By slot: a class id, or 'random' (the default). */
  races?: string[];
  /** Slots the match's own bots play (empty seats). */
  bots?: number[];
  /** Online: the match slot each lobby slot plays (seats[lobby] = slot). Absent, lobby slot and match slot are one. */
  seats?: number[];
  /** The game setup screen's choices (battle.ts DEFAULT_OPTIONS when absent). */
  options?: BattleOptions;
}

/** A human in a battle lobby: the race they picked (or 'random') and the team they asked for (0 or 1). */
export interface BattleHuman {
  race: string;
  team: number;
}

/**
 * Seats a battle lobby: each human, in joining order, on the team they asked for while it
 * has room (else the other), in its next seat; bots take every seat left. Undefined when
 * the humans do not fit (more than the teams hold).
 */
export function battleSetupFor(mode: 'battle' | 'coop', teamSize: number, humans: readonly BattleHuman[], options?: BattleOptions): BattleSetup | undefined {
  const teams = mode === 'battle' ? 2 : 1;
  const slots = teamSize * teams;
  if (teamSize < 1 || teamSize > MAX_BATTLE_TEAM || humans.length > slots) return undefined;
  const used = Array.from({ length: teams }, () => 0);
  const races = Array.from({ length: slots }, () => 'random');
  const seats = humans.map((h) => {
    const want = teams === 1 ? 0 : h.team === 1 ? 1 : 0;
    const team = used[want]! < teamSize ? want : 1 - want;
    const slot = team * teamSize + used[team]!++;
    races[slot] = h.race;
    return slot;
  });
  const bots = Array.from({ length: slots }, (_, p) => p).filter((p) => !seats.includes(p));
  return { teamSize, races, bots, seats, ...(options ? { options } : {}) };
}

/** The phases both teams share, and what the lobby set up. */
export interface BattleMatchState {
  phase: 'build' | 'fight';
  /** The tick the build phase ends on, or the tick the fight began. */
  phaseTick: number;
  /** Waves started so far. */
  wave: number;
  teamSize: number;
  /** Each slot's race, random ones already rolled. */
  races: string[];
  bots: number[];
  /** Each slot's sends so far, by id: an act boss goes once a match. */
  made: string[][];
  /** The match seed, for the bots' play (each bot slot plays a little differently). */
  seed: number;
  /** Online: the match slot each lobby slot plays; empty when they are the same. */
  seats: number[];
  /** The setup screen's choices. */
  options: BattleOptions;
}
export const MAX_PLAYERS = 6;
/** A lobby holds up to eight: a 4v4 battle; free for all still starts with at most MAX_PLAYERS. */
export const MAX_LOBBY = 8;
/** A team shares one ring: an arc each. */
export const MAX_TEAM_PLAYERS = ARC_COUNT;

/** A player's command for this tick. `player` is the lobby slot. */
export interface PlayerCommand {
  player: number;
  command: Command;
}

export interface MatchState {
  tick: number;
  mode: MatchMode;
  status: 'playing' | 'over';
  /** Players who won, once the match is over. Empty means everyone lost. */
  winners: number[];
  /** Open trade windows between players. */
  trades: Trade[];
  /** Battle and co-op only. */
  battle?: BattleMatchState;
}

export interface Match {
  readonly data: GameData;
  /** The rings: one in solo and team, one per player in ffa. */
  readonly zones: Sim[];
  readonly players: number;
  state: MatchState;
}

export function createMatch(data: GameData, seed: number, mode: MatchMode, players: number, setup?: BattleSetup): Match {
  if (mode === 'battle' || mode === 'coop') return createBattleMatch(data, seed, mode, setup ?? { teamSize: mode === 'battle' ? Math.max(1, players >> 1) : players });
  if (players < 1 || players > MAX_PLAYERS) throw new Error(`A match takes 1 to ${MAX_PLAYERS} players, not ${players}`);
  if (mode === 'solo' && players !== 1) throw new Error('Solo is one player');
  if (mode === 'team' && players > MAX_TEAM_PLAYERS) throw new Error(`A team ring takes up to ${MAX_TEAM_PLAYERS} players`);
  // FFA rings are identical, so they share the seed
  const zones = mode === 'ffa' ? Array.from({ length: players }, () => createSim(data, seed)) : [createSim(data, seed, { players })];
  return {
    data,
    zones,
    players,
    state: { tick: 0, mode, status: 'playing', winners: [], trades: [] },
  };
}

/**
 * A battle or co-op match: a battlefield per team, its lanes the team's slots in order.
 * Random races are rolled here from the seed, so every client rolls the same.
 */
function createBattleMatch(data: GameData, seed: number, mode: 'battle' | 'coop', setup: BattleSetup): Match {
  const n = setup.teamSize;
  if (n < 1 || n > MAX_BATTLE_TEAM) throw new Error(`A battle team takes 1 to ${MAX_BATTLE_TEAM} players, not ${n}`);
  const teams = mode === 'battle' ? 2 : 1;
  const players = n * teams;
  const classes = Object.keys(data.classes);
  const options = battleOptions(setup.options ?? DEFAULT_OPTIONS);
  const rng = createRng((seed ^ 0x0ba771e5) >>> 0);
  const races = Array.from({ length: players }, (_, p) => {
    const want = options.pick === 'all' ? setup.races?.[p] : undefined;
    return want && data.classes[want] ? want : classes[rollInt(rng, 0, classes.length - 1)]!;
  });
  // Mirror mode: the second team plays the first team's races, seat for seat
  if (options.mirror && teams === 2) for (let p = 0; p < n; p++) races[n + p] = races[p]!;
  const zones = Array.from({ length: teams }, (_, t) => createBattlefield(data, seed, races.slice(t * n, t * n + n), options));
  const first = data.battle!.rules.firstBuildTicks;
  return {
    data,
    zones,
    players,
    state: {
      tick: 0,
      mode,
      status: 'playing',
      winners: [],
      trades: [],
      battle: { phase: 'build', phaseTick: first, wave: 0, teamSize: n, races, bots: [...(setup.bots ?? [])].filter((b) => b >= 0 && b < players), made: races.map(() => []), seed: seed >>> 0, seats: [...(setup.seats ?? [])], options },
    },
  };
}

/** One team's battlefield: a lane per seat, each seat playing its race. */
export function createBattlefield(data: GameData, seed: number, races: readonly string[], options: BattleOptions = DEFAULT_OPTIONS): Sim {
  const bd = battleData(data, options, races.length);
  const sim = createSim(bd, seed, { players: races.length, map: createLaneMap(races.length) });
  sim.state.battle = battleStart(bd, races, options);
  return sim;
}

/** True for the modes played on battlefields. */
export function isBattle(match: Match): boolean {
  return match.state.battle !== undefined;
}

/** A slot's team in a battle (0 or 1; co-op has one). */
export function teamOf(match: Match, player: number): number {
  const b = match.state.battle;
  return b ? Math.floor(player / b.teamSize) : 0;
}

/** The ring a player defends. */
export function ringOf(match: Match, player: number): number {
  if (match.state.battle) return teamOf(match, player);
  return match.state.mode === 'ffa' ? player : 0;
}

/** Who a player is on their ring: their slot on a shared team ring, else the ring's only player. */
export function seatOf(match: Match, player: number): number {
  const b = match.state.battle;
  if (b) return player % b.teamSize;
  return match.state.mode === 'team' ? player : 0;
}

/** The match slot of a seat on a ring: the inverse of ringOf and seatOf. */
export function slotOf(match: Match, ring: number, seat: number): number {
  const b = match.state.battle;
  if (b) return ring * b.teamSize + seat;
  return match.state.mode === 'team' ? seat : ring;
}

/** The player defending an arc of a ring. */
export function arcOwner(match: Match, ring: number, arc: number): number {
  if (match.state.battle) return slotOf(match, ring, match.zones[ring]!.arcOwners[arc]!);
  return match.state.mode === 'team' ? match.zones[0]!.arcOwners[arc]! : ring;
}

/** Players whose own ring is still going. */
export function playersIn(match: Match): number[] {
  return Array.from({ length: match.players }, (_, p) => p).filter((p) => match.zones[ringOf(match, p)]!.state.status !== 'lost');
}

/** The alive weight on a player's ring. */
export function aliveOf(match: Match, player: number): number {
  return match.zones[ringOf(match, player)]!.state.alive;
}

/** Commands a battlefield takes: towers, workers, sends and the king. No items, no trades, no early waves. */
const BATTLE_COMMANDS = new Set<Command['type']>(['build', 'pickSkill', 'upgrade', 'upgradeTier', 'pickBranch', 'setTargeting', 'evolve', 'ascend', 'sell', 'hire', 'king', 'send']);

/** Advances every ring one tick. `commands` are this tick's, in the order the host relayed them. */
export function stepMatch(match: Match, commands: readonly PlayerCommand[]): void {
  const m = match.state;
  if (m.status === 'over') {
    m.tick++;
    return;
  }
  const perZone: Command[][] = match.zones.map(() => []);
  const b = m.battle;
  // Online, a lobby slot plays its seat; the match's own bots play theirs here, so every client runs them alike
  const humans = b ? commands.map((c) => ({ ...c, player: b.seats.length ? (b.seats[c.player] ?? -1) : c.player })).filter((c) => !b.bots.includes(c.player)) : commands;
  const all = b ? [...humans, ...b.bots.flatMap((p) => botCommands(match, p).map((command) => ({ player: p, command })))] : commands;
  for (const { player, command } of all) {
    if (player < 0 || player >= match.players) continue;
    if (b) {
      if (!BATTLE_COMMANDS.has(command.type)) continue;
      if (command.type === 'send') applySend(match, player, command.send, command.lane);
      else perZone[ringOf(match, player)]!.push({ ...command, player: seatOf(match, player) });
      continue;
    }
    if (isTradeCommand(command)) applyTrade(match, player, command);
    else perZone[ringOf(match, player)]!.push({ ...command, player: seatOf(match, player) });
  }

  match.zones.forEach((zone, i) => step(zone, perZone[i]!));
  if (b) stepBattle(match);
  else checkOver(match);
  m.tick++;
}

/** The wave a send made now joins: the coming one (a fight's sends wait for the next). */
export function joiningWave(match: Match): number {
  return match.state.battle?.wave ?? 0;
}

/** The team a slot's sends go to. */
export function enemyOf(match: Match, player: number): number {
  return match.zones.length > 1 ? 1 - teamOf(match, player) : 0;
}

/** A send: the sender pays its shards and gains its income; it joins the enemy lane's next wave. */
function applySend(match: Match, player: number, id: string, lane: number): void {
  const b = match.state.battle!;
  if (match.state.mode !== 'battle') return;
  const send = sendDef(match.data, id);
  const wave = joiningWave(match);
  const own = match.zones[ringOf(match, player)]!;
  const target = match.zones[enemyOf(match, player)]!;
  const seat = seatOf(match, player);
  if (!send || !own.state.battle || !target.state.battle || wave >= battleWaveCount(own.data)) return;
  if (!Number.isInteger(lane) || lane < 0 || lane >= target.map.arcs.length || !sendOpen(send, wave, b.made[player]!)) return;
  const cost = sendCost(send, wave);
  if (wholeShards(own.state.battle.shards[seat]!) < cost) return;
  own.state.battle.shards[seat]! -= cost * 1000;
  own.state.battle.income[seat]! += cost * match.data.battle!.rules.sendIncomePerShard;
  own.state.battle.sendsMade[seat]!++;
  b.made[player]!.push(id);
  target.state.battle.queued.push({ send: id, lane, from: player });
}

/**
 * The shared phases, Legion's rule: the first build phase, then every battlefield's wave
 * starts with the sends queued on it; the fight lasts until every creep on both sides is
 * dead, sends and the fights at the kings included; then every player is paid, every
 * fighter stands again at home, and the countdown to the next wave begins. During a fight
 * a cleared lane's fighters rally to the king. A king at 0 ends the match; after the last
 * wave the king with more life wins.
 */
function stepBattle(match: Match): void {
  const m = match.state;
  const b = m.battle!;
  const rules = match.data.battle!.rules;
  const count = battleWaveCount(match.zones[0]!.data);
  if (b.phase === 'build' && m.tick >= b.phaseTick) {
    match.zones.forEach((zone, t) => {
      const wave = zone.data.waves[b.wave]!;
      const extra = zone.state.battle!.queued.map((q) => ({ lane: q.lane, groups: sendGroups(match.data, sendDef(match.data, q.send)!, wave, b.wave, b.options.sends) }));
      // Co-op: the schedule's sends, onto the lanes in turn
      if (m.mode === 'coop') {
        (rules.coop.sends[b.wave] ?? []).forEach((id, i) => {
          const send = sendDef(match.data, id);
          if (send) extra.push({ lane: (b.wave + i + t) % zone.map.arcs.length, groups: sendGroups(match.data, send, wave, b.wave, b.options.sends) });
        });
      }
      zone.state.battle!.queued = [];
      startWave(zone, extra);
    });
    b.wave++;
    b.phase = 'fight';
    b.phaseTick = m.tick;
  } else if (b.phase === 'fight') {
    for (const zone of match.zones) rally(zone);
    if (match.zones.every(fightOver)) {
      for (const zone of match.zones) {
        payWave(zone, b.wave - 1);
        recall(zone);
      }
      b.phase = 'build';
      b.phaseTick = m.tick + rules.buildTicks;
    }
  }
  const kings = match.zones.map((z) => z.state.battle!.king.hp);
  const fallen = kings.some((hp) => hp <= 0);
  const done = b.wave >= count && b.phase === 'build';
  if (!fallen && !done) return;
  for (const zone of match.zones) if (zone.state.status === 'playing' && zone.state.battle!.king.hp <= 0) zone.state.status = 'lost';
  if (m.mode === 'coop') return end(match, kings[0]! > 0 ? Array.from({ length: match.players }, (_, p) => p) : []);
  // The king with more life wins; level kings go to the team that leaked less, then the one that killed more
  const score = match.zones.map((z) => {
    const s = z.state.battle!;
    return [s.king.hp, -s.leakDamage.reduce((n, d) => n + d, 0), z.state.kills];
  });
  const cmp = score[0]!.findIndex((v, i) => v !== score[1]![i]);
  const winner = cmp < 0 ? -1 : score[0]![cmp]! > score[1]![cmp]! ? 0 : 1;
  end(match, winner < 0 ? [] : Array.from({ length: match.players }, (_, p) => p).filter((p) => teamOf(match, p) === winner));
}


function checkOver(match: Match): void {
  const m = match.state;
  const zones = match.zones;
  const all = Array.from({ length: match.players }, (_, p) => p);
  if (m.mode === 'ffa') {
    const alive = playersIn(match);
    const someonePlaying = zones.some((z) => z.state.status === 'playing');
    // With rivals, the last ring standing has won; alone, play the run out
    if ((zones.length > 1 && alive.length <= 1) || !someonePlaying) end(match, alive);
  } else {
    const s = zones[0]!.state;
    if (s.status !== 'playing') end(match, s.status === 'won' ? all : []);
  }
}

function end(match: Match, winners: number[]): void {
  match.state.status = 'over';
  match.state.winners = winners;
}

/** One number for the whole match, compared between clients every 100 ticks. */
export function matchHash(match: Match): number {
  return hashValue({ match: match.state, zones: match.zones.map((z) => z.state) }, 'match');
}
