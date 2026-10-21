// Multiplayer soak: four bot players on this PC play a whole match through the real relay
// over TCP, as fast as the CPU allows, with the real tables. Passes when the relay never
// saw a hash disagree and all four end on the same match hash.
//
//   npm run mp-soak                    team, 4 players
//   npm run mp-soak -- --mode ffa --players 3 --seed 7

import { parseArgs } from 'node:util';

import { connectToRelay } from '../electron/net/client.ts';
import { Relay } from '../electron/net/relay.ts';
import { Lockstep } from '../src/net/lockstep.ts';
import { PROTOCOL, type HostMessage } from '../src/net/protocol.ts';
import { DESIGN } from '../src/data/design.ts';
import { buildGameData } from '../src/sim/data.ts';
import { matchHash, type MatchMode } from '../src/sim/match.ts';
import { createBot, STRATEGIES } from './bots.ts';
import { loadTables } from './lib/load-tables.ts';

const { values: args } = parseArgs({
  options: {
    mode: { type: 'string', default: 'team' },
    players: { type: 'string', default: '4' },
    seed: { type: 'string', default: '1' },
  },
});
const mode = args.mode as MatchMode;
const count = Number(args.players);
const data = buildGameData(loadTables(), DESIGN);
const TOKEN = 'soak';
const VERSION = 'soak';

const relay = new Relay({ port: 0, token: TOKEN, version: VERSION, tickMs: 0, seed: () => Number(args.seed), log: (l) => l.includes('desync') && console.log(l) });
const port = await relay.listen();
const t0 = Date.now();

interface Result {
  slot: number;
  tick: number;
  hash: number;
  winners: number[];
  waves: number;
}

let desync = false;
let hostSend: (m: Parameters<ReturnType<typeof connectToRelay>['send']>[0]) => void = () => undefined;
const results = await new Promise<Result[]>((resolveAll) => {
  const done: Result[] = [];
  let welcomed = 0;
  for (let i = 0; i < count; i++) {
    let step: Lockstep | undefined;
    let bot: ReturnType<typeof createBot> | undefined;
    let finished = false;
    const conn = connectToRelay(
      '127.0.0.1',
      port,
      { t: 'hello', protocol: PROTOCOL, version: VERSION, data: 'soak', name: `${STRATEGIES[i % STRATEGIES.length]}`, token: i === 0 ? TOKEN : undefined },
      (m: HostMessage) => {
        if (m.t === 'welcome' && ++welcomed === count) {
          // Everyone is in: the host picks the mode and starts
          setTimeout(() => {
            hostSend({ t: 'mode', mode });
            hostSend({ t: 'start' });
          }, 50);
        }
        if (m.t === 'desync') desync = true;
        if (m.t === 'start') {
          step = new Lockstep({ data, seed: m.seed, mode: m.mode, players: m.players.length, me: m.you, send: (msg) => conn.send(msg) });
          bot = createBot(STRATEGIES[m.you % STRATEGIES.length]!, step.match.zones[m.you]!);
        }
        if (m.t === 'tick' && step && !finished) {
          step.receive(m.tick, m.cmds);
          step.advance(1_000_000, () => {
            for (const command of bot!.decide(step!.match.zones[step!.me]!)) step!.issue(command);
          });
          const s = step.match.state;
          // Everyone stops at the same tick: the first multiple of 100 after the match ends
          if ((s.status === 'over' && s.tick % 100 === 0) || desync) {
            finished = true;
            done.push({ slot: step.me, tick: s.tick, hash: matchHash(step.match), winners: s.winners, waves: step.match.zones[0]!.state.wave });
            conn.close();
            if (done.length === count) resolveAll(done.sort((a, b) => a.slot - b.slot));
          }
        }
      },
      () => undefined,
    );
    if (i === 0) hostSend = (msg) => conn.send(msg);
  }
});
relay.close();
const secs = ((Date.now() - t0) / 1000).toFixed(1);
for (const r of results) console.log(`player ${r.slot + 1}: stopped at tick ${r.tick}, wave ${r.waves}, hash ${r.hash.toString(16)}, winners [${r.winners.map((w) => w + 1).join(', ')}]`);
const agree = new Set(results.map((r) => r.hash)).size === 1 && new Set(results.map((r) => r.tick)).size === 1;
console.log(`${mode}, ${count} players, ${secs} s: ${desync ? 'DESYNC' : agree ? 'in lockstep the whole game' : 'final hashes differ'}`);
process.exit(desync || !agree ? 1 : 0);
