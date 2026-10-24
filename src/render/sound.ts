// Act 1 sounds from the extraction's manifest (sfx/sounds.json): casts, the hammer's whirl,
// impacts, monster deaths, the gold chime, and the Wilderness music and ambience. A sound
// that played a moment ago is not stacked again, so ten towers do not make a wall of noise.

import type Phaser from 'phaser';

export const SOUND_MANIFEST = 'sfx:manifest';

export interface SoundManifest {
  music: string | null;
  ambience: string | null;
  gold: string[];
  cast: Record<string, string[]>;
  travel: Record<string, string[]>;
  hit: Record<string, string[]>;
  death: Record<string, string[]>;
  /** Item drop and use sounds by name; absent in extractions from before items. */
  items?: Record<string, string[]>;
  /** The cow level's portal sound and music; absent before the cow level. */
  cow?: { portal: string[]; music: string | null };
  /** Battle Mode's sounds; absent before the extraction that adds them. */
  battle?: { send: string[]; kingHit: string[]; tyrael: string[]; victory: string[] };
  /** Menu sounds; absent in extractions from before the D2 menu. */
  ui?: { click: string[]; hover: string[]; music: string | null };
  volumePct: { music: number; ambience: number; sfx: number };
}

/** The same sound waits at least this long before playing again. */
const REPEAT_MS = 90;

export function preloadSounds(scene: Phaser.Scene): void {
  // The menus may have read the manifest already (for their own sounds); queue whatever is missing
  const queue = (m: SoundManifest) => {
    const all = new Set<string>([...m.gold, ...[m.cast, m.travel, m.hit, m.death, m.items ?? {}].flatMap((g) => Object.values(g).flat())]);
    if (m.music) all.add(m.music);
    for (const p of m.cow?.portal ?? []) all.add(p);
    for (const p of Object.values(m.battle ?? {}).flat()) all.add(p);
    if (m.cow?.music) all.add(m.cow.music);
    if (m.ambience) all.add(m.ambience);
    for (const path of all) if (!scene.cache.audio.exists(path)) scene.load.audio(path, path);
  };
  const cached = scene.cache.json.get(SOUND_MANIFEST) as SoundManifest | undefined;
  if (cached) return queue(cached);
  scene.load.json(SOUND_MANIFEST, 'sfx/sounds.json');
  scene.load.once(`filecomplete-json-${SOUND_MANIFEST}`, (_k: string, _t: string, m: SoundManifest) => queue(m));
}

export class SoundBank {
  private readonly manifest: SoundManifest | undefined;
  private readonly last = new Map<string, number>();
  private n = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.manifest = scene.cache.json.get(SOUND_MANIFEST) as SoundManifest | undefined;
  }

  private music: Phaser.Sound.BaseSound | undefined;
  private cowSong: Phaser.Sound.BaseSound | undefined;

  /** Starts the level's music and ambience; they stop with the scene. */
  startLoops(): void {
    const m = this.manifest;
    if (!m) return;
    for (const [path, pct, isMusic] of [[m.music, m.volumePct.music, true], [m.ambience, m.volumePct.ambience, false]] as const) {
      if (!path || !this.scene.cache.audio.exists(path)) continue;
      const loop = this.scene.sound.add(path, { loop: true, volume: pct / 100 });
      loop.play();
      if (isMusic) this.music = loop;
      this.scene.events.once('shutdown', () => loop.destroy());
    }
  }

  /** The cow portal opens (its sound, and Moo Moo Farm's song over the act's), or closes. */
  cowLevel(open: boolean): void {
    const m = this.manifest;
    if (!m) return;
    if (open) {
      this.play(m.cow?.portal, 100);
      const song = m.cow?.music;
      if (song && this.scene.cache.audio.exists(song) && !this.cowSong) {
        this.music?.pause();
        this.cowSong = this.scene.sound.add(song, { loop: true, volume: m.volumePct.music / 100 });
        this.cowSong.play();
        this.scene.events.once('shutdown', () => this.cowSong?.destroy());
      }
    } else if (this.cowSong) {
      this.cowSong.destroy();
      this.cowSong = undefined;
      this.music?.resume();
    }
  }

  private play(files: string[] | undefined, pct = 100): void {
    if (!this.manifest || !files || files.length === 0) return;
    // Variants take turns, as D2 rotates through death1, death2...
    const path = files[this.n++ % files.length]!;
    if (!this.scene.cache.audio.exists(path)) return;
    const now = this.scene.time.now;
    if (now - (this.last.get(path) ?? -Infinity) < REPEAT_MS) return;
    this.last.set(path, now);
    this.scene.sound.play(path, { volume: (this.manifest.volumePct.sfx * pct) / 10000 });
  }

  cast(skill: string): void {
    this.play(this.manifest?.cast[skill], 60);
  }

  travel(missile: string): void {
    this.play(this.manifest?.travel[missile], 50);
  }

  hit(missile: string): void {
    this.play(this.manifest?.hit[missile], 55);
  }

  death(monster: string): void {
    this.play(this.manifest?.death[monster]);
  }

  gold(): void {
    this.play(this.manifest?.gold, 45);
  }

  /** Battle Mode's moments: a send made, a leak at the Worldstone, Tyrael's strike, a won match. */
  battle(moment: 'send' | 'kingHit' | 'tyrael' | 'victory'): void {
    this.play(this.manifest?.battle?.[moment], moment === 'tyrael' ? 45 : 80);
  }

  /** An item sound by its table name (an item landing, or going into the inventory). */
  item(name: string | undefined): void {
    if (name) this.play(this.manifest?.items?.[name], 70);
  }
}
