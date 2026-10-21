// Which monster atlases exist, from the schedule (monsters.json). The extraction bakes them
// and the renderer loads them; both read this list so they never disagree.
//   wave monsters           normal, champion and unique palettes (they lead champion packs)
//   named classes, packs    normal only: superunique and act boss classes, and their minions
//   superuniques            their class's art in their own palette (superuniques.txt Utrans)

import monsters from './monsters.json';

export const WAVE_MONSTER_ART: readonly string[] = monsters.waves.flatMap((w) => ('monster' in w && w.monster ? [w.monster] : []));

const named = [...monsters.superuniques, ...monsters.bosses];

export const NAMED_ART: readonly string[] = [
  ...new Set(named.flatMap((b) => [b.class, ...('minion' in b && b.minion ? [b.minion] : [])])),
].filter((id) => !WAVE_MONSTER_ART.includes(id));

export interface SuperuniqueArt {
  /** The superunique's id; its atlas is monsters/<class>/su_<id>. */
  id: string;
  class: string;
  superunique: string;
}

export const SUPERUNIQUE_ART: readonly SuperuniqueArt[] = monsters.superuniques.map((b) => ({ id: b.id, class: b.class, superunique: b.superunique }));

/** Every monstats id with art. */
export const MONSTER_ART: readonly string[] = [...WAVE_MONSTER_ART, ...NAMED_ART];
