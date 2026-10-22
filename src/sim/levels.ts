// Tower level and tier limits, in a module with no imports so anything in the sim can read
// them without pulling in the data layer (and its archetypes) behind them.

export const MAX_TOWER_LEVEL = 5;
export const MAX_TIER = 3;
/** Evolved towers attack at this tower level index: T3 level 5 power. */
export const EVOLVED_LEVEL_INDEX = MAX_TOWER_LEVEL - 1;
