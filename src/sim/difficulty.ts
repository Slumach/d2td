// Difficulty names and the ids of a monster's Nightmare and Hell entries.

/**
 * D2's three difficulties. A monster's Nightmare and Hell stats are their own entries,
 * keyed `${id}@nightmare` and `${id}@hell`, so the sim reads them like any other monster.
 */
export const DIFFICULTIES = ['normal', 'nightmare', 'hell'] as const;
export type DifficultyName = (typeof DIFFICULTIES)[number];
export const DIFFICULTY_NAMES = ['Normal', 'Nightmare', 'Hell'] as const;

export function variantId(id: string, difficulty: number): string {
  return difficulty === 0 ? id : `${id}@${DIFFICULTIES[difficulty]}`;
}

/** A monster raised to a level of its own on a difficulty (the placeholder acts): `${id}@${difficulty}:${level}`. */
export function levelVariantId(id: string, difficulty: number, level: number): string {
  return `${id}@${DIFFICULTIES[difficulty]}:${level}`;
}

/** The monster or boss id behind a difficulty variant: what leak costs and bounties key on. */
export function baseMonsterId(def: string): string {
  const at = def.indexOf('@');
  return at < 0 ? def : def.slice(0, at);
}
