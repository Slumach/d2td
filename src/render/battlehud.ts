// Battle Mode's HUD (src/sim/battle.ts): both kings' life across the top, the shared phase
// and its timer under them, and a panel down the left with this player's race, gold and
// Souls, the worker button, the king's upgrades and the send panel. Reads the match; every
// button only issues a command.

import Phaser from 'phaser';

import { kingRegen, kingUpgradeCost, sendCost, sendDef, sendOpen, workerCost, type SendJson } from '../sim/battle.ts';
import { TICKS_PER_SECOND } from '../sim/fixed.ts';
import { enemyOf, joiningWave, ringOf, seatOf, slotOf, teamOf, type Match } from '../sim/match.ts';
import type { Command, KingUpgrade } from '../sim/state.ts';
import { button, FONT, type ButtonSpec, type Tooltip } from './ui.ts';

export interface BattleHudHost {
  match(): Match;
  me(): number;
  nameOf(slot: number): string;
  issue(command: Command): void;
  /** A monster's name for the send panel. */
  monsterName(id: string): string;
  tooltip: Tooltip;
}

/** The two sides' keeps, by team: Harrogath under siege, the Pandemonium Fortress. */
export const KEEP_NAMES = ['Harrogath', 'Pandemonium Fortress'];

const PANEL = { x: 10, y: 84, width: 300 };
const BAR = { width: 380, height: 18, y: 8 };
const TEAM_COLOURS = [0xc8a040, 0xc84a3a];
const UPGRADE_TEXT: Record<KingUpgrade, (add: number) => string> = {
  hp: (add) => `Worldstone +${add} life`,
  regen: (add) => `Worldstone +${add} life a wave`,
  tyrael: (add) => `Tyrael +${add}% a strike`,
};

export class BattleHud {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly kingText: Phaser.GameObjects.Text[];
  private readonly phase: Phaser.GameObjects.Text;
  private readonly lines: Phaser.GameObjects.Text;
  private parts: Phaser.GameObjects.GameObject[] = [];
  private key = '';
  private height = 0;
  /** The enemy lane the send panel aims at. */
  private lane = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: BattleHudHost,
  ) {
    this.gfx = scene.add.graphics().setDepth(3100);
    const text = { fontFamily: FONT, fontSize: '15px', color: '#f0e6d0' };
    this.kingText = [0, 1].map(() => scene.add.text(0, 0, '', text).setOrigin(0.5).setDepth(3101).setShadow(1, 1, '#000000', 2));
    this.phase = scene.add.text(1440 / 2, BAR.y + BAR.height + 16, '', { ...text, fontSize: '17px', color: '#e0d0a0' }).setOrigin(0.5).setDepth(3101).setShadow(1, 1, '#000000', 2);
    this.lines = scene.add.text(PANEL.x + 10, PANEL.y + 8, '', { ...text, fontSize: '15px', lineSpacing: 3, wordWrap: { width: PANEL.width - 20 } }).setDepth(3101);
  }

  /** True over the panel, so a click there never builds on the map beneath. */
  covers(x: number, y: number): boolean {
    return x >= PANEL.x && x < PANEL.x + PANEL.width && y >= PANEL.y && y < PANEL.y + this.height;
  }

  destroy(): void {
    for (const o of [...this.parts, this.gfx, ...this.kingText, this.phase, this.lines]) o.destroy();
    this.parts = [];
  }

  update(): void {
    const match = this.host.match();
    const b = match.state.battle;
    if (!b) return;
    const me = this.host.me();
    this.drawKings(match, me);
    this.phase.setText(this.phaseText(match));
    this.drawPanel(match, me);
  }

  private drawKings(match: Match, me: number): void {
    const g = this.gfx.clear();
    const mine = teamOf(match, me);
    match.zones.forEach((zone, t) => {
      const k = zone.state.battle!.king;
      // Your king on the left, the enemy's on the right
      const side = match.zones.length === 1 ? 0.5 : t === mine ? 0 : 1;
      const x = match.zones.length === 1 ? 1440 / 2 - BAR.width / 2 : side === 0 ? 1440 / 2 - BAR.width - 30 : 1440 / 2 + 30;
      const frac = Math.max(0, Math.min(1, k.hp / k.maxHp));
      g.fillStyle(0x000000, 0.65).fillRect(x - 2, BAR.y - 2, BAR.width + 4, BAR.height + 4);
      g.fillStyle(0x401010).fillRect(x, BAR.y, BAR.width, BAR.height);
      g.fillStyle(TEAM_COLOURS[t] ?? 0xc8a040).fillRect(x, BAR.y, Math.round(BAR.width * frac), BAR.height);
      const who = match.zones.length === 1 ? 'Your Worldstone' : t === mine ? 'Your Worldstone' : 'Enemy Worldstone';
      this.kingText[t]!.setPosition(x + BAR.width / 2, BAR.y + BAR.height / 2).setText(`${who} (${KEEP_NAMES[t]}): ${Math.max(0, k.hp)} / ${k.maxHp}`);
    });
    if (match.zones.length === 1) this.kingText[1]!.setText('');
  }

  private phaseText(match: Match): string {
    const b = match.state.battle!;
    const count = match.data.battle!.waves.length;
    if (match.state.status === 'over') return 'The battle is over';
    if (b.phase === 'build') {
      const secs = Math.max(0, Math.ceil((b.phaseTick - match.state.tick) / TICKS_PER_SECOND));
      const next = match.data.battle!.waves[b.wave];
      return `Build: ${secs} s to wave ${b.wave + 1} of ${count}${next ? `, ${this.waveName(match, b.wave)}` : ''}`;
    }
    return `Wave ${b.wave} of ${count}: ${this.waveName(match, b.wave - 1)}`;
  }

  private waveName(match: Match, index: number): string {
    const w = match.data.battle!.waves[index];
    const lead = w?.groups.at(-1)?.monster;
    return lead ? `${this.host.monsterName(lead)}${w!.kind === 'boss' ? ' (act boss)' : ''}` : '';
  }

  private drawPanel(match: Match, me: number): void {
    const b = match.state.battle!;
    const sim = match.zones[ringOf(match, me)]!;
    const seat = seatOf(match, me);
    const bs = sim.state.battle!;
    const rules = match.data.battle!.rules;
    const gold = sim.state.gold[seat] ?? 0;
    const souls = bs.souls[seat] ?? 0;
    const join = joiningWave(match);
    const enemy = match.state.mode === 'battle' ? match.zones[enemyOf(match, me)]! : undefined;
    const lanes = enemy?.map.arcs.length ?? 0;
    if (this.lane < 0 || this.lane >= lanes) this.lane = Math.min(seat, Math.max(0, lanes - 1));
    const key = JSON.stringify([gold, souls, bs.workers[seat], b.phase, b.wave, b.made[me], bs.king, this.lane, match.state.status]);
    if (key === this.key) return;
    this.key = key;
    for (const o of this.parts) o.destroy();
    this.parts = [];

    const race = match.data.classes[bs.races[seat]!]?.name ?? bs.races[seat];
    const base = rules.income[Math.max(0, b.phase === 'build' ? b.wave : b.wave - 1)] ?? 0;
    const lines = [
      `${race}`,
      `Gold ${gold}, +${base + (bs.income[seat] ?? 0)} a wave`,
      `Souls ${souls}, +${(bs.workers[seat] ?? 0) * rules.worker.soulsPerWave} a wave`,
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
      tooltip: { title: 'Worker', body: `A hireling in your back row. Brings ${rules.worker.soulsPerWave} Souls at the end of every wave.\nSouls buy sends.` },
    });
    y += 6;
    for (const u of ['hp', 'regen', 'tyrael'] as KingUpgrade[]) {
      const cost = kingUpgradeCost(sim, u);
      const upg = rules.king.upgrades[u];
      add({
        label: cost === undefined ? `${UPGRADE_TEXT[u](upg.add)}: done` : `${UPGRADE_TEXT[u](upg.add)}: ${cost}`,
        enabled: cost !== undefined && gold >= cost && match.state.status !== 'over',
        onClick: () => this.host.issue({ type: 'king', upgrade: u }),
        tooltip: { title: 'The team\'s king', body: `Gold into the Worldstone and Tyrael, shared by the team.\nLife back a wave now: ${kingRegen(sim)}.` },
      });
    }
    if (enemy) {
      y += 8;
      const owner = slotOf(match, enemyOf(match, me), enemy.arcOwners[this.lane] ?? 0);
      const head = this.scene.add.text(PANEL.x + 10, y, `Sends, onto ${this.host.nameOf(owner)}'s lane:`, { fontFamily: FONT, fontSize: '15px', color: '#c7b377' }).setDepth(3101);
      this.parts.push(head);
      y += 22;
      if (lanes > 1) {
        add({ label: `Lane ${this.lane + 1} of ${lanes}: next lane`, onClick: () => ((this.lane = (this.lane + 1) % lanes), (this.key = '')) });
      }
      const open = rules.sends.filter((s) => sendOpen(s, join, b.made[me] ?? []) && join < match.data.battle!.waves.length);
      // Two columns of short buttons
      const half = (PANEL.width - 30) / 2;
      open.forEach((s, i) => {
        const cost = sendCost(s, join);
        const x = PANEL.x + 10 + (i % 2) * (half + 10);
        const parts = button(
          this.scene,
          x,
          y,
          {
            label: `${this.sendName(match, s)} ${cost}`,
            width: half,
            enabled: souls >= cost && match.state.status !== 'over',
            onClick: () => this.host.issue({ type: 'send', send: s.id, lane: this.lane }),
            tooltip: { title: this.sendName(match, s), body: this.sendBody(match, s, cost) },
          },
          this.host.tooltip,
        );
        for (const p of parts) (p as Phaser.GameObjects.Text).setFontSize?.(13);
        this.parts.push(...parts);
        if (i % 2 === 1 || i === open.length - 1) y += 28;
      });
    } else {
      const coming = rules.coop.sends[b.phase === 'build' ? b.wave : b.wave] ?? [];
      const names = coming.map((id) => sendDef(match.data, id)).flatMap((s) => (s ? [this.sendName(match, s)] : []));
      const t = this.scene.add.text(PANEL.x + 10, y + 8, names.length ? `With the next wave: ${names.join(', ')}` : 'No sends with the next wave', { fontFamily: FONT, fontSize: '15px', color: '#c7b377', wordWrap: { width: PANEL.width - 20 } }).setDepth(3101);
      this.parts.push(t);
      y += 30 + t.height;
    }
    this.height = y - PANEL.y + 8;
    const g = this.scene.add.graphics().setDepth(3099);
    g.fillStyle(0x000000, 0.62).fillRect(PANEL.x, PANEL.y, PANEL.width, this.height);
    g.lineStyle(1, 0x6a5a3a, 0.9).strokeRect(PANEL.x, PANEL.y, PANEL.width, this.height);
    this.parts.push(g);
  }

  private sendName(match: Match, s: SendJson): string {
    return s.name ?? this.host.monsterName(match.data.monsterVariant([s.monster].flat()[0]!, 0));
  }

  private sendBody(match: Match, s: SendJson, cost: number): string {
    const what = s.kind === 'champions' ? `${s.count ?? 3} champions` : s.kind === 'boss' ? 'An act boss, once a match' : 'A superunique and its pack';
    const income = cost * match.data.battle!.rules.sendIncomePerSoul;
    return `${what}, joining the enemy lane's next wave.\n${cost} Souls; your gold income rises ${income} a wave for good.`;
  }
}
