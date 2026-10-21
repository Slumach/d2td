import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  // Decoded game art is served from the gitignored pipeline output by the dev server only.
  // A build never copies it into dist: the Electron app reads it from the player's own
  // extraction, and the installer must hold zero Blizzard bytes.
  publicDir: command === 'serve' ? 'assets-extracted' : false,
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
}));
