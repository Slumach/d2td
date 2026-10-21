// The rule for what an installer may never hold: anything that is, or looks like, a file
// from the game or our decoded output of one.

/** Game formats and the formats we decode them to. Forbidden anywhere. */
const GAME_EXTENSIONS = ['.dcc', '.dc6', '.cof', '.sprite', '.tbl', '.pl2', '.dt1', '.ds1', '.wav', '.d2', '.mpq', '.casc'];
/** Formats our pipeline writes. Forbidden in our own files; dependencies may carry their own. */
const OUTPUT_EXTENSIONS = ['.png', '.txt', '.dat', '.json'];
/** Folder names from the CASC tree and from assets-extracted. */
const GAME_FOLDERS = new Set(['monsters', 'hero', 'missiles', 'icons', 'global', 'excel', 'hd', 'assets-raw', 'assets-extracted']);
/** Our own JSON that is fine to ship. */
const ALLOWED = new Set(['package.json']);

/** Why `path` (forward slashes, relative to the payload root) must not ship, or null. */
export function forbiddenReason(path: string): string | null {
  const lower = path.toLowerCase();
  const segments = lower.split('/');
  const name = segments.at(-1)!;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (name === 'checksums.json') return 'the extraction checksum list';
  if (GAME_EXTENSIONS.includes(ext)) return `game file type ${ext}`;
  if (segments.includes('node_modules')) return null;
  const folder = segments.slice(0, -1).find((s) => GAME_FOLDERS.has(s));
  if (folder) return `inside a game asset folder (${folder}/)`;
  if (OUTPUT_EXTENSIONS.includes(ext) && !ALLOWED.has(lower)) return `pipeline output type ${ext}`;
  return null;
}
