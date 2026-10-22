// Installer payload check: proves the packaged app holds zero Blizzard bytes. Runs after
// electron-builder (npm run dist) against release/win-unpacked, which is exactly what the
// NSIS installer compresses.
//
// Fails when any shipped file
//   - has a game or pipeline file type, or sits in a game asset folder (tools/lib/payload.ts)
//   - has the same SHA-256 as anything in assets-extracted/checksums.json
// and when the app is missing a piece it needs to run.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { listAsar, readAsarEntry } from './lib/asar.ts';
import { forbiddenReason } from './lib/payload.ts';

const UNPACKED = 'release/win-unpacked';
const RESOURCES = join(UNPACKED, 'resources');
const ARCHIVE = join(RESOURCES, 'app.asar');
const CHECKSUMS = 'assets-extracted/checksums.json';
/** What the app cannot run without. */
const REQUIRED = ['package.json', 'dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs'];
const NATIVE = 'node_modules/@jamiephan/casclib/prebuilds/win32-x64/@jamiephan+casclib.node';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

if (!existsSync(ARCHIVE)) {
  console.error(`No ${ARCHIVE}. Run npm run dist first.`);
  process.exit(1);
}

const problems: string[] = [];
/** Every shipped file: its payload path and its bytes on demand. */
const files: { path: string; bytes: () => Uint8Array }[] = [];

for (const entry of listAsar(ARCHIVE)) {
  const onDisk = join(`${ARCHIVE}.unpacked`, entry.path);
  files.push({ path: entry.path, bytes: () => (entry.unpacked ? readFileSync(onDisk) : readAsarEntry(ARCHIVE, entry)) });
}
// Anything else under resources (besides the archive and its unpacked twin) is ours too
for (const full of walk(RESOURCES)) {
  const rel = relative(RESOURCES, full).replace(/\\/g, '/');
  if (rel === 'app.asar' || rel.startsWith('app.asar.unpacked/')) continue;
  files.push({ path: `resources/${rel}`, bytes: () => readFileSync(full) });
}

for (const f of files) {
  const reason = forbiddenReason(f.path);
  if (reason) problems.push(`${f.path}: ${reason}`);
}

const paths = new Set(files.map((f) => f.path));
for (const need of [...REQUIRED, NATIVE]) if (!paths.has(need)) problems.push(`missing ${need}`);
const nativeEntry = listAsar(ARCHIVE).find((e) => e.path === NATIVE);
if (nativeEntry && !nativeEntry.unpacked) problems.push(`${NATIVE} is inside the asar; native modules must be unpacked`);

// Byte-level: nothing in the whole unpacked app (Electron runtime included) may equal an extracted file
let compared = 0;
if (existsSync(CHECKSUMS)) {
  const extracted = JSON.parse(readFileSync(CHECKSUMS, 'utf8')) as { files: Record<string, string> };
  const known = new Map(Object.entries(extracted.files).map(([path, hash]) => [hash, path]));
  const check = (path: string, bytes: Uint8Array) => {
    compared++;
    const match = known.get(sha256(bytes));
    if (match) problems.push(`${path}: identical to extracted ${match}`);
  };
  for (const f of files) check(f.path, f.bytes());
  for (const full of walk(UNPACKED)) {
    if (full.startsWith(RESOURCES)) continue;
    check(relative(UNPACKED, full).replace(/\\/g, '/'), readFileSync(full));
  }
} else {
  console.warn(`No ${CHECKSUMS}, so the byte-level comparison was skipped. Run npm run extract first.`);
}

// This version's installer; release/ keeps older builds alongside
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const installer = readdirSync('release').find((n) => n.endsWith(`${version}.exe`)) ?? readdirSync('release').find((n) => n.endsWith('.exe'));
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
console.log(`App payload: ${files.length} files; ${compared} files hashed against extracted output.`);
if (installer) console.log(`Installer: release/${installer}, ${mb(statSync(join('release', installer)).size)}`);
if (problems.length > 0) {
  console.error(`Payload check FAILED:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Payload check passed: zero Blizzard files in the installer.');
