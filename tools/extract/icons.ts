// Extracts a class's D2R HD skill icons into one PNG per skill plus a JSON index keyed
// by skill name. Frame numbers come from skilldesc.txt IconCel: the normal icon is at
// IconCel and the pressed icon at IconCel + 1.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { encodePng } from '../lib/png.ts';
import { decodeSprite, spriteFrame } from '../lib/sprite.ts';
import { column, readBytes, readTable } from './paths.ts';

/** skills.txt charclass to the D2R icon folder and file prefix. */
const CLASS_ICON_FILES: Record<string, { folder: string; prefix: string }> = {
  ama: { folder: 'amazon', prefix: 'aa' },
  sor: { folder: 'sorceress', prefix: 'so' },
  nec: { folder: 'necromancer', prefix: 'ne' },
  pal: { folder: 'paladin', prefix: 'pa' },
  bar: { folder: 'barbarian', prefix: 'ba' },
  dru: { folder: 'druid', prefix: 'dr' },
  ass: { folder: 'assassin', prefix: 'as' },
};

export interface IconOptions {
  dataRoot: string;
  out: string;
  /** skills.txt charclass, e.g. "pal". */
  charClass: string;
}

export interface IconIndexEntry {
  id: number;
  frame: number;
  icon: string;
  pressed: string;
}

export function extractSkillIcons(opts: IconOptions): void {
  const files = CLASS_ICON_FILES[opts.charClass];
  if (!files) throw new Error(`Unknown charclass ${opts.charClass}`);

  const spritePath = join(opts.dataRoot, 'hd', 'global', 'ui', 'spells', files.folder, `${files.prefix}skillicon.sprite`);
  const sheet = decodeSprite(readBytes(spritePath));

  const skillDescs = new Map(readTable(opts.dataRoot, 'skilldesc.txt').map((row) => [column(row, 'skilldesc'), row]));
  const skills = readTable(opts.dataRoot, 'skills.txt').filter((row) => row['charclass'] === opts.charClass);

  const outDir = join(opts.out, 'icons', files.folder);
  mkdirSync(outDir, { recursive: true });

  const index: Record<string, IconIndexEntry> = {};
  for (const skill of skills) {
    const name = skill['skill']!;
    const desc = skillDescs.get(skill['skilldesc'] ?? '');
    if (!desc) throw new Error(`skilldesc.txt has no row for ${name}`);
    const frame = Number(column(desc, 'IconCel'));

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const icon = `${slug}.png`;
    const pressed = `${slug}_pressed.png`;
    writeFileSync(join(outDir, icon), encodePng(sheet.frameWidth, sheet.frameHeight, spriteFrame(sheet, frame)));
    writeFileSync(join(outDir, pressed), encodePng(sheet.frameWidth, sheet.frameHeight, spriteFrame(sheet, frame + 1)));

    index[name] = { id: Number(column(skill, '*Id')), frame, icon, pressed };
  }

  writeFileSync(
    join(outDir, 'index.json'),
    JSON.stringify(
      {
        source: `${files.prefix}skillicon.sprite`,
        size: { w: sheet.frameWidth, h: sheet.frameHeight },
        skills: index,
      },
      null,
      2,
    ),
  );

  console.log(`${files.folder}: ${skills.length} skill icons at ${sheet.frameWidth}x${sheet.frameHeight}`);
  console.log(`Wrote ${outDir}`);
}
