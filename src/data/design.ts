// Our authored design data, bundled with static imports so Vite, Vitest and tsx all load
// it the same way. A new skill is a JSON file in skills/ plus one line here; a test fails
// if a file in skills/ is missing from this list.

import type { SkillJson } from '../sim/archetypes/types.ts';
import type { BalanceJson, ClassJson, DesignData, EvolutionJson, MonstersJson } from '../sim/data.ts';
import balance from './balance.json';
import paladin from './classes/paladin.json';
import evolutions from './evolutions.json';
import monsters from './monsters.json';
import blessedHammer from './skills/blessed-hammer.json';
import blizzard from './skills/blizzard.json';
import boneSpear from './skills/bone-spear.json';
import chainLightning from './skills/chain-lightning.json';
import concentration from './skills/concentration.json';
import conviction from './skills/conviction.json';
import corpseExplosion from './skills/corpse-explosion.json';
import fanaticism from './skills/fanaticism.json';
import fistOfTheHeavens from './skills/fist-of-the-heavens.json';
import holyBolt from './skills/holy-bolt.json';
import holyFreeze from './skills/holy-freeze.json';
import might from './skills/might.json';
import raiseSkeleton from './skills/raise-skeleton.json';
import sacrifice from './skills/sacrifice.json';
import vengeance from './skills/vengeance.json';
import zeal from './skills/zeal.json';

export const SKILL_JSON = [
  sacrifice,
  zeal,
  vengeance,
  holyBolt,
  blessedHammer,
  fistOfTheHeavens,
  might,
  concentration,
  holyFreeze,
  fanaticism,
  conviction,
  boneSpear,
  chainLightning,
  blizzard,
  raiseSkeleton,
  corpseExplosion,
] as SkillJson[];

export const DESIGN: DesignData = {
  skills: SKILL_JSON,
  classes: [paladin as ClassJson],
  evolutions: evolutions as Record<string, EvolutionJson>,
  monsters: monsters as MonstersJson,
  balance: balance as BalanceJson,
};
