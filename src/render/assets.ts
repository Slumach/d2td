// Loading the pipeline's sprite atlases and building their animations. Atlas JSON carries
// its own layout in meta: modes (frames, fps, directions), direction names and origin.

import Phaser from 'phaser';

import monstersJson from '../data/monsters.json';
import sprites from '../data/render/sprites.json';

export interface AtlasMeta {
  frameWidth: number;
  frameHeight: number;
  origin: { x: number; y: number };
  directions: string[];
  modes: Record<string, { frames: number; fps: number; directions: number }>;
  blend?: number;
  dccDirections?: number;
}

export const ICON_INDEX = 'icons:paladin';
const ICON_DIR = 'icons/paladin/';

export interface IconIndex {
  skills: Record<string, { id: number; icon: string; name: string; desc: string }>;
}

export const BOSSES = new Set(Object.values(monstersJson.bosses));
export const MONSTER_IDS = [...new Set([...Object.keys(monstersJson.roster), ...BOSSES])];
export const MISSILE_IDS = [...new Set(Object.values(sprites.missiles).flat())];
export const MISSILES_FOR = sprites.missiles as Record<string, string[]>;

export function monsterKey(id: string, rank: string): string {
  const variant = BOSSES.has(id) || rank === 'normal' || rank === 'boss' ? 'normal' : rank;
  return `mon:${id}:${variant}`;
}

export const heroKey = (evolved: boolean) => `hero:${evolved ? 'evolved' : 'normal'}`;
export const missileKey = (id: string) => `mis:${id}`;
export const iconKey = (skillName: string) => `icon:${skillName}`;

/**
 * Queues every atlas and the icon index; icons follow once the index arrives. Atlases are
 * multi-page (trimmed frames packed onto pages of at most 4096 px) and their page images
 * sit beside the JSON. Textures persist across scene restarts, so a second game (Play
 * after Quit to menu) queues only what is not loaded yet.
 */
export function preloadAssets(scene: Phaser.Scene): void {
  const atlas = (key: string, json: string, dir: string) => {
    if (!scene.textures.exists(key)) scene.load.multiatlas(key, json, dir);
  };
  for (const id of MONSTER_IDS) {
    const variants = BOSSES.has(id) ? ['normal'] : ['normal', 'champion', 'unique'];
    for (const v of variants) atlas(`mon:${id}:${v}`, `monsters/${id}/${v}.json`, `monsters/${id}/`);
  }
  for (const v of ['normal', 'evolved']) atlas(`hero:${v}`, `hero/paladin/${v}.json`, 'hero/paladin/');
  for (const id of MISSILE_IDS) atlas(missileKey(id), `missiles/${id}.json`, 'missiles/');
  if (scene.cache.json.exists(ICON_INDEX)) return;
  scene.load.json(ICON_INDEX, `${ICON_DIR}index.json`);
  scene.load.once(`filecomplete-json-${ICON_INDEX}`, (_k: string, _t: string, index: IconIndex) => {
    for (const [name, entry] of Object.entries(index.skills)) scene.load.image(iconKey(name), `${ICON_DIR}${entry.icon}`);
  });
}

export function metaOf(scene: Phaser.Scene, key: string): AtlasMeta {
  return (scene.textures.get(key).customData as { meta: AtlasMeta }).meta;
}

export const animKey = (texture: string, mode: string, dir: string) => `${texture}|${mode}|${dir}`;

/**
 * Animations for every mode and direction of every loaded atlas. Death and attacks play
 * once; walking, standing and flying missiles loop. One-shot effects override repeat.
 */
export function createAnimations(scene: Phaser.Scene): void {
  for (const key of scene.textures.getTextureKeys()) {
    if (!/^(mon|hero|mis):/.test(key)) continue;
    const meta = metaOf(scene, key);
    for (const [mode, info] of Object.entries(meta.modes)) {
      for (let d = 0; d < info.directions; d++) {
        const dir = meta.directions[d] ?? String(d);
        if (scene.anims.exists(animKey(key, mode, dir))) continue;
        scene.anims.create({
          key: animKey(key, mode, dir),
          frames: Array.from({ length: info.frames }, (_, f) => ({ key, frame: `${mode}_${dir}_${String(f).padStart(2, '0')}` })),
          frameRate: info.fps,
          repeat: mode === 'DT' || mode === 'A1' ? 0 : -1,
        });
      }
    }
  }
}

/** Origin of an atlas as Phaser's normalised origin. */
export function originOf(meta: AtlasMeta): [number, number] {
  return [meta.origin.x / meta.frameWidth, meta.origin.y / meta.frameHeight];
}
