// Publishes the newest build: a GitHub Release (the installer, its blockmap and latest.yml,
// through electron-builder's GitHub publisher with GH_TOKEN) and the same three files to the
// S3 bucket with the AWS CLI, for installs from before 0.2.4 whose updater still reads the
// bucket. Either half is skipped, with a note, when its credentials are not there.
//
//   npm run dist && npm run publish
//   GH_TOKEN=... npm run publish        a GitHub token with repo scope publishes the release

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUCKET = 'd2td-updates';
const dir = 'release';

const latest = join(dir, 'latest.yml');
if (!existsSync(latest)) {
  console.error(`${latest} is missing: run npm run dist first`);
  process.exit(1);
}
const installer = /^path:\s*(.+)$/m.exec(readFileSync(latest, 'utf8'))?.[1]?.trim();
if (!installer) {
  console.error(`${latest} names no installer path`);
  process.exit(1);
}
const files = [installer, `${installer}.blockmap`, 'latest.yml'];
for (const f of files) {
  if (!existsSync(join(dir, f))) {
    console.error(`${join(dir, f)} is missing`);
    process.exit(1);
  }
}
let failed = false;

// GitHub: electron-builder publishes the packaged build it finds in release/ as a draft-free release
if (process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN']) {
  console.log('publishing the GitHub Release');
  const r = spawnSync('npx', ['electron-builder', '--win', 'nsis', '--prepackaged', join(dir, 'win-unpacked'), '--publish', 'always'], { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('the GitHub Release failed');
    failed = true;
  }
} else {
  console.log('no GH_TOKEN: the GitHub Release is skipped');
}

// S3: the installs from before 0.2.4 read latest.yml here
const aws = spawnSync('aws', ['sts', 'get-caller-identity'], { stdio: 'ignore', shell: true });
if (aws.status === 0) {
  for (const f of files) {
    console.log(`uploading ${f} to s3://${BUCKET}`);
    const r = spawnSync('aws', ['s3', 'cp', join(dir, f), `s3://${BUCKET}/${f}`, '--no-progress'], { stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      console.error(`upload of ${f} failed`);
      failed = true;
      break;
    }
  }
} else {
  console.log('no AWS credentials (aws login): the bucket upload is skipped');
}
process.exit(failed ? 1 : 0);
