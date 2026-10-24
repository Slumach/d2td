// The host's relay: a TCP server inside the host's app. It keeps the lobby, then stamps
// every player's commands with a tick and sends one bundle per tick to everyone, and
// compares the match hashes players report. It never runs the game itself. No Electron
// import, so it runs and is tested in plain Node.

import { randomInt } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';

import { battleOptions, DEFAULT_OPTIONS, type BattleOptions } from '../../src/sim/battle.ts';
import { battleSetupFor, MAX_BATTLE_TEAM, MAX_LOBBY, MAX_PLAYERS, MAX_TEAM_PLAYERS, type BattleSetup, type MatchMode, type PlayerCommand } from '../../src/sim/match.ts';
import { PROTOCOL, TICK_MS, type ClientMessage, type HostMessage, type LobbyPlayer } from '../../src/net/protocol.ts';
import { validCommand } from '../../src/net/validate.ts';
import { readLines, sendLine } from './framing.ts';

export interface RelayOptions {
  /** 0 picks a free port (tests). */
  port: number;
  /** The host's game proves it is the host with this. */
  token: string;
  /** App version; players on another version cannot join. */
  version: string;
  /** Milliseconds per tick; 0 runs ticks as fast as possible (tests). */
  tickMs?: number;
  /** Seeds the match. */
  seed?: () => number;
  log?: (line: string) => void;
}

interface Peer {
  socket: Socket;
  name: string;
  host: boolean;
  data: string;
  slot: number;
  /** Set once the peer has said hello and been let in. */
  joined: boolean;
  gone: boolean;
  /** Eternal Conflict: the race they picked and the team they asked for. */
  race: string;
  team: number;
}

const BATTLE_MODES: readonly MatchMode[] = ['battle', 'coop'];

const HELLO_TIMEOUT_MS = 5000;

export class Relay {
  private readonly server: Server;
  private readonly opts: RelayOptions;
  private peers: Peer[] = [];
  private mode: MatchMode = 'team';
  /** Eternal Conflict: players a team and the game setup, set by the host. */
  private teamSize = 1;
  private options: BattleOptions = DEFAULT_OPTIONS;
  private started = false;
  private tick = 0;
  private queue: PlayerCommand[] = [];
  private readonly hashes = new Map<number, Map<number, number>>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private readonly log: (line: string) => void;

  constructor(opts: RelayOptions) {
    this.opts = opts;
    this.log = opts.log ?? (() => undefined);
    this.server = createServer((socket) => this.accept(socket));
  }

  /** Starts listening on every interface; resolves to the port. */
  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.opts.port, () => {
        const address = this.server.address();
        resolve(typeof address === 'object' && address ? address.port : this.opts.port);
      });
    });
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const p of this.peers) p.socket.destroy();
    this.server.close();
  }

  private get joined(): Peer[] {
    return this.peers.filter((p) => p.joined && !p.gone);
  }

  private broadcast(message: HostMessage): void {
    for (const p of this.joined) sendLine(p.socket, message);
  }

  private lobbyPlayers(): LobbyPlayer[] {
    return this.joined.map((p) => ({ slot: p.slot, name: p.name, ...(BATTLE_MODES.includes(this.mode) ? { race: p.race, team: p.team } : {}) }));
  }

  private sendLobby(): void {
    this.broadcast({ t: 'lobby', players: this.lobbyPlayers(), mode: this.mode, ...(BATTLE_MODES.includes(this.mode) ? { teamSize: this.teamSize, options: this.options } : {}) });
  }

  private reject(socket: Socket, reason: string): void {
    sendLine(socket, { t: 'reject', reason } satisfies HostMessage);
    socket.end();
  }

  private accept(socket: Socket): void {
    socket.setNoDelay(true);
    const peer: Peer = { socket, name: '', host: false, data: '', slot: -1, joined: false, gone: false, race: 'random', team: 0 };
    this.peers.push(peer);
    const helloTimer = setTimeout(() => !peer.joined && socket.destroy(), HELLO_TIMEOUT_MS);
    readLines(socket, (m) => this.onMessage(peer, m as ClientMessage));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      clearTimeout(helloTimer);
      this.onClose(peer);
    });
  }

  private onMessage(peer: Peer, m: ClientMessage): void {
    if (!m || typeof m !== 'object') return;
    if (!peer.joined) {
      if (m.t === 'hello') this.hello(peer, m);
      else peer.socket.destroy();
      return;
    }
    if (m.t === 'mode' && peer.host && !this.started && (m.mode === 'team' || m.mode === 'ffa' || BATTLE_MODES.includes(m.mode))) {
      this.mode = m.mode;
      this.sendLobby();
    } else if (m.t === 'battle' && !this.started) {
      // The host sizes the teams; everyone picks their own race and team
      if (peer.host && Number.isInteger(m.teamSize) && m.teamSize! >= 1 && m.teamSize! <= MAX_BATTLE_TEAM) this.teamSize = m.teamSize!;
      if (peer.host && m.options !== undefined) this.options = battleOptions(m.options);
      if (typeof m.race === 'string' && /^[a-z]{1,20}$/.test(m.race)) peer.race = m.race;
      if (m.team === 0 || m.team === 1) peer.team = m.team;
      this.sendLobby();
    } else if (m.t === 'start' && peer.host && !this.started) {
      // A team shares one ring, an arc each
      if (this.mode === 'team' && this.joined.length > MAX_TEAM_PLAYERS) return this.log(`relay: a team takes up to ${MAX_TEAM_PLAYERS} players`);
      if (this.mode === 'ffa' && this.joined.length > MAX_PLAYERS) return this.log(`relay: free for all takes up to ${MAX_PLAYERS} players`);
      if (BATTLE_MODES.includes(this.mode)) {
        const setup = battleSetupFor(this.mode as 'battle' | 'coop', this.teamSize, this.joined.map((p) => ({ race: p.race, team: p.team })), this.options);
        if (!setup) return this.log(`relay: ${this.joined.length} players do not fit ${this.mode} teams of ${this.teamSize}`);
        return this.start(undefined, setup);
      }
      this.start(resumeOf(m.resume, this.mode, this.joined.length));
    } else if (m.t === 'cmd' && this.started) {
      const command = validCommand(m.command);
      if (command) this.queue.push({ player: peer.slot, command });
      else this.log(`relay: dropped a malformed command from ${peer.name}`);
    } else if (m.t === 'hash' && this.started && Number.isSafeInteger(m.tick) && Number.isSafeInteger(m.hash)) {
      this.hash(peer, m.tick, m.hash);
    }
  }

  private hello(peer: Peer, m: Extract<ClientMessage, { t: 'hello' }>): void {
    const host = this.peers.find((p) => p.host && p.joined && !p.gone);
    const name = String(m.name ?? '').trim().slice(0, 20) || 'Player';
    if (m.protocol !== PROTOCOL || m.version !== this.opts.version) {
      return this.reject(peer.socket, `The host is on version ${this.opts.version}. Install the same version as the host.`);
    }
    const isHost = m.token === this.opts.token && !host;
    if (!isHost && !host) return this.reject(peer.socket, 'The host is not ready yet. Try again in a moment.');
    if (this.started) return this.reject(peer.socket, 'That game has already started.');
    if (this.joined.length >= MAX_LOBBY) return this.reject(peer.socket, `That game is full (${MAX_LOBBY} players).`);
    if (host && m.data !== host.data) {
      return this.reject(peer.socket, "Your game files are different from the host's. Both of you: update Diablo II: Resurrected, then in Settings extract the game files again.");
    }
    Object.assign(peer, { name, host: isHost, data: String(m.data), slot: this.joined.length, joined: true });
    this.log(`relay: ${name} joined${isHost ? ' (host)' : ''}`);
    sendLine(peer.socket, { t: 'welcome', you: peer.slot, host: isHost } satisfies HostMessage);
    this.sendLobby();
  }

  /** Starts the match: fresh, or from the host's checkpoint, whose tick the bundles carry on from. */
  private start(resume?: { json: string; seed: number; tick: number }, battle?: BattleSetup): void {
    this.started = true;
    const players = this.lobbyPlayers();
    const seed = resume?.seed ?? (this.opts.seed ?? (() => randomInt(1, 0x7fffffff)))();
    if (resume) this.tick = resume.tick;
    this.log(`relay: ${resume ? `resume at tick ${resume.tick}` : 'start'} ${this.mode} with ${players.map((p) => p.name).join(', ')}, seed ${seed}`);
    for (const p of this.joined) {
      sendLine(p.socket, { t: 'start', seed, mode: this.mode, players, you: p.slot, ...(resume ? { resume: resume.json } : {}), ...(battle ? { battle } : {}) } satisfies HostMessage);
    }
    const tickMs = this.opts.tickMs ?? TICK_MS;
    const t0 = performance.now();
    const first = this.tick;
    const pump = () => {
      if (this.stopped) return;
      // Emit every tick that is due, so a late timer catches up instead of drifting
      const due = tickMs > 0 ? first + Math.floor((performance.now() - t0) / tickMs) : this.tick + 1;
      while (this.tick < due) {
        this.broadcast({ t: 'tick', tick: this.tick, cmds: this.queue });
        this.queue = [];
        this.tick++;
      }
    };
    if (tickMs > 0) this.timer = setInterval(pump, Math.max(5, tickMs / 4));
    else {
      const loop = () => {
        pump();
        if (!this.stopped) setImmediate(loop);
      };
      setImmediate(loop);
    }
  }

  /** Once everyone still here has reported a tick, their hashes must agree. */
  private hash(peer: Peer, tick: number, hash: number): void {
    const seen = this.hashes.get(tick) ?? new Map<number, number>();
    seen.set(peer.slot, hash);
    this.hashes.set(tick, seen);
    const present = this.joined.map((p) => p.slot);
    if (!present.every((slot) => seen.has(slot))) return;
    this.hashes.delete(tick);
    const values = new Set(present.map((slot) => seen.get(slot)));
    if (values.size > 1) {
      this.log(`relay: desync at tick ${tick}: ${present.map((s) => `${s}=${seen.get(s)}`).join(' ')}`);
      this.broadcast({ t: 'desync', tick });
      this.stopped = true;
      if (this.timer) clearInterval(this.timer);
    }
  }

  private onClose(peer: Peer): void {
    const wasIn = peer.joined && !peer.gone;
    peer.gone = true;
    this.peers = this.peers.filter((p) => p !== peer || this.started);
    if (!wasIn) return;
    this.log(`relay: ${peer.name} left`);
    if (peer.host) {
      // The game lives in the host's app; without it there is no game
      this.close();
      return;
    }
    if (this.started) {
      this.broadcast({ t: 'left', slot: peer.slot, name: peer.name });
    } else {
      // In the lobby, close the gap so slots stay 0..n-1
      this.joined.forEach((p, i) => {
        if (p.slot !== i) {
          p.slot = i;
          sendLine(p.socket, { t: 'welcome', you: i, host: p.host } satisfies HostMessage);
        }
      });
      this.sendLobby();
    }
  }
}

/** A checkpoint the host wants to resume, if it fits this lobby: its mode and player count, and not absurdly big. */
function resumeOf(json: unknown, mode: MatchMode, players: number): { json: string; seed: number; tick: number } | undefined {
  if (typeof json !== 'string' || json.length > 8_000_000) return undefined;
  try {
    const cp = JSON.parse(json) as { mode?: unknown; players?: unknown; seed?: unknown; tick?: unknown };
    if (cp.mode !== mode || cp.players !== players || !Number.isSafeInteger(cp.seed) || !Number.isSafeInteger(cp.tick)) return undefined;
    return { json, seed: cp.seed as number, tick: cp.tick as number };
  } catch {
    return undefined;
  }
}
