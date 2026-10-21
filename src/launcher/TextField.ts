// A one-line text box for Phaser scenes: click to focus, type, Backspace, Enter, and Ctrl+V
// pastes (through the page's paste event, which works without clipboard permission). Keys
// come straight from the page, not Phaser's keyboard queue, which mangles several keys
// pressed within one frame.

import Phaser from 'phaser';

import { FONT } from '../render/ui.ts';

export interface TextFieldOptions {
  value?: string;
  placeholder?: string;
  maxLength: number;
  /** Characters the field accepts; anything else is dropped as it is typed or pasted. */
  allowed?: RegExp;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
}

export class TextField {
  readonly parts: Phaser.GameObjects.GameObject[];
  private readonly text: Phaser.GameObjects.Text;
  private readonly box: Phaser.GameObjects.Rectangle;
  private focused = false;
  private caretOn = true;
  private readonly timer: Phaser.Time.TimerEvent;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onPaste: (e: ClipboardEvent) => void;
  private readonly onClickAway: (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => void;
  value: string;

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    private readonly opts: TextFieldOptions,
  ) {
    this.value = opts.value ?? '';
    this.box = scene.add.rectangle(x, y, width, 40, 0x24201a).setOrigin(0).setStrokeStyle(2, 0x5a4a30).setInteractive({ useHandCursor: true });
    this.text = scene.add.text(x + 10, y + 8, '', { fontFamily: FONT, fontSize: '22px', color: '#f0e8d0' });
    this.parts = [this.box, this.text];
    this.box.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => {
      e.stopPropagation();
      this.focus();
    });
    // A click anywhere else takes the focus away
    this.onClickAway = (_p, over) => {
      if (!over.includes(this.box)) this.blur();
    };
    scene.input.on('pointerdown', this.onClickAway);
    this.onKey = (e) => this.key(e);
    this.onPaste = (e) => {
      if (!this.focused) return;
      this.insert(e.clipboardData?.getData('text') ?? '');
      e.preventDefault();
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('paste', this.onPaste);
    this.timer = scene.time.addEvent({ delay: 500, loop: true, callback: () => ((this.caretOn = !this.caretOn), this.render()) });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    this.render();
  }

  focus(): void {
    this.focused = true;
    this.box.setStrokeStyle(2, 0xc89040);
    this.render();
  }

  blur(): void {
    this.focused = false;
    this.box.setStrokeStyle(2, 0x5a4a30);
    this.render();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKey);
    this.scene.input.off('pointerdown', this.onClickAway);
    window.removeEventListener('paste', this.onPaste);
    this.timer.remove();
    for (const p of this.parts) p.destroy();
  }

  private insert(s: string): void {
    const allowed = this.opts.allowed;
    const clean = [...s].filter((ch) => (allowed ? allowed.test(ch) : ch >= ' ')).join('');
    if (!clean) return;
    this.value = (this.value + clean).slice(0, this.opts.maxLength);
    this.opts.onChange?.(this.value);
    this.render();
  }

  private key(e: KeyboardEvent): void {
    if (!this.focused) return;
    if (e.key === 'Backspace') {
      this.value = this.value.slice(0, -1);
      this.opts.onChange?.(this.value);
      this.render();
    } else if (e.key === 'Enter') {
      this.opts.onEnter?.(this.value);
    } else if (e.key === 'Escape') {
      this.blur();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.insert(e.key);
    }
  }

  private render(): void {
    if (!this.text.active) return;
    const empty = this.value === '';
    const caret = this.focused && this.caretOn ? '_' : '';
    this.text.setText(empty && !this.focused ? (this.opts.placeholder ?? '') : this.value + caret);
    this.text.setColor(empty && !this.focused ? '#7a7260' : '#f0e8d0');
  }
}
