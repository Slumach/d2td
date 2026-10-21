// The world camera over the ring and the flat UI camera over it. The ring is bigger than
// the screen: drag (any button) or WASD and the arrow keys pan, the wheel zooms, and zoom
// is whole numbers only (1x, 2x, 3x) so classic sprites never land on a fractional scale.
//
// Every game object is drawn by one camera: whatever GameScene creates inside asWorld()
// belongs to the world, everything else (HUD, panel, tooltips) to the UI.

import Phaser from 'phaser';

import { WORLD_HEIGHT, WORLD_WIDTH } from './iso.ts';
import { GAME_HEIGHT, GAME_WIDTH } from './layout.ts';

export const ZOOMS = [1, 2, 3] as const;
/** World pixels per second the keys pan at zoom 1. */
const KEY_PAN = 900;
/** A press that moves less than this is a click, not a drag. */
const DRAG_SLOP = 6;

export class WorldView {
  readonly world: Phaser.Cameras.Scene2D.Camera;
  readonly ui: Phaser.Cameras.Scene2D.Camera;
  private building = false;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private press: { x: number; y: number; scrollX: number; scrollY: number; onUi: boolean; dragged: boolean } | undefined;

  constructor(
    private readonly scene: Phaser.Scene,
    /** A press released without dragging, on the map (not on the HUD). */
    private readonly onClick: (p: Phaser.Input.Pointer) => void,
  ) {
    for (const c of [...scene.cameras.cameras]) if (c !== scene.cameras.main) scene.cameras.remove(c);
    this.world = scene.cameras.main;
    this.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT).setRoundPixels(true).setZoom(2);
    this.ui = scene.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.ui.setRoundPixels(true);

    const route = (go: Phaser.GameObjects.GameObject) => (this.building ? this.ui : this.world).ignore(go);
    scene.sys.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, route);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.sys.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, route));

    const kb = scene.input.keyboard;
    if (kb) this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT', false) as Record<string, Phaser.Input.Keyboard.Key>;
    scene.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      this.press = { x: p.x, y: p.y, scrollX: this.world.scrollX, scrollY: this.world.scrollY, onUi: over.length > 0, dragged: false };
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const press = this.press;
      if (!press || !p.isDown || press.onUi) return;
      if (!press.dragged && Math.hypot(p.x - press.x, p.y - press.y) < DRAG_SLOP) return;
      press.dragged = true;
      const z = this.world.zoom;
      this.world.setScroll(press.scrollX - (p.x - press.x) / z, press.scrollY - (p.y - press.y) / z);
    });
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const press = this.press;
      this.press = undefined;
      if (press && !press.dragged && !press.onUi && p.button === 0) this.onClick(p);
    });
    scene.input.on('wheel', (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      const i = ZOOMS.indexOf(this.world.zoom as (typeof ZOOMS)[number]);
      this.zoomTo(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (dy < 0 ? 1 : -1)))]!, p);
    });
  }

  /** True while a drag is under way, so hover highlights can wait. */
  get dragging(): boolean {
    return this.press?.dragged === true;
  }

  /** Runs `make` with every object it creates drawn by the world camera. */
  asWorld<T>(make: () => T): T {
    const was = this.building;
    this.building = true;
    try {
      return make();
    } finally {
      this.building = was;
    }
  }

  /** A whole-number zoom, keeping the world point under `at` (or the centre) where it is. */
  zoomTo(zoom: number, at?: { x: number; y: number }): void {
    const cam = this.world;
    if (zoom === cam.zoom) return;
    const sx = at?.x ?? cam.width / 2;
    const sy = at?.y ?? cam.height / 2;
    const before = cam.getWorldPoint(sx, sy);
    cam.setZoom(zoom);
    cam.preRender();
    const after = cam.getWorldPoint(sx, sy);
    cam.setScroll(cam.scrollX + before.x - after.x, cam.scrollY + before.y - after.y);
  }

  centreOn(wx: number, wy: number): void {
    this.world.centerOn(wx, wy);
  }

  /** The world point under a screen point. */
  worldPoint(sx: number, sy: number): { x: number; y: number } {
    const p = this.world.getWorldPoint(sx, sy);
    return { x: p.x, y: p.y };
  }

  /** WASD and the arrow keys pan, at the same screen speed at every zoom. */
  update(deltaMs: number): void {
    const k = this.keys;
    const dx = (k['D']?.isDown || k['RIGHT']?.isDown ? 1 : 0) - (k['A']?.isDown || k['LEFT']?.isDown ? 1 : 0);
    const dy = (k['S']?.isDown || k['DOWN']?.isDown ? 1 : 0) - (k['W']?.isDown || k['UP']?.isDown ? 1 : 0);
    if (dx === 0 && dy === 0) return;
    const step = (KEY_PAN * deltaMs) / 1000 / this.world.zoom;
    this.world.setScroll(this.world.scrollX + dx * step, this.world.scrollY + dy * step);
  }
}
