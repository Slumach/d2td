// Asset pipeline entry point. Writes everything the game needs to assets-extracted
// (gitignored), from a CascView export (assets-raw) or straight from a D2R install.
//
//   npm run extract                          from assets-raw
//   npm run extract -- --casc                from the D2R install the registry points to
//   npm run extract -- --casc --d2r "D:\Games\Diablo II Resurrected"
//   npm run extract -- --check               list the game files the run reads and any missing

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { detectD2R } from '../lib/d2r.ts';
import { extractGame, planGame } from './game.ts';
import { CascSource, FolderSource, type CascStorage, type DataSource } from './source.ts';

const { values: args } = parseArgs({
  options: {
    casc: { type: 'boolean', default: false },
    d2r: { type: 'string' },
    raw: { type: 'string', default: 'assets-raw' },
    out: { type: 'string', default: 'assets-extracted' },
    check: { type: 'boolean', default: false },
  },
});

/** The CascView export may nest the CASC "data" folder once or twice. */
function folderSource(raw: string): FolderSource {
  for (const candidate of [join(raw, 'data', 'data'), join(raw, 'data'), raw]) {
    if (existsSync(join(candidate, 'global'))) return new FolderSource(candidate);
  }
  throw new Error(`No global folder under ${resolve(raw)}`);
}

async function openSource(): Promise<DataSource> {
  if (!args.casc) return folderSource(args.raw);
  const install = args.d2r ?? (await detectD2R());
  if (!install) throw new Error('No D2R install found in the registry; pass --casc "<folder>"');
  const { Storage } = createRequire(import.meta.url)('@jamiephan/casclib') as { Storage: { open(p: string): CascStorage } };
  return new CascSource(Storage.open(install), install);
}

const source = await openSource();
try {
  const plan = planGame(source);
  if (args.check) {
    console.log(`${plan.inputs.length} game files from ${source.label}, ${plan.jobs.length} jobs`);
    console.log(plan.missing.length === 0 ? 'Nothing missing.' : `Missing:\n  ${plan.missing.join('\n  ')}`);
  } else {
    const t0 = Date.now();
    const list = await extractGame(source, args.out, (p) => p.file && console.log(`  ${p.done + 1}/${p.total} ${p.file}`));
    console.log(`${Object.keys(list.files).length} files in ${args.out} (${list.reused} of ${plan.jobs.length} jobs unchanged and reused) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  source.close();
}
