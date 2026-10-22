// Our authored design data, bundled with static imports so Vite, Vitest and tsx all load
// it the same way. A new skill is a JSON file in skills/ plus one line here; a test fails
// if a file in skills/ is missing from this list.

import type { SkillJson } from '../sim/archetypes/types.ts';
import type { BalanceJson, ClassJson, DesignData, EvolutionJson, MonstersJson } from '../sim/data.ts';
import balance from './balance.json';
import amazon from './classes/amazon.json';
import assassin from './classes/assassin.json';
import barbarian from './classes/barbarian.json';
import druid from './classes/druid.json';
import necromancer from './classes/necromancer.json';
import paladin from './classes/paladin.json';
import sorceress from './classes/sorceress.json';
import evolutions from './evolutions.json';
import monsters from './monsters.json';
import amplifyDamage from './skills/amplify-damage.json';
import bash from './skills/bash.json';
import battleOrders from './skills/battle-orders.json';
import deathSentryBlast from './skills/death-sentry-blast.json';
import deathSentryBolt from './skills/death-sentry-bolt.json';
import lightningSentryBolt from './skills/lightning-sentry-bolt.json';
import phoenixIce from './skills/phoenix-ice.json';
import phoenixLightning from './skills/phoenix-lightning.json';
import phoenixMeteor from './skills/phoenix-meteor.json';
import shout from './skills/shout.json';
import battleCry from './skills/battle-cry.json';
import berserk from './skills/berserk.json';
import concentrate from './skills/concentrate.json';
import criticalStrike from './skills/critical-strike.json';
import doubleSwing from './skills/double-swing.json';
import findItem from './skills/find-item.json';
import frenzy from './skills/frenzy.json';
import arcticBlast from './skills/arctic-blast.json';
import cloakOfShadows from './skills/cloak-of-shadows.json';
import deathSentry from './skills/death-sentry.json';
import dragonTalon from './skills/dragon-talon.json';
import fireBlast from './skills/fire-blast.json';
import lightningSentry from './skills/lightning-sentry.json';
import mindBlast from './skills/mind-blast.json';
import phoenixStrike from './skills/phoenix-strike.json';
import shadowMaster from './skills/shadow-master.json';
import tigerStrike from './skills/tiger-strike.json';
import direWolf from './skills/dire-wolf.json';
import firestorm from './skills/firestorm.json';
import fissure from './skills/fissure.json';
import grizzly from './skills/grizzly.json';
import hurricane from './skills/hurricane.json';
import raven from './skills/raven.json';
import tornado from './skills/tornado.json';
import volcano from './skills/volcano.json';
import warCry from './skills/war-cry.json';
import whirlwind from './skills/whirlwind.json';
import decoy from './skills/decoy.json';
import lightningFury from './skills/lightning-fury.json';
import magicArrow from './skills/magic-arrow.json';
import multipleShot from './skills/multiple-shot.json';
import pierceSkill from './skills/pierce.json';
import plagueJavelin from './skills/plague-javelin.json';
import poisonJavelin from './skills/poison-javelin.json';
import strafe from './skills/strafe.json';
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
  // Amazon
  magicArrow,
  multipleShot,
  strafe,
  poisonJavelin,
  lightningFury,
  plagueJavelin,
  criticalStrike,
  pierceSkill,
  decoy,
  // Barbarian
  bash,
  concentrate,
  berserk,
  doubleSwing,
  frenzy,
  whirlwind,
  battleCry,
  warCry,
  findItem,
  shout,
  battleOrders,
  // Druid
  firestorm,
  fissure,
  volcano,
  arcticBlast,
  tornado,
  hurricane,
  raven,
  direWolf,
  grizzly,
  // Assassin
  fireBlast,
  lightningSentry,
  deathSentry,
  tigerStrike,
  dragonTalon,
  phoenixStrike,
  cloakOfShadows,
  mindBlast,
  shadowMaster,
  // Cast by the Assassin's traps and Phoenix Strike, never picked
  lightningSentryBolt,
  deathSentryBolt,
  deathSentryBlast,
  phoenixMeteor,
  phoenixLightning,
  phoenixIce,
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
  classes: [paladin as ClassJson, sorceress as ClassJson, necromancer as ClassJson, amazon as ClassJson, barbarian as ClassJson, druid as ClassJson, assassin as ClassJson],
  evolutions: evolutions as Record<string, EvolutionJson>,
  monsters: monsters as MonstersJson,
  balance: balance as unknown as BalanceJson,
};
