// Which monster atlases exist, from the schedule (monsters.json). The extraction bakes them
// and the renderer loads them; both read this list so they never disagree.
//   wave monsters           normal, champion and unique palettes (they lead champion packs)
//   named classes, packs    normal only: superunique and act boss classes, and their minions
//   superuniques            their class's art in their own palette (superuniques.txt Utrans)
// Each monster is drawn in the palette of the act it first walks in (ART_ACT).

import monsters from './monsters.json';

interface WaveRef {
  monster?: string;
  boss?: string;
  superunique?: string | string[];
}

const campaign = monsters.campaign as Record<string, Record<string, WaveRef[]>>;
/** A raiser's party walks with it (monsters.json roster party). */
const partyOf = new Map(Object.entries(monsters.roster as Record<string, { party?: string }>).flatMap(([id, r]) => (r.party ? [[id, r.party] as const] : [])));
const named = [...monsters.superuniques, ...monsters.bosses] as { id: string; class: string; minion?: string; superunique?: string }[];
const namedById = new Map(named.map((b) => [b.id, b]));

export const WAVE_MONSTER_ART: readonly string[] = [
  ...new Set([
    ...Object.values(campaign).flatMap((byDifficulty) => Object.values(byDifficulty).flatMap((ws) => ws.flatMap((w) => (w.monster ? [w.monster] : [])))),
    ...monsters.placeholder.map((p) => p.monster),
  ]),
];

export const NAMED_ART: readonly string[] = [...new Set([...named.flatMap((b) => [b.class, ...(b.minion ? [b.minion] : [])]), ...partyOf.values()])].filter((id) => !WAVE_MONSTER_ART.includes(id));

/** The act whose palette each monster's art uses: the first act it walks in, Act 1 otherwise. */
export const ART_ACT: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = {};
  const mark = (id: string | undefined, act: number) => {
    if (id && out[id] === undefined) out[id] = act;
  };
  for (const act of Object.keys(campaign).map(Number).sort((a, b) => a - b)) {
    for (const ws of Object.values(campaign[String(act)]!)) {
      for (const w of ws) {
        mark(w.monster, act);
        mark(w.monster ? partyOf.get(w.monster) : undefined, act);
        for (const id of [w.boss, ...[w.superunique ?? []].flat()]) {
          const b = id ? namedById.get(id) : undefined;
          mark(b?.class, act);
          mark(b?.minion, act);
        }
      }
    }
  }
  return out;
})();

export interface SuperuniqueArt {
  /** The superunique's id; its atlas is monsters/<class>/su_<id>. */
  id: string;
  class: string;
  superunique: string;
}

export const SUPERUNIQUE_ART: readonly SuperuniqueArt[] = named
  .filter((b): b is typeof b & { superunique: string } => b.superunique !== undefined)
  .map((b) => ({ id: b.id, class: b.class, superunique: b.superunique }));

/** Every monstats id with art. */
export const MONSTER_ART: readonly string[] = [...WAVE_MONSTER_ART, ...NAMED_ART];
