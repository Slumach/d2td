// D2R's inventory and stash, opened together with I or the panel's inventory button: the
// stash on the left (10 x 10 pages, arrows between them), the inventory on the right (the
// paper doll, the 10 x 4 grid, the gold). The paper doll is the selected tower's: towers
// wear the items. Items move as D2 moves them: click one to hold it on the cursor, click
// where it goes. Holding a gem, rune or jewel over a socketed item sockets it; Smith's
// Hammer over an item adds a socket; an item dropped on the sell box is sold (uniques, set
// items and runewords ask first). Every change the game must agree on is a command; stash
// moves wait for the sim to show them (keeper.ts). Tooltips are D2R's (itemtext.ts).

import Phaser from 'phaser';

import { HD_SCALE } from '../launcher/frontend.ts';
import { freeIn, STASH_H, STASH_W } from '../launcher/profile.ts';
import type { ItemData, Slot } from '../sim/items/data.ts';
import { canWear, type Item } from '../sim/items/item.ts';
import { fitsAt } from '../sim/items/inventory.ts';
import { freeSpot, INV_H, INV_W, type InvItem } from '../sim/items/loot.ts';
import { sellPrice } from '../sim/items/price.ts';
import type { Command, Sim, Tower } from '../sim/state.ts';
import { hudKey, type HudManifest } from './d2hud.ts';
import { itemTexture } from './itemart.ts';
import { itemLines, TIP, type Line } from './itemtext.ts';
import type { Keeper } from './keeper.ts';
import { GAME_WIDTH } from './layout.ts';
import { FONT } from './ui.ts';

const S = HD_SCALE;
/** D2R's item cell, in panel pixels ($ItemCellSize). */
const CELL = 98;
const DEPTH = 4000;
const PANEL_TOP = 60;
const MARGIN = 40;

/** Inventory panel spots (playerinventoryoriginallayouthd.json). */
const INV = {
  grid: { x: 93, y: 897 },
  gold: { x: 487, y: 1346 },
  goldButton: { x: 429, y: 1347 },
  close: { x: 1075, y: 9 },
  title: { x: 581, y: 98 },
  sell: { x: 790, y: 1326, w: 300, h: 92 },
  doll: {
    weapon: { x: 108, y: 232, w: 196, h: 392, art: 'dollWeapon' },
    shield: { x: 860, y: 232, w: 196, h: 392, art: 'dollShield' },
    helm: { x: 482, y: 185, w: 196, h: 196, art: 'dollHelm' },
    amulet: { x: 718, y: 353, w: 98, h: 98, art: 'dollAmulet' },
    armor: { x: 482, y: 428, w: 196, h: 294, art: 'dollArmor' },
    gloves: { x: 107, y: 672, w: 196, h: 196, art: 'dollGloves' },
    boots: { x: 859, y: 672, w: 196, h: 196, art: 'dollBoots' },
    belt: { x: 483, y: 769, w: 196, h: 98, art: 'dollBelt' },
    ring1: { x: 344, y: 770, w: 98, h: 98, art: 'dollRing' },
    ring2: { x: 718, y: 770, w: 98, h: 98, art: 'dollRing' },
  } as Record<Slot, { x: number; y: number; w: number; h: number; art: string }>,
};
/** Stash panel spots (bankexpansionlayouthd.json). */
const STASH = {
  grid: { x: 89, y: 219 },
  close: { x: 1075, y: 9 },
  title: { x: 581, y: 98 },
  nav: { x: 369, y: 1211 },
  left: { x: 29, y: 13 },
  right: { x: 327, y: 13 },
  page: { x: 210, y: 45 },
};

/** Trade window spots (tradelayouthd.json). */
const TRADE = {
  title: { x: 581, y: 98 },
  close: { x: 1075, y: 9 },
  them: { name: { x: 224, y: 207 }, gold: { x: 733, y: 208 }, grid: { x: 92, y: 320 }, ready: { x: 103, y: 198 } },
  us: { name: { x: 224, y: 1277 }, gold: { x: 733, y: 1278 }, grid: { x: 92, y: 814 }, ready: { x: 103, y: 1267 } },
};

export interface ItemPanelHost {
  readonly data: ItemData;
  sim(): Sim | undefined;
  seat(): number;
  /** The selected tower, if it is this player's. */
  tower(): Tower | undefined;
  issue(c: Command): void;
  keeper: Keeper;
  skillName(param: string): string;
  /** An item sound by table name (pick up and put down use the item's usesound). */
  sound(name: string | undefined): void;
  /** A one-line message on screen. */
  toast(text: string): void;
  /** Multiplayer: the other players, to open a trade with (none in single player). */
  others(): { slot: number; name: string }[];
  /** The trade this player is in, if any: both sides' offers. */
  trade(): TradeView | undefined;
}

export interface TradeSideView {
  name: string;
  items: Item[];
  gold: number;
  accepted: boolean;
}

export interface TradeView {
  mine: TradeSideView;
  theirs: TradeSideView;
}

/** Where a held item came from. */
type Source = { from: 'inv'; uid: string } | { from: 'stash'; uid: string; page: number } | { from: 'tower'; towerId: number; slot: Slot } | { from: 'belt'; slot: number };

interface Held {
  item: Item;
  source: Source;
}

export class ItemPanels {
  private shown = false;
  private parts: Phaser.GameObjects.GameObject[] = [];
  /** Item sprites, rebuilt when what they show changes. */
  private itemParts: Phaser.GameObjects.GameObject[] = [];
  private itemKey = '';
  private held: Held | undefined;
  private heldSprite: Phaser.GameObjects.Image | undefined;
  private page = 0;
  private pageText: Phaser.GameObjects.Text | undefined;
  private goldText: Phaser.GameObjects.Text | undefined;
  private readonly tip: ItemTip;
  private confirm: Phaser.GameObjects.GameObject[] = [];
  /** The left panel on show: the stash, or the trade window while a trade is open. */
  private left: 'stash' | 'trade' = 'stash';
  private tradeTexts: { theirName?: Phaser.GameObjects.Text; theirGold?: Phaser.GameObjects.Text; myName?: Phaser.GameObjects.Text; myGold?: Phaser.GameObjects.Text; theirReady?: Phaser.GameObjects.Image; myReady?: Phaser.GameObjects.Image } = {};

  private beltParts: Phaser.GameObjects.GameObject[] = [];
  private beltKey = '';

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly m: HudManifest,
    private readonly host: ItemPanelHost,
    /** The HUD's belt slots on screen; the belt is always on, panels open or not. */
    private readonly beltSpots: { x: number; y: number; size: number }[] = [],
  ) {
    this.tip = new ItemTip(scene, DEPTH + 50);
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.heldSprite?.setPosition(p.x, p.y));
    this.beltSpots.forEach((spot, slot) => {
      const zone = scene.add.zone(spot.x, spot.y, spot.size, spot.size).setDepth(3200).setInteractive();
      zone.on('pointerdown', (ptr: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        if (ptr.rightButtonDown()) return this.dropHeld();
        this.clickBelt(slot);
      });
      zone.on('pointerover', () => this.hoverBelt(slot, spot.x, spot.y - spot.size / 2 - 6));
      zone.on('pointerout', () => this.tip.hide());
    });
  }

  /** This player's belt in the sim. */
  private belt(): (Item | null)[] {
    return this.host.sim()?.state.belts[this.host.seat()] ?? [];
  }

  /** Draws the belt's items when they change. */
  private syncBelt(): void {
    const heldSlot = this.held?.source.from === 'belt' ? this.held.source.slot : -1;
    const key = JSON.stringify([this.belt(), heldSlot]);
    if (key === this.beltKey) return;
    this.beltKey = key;
    for (const o of this.beltParts) o.destroy();
    this.beltParts = [];
    this.belt().forEach((item, slot) => {
      const spot = this.beltSpots[slot];
      if (!item || !spot || slot === heldSlot) return;
      const tex = itemTexture(this.scene, this.host.data, item);
      const size = spot.size * 0.8;
      if (tex) this.beltParts.push(this.scene.add.image(spot.x, spot.y, tex).setDisplaySize(size, size).setDepth(3150));
    });
  }

  /** A belt slot clicked: take its item, or put a held gem, rune or jewel from the inventory in it. */
  clickBelt(slot: number): void {
    const item = this.belt()[slot];
    if (!this.held) {
      if (item) this.pickUp(item, { from: 'belt', slot });
      return;
    }
    const { item: held, source } = this.held;
    const hb = this.host.data.bases[held.code];
    if (source.from === 'belt') return this.dropHeld();
    if (!hb || !(hb.isGem || hb.isRune || hb.isJewel)) return this.host.toast('The belt holds gems, runes and jewels');
    if (source.from !== 'inv') return this.host.toast('Put it in the inventory first');
    if (item) return this.host.toast('That belt slot is full');
    this.host.issue({ type: 'toBelt', uid: held.uid, slot });
    this.placed();
  }

  private hoverBelt(slot: number, x: number, y: number): void {
    if (this.held) return;
    const item = this.belt()[slot];
    if (item) this.tipFor(item, x, y);
    else this.tip.show([{ text: `Belt slot ${slot + 1}`, colour: TIP.white }, { text: 'Gems, runes and jewels to socket from', colour: TIP.grey }], x, y);
  }

  static available(scene: Phaser.Scene, m: HudManifest | undefined): boolean {
    return m?.invBg !== undefined && scene.textures.exists(hudKey('invBg'));
  }

  get open(): boolean {
    return this.shown;
  }

  toggle(): void {
    if (this.shown) this.hide();
    else this.show();
  }

  /** Inventory panel box on screen. */
  private invBox() {
    const w = this.m.invBg!.frameWidth * S;
    const h = this.m.invBg!.frameHeight * S;
    return { left: GAME_WIDTH - MARGIN - w, top: PANEL_TOP, w, h };
  }

  private stashBox() {
    const w = (this.m.stashBg?.frameWidth ?? 1162) * S;
    const h = (this.m.stashBg?.frameHeight ?? 1507) * S;
    return { left: MARGIN, top: PANEL_TOP, w, h };
  }

  /** True where a panel covers the screen, so clicks there never reach the map. */
  covers(x: number, y: number): boolean {
    if (!this.shown) return false;
    const inside = (b: { left: number; top: number; w: number; h: number }) => x >= b.left && x <= b.left + b.w && y >= b.top && y <= b.top + b.h;
    return inside(this.invBox()) || (this.m.stashBg !== undefined && inside(this.stashBox())) || this.confirm.length > 0;
  }

  /** True while an item is held on the cursor: map clicks wait. */
  get holding(): boolean {
    return this.held !== undefined;
  }

  show(): void {
    this.hide();
    this.shown = true;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.parts.push(o), o);
    const inv = this.invBox();
    const at = (b: { left: number; top: number }, x: number, y: number) => ({ x: b.left + x * S, y: b.top + y * S });
    const swallow = (o: Phaser.GameObjects.GameObject) =>
      o.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => e.stopPropagation());

    // Inventory
    swallow(add(this.scene.add.image(inv.left, inv.top, hudKey('invBg')).setOrigin(0).setScale(S).setDepth(DEPTH).setInteractive()));
    const t = at(inv, INV.title.x, INV.title.y);
    add(this.scene.add.text(t.x, t.y, 'Inventory', { fontFamily: FONT, fontSize: '26px', color: TIP.gold }).setOrigin(0.5).setDepth(DEPTH + 1));
    this.closeButton(add, at(inv, INV.close.x, INV.close.y));
    for (const [slot, spot] of Object.entries(INV.doll) as [Slot, (typeof INV.doll)[Slot]][]) {
      const p = at(inv, spot.x, spot.y);
      const zone = add(this.scene.add.zone(p.x, p.y, spot.w * S, spot.h * S).setOrigin(0).setDepth(DEPTH + 3).setInteractive());
      zone.on('pointerdown', (ptr: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        if (ptr.leftButtonDown()) this.clickDoll(slot);
        else if (ptr.rightButtonDown()) this.dropHeld();
      });
      zone.on('pointerover', () => this.hoverDoll(slot, p.x + (spot.w * S) / 2, p.y));
      zone.on('pointerout', () => this.tip.hide());
    }
    const g = at(inv, INV.grid.x, INV.grid.y);
    const grid = add(this.scene.add.zone(g.x, g.y, INV_W * CELL * S, INV_H * CELL * S).setOrigin(0).setDepth(DEPTH + 3).setInteractive());
    grid.on('pointerdown', (ptr: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      if (ptr.rightButtonDown()) return this.held ? this.dropHeld() : this.rightClick(ptr.x - g.x, ptr.y - g.y);
      this.clickGrid('inv', ptr.x - g.x, ptr.y - g.y, (ptr.event as MouseEvent).shiftKey);
    });
    grid.on('pointermove', (ptr: Phaser.Input.Pointer) => this.hoverGrid('inv', ptr.x - g.x, ptr.y - g.y, ptr.x, ptr.y));
    grid.on('pointerout', () => this.tip.hide());

    // Gold and the sell box
    const gb = at(inv, INV.goldButton.x, INV.goldButton.y);
    if (this.scene.textures.exists(hudKey('goldButton'))) add(this.scene.add.image(gb.x, gb.y, hudKey('goldButton'), 0).setOrigin(0).setScale(S).setDepth(DEPTH + 1));
    const gt = at(inv, INV.gold.x, INV.gold.y + 24);
    this.goldText = add(this.scene.add.text(gt.x, gt.y, '', { fontFamily: FONT, fontSize: '20px', color: '#e6c868' }).setOrigin(0, 0.5).setDepth(DEPTH + 1));
    const sp = at(inv, INV.sell.x, INV.sell.y);
    const sell = add(this.scene.add.rectangle(sp.x, sp.y, INV.sell.w * S, INV.sell.h * S, 0x2a1c10, 0.9).setOrigin(0).setStrokeStyle(1, 0x7a6440).setDepth(DEPTH + 1).setInteractive());
    add(this.scene.add.text(sp.x + (INV.sell.w * S) / 2, sp.y + (INV.sell.h * S) / 2, 'Sell', { fontFamily: FONT, fontSize: '18px', color: TIP.gold }).setOrigin(0.5).setDepth(DEPTH + 2));
    sell.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.clickSell();
    });
    sell.on('pointerover', () => this.hoverSell(sp.x, sp.y));
    sell.on('pointerout', () => this.tip.hide());

    // Trade buttons, one per other player, in multiplayer
    this.host.others().forEach((o, k) => {
      const b = at(inv, 110 + k * 190, 1350);
      const btn = add(this.scene.add.text(b.x, b.y, `Trade: ${o.name}`, { fontFamily: FONT, fontSize: '12px', color: TIP.gold, backgroundColor: '#2a1c10', padding: { x: 6, y: 4 } }).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true }));
      btn.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        this.host.issue({ type: 'tradeOpen', with: o.slot });
      });
    });

    this.left = this.host.trade() ? 'trade' : 'stash';
    if (this.left === 'trade' && this.scene.textures.exists(hudKey('tradeBg'))) this.showTrade(add, at, swallow);
    // Stash
    else if (this.m.stashBg && this.scene.textures.exists(hudKey('stashBg'))) {
      const st = this.stashBox();
      swallow(add(this.scene.add.image(st.left, st.top, hudKey('stashBg')).setOrigin(0).setScale(S).setDepth(DEPTH).setInteractive()));
      const tt = at(st, STASH.title.x, STASH.title.y);
      add(this.scene.add.text(tt.x, tt.y, 'Stash', { fontFamily: FONT, fontSize: '26px', color: TIP.gold }).setOrigin(0.5).setDepth(DEPTH + 1));
      this.closeButton(add, at(st, STASH.close.x, STASH.close.y));
      const sg = at(st, STASH.grid.x, STASH.grid.y);
      const sgrid = add(this.scene.add.zone(sg.x, sg.y, STASH_W * CELL * S, STASH_H * CELL * S).setOrigin(0).setDepth(DEPTH + 3).setInteractive());
      sgrid.on('pointerdown', (ptr: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        if (ptr.rightButtonDown()) return this.dropHeld();
        this.clickGrid('stash', ptr.x - sg.x, ptr.y - sg.y, (ptr.event as MouseEvent).shiftKey);
      });
      sgrid.on('pointermove', (ptr: Phaser.Input.Pointer) => this.hoverGrid('stash', ptr.x - sg.x, ptr.y - sg.y, ptr.x, ptr.y));
      sgrid.on('pointerout', () => this.tip.hide());
      const nav = at(st, STASH.nav.x, STASH.nav.y);
      const arrow = (key: string, dx: number, step: number) => {
        if (!this.scene.textures.exists(hudKey(key))) return;
        const a = add(this.scene.add.image(nav.x + dx * S, nav.y + STASH.left.y * S, hudKey(key), 0).setOrigin(0).setScale(S).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true }));
        a.on('pointerover', () => a.setFrame(1));
        a.on('pointerout', () => a.setFrame(0));
        a.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
          e.stopPropagation();
          this.turnPage(step);
        });
      };
      arrow('stashLeft', STASH.left.x, -1);
      arrow('stashRight', STASH.right.x, 1);
      this.pageText = add(this.scene.add.text(nav.x + STASH.page.x * S, nav.y + STASH.page.y * S, '', { fontFamily: FONT, fontSize: '16px', color: TIP.white }).setOrigin(0.5).setDepth(DEPTH + 2));
    }
    this.itemKey = '';
    this.sync();
  }

  /** D2R's trade window on the left: their offer above, ours below, each with gold and an accept mark. */
  private showTrade(
    add: <T extends Phaser.GameObjects.GameObject>(o: T) => T,
    at: (b: { left: number; top: number }, x: number, y: number) => { x: number; y: number },
    swallow: (o: Phaser.GameObjects.GameObject) => void,
  ): void {
    const st = this.stashBox();
    swallow(add(this.scene.add.image(st.left, st.top, hudKey('tradeBg')).setOrigin(0).setScale(S).setDepth(DEPTH).setInteractive()));
    const tt = at(st, TRADE.title.x, TRADE.title.y);
    add(this.scene.add.text(tt.x, tt.y, 'Trade', { fontFamily: FONT, fontSize: '26px', color: TIP.gold }).setOrigin(0.5).setDepth(DEPTH + 1));
    // Closing the window cancels the trade
    const c = at(st, TRADE.close.x, TRADE.close.y);
    if (this.scene.textures.exists(hudKey('closeBtn'))) {
      const close = add(this.scene.add.image(c.x, c.y, hudKey('closeBtn'), 0).setOrigin(0).setScale(S).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true }));
      close.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        this.host.issue({ type: 'tradeCancel' });
      });
    }
    const text = (p: { x: number; y: number }, colour: string) => add(this.scene.add.text(p.x, p.y + 13, '', { fontFamily: FONT, fontSize: '17px', color: colour }).setDepth(DEPTH + 2));
    const ready = (p: { x: number; y: number }) => add(this.scene.add.image(p.x, p.y, hudKey('tradeAccept'), 0).setOrigin(0).setScale(S).setDepth(DEPTH + 2));
    this.tradeTexts = {
      theirName: text(at(st, TRADE.them.name.x, TRADE.them.name.y), TIP.white),
      theirGold: text(at(st, TRADE.them.gold.x, TRADE.them.gold.y), '#e6c868'),
      myName: text(at(st, TRADE.us.name.x, TRADE.us.name.y), TIP.white),
      myGold: text(at(st, TRADE.us.gold.x, TRADE.us.gold.y), '#e6c868'),
    };
    if (this.scene.textures.exists(hudKey('tradeAccept'))) {
      this.tradeTexts.theirReady = ready(at(st, TRADE.them.ready.x, TRADE.them.ready.y));
      const mine = ready(at(st, TRADE.us.ready.x, TRADE.us.ready.y)).setInteractive({ useHandCursor: true });
      mine.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        this.host.issue({ type: 'tradeAccept' });
      });
      mine.on('pointerover', () => this.tip.show([{ text: 'Accept the trade', colour: TIP.white }], mine.x + 20, mine.y));
      mine.on('pointerout', () => this.tip.hide());
      this.tradeTexts.myReady = mine;
    }
    // Our gold: click to add 100 (shift: 1000), right-click to take it back
    const gp = at(st, TRADE.us.gold.x, TRADE.us.gold.y);
    const goldZone = add(this.scene.add.zone(gp.x, gp.y, 309 * S, 53 * S).setOrigin(0).setDepth(DEPTH + 3).setInteractive({ useHandCursor: true }));
    goldZone.on('pointerdown', (ptr: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      const t = this.host.trade();
      if (!t) return;
      const step = (ptr.event as MouseEvent).shiftKey ? 1000 : 100;
      const gold = Math.max(0, t.mine.gold + (ptr.rightButtonDown() ? -step : step));
      this.host.issue({ type: 'tradeOffer', items: t.mine.items.map((i) => i.uid), gold });
    });
    goldZone.on('pointerover', () => this.tip.show([{ text: 'Gold to give', colour: TIP.gold }, { text: 'Click: +100, shift-click: +1000, right-click: less', colour: TIP.white }], gp.x + 70, gp.y));
    goldZone.on('pointerout', () => this.tip.hide());
    // Our offer: drop an inventory item here to offer it, click one to take it back
    const g = at(st, TRADE.us.grid.x, TRADE.us.grid.y);
    const grid = add(this.scene.add.zone(g.x, g.y, INV_W * CELL * S, INV_H * CELL * S).setOrigin(0).setDepth(DEPTH + 3).setInteractive());
    grid.on('pointerdown', (ptr: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      if (ptr.rightButtonDown()) return this.dropHeld();
      this.clickOffer(ptr.x - g.x, ptr.y - g.y);
    });
    grid.on('pointermove', (ptr: Phaser.Input.Pointer) => this.hoverOffer('us', ptr.x - g.x, ptr.y - g.y, ptr.x, ptr.y));
    grid.on('pointerout', () => this.tip.hide());
    const tg = at(st, TRADE.them.grid.x, TRADE.them.grid.y);
    const theirs = add(this.scene.add.zone(tg.x, tg.y, INV_W * CELL * S, INV_H * CELL * S).setOrigin(0).setDepth(DEPTH + 3).setInteractive());
    swallow(theirs);
    theirs.on('pointermove', (ptr: Phaser.Input.Pointer) => this.hoverOffer('them', ptr.x - tg.x, ptr.y - tg.y, ptr.x, ptr.y));
    theirs.on('pointerout', () => this.tip.hide());
  }

  /** An offer's items laid out in a 10 x 4 grid, column by column, as the trade window shows them. */
  private offerLayout(items: Item[]): InvItem[] {
    const out: InvItem[] = [];
    for (const item of items) {
      const spot = freeIn(this.host.data, out, item, INV_W, INV_H);
      if (spot) out.push({ item, ...spot });
    }
    return out;
  }

  private offerUnder(side: 'us' | 'them', px: number, py: number): InvItem | undefined {
    const t = this.host.trade();
    if (!t) return undefined;
    const cx = Math.floor(px / (CELL * S));
    const cy = Math.floor(py / (CELL * S));
    return this.offerLayout(side === 'us' ? t.mine.items : t.theirs.items).find((i) => {
      const b = this.host.data.bases[i.item.code];
      return cx >= i.x && cx < i.x + (b?.width ?? 1) && cy >= i.y && cy < i.y + (b?.height ?? 1);
    });
  }

  private clickOffer(px: number, py: number): void {
    const t = this.host.trade();
    if (!t) return;
    const uids = t.mine.items.map((i) => i.uid);
    if (this.held) {
      if (this.held.source.from !== 'inv') return this.host.toast('Offer items from the inventory');
      const uid = this.held.item.uid;
      this.host.issue({ type: 'tradeOffer', items: [...uids.filter((u) => u !== uid), uid], gold: t.mine.gold });
      return this.placed();
    }
    const under = this.offerUnder('us', px, py);
    if (under) this.host.issue({ type: 'tradeOffer', items: uids.filter((u) => u !== under.item.uid), gold: t.mine.gold });
  }

  private hoverOffer(side: 'us' | 'them', px: number, py: number, sx: number, sy: number): void {
    if (this.held) return this.tip.hide();
    const under = this.offerUnder(side, px, py);
    if (under) this.tipFor(under.item, sx, sy - 10);
    else this.tip.hide();
  }

  hide(): void {
    this.dropHeld();
    this.shown = false;
    this.tip.hide();
    this.closeConfirm();
    for (const o of [...this.parts, ...this.itemParts]) o.destroy();
    this.parts = [];
    this.itemParts = [];
    this.pageText = undefined;
    this.goldText = undefined;
  }

  private closeButton(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T, p: { x: number; y: number }): void {
    const key = this.scene.textures.exists(hudKey('closeBtn')) ? 'closeBtn' : this.scene.textures.exists(hudKey('invClose')) ? 'invClose' : undefined;
    if (!key) return;
    const c = add(this.scene.add.image(p.x, p.y, hudKey(key), 0).setOrigin(0).setScale(S).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true }));
    c.on('pointerover', () => c.setFrame(1));
    c.on('pointerout', () => c.setFrame(0));
    c.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.hide();
    });
  }

  private turnPage(step: number): void {
    const pages = this.host.keeper.profile?.stash.length ?? 1;
    // One empty page past the last is always there to put things on
    this.page = Math.max(0, Math.min(pages, this.page + step));
    this.itemKey = '';
    this.sync();
  }

  // ---- what is where ----

  private inventory(): InvItem[] {
    const sim = this.host.sim();
    return sim?.state.inventories[this.host.seat()] ?? [];
  }

  private stash(): InvItem[] {
    return this.host.keeper.stashPage(this.page);
  }

  private hiddenUid(): string | undefined {
    const s = this.held?.source;
    return s && 'uid' in s ? s.uid : undefined;
  }

  /** Redraws the items when the inventory, the stash page, the selected tower's gear or the held item changed. */
  sync(): void {
    this.syncBelt();
    const trade = this.host.trade();
    // A trade opening (on either side) brings the panels up; its window replaces the stash
    if (trade && !this.shown) this.show();
    if (!this.shown) return;
    if ((trade ? 'trade' : 'stash') !== this.left) return this.show();
    if (trade) {
      const tt = this.tradeTexts;
      tt.theirName?.setText(trade.theirs.name);
      tt.theirGold?.setText(String(trade.theirs.gold));
      tt.myName?.setText(trade.mine.name);
      tt.myGold?.setText(String(trade.mine.gold));
      tt.theirReady?.setFrame(trade.theirs.accepted ? 3 : 2);
      tt.myReady?.setFrame(trade.mine.accepted ? 3 : 0);
    }
    const sim = this.host.sim();
    const tower = this.host.tower();
    this.goldText?.setText(String(sim?.state.gold[this.host.seat()] ?? 0));
    const pages = this.host.keeper.profile?.stash.length ?? 1;
    this.pageText?.setText(`Page ${this.page + 1} of ${Math.max(pages, this.page + 1)}`);
    const heldSlot = this.held?.source.from === 'tower' ? this.held.source.slot : '';
    const key = JSON.stringify([this.inventory(), this.left === 'stash' ? this.stash() : trade, tower?.id, tower?.gear, this.hiddenUid(), heldSlot, this.page]);
    if (key === this.itemKey) return;
    this.itemKey = key;
    for (const o of this.itemParts) o.destroy();
    this.itemParts = [];
    const inv = this.invBox();
    const st = this.stashBox();
    const hidden = this.hiddenUid();
    const drawGrid = (items: InvItem[], ox: number, oy: number) => {
      for (const i of items) if (i.item.uid !== hidden) this.drawItem(i.item, ox + i.x * CELL * S, oy + i.y * CELL * S);
    };
    // Items on offer stay in the inventory until the trade goes through: drawn faded there
    const offered = new Set(trade?.mine.items.map((i) => i.uid) ?? []);
    drawGrid(this.inventory().filter((i) => !offered.has(i.item.uid)), inv.left + INV.grid.x * S, inv.top + INV.grid.y * S);
    const faded = this.itemParts.length;
    drawGrid(this.inventory().filter((i) => offered.has(i.item.uid)), inv.left + INV.grid.x * S, inv.top + INV.grid.y * S);
    for (const o of this.itemParts.slice(faded)) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha?.(0.3);
    if (this.left === 'trade' && trade) {
      drawGrid(this.offerLayout(trade.theirs.items), st.left + TRADE.them.grid.x * S, st.top + TRADE.them.grid.y * S);
      drawGrid(this.offerLayout(trade.mine.items), st.left + TRADE.us.grid.x * S, st.top + TRADE.us.grid.y * S);
    } else if (this.m.stashBg) drawGrid(this.stash(), st.left + STASH.grid.x * S, st.top + STASH.grid.y * S);
    for (const [slot, spot] of Object.entries(INV.doll) as [Slot, (typeof INV.doll)[Slot]][]) {
      const x = inv.left + spot.x * S;
      const y = inv.top + spot.y * S;
      const item = slot === heldSlot ? undefined : tower?.gear?.[slot];
      if (item) {
        const b = this.host.data.bases[item.code];
        // Centred in the slot, as D2R draws a smaller item in a big slot
        const w = (b?.width ?? 1) * CELL * S;
        const h = (b?.height ?? 1) * CELL * S;
        this.drawItem(item, x + (spot.w * S - w) / 2, y + (spot.h * S - h) / 2);
      } else if (this.scene.textures.exists(hudKey(spot.art))) {
        this.itemParts.push(this.scene.add.image(x, y, hudKey(spot.art)).setOrigin(0).setScale(S).setDepth(DEPTH + 1).setAlpha(tower ? 1 : 0.35));
      }
    }
    if (!tower) {
      const c = { x: inv.left + 581 * S, y: inv.top + 160 * S };
      this.itemParts.push(this.scene.add.text(c.x, c.y, 'Select one of your towers to equip it', { fontFamily: FONT, fontSize: '14px', color: TIP.grey }).setOrigin(0.5).setDepth(DEPTH + 2));
    } else {
      const c = { x: inv.left + 581 * S, y: inv.top + 160 * S };
      this.itemParts.push(this.scene.add.text(c.x, c.y, `${tower.cls[0]!.toUpperCase()}${tower.cls.slice(1)} tower`, { fontFamily: FONT, fontSize: '14px', color: TIP.white }).setOrigin(0.5).setDepth(DEPTH + 2));
    }
  }

  private drawItem(item: Item, x: number, y: number): void {
    const data = this.host.data;
    const b = data.bases[item.code];
    const w = (b?.width ?? 1) * CELL * S;
    const h = (b?.height ?? 1) * CELL * S;
    // D2R tints the cell behind an item: blue for magic and better, red when it fits no tower class here
    this.itemParts.push(this.scene.add.rectangle(x + 1, y + 1, w - 2, h - 2, 0x1a2a6a, item.quality === 'normal' || item.quality === 'superior' || item.quality === 'low' ? 0 : 0.28).setOrigin(0).setDepth(DEPTH + 1));
    const tex = itemTexture(this.scene, data, item);
    if (tex) this.itemParts.push(this.scene.add.image(x + w / 2, y + h / 2, tex).setDisplaySize(w, h).setDepth(DEPTH + 2));
    else this.itemParts.push(this.scene.add.text(x + w / 2, y + h / 2, b?.name ?? item.code, { fontFamily: FONT, fontSize: '10px', color: TIP.white, align: 'center', wordWrap: { width: w } }).setOrigin(0.5).setDepth(DEPTH + 2));
    // Filled sockets show their gem or rune; empty ones D2R's socket
    if (item.sockets > 0) {
      const spots = socketSpots(item.sockets, b?.width ?? 1, b?.height ?? 1);
      spots.forEach(([cx, cy], k) => {
        const px = x + cx * CELL * S;
        const py = y + cy * CELL * S;
        const filler = item.socketed[k];
        const ftex = filler ? itemTexture(this.scene, data, filler) : undefined;
        if (this.scene.textures.exists(hudKey('gemSocket'))) this.itemParts.push(this.scene.add.image(px, py, hudKey('gemSocket')).setScale(S * 0.9).setDepth(DEPTH + 2).setAlpha(0.85));
        if (ftex) this.itemParts.push(this.scene.add.image(px, py, ftex).setDisplaySize(CELL * S * 0.8, CELL * S * 0.8).setDepth(DEPTH + 2));
      });
    }
    if ((item.quantity ?? 1) > 1) {
      this.itemParts.push(this.scene.add.text(x + 3, y + 2, String(item.quantity), { fontFamily: FONT, fontSize: '12px', color: TIP.white }).setDepth(DEPTH + 3));
    }
  }

  // ---- clicks ----

  /** The grid cell under a point, for an item of the held size placed centred on the cursor. */
  private cellAt(px: number, py: number, item: Item | undefined): { x: number; y: number } {
    const b = item ? this.host.data.bases[item.code] : undefined;
    const cell = CELL * S;
    const w = b?.width ?? 1;
    const h = b?.height ?? 1;
    return { x: Math.round(px / cell - w / 2), y: Math.round(py / cell - h / 2) };
  }

  private itemUnder(grid: 'inv' | 'stash', px: number, py: number): InvItem | undefined {
    const cell = CELL * S;
    const cx = Math.floor(px / cell);
    const cy = Math.floor(py / cell);
    const items = grid === 'inv' ? this.inventory() : this.stash();
    const hidden = this.hiddenUid();
    return items.find((i) => {
      if (i.item.uid === hidden) return false;
      const b = this.host.data.bases[i.item.code];
      return cx >= i.x && cx < i.x + (b?.width ?? 1) && cy >= i.y && cy < i.y + (b?.height ?? 1);
    });
  }

  private pickUp(item: Item, source: Source): void {
    this.held = { item, source };
    this.tip.hide();
    const tex = itemTexture(this.scene, this.host.data, item);
    const b = this.host.data.bases[item.code];
    const p = this.scene.input.activePointer;
    this.heldSprite?.destroy();
    if (tex) this.heldSprite = this.scene.add.image(p.x, p.y, tex).setDisplaySize((b?.width ?? 1) * CELL * S, (b?.height ?? 1) * CELL * S).setDepth(DEPTH + 60);
    this.host.sound(b?.useSound);
    this.itemKey = '';
    this.sync();
  }

  /** Puts the held item back where it was (right-click, or closing the panels). */
  dropHeld(): void {
    if (!this.held) return;
    this.held = undefined;
    this.heldSprite?.destroy();
    this.heldSprite = undefined;
    this.itemKey = '';
    this.sync();
  }

  private placed(): void {
    const b = this.held && this.host.data.bases[this.held.item.code];
    this.host.sound(b?.useSound);
    this.dropHeld();
  }

  private clickGrid(grid: 'inv' | 'stash', px: number, py: number, shift = false): void {
    const sim = this.host.sim();
    if (!sim) return;
    const tick = sim.state.tick;
    const under = this.itemUnder(grid, px, py);
    if (!this.held) {
      if (!under) return;
      // Shift-click sells where it sits, at the capped price
      if (shift) return this.sellFromGrid(grid, under.item);
      return this.pickUp(under.item, grid === 'inv' ? { from: 'inv', uid: under.item.uid } : { from: 'stash', uid: under.item.uid, page: this.page });
    }
    const { item, source } = this.held;
    const data = this.host.data;
    const hb = data.bases[item.code];
    // A gem, rune or jewel on a socketed item, or Smith's Hammer on an item: in the inventory only
    if (under && grid === 'inv' && (source.from === 'inv' || source.from === 'belt') && under.item.uid !== item.uid) {
      if (hb && (hb.isGem || hb.isRune || hb.isJewel) && under.item.sockets > under.item.socketed.length && !under.item.runeword) {
        this.host.issue({ type: 'socket', target: { uid: under.item.uid }, uid: item.uid });
        return this.placed();
      }
      if (hb?.consumable === 'socket') {
        this.host.issue({ type: 'hammer', target: { uid: under.item.uid }, uid: item.uid });
        return this.placed();
      }
    }
    const at = this.cellAt(px, py, item);
    if (grid === 'inv') {
      if (!fitsAt(sim, this.inventory().filter((i) => i.item.uid !== item.uid), item, at.x, at.y)) return this.host.toast('No room there');
      if (source.from === 'inv') this.host.issue({ type: 'moveItem', uid: item.uid, x: at.x, y: at.y });
      else if (source.from === 'belt') this.host.issue({ type: 'fromBelt', slot: source.slot, x: at.x, y: at.y });
      else if (source.from === 'stash') {
        this.host.keeper.sendOut(item, tick);
        this.host.issue({ type: 'stashOut', item, x: at.x, y: at.y });
      } else this.host.issue({ type: 'unequip', towerId: source.towerId, slot: source.slot, x: at.x, y: at.y });
      return this.placed();
    }
    // Into the stash
    if (under && under.item.uid !== item.uid) return this.host.toast('No room there');
    if (at.x < 0 || at.y < 0 || at.x + (hb?.width ?? 1) > STASH_W || at.y + (hb?.height ?? 1) > STASH_H) return this.host.toast('No room there');
    if (source.from === 'belt') return this.host.toast('Put it in the inventory first');
    if (source.from === 'stash') {
      if (!this.host.keeper.moveInStash(item.uid, this.page, at)) return this.host.toast('No room there');
    } else if (source.from === 'inv') {
      this.host.keeper.takeIn(item, tick, this.page, at);
      this.host.issue({ type: 'stashIn', uid: item.uid });
    } else {
      this.host.keeper.takeIn(item, tick, this.page, at);
      this.host.issue({ type: 'unequip', towerId: source.towerId, slot: source.slot, toStash: true });
    }
    this.placed();
  }

  /** Right-click on an inventory item uses it, as in D2: Wirt's Leg opens the cow portal. */
  private rightClick(px: number, py: number): void {
    const under = this.itemUnder('inv', px, py);
    if (!under || this.host.data.bases[under.item.code]?.consumable !== 'cowPortal') return;
    if (this.host.sim()?.state.cow) return this.host.toast('A cow portal is already open');
    this.host.issue({ type: 'cowPortal', uid: under.item.uid });
    this.hide();
  }

  private clickDoll(slot: Slot): void {
    const sim = this.host.sim();
    const tower = this.host.tower();
    if (!sim || !tower) return this.host.toast('Select one of your towers first');
    const worn = tower.gear?.[slot];
    if (!this.held) {
      if (worn) this.pickUp(worn, { from: 'tower', towerId: tower.id, slot });
      return;
    }
    const { item, source } = this.held;
    const hb = this.host.data.bases[item.code];
    if (worn && (source.from === 'inv' || source.from === 'belt') && hb && (hb.isGem || hb.isRune || hb.isJewel) && worn.sockets > worn.socketed.length && !worn.runeword) {
      this.host.issue({ type: 'socket', target: { towerId: tower.id, slot }, uid: item.uid });
      return this.placed();
    }
    if (worn && source.from === 'inv' && hb?.consumable === 'socket') {
      this.host.issue({ type: 'hammer', target: { towerId: tower.id, slot }, uid: item.uid });
      return this.placed();
    }
    if (source.from === 'tower') {
      if (source.towerId === tower.id && source.slot === slot) return this.dropHeld();
      return this.host.toast('Put it in the inventory first');
    }
    if (source.from === 'belt') return this.host.toast('Gems and runes go in sockets');
    const others = { ...tower.gear };
    delete others[slot];
    if (!canWear(this.host.data, item, slot, tower.cls, others)) return this.host.toast(wearRefusal(this.host.data, item, slot, tower));
    if (source.from === 'stash') this.host.keeper.sendOut(item, sim.state.tick);
    this.host.issue({ type: 'equip', towerId: tower.id, slot, item });
    this.placed();
  }

  private clickSell(): void {
    const sim = this.host.sim();
    if (!this.held || !sim) return;
    const { item, source } = this.held;
    if (source.from !== 'inv') return this.host.toast('Sell from the inventory');
    const price = sellPrice(sim, item);
    const sell = () => {
      this.host.issue({ type: 'sellItem', uid: item.uid });
      this.host.sound('item_gold');
      this.dropHeld();
    };
    if (item.unique || item.runeword || item.setItem) this.askConfirm(`Sell ${itemLines(this.host.data, item, this.host)[0]!.text} for ${price} gold?`, sell, () => this.dropHeld());
    else sell();
  }

  /** Shift-click: sells an inventory item in place, or a stash item through a free inventory spot. */
  private sellFromGrid(grid: 'inv' | 'stash', item: Item): void {
    const sim = this.host.sim();
    if (!sim) return;
    const sell = () => {
      if (grid === 'stash') {
        const spot = freeSpot(this.host.data, this.inventory(), item);
        if (!spot) return this.host.toast('No room in the inventory to sell from');
        this.host.keeper.sendOut(item, sim.state.tick);
        this.host.issue({ type: 'stashOut', item, ...spot });
      }
      this.host.issue({ type: 'sellItem', uid: item.uid });
      this.host.sound('item_gold');
    };
    this.confirmSale(item, sell);
  }

  /** Uniques, set items and runewords ask once; anything else sells at once. */
  confirmSale(item: Item, sell: () => void): void {
    const sim = this.host.sim();
    if (!sim) return;
    if (item.unique || item.runeword || item.setItem) this.askConfirm(`Sell ${itemLines(this.host.data, item, this.host)[0]!.text} for ${sellPrice(sim, item)} gold?`, sell, () => undefined);
    else sell();
  }

  private askConfirm(text: string, yes: () => void, no: () => void): void {
    this.closeConfirm();
    const cx = GAME_WIDTH / 2;
    const cy = 360;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.confirm.push(o), o);
    add(this.scene.add.rectangle(cx, cy, 520, 130, 0x000000, 0.92).setStrokeStyle(1, 0x7a6440).setDepth(DEPTH + 80).setInteractive());
    add(this.scene.add.text(cx, cy - 26, text, { fontFamily: FONT, fontSize: '18px', color: TIP.white, align: 'center', wordWrap: { width: 480 } }).setOrigin(0.5).setDepth(DEPTH + 81));
    const btn = (label: string, dx: number, fn: () => void) => {
      const b = add(this.scene.add.text(cx + dx, cy + 34, label, { fontFamily: FONT, fontSize: '20px', color: TIP.gold, backgroundColor: '#2a1c10', padding: { x: 14, y: 6 } }).setOrigin(0.5).setDepth(DEPTH + 81).setInteractive({ useHandCursor: true }));
      b.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
        e.stopPropagation();
        this.closeConfirm();
        fn();
      });
    };
    btn('Sell', -70, yes);
    btn('Keep', 70, no);
  }

  private closeConfirm(): void {
    for (const o of this.confirm) o.destroy();
    this.confirm = [];
  }

  // ---- tooltips ----

  /** How many of each rune the player holds, inventory and stash, stacks counted. */
  private ownedRunes(): Map<string, number> {
    const p = this.host.keeper.profile;
    const all = [...this.inventory(), ...(p?.stash.flat() ?? [])];
    const counts = new Map<string, number>();
    for (const { item } of all) {
      if (this.host.data.bases[item.code]?.isRune) counts.set(item.code, (counts.get(item.code) ?? 0) + (item.quantity ?? 1));
    }
    return counts;
  }

  private tipFor(item: Item, x: number, y: number, extra: Partial<{ sellPrice: number; setWorn: number }> = {}): void {
    const lines = itemLines(this.host.data, item, { ...this.host, owned: this.ownedRunes(), ...extra });
    this.tip.show(lines, x, y);
  }

  private hoverGrid(grid: 'inv' | 'stash', px: number, py: number, sx: number, sy: number): void {
    if (this.held) return this.tip.hide();
    const under = this.itemUnder(grid, px, py);
    if (!under) return this.tip.hide();
    const sim = this.host.sim();
    this.tipFor(under.item, sx, sy - 10, grid === 'inv' && sim ? { sellPrice: sellPrice(sim, under.item) } : {});
  }

  private hoverDoll(slot: Slot, x: number, y: number): void {
    if (this.held) return;
    const tower = this.host.tower();
    const item = tower?.gear?.[slot];
    if (!item) return this.tip.show([{ text: SLOT_NAMES[slot], colour: TIP.white }, { text: tower ? 'Empty' : 'Select one of your towers', colour: TIP.grey }], x, y);
    const setWorn = item.setItem ? Object.values(tower!.gear ?? {}).filter((i) => i.setItem && this.host.data.setItems.find((s) => s.id === i.setItem)?.set === this.host.data.setItems.find((s) => s.id === item.setItem)?.set).length : undefined;
    this.tipFor(item, x, y, setWorn ? { setWorn } : {});
  }

  private hoverSell(x: number, y: number): void {
    const sim = this.host.sim();
    if (!this.held || !sim) return this.tip.show([{ text: 'Sell', colour: TIP.gold }, { text: 'Drop an item from the inventory here to sell it', colour: TIP.white }], x, y);
    this.tip.show([{ text: `Sell for ${sellPrice(sim, this.held.item)} gold`, colour: TIP.gold }], x, y);
  }
}

const SLOT_NAMES: Record<Slot, string> = {
  weapon: 'Weapon',
  shield: 'Shield',
  helm: 'Helm',
  armor: 'Body Armor',
  gloves: 'Gloves',
  boots: 'Boots',
  belt: 'Belt',
  ring1: 'Ring',
  ring2: 'Ring',
  amulet: 'Amulet',
};

/** Why an item will not go on a tower, in a few words. */
function wearRefusal(data: ItemData, item: Item, slot: Slot, tower: Tower): string {
  const b = data.bases[item.code];
  if (!b || !b.slots.includes(slot)) return `That does not go in the ${SLOT_NAMES[slot].toLowerCase()} slot`;
  if (b.classOnly) return `Only ${b.classOnly === 'pal' ? 'Paladin' : b.classOnly === 'sor' ? 'Sorceress' : b.classOnly === 'nec' ? 'Necromancer' : 'another class'} towers can use that`;
  if (slot === 'shield') return 'Two-handed weapons leave no hand for a shield';
  if (b.twoHanded) return 'Take the shield off first: it is two-handed';
  return `The ${tower.cls} tower cannot use that`;
}

/** Where D2 draws sockets on an item of a size: centred columns and rows, cell units. */
export function socketSpots(n: number, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  if (w === 1) {
    for (let k = 0; k < n; k++) out.push([0.5, (h / (n + 1)) * (k + 1)]);
    return out;
  }
  const cols = n === 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols);
    const c = n % 2 === 1 && k === n - 1 && cols === 2 ? 0.5 : k % cols;
    const x = cols === 1 ? w / 2 : c === 0.5 ? w / 2 : 0.5 + c;
    out.push([x, (h / (rows + 1)) * (r + 1)]);
  }
  return out;
}

/** A D2R item tooltip: one line per text, each in its own colour, on a dark box. */
class ItemTip {
  private box: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {
    this.box = scene.add.graphics().setDepth(depth).setVisible(false);
  }

  show(lines: Line[], x: number, bottom: number): void {
    this.hide();
    const PAD = 10;
    this.texts = lines.map((l) => this.scene.add.text(0, 0, l.text, { fontFamily: FONT, fontSize: '15px', color: l.colour }).setOrigin(0.5, 0).setDepth(this.depth + 1));
    const w = Math.max(...this.texts.map((t) => t.width)) + PAD * 2;
    const lh = 19;
    const h = lines.length * lh + PAD * 2;
    const left = Math.max(4, Math.min(GAME_WIDTH - w - 4, x - w / 2));
    const top = Math.max(4, bottom - h);
    this.box.clear().fillStyle(0x000000, 0.85).fillRect(left, top, w, h).setVisible(true);
    this.texts.forEach((t, i) => t.setPosition(left + w / 2, top + PAD + i * lh));
  }

  hide(): void {
    this.box.setVisible(false);
    for (const t of this.texts) t.destroy();
    this.texts = [];
  }
}

