import { loadFeel } from './render/feel.ts';
import { startGame } from './render/start.ts';

// Inside Electron the preload exposes window.d2td, and setup and the main menu come first.
// In a plain browser (npm run dev) the game starts at once. URL flags:
//   ?m0        the M0 pipeline proof (zombie walk and Paladin icons)
//   ?autoplay  a scripted opening that keeps calling waves
//   ?rich      plenty of starting gold, so autoplay reaches tiers and an evolution
//   ?speed=4   run the sim 4 times as fast
const params = new URLSearchParams(window.location.search);
// The cursor and font come from the extraction; before first setup they simply are not there
await loadFeel();
if (window.d2td) {
  startGame({ launcher: window.d2td });
} else {
  startGame({
    m0: params.has('m0'),
    autoplay: params.has('autoplay'),
    rich: params.has('rich'),
    speed: Number(params.get('speed') ?? 1),
  });
}
