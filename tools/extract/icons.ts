// A class's D2R HD skill icons: one PNG per skill (normal and pressed) plus a JSON index
// keyed by skill name, with the skill's display name and description from D2R's string
// table. Frame numbers come from skilldesc.txt IconCel: the normal icon is at IconCel and
// the pressed icon at IconCel + 1; the text keys are skilldesc "str name" and "str long".

import { encodePng } from '../lib/png.ts';
import { decodeSprite, spriteFrame } from '../lib/sprite.ts';
import { column, readTable } from './paths.ts';
import type { DataSource } from './source.ts';
import type { OutputFile, SpriteJob } from './sprites.ts';

/** skills.txt charclass to the D2R icon folder and file prefix. */
const CLASS_ICON_FILES: Record<string, { folder: string; prefix: string }> = {
  ama: { folder: 'amazon', prefix: 'am' },
  sor: { folder: 'sorceress', prefix: 'so' },
  nec: { folder: 'necromancer', prefix: 'ne' },
  pal: { folder: 'paladin', prefix: 'pa' },
  bar: { folder: 'barbarian', prefix: 'ba' },
  dru: { folder: 'druid', prefix: 'dr' },
  ass: { folder: 'assassin', prefix: 'as' },
};

const STRINGS = 'local/lng/strings/skills.json';

export interface IconIndexEntry {
  id: number;
  frame: number;
  icon: string;
  pressed: string;
  /** Display name and description in English, from the D2R string table. */
  name: string;
  desc: string;
}

function strings(source: DataSource): Map<string, string> {
  const text = Buffer.from(source.read(STRINGS)).toString('utf8').replace(/^﻿/, '');
  const rows = JSON.parse(text) as { Key: string; enUS: string }[];
  return new Map(rows.map((r) => [r.Key, r.enUS]));
}

export function iconJob(source: DataSource, charClass: string): SpriteJob {
  const files = CLASS_ICON_FILES[charClass];
  if (!files) throw new Error(`Unknown charclass ${charClass}`);
  const spritePath = `hd/global/ui/spells/${files.folder}/${files.prefix}skillicon.sprite`;
  return {
    label: `icons ${files.folder}`,
    inputs: [spritePath, 'global/excel/skilldesc.txt', 'global/excel/skills.txt', STRINGS],
    run: () => {
      const sheet = decodeSprite(source.read(spritePath));
      const text = strings(source);
      const skillDescs = new Map(readTable(source, 'skilldesc.txt').map((row) => [column(row, 'skilldesc'), row]));
      const skills = readTable(source, 'skills.txt').filter((row) => row['charclass'] === charClass);
      const out: OutputFile[] = [];
      const index: Record<string, IconIndexEntry> = {};
      for (const skill of skills) {
        const name = skill['skill']!;
        const desc = skillDescs.get(skill['skilldesc'] ?? '');
        if (!desc) throw new Error(`skilldesc.txt has no row for ${name}`);
        const frame = Number(column(desc, 'IconCel'));
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const icon = `${slug}.png`;
        const pressed = `${slug}_pressed.png`;
        out.push({ path: `icons/${files.folder}/${icon}`, bytes: encodePng(sheet.frameWidth, sheet.frameHeight, spriteFrame(sheet, frame)) });
        out.push({ path: `icons/${files.folder}/${pressed}`, bytes: encodePng(sheet.frameWidth, sheet.frameHeight, spriteFrame(sheet, frame + 1)) });
        index[name] = {
          id: Number(column(skill, '*Id')),
          frame,
          icon,
          pressed,
          name: text.get(column(desc, 'str name')) ?? name,
          desc: text.get(column(desc, 'str long')) ?? '',
        };
      }
      const json = { source: `${files.prefix}skillicon.sprite`, size: { w: sheet.frameWidth, h: sheet.frameHeight }, skills: index };
      out.push({ path: `icons/${files.folder}/index.json`, bytes: new TextEncoder().encode(JSON.stringify(json, null, 2)) });
      return out;
    },
  };
}
