# Morning report (Oct 24): Battle Mode

**0.4.0 is published** (https://github.com/Slumach/d2td/releases/tag/v0.4.0), and `main` is pushed (6b2482f). The installer is 110.0 MB, and the payload check found zero Blizzard files. Tests: 326 pass. Every decision made without asking is in design.md: a **Battle Mode** section per stage, plus six new lines under **Overnight decisions**.

To try it: main menu, **Battle Mode**, pick your race, **Play against bots**. In a browser dev build, use `?battle` (`?battle=coop`, `&team=2`, `&race=paladin`). For bot against bot, run `npm run battle`.

## What shipped

| Stage | Commit | In one line |
| --- | --- | --- |
| 1: rules and map | `0af3a4a` | Lanes into the Worldstone, Tyrael striking leaks, 21 waves from the Fallen to Baal (bosses on 6, 10, 14, 17, 21), races are classes, shared build and fight phases, no items, a battle record on the profile. The 1v1 against a bot worked here. |
| 2: economy | `d30f737` | Kill gold plus base income; workers (D2's hirelings) bring Souls; Souls buy sends (Cow King to the Ancients, once-a-match act bosses) that raise the sender's income for good; king upgrades for the team. Every number is in balance.json `battle`. |
| 3: bots and matchmaking | `094e18e` | The battle bot; `npm run battle` (every pairing from both sides, win rates, the wave kings fell, 40 to 60% flags); a Battle Mode page on the menu; online lobbies with Battle and Co-op, team size, race and team picks, bots in empty seats (protocol 3, 4v4 with up to 8 humans); co-op with scheduled sends. |
| 4: presentation | `eb13033` | Both battlefields baked from the install for 1 to 4 lanes (Harrogath under siege on Act 5 snow, the Pandemonium Fortress on Act 4 plaza); the Worldstone; Tyrael; hirelings as workers; a HUD with kings, timer, income, Souls and the send panel; a Tab scoreboard with leaks and sends; D2 sounds; a D2 stone end panel. Extraction version 30. |
| 5: balance and release | `52fb897`, `6b2482f` | Races evened with balance.json percents, then 0.4.0 built, published and pushed. |

## The race table

1v1, 16 seeds, each pairing played from both sides (896 matches). Each cell is the row race's win rate against the column race.

| Race | Pal | Sor | Nec | Ama | Bar | Dru | Ass | Overall |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Paladin | | 47 | 66 | 63 | 41 | 50 | 47 | **52** |
| Sorceress | 53 | | 66 | 56 | 56 | 38 | 59 | **55** |
| Necromancer | 34 | 34 | | 53 | 50 | 59 | 72 | **51** |
| Amazon | 38 | 44 | 47 | | 34 | 53 | 59 | **46** |
| Barbarian | 59 | 44 | 50 | 66 | | 66 | 56 | **57** |
| Druid | 50 | 63 | 41 | 47 | 34 | | 50 | **47** |
| Assassin | 53 | 41 | 28 | 41 | 44 | 50 | | **43** |

In 2v2 (8 seeds), overall rates run from 44 to 54%: Paladin 44, Sorceress 49, Necromancer 53, Amazon 52, Barbarian 54, Druid 45, Assassin 53. Co-op with bots holds the Worldstone in 9 of 14 games.

The levers are in balance.json `battle.races`:

| Race | Gold | Team gold (2+ a side) | Damage |
| --- | --- | --- | --- |
| Paladin | 88% | 127% | |
| Sorceress | 165% | 100% | |
| Necromancer | 100% | 100% | |
| Amazon | 120% | 105% | |
| Barbarian | 100% | 100% | 250% |
| Druid | 125% | 110% | |
| Assassin | 75% | 90% | |

## What missed

- **Not every pairing is within 40 to 60%.** Every race's overall rate is, but 7 of the 21 1v1 pairings are not. The worst is Necromancer against Assassin, 72 to 28. One percent per race can't fix a pairing in both directions at once, and the results jump on small steps: the Paladin won 31% at 75% gold and 67% at 80%. 2v2 pairings spread wider (19 to 81) on fewer seeds.
- **Most matches go the distance.** Once the races were even, a king falls in about 1% of 1v1 matches and 9 to 12% of 2v2 matches. The rest are decided on Worldstone life after wave 21. In mismatched pairings (before the balance pass), a king fell in about a quarter of matches.
- **The Barbarian needed a damage lever, not just gold.** Its T1 towers do a quarter of the other classes' damage at the same price, because its melee is built around worn weapons and Battle Mode has none. The 250% damage is a balance.json number, but it is the only race with one.
- **Not tested by me in Electron or online between two real PCs.** The online path is covered by relay tests, including a 2v2 with two players and two bots over TCP that stays in lockstep. The menu and single-player battles were driven in a browser build with real clicks. Extraction version 30 was run here and works, and the installer's own first start will re-extract.
- **Balance against a human is untested.** Every number comes from bots playing bots. Waves 1 and 2 were set lower by hand after one Fire Bolt tower lost 36 of 100 life to wave 1.

## What to look at first

1. **Play a 1v1 against a bot** with your favourite race. Watch the opening: is wave 1 fair with one tower? Is the 20-second build phase long enough? Is the send panel readable?
2. **The two battlefields' look.** Open a 2v2 and drag across to the enemy side. Scenery density and the Worldstone crystal cluster are judgement calls (src/data/map/battle.json).
3. **Whether kings should fall more often.** If even matches should end before wave 21, the levers are `battle.king` (life, upgrades) and the send strengths (`battle.sends[].hpPct`). Each change moves the race table, which `npm run battle` remeasures in under two minutes.
4. **The Barbarian's 250% damage.** If that feels wrong, the alternative is a fixed battle weapon per melee race, which is a design call.
