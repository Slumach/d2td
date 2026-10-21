// Asking the home router to forward the game port (UPnP IGD), so most hosts never touch
// their router settings. Find the router by SSDP, read its description for the WAN
// connection service, then AddPortMapping and GetExternalIPAddress over SOAP. Every step
// fails soft: no UPnP just means the host forwards the port by hand or uses Tailscale.

import { createSocket } from 'node:dgram';
import { request } from 'node:http';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2'];
const HTTP_TIMEOUT_MS = 4000;

export interface Gateway {
  controlUrl: string;
  serviceType: string;
  /** Our address on the router's network, for NewInternalClient. */
  localIp: string;
}

export interface PortMapping {
  /** The router's public address, or null if it would not say. */
  externalIp: string | null;
  /** True when the router's "public" address is itself private: a second NAT (CGNAT) sits above it. */
  doubleNat: boolean;
  close(): Promise<void>;
}

/** The LOCATION header of an SSDP response, if it is a gateway's. */
export function parseSsdpResponse(text: string): string | null {
  if (!/^HTTP\/1\.1 200/i.test(text)) return null;
  const match = /^location:\s*(\S+)/im.exec(text);
  return match ? match[1]! : null;
}

/** Router description URLs from SSDP, deduplicated. */
export function discover(timeoutMs = 2500): Promise<string[]> {
  return new Promise((resolve) => {
    const found = new Set<string>();
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => {
      try {
        socket.close();
      } catch {
        // Already closed
      }
      resolve([...found]);
    };
    socket.on('error', finish);
    socket.on('message', (msg) => {
      const location = parseSsdpResponse(msg.toString('utf8'));
      if (location) found.add(location);
    });
    socket.bind(0, () => {
      for (const st of SEARCH_TARGETS) {
        const search = `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`;
        socket.send(search, SSDP_PORT, SSDP_ADDRESS);
      }
      setTimeout(finish, timeoutMs);
    });
  });
}

function http(url: string, method: 'GET' | 'POST', body?: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: { ...headers, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, timeout: HTTP_TIMEOUT_MS }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`, 'i').exec(xml);
  return m ? m[1]! : null;
};

/** The WAN connection service in a router description, with its control URL made absolute. */
export function findWanService(xml: string, location: string): { controlUrl: string; serviceType: string } | null {
  const base = tag(xml, 'URLBase') || location;
  for (const block of xml.match(/<service>[\s\S]*?<\/service>/gi) ?? []) {
    const serviceType = tag(block, 'serviceType');
    const control = tag(block, 'controlURL');
    if (serviceType && control && /WAN(IP|PPP)Connection:\d/.test(serviceType)) {
      return { controlUrl: new URL(control, base).toString(), serviceType };
    }
  }
  return null;
}

/** Our IP address on the route to `host`. */
function localIpToward(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    socket.on('error', reject);
    socket.connect(SSDP_PORT, host, () => {
      const ip = socket.address().address;
      socket.close();
      resolve(ip);
    });
  });
}

export async function gatewayAt(location: string): Promise<Gateway | null> {
  const description = await http(location, 'GET');
  if (description.status !== 200) return null;
  const service = findWanService(description.text, location);
  if (!service) return null;
  return { ...service, localIp: await localIpToward(new URL(location).hostname) };
}

async function soap(gw: Gateway, action: string, args: Record<string, string | number>): Promise<string> {
  const params = Object.entries(args)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  const body =
    '<?xml version="1.0"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${gw.serviceType}">${params}</u:${action}></s:Body></s:Envelope>`;
  const res = await http(gw.controlUrl, 'POST', body, { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${gw.serviceType}#${action}"` });
  if (res.status !== 200) throw new Error(`${action} failed: HTTP ${res.status} ${tag(res.text, 'errorDescription') ?? ''}`.trim());
  return res.text;
}

export function isPrivateIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
}

/** Forwards TCP `port` on `gw` to this PC. Some routers refuse a lease of 0 (forever), so retry with an hour. */
export async function mapPort(gw: Gateway, port: number, description: string): Promise<PortMapping> {
  const args = (lease: number) => ({
    NewRemoteHost: '',
    NewExternalPort: port,
    NewProtocol: 'TCP',
    NewInternalPort: port,
    NewInternalClient: gw.localIp,
    NewEnabled: 1,
    NewPortMappingDescription: description,
    NewLeaseDuration: lease,
  });
  try {
    await soap(gw, 'AddPortMapping', args(0));
  } catch {
    await soap(gw, 'AddPortMapping', args(3600));
  }
  let externalIp: string | null = null;
  try {
    externalIp = tag(await soap(gw, 'GetExternalIPAddress', {}), 'NewExternalIPAddress');
  } catch {
    // The mapping still works; we just cannot show an internet code
  }
  return {
    externalIp: externalIp || null,
    doubleNat: externalIp !== null && isPrivateIp(externalIp),
    close: async () => {
      await soap(gw, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: 'TCP' }).catch(() => undefined);
    },
  };
}

/** Finds a router and forwards `port`, or null with the reason in `log`. */
export async function openPort(port: number, description: string, log: (line: string) => void): Promise<PortMapping | null> {
  const locations = await discover();
  if (locations.length === 0) {
    log('upnp: no router answered');
    return null;
  }
  for (const location of locations) {
    try {
      const gw = await gatewayAt(location);
      if (!gw) continue;
      const mapping = await mapPort(gw, port, description);
      log(`upnp: forwarded TCP ${port} to ${gw.localIp} via ${location}; public address ${mapping.externalIp ?? 'unknown'}${mapping.doubleNat ? ' (private: double NAT)' : ''}`);
      return mapping;
    } catch (e) {
      log(`upnp: ${location}: ${(e as Error).message}`);
    }
  }
  return null;
}
