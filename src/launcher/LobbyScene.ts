// Host and Join. The host opens a lobby on this PC and gets codes to hand out; a friend types
// a code to join. The host picks Team, Free for all, Battle or Co-op and starts; everyone then
// moves to the game with the same seed, mode and player order. In Battle and Co-op the host
// sets the team size, each player picks a race and (Battle) a team, and bots take the seats
// no one fills.

import Phaser from 'phaser';

import { LOBBY_MODES, type LobbyPlayer } from '../net/protocol.ts';
import { stageName } from '../sim/data.ts';
import type { Checkpoint } from '../sim/checkpoint.ts';
import { battleSetupFor, MAX_LOBBY, MAX_TEAM_PLAYERS, type MatchMode } from '../sim/match.ts';
import { RACES, type BattleChoice } from './MenuScene.ts';
import { loadCheckpoint } from '../render/saves.ts';
import type { OnlineStart } from '../render/GameScene.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../render/layout.ts';
import { FONT, button } from '../render/ui.ts';
import { DEFAULT_PORT } from '../net/protocol.ts';
import type { JoinCode, LauncherApi, MpEvent, UpnpStatus } from './api.ts';
import { MpSession } from './session.ts';
import { LAUNCHER_KEY } from './SetupScene.ts';
import { TextField } from './TextField.ts';

const LEFT = 240;
const WIDTH = GAME_WIDTH - 2 * LEFT;
const TEXT = { fontFamily: FONT, fontSize: '22px', color: '#e8e0c0', wordWrap: { width: WIDTH }, lineSpacing: 6 };
const MUTED = { ...TEXT, fontSize: '18px', color: '#a8a088' };
const ERROR = { ...TEXT, color: '#ff8060' };

const MODE_TEXT: Record<MatchMode, { name: string; about: string }> = {
  team: { name: 'Team', about: 'One ring, an arc each (up to four players). Monsters lap the ring until someone kills them, kill gold goes to the killer, and the team loses when 100 are alive at once.' },
  ffa: { name: 'Free for all', about: 'Everyone gets their own ring and the same waves. Let 100 pile up on yours and you are out; the last ring standing wins.' },
  solo: { name: 'Solo', about: '' },
  battle: { name: 'Battle', about: 'Two teams, a lane each, a king at the back. Build your race, hire workers for Souls, and send monsters down the other team\'s lanes. First king to fall loses.' },
  coop: { name: 'Co-op', about: 'One team, a lane each, against 21 waves with sends arriving on a timer. Keep the Worldstone standing.' },
};

type Phase = 'code' | 'connecting' | 'lobby';

export class LobbyScene extends Phaser.Scene {
  private session!: MpSession;
  private role: 'host' | 'join' = 'host';
  private phase: Phase = 'connecting';
  private parts: Phaser.GameObjects.GameObject[] = [];
  private field: TextField | undefined;
  private code = '';
  private message = '';
  private players: LobbyPlayer[] = [];
  private mode: MatchMode = 'team';
  private me = -1;
  /** The host's multiplayer checkpoint, if one is saved. */
  private saved: Checkpoint | undefined;
  private isHost = false;
  private codes: JoinCode[] = [];
  private upnp: UpnpStatus | 'trying' = 'trying';
  /** Battle Mode: players a team (the host's), and the choices the host came in with from the Battle Mode page. */
  private teamSize = 1;
  private preset: BattleChoice | undefined;

  constructor() {
    super('Lobby');
  }

  create(data: { role: 'host' | 'join'; battle?: BattleChoice }): void {
    this.role = data.role;
    this.preset = data.battle;
    this.teamSize = 1;
    this.session = MpSession.of(this.registry.get(LAUNCHER_KEY) as LauncherApi);
    Object.assign(this, { phase: data.role === 'host' ? 'connecting' : 'code', message: '', players: [], mode: 'team', me: -1, isHost: false, codes: [], upnp: 'trying', field: undefined, saved: undefined });
    this.session.listen((e) => this.onEvent(e));
    if (this.role === 'host') {
      void loadCheckpoint(this.registry.get(LAUNCHER_KEY) as LauncherApi, 'mp').then((cp) => {
        this.saved = cp;
        this.draw();
      });
      void this.session.host().then((r) => {
        if (!r.ok) {
          this.message = r.error ?? 'Could not open a lobby.';
          this.phase = 'lobby';
        }
        this.codes = r.codes;
        this.draw();
      });
    }
    this.draw();
  }

  private onEvent(e: MpEvent): void {
    if (e.kind === 'upnp') {
      this.upnp = e.status.state === 'trying' ? 'trying' : e.status;
    } else if (e.kind === 'closed') {
      this.message = e.reason;
      this.players = [];
      this.phase = this.role === 'join' ? 'code' : 'lobby';
    } else {
      const m = e.message;
      if (m.t === 'welcome') {
        this.me = m.you;
        this.isHost = m.host;
        this.phase = 'lobby';
        this.message = '';
        // Hosting from the Battle Mode page: its mode, team size and race come along
        const p = this.preset;
        if (p && m.host) {
          this.preset = undefined;
          this.session.send({ t: 'mode', mode: p.mode });
          this.session.send({ t: 'battle', teamSize: p.teamSize, race: p.race });
        }
      } else if (m.t === 'lobby') {
        this.players = m.players;
        this.mode = m.mode;
        this.teamSize = m.teamSize ?? this.teamSize;
      } else if (m.t === 'reject') {
        this.message = m.reason;
      } else if (m.t === 'start') {
        // Hold the tick bundles that follow until the game scene is ready for them
        this.session.hold();
        const resume = m.resume ? (JSON.parse(m.resume) as Checkpoint) : undefined;
        const start: OnlineStart = { seed: m.seed, mode: m.mode, players: m.players, you: m.you, host: this.isHost, ...(resume ? { resume } : {}), ...(m.battle ? { battle: m.battle } : {}) };
        this.scene.start('Game', start);
        return;
      }
    }
    this.draw();
  }

  private leave(): void {
    void this.session.leave();
    this.scene.start('Menu');
  }

  private connect(): void {
    const code = this.code.trim();
    if (!code) return;
    this.phase = 'connecting';
    this.message = '';
    this.draw();
    void this.session.join(code).then((r) => {
      if (!r.ok) {
        this.phase = 'code';
        this.message = r.error ?? 'Could not join.';
        this.draw();
      }
    });
  }

  private draw(): void {
    for (const p of this.parts) p.destroy();
    this.parts = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    add(this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x14120e).setOrigin(0));
    add(this.add.text(LEFT, 90, this.role === 'host' ? 'Host a game' : 'Join a game', { ...TEXT, fontSize: '44px' }));
    let y = 180;

    if (this.phase === 'code') {
      this.field?.destroy();
      add(this.add.text(LEFT, y, 'Type the code the host gave you.', TEXT));
      y += 50;
      this.field = new TextField(this, LEFT, y, 480, {
        value: this.code,
        placeholder: 'XXXX-XXXX-XXXX(-XXXX)',
        maxLength: 22,
        allowed: /[0-9A-Za-z -]/,
        onChange: (v) => (this.code = v.toUpperCase()),
        onEnter: () => this.connect(),
      });
      this.field.focus();
      y += 70;
      this.parts.push(...button(this, LEFT, y, { label: 'Join', onClick: () => this.connect(), colour: '#6a3020', width: 200 }));
      y += 70;
    } else {
      this.field?.destroy();
      this.field = undefined;
    }

    if (this.phase === 'connecting') {
      add(this.add.text(LEFT, y, this.role === 'host' ? 'Opening the lobby...' : 'Connecting to the host...', TEXT));
      y += 60;
    }

    if (this.phase === 'lobby' && this.players.length > 0) y = this.drawLobby(y);

    if (this.message) {
      const t = add(this.add.text(LEFT, y, this.message, ERROR));
      y += t.height + 20;
    }
    this.parts.push(...button(this, LEFT, GAME_HEIGHT - 110, { label: 'Leave', onClick: () => this.leave(), width: 200 }));
  }

  private drawLobby(y: number): number {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);

    if (this.isHost) y = this.drawCodes(y);

    const battle = this.mode === 'battle' || this.mode === 'coop';
    add(this.add.text(LEFT, y, `Players (${this.players.length} of ${MAX_LOBBY})`, MUTED));
    y += 30;
    for (const p of this.players) {
      const tags = [p.slot === 0 ? 'host' : '', p.slot === this.me ? 'you' : ''].filter(Boolean).join(', ');
      const side = battle ? `, ${raceName(p.race ?? 'random')}${this.mode === 'battle' ? `, team ${(p.team ?? 0) + 1}` : ''}` : '';
      add(this.add.text(LEFT, y, `${p.slot + 1}. ${p.name}${side}${tags ? `  (${tags})` : ''}`, TEXT));
      y += 32;
    }
    y += 20;

    add(this.add.text(LEFT, y, 'Mode', MUTED));
    y += 30;
    if (this.isHost) {
      let x = LEFT;
      for (const mode of LOBBY_MODES) {
        const chosen = mode === this.mode;
        this.parts.push(...button(this, x, y, { label: MODE_TEXT[mode].name, onClick: () => this.session.send({ t: 'mode', mode }), colour: chosen ? '#6a3020' : '#3a2c1c', width: 220 }));
        x += 240;
      }
      y += 50;
    } else {
      add(this.add.text(LEFT, y, MODE_TEXT[this.mode].name, TEXT));
      y += 34;
    }
    const about = add(this.add.text(LEFT, y, MODE_TEXT[this.mode].about, MUTED));
    y += about.height + 30;

    if (battle) {
      y = this.drawBattleChoices(y);
    } else {
      const campaign = add(this.add.text(LEFT, y, 'The campaign: five acts on Normal, then Nightmare, then Hell. The host saves at every new act.', MUTED));
      y += campaign.height + 30;
    }

    const humans = this.players.map((p) => ({ race: p.race ?? 'random', team: p.team ?? 0 }));
    const seats = battle ? battleSetupFor(this.mode as 'battle' | 'coop', this.teamSize, humans) : undefined;
    if (this.isHost && battle && !seats) {
      add(this.add.text(LEFT, y + 6, `${this.players.length} players do not fit ${this.mode === 'battle' ? 'two teams' : 'one team'} of ${this.teamSize}: raise the team size.`, TEXT));
    } else if (this.isHost && battle) {
      this.parts.push(...button(this, LEFT, y, { label: 'Start', onClick: () => this.session.send({ t: 'start' }), colour: '#6a3020', width: 200 }));
      const bots = seats?.bots?.length ?? 0;
      add(this.add.text(LEFT + 220, y + 6, bots ? `Bots take the other ${bots} ${bots === 1 ? 'seat' : 'seats'}.` : 'Every seat has a player.', MUTED));
    } else if (this.isHost && this.mode === 'team' && this.players.length > MAX_TEAM_PLAYERS) {
      add(this.add.text(LEFT, y + 6, `A team takes up to ${MAX_TEAM_PLAYERS} players: pick Free for all, or wait for someone to leave.`, TEXT));
    } else if (this.isHost) {
      this.parts.push(...button(this, LEFT, y, { label: 'Start', onClick: () => this.session.send({ t: 'start' }), colour: '#6a3020', width: 200 }));
      // The saved game carries on with the same mode and the same number of players
      const cp = this.saved;
      if (cp && cp.mode === this.mode && cp.players === this.players.length) {
        const label = `Continue ${stageName(cp.difficulty, cp.act)}`;
        this.parts.push(...button(this, LEFT + 220, y, { label, onClick: () => this.session.send({ t: 'start', resume: JSON.stringify(cp) }), colour: '#3a4c2c', width: 320 }));
      } else if (cp) {
        add(this.add.text(LEFT + 220, y + 6, `A saved ${MODE_TEXT[cp.mode].name} game for ${cp.players} waits.`, MUTED));
      }
    } else {
      add(this.add.text(LEFT, y + 6, 'Waiting for the host to start.', TEXT));
    }
    return y + 70;
  }

  /** Battle and Co-op: the team size (the host's to set), your race and, in Battle, your team. */
  private drawBattleChoices(y: number): number {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const mine = this.players.find((p) => p.slot === this.me);
    add(this.add.text(LEFT, y, 'Players a team', MUTED));
    y += 30;
    if (this.isHost) {
      for (let n = 1; n <= 4; n++) {
        this.parts.push(...button(this, LEFT + (n - 1) * 120, y, { label: `${n}`, onClick: () => this.session.send({ t: 'battle', teamSize: n }), colour: n === this.teamSize ? '#6a3020' : '#3a2c1c', width: 100 }));
      }
      y += 50;
    } else {
      add(this.add.text(LEFT, y, `${this.teamSize}`, TEXT));
      y += 34;
    }
    const race = mine?.race ?? 'random';
    const all = ['random', ...RACES];
    this.parts.push(...button(this, LEFT, y, { label: `Your race: ${raceName(race)}`, onClick: () => this.session.send({ t: 'battle', race: all[(all.indexOf(race) + 1) % all.length]! }), width: 340 }));
    if (this.mode === 'battle') {
      const team = mine?.team ?? 0;
      this.parts.push(...button(this, LEFT + 360, y, { label: `Your team: ${team + 1}`, onClick: () => this.session.send({ t: 'battle', team: 1 - team }), width: 240 }));
    }
    return y + 70;
  }

  private drawCodes(y: number): number {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const codes = [...(typeof this.upnp === 'object' && this.upnp.state === 'ok' ? [this.upnp.code] : []), ...this.codes];
    add(this.add.text(LEFT, y, 'Give your friends a code:', MUTED));
    y += 30;
    for (const c of codes) {
      add(this.add.text(LEFT, y + 4, c.label, { ...MUTED, color: '#c8c0a0' }));
      add(this.add.text(LEFT + 190, y, c.code, { ...TEXT, fontSize: '28px' }));
      this.parts.push(...button(this, LEFT + 560, y, { label: 'Copy', onClick: () => void navigator.clipboard?.writeText(c.code), width: 90 }));
      y += 44;
    }
    const upnpText =
      this.upnp === 'trying'
        ? 'Opening the game to friends on the internet...'
        : this.upnp.state === 'ok'
          ? this.upnp.via === 'relay'
            ? 'Friends anywhere can use the Internet code; it goes through the relay server.'
            : 'Your router let the game in. Friends anywhere can use the Internet code.'
          : this.upnp.state === 'doubleNat'
            ? 'Your internet provider shares your address with other homes, so an Internet code cannot work. Friends on the internet can join through Tailscale.'
            : `Your router did not open the game for the internet. For friends elsewhere, forward TCP port ${DEFAULT_PORT} to this PC in your router, or use Tailscale.`;
    const t = add(this.add.text(LEFT, y + 4, upnpText, MUTED));
    return y + t.height + 30;
  }
}

/** A race's name for the lobby. */
function raceName(race: string): string {
  return race === 'random' ? 'Random' : race.charAt(0).toUpperCase() + race.slice(1);
}
