// mulberry32: a 32-bit seeded integer RNG. Its whole state is one uint32, stored in the
// sim state so it is hashed and replayed with everything else.

export interface Rng {
  state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** Next raw uint32. */
export function nextU32(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Uniform integer in [min, max], inclusive. */
export function rollInt(rng: Rng, min: number, max: number): number {
  if (max <= min) return min;
  return min + (nextU32(rng) % (max - min + 1));
}
