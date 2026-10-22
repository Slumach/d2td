# Morning report (Oct 22)

Everything is committed on `main` (not pushed). Tests: 257 pass. The design doc (`design.md`) has a section per stage with the numbers, and every call made without asking is under **Overnight decisions**.

## What shipped

| Stage | Commit | In one line |
| --- | --- | --- |
| H: Acts 2 to 5 | before the night's stages | Every act's field and lair, rosters, superuniques, bosses. Done first so the rest is measured on real content. |
| A: economy | `0673e64` | Escalating build cost (220% per tower owned), no tower cap anywhere, boss HP ramp 60% to 900%, dearer tiers. |
| B: endless | `3db3a7e` | The run goes on past Hell Baal in 10-wave Tiers that walk Hell's waves at level 85+ with 3% compounding HP and damage. |
| C: item data | `a7acf33` | Every base, unique, set, affix, runeword, gem and rune from the tables; D2's rolls; the stat-to-tower mapping (table in design.md). |
| D: drops | `cea071d` | treasureclassex.txt as D2 rolls it: NoDrop, groups, quality with magic find, runes at 125%, Tier scaling, Smith's Hammer; labels on the ground, drop sounds. |
| E: inventory | `6cb8cc6`, `3e59e09` | D2R's inventory, stash and trade panels with D2R's HD item art; sockets, runewords, Smith's Hammer, selling with the stage cap, rune tooltips, the profile in app data, lockstep commands carrying item records. |
| Cow level | `ee0ca2c` | Wirt's Leg, the red portal, Moo Moo Farm, three cow waves with the Cow King. |
| F: item harness | `db0c1ab` | `npm run loot`: bots with no items, Normal and Nightmare loot, the whole campaign's loot, best in slot. |
| G: menu and HUD | `8d68a97` (and the earlier Stage 7 work) | The belt holds gems and runes to socket from; a character-select style page with stash value and best wave. |
| I: build | not committed (it is a build) | `release/D2 Tower Defense Setup 0.2.0.exe`, 109.3 MB. Payload check: zero Blizzard files. docs/install.md covers items, trading and where the profile lives. |

New tools: `npm run items` (what the item model reads), `npm run drops` (drop counts per difficulty), `npm run loot` (the item harness), `npm run cow` (the cow level harness).

## What missed

- **Item harness targets (Stage F), mostly.** Only MIXED3 with the whole campaign's loot lands on target (endless Tier 3). The Paladin bots die on wave 77 with or without modest loot because Hell Baal at 900% HP never dies; the Necromancer bot dies in Hell Act 2 whatever it wears (immunities); best in slot reaches waves 106 to 120, not 175 to 225, and that is an immunity wall in the Tiers, not the HP curve (gentler endless scaling did not move the Paladin bots). Details and the levers in design.md, Stage F. I did not retune A or B, because the numbers I tried do not reach the targets.
- **Stage A's own misses stand** (towers a little over target in Normal and Nightmare; the Paladin bot clears Hell; deaths come on filler waves, not bosses). See design.md, Stage A.
- **Not built:** the worn weapon does not change the tower's weapon layer (the class sprites are extracted with one weapon each); chance to cast on hit, open wounds and pierce are read but do nothing; D2's resistance-cutting item stats do nothing (the mapping says resist stats are nothing, and that is also why items cannot break immunities).
- **Trading** is tested in the sim (team and FFA, both accepts, refusals) and the window was rendered with a faked trade, but it has not been played between two real clients.

## What to look at first

1. **Play a run with items.** Pick up drops, open the inventory with I, click a tower and dress it, socket a rune from the belt, sell something. The panels are new and only I have clicked them.
2. **The item harness misses** (design.md, Stage F): decide whether the immunity schedule in the endless Tiers, the 900% Hell Baal, or giving -enemy resistance stats an effect is the lever you want.
3. **The cow level's difficulty**: eight packs of ten a wave makes 4 of 5 PALADIN runs lose to the cows at Hell Act 5. It is one number in `src/data/monsters.json` (cow packs, packSize).
4. **Smith's Hammer** is set to 10 drops in a million kills (the rate of Um and Ist in Hell), so almost nobody sees one before the Tiers. `balance.json` drops.smithsHammerPpm.
5. **The installer**: it passed the payload check and the smoke run below. I did not run it through the NSIS installer itself tonight; last night's fresh-install test covered that path.

## Smoke run of the built app

The unpacked build, started on an empty app data folder with `--smoke`: setup found the D2R install, extracted 1,921 files (every act, the items, the cow level's art and sounds), then played unattended: wave 1 cleared, 60 kills by wave 3, nothing in the log but the run. An installed 0.2.0 from before tonight re-extracts by itself on its next start (the extraction version moved from 14 to 18).
