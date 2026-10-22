// Dev server only: a worn look (a tower's weapon and shield) is composited from the local
// D2R install the first time the game asks for it, into assets-extracted/hero-gear, as the
// app does into its own assets folder (electron/main.ts). D2R_PATH overrides the install.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { Plugin } from 'vite';

import { heroGearFiles, heroGearPath, parseHeroGearPath } from './extract/sprites.ts';
import { CascSource, type CascStorage } from './extract/source.ts';

const OUT = 'assets-extracted';

export function devGear(): Plugin {
  let source: CascSource | undefined;
  return {
    name: 'd2td-dev-gear',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]!).replace(/^\/+/, '');
        const spec = parseHeroGearPath(path);
        if (!spec) return next();
        const file = join(OUT, path);
        try {
          if (!existsSync(file)) {
            const install = process.env['D2R_PATH'] ?? 'C:/Program Files (x86)/Diablo II Resurrected';
            const { Storage } = createRequire(import.meta.url)('@jamiephan/casclib') as { Storage: { open(p: string): CascStorage } };
            source ??= new CascSource(Storage.open(install), install);
            for (const f of heroGearFiles(source, spec)) {
              mkdirSync(dirname(join(OUT, f.path)), { recursive: true });
              writeFileSync(join(OUT, f.path), f.bytes);
            }
            server.config.logger.info(`gear: composited ${heroGearPath(spec)}`);
          }
          res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : 'application/json');
          res.end(readFileSync(file));
        } catch (e) {
          server.config.logger.warn(`gear: ${path}: ${(e as Error).message}`);
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}
