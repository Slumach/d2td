// Reader for D2's tab-separated excel tables (monstats.txt, monstats2.txt and so on).

export type TxtRow = Record<string, string>;

export function parseTxt(text: string): TxtRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  const header = lines[0]?.split('\t');
  if (!header) return [];

  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: TxtRow = {};
    header.forEach((name, i) => {
      row[name] = cells[i] ?? '';
    });
    return row;
  });
}
