// Host and Join, in D2R's options panel with D2's stone buttons. The host opens a lobby on
// this PC and gets codes to hand out; a friend types a code to join. The host picks Team,
// Free for all, Eternal Conflict or Co-op and starts; everyone then moves to the game with
// the same seed, mode and player order. In Eternal Conflict and Co-op the host sets the team
// size and brings the game setup from the Eternal Conflict page, each player picks a race and
// (in a conflict) a team, and bots take the seats no one fills.

import Phaser from 'phaser';

import { LOBBY_MODES, type LobbyPlayer } from '../net/protocol.ts';
import { stageName } from '../sim/data.ts';
import type { Checkpoint } from '../sim/checkpoint.ts';
import { DEFAULT_OPTIONS, type BattleOptions } from '../sim/battle.ts';
import { battleSetupFor, MAX_LOBBY, MAX_TEAM_PLAYERS, type MatchMode } from '../sim/match.ts';
import { RACES, type BattleChoice } from './MenuScene.ts';
import { loadCheckpoint } from '../render/saves.ts';
import type { OnlineStart } from '../render/GameScene.ts';
import { GAME_HEIGHT, GAME_WIDTH } from '../render/layout.ts';
import { FONT, button } from '../render/ui.ts';
import { DEFAULT_PORT } from '../net/protocol.ts';
import type { JoinCode, LauncherApi, MpEvent, UpnpStatus } from './api.ts';
import { MpSession } from './session.ts';
import { frontendManifest, menuMusic, optionsPanel, preloadFrontend, stoneButton } from './frontend.ts';
import { LAUNCHER_KEY } from './SetupScene.ts';
import { TextField } from './TextField.ts';

const CX = GAME_WIDTH / 2;
/** The panel: D2R's options backdrop, its inner column. */
const PANEL_HEIGHT = 880;
const PANEL_CY = GAME_HEIGHT / 2 - 10;
const LEFT = 300;
const WIDTH = 840;
const TEXT = { fontFamily: FONT, fontSize: '20px', color: '#e8e0c0', wordWrap: { width: WIDTH }, lineSpacing: 5 };
const MUTED = { ...TEXT, fontSize: '16px', color: '#a8a088' };
const ERROR = { ...TEXT, color: '#ff8060' };
const GOLD = { ...TEXT, color: '#c7b377' };

const MODE_TEXT: Record<MatchMode, { name: string; about: string }> = {
  team: { name: 'Team', about: 'One ring, an arc each (up to four players). Monsters lap the ring until someone kills them, kill gold goes to the killer, and the team loses when 100 are alive at once.' },
  ffa: { name: 'Free for all', about: 'Everyone gets their own ring and the same waves. Let 100 pile up on yours and you are out; the last ring standing wins.' },
  solo: { name: 'Solo', about: '' },
  battle: { name: 'Eternal Conflict', about: 'Heaven against Hell, Legion style: two teams, a build pad each, a king at the back. Your towers are fighters that hold the creeps; hire workers to mine shards, and send monsters down the other team\'s pads. First king to fall loses.' },
  coop: { name: 'Eternal Conflict co-op', about: 'One team, a pad each, against the waves with sends arriving on a timer. Keep your king standing.' },
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
  /** Eternal Conflict: players a team and the game setup (the host's), and the choices the host came in with from its page. */
  private teamSize = 1;
  private options: BattleOptions = DEFAULT_OPTIONS;
  private preset: BattleChoice | undefined;

  constructor() {
    super('Lobby');
  }

  preload(): void {
    preloadFrontend(this);
  }

  create(data: { role: 'host' | 'join'; battle?: BattleChoice }): void {
    this.role = data.role;
    this.preset = data.battle;
    this.teamSize = 1;
    this.session = MpSession.of(this.registry.get(LAUNCHER_KEY) as LauncherApi);
    Object.assign(this, { phase: data.role === 'host' ? 'connecting' : 'code', message: '', players: [], mode: 'team', me: -1, isHost: false, codes: [], upnp: 'trying', field: undefined, saved: undefined });
    this.session.listen((e) => this.onEvent(e));
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000).setOrigin(0).setDepth(0);
    menuMusic(this, true);
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
        // Hosting from the Eternal Conflict page: its mode, team size, race and game setup come along
        const p = this.preset;
        if (p && m.host) {
          this.preset = undefined;
          this.session.send({ t: 'mode', mode: p.mode });
          this.session.send({ t: 'battle', teamSize: p.teamSize, race: p.race, options: p.options });
        }
      } else if (m.t === 'lobby') {
        this.players = m.players;
        this.mode = m.mode;
        this.teamSize = m.teamSize ?? this.teamSize;
        this.options = m.options ?? this.options;
      } else if (m.t === 'reject') {
        this.message = m.reason;
      } else if (m.t === 'start') {
        // Hold the tick bundles that follow until the game scene is ready for them
        this.session.hold();
        menuMusic(this, false);
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

  /** A stone button (the medium one) where the art is, else the plain button; `chosen` keeps a choice lit among its row. */
  private btn(x: number, y: number, label: string, onClick: () => void, width: number, chosen = true): void {
    if (frontendManifest(this)) {
      const parts = stoneButton(this, x + width / 2, y + 17, label, onClick, { size: 'med', width, fontSize: width < 120 ? 14 : 15 });
      if (!chosen) for (const p of parts) (p as Phaser.GameObjects.Image).setAlpha?.(0.6);
      this.parts.push(...parts);
    } else this.parts.push(...button(this, x, y, { label, onClick, width, colour: chosen ? '#6a3020' : '#3a2c1c' }));
  }

  private draw(): void {
    for (const p of this.parts) p.destroy();
    this.parts = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const d2 = frontendManifest(this) !== undefined;
    const panel = d2 ? optionsPanel(this, CX, PANEL_CY, PANEL_HEIGHT, 'optionsBg') : undefined;
    if (panel) add(panel);
    const top = PANEL_CY - PANEL_HEIGHT / 2;
    const conflict = this.phase === 'lobby' && (this.mode === 'battle' || this.mode === 'coop');
    const title = conflict ? 'Eternal Conflict' : this.role === 'host' ? 'Host a game' : 'Join a game';
    add(this.add.text(CX, top + 54, title, { ...TEXT, fontSize: '34px', color: '#c7b377' }).setOrigin(0.5).setDepth(3101));
    let y = top + 100;
    const text = (s: string, style = TEXT) => {
      const t = add(this.add.text(LEFT, y, s, style).setDepth(3101));
      return t;
    };

    if (this.phase === 'code') {
      this.field?.destroy();
      text('Type the code the host gave you.');
      y += 44;
      this.field = new TextField(this, LEFT, y, 480, {
        value: this.code,
        placeholder: 'XXXX-XXXX-XXXX(-XXXX)',
        maxLength: 22,
        allowed: /[0-9A-Za-z -]/,
        onChange: (v) => (this.code = v.toUpperCase()),
        onEnter: () => this.connect(),
      });
      for (const p of this.field.parts) (p as unknown as Phaser.GameObjects.Components.Depth).setDepth(3101);
      this.field.focus();
      y += 64;
      this.btn(LEFT, y, 'Join', () => this.connect(), 200);
      y += 60;
    } else {
      this.field?.destroy();
      this.field = undefined;
    }

    if (this.phase === 'connecting') {
      text(this.role === 'host' ? 'Opening the lobby...' : 'Connecting to the host...');
      y += 50;
    }

    if (this.phase === 'lobby' && this.players.length > 0) y = this.drawLobby(y);

    if (this.message) {
      const t = text(this.message, ERROR);
      y += t.height + 20;
    }
    this.btn(CX - 100, top + PANEL_HEIGHT - 76, 'Leave', () => this.leave(), 200);
  }

  private drawLobby(y: number): number {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const text = (s: string, style = TEXT, x = LEFT) => add(this.add.text(x, y, s, style).setDepth(3101));

    if (this.isHost) y = this.drawCodes(y);

    const battle = this.mode === 'battle' || this.mode === 'coop';
    text(`Players (${this.players.length} of ${MAX_LOBBY})`, GOLD);
    y += 28;
    for (const p of this.players) {
      const tags = [p.slot === 0 ? 'host' : '', p.slot === this.me ? 'you' : ''].filter(Boolean).join(', ');
      const side = battle ? `, ${raceName(p.race ?? 'random')}${this.mode === 'battle' ? `, team ${(p.team ?? 0) + 1}` : ''}` : '';
      text(`${p.slot + 1}. ${p.name}${side}${tags ? `  (${tags})` : ''}`);
      y += 28;
    }
    y += 14;

    text('Mode', GOLD);
    y += 28;
    if (this.isHost) {
      let x = LEFT;
      for (const mode of LOBBY_MODES) {
        const w = mode === 'battle' ? 230 : 190;
        this.btn(x, y, MODE_TEXT[mode].name, () => this.session.send({ t: 'mode', mode }), w, mode === this.mode);
        x += w + 10;
      }
      y += 44;
    } else {
      text(MODE_TEXT[this.mode].name);
      y += 30;
    }
    const about = text(MODE_TEXT[this.mode].about, MUTED);
    y += about.height + 20;

    if (battle) {
      y = this.drawBattleChoices(y);
    } else {
      const campaign = text('The campaign: five acts on Normal, then Nightmare, then Hell. The host saves at every new act.', MUTED);
      y += campaign.height + 20;
    }

    const humans = this.players.map((p) => ({ race: p.race ?? 'random', team: p.team ?? 0 }));
    const seats = battle ? battleSetupFor(this.mode as 'battle' | 'coop', this.teamSize, humans, this.options) : undefined;
    if (this.isHost && battle && !seats) {
      text(`${this.players.length} players do not fit ${this.mode === 'battle' ? 'two teams' : 'one team'} of ${this.teamSize}: raise the team size.`);
    } else if (this.isHost && battle) {
      this.btn(LEFT, y, 'Start', () => this.session.send({ t: 'start' }), 200);
      const bots = seats?.bots?.length ?? 0;
      text(bots ? `Bots take the other ${bots} ${bots === 1 ? 'seat' : 'seats'}.` : 'Every seat has a player.', MUTED, LEFT + 220).setY(y + 8);
    } else if (this.isHost && this.mode === 'team' && this.players.length > MAX_TEAM_PLAYERS) {
      text(`A team takes up to ${MAX_TEAM_PLAYERS} players: pick Free for all, or wait for someone to leave.`);
    } else if (this.isHost) {
      this.btn(LEFT, y, 'Start', () => this.session.send({ t: 'start' }), 200);
      // The saved game carries on with the same mode and the same number of players
      const cp = this.saved;
      if (cp && cp.mode === this.mode && cp.players === this.players.length) {
        this.btn(LEFT + 220, y, `Continue ${stageName(cp.difficulty, cp.act)}`, () => this.session.send({ t: 'start', resume: JSON.stringify(cp) }), 340);
      } else if (cp) {
        text(`A saved ${MODE_TEXT[cp.mode].name} game for ${cp.players} waits.`, MUTED, LEFT + 220).setY(y + 8);
      }
    } else {
      text('Waiting for the host to start.');
    }
    return y + 60;
  }

  /** Eternal Conflict and Co-op: the team size (the host's to set), the game setup as the host brought it, your race and, in a conflict, your team. */
  private drawBattleChoices(y: number): number {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const mine = this.players.find((p) => p.slot === this.me);
    add(this.add.text(LEFT, y, 'Players a team', GOLD).setDepth(3101));
    y += 28;
    if (this.isHost) {
      for (let n = 1; n <= 4; n++) this.btn(LEFT + (n - 1) * 70, y, `${n}`, () => this.session.send({ t: 'battle', teamSize: n }), 62, n === this.teamSize);
      y += 44;
    } else {
      add(this.add.text(LEFT, y, `${this.teamSize}`, TEXT).setDepth(3101));
      y += 30;
    }
    // The game setup, as the host set it on the Eternal Conflict page
    const o = this.options;
    const flags = [o.pick === 'random' ? 'random races' : 'all pick', `X${o.sends} sends`, o.mirror ? 'mirror mode' : '', o.easy ? 'easy mode' : '', o.long ? 'long game (waves 22 to 30)' : '', !o.champions ? 'no champions' : ''].filter(Boolean);
    const setup = add(this.add.text(LEFT, y, `Game setup: ${flags.join(', ')}${this.isHost ? ' (set on the Eternal Conflict page before hosting)' : ''}`, MUTED).setDepth(3101));
    y += setup.height + 12;
    const race = mine?.race ?? 'random';
    const all = ['random', ...RACES];
    this.btn(LEFT, y, `Your race: ${raceName(race)}`, () => this.session.send({ t: 'battle', race: all[(all.indexOf(race) + 1) % all.length]! }), 300);
    if (this.mode === 'battle') {
      const team = mine?.team ?? 0;
      this.btn(LEFT + 320, y, `Your team: ${team === 0 ? 'West, Harrogath' : 'East, the Fortress'}`, () => this.session.send({ t: 'battle', team: 1 - team }), 300);
    }
    return y + 60;
  }

  private drawCodes(y: number): number {
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const codes = [...(typeof this.upnp === 'object' && this.upnp.state === 'ok' ? [this.upnp.code] : []), ...this.codes];
    add(this.add.text(LEFT, y, 'Give your friends a code:', GOLD).setDepth(3101));
    y += 28;
    for (const c of codes) {
      add(this.add.text(LEFT, y + 6, c.label, { ...MUTED, color: '#c8c0a0' }).setDepth(3101));
      add(this.add.text(LEFT + 190, y, c.code, { ...TEXT, fontSize: '28px' }).setDepth(3101));
      this.btn(LEFT + 560, y, 'Copy', () => void navigator.clipboard?.writeText(c.code), 110);
      y += 42;
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
    const t = add(this.add.text(LEFT, y + 4, upnpText, MUTED).setDepth(3101));
    return y + t.height + 24;
  }
}

/** A race's name for the lobby. */
function raceName(race: string): string {
  return race === 'random' ? 'Random' : race.charAt(0).toUpperCase() + race.slice(1);
}
