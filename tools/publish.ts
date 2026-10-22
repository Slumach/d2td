// Publishes the build `npm run dist` made as a GitHub Release of Slumach/d2td: the installer,
// its blockmap and latest.yml, uploaded exactly as they are in release/ (electron-builder's
// own publisher repacks the installer, so what it uploads never matches the latest.yml it
// was built with, and an update fails its checksum). Before anything is sent, latest.yml's
// version, size and sha512 are checked against the local installer. The release for tag
// v<version> is created at HEAD if it does not exist; files of the same names already on it
// are replaced. Needs GH_TOKEN (a token with repo scope).
//
//   npm run dist && npm run publish

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OWNER = 'Slumach';
const REPO = 'd2td';
const dir = 'release';

const token = process.env['GH_TOKEN'] ?? process.env['GITHUB_TOKEN'];
if (!token) fail('GH_TOKEN is not set: a GitHub token with repo scope publishes the release');

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; productName: string };
const latestPath = join(dir, 'latest.yml');
if (!existsSync(latestPath)) fail(`${latestPath} is missing: run npm run dist first`);
const latest = readFileSync(latestPath, 'utf8');
const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(latest)?.[1]?.trim();
const version = field('version');
const remoteName = field('path');
const sha512 = field('sha512');
const size = Number(/^\s+size:\s*(\d+)$/m.exec(latest)?.[1]);
if (version !== pkg.version) fail(`latest.yml is for ${version}, package.json is ${pkg.version}: run npm run dist again`);
if (!remoteName || !sha512 || !size) fail('latest.yml names no installer, sha512 or size');

// electron-builder writes the installer with spaces locally and names it with dashes in latest.yml
const installer = join(dir, `${pkg.productName} Setup ${pkg.version}.exe`);
const blockmap = `${installer}.blockmap`;
for (const f of [installer, blockmap]) if (!existsSync(f)) fail(`${f} is missing: run npm run dist first`);
const bytes = readFileSync(installer);
const actual = createHash('sha512').update(bytes).digest('base64');
if (bytes.length !== size || actual !== sha512) fail(`${installer} does not match latest.yml (size ${bytes.length} against ${size}): run npm run dist again`);

/** The first section of release-notes.md: this version's notes. */
function notes(): string {
  if (!existsSync('release-notes.md')) return '';
  const text = readFileSync('release-notes.md', 'utf8');
  return text.split(/\n(?=\d+\.\d+\.\d+\s*\n)/)[0]!.trim();
}

const api = async (method: string, url: string, body?: unknown): Promise<Response> =>
  fetch(url.startsWith('http') ? url : `https://api.github.com/repos/${OWNER}/${REPO}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const tag = `v${pkg.version}`;
  let res = await api('GET', `/releases/tags/${tag}`);
  if (res.status === 404) {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    res = await api('POST', '/releases', { tag_name: tag, target_commitish: head, name: pkg.version, body: notes(), draft: false, prerelease: false });
    if (!res.ok) fail(`creating the release failed: ${res.status} ${await res.text()}`);
    console.log(`created release ${tag} at ${head.slice(0, 7)}`);
  } else if (!res.ok) {
    fail(`reading the release failed: ${res.status} ${await res.text()}`);
  }
  const release = (await res.json()) as { id: number; assets: { id: number; name: string }[] };
  const uploads: [string, string, string][] = [
    [installer, remoteName!, 'application/octet-stream'],
    [blockmap, `${remoteName}.blockmap`, 'application/octet-stream'],
    [latestPath, 'latest.yml', 'text/yaml'],
  ];
  for (const [from, name, type] of uploads) {
    const old = release.assets.find((a) => a.name === name);
    if (old) {
      const del = await api('DELETE', `/releases/assets/${old.id}`);
      if (!del.ok) fail(`replacing ${name} failed: ${del.status}`);
    }
    const up = await fetch(`https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': type },
      body: readFileSync(from),
    });
    if (!up.ok) fail(`uploading ${name} failed: ${up.status} ${await up.text()}`);
    console.log(`uploaded ${name}${old ? ' (replaced)' : ''}`);
  }
  console.log(`published ${pkg.version}: https://github.com/${OWNER}/${REPO}/releases/tag/${tag}`);
}

void main();
