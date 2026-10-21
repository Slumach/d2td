// Canvas layout in game pixels, at zoom 1. No Phaser import, so the Electron main process
// can size its window from the same numbers. The map itself is drawn isometrically inside
// the map area (iso.ts); the HUD above and the panel below stay in screen space.

export const GAME_WIDTH = 1440;
export const HUD_HEIGHT = 64;
export const MAP_AREA_HEIGHT = 816;
export const PANEL_TOP = HUD_HEIGHT + MAP_AREA_HEIGHT;
/** 1440 x 1000: with a title bar it fits above the taskbar on a 1080p screen. */
export const GAME_HEIGHT = PANEL_TOP + 120;
