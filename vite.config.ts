import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  // Decoded game art is served from the gitignored pipeline output by the dev server only.
  // A build never copies it into dist: the Electron app reads it from the player's own
  // extraction, and the installer must hold zero Blizzard bytes.
  publicDir: command === 'serve' ? 'assets-extracted' : false,
  // Electron's Chromium and current browsers: top-level await loads the font before the game
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'electron/**/*.test.ts'],
  },
}));
