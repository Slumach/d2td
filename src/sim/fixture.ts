// Test fixture tables. Every number here is invented so tests run without game files;
// none of them are D2 stats. The rows have the same shape as the real tables (column
// names, calc expressions) so every archetype resolves through the same code paths.
// Real numbers come from assets-extracted/data.

import { DESIGN } from '../data/design.ts';
import { FIXTURE_ITEM_TABLES, FIXTURE_ITEM_WEAPONS } from './items/fixture.ts';
import { buildGameData, type BuildOptions, type DesignData, type GameData, type TableRow, type Tables } from './data.ts';

function damageCols(prefix: 'skill' | 'missile', min: number, max: number, step: number): TableRow {
  const row: TableRow = { EMin: min, EMax: max, HitShift: 8 };
  for (let i = 1; i <= 5; i++) {
    row[prefix === 'skill' ? `EMinLev${i}` : `MinELev${i}`] = step * i;
    row[prefix === 'skill' ? `EMaxLev${i}` : `MaxELev${i}`] = step * i;
  }
  return row;
}

const params = (...p: number[]): TableRow => Object.fromEntries(p.map((v, i) => [`Param${i + 1}`, v]));

const skill = (name: string, extra: TableRow): TableRow => ({ skill: name, skilldesc: name.toLowerCase(), HitShift: 8, ...extra });

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

const HAND_TABLES: Tables = {
  monstats: [
    // Hell columns on a few rows give the difficulty tests immunities to find
    monster('fallen1', 'fallen', { Velocity: 5, demon: 1, 'ResFi(H)': 100 }),
    monster('fallenshaman1', 'fallen', { Level: 2, demon: 1, ResFi: 20, aidel: 15, aip1: 50, aip4: 24, minion1: 'fallen1' }),
    monster('zombie1', 'zombie', { Velocity: 2, lUndead: 1, ResPo: 50, 'ResCo(H)': 120 }),
    monster('skeleton1', 'skeleton', { Level: 2, lUndead: 1, 'ResLi(H)': 100 }),
    monster('quillrat1', 'quillrat', { Velocity: 4, TreasureClass: 'Test Kill', TreasureClassChamp: 'Runes 1' }),
    monster('corruptrogue1', 'corruptrogue', { Level: 2, Velocity: 4, demon: 1, ResMa: 20 }),
    monster('fallen4', 'fallen', { Level: 5, Velocity: 6, demon: 1 }),
    monster('brute1', 'brute', { Level: 2, minHP: 200, maxHP: 250, 'Level(H)': 30, 'A1MinD(H)': 80, 'A1MaxD(H)': 120 }),
    monster('bloodraven', 'corruptrogue', {
      Level: 6, minHP: 400, maxHP: 400, demon: 1, boss: 1, ResMa: 50, ResFi: 50, minion1: 'zombie2', PartyMin: 2, PartyMax: 4,
    }),
    monster('andariel', 'demon', { Level: 8, minHP: 900, maxHP: 900, demon: 1, boss: 1, ResPo: 100, ResFi: -50 }),
    // The rest of the Act 1 schedule: waves, boss classes and packs
    monster('cr_lancer1', 'corruptrogue', { Level: 2, demon: 1 }),
    monster('goatman1', 'goatman', { Level: 3, demon: 1 }),
    monster('foulcrow1', 'bird', { Velocity: 5, minHP: 30, maxHP: 40, flying: 1, 'ResPo(H)': 100 }),
    monster('corruptrogue2', 'corruptrogue', { Level: 4, Velocity: 5, demon: 1 }),
    monster('quillrat2', 'quillrat', { Level: 4, Velocity: 4 }),
    monster('sk_archer1', 'skeleton', { Level: 4, lUndead: 1, ResPo: 50 }),
    monster('goatman2', 'goatman', { Level: 5, demon: 1 }),
    monster('foulcrow2', 'bird', { Level: 5, Velocity: 5, minHP: 30, maxHP: 40, flying: 1 }),
    monster('corruptrogue4', 'corruptrogue', { Level: 7, Velocity: 6, demon: 1 }),
    monster('goatman5', 'goatman', { Level: 8, demon: 1, ResMa: 30 }),
    monster('skmage_fire2', 'skeleton', { Level: 8, lUndead: 1, ResFi: 30 }),
    monster('wraith2', 'wraith', { Level: 8, lUndead: 1, flying: 1, ResDm: 30 }),
    monster('skeleton2', 'skeleton', { Level: 5, lUndead: 1 }),
    monster('bighead2', 'bighead', { Level: 9, demon: 1, ResLi: 60 }),
    monster('zombie3', 'zombie', { Level: 10, Velocity: 2, lUndead: 1 }),
    monster('vampire5', 'vampire', { Level: 10, hUndead: 1, ResCo: 50 }),
    monster('zombie2', 'zombie', { Level: 2, Velocity: 2, lUndead: 1 }),
    monster('cr_archer1', 'corruptrogue', { Level: 3, demon: 1 }),
    monster('quillrat4', 'quillrat', { Level: 7, Velocity: 4 }),
    monster('fallen2', 'fallen', { Level: 4, Velocity: 5, demon: 1, minion1: 'fallen2' }),
    monster('brute2', 'brute', { Level: 4, minHP: 220, maxHP: 260 }),
    monster('corruptrogue3', 'corruptrogue', { Level: 6, Velocity: 6, demon: 1 }),
    monster('griswold', 'zombie', { Level: 5, minHP: 500, maxHP: 500, lUndead: 1, boss: 1, ResPo: 50 }),
    monster('smith', 'smith', { Level: 8, minHP: 300, maxHP: 300, demon: 1 }),
    monster('skmage_pois3', 'skeleton', { Level: 11, lUndead: 1, ResPo: 70 }),
    // Weaker in its table than the act it walks in, so the act's floor lifts it
    monster('sandraider1', 'sandraider', { Level: 3, Velocity: 4 }),
    monster('necroskeleton', 'skeleton', { minHP: 20, maxHP: 20, A1MinD: 2, A1MaxD: 4, lUndead: 1 }),
    monster('necromage', 'skeleton', { minHP: 40, maxHP: 40, A1MinD: 1, A1MaxD: 2, lUndead: 1 }),
  ],
  monlvl: Array.from({ length: 100 }, (_, Level) => ({ Level, HP: 5 + Level * 4, DM: 2 + Level, 'DM(H)': 4 + Level * 2 })),
  monumod: [
    ...[['strong', 5], ['fast', 6], ['curse', 7], ['resist', 8], ['fire', 9], ['lightning', 17], ['cold', 18], ['spectralhit', 27]].map(([uniquemod, id]) => ({ uniquemod: uniquemod!, id: id! })),
    { '*constant desc': 'Champion HP % Bonus', constants: 100 },
    { '*constant desc': 'Unique HP % Bonus', constants: 200 },
    { '*constant desc': 'Champion Damage % Bonus', constants: 50 },
  ],
  monseq: Array.from({ length: 15 }, (_, frame) => ({ sequence: 'seq_shamanresurrect', mode: 'A2', frame })),
  weapons: [{ name: 'Crystal Sword', mindam: 4, maxdam: 12 }, ...FIXTURE_ITEM_WEAPONS],
  monstrings: [],
  ...FIXTURE_ITEM_TABLES,
  levels: [1, 2, 3, 4, 5].flatMap((act) =>
    [0, 1, 2].map((i) => ({ Name: `act${act}-${i}`, Act: act - 1, mon1: 'zombie1', MonLvlEx: act * 5 + i, 'MonLvlEx(N)': 30 + act * 3 + i, 'MonLvlEx(H)': 34 + act * 2 + i })),
  ),
  superuniques: [
    { Superunique: 'Corpsefire', Name: 'Corpsefire', Class: 'zombie1', Mod1: 27, MinGrp: 2, MaxGrp: 2 },
    { Superunique: 'Bishibosh', Name: 'Bishibosh', Class: 'fallenshaman1', Mod1: 8, MinGrp: 1, MaxGrp: 3 },
    { Superunique: 'Bonebreak', Name: 'Bonebreak', Class: 'skeleton1', Mod1: 5, MinGrp: 2, MaxGrp: 2 },
    { Superunique: 'Coldcrow', Name: 'Coldcrow', Class: 'cr_archer1', Mod1: 18, MinGrp: 3, MaxGrp: 3 },
    { Superunique: 'Flamespike the Crawler', Name: 'Flamespike the Crawler', Class: 'quillrat4', Mod1: 9, MinGrp: 4, MaxGrp: 4 },
    { Superunique: 'Pitspawn Fouldog', Name: 'Pitspawn Fouldog', Class: 'bighead2', Mod1: 7, MinGrp: 2, MaxGrp: 2 },
    { Superunique: 'Rakanishu', Name: 'Rakanishu', Class: 'fallen2', Mod1: 17, MinGrp: 3, MaxGrp: 5 },
    { Superunique: 'Treehead WoodFist', Name: 'Treehead WoodFist', Class: 'brute2', Mod1: 5, MinGrp: 2, MaxGrp: 2 },
    { Superunique: 'The Countess', Name: 'The Countess', Class: 'corruptrogue3', Mod1: 9, MinGrp: 1, MaxGrp: 3 },
    { Superunique: 'Griswold', Name: 'Griswold', Class: 'griswold', Mod1: 7 },
    { Superunique: 'The Smith', Name: 'The Smith', Class: 'smith', Mod1: 6 },
    { Superunique: 'Boneash', Name: 'Boneash', Class: 'skmage_pois3', Mod1: 8, Mod2: 18 },
  ],
  // Skill tree pages for the fixture's tabbed skills (skilldesc.txt SkillPage): Holy Bolt on
  // the Paladin's combat tab (1), Might on his offensive auras (2)
  skilldesc: [
    { skilldesc: 'holy bolt', SkillPage: 1 },
    { skilldesc: 'might', SkillPage: 2 },
  ],
  skills: [
    skill('Sacrifice', { calc1: 'ln12', ...params(100, 10) }),
    skill('Zeal', { calc1: 'min((par5 + lvl -1), par6)', calc2: 'ln34', ...params(0, 0, 5, 5, 2, 4) }),
    skill('Vengeance', { calc1: 'ln12', calc2: 'ln12', calc3: 'ln12', EType: 'cold', ...params(50, 5) }),
    skill('Holy Bolt', { charclass: 'pal', srvmissile: 'holybolt', EType: 'mag', ...damageCols('skill', 10, 20, 2) }),
    skill('Blessed Hammer', { srvmissilea: 'blessedhammer', EType: 'mag', ...damageCols('skill', 12, 16, 3) }),
    skill('Fist of the Heavens', {
      srvmissilea: 'fohdelay',
      EType: 'ltng',
      aurarangecalc: 16,
      localdelay: 10,
      ...damageCols('skill', 100, 120, 10),
    }),
    skill('Might', { charclass: 'pal', aurarangecalc: 'ln12', aurastat1: 'damagepercent', aurastatcalc1: 'ln34', ...params(16, 2, 30, 10) }),
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
    skill('Blizzard', {
      srvmissilea: 'blizzardcenter',
      EType: 'cold',
      localdelay: 45,
      calc1: 'par1',
      ELen: 25,
      ...params(12),
      ...damageCols('skill', 30, 40, 5),
    }),
    skill('Fire Bolt', { srvmissile: 'firebolt', EType: 'fire', ...damageCols('skill', 8, 12, 2) }),
    skill('Fire Ball', { srvmissile: 'fireball', EType: 'fire', calc1: 'par1', ...params(8), ...damageCols('skill', 16, 24, 3) }),
    skill('Meteor', { srvmissilea: 'meteorcenter', EType: 'fire', calc1: 'ln12', localdelay: 20, ...params(8, 1), ...damageCols('skill', 60, 80, 8) }),
    skill('Ice Bolt', { srvmissile: 'icebolt', EType: 'cold', ELen: 50, ELevLen1: 5, ELevLen2: 5, ELevLen3: 5, ...damageCols('skill', 6, 10, 2) }),
    skill('Glacial Spike', {
      srvmissile: 'glacialspike',
      EType: 'cold',
      aurarangecalc: 'ln12',
      auralencalc: 'ln34',
      ...params(6, 0, 25, 2),
      ...damageCols('skill', 14, 20, 3),
    }),
    skill('Frozen Orb', { srvmissile: 'frozenorb', EType: 'cold', ELen: 50, localdelay: 20, ...damageCols('skill', 20, 30, 4) }),
    skill('Charged Bolt', { srvmissilea: 'chargedbolt', EType: 'ltng', calc1: 'min(24,ln12)', ...params(3, 1), ...damageCols('skill', 4, 8, 1) }),
    skill('Lightning', { srvmissile: 'lightningbolt', EType: 'ltng', ...damageCols('skill', 1, 40, 6) }),
    skill('Static Field', { aurarangecalc: 'ln12', calc1: 'par4', calc2: 'par3', EType: 'ltng', ...params(17, 2, 0, 25) }),
    skill('Enchant', {
      aurastat1: 'firemindam',
      aurastatcalc1: 'enma',
      aurastat2: 'firemaxdam',
      aurastatcalc2: 'exma',
      EType: 'fire',
      ...damageCols('skill', 4, 6, 1),
    }),
    skill('Thunder Storm', {
      srvmissilea: 'thunderstorm1',
      EType: 'ltng',
      perdelay: '(100-dm56) * par4/100 + par3',
      ...params(0, 0, 25, 100, 0, 100),
      ...damageCols('skill', 1, 60, 10),
    }),
    skill('Raise Skeletal Mage', { summon: 'necromage', petmax: '(lvl < 4) ?lvl:(2+lvl/3)', sumsk1calc: 'max(lvl/2,1)' }),
    skill('Revive', { petmax: 'lvl', calc1: 'par1', ...params(200) }),
    skill('Teeth', { srvmissilea: 'teeth', EType: 'mag', calc1: 'min(ln12,24)', ...params(2, 1), ...damageCols('skill', 4, 8, 1) }),
    skill('Bone Spirit', { srvmissilea: 'bonespirit', EType: 'mag', ...damageCols('skill', 40, 60, 8) }),
    skill('Poison Nova', { srvmissilea: 'poisonnova', EType: 'pois', ELen: 40, ...damageCols('skill', 2, 4, 1) }),
    skill('Amplify Damage', {
      aurarangecalc: 'ln12',
      auralencalc: 'ln34',
      aurastat1: 'damageresist',
      aurastatcalc1: '-par5',
      ...params(16, 2, 100, 10, 100),
    }),
    skill('Decrepify', {
      aurarangecalc: 'ln12',
      auralencalc: 'ln34',
      aurastat1: 'velocitypercent',
      aurastatcalc1: 'par5',
      aurastat2: 'damagepercent',
      aurastatcalc2: 'par5',
      aurastat3: 'damageresist',
      aurastatcalc3: 'par5',
      ...params(16, 0, 100, 10, -50),
    }),
    skill('Lower Resist', {
      aurarangecalc: 'ln12',
      auralencalc: 'ln34',
      aurastat1: 'fireresist',
      aurastatcalc1: '-dm56',
      aurastat2: 'lightresist',
      aurastatcalc2: '-dm56',
      aurastat3: 'coldresist',
      aurastatcalc3: '-dm56',
      aurastat4: 'poisonresist',
      aurastatcalc4: '-dm56',
      ...params(16, 2, 200, 10, 25, 70),
    }),
    skill('Raise Skeleton', {
      summon: 'necroskeleton',
      petmax: '(lvl < 4) ?lvl:(2+lvl/3)',
      aurastat1: 'damagepercent',
      aurastatcalc1: '((lvl < 4) ? 0 : ((lvl-3)*par3))',
      calc1: '(lvl < 4) ? 0 : (par2 * (lvl - 3))',
      ...params(0, 50, 5),
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
    { Missile: 'firebolt', Vel: 20, Range: 50 },
    { Missile: 'fireball', Vel: 20, Range: 50 },
    { Missile: 'meteorcenter', Range: 30 },
    { Missile: 'icebolt', Vel: 15, Range: 50 },
    { Missile: 'glacialspike', Vel: 16, Range: 50 },
    { Missile: 'frozenorb', Vel: 12, Range: 60 },
    { Missile: 'chargedbolt', Vel: 12, Range: 60 },
    { Missile: 'lightningbolt', Vel: 30, Range: 25 },
    { Missile: 'thunderstorm1', Range: 9 },
    { Missile: 'teeth', Vel: 16, Range: 50 },
    { Missile: 'bonespirit', Vel: 12, Range: 128 },
    { Missile: 'poisonnova', Vel: 12, Range: 30 },
    { Missile: 'necromage1', Vel: 14, Range: 30, EType: 'pois', EMin: 12, EMax: 12, ELen: 40, ...damageCols('missile', 12, 12, 2) },
    { Missile: 'necromage2', Vel: 14, Range: 30, EType: 'cold', ELen: 25, ...damageCols('missile', 2, 4, 1) },
    { Missile: 'necromage3', Vel: 14, Range: 30, EType: 'fire', ...damageCols('missile', 2, 6, 1) },
    { Missile: 'necromage4', Vel: 14, Range: 30, EType: 'ltng', ...damageCols('missile', 1, 7, 2) },
  ],
};

/** Design data pointed at the fixture's missile names where they differ from the real ones. */
/**
 * The schedule names monsters across five acts; a test only needs them to resolve. Every
 * monster and superunique monsters.json names that the rows above leave out gets a plain row
 * (level 20, no mods), with the minion monsters.json gives it so the pack check agrees.
 */
function fillSchedule(tables: Tables): Tables {
  const m = DESIGN.monsters;
  const have = new Set(tables.monstats.map((r) => r['Id']));
  const rows: TableRow[] = [];
  const add = (id: string, extra: TableRow = {}) => {
    if (have.has(id)) return;
    have.add(id);
    rows.push(monster(id, id, { Level: 20, ...extra }));
  };
  // A raiser's party first: a superunique of the same class shares its row
  for (const [id, r] of Object.entries(m.roster)) if (r.party) add(id, { minion1: r.party, PartyMin: 2, PartyMax: 4 });
  for (const b of [...m.superuniques, ...m.bosses]) add(b.class, b.minion && b.minion !== b.class ? { minion1: b.minion } : {});
  for (const id of [
    ...Object.values(m.campaign).flatMap((byDifficulty) => Object.values(byDifficulty).flatMap((ws) => ws.flatMap((w) => ('monster' in w ? [w.monster] : [])))),
    ...m.superuniques.flatMap((b) => (b.minion ? [b.minion] : [])),
    ...Object.keys(m.roster),
    m.cow.monster,
    ...Object.values(m.roster).flatMap((r) => (r.party ? [r.party] : [])),
  ]) {
    add(id);
  }
  const named = new Set(tables.superuniques.map((r) => r['Superunique']));
  const superuniques = m.superuniques
    .filter((b) => b.superunique && !named.has(b.superunique))
    .map((b) => ({ Superunique: b.superunique!, Name: b.superunique!, Class: b.class, MinGrp: b.minion ? 2 : 0, MaxGrp: b.minion ? 2 : 0 }));
  return { ...tables, monstats: [...tables.monstats, ...rows], superuniques: [...tables.superuniques, ...superuniques] };
}

export const FIXTURE_TABLES: Tables = fillSchedule(HAND_TABLES);

/** The classes the fixture tables have skill rows for; the four later classes are covered by the real-table tests and the harness. */
const FIXTURE_CLASSES = new Set(['paladin', 'sorceress', 'necromancer']);

export function fixtureDesign(design: DesignData = DESIGN): DesignData {
  const classes = design.classes.filter((c) => FIXTURE_CLASSES.has(c.id));
  const kept = new Set(classes.flatMap((c) => Object.values(c.lines).flatMap((l) => l.tiers.flat())));
  const skills = design.skills.filter((s) => kept.has(s.id) || design.classes.every((c) => !Object.values(c.lines).some((l) => l.tiers.flat().includes(s.id))));
  return {
    ...design,
    classes,
    evolutions: Object.fromEntries(Object.entries(design.evolutions).filter(([, e]) => kept.has(e.attack.skill) && kept.has(e.partner.skill))),
    skills: skills.map((s) =>
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

export function fixtureGameData(waveCount?: number, opts: BuildOptions = {}): GameData {
  return buildGameData(FIXTURE_TABLES, fixtureDesign(), waveCount, { ...FIXTURE_BUILD, ...opts });
}
