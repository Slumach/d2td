// The relay checks every command before it goes into a bundle. A malformed command would
// reach every player's sim at the same tick, so one bad client must not be able to send one.

import type { Command, Targeting } from '../sim/state.ts';
import { TARGETING_MODES } from '../sim/state.ts';

const int = (v: unknown, max = 1_000_000_000): boolean => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
const str = (v: unknown): boolean => typeof v === 'string' && v.length > 0 && v.length <= 64;

/** The command if it is well formed, else null. Rebuilt field by field so no extra data rides along. */
export function validCommand(v: unknown): Command | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  switch (c['type']) {
    case 'build':
      if (!int(c['x'], 1000) || !int(c['y'], 1000) || !str(c['cls']) || (c['skill'] !== undefined && !str(c['skill']))) return null;
      return { type: 'build', x: c['x'] as number, y: c['y'] as number, cls: c['cls'] as string, ...(c['skill'] !== undefined ? { skill: c['skill'] as string } : {}) };
    case 'pickSkill':
    case 'pickBranch':
      if (!int(c['towerId']) || !str(c['skill'])) return null;
      return { type: c['type'], towerId: c['towerId'] as number, skill: c['skill'] as string };
    case 'upgrade':
    case 'upgradeTier':
    case 'sell':
      if (!int(c['towerId'])) return null;
      return { type: c['type'], towerId: c['towerId'] as number };
    case 'setTargeting':
      if (!int(c['towerId']) || !TARGETING_MODES.includes(c['mode'] as never)) return null;
      return { type: 'setTargeting', towerId: c['towerId'] as number, mode: c['mode'] as Targeting };
    case 'evolve':
      if (!int(c['towerA']) || !int(c['towerB'])) return null;
      return { type: 'evolve', towerA: c['towerA'] as number, towerB: c['towerB'] as number };
    case 'callWave':
      return { type: 'callWave' };
    default:
      return null;
  }
}
