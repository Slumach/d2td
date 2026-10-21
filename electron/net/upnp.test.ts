import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import { findWanService, gatewayAt, isPrivateIp, mapPort, parseSsdpResponse } from './upnp.ts';

const SERVICE = 'urn:schemas-upnp-org:service:WANIPConnection:1';
const DESCRIPTION = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device><deviceList><device><deviceList><device>
    <serviceList>
      <service><serviceType>urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1</serviceType><controlURL>/common</controlURL></service>
      <service><serviceType>${SERVICE}</serviceType><controlURL>/ctl/IPConn</controlURL></service>
    </serviceList>
  </device></deviceList></device></deviceList></device>
</root>`;

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** A fake router: serves its description and answers SOAP like a real one. */
function fakeRouter(opts: { refuseForever?: boolean; externalIp?: string } = {}): Promise<{ location: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.method === 'GET') return res.end(DESCRIPTION);
      const action = /#(\w+)"/.exec(String(req.headers['soapaction']))![1]!;
      calls.push(`${action}${/<NewLeaseDuration>(\d+)/.exec(body)?.[1] ? ` lease=${/<NewLeaseDuration>(\d+)/.exec(body)![1]}` : ''}`);
      if (action === 'AddPortMapping' && opts.refuseForever && body.includes('<NewLeaseDuration>0<')) {
        res.statusCode = 500;
        return res.end('<errorDescription>OnlyPermanentLeasesSupported</errorDescription>');
      }
      if (action === 'GetExternalIPAddress') return res.end(`<u:GetExternalIPAddressResponse><NewExternalIPAddress>${opts.externalIp ?? '203.0.113.9'}</NewExternalIPAddress></u:GetExternalIPAddressResponse>`);
      res.end('<ok/>');
    });
  });
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port;
    resolve({ location: `http://127.0.0.1:${port}/rootDesc.xml`, calls });
  }));
}

describe('upnp', () => {
  it('reads the location from a gateway answer only', () => {
    expect(parseSsdpResponse('HTTP/1.1 200 OK\r\nST: x\r\nLOCATION: http://192.168.1.1:5000/rootDesc.xml\r\n\r\n')).toBe('http://192.168.1.1:5000/rootDesc.xml');
    expect(parseSsdpResponse('NOTIFY * HTTP/1.1\r\nLOCATION: http://x/\r\n\r\n')).toBeNull();
  });

  it('finds the WAN connection service and makes its control URL absolute', () => {
    expect(findWanService(DESCRIPTION, 'http://192.168.1.1:5000/rootDesc.xml')).toEqual({ controlUrl: 'http://192.168.1.1:5000/ctl/IPConn', serviceType: SERVICE });
  });

  it('forwards the port, learns the public address, and removes the mapping on close', async () => {
    const router = await fakeRouter();
    const gw = (await gatewayAt(router.location))!;
    expect(gw.localIp).toBe('127.0.0.1');
    const mapping = await mapPort(gw, 47310, 'D2 Tower Defense');
    expect(mapping.externalIp).toBe('203.0.113.9');
    expect(mapping.doubleNat).toBe(false);
    await mapping.close();
    expect(router.calls).toEqual(['AddPortMapping lease=0', 'GetExternalIPAddress', 'DeletePortMapping']);
  });

  it('retries with a timed lease, and spots a second NAT above the router', async () => {
    const router = await fakeRouter({ refuseForever: true, externalIp: '100.72.1.2' });
    const mapping = await mapPort((await gatewayAt(router.location))!, 47310, 'D2 Tower Defense');
    expect(router.calls.slice(0, 2)).toEqual(['AddPortMapping lease=0', 'AddPortMapping lease=3600']);
    expect(mapping.doubleNat).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });
});
