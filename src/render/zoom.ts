// Whole-canvas zoom: the largest whole number of screen pixels per game pixel that fits,
// so nearest-neighbour sprites never land on a fractional scale. The rest is letterbox.

/** Screen pixels per game pixel. Never below 1, even when the view is smaller than the game. */
export function integerZoom(viewWidth: number, viewHeight: number, gameWidth: number, gameHeight: number): number {
  return Math.max(1, Math.min(Math.floor(viewWidth / gameWidth), Math.floor(viewHeight / gameHeight)));
}

export interface Letterbox {
  /** Device pixels per game pixel: a whole number. */
  devicePixels: number;
  /** The canvas zoom in CSS pixels (devicePixels / devicePixelRatio), which Phaser takes. */
  cssZoom: number;
  /** The canvas's left and top margin in CSS pixels, chosen so its edge sits on a device pixel. */
  left: number;
  top: number;
  /** The letterbox in device pixels on each axis (the whole remainder; the margins split it). */
  spareWidth: number;
  spareHeight: number;
}

/**
 * Where the canvas sits in a window of `cssWidth` x `cssHeight` CSS pixels at a device
 * pixel ratio: the largest whole number of device pixels per game pixel that fits, and
 * margins that put the canvas on a device pixel boundary, so Windows display scaling
 * (125%, 150%) never resamples it. A window smaller than the game gets zoom 1 and no
 * margins (the page scrolls).
 */
export function letterbox(cssWidth: number, cssHeight: number, dpr: number, gameWidth: number, gameHeight: number): Letterbox {
  const viewW = Math.round(cssWidth * dpr);
  const viewH = Math.round(cssHeight * dpr);
  const devicePixels = integerZoom(viewW, viewH, gameWidth, gameHeight);
  const spareWidth = Math.max(0, viewW - gameWidth * devicePixels);
  const spareHeight = Math.max(0, viewH - gameHeight * devicePixels);
  return {
    devicePixels,
    cssZoom: devicePixels / dpr,
    left: Math.floor(spareWidth / 2) / dpr,
    top: Math.floor(spareHeight / 2) / dpr,
    spareWidth,
    spareHeight,
  };
}
