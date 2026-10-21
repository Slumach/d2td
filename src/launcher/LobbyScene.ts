// Host and Join. The host opens a lobby on this PC and gets codes to hand out; a friend types
// a code to join. The host picks Team or Free for all and starts; everyone then moves to the
// game with the same seed, mode and player order.

import Phaser from 'phaser';

import { LOBBY_MODES, type LobbyPlayer } from '../net/protocol.ts';
import { DIFFICULTY_NAMES } from '../sim/data.ts';
import { MAX_TEAM_PLAYERS, type MatchMode } from '../sim/match.ts';
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
  private difficulty = 0;
  private me = -1;
  private isHost = false;
  private codes: JoinCode[] = [];
  private upnp: UpnpStatus | 'trying' = 'trying';

  constructor() {
    super('Lobby');
  }

  create(data: { role: 'host' | 'join' }): void {
    this.role = data.role;
    this.session = MpSession.of(this.registry.get(LAUNCHER_KEY) as LauncherApi);
    Object.assign(this, { phase: data.role === 'host' ? 'connecting' : 'code', message: '', players: [], mode: 'team', difficulty: 0, me: -1, isHost: false, codes: [], upnp: 'trying', field: undefined });
    this.session.listen((e) => this.onEvent(e));
    if (this.role === 'host') {
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
      this.upnp = e.status;
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
      } else if (m.t === 'lobby') {
        this.players = m.players;
        this.mode = m.mode;
        this.difficulty = m.difficulty;
      } else if (m.t === 'reject') {
        this.message = m.reason;
      } else if (m.t === 'start') {
        // Hold the tick bundles that follow until the game scene is ready for them
        this.session.hold();
        const start: OnlineStart = { seed: m.seed, mode: m.mode, difficulty: m.difficulty, players: m.players, you: m.you };
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
      this.field = new TextField(this, LEFT, y, 360, {
        value: this.code,
        placeholder: 'XXXX-XXXX-XXXX',
        maxLength: 16,
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

    add(this.add.text(LEFT, y, `Players (${this.players.length} of 6)`, MUTED));
    y += 30;
    for (const p of this.players) {
      const tags = [p.slot === 0 ? 'host' : '', p.slot === this.me ? 'you' : ''].filter(Boolean).join(', ');
      add(this.add.text(LEFT, y, `${p.slot + 1}. ${p.name}${tags ? `  (${tags})` : ''}`, TEXT));
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

    add(this.add.text(LEFT, y, 'Difficulty', MUTED));
    y += 30;
    if (this.isHost) {
      let x = LEFT;
      DIFFICULTY_NAMES.forEach((name, difficulty) => {
        const chosen = difficulty === this.difficulty;
        this.parts.push(
          ...button(this, x, y, { label: name, onClick: () => this.session.send({ t: 'difficulty', difficulty }), colour: chosen ? '#6a3020' : '#3a2c1c', width: 220 }),
        );
        x += 240;
      });
      y += 50;
    } else {
      add(this.add.text(LEFT, y, DIFFICULTY_NAMES[this.difficulty]!, TEXT));
      y += 34;
    }
    const loop = add(this.add.text(LEFT, y, 'After wave 30 the map loops at the next difficulty, up to Hell.', MUTED));
    y += loop.height + 30;

    if (this.isHost && this.mode === 'team' && this.players.length > MAX_TEAM_PLAYERS) {
      add(this.add.text(LEFT, y + 6, `A team takes up to ${MAX_TEAM_PLAYERS} players: pick Free for all, or wait for someone to leave.`, TEXT));
    } else if (this.isHost) {
      this.parts.push(...button(this, LEFT, y, { label: 'Start', onClick: () => this.session.send({ t: 'start' }), colour: '#6a3020', width: 200 }));
    } else {
      add(this.add.text(LEFT, y + 6, 'Waiting for the host to start.', TEXT));
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
      this.parts.push(...button(this, LEFT + 480, y, { label: 'Copy', onClick: () => void navigator.clipboard?.writeText(c.code), width: 90 }));
      y += 44;
    }
    const upnpText =
      this.upnp === 'trying'
        ? 'Asking your router to let friends on the internet in...'
        : this.upnp.state === 'ok'
          ? 'Your router let the game in. Friends anywhere can use the Internet code.'
          : this.upnp.state === 'doubleNat'
            ? 'Your internet provider shares your address with other homes, so an Internet code cannot work. Friends on the internet can join through Tailscale.'
            : `Your router did not open the game for the internet. For friends elsewhere, forward TCP port ${DEFAULT_PORT} to this PC in your router, or use Tailscale.`;
    const t = add(this.add.text(LEFT, y + 4, upnpText, MUTED));
    return y + t.height + 30;
  }
}
