// Finding and checking a D2R install.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where the Battle.net installer records D2R, most specific first. */
const REGISTRY_KEYS: [string, string][] = [
  ['HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Diablo II Resurrected', 'InstallLocation'],
  ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Diablo II Resurrected', 'InstallLocation'],
  ['HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\Diablo II Resurrected', 'InstallPath'],
];

function regQuery(key: string, value: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', value], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      // "    InstallLocation    REG_SZ    C:\Program Files (x86)\Diablo II Resurrected"
      const match = /REG_\w+\s+(.+)$/m.exec(stdout);
      resolve(match ? match[1]!.trim() : null);
    });
  });
}

/** True if the folder holds a D2R CASC storage. */
export function looksLikeD2R(path: string): boolean {
  return existsSync(join(path, '.build.info')) && existsSync(join(path, 'Data'));
}

/** The first registry entry that points at a real install, or null. */
export async function detectD2R(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  for (const [key, value] of REGISTRY_KEYS) {
    const path = await regQuery(key, value);
    if (path && looksLikeD2R(path)) return path;
  }
  return null;
}
