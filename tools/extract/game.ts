// The extraction the game needs, as one run: the excel tables the sim reads, the sprite
// sheets, missiles and skill icons the renderer draws. The same run backs
// `npm run extract` in development and the launcher's first-launch setup, reading from a
// CascView export or straight from D2R's CASC storage. It writes a checksum list so a
// later launch can verify the files.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import sprites from '../../src/data/render/sprites.json';
import { iconJob } from './icons.ts';
import { cursorJob, fontJob, soundJob } from './feel.ts';
import { frontendJob } from './frontend.ts';
import { hudJob } from './hud.ts';
import { itemArtJob } from './items.ts';

import type { DataSource } from './source.ts';
import { spriteJobs, type SpriteJob } from './sprites.ts';
import { mapJob } from './map.ts';
import { tableJobs } from './tables.ts';

export const CHECKSUM_FILE = 'checksums.json';
/**
 * Bumped whenever the extraction makes new or different files, so an older extraction fails
 * verification and setup asks for a fresh one. 2: M5's map, cursor, font and sounds.
 * 3: the switchback road and D2's frontend for the menus.
 * 4: D2R's HUD pieces, and the ground baked for the whole canvas.
 * 5: the Sorceress and Necromancer: heroes, summons, missiles, overlays, icons and sounds.
 * 6: the Act 1 schedule: every wave monster, boss and pack, superunique palettes, superuniques.txt.
 * 7: Green TD pacing: Act 1's twelve superuniques ride inside waves; the old road's bake is gone.
 * 8: the campaign: levels.txt for the placeholder acts' monster levels.
 * 9: Act 1's ring maps: the Blood Moor and Catacombs 4.
 * 10: D2R's menu and HUD: the burning logo, the pause menu, the mini-menu buttons, the
 *     inventory panel.
 * 11: Act 2: its monsters (in Act 2's palette), its maps, and D2R's monster names.
 * 12: Act 3: its monsters and maps.
 * 13: Act 4: its monsters and maps.
 * 14: Act 5: its monsters and maps.
 * 29: cast sounds from skills.txt's class, do and charge-up columns where a skill has no
 *     stsound (the War Cries, Bash, Arctic Blast, Tiger Strike), and more cast overlays.
 * 30: Eternal Conflict: the battlefields (Harrogath under siege and the Pandemonium Fortress,
 *     for one to four lanes, with the Worldstone) and the hirelings that stand as workers.
 */
export const EXTRACT_VERSION = 30;
/** What verifyGame reports when the extraction is from an older version of the game. */
export const OUTDATED = 'version';

export interface Progress {
  done: number;
  total: number;
  file: string;
}

export interface ChecksumList {
  /** Where the files came from. */
  source: string;
  version: number;
  files: Record<string, string>;
  /** Each job's key (label, inputs and rev) and the files it wrote, so a later run can reuse it. */
  jobs?: Record<string, { key: string; files: string[] }>;
}

/** What makes a job's output: its label, the game files it reads, and its rev. */
function jobKey(job: SpriteJob): string {
  return sha256(new TextEncoder().encode(JSON.stringify([job.label, [...job.inputs].sort(), job.rev ?? 0])));
}

/** The checksum list already in `outDir`, if any. */
export function readChecksums(outDir: string): ChecksumList | undefined {
  const path = join(outDir, CHECKSUM_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ChecksumList;
  } catch {
    return undefined;
  }
}

export interface GamePlan {
  jobs: SpriteJob[];
  /** Every game file the run reads. */
  inputs: string[];
  /** Inputs the source does not have; the run refuses to start while any are missing. */
  missing: string[];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every job the game needs, and exactly which game files they read. */
export function planGame(source: DataSource): GamePlan {
  const sprite = spriteJobs(source);
  const jobs = [...tableJobs(source), ...sprite.jobs, ...sprites.iconClasses.map((c) => iconJob(source, c)), mapJob(source), cursorJob(source), fontJob(source), soundJob(source), frontendJob(source), hudJob(source), itemArtJob(source)];
  const inputs = [...new Set([...sprite.sharedInputs, ...jobs.flatMap((j) => j.inputs)])].sort();
  const missing = [...new Set([...sprite.missing, ...inputs.filter((p) => !source.exists(p))])].sort();
  return { jobs, inputs, missing };
}

/**
 * Runs `jobs` into `outDir`, then writes the checksum list over every output. Yields to the
 * event loop between jobs so the launcher window stays responsive and shows progress.
 *
 * An update re-extracts only what changed: a job whose label, inputs and rev match the
 * previous run's, and whose files are all still there with their checksums, is reused as
 * it is. Files the previous run wrote that no job writes any more are deleted.
 */
export async function extractGame(
  source: DataSource,
  outDir: string,
  onProgress?: (p: Progress) => void,
  jobs?: SpriteJob[],
): Promise<ChecksumList & { reused: number }> {
  const plan = jobs ? { jobs, missing: [...new Set(jobs.flatMap((j) => j.inputs))].filter((p) => !source.exists(p)) } : planGame(source);
  if (plan.missing.length > 0) throw new Error(`Missing from ${source.label}: ${plan.missing.join(', ')}`);
  const previous = readChecksums(outDir);
  const files: Record<string, string> = {};
  const done: Record<string, { key: string; files: string[] }> = {};
  let reused = 0;
  const intact = (path: string) => {
    const hash = previous?.files[path];
    const full = join(outDir, path);
    return hash !== undefined && existsSync(full) && sha256(readFileSync(full)) === hash;
  };
  for (const [i, job] of plan.jobs.entries()) {
    onProgress?.({ done: i, total: plan.jobs.length, file: job.label });
    await new Promise((resolve) => setImmediate(resolve));
    const key = jobKey(job);
    const before = previous?.jobs?.[job.label];
    if (before && before.key === key && before.files.every(intact)) {
      for (const path of before.files) files[path] = previous!.files[path]!;
      done[job.label] = before;
      reused++;
      continue;
    }
    const wrote: string[] = [];
    for (const file of job.run()) {
      const out = join(outDir, file.path);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, file.bytes);
      files[file.path] = sha256(file.bytes);
      wrote.push(file.path);
    }
    done[job.label] = { key, files: wrote };
  }
  // A file the last run wrote that no job writes now is stale
  for (const path of Object.keys(previous?.files ?? {})) {
    if (!(path in files)) rmSync(join(outDir, path), { force: true });
  }
  const list: ChecksumList = { source: source.label, version: EXTRACT_VERSION, files, jobs: done };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, CHECKSUM_FILE), JSON.stringify(list, null, 2));
  onProgress?.({ done: plan.jobs.length, total: plan.jobs.length, file: '' });
  return { ...list, reused };
}

export interface VerifyResult {
  ok: boolean;
  /** Outputs that are missing or whose checksum does not match. */
  bad: string[];
}

/** Checks every file in the checksum list. */
export function verifyGame(outDir: string): VerifyResult {
  const listPath = join(outDir, CHECKSUM_FILE);
  if (!existsSync(listPath)) return { ok: false, bad: [CHECKSUM_FILE] };
  const list = JSON.parse(readFileSync(listPath, 'utf8')) as ChecksumList;
  if (list.version !== EXTRACT_VERSION) return { ok: false, bad: [OUTDATED] };
  const bad: string[] = [];
  for (const [path, hash] of Object.entries(list.files)) {
    const full = join(outDir, path);
    if (!existsSync(full) || hash !== sha256(readFileSync(full))) bad.push(path);
  }
  if (Object.keys(list.files).length === 0) bad.push(CHECKSUM_FILE);
  return { ok: bad.length === 0, bad };
}
