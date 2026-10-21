// Builds the Electron main and preload scripts (Node side) to dist-electron as CommonJS.
// Electron and the native CascLib binding stay external; everything else is bundled,
// including the pipeline code from tools/ and its JSON imports.

import { builtinModules } from 'node:module';

import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    ssr: true,
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
      external: ['electron', '@jamiephan/casclib', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: 'cjs', entryFileNames: '[name].cjs' },
    },
  },
  ssr: { noExternal: true, external: ['@jamiephan/casclib'] },
});
