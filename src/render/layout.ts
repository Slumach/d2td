// Canvas layout in game pixels, at zoom 1. No Phaser import, so the Electron main process
// can size its window from the same numbers.

/** Render-side tile size. The sim's tile is UNITS_PER_TILE units and does not change with it. */
export const TILE = 48;
export const HUD_HEIGHT = 64;
export const MAP_HEIGHT = 17 * TILE;
export const PANEL_TOP = HUD_HEIGHT + MAP_HEIGHT;
export const GAME_WIDTH = 30 * TILE;
/** 1440 x 1000: with a title bar it fits above the taskbar on a 1080p screen. */
export const GAME_HEIGHT = PANEL_TOP + 120;
