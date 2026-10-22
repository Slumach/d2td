// Join codes: the host's IPv4 address and port as 12 characters a friend can read out or
// paste, like "4G8M-2KQ1-V7XP". Crockford base32 (no I, L, O, U), so a misread 0/O or 1/I/L
// still decodes, and a 10-bit check catches almost every typo before we try to connect.
// A relay code is 16 characters: the relay server's address and port and the host's room
// there, so a friend joining through the relay needs no setting of their own.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface HostAddress {
  ip: string;
  port: number;
}

/** A host reached through a relay server: the server's address, and the host's room on it. */
export interface RelayAddress extends HostAddress {
  room: number;
}

/** Room numbers fit 20 bits (server/relay.mjs MAX_ROOM). */
const ROOM_BITS = 20;

function check(bytes: number[]): number {
  let c = 0x155;
  for (const b of bytes) c = ((c * 31) ^ b) & 0x3ff;
  return c;
}

function addressBytes({ ip, port }: HostAddress): number[] {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) throw new Error(`Not an IPv4 address: ${ip}`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Not a port: ${port}`);
  return [...parts, port >> 8, port & 0xff];
}

/** `payload` bits, then 10 check bits over `bytes`, padded with zeros to whole characters, in groups of four. */
function encodeBits(payload: string, bytes: number[]): string {
  let bits = payload + check(bytes).toString(2).padStart(10, '0');
  bits += '0'.repeat((5 - (bits.length % 5)) % 5);
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{1,4}/g)!.join('-');
}

/** A code's bits, or null if it has a character outside the alphabet. Forgiving about case, dashes and look-alikes. */
function codeBits(code: string): string | null {
  const clean = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  let bits = '';
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  return bits;
}

export function encodeJoinCode(address: HostAddress): string {
  // 48 bits of address and port, then 10 check bits, then 2 zero bits: 60 bits, 12 characters
  const bytes = addressBytes(address);
  return encodeBits(bytes.map((b) => b.toString(2).padStart(8, '0')).join(''), bytes);
}

/** The address in a code, or null if it is not a valid code. Forgiving about case, dashes and look-alikes. */
export function decodeJoinCode(code: string): HostAddress | null {
  const bits = codeBits(code);
  if (!bits || bits.length !== 60) return null;
  const bytes = Array.from({ length: 6 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));
  if (parseInt(bits.slice(48, 58), 2) !== check(bytes) || bits.slice(58) !== '00') return null;
  const port = (bytes[4]! << 8) | bytes[5]!;
  if (port === 0) return null;
  return { ip: bytes.slice(0, 4).join('.'), port };
}

/** The relay server's address and port and the room, 16 characters. */
export function encodeRelayCode(address: RelayAddress): string {
  const { room } = address;
  if (!Number.isInteger(room) || room < 1 || room >= 1 << ROOM_BITS) throw new Error(`Not a room: ${room}`);
  // 48 bits of address and port, 20 of room, 10 check bits, 2 zero bits: 80 bits, 16 characters
  const bytes = [...addressBytes(address), room >> 16, (room >> 8) & 0xff, room & 0xff];
  return encodeBits(bytes.slice(0, 6).map((b) => b.toString(2).padStart(8, '0')).join('') + room.toString(2).padStart(ROOM_BITS, '0'), bytes);
}

/** The relay address and room in a 16-character code, or null. */
export function decodeRelayCode(code: string): RelayAddress | null {
  const bits = codeBits(code);
  if (!bits || bits.length !== 80) return null;
  const head = Array.from({ length: 6 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));
  const room = parseInt(bits.slice(48, 68), 2);
  const bytes = [...head, room >> 16, (room >> 8) & 0xff, room & 0xff];
  if (parseInt(bits.slice(68, 78), 2) !== check(bytes) || bits.slice(78) !== '00') return null;
  const port = (head[4]! << 8) | head[5]!;
  if (port === 0 || room === 0) return null;
  return { ip: head.slice(0, 4).join('.'), port, room };
}
