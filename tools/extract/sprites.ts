// Sprite sheets for the game: monsters, the class heroes, summons, missiles and overlays,
// decoded from DCC and COF files, coloured with the act 1 palette and D2's own colour
// shifts, written as PNG sheets plus Phaser atlas JSON.
//
//   Monsters  one atlas per monster and variant holding every mode in sprites.json
//             (walk, attack, death) in 8 directions, on one shared frame box so the
//             feet stay put across modes. Variants: normal; champion and unique add a
//             PL2 hue shift. A monster with a monstats TransLvl first takes that map
//             from its cof/palshift.dat (Dark One, Gargantuan Beast).
//   Summons   the Necromancer's skeletons and skeletal mages, normal only, with their
//             rising mode (S1).
//   Heroes    each class in its line's weapon set and its tier's armour, neutral and
//             attack (A1 for the Paladin, the cast SC for the casters); an evolved
//             variant takes a PL2 shift.
//   Missiles  one atlas per missile a skill shows (sprites.json skillArt), plus each
//             one's missiles.txt ExplosionMissile, every direction the DCC has.
//   Overlays  overlay.txt effects (curses, Enchant, frozen, poisoned), one atlas each.

import { animFps, decodeAnimData, type AnimData } from '../lib/animdata.ts';
import { compositeCode, decodeCof } from '../lib/cof.ts';
import { dc6AsDcc, decodeDc6 } from '../lib/dc6.ts';
import { decodeDcc, type Dcc } from '../lib/dcc.ts';
import { decodePalDat } from '../lib/palette.ts';
import { encodePng } from '../lib/png.ts';
import { decodePl2, type Pl2 } from '../lib/pl2.ts';
import type { TxtRow } from '../lib/txt.ts';
import { composite, isGlowEffect, layerAlpha, type CompositeLayer } from './composite.ts';
import { column, readTable } from './paths.ts';
import type { DataSource } from './source.ts';

import { ART_ACT, NAMED_ART, MONSTER_ART, SUPERUNIQUE_ART } from '../../src/data/monsterArt.ts';
import legends from '../../src/data/legends.json';
import sprites from '../../src/data/render/sprites.json';
import { MISSILE_INDEX, artMissiles, artOverlays } from '../../src/render/art.ts';

/** D2 file direction order for 8-direction animations, by direction index. */
export const DIRECTION_NAMES_8 = ['sw', 'nw', 'ne', 'se', 's', 'w', 'n', 'e'];
const PADDING = 1;
/** A T5 legend's figure: standing, and swinging when its towers act. */
const LEGEND_MODES = ['NU', 'A1'];

export interface OutputFile {
  path: string;
  bytes: Uint8Array;
}

/** A job reads `inputs` from the source and produces output files. */
export interface SpriteJob {
  label: string;
  inputs: string[];
  /**
   * Bumped when the job's code changes what it writes from the same inputs, so an update
   * re-runs it; a job whose label, inputs and rev are unchanged is reused.
   */
  rev?: number | string;
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
    // The page ends at the last frame's edge, not after its padding: never past PAGE_MAX
    pageW = Math.max(pageW, cx + t.w);
    cx += t.w + PADDING;
    shelf = Math.max(shelf, t.h);
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
  /** Each act's palette and colour shifts: a monster draws in the act it first walks in. */
  acts: Map<number, { palette: Uint8Array; pl2: Pl2 }>;
  animdata: AnimData;
  monstats: TxtRow[];
  monstats2: TxtRow[];
}

/** monstats2 lists allowed part variants, e.g. "lit,med,hvy"; the first keeps output stable. */
function variantsOf(row: TxtRow, code: string): string[] {
  const listed = column(row, `${code}v`).replace(/"/g, '').split(',').map((v) => v.trim().toLowerCase()).filter((v) => v !== '');
  return listed.length > 0 ? listed : ['lit'];
}

function firstVariant(row: TxtRow, code: string): string {
  return variantsOf(row, code)[0]!;
}

/** What a monster plays for a mode it has no COF for: a stationary one stands, a caster casts. */
// A1 last falls back to standing: a town NPC drawn as a T5 legend (Akara, Kashya) has no attack
const MODE_FALLBACK: Record<string, string[]> = { WL: ['NU', 'S1'], A1: ['S1', 'A2', 'SC', 'NU'], S1: ['NU'], DT: ['DD'], DD: ['DT'] };

interface CompositeSpec {
  folder: string;
  token: string;
  mode: string;
  /** The animation it is saved as, when it stands in for a mode the monster lacks. */
  as?: string;
  weaponClass: string;
  variant: (code: string) => string;
  /** A monster's other variants for a layer, tried when the first is not drawn for this mode. */
  alternatives?: (code: string) => string[];
  /** Heroes: a layer with no file for this pose (a left hand with no bow) draws nothing. */
  lenient?: boolean;
}

/** A COF layer's animation, from its DCC or its DC6. */
function decodeLayer(source: DataSource, path: string): Dcc {
  const bytes = source.read(path);
  return path.endsWith('.dc6') ? dc6AsDcc(decodeDc6(bytes)) : decodeDcc(bytes);
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
    // D2 reads a layer's DCC, or its DC6 when there is no DCC (Mephisto's layers are all DC6)
    const at = (v: string) => {
      const base = `global/${spec.folder}/${code}/${spec.token}${code}${v}${spec.mode}${layer.weaponClass}`.toLowerCase();
      return source.exists(`${base}.dcc`) || !source.exists(`${base}.dc6`) ? `${base}.dcc` : `${base}.dc6`;
    };
    const path = at(variant);
    if (spec.lenient && !source.exists(path)) continue;
    if (spec.alternatives && !source.exists(path)) {
      // A layer the monster does not draw in this mode (a Huntress's pads as she dies) is
      // another of its variants, or nothing, as D2 draws it
      const other = spec.alternatives(code).map(at).find((p) => source.exists(p));
      if (other) layers[code] = other;
      continue;
    }
    layers[code] = path;
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
      dcc: decodeLayer(shared.source, paths.layers[compositeCode(l.type)]!),
      alpha: layerAlpha(l.transparent, l.drawEffect),
      additive: isGlowEffect(l.transparent, l.drawEffect),
    }));
  const result = composite(cof, layers, palette);
  const anim = shared.animdata.get(`${spec.token}${spec.mode}${spec.weaponClass}`.toUpperCase())?.[0];
  return {
    mode: spec.as ?? spec.mode,
    fps: anim ? animFps(anim) : 25,
    frames: result.frames,
    frameWidth: result.frameWidth,
    frameHeight: result.frameHeight,
    originX: result.originX,
    originY: result.originY,
  };
}

function monsterJobs(shared: Shared): SpriteJob[] {
  const { source } = shared;
  const bosses = new Set(NAMED_ART);
  const summons = new Set(sprites.summons.ids);
  // The T5 legends' NPCs and monsters, standing and swinging
  const legendArt = new Set(Object.values(legends).map((l) => l.monster));
  // Eternal Conflict's workers: the hirelings, in their own acts' palettes
  const hirelings = (sprites as { hirelings?: { ids: Record<string, number> } }).hirelings?.ids ?? {};
  const ids = [...new Set([...MONSTER_ART, ...summons, ...legendArt, ...Object.keys(hirelings)])];
  // A superunique wears its class's art in its own palette: palshift.dat row Utrans
  const superuniques = readTable(source, 'superuniques.txt');
  const jobs: SpriteJob[] = [];
  for (const id of ids) {
    const row = shared.monstats.find((r) => r['Id'] === id);
    if (!row) throw new Error(`monstats.txt has no ${id}`);
    const ex = shared.monstats2.find((r) => r['Id'] === row['MonStatsEx'])!;
    const token = String(row['Code']).toLowerCase();
    const weaponClass = column(ex, 'BaseW').toLowerCase();
    const folder = `monsters/${token}`;
    const modes = summons.has(id) ? sprites.summons.modes : legendArt.has(id) || hirelings[id] ? LEGEND_MODES : sprites.monsterModes;
    // A mode the base weapon class lacks plays hand to hand (a Goatman's death is hth)
    const cofFor = (mode: string, wc: string) => `global/${folder}/cof/${token}${mode}${wc}.cof`.toLowerCase();
    const classFor = (mode: string) => (!source.exists(cofFor(mode, weaponClass)) && source.exists(cofFor(mode, 'hth')) ? 'hth' : weaponClass);
    const specFor = (mode: string, want: string) => ({
      folder,
      token,
      mode,
      ...(mode !== want ? { as: want } : {}),
      weaponClass: classFor(mode),
      variant: (c: string) => firstVariant(ex, c),
      alternatives: (c: string) => variantsOf(ex, c).slice(1),
    });
    // A mode counts when its COF exists and at least one of its layers is a DCC (the Sand
    // Maggot Queen's death is a DC6, which a composite cannot use)
    const has = (mode: string) => Object.keys(compositeInputs(source, specFor(mode, mode))?.layers ?? {}).length > 0;
    const specs = modes.map((want) => specFor(has(want) ? want : ((MODE_FALLBACK[want] ?? []).find(has) ?? want), want));
    const palshift = `global/${folder}/cof/palshift.dat`;
    // A TransLvl with no palshift.dat beside the COFs (the Council) draws in the plain palette
    const transLvl = source.exists(palshift) ? Number(row['TransLvl'] || 0) : 0;
    const inputs = [...(transLvl > 0 ? [palshift] : [])];
    for (const spec of specs) {
      const found = compositeInputs(source, spec);
      if (!found) inputs.push(cofFor(spec.mode, spec.weaponClass));
      else inputs.push(found.cofPath, ...Object.values(found.layers));
    }
    const variants: [string, ShiftSpec | undefined][] = bosses.has(id) || summons.has(id) || hirelings[id]
      ? [['normal', undefined]]
      : [
          ['normal', undefined],
          ['champion', sprites.colorShifts.champion],
          ['unique', sprites.colorShifts.unique],
        ];
    const named = SUPERUNIQUE_ART.filter((su) => su.class === id).map((su) => {
      const row = superuniques.find((r) => r['Superunique'] === su.superunique);
      if (!row) throw new Error(`superuniques.txt has no ${su.superunique}`);
      return { name: `su_${su.id}`, utrans: Number(row['Utrans'] || 0) };
    });
    if (named.length > 0) inputs.push('global/excel/superuniques.txt');
    if (named.some((n) => n.utrans > 0) && !inputs.includes(palshift) && source.exists(palshift)) inputs.push(palshift);
    const act = summons.has(id) ? 1 : (hirelings[id] ?? ART_ACT[id] ?? 1);
    const { palette: actPalette, pl2 } = shared.acts.get(act) ?? { palette: shared.palette, pl2: shared.pl2 };
    jobs.push({
      label: `monster ${id}`,
      inputs,
      run: () => {
        const own = transLvl > 0 ? [source.read(palshift).slice(transLvl * 256, transLvl * 256 + 256)] : [];
        const out: OutputFile[] = [];
        for (const [variant, shift] of variants) {
          const palette = remapped(actPalette, shift ? [...own, pl2Shift(pl2, shift)] : own);
          const modes = specs.map((s) => compositeMode(shared, s, palette));
          out.push(...atlasFrom(`monsters/${id}/${variant}`, modes, DIRECTION_NAMES_8, { monster: id, variant }));
        }
        for (const { name, utrans } of named) {
          // Utrans picks a row of the class's palshift.dat in place of its own TransLvl row
          const rows = utrans > 0 && source.exists(palshift) ? source.read(palshift) : undefined;
          const shiftRow = rows && rows.length >= (utrans + 1) * 256 ? [rows.slice(utrans * 256, utrans * 256 + 256)] : own;
          const modes = specs.map((s) => compositeMode(shared, s, remapped(actPalette, shiftRow)));
          out.push(...atlasFrom(`monsters/${id}/${name}`, modes, DIRECTION_NAMES_8, { monster: id, variant: name }));
        }
        return out;
      },
    });
  }
  return jobs;
}

interface HeroLine {
  weapon?: string;
  shield?: string;
}

interface HeroTier {
  /** The armour layer variant every body part shows: lit, med or hvy. */
  body: string;
  helm?: string;
}

interface HeroClass {
  token: string;
  /** The mode a tower plays when it acts: A1 for the Paladin's swings, SC for casters. */
  attackMode: string;
  lines: Record<string, HeroLine>;
}

/**
 * A tower's look is its class, line and tier: the line picks the weapon and shield (a
 * staff or an orb for the Sorceress, a wand or a dagger and a bone shield for the
 * Necromancer, bare hands for the Paladin's aura line and the Sorceress's support line),
 * the tier the armour weight and helm. One job per class and line, building an atlas per
 * tier plus the evolved recolour in top-tier gear.
 */
function heroJobs(shared: Shared): SpriteJob[] {
  const { source } = shared;
  const armor = readTable(source, 'armor.txt');
  const weapons = readTable(source, 'weapons.txt');
  const named = (rows: TxtRow[], name: string) => {
    const r = rows.find((x) => x['name'] === name);
    if (!r) throw new Error(`No item named ${name}`);
    return r;
  };
  // An item draws with its alternategfx layer when it has one (a Scepter draws as a mace)
  const gfx = (row: TxtRow) => String(column(row, 'alternategfx') || row['code']).toLowerCase();
  const tiers = sprites.heroTiers as HeroTier[];
  return Object.entries(sprites.heroes as Record<string, HeroClass>).flatMap(([cls, h]) =>
    heroClassJobs(shared, cls, h, tiers, (name) => named(weapons, name), (name) => named(armor, name), gfx),
  );
}

function heroClassJobs(
  shared: Shared,
  cls: string,
  h: HeroClass,
  tiers: HeroTier[],
  weaponNamed: (name: string) => TxtRow,
  armorNamed: (name: string) => TxtRow,
  gfx: (row: TxtRow) => string,
): SpriteJob[] {
  const { source } = shared;
  const named = (rows: 'w' | 'a', name: string) => (rows === 'w' ? weaponNamed(name) : armorNamed(name));
  const token = h.token.toLowerCase();
  const heroModes = ['NU', h.attackMode];
  return Object.entries(h.lines).map(([line, gear]) => {
    const weapon = gear.weapon ? named('w', gear.weapon) : undefined;
    // Unarmed is D2's hand-to-hand class; nil leaves the weapon and shield layers empty
    const weaponClass = weapon ? String(weapon['wclass']).toLowerCase() : 'hth';
    const equipmentFor = (tier: HeroTier): Record<string, string> =>
      heroEquipment(tier, tier.helm ? gfx(named('a', tier.helm)) : undefined, weapon ? gfx(weapon) : undefined, gear.shield ? gfx(named('a', gear.shield)) : undefined);
    const looks = tiers.map((tier, i) => {
      const equipment = equipmentFor(tier);
      const specs = heroModes.map((mode) => ({ folder: `chars/${token}`, token, mode, weaponClass, variant: (c: string) => equipment[c] ?? 'lit', lenient: true }));
      return { name: `t${i + 1}`, equipment, specs };
    });
    const inputs: string[] = [];
    for (const spec of looks.flatMap((l) => l.specs)) {
      const found = compositeInputs(source, spec);
      if (!found) inputs.push(`global/chars/${token}/cof/${token}${spec.mode}${weaponClass}.cof`);
      else inputs.push(found.cofPath, ...Object.values(found.layers));
    }
    return {
      label: `hero ${cls} ${line}`,
      inputs: [...new Set(inputs)],
      // 2: a weapon draws in both hand layers (a bow is a left-hand layer, a crossbow both)
      rev: 2,
      run: () => {
        const out: OutputFile[] = [];
        const plain = remapped(shared.palette, []);
        for (const look of looks) {
          const modes = look.specs.map((s) => compositeMode(shared, s, plain));
          out.push(...atlasFrom(`hero/${cls}/${line}-${look.name}`, modes, DIRECTION_NAMES_8, { hero: cls, line, tier: look.name, equipment: look.equipment }));
        }
        const top = looks.at(-1)!;
        const evolved = remapped(shared.palette, [pl2Shift(shared.pl2, sprites.colorShifts.evolved)]);
        const modes = top.specs.map((s) => compositeMode(shared, s, evolved));
        out.push(...atlasFrom(`hero/${cls}/${line}-evolved`, modes, DIRECTION_NAMES_8, { hero: cls, line, tier: 'evolved', equipment: top.equipment }));
        return out;
      },
    };
  });
}

/**
 * The layer variants a hero look draws: the tier's armour on every body part and its helm,
 * the weapon in both hand layers (D2 draws a sword in the right hand, a bow in the left and
 * a crossbow in both; a hand with no file for the weapon draws nothing), and the shield.
 */
function heroEquipment(tier: HeroTier, helm: string | undefined, weapon: string | undefined, shield: string | undefined): Record<string, string> {
  return {
    HD: helm ?? 'lit',
    TR: tier.body,
    LG: tier.body,
    RA: tier.body,
    LA: tier.body,
    S1: tier.body,
    S2: tier.body,
    RH: weapon ?? 'nil',
    LH: weapon ?? 'nil',
    SH: shield ?? 'nil',
  };
}

/** A tower's look with the weapon and shield it wears, composited on request (heroGearFiles). */
export interface HeroGearSpec {
  cls: string;
  line: string;
  /** t1, t2, t3 or evolved. */
  look: string;
  /** weapons.txt code, or '' to keep the line's own weapon. */
  weapon: string;
  /** armor.txt code of a shield, or '' to keep the line's own (none under a two-handed weapon). */
  shield: string;
}

/** Where a worn look's atlas lives under the assets folder, without the .json. */
export function heroGearPath(s: HeroGearSpec): string {
  return `hero-gear/${s.cls}/${s.line}-${s.look}-${s.weapon || 'own'}-${s.shield || 'own'}`;
}

/** The look a hero-gear atlas or page path names, or undefined if it is not one. */
export function parseHeroGearPath(path: string): HeroGearSpec | undefined {
  const m = /^hero-gear\/([a-z]+)\/([a-z]+)-(t\d|evolved)-([a-z0-9]+)-([a-z0-9]+)(?:-\d+\.png|\.json)$/.exec(path);
  if (!m) return undefined;
  const [, cls, line, look, weapon, shield] = m as unknown as string[];
  return { cls: cls!, line: line!, look: look!, weapon: weapon === 'own' ? '' : weapon!, shield: shield === 'own' ? '' : shield! };
}

/**
 * Composites one tower look with a worn weapon and shield from the game files: the class's
 * line at that tier, the weapon's own weapon class (a bow on a Paladin swings as a bowman),
 * its graphic in the hands, and the shield on the shield arm unless the weapon takes both
 * hands. The app does this the first time a tower wears the pair and keeps the atlas.
 */
export function heroGearFiles(source: DataSource, spec: HeroGearSpec): OutputFile[] {
  const h = (sprites.heroes as Record<string, HeroClass>)[spec.cls];
  const gear = h?.lines[spec.line];
  if (!h || !gear) throw new Error(`No hero look ${spec.cls} ${spec.line}`);
  const tiers = sprites.heroTiers as HeroTier[];
  const tierIndex = spec.look === 'evolved' ? tiers.length - 1 : Number(spec.look.slice(1)) - 1;
  const tier = tiers[tierIndex];
  if (!tier) throw new Error(`No hero tier ${spec.look}`);
  const armor = readTable(source, 'armor.txt');
  const weapons = readTable(source, 'weapons.txt');
  const gfx = (row: TxtRow) => String(column(row, 'alternategfx') || row['code']).toLowerCase();
  const byCode = (rows: TxtRow[], code: string) => rows.find((r) => String(r['code']).toLowerCase() === code.toLowerCase());
  const byName = (rows: TxtRow[], name: string) => rows.find((r) => r['name'] === name);
  const weapon = spec.weapon ? byCode(weapons, spec.weapon) : gear.weapon ? byName(weapons, gear.weapon) : undefined;
  if (spec.weapon && !weapon) throw new Error(`No weapon ${spec.weapon}`);
  const weaponClass = weapon ? String(weapon['wclass']).toLowerCase() : 'hth';
  const twoHanded = !!weapon && (String(column(weapon, '2handed')) === '1' || ['2hs', '2ht', 'bow', 'xbw', 'stf'].includes(weaponClass));
  const shieldRow = twoHanded ? undefined : spec.shield ? byCode(armor, spec.shield) : gear.shield ? byName(armor, gear.shield) : undefined;
  const helm = tier.helm ? byName(armor, tier.helm) : undefined;
  const equipment = heroEquipment(tier, helm ? gfx(helm) : undefined, weapon ? gfx(weapon) : undefined, shieldRow ? gfx(shieldRow) : undefined);
  const token = h.token.toLowerCase();
  const palette = decodePalDat(source.read('global/palette/act1/pal.dat'));
  const pl2 = decodePl2(source.read('global/palette/act1/pal.pl2'));
  const shared = { source, palette, pl2, animdata: decodeAnimData(source.read('global/animdata.d2')) } as unknown as Shared;
  const colours = spec.look === 'evolved' ? remapped(palette, [pl2Shift(pl2, sprites.colorShifts.evolved)]) : remapped(palette, []);
  const modes = ['NU', h.attackMode].flatMap((mode) => {
    const s: CompositeSpec = { folder: `chars/${token}`, token, mode, weaponClass, variant: (c: string) => equipment[c] ?? 'lit', lenient: true };
    // A weapon class the class has no pose for (no COF) keeps the line's own
    return compositeInputs(source, s) ? [compositeMode(shared, s, colours)] : [];
  });
  if (modes.length === 0) throw new Error(`${spec.cls} has no ${weaponClass} poses`);
  return atlasFrom(heroGearPath(spec), modes, DIRECTION_NAMES_8, { hero: spec.cls, line: spec.line, tier: spec.look, equipment });
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
  const rowOf = (id: string) => {
    const row = missiles.find((r) => r['Missile'] === id);
    if (!row) throw new Error(`missiles.txt has no ${id}`);
    return row;
  };
  const dccOf = (row: TxtRow) => `global/missiles/${String(row['CelFile']).toLowerCase()}.dcc`;
  // Each missile's ExplosionMissile plays where it lands, when it has art of its own
  const explosionOf = (row: TxtRow) => {
    const id = column(row, 'ExplosionMissile');
    const ex = id ? missiles.find((r) => r['Missile'] === id) : undefined;
    return ex && shared.source.exists(dccOf(ex)) ? id : '';
  };
  const named = artMissiles();
  const ids = [...new Set([...named, ...named.map((id) => explosionOf(rowOf(id))).filter(Boolean)])];
  // The index has no game inputs: its rev is its own list, so a new missile re-writes it
  // (a fixed key kept the first index ever written, and missiles added later never loaded)
  const index: SpriteJob = {
    label: 'missile index',
    inputs: [],
    rev: [...ids].sort().join(',').split('').reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261),
    run: () => [{ path: MISSILE_INDEX, bytes: new TextEncoder().encode(JSON.stringify({ missiles: ids }, null, 2)) }],
  };
  return [index, ...ids.map((id) => {
    const row = rowOf(id);
    const path = dccOf(row);
    // missiles.txt animrate: 1024 plays at D2's full 25 frames per second
    const fps = (25 * Number(row['animrate'] || 1024)) / 1024;
    const blend = Number(row['Trans'] || 0);
    const explosion = explosionOf(row);
    return {
      label: `missile ${id}`,
      inputs: [path],
      run: () => {
        const dcc = decodeDcc(shared.source.read(path));
        const sheet = dccSheet(dcc, shared.palette, fps);
        const names = Array.from({ length: dcc.numberOfDirections }, (_, i) => String(i));
        return atlasFrom(`missiles/${id}`, [sheet], names, { missile: id, celFile: row['CelFile'], blend, dccDirections: dcc.numberOfDirections, explosion });
      },
    };
  })];
}

function overlayJobs(shared: Shared): SpriteJob[] {
  const overlays = readTable(shared.source, 'overlay.txt');
  return artOverlays().map((id) => {
    const row = overlays.find((r) => r['overlay'] === id);
    if (!row) throw new Error(`overlay.txt has no ${id}`);
    const path = `global/overlays/${String(row['Filename']).replace(/\\/g, '/').toLowerCase()}.dcc`;
    // overlay.txt AnimRate counts frames per second at D2's 25 fps, 16 being its full rate
    const fps = Math.max(1, (25 * Number(row['AnimRate'] || 16)) / 16);
    const blend = Number(row['Trans'] || 0);
    return {
      label: `overlay ${id}`,
      inputs: [path],
      run: () => {
        const dcc = decodeDcc(shared.source.read(path));
        const sheet = dccSheet(dcc, shared.palette, fps);
        const names = Array.from({ length: dcc.numberOfDirections }, (_, i) => String(i));
        return atlasFrom(`overlays/${id}`, [sheet], names, { overlay: id, blend, dccDirections: dcc.numberOfDirections });
      },
    };
  });
}

/** Objects the game draws (sprites.json objects): the cow level's red portal. One direction, Act 1's palette. */
function objectJobs(shared: Shared): SpriteJob[] {
  const objects = (sprites as { objects?: Record<string, { token: string; modes: string[]; variant: string }> }).objects ?? {};
  return Object.entries(objects).map(([id, o]) => {
    const token = o.token.toLowerCase();
    const specs: CompositeSpec[] = o.modes.map((mode) => ({ folder: `objects/${token}`, token, mode, weaponClass: 'hth', variant: () => o.variant }));
    const inputs = specs.flatMap((spec) => {
      const found = compositeInputs(shared.source, spec);
      return found ? [found.cofPath, ...Object.values(found.layers)] : [`global/objects/${token}/cof/${token}${spec.mode}hth.cof`.toLowerCase()];
    });
    return {
      label: `object ${id}`,
      inputs,
      run: () => atlasFrom(`objects/${id}`, specs.map((spec) => compositeMode(shared, spec, shared.palette)), ['s'], { object: id }),
    };
  });
}

const ACTS = [1, 2, 3, 4, 5];

/** Every sprite job, with its inputs known up front (COFs are read to list their layers). */
export function spriteJobs(source: DataSource): { jobs: SpriteJob[]; sharedInputs: string[]; missing: string[] } {
  const sharedInputs = [
    ...ACTS.flatMap((a) => [`global/palette/act${a}/pal.dat`, `global/palette/act${a}/pal.pl2`]),
    'global/animdata.d2',
    'global/excel/monstats.txt',
    'global/excel/monstats2.txt',
    'global/excel/armor.txt',
    'global/excel/weapons.txt',
    'global/excel/missiles.txt',
    'global/excel/overlay.txt',
  ];
  const missingShared = sharedInputs.filter((p) => !source.exists(p));
  if (missingShared.length > 0) return { jobs: [], sharedInputs, missing: missingShared };

  let cache: Shared | undefined;
  const shared = (): Shared =>
    (cache ??= {
      source,
      palette: decodePalDat(source.read('global/palette/act1/pal.dat')),
      pl2: decodePl2(source.read('global/palette/act1/pal.pl2')),
      acts: new Map(ACTS.map((a) => [a, { palette: decodePalDat(source.read(`global/palette/act${a}/pal.dat`)), pl2: decodePl2(source.read(`global/palette/act${a}/pal.pl2`)) }])),
      animdata: decodeAnimData(source.read('global/animdata.d2')),
      monstats: readTable(source, 'monstats.txt'),
      monstats2: readTable(source, 'monstats2.txt'),
    });
  const s = shared();
  const jobs = [...monsterJobs(s), ...heroJobs(s), ...missileJobs(s), ...overlayJobs(s), ...objectJobs(s)];
  const missing = [...new Set(jobs.flatMap((j) => j.inputs))].filter((p) => !source.exists(p));
  return { jobs, sharedInputs, missing };
}
