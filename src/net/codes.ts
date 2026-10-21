// Join codes: the host's IPv4 address and port as 12 characters a friend can read out or
// paste, like "4G8M-2KQ1-V7XP". Crockford base32 (no I, L, O, U), so a misread 0/O or 1/I/L
// still decodes, and a 10-bit check catches almost every typo before we try to connect.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface HostAddress {
  ip: string;
  port: number;
}

function check(bytes: number[]): number {
  let c = 0x155;
  for (const b of bytes) c = ((c * 31) ^ b) & 0x3ff;
  return c;
}

export function encodeJoinCode({ ip, port }: HostAddress): string {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) throw new Error(`Not an IPv4 address: ${ip}`);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Not a port: ${port}`);
  const bytes = [...parts, port >> 8, port & 0xff];
  // 48 bits of address and port, then 10 check bits, then 2 zero bits: 60 bits, 12 characters
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  bits += check(bytes).toString(2).padStart(10, '0') + '00';
  let out = '';
  for (let i = 0; i < 60; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

/** The address in a code, or null if it is not a valid code. Forgiving about case, dashes and look-alikes. */
export function decodeJoinCode(code: string): HostAddress | null {
  const clean = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (clean.length !== 12) return null;
  let bits = '';
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = Array.from({ length: 6 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));
  if (parseInt(bits.slice(48, 58), 2) !== check(bytes) || bits.slice(58) !== '00') return null;
  const port = (bytes[4]! << 8) | bytes[5]!;
  if (port === 0) return null;
  return { ip: bytes.slice(0, 4).join('.'), port };
}
