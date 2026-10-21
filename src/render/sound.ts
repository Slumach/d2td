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
  volumePct: { music: number; ambience: number; sfx: number };
}

/** The same sound waits at least this long before playing again. */
const REPEAT_MS = 90;

export function preloadSounds(scene: Phaser.Scene): void {
  if (scene.cache.json.exists(SOUND_MANIFEST)) return;
  scene.load.json(SOUND_MANIFEST, 'sfx/sounds.json');
  scene.load.once(`filecomplete-json-${SOUND_MANIFEST}`, (_k: string, _t: string, m: SoundManifest) => {
    const all = new Set<string>([...m.gold, ...[m.cast, m.travel, m.hit, m.death].flatMap((g) => Object.values(g).flat())]);
    if (m.music) all.add(m.music);
    if (m.ambience) all.add(m.ambience);
    for (const path of all) if (!scene.cache.audio.exists(path)) scene.load.audio(path, path);
  });
}

export class SoundBank {
  private readonly manifest: SoundManifest | undefined;
  private readonly last = new Map<string, number>();
  private n = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.manifest = scene.cache.json.get(SOUND_MANIFEST) as SoundManifest | undefined;
  }

  /** Starts the level's music and ambience; they stop with the scene. */
  startLoops(): void {
    const m = this.manifest;
    if (!m) return;
    for (const [path, pct] of [[m.music, m.volumePct.music], [m.ambience, m.volumePct.ambience]] as const) {
      if (!path || !this.scene.cache.audio.exists(path)) continue;
      const loop = this.scene.sound.add(path, { loop: true, volume: pct / 100 });
      loop.play();
      this.scene.events.once('shutdown', () => loop.destroy());
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
}
