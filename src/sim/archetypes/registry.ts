// The archetype modules by id, filled by index.ts as it loads. Code the archetypes
// themselves import (items/tower.ts, for chance to cast) looks skills up here instead of
// importing index.ts, which imports every archetype: that cycle resolves in whichever
// order the first import happens to take, and an archetype can come out undefined.

import type { ArchetypeId, ArchetypeModule, SkillDef } from './types.ts';

const modules: Partial<Record<ArchetypeId, ArchetypeModule>> = {};

export function registerArchetypes(all: Record<ArchetypeId, ArchetypeModule>): void {
  Object.assign(modules, all);
}

export function archetypeOf(skill: SkillDef): ArchetypeModule {
  const module = modules[skill.archetype];
  if (!module) throw new Error(`archetype ${skill.archetype} is not loaded: import archetypes/index.ts first`);
  return module;
}
