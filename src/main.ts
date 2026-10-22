import { loadFeel } from './render/feel.ts';
import { startGame } from './render/start.ts';

// Inside Electron the preload exposes window.d2td, and setup and the main menu come first.
// In a plain browser (npm run dev) the game starts at once. URL flags:
//   ?m0        the M0 pipeline proof (zombie walk and Paladin icons)
//   ?autoplay  a scripted opening that keeps calling waves
//   ?rich      plenty of starting gold, so autoplay reaches tiers and an evolution
//   ?plan=sorceress or ?plan=necromancer   autoplay builds that class instead
//   ?speed=4   run the sim 4 times as fast
//   ?wave=26   start the run at that wave of the campaign (to look at a later act)
//   ?menu      the launcher's menus on a stub of the Electron API, to look at them in a browser
const params = new URLSearchParams(window.location.search);
// The cursor and font come from the extraction; before first setup they simply are not there
await loadFeel();
if (window.d2td) {
  startGame({ launcher: window.d2td });
} else if (params.has('menu')) {
  startGame({ launcher: (await import('./launcher/stub.ts')).stubLauncher() });
} else {
  startGame({
    m0: params.has('m0'),
    autoplay: params.has('autoplay'),
    rich: params.has('rich'),
    plan: params.get('plan') ?? undefined,
    speed: Number(params.get('speed') ?? 1),
    startWave: Number(params.get('wave') ?? 1),
  });
}
