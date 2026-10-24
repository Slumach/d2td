// The scoreboard on Tab, in the manner of D2's party panel: a dark sheet in a bronze frame,
// a row per player in their colour with kills, alive weight against the limit, gold, towers
// and wave. Solo, team and FFA alike; in Eternal Conflict each player's race, team, value,
// bounty, shards, leaks, sends and workers. Reads the match, writes nothing.

import Phaser from 'phaser';

import { aliveLimitOf } from '../sim/sim.ts';
import { towerValue, wholeShards } from '../sim/battle.ts';
import { ringOf, seatOf, teamOf, type Match } from '../sim/match.ts';
import { FONT } from './ui.ts';

export interface ScoreRow {
  name: string;
  colour: number;
  kills: number;
  alive: number;
  aliveLimit: number;
  gold: number;
  towers: number;
  wave: string;
  out: boolean;
  you: boolean;
}

/** Every player's row: on a team ring the alive weight and wave are the ring's, the rest their own. */
export function scoreRows(match: Match, me: number, nameOf: (slot: number) => string, colourOf: (slot: number) => number, waveLabel: (wave: number) => string): ScoreRow[] {
  return Array.from({ length: match.players }, (_, p) => {
    const sim = match.zones[ringOf(match, p)]!;
    const seat = seatOf(match, p);
    const s = sim.state;
    return {
      name: nameOf(p),
      colour: colourOf(p),
      kills: s.killsBy[seat] ?? 0,
      alive: s.alive,
      aliveLimit: aliveLimitOf(sim),
      gold: s.gold[seat] ?? 0,
      // A legend's two riders are part of it, not towers of their own
      towers: s.towers.filter((t) => t.owner === seat && t.legendOf === undefined).length,
      wave: waveLabel(s.wave),
      out: s.status === 'lost',
      you: p === me,
    };
  });
}

/** A battle's rows: every player in seat order, the columns BATTLE_COLUMNS name. */
export function battleRows(match: Match, me: number, nameOf: (slot: number) => string, colourOf: (slot: number) => number): TableRow[] {
  return Array.from({ length: match.players }, (_, p) => {
    const sim = match.zones[ringOf(match, p)]!;
    const seat = seatOf(match, p);
    const b = sim.state.battle!;
    const race = match.data.classes[b.races[seat]!]?.name ?? b.races[seat]!;
    return {
      name: nameOf(p),
      colour: colourOf(p),
      you: p === me,
      out: sim.state.status === 'lost',
      values: [race, String(teamOf(match, p) + 1), String(towerValue(sim, seat)), String(b.bounty[seat] ?? 0), String(wholeShards(b.shards[seat] ?? 0)), String(b.leaks[seat] ?? 0), String(b.sendsMade[seat] ?? 0), String(b.workers[seat] ?? 0)],
    };
  });
}

export interface TableRow {
  name: string;
  colour: number;
  you: boolean;
  out: boolean;
  /** The cells after the name, in the columns' order. */
  values: string[];
}

export const BATTLE_COLUMNS: { title: string; x: number; align: 'left' | 'right' }[] = [
  { title: 'Player', x: 24, align: 'left' },
  { title: 'Race', x: 280, align: 'left' },
  { title: 'Team', x: 440, align: 'right' },
  { title: 'Value', x: 540, align: 'right' },
  { title: 'Bounty', x: 640, align: 'right' },
  { title: 'Shards', x: 730, align: 'right' },
  { title: 'Leaks', x: 810, align: 'right' },
  { title: 'Sends', x: 885, align: 'right' },
  { title: 'Workers', x: 960, align: 'right' },
];

const BRONZE = 0x8c7448;
const GOLD = '#c7b377';
const WHITE = '#d8d4c8';
const GREY = '#7c786c';
const ROW = 34;
const COLUMNS: { title: string; x: number; align: 'left' | 'right' }[] = [
  { title: 'Player', x: 24, align: 'left' },
  { title: 'Kills', x: 330, align: 'right' },
  { title: 'Alive', x: 450, align: 'right' },
  { title: 'Gold', x: 580, align: 'right' },
  { title: 'Towers', x: 680, align: 'right' },
  { title: 'Wave', x: 720, align: 'left' },
];
const WIDTH = 980;

export class Scoreboard {
  private readonly parts: Phaser.GameObjects.GameObject[] = [];
  private readonly bg: Phaser.GameObjects.Graphics;
  private rows: Phaser.GameObjects.Text[][] = [];
  private shown = false;
  private columns = COLUMNS;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cx: number,
    private readonly top: number,
    private readonly depth: number,
  ) {
    this.bg = scene.add.graphics().setDepth(depth).setVisible(false);
  }

  get visible(): boolean {
    return this.shown;
  }

  toggle(): void {
    this.shown = !this.shown;
    this.bg.setVisible(this.shown);
    for (const p of this.parts) (p as Phaser.GameObjects.Text).setVisible(this.shown);
  }

  /** Redraws the rows; cheap enough every frame while shown. */
  update(rows: ScoreRow[], title: string): void {
    this.table(COLUMNS, rows.map((r) => ({ ...r, values: [String(r.kills), `${r.alive} / ${r.aliveLimit}`, String(r.gold), String(r.towers), r.wave] })), title);
  }

  /** Any table of player rows under these columns (the first is the name). */
  table(columns: typeof COLUMNS, rows: TableRow[], title: string): void {
    if (!this.shown) return;
    if (this.rows.length !== rows.length || this.columns !== columns) {
      this.columns = columns;
      this.build(rows.length, title);
    }
    rows.forEach((r, i) => {
      const cells = this.rows[i]!;
      const colour = r.out ? GREY : WHITE;
      const name = `${r.name}${r.you ? '  (you)' : ''}${r.out ? '  out' : ''}`;
      const values = [name, ...r.values];
      cells.forEach((c, j) => c.setText(values[j] ?? '').setColor(j === 0 && !r.out ? `#${r.colour.toString(16).padStart(6, '0')}` : colour));
    });
  }

  private build(count: number, title: string): void {
    for (const p of this.parts.splice(0)) p.destroy();
    this.rows = [];
    const left = this.cx - WIDTH / 2;
    const height = 92 + count * ROW + 16;
    const g = this.bg.clear();
    g.fillStyle(0x000000, 0.85).fillRect(left, this.top, WIDTH, height);
    g.lineStyle(3, BRONZE, 1).strokeRect(left, this.top, WIDTH, height);
    g.lineStyle(1, BRONZE, 0.7).strokeRect(left + 5, this.top + 5, WIDTH - 10, height - 10);
    g.lineStyle(1, BRONZE, 0.5).lineBetween(left + 16, this.top + 84, left + WIDTH - 16, this.top + 84);
    const text = (x: number, y: number, s: string, size: number, color: string, align: 'left' | 'right' | 'center') => {
      const t = this.scene.add
        .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color })
        .setOrigin(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0)
        .setDepth(this.depth + 1)
        .setVisible(this.shown);
      this.parts.push(t);
      return t;
    };
    text(this.cx, this.top + 14, title, 26, GOLD, 'center');
    for (const c of this.columns) text(left + c.x, this.top + 56, c.title, 18, GOLD, c.align);
    for (let i = 0; i < count; i++) {
      const y = this.top + 96 + i * ROW;
      this.rows.push(this.columns.map((c) => text(left + c.x, y, '', 20, WHITE, c.align)));
    }
  }
}
