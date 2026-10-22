import { describe, expect, it } from 'vitest';

import { decodeJoinCode, decodeRelayCode, encodeJoinCode, encodeRelayCode } from './codes.ts';

describe('join codes', () => {
  it('round-trips an address and port', () => {
    for (const addr of [
      { ip: '203.0.113.7', port: 47310 },
      { ip: '192.168.1.20', port: 47310 },
      { ip: '100.101.102.103', port: 1 },
      { ip: '255.255.255.255', port: 65535 },
    ]) {
      const code = encodeJoinCode(addr);
      expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(decodeJoinCode(code)).toEqual(addr);
    }
  });

  it('forgives case, spacing and look-alike letters', () => {
    const code = encodeJoinCode({ ip: '10.0.0.1', port: 47310 });
    const messy = ` ${code.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l')} `;
    expect(decodeJoinCode(messy)).toEqual({ ip: '10.0.0.1', port: 47310 });
  });

  it('rejects a typo instead of connecting somewhere else', () => {
    const code = encodeJoinCode({ ip: '192.168.1.20', port: 47310 }).replace(/-/g, '');
    let caught = 0;
    for (let i = 0; i < code.length; i++) {
      for (const swap of '0123456789ABCDEFGHJKMNPQRSTVWXYZ') {
        if (swap === code[i]) continue;
        if (decodeJoinCode(code.slice(0, i) + swap + code.slice(i + 1)) === null) caught++;
      }
    }
    // Every single-character change is caught
    expect(caught).toBe(code.length * 31);
    expect(decodeJoinCode('ABCD')).toBeNull();
    expect(decodeJoinCode('UUUU-UUUU-UUUU')).toBeNull();
  });
});

describe('relay codes', () => {
  it('round-trip the relay address, port and room in 16 characters', () => {
    for (const addr of [
      { ip: '3.98.12.200', port: 47311, room: 1 },
      { ip: '54.1.2.3', port: 47311, room: 0xfffff },
      { ip: '203.0.113.7', port: 65535, room: 123456 },
    ]) {
      const code = encodeRelayCode(addr);
      expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(decodeRelayCode(code)).toEqual(addr);
      expect(decodeJoinCode(code)).toBeNull();
    }
  });

  it('are not mistaken for direct codes, and catch a typo', () => {
    const direct = encodeJoinCode({ ip: '10.0.0.1', port: 47310 });
    expect(decodeRelayCode(direct)).toBeNull();
    const code = encodeRelayCode({ ip: '3.98.12.200', port: 47311, room: 4242 });
    const typo = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
    expect(decodeRelayCode(typo)).toBeNull();
  });
});
