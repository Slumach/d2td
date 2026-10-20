// Whole-canvas zoom: the largest whole number of screen pixels per game pixel that fits,
// so nearest-neighbour sprites never land on a fractional scale. The rest is letterbox.

/** Screen pixels per game pixel. Never below 1, even when the view is smaller than the game. */
export function integerZoom(viewWidth: number, viewHeight: number, gameWidth: number, gameHeight: number): number {
  return Math.max(1, Math.min(Math.floor(viewWidth / gameWidth), Math.floor(viewHeight / gameHeight)));
}
