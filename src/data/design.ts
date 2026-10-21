// Our authored design data, bundled with static imports so Vite, Vitest and tsx all load
// it the same way. A new skill is a JSON file in skills/ plus one line here; a test fails
// if a file in skills/ is missing from this list.

import type { SkillJson } from '../sim/archetypes/types.ts';
import type { BalanceJson, ClassJson, DesignData, EvolutionJson, MonstersJson } from '../sim/data.ts';
import balance from './balance.json';
import necromancer from './classes/necromancer.json';
import paladin from './classes/paladin.json';
import sorceress from './classes/sorceress.json';
import evolutions from './evolutions.json';
import monsters from './monsters.json';
import amplifyDamage from './skills/amplify-damage.json';
import blessedHammer from './skills/blessed-hammer.json';
import blizzard from './skills/blizzard.json';
import boneSpear from './skills/bone-spear.json';
import boneSpirit from './skills/bone-spirit.json';
import chainLightning from './skills/chain-lightning.json';
import chargedBolt from './skills/charged-bolt.json';
import concentration from './skills/concentration.json';
import conviction from './skills/conviction.json';
import corpseExplosion from './skills/corpse-explosion.json';
import decrepify from './skills/decrepify.json';
import enchant from './skills/enchant.json';
import fanaticism from './skills/fanaticism.json';
import fireBall from './skills/fire-ball.json';
import fireBolt from './skills/fire-bolt.json';
import fistOfTheHeavens from './skills/fist-of-the-heavens.json';
import frozenOrb from './skills/frozen-orb.json';
import glacialSpike from './skills/glacial-spike.json';
import holyBolt from './skills/holy-bolt.json';
import holyFreeze from './skills/holy-freeze.json';
import iceBolt from './skills/ice-bolt.json';
import lightning from './skills/lightning.json';
import lowerResist from './skills/lower-resist.json';
import meteor from './skills/meteor.json';
import might from './skills/might.json';
import poisonNova from './skills/poison-nova.json';
import raiseSkeletalMage from './skills/raise-skeletal-mage.json';
import raiseSkeleton from './skills/raise-skeleton.json';
import revive from './skills/revive.json';
import sacrifice from './skills/sacrifice.json';
import staticField from './skills/static-field.json';
import teeth from './skills/teeth.json';
import thunderStorm from './skills/thunder-storm.json';
import vengeance from './skills/vengeance.json';
import zeal from './skills/zeal.json';

export const SKILL_JSON = [
  // Paladin
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
  // Sorceress
  fireBolt,
  fireBall,
  meteor,
  iceBolt,
  glacialSpike,
  blizzard,
  frozenOrb,
  chargedBolt,
  lightning,
  chainLightning,
  staticField,
  enchant,
  thunderStorm,
  // Necromancer
  raiseSkeleton,
  raiseSkeletalMage,
  revive,
  teeth,
  boneSpear,
  corpseExplosion,
  boneSpirit,
  poisonNova,
  amplifyDamage,
  decrepify,
  lowerResist,
] as SkillJson[];

export const DESIGN: DesignData = {
  skills: SKILL_JSON,
  classes: [paladin as ClassJson, sorceress as ClassJson, necromancer as ClassJson],
  evolutions: evolutions as Record<string, EvolutionJson>,
  monsters: monsters as MonstersJson,
  balance: balance as unknown as BalanceJson,
};
