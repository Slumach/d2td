// Publishes the newest build to the update bucket: the installer, its blockmap and
// latest.yml (electron-builder writes all three into release/ when package.json names the
// generic publish URL), copied with the AWS CLI and whatever credentials this machine has
// (aws login, aws configure, or the AWS_* environment). The game's Update button reads
// latest.yml from the same bucket.
//
//   npm run publish      builds (npm run dist) and uploads

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUCKET = 'd2td-updates';
const dir = 'release';

const latest = join(dir, 'latest.yml');
if (!existsSync(latest)) {
  console.error(`${latest} is missing: run npm run dist first (package.json build.publish must name the generic URL)`);
  process.exit(1);
}
const installer = /^path:\s*(.+)$/m.exec(readFileSync(latest, 'utf8'))?.[1]?.trim();
if (!installer) {
  console.error(`${latest} names no installer path`);
  process.exit(1);
}
const files = [installer, `${installer}.blockmap`, 'latest.yml'];
for (const f of files) {
  const from = join(dir, f);
  if (!existsSync(from)) {
    console.error(`${from} is missing`);
    process.exit(1);
  }
  console.log(`uploading ${f}`);
  const r = spawnSync('aws', ['s3', 'cp', from, `s3://${BUCKET}/${f}`, '--no-progress'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`upload of ${f} failed (is this machine logged in to AWS?)`);
    process.exit(r.status ?? 1);
  }
}
console.log(`published ${installer} and latest.yml to s3://${BUCKET}`);
