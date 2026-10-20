// stateHash: FNV-1a over the whole sim state. It walks the state generically (object keys
// in sorted order), so a new state field is hashed without touching this file. Two clients
// that agree on this every 100 ticks are in lockstep.

import type { SimState } from './state.ts';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

class Hasher {
  h = FNV_OFFSET;

  word(w: number): void {
    for (let i = 0; i < 4; i++) {
      this.h ^= (w >>> (i * 8)) & 0xff;
      this.h = Math.imul(this.h, FNV_PRIME) >>> 0;
    }
  }

  value(v: unknown, path: string): void {
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v)) throw new Error(`stateHash: non-integer ${v} at ${path}`);
      this.word(1);
      // Low and high 32 bits, so values past 2^32 still count
      this.word(v >>> 0);
      this.word(Math.floor(v / 0x100000000) >>> 0);
    } else if (typeof v === 'string') {
      this.word(2);
      this.word(v.length);
      for (let i = 0; i < v.length; i++) this.word(v.charCodeAt(i));
    } else if (typeof v === 'boolean') {
      this.word(v ? 3 : 4);
    } else if (Array.isArray(v)) {
      this.word(5);
      this.word(v.length);
      v.forEach((item, i) => this.value(item, `${path}[${i}]`));
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v).sort();
      this.word(6);
      this.word(keys.length);
      for (const key of keys) {
        this.value(key, path);
        this.value((v as Record<string, unknown>)[key], `${path}.${key}`);
      }
    } else {
      throw new Error(`stateHash: unsupported ${typeof v} at ${path}`);
    }
  }
}

export function stateHash(s: SimState): number {
  const h = new Hasher();
  h.value(s, 'state');
  return h.h;
}
