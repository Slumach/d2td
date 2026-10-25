// Eternal Conflict's HUD (src/sim/battle.ts), laid out as Legion's in D2's panels: the wave
// countdown top centre (or who is still fighting), the scoreboard on the right (every
// player's value, income, shards and bounty, then West and East alive and the kings' life),
// a panel down the left with this player's race, gold and shards, the worker and the king's
// upgrades, and the send panel over the belt: every open send as its monster's icon with its
// shard cost. Reads the match; every button only issues a command.

import Phaser from 'phaser';

import { fightOver, kingLevel, kingUpgradeCost, sendCost, sendDef, sendOpen, shardsPerTick, towerValue, wholeShards, workerCost, type SendJson } from '../sim/battle.ts';
import { TICKS_PER_SECOND } from '../sim/fixed.ts';
import { enemyOf, joiningWave, ringOf, seatOf, slotOf, teamOf, type Match } from '../sim/match.ts';
import { KING_UPGRADES, type Command, type KingUpgrade } from '../sim/state.ts';
import { monsterKey } from './assets.ts';
import { GAME_WIDTH } from './layout.ts';
import { button, FONT, type ButtonSpec, type Tooltip } from './ui.ts';

export interface BattleHudHost {
  match(): Match;
  me(): number;
  nameOf(slot: number): string;
  colourOf(slot: number): number;
  issue(command: Command): void;
  /** A monster's name for the send panel. */
  monsterName(id: string): string;
  tooltip: Tooltip;
  /** The D2 panel's top edge, and its slot frame sheet, when the panel art is there. */
  barTop?: number;
  slotTexture?: string;
}

/** The two sides' keeps, by team: Harrogath under siege, the Pandemonium Fortress. */
export const KEEP_NAMES = ['Harrogath', 'Pandemonium Fortress'];
/** The two kings, by team: Tyrael holds Harrogath, Baal the Fortress. */
export const KING_NAMES = ['Tyrael', 'Baal'];
/** Legion's names for the two sides. */
export const SIDE_NAMES = ['West', 'East'];

const PANEL = { x: 10, y: 84, width: 300 };
const BOARD = { x: GAME_WIDTH - 404, y: 84, width: 392, row: 24 };
const TIMER = { width: 340, height: 40, y: 8 };
const TRAY = { x: 880, columns: 9, pitch: 56, size: 50 };
const MOD_NAMES: Record<string, string> = {
  extraFast: 'Extra Fast',
  extraStrong: 'Extra Strong',
  stoneSkin: 'Stone Skin',
  magicResistant: 'Magic Resistant',
  magicImmune: 'Magic Immune',
  poisonResistant: 'Poison Resistant',
  poisonImmune: 'Poison Immune',
  physicalImmune: 'Physical Immune',
  fireEnchanted: 'Fire Enchanted',
  coldEnchanted: 'Cold Enchanted',
  lightningEnchanted: 'Lightning Enchanted',
  cursed: 'Cursed',
  spectralHit: 'Spectral Hit',
  manaBurn: 'Mana Burn',
  teleportation: 'Teleportation',
  auraEnchanted: 'Aura Enchanted',
};
const BRONZE = 0x8c7448;
const GOLD = '#c7b377';
const UPGRADE_TEXT: Record<KingUpgrade, (add: number) => string> = {
  hp: (add) => `Life +${add}`,
  regen: (add) => `Regen +${add} a second`,
  attack: (add) => `Attack +${add}%`,
};

export class BattleHud {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly timer: Phaser.GameObjects.Text;
  private readonly timerSub: Phaser.GameObjects.Text;
  private readonly lines: Phaser.GameObjects.Text;
  private boardTexts: Phaser.GameObjects.Text[] = [];
  private parts: Phaser.GameObjects.GameObject[] = [];
  private trayParts: Phaser.GameObjects.GameObject[] = [];
  private key = '';
  private trayKey = '';
  private height = 0;
  /** The enemy lane the send panel aims at. */
  private lane = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: BattleHudHost,
  ) {
    this.gfx = scene.add.graphics().setDepth(3100);
    const text = { fontFamily: FONT, fontSize: '15px', color: '#f0e6d0' };
    this.timer = scene.add.text(GAME_WIDTH / 2, TIMER.y + 12, '', { ...text, fontSize: '19px', color: '#e8d8a8' }).setOrigin(0.5, 0).setDepth(3101).setShadow(1, 1, '#000000', 2);
    this.timerSub = scene.add.text(GAME_WIDTH / 2, TIMER.y + TIMER.height + 6, '', { ...text, fontSize: '13px', color: '#c8bc98' }).setOrigin(0.5, 0).setDepth(3101).setShadow(1, 1, '#000000', 2);
    this.lines = scene.add.text(PANEL.x + 10, PANEL.y + 8, '', { ...text, fontSize: '15px', lineSpacing: 3, wordWrap: { width: PANEL.width - 20 } }).setDepth(3101);
  }

  /** Where the scoreboard panel ends, so the minimap can sit under it. */
  static panelBottom(players: number): number {
    return BOARD.y + 58 + players * BOARD.row + 96;
  }

  /** True over a panel or the send tray, so a click there never builds on the map beneath. */
  covers(x: number, y: number): boolean {
    if (x >= PANEL.x && x < PANEL.x + PANEL.width && y >= PANEL.y && y < PANEL.y + this.height) return true;
    const board = BattleHud.panelBottom(this.host.match().players);
    if (x >= BOARD.x && x < BOARD.x + BOARD.width && y >= BOARD.y && y < board) return true;
    if (Math.abs(x - GAME_WIDTH / 2) <= TIMER.width / 2 && y >= TIMER.y && y < TIMER.y + TIMER.height) return true;
    return false;
  }

  destroy(): void {
    for (const o of [...this.parts, ...this.trayParts, ...this.boardTexts, this.gfx, this.timer, this.timerSub, this.lines]) o.destroy();
    this.parts = [];
    this.trayParts = [];
    this.boardTexts = [];
  }

  update(): void {
    const match = this.host.match();
    const b = match.state.battle;
    if (!b) return;
    const me = this.host.me();
    this.gfx.clear();
    this.drawTimer(match, me);
    this.drawBoard(match, me);
    this.drawPanel(match, me);
    this.drawTray(match, me);
  }

  /** Top centre: the countdown while it runs, else the wave and who is still fighting. */
  private drawTimer(match: Match, me: number): void {
    const b = match.state.battle!;
    const g = this.gfx;
    const x = GAME_WIDTH / 2 - TIMER.width / 2;
    g.fillStyle(0x000000, 0.75).fillRect(x, TIMER.y, TIMER.width, TIMER.height);
    g.lineStyle(2, BRONZE, 1).strokeRect(x, TIMER.y, TIMER.width, TIMER.height);
    const count = match.zones[0]!.data.waves.length;
    if (match.state.status === 'over') {
      this.timer.setText('The conflict is over');
      this.timerSub.setText('');
      return;
    }
    if (b.phase === 'build') {
      const secs = Math.max(0, Math.ceil((b.phaseTick - match.state.tick) / TICKS_PER_SECOND));
      const mm = Math.floor(secs / 60);
      const ss = secs % 60;
      this.timer.setText(`Wave ${b.wave + 1} of ${count} in ${mm}:${String(ss).padStart(2, '0')}`);
      this.timerSub.setText(this.waveName(match, b.wave));
      return;
    }
    // Fighting: the side that is clear waits on the other
    const mine = teamOf(match, me);
    const clear = match.zones.map(fightOver);
    const waiting = match.zones.length > 1 && clear[mine] && !clear[1 - mine] ? `Waiting on ${SIDE_NAMES[1 - mine]}` : match.zones.length > 1 && !clear[mine] && clear[1 - mine] ? `${SIDE_NAMES[1 - mine]} waits on you` : '';
    this.timer.setText(`Wave ${b.wave} of ${count}${waiting ? `   ${waiting}` : ''}`);
    this.timerSub.setText(this.waveName(match, b.wave - 1));
  }

  private waveName(match: Match, index: number): string {
    const w = match.zones[0]!.data.waves[index];
    const lead = w?.groups.at(-1)?.monster;
    return lead ? `${this.host.monsterName(lead)}${w!.kind === 'boss' ? ' (act boss)' : ''}` : '';
  }

  /** The scoreboard on the right: a row per player, then West and East alive and the kings. */
  private drawBoard(match: Match, me: number): void {
    const b = match.state.battle!;
    const g = this.gfx;
    const rows = match.players;
    const height = BattleHud.panelBottom(rows) - BOARD.y;
    g.fillStyle(0x000000, 0.78).fillRect(BOARD.x, BOARD.y, BOARD.width, height);
    g.lineStyle(2, BRONZE, 1).strokeRect(BOARD.x, BOARD.y, BOARD.width, height);
    g.lineStyle(1, BRONZE, 0.6).lineBetween(BOARD.x + 8, BOARD.y + 50, BOARD.x + BOARD.width - 8, BOARD.y + 50);
    const alivesTop = BOARD.y + 58 + rows * BOARD.row + 8;
    g.lineStyle(1, BRONZE, 0.6).lineBetween(BOARD.x + 8, alivesTop - 4, BOARD.x + BOARD.width - 8, alivesTop - 4);
    const need = 2 + rows * 5 + 6;
    if (this.boardTexts.length !== need) {
      for (const t of this.boardTexts) t.destroy();
      this.boardTexts = [];
      const add = (x: number, y: number, size: number, colour: string, align: 'left' | 'right') => {
        const t = this.scene.add.text(x, y, '', { fontFamily: FONT, fontSize: `${size}px`, color: colour }).setOrigin(align === 'left' ? 0 : 1, 0).setDepth(3101).setShadow(1, 1, '#000000', 2);
        this.boardTexts.push(t);
        return t;
      };
      add(BOARD.x + 12, BOARD.y + 8, 16, GOLD, 'left');
      add(BOARD.x + 12, BOARD.y + 30, 13, GOLD, 'left');
      const cols: [number, 'left' | 'right'][] = [[12, 'left'], [185, 'right'], [250, 'right'], [315, 'right'], [380, 'right']];
      for (let r = 0; r < rows; r++) for (const [cx, align] of cols) add(BOARD.x + cx, BOARD.y + 56 + r * BOARD.row, 15, '#e8e0c8', align);
      for (let k = 0; k < 3; k++) {
        add(BOARD.x + 14, alivesTop + k * 24, 16, '#e8e0c8', 'left');
        add(BOARD.x + BOARD.width - 14, alivesTop + k * 24, 16, '#e8e0c8', 'right');
      }
    }
    const t = this.boardTexts;
    const o = b.options;
    const n = b.teamSize;
    const mode = match.state.mode === 'coop' ? `co-op, ${n} ${n === 1 ? 'player' : 'players'}` : `${n}v${n}`;
    const flags = [o.sends > 1 ? `X${o.sends} sends` : '', o.mirror ? 'mirror' : '', o.easy ? 'easy' : '', o.long ? 'long game' : '', !o.champions ? 'no champions' : '', o.pick === 'random' ? 'random towers' : ''].filter(Boolean);
    t[0]!.setText(`Eternal Conflict: ${mode}${flags.length ? `  (${flags.join(', ')})` : ''}`);
    const heads = ['Player', 'Value', 'Income', 'Shards', 'Bounty'];
    let i = 2;
    const base = match.data.battle!.rules.income;
    for (let p = 0; p < rows; p++) {
      const sim = match.zones[ringOf(match, p)]!;
      const seat = seatOf(match, p);
      const bs = sim.state.battle!;
      const income = (base[Math.max(0, b.phase === 'build' ? b.wave : b.wave - 1)] ?? base.at(-1) ?? 0) + (bs.income[seat] ?? 0);
      const colour = `#${this.host.colourOf(p).toString(16).padStart(6, '0')}`;
      const cells = [this.host.nameOf(p) + (p === me ? ' (you)' : ''), String(towerValue(sim, seat)), String(income), String(wholeShards(bs.shards[seat] ?? 0)), String(bs.bounty[seat] ?? 0)];
      cells.forEach((c, k) => t[i + k]!.setText(c).setColor(k === 0 ? colour : '#e8e0c8'));
      i += 5;
    }
    // Column headings over the cells they head
    const headY = BOARD.y + 32;
    const headCols = [12, 185, 250, 315, 380];
    if (!this.headTexts.length) {
      heads.forEach((h, k) => {
        this.headTexts.push(this.scene.add.text(BOARD.x + headCols[k]!, headY, h, { fontFamily: FONT, fontSize: '13px', color: GOLD }).setOrigin(k === 0 ? 0 : 1, 0).setDepth(3101).setShadow(1, 1, '#000000', 2));
      });
    }
    const alive = match.zones.map((z) => z.state.monsters.filter((m) => m.hp > 0).length);
    const kings = match.zones.map((z) => z.state.battle!.king);
    const labels = [[`${SIDE_NAMES[0]} alive`, String(alive[0] ?? 0), '#d06048'], [`${SIDE_NAMES[1]} alive`, match.zones.length > 1 ? String(alive[1] ?? 0) : '', '#60b060'], [`King's life`, match.zones.map((_, k) => `${KING_NAMES[k]} ${Math.max(0, kings[k]!.hp)}`).join('   '), '#b8d8ff']];
    labels.forEach(([label, value, colour], k) => {
      t[i + k * 2]!.setText(label ?? '').setColor(colour ?? '#e8e0c8');
      t[i + k * 2 + 1]!.setText(value ?? '').setColor(colour ?? '#e8e0c8');
    });
  }

  private headTexts: Phaser.GameObjects.Text[] = [];

  /** The left panel: your race, gold, shards, the worker, the king's upgrades and the send's lane. */
  private drawPanel(match: Match, me: number): void {
    const b = match.state.battle!;
    const sim = match.zones[ringOf(match, me)]!;
    const seat = seatOf(match, me);
    const bs = sim.state.battle!;
    const rules = match.data.battle!.rules;
    const gold = sim.state.gold[seat] ?? 0;
    const shards = bs.shards[seat] ?? 0;
    const roll = bs.randomRolls?.[seat];
    const enemy = match.state.mode === 'battle' ? match.zones[enemyOf(match, me)]! : undefined;
    const lanes = enemy?.map.arcs.length ?? 0;
    if (this.lane < 0 || this.lane >= lanes) this.lane = Math.min(seat, Math.max(0, lanes - 1));
    const key = JSON.stringify([gold, wholeShards(shards), Math.floor(shards / 100), bs.workers[seat], b.phase, b.wave, bs.king, this.lane, match.state.status, roll]);
    if (key === this.key) return;
    this.key = key;
    for (const o of this.parts) o.destroy();
    this.parts = [];

    const race = roll ? 'Random towers' : (match.data.classes[bs.races[seat]!]?.name ?? bs.races[seat]);
    const base = rules.income[Math.max(0, b.phase === 'build' ? b.wave : b.wave - 1)] ?? rules.income.at(-1) ?? 0;
    const rate = (shardsPerTick(sim, seat) * TICKS_PER_SECOND) / 1000;
    const lineName = (k: string) => {
      const [cls, line] = k.split('/') as [string, string];
      const c = match.data.classes[cls];
      return `${c?.name ?? cls} ${c?.lines[line]?.name ?? line}`;
    };
    const lines = [
      `${race}, ${KEEP_NAMES[teamOf(match, me)]}`,
      ...(roll ? [`This wave's roll: ${roll.map(lineName).join(', ')}`] : []),
      `Gold ${gold}, +${base + (bs.income[seat] ?? 0)} a wave`,
      `Shards ${wholeShards(shards)}.${Math.floor((shards % 1000) / 100)}, +${rate.toFixed(1)} a second`,
      `Workers ${bs.workers[seat]} of ${rules.worker.max}`,
    ];
    this.lines.setText(lines.join('\n'));
    let y = PANEL.y + 8 + this.lines.height + 8;
    const add = (spec: ButtonSpec, x = PANEL.x + 10) => {
      const parts = button(this.scene, x, y, { ...spec, width: spec.width ?? PANEL.width - 20 }, this.host.tooltip);
      for (const p of parts) (p as Phaser.GameObjects.Text).setFontSize?.(15);
      this.parts.push(...parts);
      y += 30;
    };
    const wc = workerCost(sim, seat);
    add({
      label: `Hire a worker: ${wc} gold`,
      enabled: gold >= wc && (bs.workers[seat] ?? 0) < rules.worker.max && match.state.status !== 'over',
      onClick: () => this.host.issue({ type: 'hire' }),
      tooltip: { title: 'Worker', body: `A hireling in your back row, mining ${(rules.worker.shardsPerSecond / 1000).toFixed(1)} Worldstone shards a second.\nShards buy sends.` },
    });
    y += 6;
    const king = KING_NAMES[teamOf(match, me)] ?? 'The king';
    for (const u of KING_UPGRADES) {
      const cost = kingUpgradeCost(sim, u);
      const upg = rules.king.upgrades[u];
      add({
        label: `${king}: ${UPGRADE_TEXT[u](upg.add)} (${kingLevel(bs, u)}/${upg.maxLevel})${cost === undefined ? '' : `: ${cost}`}`,
        enabled: cost !== undefined && gold >= cost && match.state.status !== 'over',
        onClick: () => this.host.issue({ type: 'king', upgrade: u }),
        tooltip: { title: `${king}'s ${u === 'hp' ? 'life' : u === 'regen' ? 'regeneration' : 'attack'}`, body: `Gold into the team's king, shared by the team.\nClick him on the map for his panel.` },
      });
    }
    if (enemy && lanes > 1) {
      y += 6;
      const owner = slotOf(match, enemyOf(match, me), enemy.arcOwners[this.lane] ?? 0);
      add({ label: `Send to: ${this.host.nameOf(owner)} (lane ${this.lane + 1} of ${lanes})`, tooltip: { title: 'The lane your sends walk', body: 'Click to aim at the next enemy lane.' }, onClick: () => ((this.lane = (this.lane + 1) % lanes), (this.key = ''), (this.trayKey = '')) });
    } else if (!enemy) {
      const coming = rules.coop.sends[b.phase === 'build' ? b.wave : b.wave] ?? [];
      const names = coming.map((id) => sendDef(match.data, id)).flatMap((s) => (s ? [this.sendName(match, s)] : []));
      const t = this.scene.add.text(PANEL.x + 10, y + 8, names.length ? `With the next wave: ${names.join(', ')}` : 'No sends with the next wave', { fontFamily: FONT, fontSize: '15px', color: GOLD, wordWrap: { width: PANEL.width - 20 } }).setDepth(3101);
      this.parts.push(t);
      y += 30 + t.height;
    }
    this.height = y - PANEL.y + 8;
    const g = this.scene.add.graphics().setDepth(3099);
    g.fillStyle(0x000000, 0.72).fillRect(PANEL.x, PANEL.y, PANEL.width, this.height);
    g.lineStyle(2, BRONZE, 1).strokeRect(PANEL.x, PANEL.y, PANEL.width, this.height);
    this.parts.push(g);
  }

  /** The send tray over the belt: every open send as its monster, its shard cost on it; grey until the shards are there. */
  private drawTray(match: Match, me: number): void {
    const b = match.state.battle!;
    if (match.state.mode !== 'battle' || this.host.barTop === undefined) return;
    const sim = match.zones[ringOf(match, me)]!;
    const seat = seatOf(match, me);
    const shards = wholeShards(sim.state.battle!.shards[seat] ?? 0);
    const join = joiningWave(match);
    const rules = match.data.battle!.rules;
    const open = rules.sends.filter((s) => sendOpen(s, join, b.made[me] ?? []) && join < sim.data.waves.length);
    const key = JSON.stringify([shards, join, open.map((s) => s.id), match.state.status, this.lane]);
    if (key === this.trayKey) return;
    this.trayKey = key;
    for (const o of this.trayParts) o.destroy();
    this.trayParts = [];
    const top = this.host.barTop + 4;
    open.forEach((s, i) => {
      const col = i % TRAY.columns;
      const row = Math.floor(i / TRAY.columns);
      const x = TRAY.x + col * TRAY.pitch + TRAY.size / 2;
      const y = top + row * TRAY.pitch + TRAY.size / 2;
      const cost = sendCost(s, join);
      const enabled = shards >= cost && match.state.status !== 'over';
      const back = this.scene.add.rectangle(x, y, TRAY.size, TRAY.size, 0x000000, 0.7).setDepth(3100).setStrokeStyle(1, BRONZE, 0.9);
      const icon = this.sendIcon(match, s, x, y);
      if (icon) icon.setDepth(3101).setAlpha(enabled ? 1 : 0.45);
      const price = this.scene.add.text(x + TRAY.size / 2 - 3, y + TRAY.size / 2 - 2, String(cost), { fontFamily: FONT, fontSize: '12px', color: enabled ? '#b8d8ff' : '#808080' }).setOrigin(1, 1).setDepth(3102).setShadow(1, 1, '#000000', 2);
      const frame = this.host.slotTexture && this.scene.textures.exists(this.host.slotTexture) ? this.scene.add.image(x, y, this.host.slotTexture, 1).setDisplaySize(TRAY.size + 6, TRAY.size + 6).setDepth(3103).setVisible(false) : undefined;
      back.setInteractive({ useHandCursor: enabled });
      back.on('pointerover', () => {
        frame?.setVisible(true);
        this.host.tooltip.move(x - 110, y - TRAY.size / 2 - 8);
        this.host.tooltip.show(this.sendName(match, s), this.sendBody(match, s, cost));
      });
      back.on('pointerout', () => {
        frame?.setVisible(false);
        this.host.tooltip.hide();
      });
      back.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        if (!enabled) return;
        this.host.tooltip.hide();
        this.host.issue({ type: 'send', send: s.id, lane: this.lane });
      });
      this.trayParts.push(back, price, ...(icon ? [icon] : []), ...(frame ? [frame] : []));
    });
  }

  /** A send's monster as D2 draws it standing, fitted into its slot. */
  private sendIcon(match: Match, s: SendJson, x: number, y: number): Phaser.GameObjects.Image | undefined {
    const data = match.data;
    const first = [s.monster].flat()[0]!;
    const def = data.monsters[data.monsterVariant(first, 0)];
    if (!def) return undefined;
    const keys = [monsterKey(def.base, 'unique', def.artVariant), monsterKey(def.base, 'unique'), monsterKey(def.base, 'normal')];
    for (const key of keys) {
      if (!this.scene.textures.exists(key)) continue;
      const tex = this.scene.textures.get(key);
      const frame = ['NU_s_00', 'WL_s_00', 'A1_s_00'].find((f) => tex.has(f));
      if (!frame) continue;
      // The atlas frame is trimmed inside a big box with the feet at its origin: centre the figure itself in the slot
      const f = tex.get(frame);
      const ss = (f.customData as { spriteSourceSize?: { x: number; y: number; w: number; h: number } }).spriteSourceSize ?? { x: 0, y: 0, w: f.width, h: f.height };
      const img = this.scene.add.image(x, y, key, frame).setOrigin((ss.x + ss.w / 2) / Math.max(1, f.realWidth), (ss.y + ss.h / 2) / Math.max(1, f.realHeight));
      img.setScale(Math.min(1.2, (TRAY.size - 6) / Math.max(1, ss.w, ss.h)));
      return img;
    }
    return undefined;
  }

  private sendName(match: Match, s: SendJson): string {
    return s.name ?? this.host.monsterName(match.data.monsterVariant([s.monster].flat()[0]!, 0));
  }

  private sendBody(match: Match, s: SendJson, cost: number): string {
    const b = match.state.battle!;
    const data = match.data;
    const times = b.options.sends > 1 ? `, ${b.options.sends} times over` : '';
    const named = [s.monster].flat();
    const defs = named.map((id) => data.monsters[data.monsterVariant(id, 0)]).flatMap((d) => (d ? [d] : []));
    const pack = defs.reduce((n, d) => n + (d.minion?.count ?? 0), 0);
    const what =
      s.kind === 'champions' ? `${s.count ?? 3} ${MOD_NAMES[s.mods?.[0] ?? ''] ?? ''} champions`.replace('  ', ' ')
      : s.kind === 'boss' ? 'An act boss, once a match'
      : named.length > 1 ? `${defs.map((d) => this.host.monsterName(d.id)).join(', ')}${pack ? ` and ${pack} of their own` : ''}`
      : pack ? `${this.host.monsterName(defs[0]?.id ?? named[0]!)} and ${pack} of its own` : this.host.monsterName(defs[0]?.id ?? named[0]!);
    const mods = [...new Set(defs.flatMap((d) => d.mods))].map((m) => MOD_NAMES[m] ?? m);
    const aura = s.aura ? this.auraLine(match, s.aura) : '';
    const income = cost * data.battle!.rules.sendIncomePerShard;
    return `${what}${times}, together, joining the enemy lane's next wave.${mods.length ? `\n${mods.join(', ')}.` : ''}${aura ? `\n${aura}` : ''}\n${cost} shards; your gold income rises ${income} a wave for good.`;
  }

  /** What a send's aura does, from the Paladin skill it borrows. */
  private auraLine(match: Match, aura: { skill: string; lvl: number }): string {
    const skill = match.data.skills[aura.skill];
    const name = skill?.name ?? aura.skill;
    if (skill?.archetype === 'buffAura') {
      const l = skill.levels[Math.min(aura.lvl, skill.levels.length - 1)]!;
      const parts = [...(l.damagePct ? [`+${l.damagePct}% damage`] : []), ...(l.attackSpeedPct ? [`+${l.attackSpeedPct}% attack speed`] : [])];
      return `${name} aura: every monster near it hits with ${parts.join(' and ')}.`;
    }
    if (skill?.archetype === 'control' && skill.mode === 'aura') {
      const l = skill.levels[Math.min(aura.lvl, skill.levels.length - 1)]!;
      return `${name} aura: fighters near it swing ${l.slowPct}% slower.`;
    }
    return `${name} aura.`;
  }
}
