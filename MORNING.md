# Report (Oct 24, afternoon): Eternal Conflict, 0.4.2

**0.4.2 is published** (https://github.com/Slumach/d2td/releases/tag/v0.4.2), and `main` is pushed. Tests: 337 pass; the payload check found zero Blizzard files. Every call made without asking is in design.md under **Pass three: Eternal Conflict (0.4.2)**, with a "Calls made" list after each group of items.

To try it: main menu, **Eternal Conflict**, set the game up, **Start game**. In a browser dev build: `?battle&team=2&race=paladin` (`&speed=4` to hurry). Bot against bot: `npm run battle` (`--team 2` for 2v2).

## What shipped

| Item | Commit | In one line |
| --- | --- | --- |
| 0: the name | `f9ae0b1` | Battle Mode is Eternal Conflict everywhere a player reads it; the menu button's hint is "Heaven against Hell, Legion style." |
| 1 to 4: fighters, kings, shards, HUD | `fe49d76` | Towers are fighters with charstats life that hold the creeps and fall for the round, rallying to the king when their pad is clear; build pads with spawn gates, both battlefields in one world; Tyrael and Baal on their platforms, hit by the leaks and striking back, with attack, life and regen; shards mined every tick, the pile counting them; the Legion HUD (wave box, scoreboard, send tray with monster icons). Legion's wave timing: 60 s first, then the countdown only when every creep on both sides is dead. |
| 5: game setup | `98fbc66` | D2R's options panel and D2R's checkboxes: random races or all pick, X1 to X4 sends, mirror, easy, the long game (waves 22 to 30), no champions; the host's setup shows in the lobby (protocol 4). |
| 6: menus | `2e1a182` | The changelog scrolls inside D2R's panel under its buttons; the lobby wears the panel and stone buttons. |
| 7: balance and release | see below | The harness rerun on the new fighters, races evened, 0.4.2 built, published and pushed. |

Items 1 to 4 are one commit: the HUD reads the state the fighters and shards changed and could not compile against the old sim on its own.

## The race table

1v1, 16 seeds, each pairing played from both sides (896 matches). Each cell is the row race's win rate against the column race.

| Race | Pal | Sor | Nec | Ama | Bar | Dru | Ass | Overall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Paladin | | 56 | 31 | 53 | 50 | 47 | 45 | **47** |
| Sorceress | 44 | | 53 | 63 | 44 | 38 | 50 | **48** |
| Necromancer | 69 | 47 | | 38 | 66 | 56 | 67 | **57** |
| Amazon | 47 | 38 | 63 | | 63 | 41 | 48 | **50** |
| Barbarian | 50 | 56 | 34 | 38 | | 50 | 69 | **49** |
| Druid | 53 | 63 | 44 | 59 | 50 | | 19 | **48** |
| Assassin | 55 | 50 | 33 | 52 | 31 | 81 | | **50** |

A king fell before wave 21 in 45% of 1v1 matches (50% of mirror matches).

2v2 (each team one race), sixteen seeds:

| Race | Pal | Sor | Nec | Ama | Bar | Dru | Ass | Overall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Paladin | | 31 | 56 | 41 | 56 | 41 | 53 | 46 |
| Sorceress | 69 | | 56 | 28 | 63 | 47 | 56 | 53 |
| Necromancer | 44 | 44 | | 41 | 41 | 47 | 42 | 43 |
| Amazon | 59 | 72 | 59 | | 69 | 59 | 66 | 64 |
| Barbarian | 44 | 38 | 59 | 31 | | 59 | 38 | 45 |
| Druid | 59 | 53 | 53 | 41 | 41 | | 59 | 51 |
| Assassin | 47 | 44 | 58 | 34 | 63 | 41 | | 48 |

In 2v2 every race but the Amazon is between 43% and 53%; the Amazon won 34% at 92% team gold and 64% at 99% and 106%, so it ships at 99% and flagged. A king fell before wave 21 in 50% of 2v2 matches and 55% of mirror matches.

The levers (balance.json `battle.races`): gold 85% Paladin, 98% Sorceress, 128% Necromancer, 86% Amazon, 170% Barbarian, 66% Druid, 120% Assassin; team gold on top 100%, 102%, 122%, 99%, 150%, 80%, 90%. New mode levers: `battle.teamWavePct` (waves at 155% in 2v2, 175% in 3v3, 195% in 4v4, because two pads of fighters rallying to one king left his life untouched), `battle.fighter` (lifePct 400, tierPct 100/220/500/1000/2000) and `battle.king` (600 life for one or two a side, 900 and 1,500 beyond; attack 15% a strike, 2% on bosses).

## What missed

- **Pairings.** Every race's overall 1v1 rate is within 47 to 57, but nine of the 21 pairings are outside 40 to 60; the worst is Druid against Assassin, 19 to 81 (the Assassin's traps on the path burst the Druid's summons). 2v2: every race but the Amazon is between 43% and 53%; the Amazon flips between 34% and 64% on seven points of team gold and ships at 64%. The levers are knife-edged (the Necromancer went 58% to 63% on a five-point step) and 16 seeds disagree with 8 by up to twenty points on a race.
- **3v3 and 4v4** were checked for king falls only (43% and 45% on two seeds); their race tables were not tuned.
- **references/d2td/** does not exist; the D2R screenshots in references/ stood in for "ours".
- **Gold-only play** is noted as a setup switch for later, not built.
- **Not tested in Electron or between two real PCs.** The sim, the lobby and the setup options are covered by tests (the relay's 2v2 over TCP included), and every screen was driven in a headless Chrome build with real clicks and screenshots.
- **Not tested against a human.** Every number comes from bots playing bots. The bot does hold its pad (tanks in front, the rest behind), but a human's first wave with one fighter was not played.

## What to look at first

1. **Play a 1v1 against a bot** and watch wave 1 with one or two fighters: do the creeps engage where you expect, do the life bars read, and is a fallen fighter obvious (dark, still, until the countdown)? Then let the pad clear and watch the fighters run to Tyrael.
2. **Zoom out** (wheel) and look at both fields: the enemy's pads lie 48 tiles along from yours. Decide whether the gap and the mirrored lane order read as two armies.
3. **The send tray** over the belt: the figures are the monsters' own standing frames; a few are small. Hover one for its price and income.
4. **The king's fights.** Leaks hit for their alive weight a swing; the king kills a normal creep in about seven strikes. If late leaks feel too slow or too deadly, the levers are `battle.king.attack.hitPct`, `damagePerWeight` and `damagePctPerWave`.
5. **Balance** by feel: `battle.fighter.lifePct` and `tierPct` are the global fighter levers, `teamWavePct` the team one, `battle.races` the per-race one; `npm run battle` remeasures 1v1 in about a minute, 2v2 in five.
