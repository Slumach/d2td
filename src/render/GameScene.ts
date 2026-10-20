// M2a grey-box scene: the Paladin in the sim, drawn as coloured shapes. It reads sim state
// and never writes to it: every player action becomes a Command stamped with the tick it
// runs on, the same stream a lockstep peer would get.

import Phaser from 'phaser';

import { DESIGN } from '../data/design.ts';
import { buildGameData, MAX_TOWER_LEVEL } from '../sim/data.ts';
import { TICKS_PER_SECOND, UNITS_PER_TILE } from '../sim/fixed.ts';
import { isPathTile } from '../sim/map.ts';
import {
  activeSkill,
  canBuild,
  createSim,
  evolutionFor,
  pendingChoices,
  sellValue,
  step,
  tierCost,
  towerAt,
  towerById,
  upgradeCost,
  type Command,
  type Sim,
  type TimedCommand,
  type Tower,
} from '../sim/sim.ts';
import { TABLE_NAMES, type Tables } from '../sim/tables.ts';
import { TARGETING_MODES } from '../sim/state.ts';
import { FONT, buttonRow, type ButtonSpec } from './ui.ts';

const TILE = 64;
const HUD_HEIGHT = 64;
const MAP_HEIGHT = 17 * TILE;
const PANEL_TOP = HUD_HEIGHT + MAP_HEIGHT;
export const GAME_WIDTH = 30 * TILE;
export const GAME_HEIGHT = PANEL_TOP + 136;
const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Do not let a stalled tab replay minutes of ticks in one frame. */
const MAX_TICKS_PER_FRAME = 10;
const CLASS = 'paladin';

const LINE_COLOURS: Record<string, number> = { zealot: 0xc84a3a, holy: 0xe0b840, aura: 0x4a84d8 };
const EVOLVED_COLOUR = 0xa050d0;
const MONSTER_COLOURS: Record<string, number> = {
  fallen1: 0xd04030,
  fallenshaman1: 0xf07850,
  fallen4: 0x902018,
  zombie1: 0x6a8a40,
  skeleton1: 0xd8d0b8,
  quillrat1: 0x9a6a40,
  corruptrogue1: 0x8040a0,
  brute1: 0x705838,
  bloodraven: 0xe02060,
  andariel: 0x40c060,
};
const RANK_BORDER: Record<string, number> = { champion: 0x60a0ff, unique: 0xffc040, boss: 0xff4040 };

function toPx(units: number): number {
  return (units * TILE) / UNITS_PER_TILE;
}

type Selection = { kind: 'tile'; x: number; y: number } | { kind: 'tower'; id: number } | undefined;

export class GameScene extends Phaser.Scene {
  private sim!: Sim;
  private seed = 1;
  private log: TimedCommand[] = [];
  private pending: Command[] = [];
  private accumulator = 0;
  private hover: { x: number; y: number } | undefined;
  private selection: Selection;
  private panelKey = '';

  private world!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Text;
  private panel: Phaser.GameObjects.GameObject[] = [];
  private towerLabels = new Map<number, Phaser.GameObjects.Text>();

  constructor() {
    super('Game');
  }

  preload(): void {
    for (const name of TABLE_NAMES) this.load.json(name, `data/${name}.json`);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, () => {
      this.add.text(16, 16, 'Missing assets-extracted/data. Run npm run extract first.', { color: '#e0c080' });
    });
  }

  create(): void {
    if (!TABLE_NAMES.every((name) => this.cache.json.exists(name))) return;
    const tables = Object.fromEntries(TABLE_NAMES.map((name) => [name, this.cache.json.get(name)])) as unknown as Tables;
    this.sim = createSim(buildGameData(tables, DESIGN), this.seed);

    this.add.graphics().setDepth(0).fillStyle(0x1a1a14).fillRect(0, 0, GAME_WIDTH, HUD_HEIGHT).fillRect(0, PANEL_TOP, GAME_WIDTH, GAME_HEIGHT - PANEL_TOP);
    this.drawGround();
    this.world = this.add.graphics().setDepth(2);

    const text = { fontFamily: FONT, fontSize: '24px', color: '#e8e0c0' };
    this.hud = this.add.text(16, 18, '', text).setDepth(10);
    this.info = this.add.text(16, PANEL_TOP + 10, '', { ...text, fontSize: '20px' }).setDepth(10);
    buttonRow(this, GAME_WIDTH - 180, 12, [{ label: 'Call Wave', onClick: () => this.issue({ type: 'callWave' }), colour: '#6a3020' }], 200);
    this.overlay = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, '', { ...text, fontSize: '48px', align: 'center', backgroundColor: '#000000c0', padding: { x: 40, y: 24 } })
      .setOrigin(0.5)
      .setDepth(40)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.restart());

    this.input.mouse?.disableContextMenu();
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => (this.hover = this.tileAt(p)));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length === 0) this.onMapClick(p);
    });
  }

  private tileAt(p: Phaser.Input.Pointer): { x: number; y: number } | undefined {
    if (p.y < HUD_HEIGHT || p.y >= PANEL_TOP) return undefined;
    const x = Math.floor(p.x / TILE);
    const y = Math.floor((p.y - HUD_HEIGHT) / TILE);
    return x >= 0 && x < this.sim.map.width && y >= 0 && y < this.sim.map.height ? { x, y } : undefined;
  }

  private onMapClick(p: Phaser.Input.Pointer): void {
    if (!this.sim || this.sim.state.status !== 'playing') return;
    const tile = this.tileAt(p);
    if (!tile) return;
    const tower = towerAt(this.sim, tile.x, tile.y);
    if (tower) this.selection = { kind: 'tower', id: tower.id };
    else if (canBuild(this.sim, tile.x, tile.y)) this.selection = { kind: 'tile', x: tile.x, y: tile.y };
    else this.selection = undefined;
    this.panelKey = '';
  }

  /** Player input only ever queues commands; the sim applies them on the next tick. */
  private issue(...commands: Command[]): void {
    this.pending.push(...commands);
  }

  private restart(): void {
    this.seed++;
    this.sim = createSim(this.sim.data, this.seed);
    this.log = [];
    this.pending = [];
    this.accumulator = 0;
    this.selection = undefined;
    this.panelKey = '';
    for (const label of this.towerLabels.values()) label.destroy();
    this.towerLabels.clear();
    this.overlay.setVisible(false);
  }

  override update(_time: number, delta: number): void {
    if (!this.sim) return;
    this.accumulator = Math.min(this.accumulator + delta, TICK_MS * MAX_TICKS_PER_FRAME);
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      const commands = this.pending;
      this.pending = [];
      for (const command of commands) this.log.push({ tick: this.sim.state.tick, command });
      step(this.sim, commands);
    }
    // Sold, or consumed by an evolution
    if (this.selection?.kind === 'tower' && !towerById(this.sim, this.selection.id)) this.selection = undefined;
    this.drawWorld();
    this.drawHud();
    this.drawPanel();
  }

  private drawGround(): void {
    const g = this.add.graphics().setDepth(1);
    const { map } = this.sim;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        g.fillStyle(isPathTile(map, x, y) ? 0x6a5a3a : (x + y) % 2 ? 0x2c3a24 : 0x30402a);
        g.fillRect(x * TILE, HUD_HEIGHT + y * TILE, TILE, TILE);
      }
    }
  }

  private towerColour(t: Tower): number {
    if (t.evolved) return EVOLVED_COLOUR;
    return LINE_COLOURS[t.line] ?? 0x707070;
  }

  private drawWorld(): void {
    const { state, fx } = this.sim;
    const g = this.world.clear();
    const oy = HUD_HEIGHT;
    const selected = this.selection?.kind === 'tower' ? this.selection.id : undefined;

    // Aura rings: faint for every emitter, bright for the selected tower
    for (const e of fx.emitters) {
      const t = towerById(this.sim, e.towerId);
      if (!t) continue;
      g.lineStyle(e.towerId === selected ? 2 : 1, 0x80b0ff, e.towerId === selected ? 0.8 : 0.18);
      g.strokeCircle(toPx(t.x), oy + toPx(t.y), toPx(e.radiusUnits));
    }

    // Corpses
    g.fillStyle(0x3a3028);
    for (const c of state.corpses) g.fillRect(toPx(c.x) - 8, oy + toPx(c.y) - 4, 16, 8);

    // Towers
    const seen = new Set<number>();
    for (const t of state.towers) {
      seen.add(t.id);
      const x = t.tileX * TILE;
      const y = oy + t.tileY * TILE;
      g.fillStyle(this.towerColour(t)).fillRect(x + 8, y + 8, TILE - 16, TILE - 16);
      if (t.evolved && t.partnerSkill) g.lineStyle(4, LINE_COLOURS['aura']!).strokeRect(x + 8, y + 8, TILE - 16, TILE - 16);
      if (t.id === selected) g.lineStyle(3, 0xffffff).strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
      let label = this.towerLabels.get(t.id);
      if (!label) {
        label = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '16px', color: '#101010' }).setOrigin(0.5).setDepth(3);
        this.towerLabels.set(t.id, label);
      }
      label.setPosition(x + TILE / 2, y + TILE / 2).setText(t.evolved ? 'T4' : t.line ? `${t.tier}.${t.level}` : '?');
    }
    for (const [id, label] of this.towerLabels) {
      if (!seen.has(id)) {
        label.destroy();
        this.towerLabels.delete(id);
      }
    }

    // Range of the selected tower's attack
    const sel = selected !== undefined ? towerById(this.sim, selected) : undefined;
    const active = sel && activeSkill(this.sim, sel);
    if (sel && active && active.skill.rangeUnits > 0) {
      g.lineStyle(1, 0xffffff, 0.5).strokeCircle(toPx(sel.x), oy + toPx(sel.y), toPx(active.skill.rangeUnits));
    }

    // Summons
    for (const u of state.summons) {
      g.fillStyle(0x50d070).fillRect(toPx(u.x) - 10, oy + toPx(u.y) - 10, 20, 20);
    }

    // Monsters with HP bars; slowed ones get a blue outline
    for (const m of state.monsters) {
      const size = m.rank === 'boss' ? 40 : m.rank === 'normal' ? 24 : 30;
      const px = toPx(m.x) - size / 2;
      const py = oy + toPx(m.y) - size / 2;
      g.fillStyle(MONSTER_COLOURS[m.def] ?? 0xffffff).fillRect(px, py, size, size);
      const border = RANK_BORDER[m.rank];
      if (border) g.lineStyle(3, border).strokeRect(px, py, size, size);
      if ((fx.monsters[m.id]?.slowPct ?? 0) > 0 || m.slowPct > 0) g.lineStyle(2, 0x80c0ff).strokeRect(px - 3, py - 3, size + 6, size + 6);
      if (m.castTicks > 0) g.lineStyle(2, 0xffffff).strokeCircle(px + size / 2, py + size / 2, size);
      g.fillStyle(0x200000).fillRect(px, py - 7, size, 4);
      g.fillStyle(0x40e040).fillRect(px, py - 7, (size * Math.max(0, m.hp)) / m.maxHp, 4);
    }

    // Missiles
    for (const m of state.missiles) {
      const skill = this.sim.data.skills[m.skill]!;
      const colour = skill.archetype === 'zone' ? 0x80c0ff : skill.damageType === 'ltng' ? 0xfff080 : 0xf0f0ff;
      g.fillStyle(colour, skill.archetype === 'zone' ? 0.25 : 1).fillCircle(toPx(m.x), oy + toPx(m.y), skill.archetype === 'zone' ? 30 : 6);
    }

    // Hovered tile
    if (this.hover && state.status === 'playing') {
      const { x, y } = this.hover;
      const ok = canBuild(this.sim, x, y) || towerAt(this.sim, x, y) !== undefined;
      g.lineStyle(2, ok ? 0xffffff : 0xff4040, 0.5).strokeRect(x * TILE + 1, oy + y * TILE + 1, TILE - 2, TILE - 2);
    }
  }

  private drawHud(): void {
    const { state, data } = this.sim;
    this.hud.setText(`Gold ${state.gold}   Lives ${state.lives}   Wave ${state.wave}/${data.waves.length}   Kills ${state.kills}`);
    if (state.status !== 'playing' && !this.overlay.visible) {
      this.overlay
        .setText(`${state.status === 'won' ? 'Victory' : 'Defeat'}\nwave ${state.wave}, ${state.kills} kills\nclick to play again`)
        .setVisible(true);
    }
  }

  private skillName(id: string): string {
    return this.sim.data.skills[id]?.name ?? id;
  }

  /** Rebuilds the bottom panel when what it would show changes. */
  private drawPanel(): void {
    const sim = this.sim;
    const sel = this.selection;
    const tower = sel?.kind === 'tower' ? towerById(sim, sel.id) : undefined;
    const key = JSON.stringify([sel, tower && [tower.tier, tower.level, tower.picks, tower.targeting], sim.state.gold, sim.state.towers.length]);
    if (key === this.panelKey) return;
    this.panelKey = key;
    for (const o of this.panel) o.destroy();
    this.panel = [];

    const x = 16;
    const y = PANEL_TOP + 48;
    const width = GAME_WIDTH - 32;
    const e = sim.data.economy;
    let specs: ButtonSpec[] = [];

    if (sel?.kind === 'tile') {
      this.info.setText(`Build a Paladin tower (${e.buildCost}g): pick its T1 skill, which fixes its line`);
      const cls = sim.data.classes[CLASS]!;
      specs = Object.values(cls.lines).map((line) => {
        const skill = line.tiers[0]![0]!;
        return {
          label: `${line.name}: ${this.skillName(skill)}`,
          enabled: sim.state.gold >= e.buildCost,
          onClick: () => {
            this.issue({ type: 'build', x: sel.x, y: sel.y, cls: CLASS, skill });
            this.selection = undefined;
          },
        };
      });
    } else if (tower) {
      const active = activeSkill(sim, tower);
      const recipe = tower.evolved ? sim.data.evolutions.find((r) => r.id === tower.evolved) : undefined;
      const line = sim.data.classes[tower.cls]?.lines[tower.line];
      const title = recipe
        ? `${recipe.name}: ${this.skillName(recipe.attack.skill)} with ${this.skillName(tower.partnerSkill)} aura`
        : `${line?.name ?? 'Inert'} T${tower.tier} L${tower.level}: ${active ? active.skill.name : 'pick a skill'}`;
      this.info.setText(`${title}   targeting ${tower.targeting}`);

      const pick = pendingChoices(sim, tower);
      if (pick.length > 0) {
        const type = tower.line ? 'pickBranch' : 'pickSkill';
        specs.push(...pick.map((skill) => ({ label: `Pick ${this.skillName(skill)}`, onClick: () => this.issue({ type, towerId: tower.id, skill }) })));
      }
      const level = upgradeCost(sim, tower);
      if (level !== undefined) {
        specs.push({ label: `Level ${tower.level + 1} (${level}g)`, enabled: sim.state.gold >= level, onClick: () => this.issue({ type: 'upgrade', towerId: tower.id }) });
      }
      const tier = tierCost(sim, tower);
      if (tier !== undefined && line) {
        const options = line.tiers[tower.tier] ?? [];
        for (const skill of options) {
          const commands: Command[] = [{ type: 'upgradeTier', towerId: tower.id }];
          if (options.length > 1) commands.push({ type: 'pickBranch', towerId: tower.id, skill });
          specs.push({ label: `T${tower.tier + 1}: ${this.skillName(skill)} (${tier}g)`, enabled: sim.state.gold >= tier, onClick: () => this.issue(...commands) });
        }
      } else if (!tower.evolved && line && tower.level < MAX_TOWER_LEVEL && tower.tier < line.tiers.length) {
        specs.push({ label: `T${tower.tier + 1} unlocks at level ${MAX_TOWER_LEVEL}`, enabled: false, onClick: () => undefined });
      }
      for (const other of sim.state.towers) {
        const match = evolutionFor(sim, tower, other);
        if (!match) continue;
        specs.push({
          label: `Evolve ${match.recipe.name} with ${this.skillName(match.partner === other ? match.recipe.partner.skill : match.recipe.attack.skill)} (${e.evolveCost}g)`,
          enabled: sim.state.gold >= e.evolveCost,
          colour: '#5a2a70',
          onClick: () => this.issue({ type: 'evolve', towerA: tower.id, towerB: other.id }),
        });
      }
      const next = TARGETING_MODES[(TARGETING_MODES.indexOf(tower.targeting) + 1) % TARGETING_MODES.length]!;
      specs.push({ label: `Target: ${tower.targeting}`, colour: '#284050', onClick: () => this.issue({ type: 'setTargeting', towerId: tower.id, mode: next }) });
      specs.push({
        label: `Sell (${sellValue(sim, tower)}g)`,
        colour: '#502020',
        onClick: () => {
          this.issue({ type: 'sell', towerId: tower.id });
          this.selection = undefined;
        },
      });
    } else {
      this.info.setText('Click a free tile to build. Click a tower to upgrade, pick branches, evolve or change targeting.');
    }
    this.panel = buttonRow(this, x, y, specs, width);
  }
}
