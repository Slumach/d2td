// Sprite sheets for the game: monsters, the Paladin hero and missiles, decoded from DCC
// and COF files, coloured with the act 1 palette and D2's own colour shifts, written as
// PNG sheets plus Phaser atlas JSON.
//
//   Monsters  one atlas per monster and variant holding every mode in sprites.json
//             (walk, attack, death) in 8 directions, on one shared frame box so the
//             feet stay put across modes. Variants: normal; champion and unique add a
//             PL2 hue shift. A monster with a monstats TransLvl first takes that map
//             from its cof/palshift.dat (Dark One, Gargantuan Beast).
//   Hero      the Paladin in one armour and weapon set from sprites.json, neutral and
//             attack; an evolved variant takes a PL2 shift.
//   Missiles  one atlas per missile, every direction the DCC has.

import { animFps, decodeAnimData, type AnimData } from '../lib/animdata.ts';
import { compositeCode, decodeCof } from '../lib/cof.ts';
import { decodeDcc, type Dcc } from '../lib/dcc.ts';
import { decodePalDat } from '../lib/palette.ts';
import { encodePng } from '../lib/png.ts';
import { decodePl2, type Pl2 } from '../lib/pl2.ts';
import type { TxtRow } from '../lib/txt.ts';
import { composite, isGlowEffect, layerAlpha, type CompositeLayer } from './composite.ts';
import { column, readTable } from './paths.ts';
import type { DataSource } from './source.ts';

import monstersJson from '../../src/data/monsters.json';
import sprites from '../../src/data/render/sprites.json';

/** D2 file direction order for 8-direction animations, by direction index. */
export const DIRECTION_NAMES_8 = ['sw', 'nw', 'ne', 'se', 's', 'w', 'n', 'e'];
const PADDING = 1;
const ARMOR_VARIANTS = ['lit', 'med', 'hvy'];

export interface OutputFile {
  path: string;
  bytes: Uint8Array;
}

/** A job reads `inputs` from the source and produces output files. */
export interface SpriteJob {
  label: string;
  inputs: string[];
  run(): OutputFile[];
}

interface ShiftSpec {
  table: string;
  index?: number;
}

/** Palette with index remaps applied in order; index 0 stays transparent. */
export function remapped(palette: Uint8Array, maps: Uint8Array[]): Uint8Array {
  if (maps.length === 0) return palette;
  const out = new Uint8Array(palette.length);
  for (let i = 1; i < 256; i++) {
    let j = i;
    for (const map of maps) j = map[j] || j;
    out.set(palette.subarray(j * 4, j * 4 + 4), i * 4);
    out[i * 4 + 3] = 255;
  }
  return out;
}

function pl2Shift(pl2: Pl2, spec: ShiftSpec): Uint8Array {
  const table = (pl2 as unknown as Record<string, Uint8Array | Uint8Array[]>)[spec.table];
  if (!table) throw new Error(`pal.pl2 has no table ${spec.table}`);
  if (Array.isArray(table)) {
    const t = table[spec.index ?? 0];
    if (!t) throw new Error(`pal.pl2 ${spec.table} has no index ${spec.index}`);
    return t;
  }
  return table;
}

interface ModeSheet {
  mode: string;
  fps: number;
  /** frames[direction][frame], each frameWidth x frameHeight RGBA with the origin at originX/Y. */
  frames: Uint8Array[][];
  frameWidth: number;
  frameHeight: number;
  originX: number;
  originY: number;
}

/** Largest page side; many GPUs cap single textures at 4096. */
const PAGE_MAX = 4096;

interface Trimmed {
  name: string;
  /** Tight box inside the shared frame box. */
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint8Array;
}

/** Cuts a frame down to its visible pixels; an empty frame keeps a single transparent pixel. */
export function trim(name: string, rgba: Uint8Array, w: number, h: number): Trimmed {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { name, x: 0, y: 0, w: 1, h: 1, pixels: new Uint8Array(4) };
  const tw = x1 - x0 + 1;
  const th = y1 - y0 + 1;
  const pixels = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) pixels.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1 + 1) * 4), y * tw * 4);
  return { name, x: x0, y: y0, w: tw, h: th, pixels };
}

/**
 * Lays mode sheets onto a Phaser multi-atlas. Every frame shares one box (so the origin,
 * the feet, never moves across modes), is trimmed to its visible pixels, and is shelf-packed
 * tallest first onto pages no larger than PAGE_MAX.
 */
function atlasFrom(name: string, modes: ModeSheet[], directionNames: string[], meta: Record<string, unknown>): OutputFile[] {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const m of modes) {
    left = Math.min(left, -m.originX);
    top = Math.min(top, -m.originY);
    right = Math.max(right, m.frameWidth - m.originX);
    bottom = Math.max(bottom, m.frameHeight - m.originY);
  }
  const fw = right - left;
  const fh = bottom - top;
  const modeMeta: Record<string, object> = {};

  // Each frame onto the shared box, then trimmed
  const trimmed: Trimmed[] = [];
  for (const m of modes) {
    const dx = -m.originX - left;
    const dy = -m.originY - top;
    modeMeta[m.mode] = { frames: m.frames[0]!.length, fps: m.fps, directions: m.frames.length };
    m.frames.forEach((dirFrames, d) => {
      const dirName = directionNames[d] ?? String(d);
      dirFrames.forEach((rgba, f) => {
        const box = new Uint8Array(fw * fh * 4);
        for (let y = 0; y < m.frameHeight; y++) {
          box.set(rgba.subarray(y * m.frameWidth * 4, (y + 1) * m.frameWidth * 4), ((dy + y) * fw + dx) * 4);
        }
        trimmed.push(trim(`${m.mode}_${dirName}_${String(f).padStart(2, '0')}`, box, fw, fh));
      });
    });
  }

  // Shelf packing, tallest first
  interface Placed extends Trimmed {
    page: number;
    px: number;
    py: number;
  }
  const placed: Placed[] = [];
  const pageSizes: { w: number; h: number }[] = [];
  let page = 0;
  let cx = 0;
  let cy = 0;
  let shelf = 0;
  let pageW = 0;
  for (const t of [...trimmed].sort((a, b) => b.h - a.h || b.w - a.w)) {
    if (cx + t.w > PAGE_MAX) {
      cx = 0;
      cy += shelf + PADDING;
      shelf = 0;
    }
    if (cy + t.h > PAGE_MAX) {
      pageSizes[page] = { w: pageW, h: cy };
      page++;
      cx = 0;
      cy = 0;
      shelf = 0;
      pageW = 0;
    }
    placed.push({ ...t, page, px: cx, py: cy });
    cx += t.w + PADDING;
    shelf = Math.max(shelf, t.h);
    pageW = Math.max(pageW, cx);
  }
  pageSizes[page] = { w: pageW, h: cy + shelf };

  const base = name.split('/').pop()!;
  const files: OutputFile[] = [];
  const textures = pageSizes.map((size, p) => {
    const sheet = new Uint8Array(size.w * size.h * 4);
    const frames: object[] = [];
    for (const t of placed.filter((x) => x.page === p)) {
      for (let y = 0; y < t.h; y++) sheet.set(t.pixels.subarray(y * t.w * 4, (y + 1) * t.w * 4), ((t.py + y) * size.w + t.px) * 4);
      frames.push({
        filename: t.name,
        frame: { x: t.px, y: t.py, w: t.w, h: t.h },
        rotated: false,
        trimmed: true,
        spriteSourceSize: { x: t.x, y: t.y, w: t.w, h: t.h },
        sourceSize: { w: fw, h: fh },
      });
    }
    const image = `${base}-${p}.png`;
    files.push({ path: `${name}-${p}.png`, bytes: encodePng(size.w, size.h, sheet) });
    return { image, format: 'RGBA8888', size, scale: 1, frames };
  });

  const atlasMeta = {
    app: 'd2td tools/extract',
    frameWidth: fw,
    frameHeight: fh,
    origin: { x: -left, y: -top },
    directions: directionNames.slice(0, modes[0]!.frames.length),
    modes: modeMeta,
    pages: textures.length,
    ...meta,
  };
  // Phaser's multi-atlas parser copies each page's extra keys (not the file's) onto
  // texture.customData, so every page carries the meta block too
  const json = { textures: textures.map((t) => ({ ...t, meta: atlasMeta })), meta: atlasMeta };
  files.push({ path: `${name}.json`, bytes: new TextEncoder().encode(JSON.stringify(json)) });
  return files;
}

interface Shared {
  source: DataSource;
  palette: Uint8Array;
  pl2: Pl2;
  animdata: AnimData;
  monstats: TxtRow[];
  monstats2: TxtRow[];
}

/** monstats2 lists allowed part variants, e.g. "lit,med,hvy"; the first keeps output stable. */
function firstVariant(row: TxtRow, code: string): string {
  return column(row, `${code}v`).replace(/"/g, '').split(',')[0]?.trim().toLowerCase() || 'lit';
}

interface CompositeSpec {
  folder: string;
  token: string;
  mode: string;
  weaponClass: string;
  variant: (code: string) => string;
}

/** The COF and layer files a composite mode needs, read from the source. */
function compositeInputs(source: DataSource, spec: CompositeSpec): { cofPath: string; layers: Record<string, string> } | undefined {
  const cofPath = `global/${spec.folder}/cof/${spec.token}${spec.mode}${spec.weaponClass}.cof`.toLowerCase();
  if (!source.exists(cofPath)) return undefined;
  const cof = decodeCof(source.read(cofPath));
  const layers: Record<string, string> = {};
  for (const layer of cof.layers) {
    const code = compositeCode(layer.type);
    const variant = spec.variant(code);
    // "nil" is an empty slot (no shield, no pads): D2 draws nothing for that layer
    if (variant === 'nil') continue;
    layers[code] = `global/${spec.folder}/${code}/${spec.token}${code}${variant}${spec.mode}${layer.weaponClass}.dcc`.toLowerCase();
  }
  return { cofPath, layers };
}

function compositeMode(shared: Shared, spec: CompositeSpec, palette: Uint8Array): ModeSheet {
  const paths = compositeInputs(shared.source, spec)!;
  const cof = decodeCof(shared.source.read(paths.cofPath));
  const layers: CompositeLayer[] = cof.layers
    .filter((l) => paths.layers[compositeCode(l.type)] !== undefined)
    .map((l) => ({
      type: l.type,
      dcc: decodeDcc(shared.source.read(paths.layers[compositeCode(l.type)]!)),
      alpha: layerAlpha(l.transparent, l.drawEffect),
      additive: isGlowEffect(l.transparent, l.drawEffect),
    }));
  const result = composite(cof, layers, palette);
  const anim = shared.animdata.get(`${spec.token}${spec.mode}${spec.weaponClass}`.toUpperCase())?.[0];
  return {
    mode: spec.mode,
    fps: anim ? animFps(anim) : 25,
    frames: result.frames,
    frameWidth: result.frameWidth,
    frameHeight: result.frameHeight,
    originX: result.originX,
    originY: result.originY,
  };
}

function monsterJobs(shared: Shared): SpriteJob[] {
  const { source, pl2 } = shared;
  const bosses = new Set(Object.values(monstersJson.bosses));
  const ids = [...new Set([...Object.keys(monstersJson.roster), ...bosses])];
  const jobs: SpriteJob[] = [];
  for (const id of ids) {
    const row = shared.monstats.find((r) => r['Id'] === id);
    if (!row) throw new Error(`monstats.txt has no ${id}`);
    const ex = shared.monstats2.find((r) => r['Id'] === row['MonStatsEx'])!;
    const token = String(row['Code']).toLowerCase();
    const weaponClass = column(ex, 'BaseW').toLowerCase();
    const folder = `monsters/${token}`;
    const specs = sprites.monsterModes.map((mode) => ({ folder, token, mode, weaponClass, variant: (c: string) => firstVariant(ex, c) }));
    const transLvl = Number(row['TransLvl'] || 0);
    const palshift = `global/${folder}/cof/palshift.dat`;
    const inputs = [...(transLvl > 0 ? [palshift] : [])];
    for (const spec of specs) {
      const found = compositeInputs(source, spec);
      if (!found) inputs.push(`global/${folder}/cof/${token}${spec.mode}${weaponClass}.cof`.toLowerCase());
      else inputs.push(found.cofPath, ...Object.values(found.layers));
    }
    const variants: [string, ShiftSpec | undefined][] = bosses.has(id)
      ? [['normal', undefined]]
      : [
          ['normal', undefined],
          ['champion', sprites.colorShifts.champion],
          ['unique', sprites.colorShifts.unique],
        ];
    jobs.push({
      label: `monster ${id}`,
      inputs,
      run: () => {
        const own = transLvl > 0 ? [source.read(palshift).slice(transLvl * 256, transLvl * 256 + 256)] : [];
        const out: OutputFile[] = [];
        for (const [variant, shift] of variants) {
          const palette = remapped(shared.palette, shift ? [...own, pl2Shift(pl2, shift)] : own);
          const modes = specs.map((s) => compositeMode(shared, s, palette));
          out.push(...atlasFrom(`monsters/${id}/${variant}`, modes, DIRECTION_NAMES_8, { monster: id, variant }));
        }
        return out;
      },
    });
  }
  return jobs;
}

function heroJob(shared: Shared): SpriteJob {
  const { source } = shared;
  const armor = readTable(source, 'armor.txt');
  const weapons = readTable(source, 'weapons.txt');
  const h = sprites.hero;
  const named = (rows: TxtRow[], name: string) => {
    const r = rows.find((x) => x['name'] === name);
    if (!r) throw new Error(`No item named ${name}`);
    return r;
  };
  const body = named(armor, h.armor);
  const weapon = named(weapons, h.weapon);
  // armor.txt says which layer variant (0 lit, 1 med, 2 hvy) each body part shows
  const part = (col: string) => ARMOR_VARIANTS[Number(body[col] || 0)] ?? 'lit';
  const equipment: Record<string, string> = {
    HD: String(named(armor, h.helm)['code']),
    TR: part('Torso'),
    LG: part('Legs'),
    RA: part('rArm'),
    LA: part('lArm'),
    S1: part('lSPad'),
    S2: part('rSPad'),
    RH: String(weapon['code']),
    SH: String(named(armor, h.shield)['code']),
  };
  const token = h.token.toLowerCase();
  const weaponClass = String(weapon['wclass']).toLowerCase();
  const specs = h.modes.map((mode) => ({ folder: `chars/${token}`, token, mode, weaponClass, variant: (c: string) => equipment[c] ?? 'lit' }));
  const inputs: string[] = [];
  for (const spec of specs) {
    const found = compositeInputs(source, spec);
    if (!found) inputs.push(`global/chars/${token}/cof/${token}${spec.mode}${weaponClass}.cof`);
    else inputs.push(found.cofPath, ...Object.values(found.layers));
  }
  return {
    label: 'hero paladin',
    inputs,
    run: () => {
      const out: OutputFile[] = [];
      for (const [variant, shift] of [['normal', undefined], ['evolved', sprites.colorShifts.evolved]] as const) {
        const palette = remapped(shared.palette, shift ? [pl2Shift(shared.pl2, shift)] : []);
        const modes = specs.map((s) => compositeMode(shared, s, palette));
        out.push(...atlasFrom(`hero/paladin/${variant}`, modes, DIRECTION_NAMES_8, { hero: 'paladin', variant, equipment }));
      }
      return out;
    },
  };
}

/** A single-layer DCC as mode "missile" frames, with its own origin. */
function dccSheet(dcc: Dcc, palette: Uint8Array, fps: number): ModeSheet {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const dir of dcc.directions) {
    left = Math.min(left, dir.box.left);
    top = Math.min(top, dir.box.top);
    right = Math.max(right, dir.box.left + dir.box.width);
    bottom = Math.max(bottom, dir.box.top + dir.box.height);
  }
  const w = right - left;
  const h = bottom - top;
  const frames = dcc.directions.map((dir) =>
    dir.frames.map((frame) => {
      const out = new Uint8Array(w * h * 4);
      for (let y = 0; y < dir.box.height; y++) {
        for (let x = 0; x < dir.box.width; x++) {
          const index = frame.pixelData[x + y * dir.box.width]!;
          if (index === 0) continue;
          const o = (x + dir.box.left - left + (y + dir.box.top - top) * w) * 4;
          out.set(palette.subarray(index * 4, index * 4 + 4), o);
        }
      }
      return out;
    }),
  );
  return { mode: 'MS', fps, frames, frameWidth: w, frameHeight: h, originX: -left, originY: -top };
}

function missileJobs(shared: Shared): SpriteJob[] {
  const missiles = readTable(shared.source, 'missiles.txt');
  const ids = [...new Set(Object.values(sprites.missiles).flat())];
  return ids.map((id) => {
    const row = missiles.find((r) => r['Missile'] === id);
    if (!row) throw new Error(`missiles.txt has no ${id}`);
    const path = `global/missiles/${String(row['CelFile']).toLowerCase()}.dcc`;
    // missiles.txt animrate: 1024 plays at D2's full 25 frames per second
    const fps = (25 * Number(row['animrate'] || 1024)) / 1024;
    const blend = Number(row['Trans'] || 0);
    return {
      label: `missile ${id}`,
      inputs: [path],
      run: () => {
        const dcc = decodeDcc(shared.source.read(path));
        const sheet = dccSheet(dcc, shared.palette, fps);
        const names = Array.from({ length: dcc.numberOfDirections }, (_, i) => String(i));
        return atlasFrom(`missiles/${id}`, [sheet], names, { missile: id, celFile: row['CelFile'], blend, dccDirections: dcc.numberOfDirections });
      },
    };
  });
}

/** Every sprite job, with its inputs known up front (COFs are read to list their layers). */
export function spriteJobs(source: DataSource): { jobs: SpriteJob[]; sharedInputs: string[]; missing: string[] } {
  const sharedInputs = ['global/palette/act1/pal.dat', 'global/palette/act1/pal.pl2', 'global/animdata.d2', 'global/excel/monstats.txt', 'global/excel/monstats2.txt', 'global/excel/armor.txt', 'global/excel/weapons.txt', 'global/excel/missiles.txt'];
  const missingShared = sharedInputs.filter((p) => !source.exists(p));
  if (missingShared.length > 0) return { jobs: [], sharedInputs, missing: missingShared };

  let cache: Shared | undefined;
  const shared = (): Shared =>
    (cache ??= {
      source,
      palette: decodePalDat(source.read('global/palette/act1/pal.dat')),
      pl2: decodePl2(source.read('global/palette/act1/pal.pl2')),
      animdata: decodeAnimData(source.read('global/animdata.d2')),
      monstats: readTable(source, 'monstats.txt'),
      monstats2: readTable(source, 'monstats2.txt'),
    });
  const s = shared();
  const jobs = [...monsterJobs(s), heroJob(s), ...missileJobs(s)];
  const missing = [...new Set(jobs.flatMap((j) => j.inputs))].filter((p) => !source.exists(p));
  return { jobs, sharedInputs, missing };
}
