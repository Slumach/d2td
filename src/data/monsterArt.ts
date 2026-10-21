// Which monster atlases exist, from the Act 1 schedule (monsters.json). The extraction
// bakes them and the renderer loads them; both read this list so they never disagree.
//   wave monsters      normal, champion and unique palettes (they lead champion packs and uniques)
//   boss classes, packs normal only
//   superunique bosses their class's art in their own palette (superuniques.txt Utrans)

import monsters from './monsters.json';

export const WAVE_MONSTER_ART: readonly string[] = monsters.waves.map((w) => w.monster);

export const BOSS_ART: readonly string[] = [
  ...new Set(monsters.bosses.flatMap((b) => [b.class, ...('minion' in b && b.minion ? [b.minion] : [])])),
].filter((id) => !WAVE_MONSTER_ART.includes(id));

export interface SuperuniqueArt {
  /** The boss id; its atlas is monsters/<class>/su_<id>. */
  id: string;
  class: string;
  superunique: string;
}

export const SUPERUNIQUE_ART: readonly SuperuniqueArt[] = monsters.bosses.flatMap((b) =>
  'superunique' in b && b.superunique ? [{ id: b.id, class: b.class, superunique: b.superunique }] : [],
);

/** Every monstats id with art. */
export const MONSTER_ART: readonly string[] = [...WAVE_MONSTER_ART, ...BOSS_ART];
