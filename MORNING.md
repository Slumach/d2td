# Report (Oct 25): Eternal Conflict pass four, 0.4.6

**0.4.6 is published** (https://github.com/Slumach/d2td/releases/tag/v0.4.6), and `main` is pushed. Tests: 345 pass; the payload check found zero Blizzard files. The design notes are in design.md under **Pass four: the pad, the sends (0.4.6, Oct 25)**, with a "Calls made" list.

Earlier today: 0.4.3 (random towers), 0.4.4 (the team-game freeze, War Cries in D2's order, 300-gold towers in Eternal Conflict) and 0.4.5 (saves loading again).

## What shipped

| Item | Commit | In one line |
| --- | --- | --- |
| Creeps cross the pad | `9f12595` | No road through the pad: creeps come through the gate anywhere across it and walk a cost field to the exit, round your fighters where there is a way and into them where you wall it; a fighter beside their way is met in passing. The bot walls row 10. |
| Sends land as a group | `9f12595` | Every monster of a send on one tick, a second behind the wave. |
| Thirty sends, auras | `9f12595` | Sends open and close by wave (a dozen or so on the tray at a time, two rows). New: Blood Raven, Griswold, the Smith, Bloodwitch, Bremm (Might), the High Council, Hephasto (Holy Freeze), Diablo's Seals (Fanaticism, 60 shards), Izual, Frozenstein, Shenk and Eldritch, Pandemonium (120% life under Fanaticism, 110 shards). Tooltips name the pack, its mods and its aura. |
| Drops past Hell | `ecd6d24` | 3% more a wave, compounding, instead of 25% a Tier. |
| Legends keep their level | `fc0d99c` | Tyrael starts at the highest level of the three towers (ascending reset them to 5: that was the 140k to 50k); the panel counts the riders' damage. |
| Javelins | `5250e50` | Amazon towers wear them (the thrown-weapon rule caught them first). They lend stats, not damage: the javelin skills' damage is the table's poison and lightning. |
| Races retuned | `e55c9c4` | The pads changed the table (walls favour melee and summons): tuner rounds on eight seeds, the best round shipped. |

## The race table

1v1, eight seeds, each pairing from both sides (448 matches), at the shipped percents (gold 95% Paladin, 125% Sorceress, 110% Necromancer, 115% Amazon, 120% Barbarian, 60% Druid, 125% Assassin; team percents unchanged).

| Race | Pal | Sor | Nec | Ama | Bar | Dru | Ass | Overall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Paladin | | 63 | 50 | 50 | 38 | 44 | 56 | **50** |
| Sorceress | 38 | | 25 | 38 | 69 | 50 | 47 | **44** |
| Necromancer | 50 | 75 | | 69 | 31 | 75 | 59 | **60** |
| Amazon | 50 | 63 | 31 | | 50 | 31 | 63 | **48** |
| Barbarian | 63 | 31 | 69 | 50 | | 88 | 50 | **58** |
| Druid | 56 | 50 | 25 | 69 | 13 | | 75 | **48** |
| Assassin | 44 | 53 | 41 | 38 | 50 | 25 | | **42** |

A king fell before wave 21 in 36% of matches (27% of mirrors). The levers are as knife-edged as before: the same percents swung the Sorceress between 34% and 55% across rounds, so treat 42 to 60 as the noise band. 2v2 was not rerun.

## What to look at first

1. **Wall your pad** in a 1v1 against a bot: tanks right across a row, damage behind. Watch a wave fan out from the gate and pile into the wall; then leave a three-tile gap and watch them stream through it and hit the fighters at its edges.
2. **Send Diablo's Seals** at wave 14 or later (60 shards) and watch the whole pack land at once under Fanaticism; hover the tray for the tooltip.
3. **Make a legend** in the campaign from a high-level evolution and check the panel's damage goes up, not down.

## What missed

- No ring is drawn under a monster that carries an aura; the tooltip is the only tell.
- The uber bosses (uberbaal and the rest are in monstats.txt) would make a fine dearest send; they need art extraction and a monsters.json entry.
- The bot sends by cost alone; it does not weigh auras.
- Balance is one tuner round on eight seeds; the Barbarian against the Druid (88 to 13) is the pairing to watch.
