// What makes it feel like D2, read from the player's install at extraction:
//
//   ui/cursor.png     D2's hand cursor (global/ui/cursor/ohand.dc6, first frame)
//   ui/exocet.otf     D2R's Exocet font for the HUD (hd/ui/fonts)
//   sfx/...           the Act 1 sounds the game plays, copied as D2R ships them (FLAC)
//   sfx/sounds.json   which file each game event plays, resolved through D2's tables
//
// src/data/render/sounds.json says which events have sounds; every file name comes from the
// tables, never typed in.

import { MONSTER_ART } from '../../src/data/monsterArt.ts';
import soundsJson from '../../src/data/render/sounds.json';
import { DESIGN } from '../../src/data/design.ts';
import { decodeDc6, decodeDc6Frame } from '../lib/dc6.ts';
import { decodePalDat } from '../lib/palette.ts';
import { encodePng } from '../lib/png.ts';
import { column, readTable } from './paths.ts';
import type { DataSource } from './source.ts';
import { artMissiles } from '../../src/render/art.ts';
import type { OutputFile, SpriteJob } from './sprites.ts';
import sprites from '../../src/data/render/sprites.json';

const CURSOR = 'global/ui/cursor/ohand.dc6';
const PALETTE = 'global/palette/act1/pal.dat';
const FONT = 'hd/ui/fonts/exocetblizzardot-medium.otf';

export function cursorJob(source: DataSource): SpriteJob {
  return {
    label: 'cursor',
    inputs: [CURSOR, PALETTE],
    run: () => {
      const palette = decodePalDat(source.read(PALETTE));
      const frame = decodeDc6(source.read(CURSOR)).frames[0]!;
      const idx = decodeDc6Frame(frame);
      const rgba = new Uint8Array(idx.length * 4);
      idx.forEach((c, i) => c && rgba.set(palette.subarray(c * 4, c * 4 + 4), i * 4));
      return [{ path: 'ui/cursor.png', bytes: encodePng(frame.width, frame.height, rgba) }];
    },
  };
}

export function fontJob(source: DataSource): SpriteJob {
  return { label: 'font', inputs: [FONT], run: () => [{ path: 'ui/exocet.otf', bytes: source.read(FONT) }] };
}

export interface SoundManifest {
  music: string | null;
  ambience: string | null;
  gold: string[];
  cast: Record<string, string[]>;
  travel: Record<string, string[]>;
  hit: Record<string, string[]>;
  death: Record<string, string[]>;
  /** Item sounds by name (weapons, armor and misc dropsound and usesound): landing, and going into the inventory. */
  items: Record<string, string[]>;
  /** The Secret Cow Level: the portal opening, and Moo Moo Farm's song (levels.txt SoundEnv). */
  cow: { portal: string[]; music: string | null };
  /** The menus: button click and hover, and the title music. */
  ui: { click: string[]; hover: string[]; music: string | null };
  /** Eternal Conflict: a send made, a leak reaching the Worldstone, Tyrael's strike, a won match. */
  battle?: { send: string[]; kingHit: string[]; tyrael: string[]; victory: string[] };
  volumePct: { music: number; ambience: number; sfx: number };
}

/** Sound names to the files they play, following numbered variants (name_1, name_2, ...). */
export function soundJob(source: DataSource): SpriteJob {
  const sounds = readTable(source, 'sounds.txt');
  const byName = new Map(sounds.map((r) => [String(r['Sound']), r]));
  const files = new Map<string, string>();
  /** Every existing source path for a sound and its numbered siblings, as output paths. */
  const resolve = (name: string, base = 'global/sfx/'): string[] => {
    if (!name) return [];
    const names = [name];
    const m = /^(.*_)(\d+)$/.exec(name);
    if (m) for (let i = 1; i <= 9; i++) if (`${m[1]}${i}` !== name && byName.has(`${m[1]}${i}`)) names.push(`${m[1]}${i}`);
    const out: string[] = [];
    for (const n of names) {
      const row = byName.get(n);
      if (!row) continue;
      const rel = String(row['FileName']).replace(/\\/g, '/').toLowerCase();
      const from = `${base}${rel}`;
      if (!source.exists(from)) continue;
      const to = `sfx/${base === 'global/sfx/' ? '' : 'music/'}${rel}`;
      files.set(to, from);
      out.push(to);
    }
    return out;
  };

  const skills = readTable(source, 'skills.txt');
  const missiles = readTable(source, 'missiles.txt');
  const monstats = readTable(source, 'monstats.txt');
  const monsounds = readTable(source, 'monsounds.txt');
  const level = readTable(source, 'levels.txt').find((r) => r['LevelName'] === soundsJson.level);
  const env = level ? readTable(source, 'soundenviron.txt').find((r) => String(r['Index']) === column(level, 'SoundEnv')) : undefined;

  const cowLevel = readTable(source, 'levels.txt').find((r) => r['LevelName'] === soundsJson.cow.level);
  const cowEnv = cowLevel ? readTable(source, 'soundenviron.txt').find((r) => String(r['Index']) === column(cowLevel, 'SoundEnv')) : undefined;
  const skillName = (id: string) => DESIGN.skills.find((s) => s.id === id)?.skill;
  const weapons = readTable(source, 'weapons.txt');
  /**
   * A melee skill with no sound of its own (Double Swing, Frenzy) swings its line's weapon as D2
   * does: sounds.txt's weapon_<wclass>_large_1 (or _small_1), the weapon class from weapons.txt.
   */
  const swingOf = (id: string): string[] => {
    if (DESIGN.skills.find((s) => s.id === id)?.archetype !== 'melee') return [];
    for (const c of DESIGN.classes) {
      for (const [lineId, line] of Object.entries(c.lines)) {
        if (!line.tiers.flat().includes(id)) continue;
        const heroes = sprites.heroes as Record<string, { lines: Record<string, { weapon?: string }> }>;
        const name = heroes[c.id]?.lines[lineId]?.weapon;
        const wclass = column(weapons.find((w) => w['name'] === name) ?? {}, 'wclass').toLowerCase();
        if (!wclass) return [];
        const large = resolve(`weapon_${wclass}_large_1`);
        return large.length > 0 ? large : resolve(`weapon_${wclass}_small_1`);
      }
    }
    return [];
  };
  const manifest: SoundManifest = {
    music: env ? (resolve(column(env, 'Song'), 'global/music/')[0] ?? null) : null,
    ambience: env ? (resolve(column(env, 'Day Ambience'))[0] ?? null) : null,
    gold: resolve(soundsJson.gold),
    // Every skill's cast (raising a summon is its cast), every missile's flight and impact
    cast: Object.fromEntries(
      DESIGN.skills.map(({ id }) => {
        const row = skills.find((r) => r['skill'] === skillName(id));
        // stsound, else the class's own start sound (the War Cries, Bash's grunt), else the
        // sound of its doing (Fire Blast's throw) or of its charge-up (Arctic Blast, Tiger Strike)
        const name = row ? ['stsound', 'stsoundclass', 'dosound', 'prgsound'].map((c) => column(row, c)).find(Boolean) : undefined;
        const own = name ? resolve(name) : [];
        return [id, own.length > 0 ? own : swingOf(id)];
      }),
    ),
    travel: Object.fromEntries(artMissiles().map((m) => [m, resolve(column(missiles.find((r) => r['Missile'] === m) ?? {}, 'TravelSound'))])),
    hit: Object.fromEntries(artMissiles().map((m) => [m, resolve(column(missiles.find((r) => r['Missile'] === m) ?? {}, 'HitSound'))])),
    death: {},
    items: {},
    cow: { portal: resolve(soundsJson.cow.portal), music: cowEnv ? (resolve(column(cowEnv, 'Song'), 'global/music/')[0] ?? null) : null },
    ui: { click: resolve(soundsJson.ui.click), hover: resolve(soundsJson.ui.hover), music: resolve(soundsJson.ui.music, 'global/music/')[0] ?? null },
    battle: { send: resolve(soundsJson.battle.send), kingHit: resolve(soundsJson.battle.kingHit), tyrael: resolve(soundsJson.battle.tyrael), victory: resolve(soundsJson.battle.victory) },
    volumePct: soundsJson.volumePct,
  };
  const itemTables = ['weapons.txt', 'armor.txt', 'misc.txt'].map((t) => readTable(source, t));
  for (const row of itemTables.flat()) {
    for (const col of ['dropsound', 'usesound']) {
      const name = column(row, col);
      if (name && !manifest.items[name]) manifest.items[name] = resolve(name);
    }
  }
  const ids = [...new Set([...MONSTER_ART, ...sprites.summons.ids])];
  for (const id of ids) {
    const mon = monstats.find((r) => r['Id'] === id);
    const snd = mon && monsounds.find((r) => r['Id'] === column(mon, 'MonSound'));
    manifest.death[id] = snd ? resolve(column(snd, 'DeathSound')) : [];
  }

  const tables = ['sounds.txt', 'skills.txt', 'missiles.txt', 'monstats.txt', 'monsounds.txt', 'levels.txt', 'soundenviron.txt', 'weapons.txt', 'armor.txt', 'misc.txt'].map(
    (t) => `global/excel/${t}`,
  );
  return {
    label: 'sounds',
    inputs: [...tables, ...files.values()],
    run: () => {
      const out: OutputFile[] = [...files].map(([to, from]) => ({ path: to, bytes: source.read(from) }));
      out.push({ path: 'sfx/sounds.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
      return out;
    },
  };
}
