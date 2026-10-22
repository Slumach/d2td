import { defineConfig } from 'vitest/config';

import { devGear } from './tools/devgear.ts';

export default defineConfig(({ command }) => ({
  // Decoded game art is served from the gitignored pipeline output by the dev server only.
  // A build never copies it into dist: the Electron app reads it from the player's own
  // extraction, and the installer must hold zero Blizzard bytes.
  publicDir: command === 'serve' ? 'assets-extracted' : false,
  // A tower's worn weapon and shield are composited on first sight (tools/devgear.ts)
  plugins: [devGear()],
  // Electron's Chromium and current browsers: top-level await loads the font before the game
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'electron/**/*.test.ts'],
  },
}));
