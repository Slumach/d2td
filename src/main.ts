import { startGame } from './render/start.ts';

// In a plain browser (npm run dev) the game starts at once. URL flags:
//   ?m0        the M0 pipeline proof (zombie walk and Paladin icons)
//   ?autoplay  a scripted opening that keeps calling waves
//   ?rich      plenty of starting gold, so autoplay reaches tiers and an evolution
//   ?speed=4   run the sim 4 times as fast
const params = new URLSearchParams(window.location.search);
startGame({
  m0: params.has('m0'),
  autoplay: params.has('autoplay'),
  rich: params.has('rich'),
  speed: Number(params.get('speed') ?? 1),
});
