// Ported from OpenDiablo2 (commit 7f92c57):
//   d2common/d2fileformats/d2animdata/animdata.go (Load)
//   d2common/d2fileformats/d2animdata/record.go (FPS, FrameDurationMS)
// The hash table and block bookkeeping are dropped; records are keyed by name only.
// The Go code rejects blocks with more than 67 records, the classic limit. D2R's file
// exceeds it, so that check is gone; the exact end-of-file check still catches misreads.

const NUM_BLOCKS = 256;
const BYTE_COUNT_NAME = 8;
const BYTE_COUNT_SPEED_PADDING = 2;
const NUM_EVENTS = 144;
const SPEED_DIVISOR = 256;
const SPEED_BASE_FPS = 25;

export interface AnimDataRecord {
  name: string;
  framesPerDirection: number;
  /** Animation rate; 256 means the base 25 frames per second. */
  speed: number;
  /** Frame index to event code (1 attack, 2 missile, 3 sound, 4 skill). */
  events: Record<number, number>;
}

/** Records by upper-case name. Some names have several records; the game uses the first. */
export type AnimData = Map<string, AnimDataRecord[]>;

export function decodeAnimData(data: Uint8Array): AnimData {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entries: AnimData = new Map();
  let pos = 0;

  for (let blockIdx = 0; blockIdx < NUM_BLOCKS; blockIdx++) {
    const recordCount = view.getUint32(pos, true);
    pos += 4;

    for (let recordIdx = 0; recordIdx < recordCount; recordIdx++) {
      const nameBytes = data.subarray(pos, pos + BYTE_COUNT_NAME);
      pos += BYTE_COUNT_NAME;
      if (nameBytes[BYTE_COUNT_NAME - 1] !== 0) {
        throw new Error('animdata record name missing null terminator byte');
      }
      const name = String.fromCharCode(...nameBytes.filter((c) => c !== 0));

      const framesPerDirection = view.getUint32(pos, true);
      pos += 4;
      const speed = view.getUint16(pos, true);
      pos += 2 + BYTE_COUNT_SPEED_PADDING;

      const events: Record<number, number> = {};
      for (let eventIdx = 0; eventIdx < NUM_EVENTS; eventIdx++) {
        const event = data[pos++]!;
        if (event !== 0) events[eventIdx] = event;
      }

      const key = name.toUpperCase();
      const list = entries.get(key) ?? [];
      list.push({ name, framesPerDirection, speed, events });
      entries.set(key, list);
    }
  }

  if (pos !== data.length) {
    throw new Error(`unable to parse animation data: ${pos} != ${data.length}`);
  }

  return entries;
}

export function animFps(record: AnimDataRecord): number {
  return (SPEED_BASE_FPS * record.speed) / SPEED_DIVISOR;
}

export function frameDurationMs(record: AnimDataRecord): number {
  return 1000 / animFps(record);
}
