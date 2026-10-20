// Ported from OpenDiablo2 d2common/d2datautils/bitmuncher.go (commit 7f92c57).
// Reads little-endian bit streams that are not byte aligned, as used by DCC files.

export class BitMuncher {
  private readonly data: Uint8Array;
  private offset: number;
  private bitsRead = 0;

  constructor(data: Uint8Array, offset = 0) {
    this.data = data;
    this.offset = offset;
  }

  /** A new muncher at the same bit position with its read counter reset. */
  copy(): BitMuncher {
    return new BitMuncher(this.data, this.offset);
  }

  get bitOffset(): number {
    return this.offset;
  }

  get read(): number {
    return this.bitsRead;
  }

  getBit(): number {
    const byte = this.data[this.offset >> 3];
    if (byte === undefined) {
      throw new Error(`BitMuncher read past end of data at bit ${this.offset}`);
    }
    const result = (byte >> (this.offset & 7)) & 1;
    this.offset++;
    this.bitsRead++;
    return result;
  }

  skipBits(bits: number): void {
    this.offset += bits;
    this.bitsRead += bits;
  }

  getByte(): number {
    return this.getBits(8);
  }

  getInt32(): number {
    return this.getBits(32) | 0;
  }

  getUInt32(): number {
    return this.getBits(32);
  }

  /** Reads up to 32 bits, least significant first. Always returns a non-negative number. */
  getBits(bits: number): number {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      result += this.getBit() * 2 ** i;
    }
    return result;
  }

  getSignedBits(bits: number): number {
    return makeSigned(this.getBits(bits), bits);
  }
}

/**
 * Two's complement sign extension of an n-bit value. Same results as the Go loop,
 * including its rule that a 1-bit value of 1 means -1.
 */
export function makeSigned(value: number, bits: number): number {
  if (bits === 0) return 0;
  if (bits === 1) return -value;
  if (value < 2 ** (bits - 1)) return value;
  return value - 2 ** bits;
}
