// Items for the harness bots (Stage F): the loot a bot would hold after a stretch of the
// campaign, a best-in-slot catalogue, and an outfitter that dresses the bot's towers from
// either. All items are real ones rolled from the tables; nothing is hand-listed.
//
//   nm     every drop of one pass through Normal and Nightmare (each monster killed once)
//   hell   the same through Hell as well
//   bis    every unique, set item and runeword at its best rolls, runewords on the best
//          base that takes them; the outfitter picks the best of them for every slot
//
// The outfitter scores a tower's gear by its line skill's standard damage per second with
// the gear on (+skills raise the skill, melee towers swing the weapon with its enhanced
// damage, attack and cast speed shorten the interval), so it dresses each class the way
// the stat mapping rewards. Aura and summon skills, which have no standard damage, score
// by their +skills and speed.

import { activeSkill } from '../src/sim/sim.ts';
import type { GameData } from '../src/sim/data.ts';
import { standardDps } from '../src/sim/dps.ts';
import { SLOTS, isType, maxSocketsAt, type ItemData } from '../src/sim/items/data.ts';
import { rollKillDrops } from '../src/sim/items/drops.ts';
import type { Gear } from '../src/sim/items/gear.ts';
import { canWear, propertyStats, type Item } from '../src/sim/items/item.ts';
import { gearOf, plusLevels, withGear } from '../src/sim/items/tower.ts';
import { createRng } from '../src/sim/rng.ts';
import type { Command, Sim, Tower } from '../src/sim/state.ts';

export type LootSet = 'none' | 'nm' | 'hell' | 'bis';
export const LOOT_SETS: LootSet[] = ['none', 'nm', 'hell', 'bis'];

/** Every drop of one pass through the campaign's waves up to a difficulty (0 Normal, 2 Hell). */
export function campaignLoot(data: GameData, upTo: number, seed = 7): Item[] {
  const rng = createRng(seed);
  const out: Item[] = [];
  let n = 0;
  for (const wave of data.waves) {
    if (wave.difficulty > upTo || wave.tier) continue;
    for (const g of wave.groups) {
      const def = data.monsters[g.monster]!;
      const tc = g.rank === 'champion' ? def.treasure[1] : g.rank === 'unique' ? def.treasure[2] : def.treasure[0];
      if (!tc) continue;
      for (let k = 0; k < g.count; k++) {
        out.push(
          ...rollKillDrops(data.items, rng, {
            tc,
            ctx: { mlvl: def.level, magicFind: 0, runePct: data.drops.runeMultiplierPct, noDropPct: 100 },
            hammerPpm: 0,
            uid: `loot${n++}`,
          }),
        );
      }
    }
  }
  // What a tower could wear: gems, runes and jewels stay in the bag
  return out.filter((i) => (data.items.bases[i.code]?.slots.length ?? 0) > 0);
}

/** Every unique, set item and runeword at its best rolls, at item level 99. */
export function bisCatalogue(data: ItemData): Item[] {
  const out: Item[] = [];
  const best = (props: { code: string; param: string; min: number; max: number }[]) => props.flatMap((p) => propertyStats(data, p, undefined, 99));
  for (const u of data.uniques) {
    const stats = best(u.props);
    const sockets = stats.filter((s) => s.stat === 'item_numsockets').reduce((n, s) => n + s.value, 0);
    out.push({ uid: `bis-u-${u.id}`, code: u.code, quality: 'unique', unique: u.id, ilvl: 99, sockets, socketed: [], stats });
  }
  for (const s of data.setItems) {
    out.push({ uid: `bis-s-${s.id}`, code: s.code, quality: 'set', setItem: s.id, ilvl: 99, sockets: 0, socketed: [], stats: best(s.props) });
  }
  for (const rw of data.runewords) {
    // The best base that takes it: the right type, enough sockets at item level 99, the most damage or defence
    const bases = Object.values(data.bases).filter(
      (b) => !b.consumable && rw.itypes.some((t) => isType(data, b, t)) && !rw.etypes.some((t) => isType(data, b, t)) && maxSocketsAt(b, 99) >= rw.runes.length,
    );
    const base = bases.sort((a, b) => b.maxDamage + b.maxAc - (a.maxDamage + a.maxAc))[0];
    if (!base) continue;
    const runes = rw.runes.map((r, k): Item => ({ uid: `bis-r-${rw.id}-${k}`, code: r, quality: 'normal', ilvl: 99, sockets: 0, socketed: [], stats: [] }));
    out.push({ uid: `bis-w-${rw.id}`, code: base.code, quality: 'runeword', runeword: rw.id, ilvl: 99, sockets: rw.runes.length, socketed: runes, stats: best(rw.props) });
  }
  return out;
}

/** How good a tower is in some gear: its geared skill's damage per second, or its +skills and speed for auras and summons. */
export function gearScore(sim: Sim, tower: Tower, gear: Gear): number {
  const t: Tower = { ...tower, gear };
  const active = activeSkill(sim, t);
  if (!active) return 0;
  const g = gearOf(sim, t);
  const buff = withGear({ damagePct: 0, attackSpeedPct: 0, fireMin: 0, fireMax: 0 }, g, active.skill);
  const dps = standardDps(active.skill, active.lvl);
  const plus = plusLevels(sim, g, active.skill);
  // A tie-break so gold and magic find fill a slot nothing else wants
  const extra = g.goldFindPct + g.magicFindPct + g.defense / 50;
  if (dps <= 0) return (plus * 100 + buff.attackSpeedPct) * 1000 + extra;
  const adds = Object.values(g.adds).reduce((n, [a, b]) => n + (a + b) * 128, 0);
  return Math.trunc(((dps + (active.skill.archetype === 'melee' ? adds : 0)) * (100 + buff.attackSpeedPct) * (100 + buff.damagePct)) / 10_000) + extra;
}

/**
 * Dresses the player's towers from a pool: for each tower and slot, the item that raises
 * its score most goes on (through the stash, as a player would). `reuse` keeps items in
 * the pool once worn (the best-in-slot catalogue); otherwise each item goes on one tower.
 * Returns the commands to send this tick.
 */
export function outfit(sim: Sim, pool: Item[], reuse: boolean): Command[] {
  const data = sim.data.items;
  const commands: Command[] = [];
  for (const tower of sim.state.towers) {
    if (tower.owner !== 0 || !activeSkill(sim, tower)) continue;
    let gear: Gear = { ...tower.gear };
    for (const slot of SLOTS) {
      const others = { ...gear };
      delete others[slot];
      const now = gearScore(sim, tower, gear);
      let best: Item | undefined;
      let bestScore = now;
      for (const item of pool) {
        if (!canWear(data, item, slot, tower.cls, others)) continue;
        const score = gearScore(sim, tower, { ...others, [slot]: item });
        if (score > bestScore) {
          best = item;
          bestScore = score;
        }
      }
      if (!best) continue;
      const old = gear[slot];
      if (old) {
        commands.push({ type: 'unequip', towerId: tower.id, slot, toStash: true });
        if (!reuse) pool.push(old);
      }
      // Each copy from the catalogue gets its own uid, so two towers can wear the same thing
      const item = reuse ? { ...best, uid: `${best.uid}-${tower.id}-${slot}` } : best;
      if (!reuse) pool.splice(pool.indexOf(best), 1);
      commands.push({ type: 'equip', towerId: tower.id, slot, item });
      gear = { ...others, [slot]: item };
    }
  }
  return commands;
}

/** The pool a loot set starts with. */
export function lootPool(data: GameData, set: LootSet): { pool: Item[]; reuse: boolean } {
  if (set === 'nm') return { pool: campaignLoot(data, 1), reuse: false };
  if (set === 'hell') return { pool: campaignLoot(data, 2), reuse: false };
  if (set === 'bis') return { pool: bisCatalogue(data.items), reuse: true };
  return { pool: [], reuse: false };
}

