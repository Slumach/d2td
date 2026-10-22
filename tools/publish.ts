// Publishes the newest build as a GitHub Release: the installer, its blockmap and latest.yml,
// through electron-builder's GitHub publisher, with GH_TOKEN (a token with repo scope). The
// game's Update button reads the releases of Slumach/d2td (package.json build.publish).
//
//   npm run dist && GH_TOKEN=... npm run publish

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'release';
if (!process.env['GH_TOKEN'] && !process.env['GITHUB_TOKEN']) {
  console.error('GH_TOKEN is not set: a GitHub token with repo scope publishes the release');
  process.exit(1);
}
const latest = join(dir, 'latest.yml');
if (!existsSync(latest)) {
  console.error(`${latest} is missing: run npm run dist first`);
  process.exit(1);
}
// latest.yml names the installer with dashes for GitHub (D2-Tower-Defense-Setup-0.2.4.exe); electron-builder
// repacks the installer from win-unpacked and uploads it under that name itself
const version = /^version:\s*(.+)$/m.exec(readFileSync(latest, 'utf8'))?.[1]?.trim();
if (!existsSync(join(dir, 'win-unpacked'))) {
  console.error(`${join(dir, 'win-unpacked')} is missing: run npm run dist first`);
  process.exit(1);
}
console.log(`publishing ${version} as a GitHub Release`);
const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--prepackaged', join(dir, 'win-unpacked'), '--publish', 'always'], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
