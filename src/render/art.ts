// What each skill looks like, from src/data/render/sprites.json. Shared by the extraction
// (which missiles and overlays to decode) and the renderer (which to load and when to play
// them). No Phaser here, so the Node pipeline can import it.

import sprites from '../data/render/sprites.json';

/** A skill's art, each a missiles.txt row except `overlay` (an overlay.txt row). See sprites.json. */
export interface SkillArt {
  fly?: string;
  impact?: string[];
  fall?: string;
  zone?: string;
  shards?: string;
  ring?: string;
  arc?: string;
  bolt?: string;
  corpse?: string;
  raise?: string;
  cast?: string;
  area?: string;
  overlay?: string;
  /** skills.txt castoverlay: the overlay.txt effect played on the caster as it casts. */
  castOverlay?: string;
  /** A missile thrown from the strike's spot to each monster within the skill's sub radius (Fist of the Heavens' holy bolts). */
  burst?: string;
}

export const SKILL_ART = sprites.skillArt as Record<string, SkillArt>;
/** The missile a ranged summon shoots, by its element. */
export const SUMMON_BOLTS = sprites.summonBolts as Record<string, string>;
export const STATUS_OVERLAYS = sprites.statusOverlays as { frozen: string; poison: string };
/** The extraction lists every missile it wrote here, explosions included. */
export const MISSILE_INDEX = 'missiles/index.json';

const ROLES = ['fly', 'fall', 'zone', 'shards', 'ring', 'arc', 'bolt', 'corpse', 'raise', 'cast', 'area', 'burst'] as const;

/** Every missiles.txt row a skill's art or a summon's shot names. */
export function artMissiles(): string[] {
  const ids: string[] = [];
  for (const art of Object.values(SKILL_ART)) {
    for (const role of ROLES) if (art[role]) ids.push(art[role]);
    ids.push(...(art.impact ?? []));
  }
  ids.push(...Object.values(SUMMON_BOLTS));
  return [...new Set(ids)];
}

/** Every overlay.txt row the art names: curses and Enchant on what they touch, and status looks. */
export function artOverlays(): string[] {
  const fromSkills = Object.values(SKILL_ART).flatMap((a) => [a.overlay, a.castOverlay].filter((o): o is string => o !== undefined));
  return [...new Set([...fromSkills, ...Object.values(STATUS_OVERLAYS)])];
}
