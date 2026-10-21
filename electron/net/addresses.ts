// This PC's IPv4 addresses that a friend could reach: the home network ones, and a
// Tailscale one (100.64.0.0/10) when Tailscale is running.

import { networkInterfaces } from 'node:os';

export interface LocalAddress {
  ip: string;
  kind: 'lan' | 'tailscale';
}

export function isTailscale(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 100 && b >= 64 && b <= 127;
}

export function localAddresses(): LocalAddress[] {
  const out: LocalAddress[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      // Link-local 169.254 addresses mean an adapter with no network
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ ip: a.address, kind: isTailscale(a.address) ? 'tailscale' : 'lan' });
    }
  }
  return out;
}
