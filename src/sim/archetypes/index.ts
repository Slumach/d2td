// The ten archetypes. Every skill is data on one of these; there is no per-skill code.

import { buffAura } from './buffAura.ts';
import { control } from './control.ts';
import { corpse } from './corpse.ts';
import { debuff } from './debuff.ts';
import { melee } from './melee.ts';
import { pierce } from './pierce.ts';
import { projectile } from './projectile.ts';
import { splash } from './splash.ts';
import type { ArchetypeId, ArchetypeModule, SkillDef } from './types.ts';
import { summon } from './summon.ts';
import { zone } from './zone.ts';

export const ARCHETYPES: Record<ArchetypeId, ArchetypeModule> = {
  projectile,
  pierce,
  splash,
  zone,
  melee,
  control,
  buffAura,
  debuff,
  summon,
  corpse,
} as unknown as Record<ArchetypeId, ArchetypeModule>;

export function archetypeOf(skill: SkillDef): ArchetypeModule {
  return ARCHETYPES[skill.archetype];
}
