import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Decoded game art is served from the gitignored pipeline output, never from the repo.
  publicDir: 'assets-extracted',
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
