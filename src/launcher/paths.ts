// Fitting Windows paths on one line of the launcher screens.

/** `path` cut in the middle to at most `max` characters, keeping the drive and the last folders. */
export function shortPath(path: string, max: number): string {
  if (path.length <= max) return path;
  const parts = path.split('\\');
  const head = parts[0]!;
  let tail = parts.at(-1)!;
  for (let i = parts.length - 2; i > 0; i--) {
    const next = `${parts[i]}\\${tail}`;
    if (head.length + 5 + next.length > max) break;
    tail = next;
  }
  const short = `${head}\\...\\${tail}`;
  return short.length <= max ? short : `...${path.slice(path.length - max + 3)}`;
}
