import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SIM_DIR = join('src', 'sim');
const sources = readdirSync(SIM_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ file: f, text: readFileSync(join(SIM_DIR, f), 'utf8') }));

describe('src/sim stays pure and deterministic', () => {
  it.each(sources)('$file has no Phaser, Math.random, Date or performance', ({ text }) => {
    expect(text).not.toMatch(/from ['"]phaser['"]/);
    expect(text).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now/);
  });
});
