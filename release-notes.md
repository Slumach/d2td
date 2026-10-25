0.4.5

- Fixed saves not loading: a save with missiles in flight, or one past Hell Baal in the endless run, crashed on its first tick because the loaded game had not yet built the skill variants and endless waves the save named. They are built on load now.

0.4.4

- Fixed a freeze in team games: a Berserk tower's hit set a monster's life to a non-number, which the lockstep check caught and stopped the match on.
- The Barbarian's War Cries line runs in D2's order: Find Item, then Shout or Battle Cry, then Battle Orders or War Cry. The Singer and the Whirlwind Barb take War Cry at T3.
- Eternal Conflict: a tower costs 300 gold, not the campaign's 600.

0.4.3

- Random towers in the game setup is Legion's random builder: a fresh roll of four lines from different races every wave, and only those build that wave (0.4.2 shipped it as random races by mistake).

0.4.2

- Battle Mode is now Eternal Conflict: Heaven against Hell, Legion style.
- Your towers are fighters. Each has life (its class's own, growing with its skill's level and tier), stands in the creeps' way and is hit by them; at zero life it is down for the round and stands again at the next countdown. When your pad is clear your fighters run to the king and fight the leaks there.
- Kings: Tyrael holds Harrogath and Baal the Pandemonium Fortress, each on a stone platform at the end of the road. Leaks stand at his feet and hit him; he strikes back. His upgrades are attack, life and regeneration, bought from his panel (click him) or the left panel. The Worldstone is gone.
- Build pads: each player's ground is a pad with a drawn grid, a spawn gate at its top, and the creeps walking straight down through it. Both battlefields are on one map, the enemy's beside your own; drag across to watch them.
- Legion's wave timing: 60 seconds before the first wave, then the 20-second countdown starts only when every creep on both sides is dead. The HUD shows the countdown while it runs and who is still fighting while it is not.
- Souls are Worldstone shards, mined all match long: each worker adds a tenth of a shard a second, the pile beside your pad counts them, and the HUD shows the rate.
- The HUD: the wave box top centre, the scoreboard on the right (value, income, shards, bounty, West and East alive, the kings' life), the send panel over the belt with each monster's own figure and its shard cost.
- A game setup screen before a conflict: random towers (a fresh roll of lines from different races every wave) or all pick, X1 to X4 sends, mirror mode, easy mode, the long game (waves 22 to 30), no champions, with D2R's own checkboxes. The host's setup shows in the lobby.
- The update page's changelog scrolls inside D2R's panel; the lobby wears the same panel and stone buttons.
- Setup extracts the rebuilt battlefields, Baal's standing art, the classes' stats and the checkbox on the first start after the update.

0.4.1

- Fixed: Amazon towers could not wear a bow, and the message blamed a shield that was not there. Amazon towers now wear bows and crossbows, and her bow skills fire the bow she wears. When an item will not go on a tower, the message gives the real reason.
- Melee towers swing a better weapon at each tier, in the campaign and in Battle Mode: the normal weapon at T1, its exceptional version at T2 and its elite version at T3 (a Barbarian's Double Axe becomes a Twin Axe, then an Ettin Axe). A weapon a tower wears still replaces it. Nightmare's monsters were evened so the other classes do not fall behind.
- Battle Mode: Worldstones fall. It has less life and gains less from its upgrades, leaks hurt it more as the waves go on, and sends late in the match are tougher. About half of even matches now end before wave 21.
- Battle Mode: every tower costs the same 600 gold to build again, however many you own.
- Battle Mode: the first waves are a little easier, so one or two towers hold them.
- Battle Mode: the Barbarian no longer gets extra damage; with its new weapons it holds its own. The races' gold is evened again.
- Battle bots keep their towers ahead of the Worldstone's life: they buy it life only with gold they are not saving for a tower.

0.4.0

- Battle Mode, Legion TD style: two teams, a lane each, running into the team's Worldstone with Tyrael beside it. Harrogath under siege against the Pandemonium Fortress. Pick a race (any class, or random), build its towers beside your lane, and survive 21 waves from the Fallen to Baal. The first Worldstone to fall loses; after wave 21 the one with more life wins.
- Workers in your back row (D2's hirelings) bring Souls each wave. Souls buy sends from D2's superuniques and champion packs, from the Cow King to the Ancients, and once a match each act boss, onto the enemy lane you choose. Every send raises your gold income for good.
- Gold buys the Worldstone more life and regeneration and a harder strike for Tyrael, for the whole team.
- 1v1 to 4v4 against bots from the main menu's Battle Mode page, or online: the host sets the team size, everyone picks a race and a team, and bots fill the empty seats. Co-op plays one team against the waves, sends arriving on a timer.
- No items in Battle Mode. The profile keeps your wins, losses and best wave.
- Setup extracts the two battlefields and the hirelings on the first start after the update.

0.3.17

- Fixed: the build menu only offered the Paladin, the Sorceress and the Necromancer. Every class has its tab now: the Amazon, the Barbarian, the Druid and the Assassin too.
- The message for a class-only item on the wrong tower names all seven classes.

0.3.16

- The Amazon's Javelin line climbs in D2's order: Poison Javelin, then Plague Javelin, then Lightning Fury at the top. Lightning Fury is much weaker than it was at T2 and sits with the other top-tier towers. The Fishyzon evolves from a T2 Plague Javelin; the Javazon needs a T3 Lightning Fury.
- Poison towers are measured by the damage they really deal (a dose replaces the last one instead of stacking). Poison Nova gains a little to keep its place.
- Firestorm works: its flames lie under the target and burn for every moment they touch it, as in D2. A level 5 Firestorm deals about 70 damage a second instead of 2. Fissure starts a level higher to stay ahead of it.
- Crushing blow follows D2's rules: an eighth of a champion's life (a quarter for normal monsters), and it now works on bows at half strength. It never takes more than 25 times the hit's own damage, so it no longer carries a Barbarian through endless on its own.

0.3.15

- Decoy and Shadow Master show: they are drawn as the Amazon and the Assassin, as in D2. Lightning and Death Sentry traps animate instead of standing frozen.
- More of D2's sounds: the War Cries, Bash, Concentrate, Berserk, Arctic Blast, Fire Blast and Tiger Strike play theirs, and Double Swing, Frenzy and Vengeance swing their weapon audibly.
- Concentrate, Arctic Blast, Tiger Strike and Decoy play their D2 cast effects.
- Tower panels say what every tower does: Pierce's pass-through chance, Shout's defence for summons, what each curse does (Battle Cry's damage cut, Cloak of Shadows' blind), and what each summon tower raises (ravens, dire wolves, grizzlies, traps on the path). Skill names are the game's (Decoy, Fissure, Fire Blast, Phoenix Strike).
- Poison skills show their real damage per second: a dose does not stack, and the panel used to count every throw's whole dose at once.
- Setup extracts a few more sounds and effects on the first start after the update.

0.3.14

- Tier-up choices say where each branch leads: picking Concentration or Holy Freeze shows that both lead on to Fanaticism or Conviction, and which evolutions each one is part of (Concentration makes a Hammerdin with a Blessed Hammer tower). The T3 choice shows its evolutions too.
- The evolve hint no longer suggests a recipe the tower has branched away from (a Holy Freeze tower is never offered the Hammerdin).
- Tier-up buttons read "T2: Concentration" and fit their buttons.

0.3.13

- Magic, rare and set items count double for the stats a tower converts (resistances, life, mana, attack rating and the rest), so a good rare or a set piece holds its own beside a unique. Uniques and runewords are unchanged.
- Life and defence on a tower with no summons that block now add a little damage instead of nothing.
- Fixed: a melee tower wearing a weapon lost its tier's damage bonus. A T3 Vengeance with a found sword swung it at a third of its strength.

0.3.12

- Hell is much harder: its monsters have many times the HP they had, so towers without good items stop in Hell's first two acts. Normal and Nightmare are unchanged.
- Fixed endless monsters above level 110, whose HP, damage and defence grew far too fast; endless now climbs a little faster each wave instead (4% a wave).
- Baal's endless wave is still a big step: that is his own HP in the game's tables.

0.3.11

- Every item stat now does something on a tower. Resistances add that element's damage, life and defences make your summons hold monsters longer, mana and mana regeneration speed up casting, attack rating adds damage against champions and uniques, knockback and flee slow, blind can stun, and when-struck casts trigger on hit. Tooltips show the tower effect first, with D2's wording after it.
- Plain items stay a small bonus, magic a little more, and rares, set items, uniques and runewords carry the real power.
- Waves come every 30 seconds instead of 45.
- Waves spawn in the middle of each side of the ring instead of beside a corner.
- Zombies walk faster: halfway from their shamble to their run.

0.3.10

- Waves come back to full strength: every wave spawns with the monster HP the game's tables give it. 0.3.9's smoothing had cut whole runs of waves after any small one.
- Only superunique and champion packs are trimmed, so a pack can add at most 30% to its wave (150% on a boss wave). Normal and Nightmare play as in 0.3.8.
- Travincal's Council is still three strong in its waves, and the Durance's three still come with Mephisto.

0.3.9

- Build prices are flat again: every tower costs 600, however many you own.
- Smoother waves: no wave carries more than 1.3 times the monster HP of the one before it, and no boss wave more than 2.5 times. Superunique packs shrink to fit. Travincal's Council is three strong in its waves, and the Durance's three come with Mephisto.
- The early acts are easier than in 0.3.8 as a result.

0.3.8

- Evolutions reach further: an evolved tower fires more arrows, bolts and jumps, swings more often and covers more ground than its parents, and each evolved level adds more.
- Evolve with any partner on your ring: no more placing towers side by side. The tower you select evolves and stays where it is; the partner is used up. If several towers qualify, the panel asks which.
- Each tower you own raises the next build's price by 15%, so a few evolved towers beat a field of small ones.
- Team games: every player's arc is tinted in their colour, with their name at its corner and a marker at its spawn; zoomed out, your own arc stands out. Home takes the camera back to your arc.

0.3.7

- Monsters are tougher from Normal Act 2 on, tuned so a regular monster takes two or three hits from the towers you have at that point, rather than dying to one. Bosses more.
- The top tiers hit more per attack: T3 skills, evolved towers and their levels cover more ground, fire more arrows, bolts and jumps, swing more often, and set more traps.
- Each tower you own raises the next build's price by 10%, so building wide costs more and upgrading holds its own.

0.3.6

- Gold on kill: each kill shows the gold it paid over the corpse, gold find and Find Item included. Options can turn it off.
- Enchant no longer hides the towers it reaches: a faint ember on the weapon, and the full flame only now and then.
- Every class hides a secret beyond its evolutions. Put three of a class's evolutions side by side and see.
- Setup extracts a little more art on the first start after the update.

0.3.5

- Towers wear what you give them: a worn weapon shows in the tower's hands in its own stance (a bow on a Paladin draws like a bowman), and a shield on its arm. The look is made from your D2R install the first time a tower wears that pair.
- The Amazon's bow line holds its bow.
- Rune tooltips: a runeword reads green when you hold every rune for it; otherwise the runes still missing are listed in grey.
- Setup re-extracts the hero art on the first start after the update.

0.3.4

- Prices: every tower costs the same 600 to build, however many you own. The top of a line is dearer and much stronger: T3 starts at three times what the T2 it replaces could do, an evolution is worth four times its two parents, and evolved towers and T3 lines keep levelling at a price that grows 15% a level.
- Find Item is a gold aura: monsters killed near it, by any tower, pay its chance as extra gold (51% at level 5). The aura panel shows it.
- Free for all: pan past the edge of your ring to the next player's, or click their name under the map; you see their towers, monsters and globes. Tab (or the Party button) opens a scoreboard of every player's kills, alive count, gold, towers and wave. The automap moved to M.
- Online: hosting goes through a relay server first when one is set, so friends can join without router setup; the router and direct codes remain.
- Hurricane swirls its rocks and branches round the tower; Cloak of Shadows shows its mist on the monsters it blinds.
- Missile art added since the first setup now loads (some spells drew nothing before re-extracting).

0.3.2

- The Barbarian's War Cries are a support line: Battle Cry weakens the monsters in reach (less damage, lower defence), War Cry stuns, Shout protects the summons of nearby towers and Battle Orders makes nearby towers hit harder. Find Item is a first-tier pick that re-finds a corpse's gold and drop. His melee reaches the diagonal path tiles too.
- The Assassin's Lightning Sentry and Death Sentry are traps set on the path, firing from where they stand; Phoenix Strike casts its meteor, chain lightning and ice charges in turn.
- Lightning, Chain Lightning and Static Field use D2's own lightning art instead of drawn lines; spells play their D2 cast overlays; Fist of the Heavens throws its holy bolts at the monsters around the strike.
- The act bosses play their full D2 death animations, Diablo's and Baal's included.

0.3.1

- Evolutions are a real jump: an evolved tower fires both its lines and is worth about 2.5 times the two towers it replaced (a maxed Blizzard evolved into a Blizzballer at the same damage before).
- Evolved towers keep levelling: each level past 5 raises both their skills, at a price that grows 80% a level.
- Every line levels forever: past level 5 a tower keeps growing in its own tier (Holy Freeze, Might, any line), so tiering up is a choice, never forced.
- A new tower stays affordable late in the game: past the fifth tower the price rises 30% a tower instead of 120%.

0.3.0

- Four new classes: the Amazon (bow, javelin, passives), the Barbarian (combat, whirlwind, war cries), the Druid (fire, wind, summoning) and the Assassin (traps, martial arts, shadow), each with three lines, three tiers and three evolutions, their D2R figures, missiles and summons, and their class items equipping on them.
- Setup extracts the new art on the first start after the update.

0.2.4

- Fixes the launch error of 0.2.3 (the solo spawn mark was made before the text it writes through).
- The selected tower's panel no longer overlaps its own text or the life globe; the Evolve button carries the cost, and the panel says what an evolution still needs.
- No volume spike after alt-tab.
- The life globe starts full and drains as the ring fills (100 alive a player loses it); the mana globe is your share of the game's kills; the numbers above them say which.
- Gold is always shown in the right skill slot.

0.2.3

- Zoom has a 1.5x step; the screen fit uses whole device pixels so display scaling never blurs the canvas.
- Starting gold 800: two towers and most of a third at the start.
- Every armour piece gives its tower a small built-in bonus (1 to 3% damage, attack speed or cast rate by base tier); arrows and bolts no longer drop.
- Alone, every monster comes in at one marked corner of the ring.
- Loot filter in Options: the default collects magic and better, socketed and superior items, gems and runes; Alt shows every label.

0.2.2

- Items, stash and trading: every stat from the tables now acts, including the pierce stats, item auras (Infinity), chance to cast, open wounds and pierce; +skill tabs work.
- Fewer, better drops: 15% of D2R's items fall and 40% of its gems and runes, with every rarity at D2R's own ratio.
- Shift-click sells an item in the inventory, the stash, or on the ground.
- Aura towers show their radius and D2's aura glow on the towers they reach; every tower's panel breaks out what the auras add.
- New Game on the character page starts over from nothing.
- Hell Baal at 450% HP instead of 900%.
- Update button on the main menu.
