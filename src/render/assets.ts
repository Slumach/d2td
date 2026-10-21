// Loading the pipeline's sprite atlases and building their animations. Atlas JSON carries
// its own layout in meta: modes (frames, fps, directions), direction names and origin.

import Phaser from 'phaser';

import { NAMED_ART, SUPERUNIQUE_ART, WAVE_MONSTER_ART } from '../data/monsterArt.ts';
import sprites from '../data/render/sprites.json';
import { MISSILE_INDEX, artOverlays } from './art.ts';

export interface AtlasMeta {
  frameWidth: number;
  frameHeight: number;
  origin: { x: number; y: number };
  directions: string[];
  modes: Record<string, { frames: number; fps: number; directions: number }>;
  blend?: number;
  dccDirections?: number;
  /** Missiles: the missiles.txt ExplosionMissile that plays where it lands, when it has art. */
  explosion?: string;
}

export interface IconIndex {
  skills: Record<string, { id: number; icon: string; name: string; desc: string }>;
}

/** Each class's HD skill icons and their index, as the extraction writes them. */
const ICON_FOLDERS = ['paladin', 'sorceress', 'necromancer'];
const iconIndexKey = (folder: string) => `icons:${folder}`;

export const SUMMON_IDS = sprites.summons.ids;

/**
 * A monster's atlas: its monstats art (`base`) in its rank's palette, or a superunique's
 * own palette. Only wave monsters have champion and unique palettes.
 */
export function monsterKey(base: string, rank: string, artVariant?: string): string {
  if (artVariant) return `mon:${base}:${artVariant}`;
  const variant = WAVE_MONSTER_ART.includes(base) && (rank === 'champion' || rank === 'unique') ? rank : 'normal';
  return `mon:${base}:${variant}`;
}

interface HeroClass {
  attackMode: string;
  lines: Record<string, { weapon?: string; shield?: string }>;
}
const HEROES = sprites.heroes as Record<string, HeroClass>;
const HERO_LOOKS = [...sprites.heroTiers.map((_, i) => `t${i + 1}`), 'evolved'];

/** The mode a class's tower plays when it acts: A1 for the Paladin's swings, SC for casters. */
export function heroAttackMode(cls: string): string {
  return HEROES[cls]?.attackMode ?? 'A1';
}

/**
 * The look of a tower: its class, its line's weapon (sword, staff, wand, bare hands) and its
 * tier's armour and helm. A tower with no line yet stands in its class's unarmed look (its
 * first line if it has none) in the lightest armour.
 */
export function heroKey(tower: { cls: string; line: string; tier: number; evolved: string }): string {
  const cls = HEROES[tower.cls] ? tower.cls : 'paladin';
  const lines = HEROES[cls]!.lines;
  const unarmed = Object.keys(lines).find((l) => !lines[l]!.weapon) ?? Object.keys(lines)[0]!;
  const line = lines[tower.line] ? tower.line : unarmed;
  const look = tower.evolved ? 'evolved' : `t${Math.min(Math.max(tower.tier, 1), sprites.heroTiers.length)}`;
  return `hero:${cls}:${line}:${look}`;
}
export const missileKey = (id: string) => `mis:${id}`;
export const overlayKey = (id: string) => `ovl:${id}`;
export const iconKey = (skillName: string) => `icon:${skillName}`;

/**
 * Queues every atlas and the icon indexes; icons follow once their index arrives, and
 * missiles once the extraction's missile list does. Atlases are multi-page (trimmed frames
 * packed onto pages of at most 4096 px) and their page images sit beside the JSON.
 * Textures persist across scene restarts, so a second game (Play after Quit to menu)
 * queues only what is not loaded yet.
 */
export function preloadAssets(scene: Phaser.Scene): void {
  const atlas = (key: string, json: string, dir: string) => {
    if (!scene.textures.exists(key)) scene.load.multiatlas(key, json, dir);
  };
  for (const id of WAVE_MONSTER_ART) {
    for (const v of ['normal', 'champion', 'unique']) atlas(`mon:${id}:${v}`, `monsters/${id}/${v}.json`, `monsters/${id}/`);
  }
  for (const id of NAMED_ART) atlas(`mon:${id}:normal`, `monsters/${id}/normal.json`, `monsters/${id}/`);
  for (const su of SUPERUNIQUE_ART) atlas(`mon:${su.class}:su_${su.id}`, `monsters/${su.class}/su_${su.id}.json`, `monsters/${su.class}/`);
  for (const id of SUMMON_IDS) atlas(`mon:${id}:normal`, `monsters/${id}/normal.json`, `monsters/${id}/`);
  for (const [cls, h] of Object.entries(HEROES)) {
    for (const line of Object.keys(h.lines)) {
      for (const look of HERO_LOOKS) atlas(`hero:${cls}:${line}:${look}`, `hero/${cls}/${line}-${look}.json`, `hero/${cls}/`);
    }
  }
  for (const id of artOverlays()) atlas(overlayKey(id), `overlays/${id}.json`, 'overlays/');
  if (!scene.cache.json.exists(MISSILE_INDEX)) {
    scene.load.json(MISSILE_INDEX, MISSILE_INDEX);
    scene.load.once(`filecomplete-json-${MISSILE_INDEX}`, (_k: string, _t: string, index: { missiles: string[] }) => {
      for (const id of index.missiles) atlas(missileKey(id), `missiles/${id}.json`, 'missiles/');
    });
  }
  for (const folder of ICON_FOLDERS) {
    const key = iconIndexKey(folder);
    if (scene.cache.json.exists(key)) continue;
    scene.load.json(key, `icons/${folder}/index.json`);
    scene.load.once(`filecomplete-json-${key}`, (_k: string, _t: string, index: IconIndex) => {
      for (const [name, entry] of Object.entries(index.skills)) scene.load.image(iconKey(name), `icons/${folder}/${entry.icon}`);
    });
  }
}

/** Every class's icon index merged: skill names are unique across classes. */
export function iconIndex(scene: Phaser.Scene): IconIndex | undefined {
  const indexes = ICON_FOLDERS.map((f) => scene.cache.json.get(iconIndexKey(f)) as IconIndex | undefined).filter((i) => i !== undefined);
  if (indexes.length === 0) return undefined;
  return { skills: Object.assign({}, ...indexes.map((i) => i.skills)) };
}

export function metaOf(scene: Phaser.Scene, key: string): AtlasMeta {
  return (scene.textures.get(key).customData as { meta: AtlasMeta }).meta;
}

export const animKey = (texture: string, mode: string, dir: string) => `${texture}|${mode}|${dir}`;

/** Modes that play once: death, attacks and casts, and a summon rising (S1). */
const ONCE = new Set(['DT', 'A1', 'SC', 'S1']);

/**
 * Animations for every mode and direction of every loaded atlas. Death, attacks, casts and
 * rising play once; walking, standing, flying missiles and overlays loop. One-shot effects
 * override repeat.
 */
export function createAnimations(scene: Phaser.Scene): void {
  for (const key of scene.textures.getTextureKeys()) {
    if (!/^(mon|hero|mis|ovl):/.test(key)) continue;
    const meta = metaOf(scene, key);
    for (const [mode, info] of Object.entries(meta.modes)) {
      for (let d = 0; d < info.directions; d++) {
        const dir = meta.directions[d] ?? String(d);
        if (scene.anims.exists(animKey(key, mode, dir))) continue;
        scene.anims.create({
          key: animKey(key, mode, dir),
          frames: Array.from({ length: info.frames }, (_, f) => ({ key, frame: `${mode}_${dir}_${String(f).padStart(2, '0')}` })),
          frameRate: info.fps,
          repeat: ONCE.has(mode) ? 0 : -1,
        });
      }
    }
  }
}

/** Origin of an atlas as Phaser's normalised origin. */
export function originOf(meta: AtlasMeta): [number, number] {
  return [meta.origin.x / meta.frameWidth, meta.origin.y / meta.frameHeight];
}
