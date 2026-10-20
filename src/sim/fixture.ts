// Test fixture tables. Every number here is invented so tests run without game files;
// none of them are D2 stats. The rows have the same shape as the real tables (column
// names, calc expressions) so every archetype resolves through the same code paths.
// Real numbers come from assets-extracted/data.

import { DESIGN } from '../data/design.ts';
import { buildGameData, type DesignData, type GameData, type TableRow, type Tables } from './data.ts';

function damageCols(prefix: 'skill' | 'missile', min: number, max: number, step: number): TableRow {
  const row: TableRow = { EMin: min, EMax: max, HitShift: 8 };
  for (let i = 1; i <= 5; i++) {
    row[prefix === 'skill' ? `EMinLev${i}` : `MinELev${i}`] = step * i;
    row[prefix === 'skill' ? `EMaxLev${i}` : `MaxELev${i}`] = step * i;
  }
  return row;
}

const params = (...p: number[]): TableRow => Object.fromEntries(p.map((v, i) => [`Param${i + 1}`, v]));

const skill = (name: string, extra: TableRow): TableRow => ({ skill: name, HitShift: 8, ...extra });

const monster = (Id: string, MonType: string, extra: TableRow): TableRow => ({
  Id,
  NameStr: Id,
  MonType,
  Level: 1,
  minHP: 100,
  maxHP: 150,
  A1MinD: 50,
  A1MaxD: 100,
  Velocity: 3,
  ...extra,
});

export const FIXTURE_TABLES: Tables = {
  monstats: [
    monster('fallen1', 'fallen', { Velocity: 5, demon: 1 }),
    monster('fallenshaman1', 'fallen', { Level: 2, demon: 1, ResFi: 20, aidel: 15, aip1: 50, aip4: 24 }),
    monster('zombie1', 'zombie', { Velocity: 2, lUndead: 1, ResPo: 50 }),
    monster('skeleton1', 'skeleton', { Level: 2, lUndead: 1 }),
    monster('quillrat1', 'quillrat', { Velocity: 4 }),
    monster('corruptrogue1', 'corruptrogue', { Level: 2, Velocity: 4, demon: 1, ResMa: 20 }),
    monster('fallen4', 'fallen', { Level: 5, Velocity: 6, demon: 1 }),
    monster('brute1', 'brute', { Level: 2, minHP: 200, maxHP: 250 }),
    monster('bloodraven', 'corruptrogue', { Level: 6, minHP: 400, maxHP: 400, demon: 1, boss: 1, ResMa: 50, ResFi: 50 }),
    monster('andariel', 'demon', { Level: 8, minHP: 900, maxHP: 900, demon: 1, boss: 1, ResPo: 100, ResFi: -50 }),
    monster('necroskeleton', 'skeleton', { minHP: 20, maxHP: 20, A1MinD: 2, A1MaxD: 4, lUndead: 1 }),
  ],
  monlvl: Array.from({ length: 41 }, (_, Level) => ({ Level, HP: 5 + Level * 4, DM: 2 + Level })),
  monumod: [
    { '*constant desc': 'Champion HP % Bonus', constants: 100 },
    { '*constant desc': 'Unique HP % Bonus', constants: 200 },
    { '*constant desc': 'Champion Damage % Bonus', constants: 50 },
  ],
  monseq: Array.from({ length: 15 }, (_, frame) => ({ sequence: 'seq_shamanresurrect', mode: 'A2', frame })),
  weapons: [{ name: 'Crystal Sword', mindam: 4, maxdam: 12 }],
  skills: [
    skill('Sacrifice', { calc1: 'ln12', ...params(100, 10) }),
    skill('Zeal', { calc1: 'min((par5 + lvl -1), par6)', calc2: 'ln34', ...params(0, 0, 5, 5, 2, 4) }),
    skill('Vengeance', { calc1: 'ln12', calc2: 'ln12', calc3: 'ln12', EType: 'cold', ...params(50, 5) }),
    skill('Holy Bolt', { srvmissile: 'holybolt', EType: 'mag', ...damageCols('skill', 10, 20, 2) }),
    skill('Blessed Hammer', { srvmissilea: 'blessedhammer', EType: 'mag', ...damageCols('skill', 12, 16, 3) }),
    skill('Fist of the Heavens', {
      srvmissilea: 'fohdelay',
      EType: 'ltng',
      aurarangecalc: 16,
      localdelay: 10,
      ...damageCols('skill', 100, 120, 10),
    }),
    skill('Might', { aurarangecalc: 'ln12', aurastat1: 'damagepercent', aurastatcalc1: 'ln34', ...params(16, 2, 30, 10) }),
    skill('Concentration', { aurarangecalc: 'ln12', aurastat1: 'damagepercent', aurastatcalc1: 'ln34', ...params(16, 2, 50, 10) }),
    skill('Holy Freeze', {
      aurarangecalc: 'ln12',
      aurastat1: 'velocitypercent',
      aurastatcalc1: '-dm34',
      perdelay: 50,
      EType: 'cold',
      ...params(8, 1, 20, 50),
      ...damageCols('skill', 2, 3, 1),
    }),
    skill('Fanaticism', {
      aurarangecalc: 'ln12',
      aurastat1: 'attackrate',
      aurastatcalc1: 'dm34',
      aurastat3: 'damagepercent',
      aurastatcalc3: 'ln56/2',
      ...params(12, 1, 10, 40, 40, 10),
    }),
    skill('Conviction', {
      aurarangecalc: 20,
      aurastat2: 'fireresist',
      aurastatcalc2: '-min(ln34,150)',
      aurastat3: 'coldresist',
      aurastatcalc3: '-min(ln34,150)',
      aurastat4: 'lightresist',
      aurastatcalc4: '-min(ln34,150)',
      ...params(0, 0, 30, 5),
    }),
    skill('Bone Spear', { srvmissile: 'bonespear', EType: 'mag', ...damageCols('skill', 16, 24, 4) }),
    skill('Chain Lightning', {
      srvmissilea: 'chainlightning',
      EType: 'ltng',
      aurarangecalc: 'par1',
      calc1: 'ln34/par5',
      ...params(20, 0, 15, 5, 5),
      ...damageCols('skill', 10, 30, 5),
    }),
    skill('Blizzard', { srvmissilea: 'blizzardcenter', EType: 'cold', localdelay: 45, ...damageCols('skill', 30, 40, 5) }),
    skill('Raise Skeleton', {
      summon: 'necroskeleton',
      petmax: '(lvl < 4) ?lvl:(2+lvl/3)',
      aurastat1: 'damagepercent',
      aurastatcalc1: '((lvl < 4) ? 0 : ((lvl-3)*par3))',
      ...params(0, 0, 5),
      EMin: 0,
    }),
    skill('Corpse Explosion', {
      aurarangecalc: 'ln34',
      calc1: 'par1',
      calc2: 'par2',
      calc3: 'par5',
      EType: 'fire',
      ...params(60, 100, 8, 1, 50),
    }),
  ],
  missiles: [
    { Missile: 'holybolt', Vel: 15, Range: 50, pSrvDmgFunc: 15, sHitPar2: 3, dParam1: 0 },
    { Missile: 'blessedhammer', Vel: 18, Range: 100, pSrvDmgFunc: 5, dParam1: 50, dParam2: 50 },
    { Missile: 'fohdelay', Range: 10 },
    { Missile: 'fohbolt', EType: 'mag', pSrvDmgFunc: 15, sHitPar2: 3, dParam1: 0, HitShift: 8, ...damageCols('missile', 20, 30, 2) },
    { Missile: 'bonespear', Vel: 20, Range: 40 },
    { Missile: 'chainlightning', Vel: 30, Range: 20 },
    { Missile: 'blizzardcenter', Range: 100 },
  ],
};

/** Design data pointed at the fixture's missile names where they differ from the real ones. */
export function fixtureDesign(design: DesignData = DESIGN): DesignData {
  return {
    ...design,
    skills: design.skills.map((s) =>
      s.id === 'fist-of-the-heavens'
        ? { ...s, splash: { ...(s['splash'] as object), subMissile: { missile: 'fohbolt', radiusCalc: 'aurarangecalc' } } }
        : s,
    ),
  };
}

/**
 * The skill JSON tierBonus values are computed from the real tables, so the fixture's
 * invented numbers need their own; skip the stored-value check and use the computed ones.
 */
export const FIXTURE_BUILD = { checkTierBonus: false };

export function fixtureGameData(waveCount?: number): GameData {
  return buildGameData(FIXTURE_TABLES, fixtureDesign(), waveCount, FIXTURE_BUILD);
}
