// D2's hand cursor and D2R's Exocet font, both from the player's extraction. Before setup
// they do not exist yet, so loading fails quietly and runs again once setup is done.

let fontLoaded = false;
let cursorSet = false;

export const EXOCET = 'Exocet';

export async function loadFeel(): Promise<void> {
  if (!fontLoaded) {
    try {
      const face = new FontFace(EXOCET, 'url(ui/exocet.otf)');
      document.fonts.add(await face.load());
      fontLoaded = true;
    } catch {
      // Not extracted yet; the fallback font stands in
    }
  }
  if (!cursorSet) {
    try {
      const res = await fetch('ui/cursor.png', { method: 'HEAD' });
      if (res.ok) {
        // Phaser sets the canvas cursor inline (the hand on buttons); this wins over it
        const style = document.createElement('style');
        style.textContent = 'canvas { cursor: url(ui/cursor.png) 1 1, default !important; }';
        document.head.append(style);
        cursorSet = true;
      }
    } catch {
      // No cursor yet
    }
  }
}
