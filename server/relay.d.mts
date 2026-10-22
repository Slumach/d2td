// Types for relay.mjs, which stays plain JavaScript so it runs on any Node with no build.

export declare const RELAY_VERSION: number;
export declare const RELAY_PORT: number;
export declare const MAX_ROOM: number;

export declare function startRelayServer(opts?: {
  port?: number;
  host?: string;
  log?: (line: string) => void;
  pairTimeoutMs?: number;
}): Promise<{ port: number; rooms: () => number; close: () => void }>;
