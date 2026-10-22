// Missile helpers shared by the archetypes: creation, homing, integer trig.

import type { TowerBuff } from './archetypes/types.ts';
import { actorGear, distSq, type Point } from './combat.ts';
import { UNITS_PER_TILE, idiv, isqrt } from './fixed.ts';
import { rollInt } from './rng.ts';
import type { Missile, Monster, Sim, Tower } from './state.ts';

/** A line missile hits anything within this distance of its centre. */
export const LINE_HIT_RADIUS = (UNITS_PER_TILE * 4) / 10;

/** cos(2 pi k / 64) * 1024, hardcoded so every JS engine agrees to the bit. */
const COS64 = [
  1024, 1019, 1004, 980, 946, 903, 851, 792, 724, 650, 569, 483, 392, 297, 200, 100, 0, -100, -200, -297, -392, -483,
  -569, -650, -724, -792, -851, -903, -946, -980, -1004, -1019, -1024, -1019, -1004, -980, -946, -903, -851, -792,
  -724, -650, -569, -483, -392, -297, -200, -100, 0, 100, 200, 297, 392, 483, 569, 650, 724, 792, 851, 903, 946, 980,
  1004, 1019,
];

export const TRIG_STEPS = 64;
export const TRIG_SCALE = 1024;

export function cos64(step: number): number {
  return COS64[((step % TRIG_STEPS) + TRIG_STEPS) % TRIG_STEPS]!;
}

export function sin64(step: number): number {
  return cos64(step - TRIG_STEPS / 4);
}

export function spawnMissile(sim: Sim, tower: Tower, skill: string, lvl: number, buff: TowerBuff, init: Partial<Missile>): Missile {
  const s = sim.state;
  const missile: Missile = {
    id: s.nextId++,
    skill,
    towerId: tower.id,
    level: lvl,
    damagePct: buff.damagePct,
    fireMin: buff.fireMin,
    fireMax: buff.fireMax,
    x: tower.x,
    y: tower.y,
    ox: tower.x,
    oy: tower.y,
    vx: 0,
    vy: 0,
    targetId: 0,
    age: 0,
    ticksLeft: 1,
    hits: [],
    remaining: 0,
    value: 0,
    ...init,
  };
  s.missiles.push(missile);
  return missile;
}

export function targetOf(sim: Sim, missile: Missile): Monster | undefined {
  return sim.state.monsters.find((m) => m.id === missile.targetId && m.hp > 0);
}

/** Moves straight at the target. Returns true when it arrives this tick. */
export function homeToward(missile: Missile, target: { x: number; y: number }, speed: number): boolean {
  const d = isqrt(distSq(missile, target));
  if (d <= speed) {
    missile.x = target.x;
    missile.y = target.y;
    return true;
  }
  missile.x += idiv((target.x - missile.x) * speed, d);
  missile.y += idiv((target.y - missile.y) * speed, d);
  return false;
}

/**
 * Item pierce, after a bolt hits `hit`: when the firing tower's pierce chance rolls, the
 * bolt flies on along the line it was travelling (`from` is where it was a tick ago) and
 * hits what it meets, no longer homing. Returns true when it flies on.
 */
export function pierceOn(sim: Sim, missile: Missile, hit: Monster, from: Point, speed: number): boolean {
  const g = actorGear(sim);
  if (g.piercePct <= 0 || rollInt(sim.state.rng, 0, 99) >= g.piercePct) return false;
  if (!missile.hits.includes(hit.id)) missile.hits.push(hit.id);
  if (missile.targetId !== 0) {
    const origin = distSq(from, missile) > 0 ? from : { x: missile.ox, y: missile.oy };
    const v = velocityToward(origin, missile, speed);
    missile.vx = v.vx;
    missile.vy = v.vy;
    missile.targetId = 0;
  }
  return true;
}

/** A pierced bolt flying on: moves it and strikes what it meets, each hit rolling pierce again. False when it stops. */
export function flyOn(sim: Sim, missile: Missile, speed: number, strikeAt: (m: Monster) => void): boolean {
  const from = { x: missile.x, y: missile.y };
  missile.x += missile.vx;
  missile.y += missile.vy;
  for (const m of [...sim.state.monsters]) {
    if (m.hp <= 0 || missile.hits.includes(m.id) || distSq(missile, m) > LINE_HIT_RADIUS * LINE_HIT_RADIUS) continue;
    strikeAt(m);
    if (!pierceOn(sim, missile, m, from, speed)) return false;
  }
  return true;
}

/** Velocity of `speed` units per tick from `from` toward `to`. */
export function velocityToward(from: { x: number; y: number }, to: { x: number; y: number }, speed: number): { vx: number; vy: number } {
  const d = Math.max(1, isqrt(distSq(from, to)));
  return { vx: idiv((to.x - from.x) * speed, d), vy: idiv((to.y - from.y) * speed, d) };
}
