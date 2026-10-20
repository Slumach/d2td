// Asset pipeline entry point. Reads from assets-raw (CascView export), writes to
// assets-extracted. Both are gitignored.
//
//   npm run extract                       everything M0 needs
//   npm run extract -- --only monster --token zm --mode a1 --monster zombie1
//   npm run extract -- --only icons --class sor

import { parseArgs } from 'node:util';

import { extractSkillIcons } from './icons.ts';
import { extractMonster } from './monster.ts';
import { findDataRoot } from './paths.ts';

const { values: args } = parseArgs({
  options: {
    only: { type: 'string' },
    token: { type: 'string', default: 'zm' },
    mode: { type: 'string', default: 'wl' },
    monster: { type: 'string', default: 'zombie1' },
    act: { type: 'string', default: 'act1' },
    class: { type: 'string', default: 'pal' },
    raw: { type: 'string', default: 'assets-raw' },
    out: { type: 'string', default: 'assets-extracted' },
  },
});

const dataRoot = findDataRoot(args.raw);
const run = (step: string): boolean => args.only === undefined || args.only === step;

if (run('monster')) {
  extractMonster({ dataRoot, out: args.out, token: args.token, mode: args.mode, monster: args.monster, act: args.act });
}
if (run('icons')) {
  extractSkillIcons({ dataRoot, out: args.out, charClass: args.class });
}
