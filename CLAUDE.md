# D2 Tower Defense (working title)

Non-commercial fan project: a fixed-path tower defense built from Diablo II's own data and art.
The full design lives in @docs/design.md. Read it before planning any feature.

## Hard rules

- Never commit a Blizzard file. `assets-raw/` (CascView exports) and `assets-extracted/` (our decoded output) are gitignored and stay that way. If a task would add a .dcc, .dc6, .cof, .sprite, .txt table, .wav or .png decoded from game data to git, stop and say so.
- The simulation is deterministic from day one: fixed 20 ticks per second, a seeded RNG (no Math.random), integer math in gameplay code (no floating point in positions, damage or timers), and player actions enter the sim only as commands. Rendering never feeds back into the sim. This is what makes lockstep multiplayer a transport layer later instead of a rewrite.
- Skills are data on ten archetypes (see the Skill archetypes section of the design doc). Do not write per-skill code; add a JSON entry and, if needed, extend an archetype.
- Numbers come from the D2 data tables (monstats.txt, skills.txt, missiles.txt) parsed to JSON by the pipeline. Do not hand-type stats that exist in those tables.

## Stack

- TypeScript (strict), Vite, Phaser 3 for the game. Vitest for the data layer.
- `tools/` holds the Node asset pipeline: decoders for DCC, DC6, COF, PL2 palettes and D2R .sprite, plus the .txt table parser. Port decoders from OpenDiablo2 (Go) or libd2 (Zig) rather than writing from scratch, and say which file you ported from.
- Electron and multiplayer come at M5. Do not add them earlier.

## Layout

- `src/sim/` pure simulation, no Phaser imports, fully unit-tested
- `src/render/` Phaser scenes that read sim state
- `src/data/` JSON produced by the pipeline (gitignored where it derives from game files)
- `tools/` asset pipeline scripts
- `docs/` design doc and notes

## Working style

- Follow the milestones in the design doc in order; each has a gate. Do not start the next until the gate passes.
- Small commits with plain messages. Ask before adding a dependency.
- No em-dashes anywhere, including comments and UI text.
