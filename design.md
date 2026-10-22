# D2 Tower Defense: Design Doc v0.1

Oct 20, 2026 · @Alexander

## Concept

A fixed-path tower defense built from Diablo II's own data and art, where every tower is a D2 class and every endgame tower is a famous build. You place a class, pick a skill, upgrade it up the tree, and fuse two upgraded towers into a Hammerdin, a Zealdin or a Meteorb. The recognition factor is the hook: D2 players already know what they want to build.

Non-commercial fan project. The game ships zero Blizzard assets and reads them from the player's own Diablo II: Resurrected install, the same posture as D2 Survivors.

## Decisions locked (Oct 20)

- Unit art: classic D2 sprites at 1x in D2's own 2:1 isometric view (M5), nearest-neighbour, never scaled individually. The whole canvas zooms by the largest whole number that fits the window (1 at 1080p, 2 at 4K) and the rest is letterboxed (changed from 2x after M2b: at 2x units stood two tiles tall). HD .sprite files for UI, skill icons, item art and fonts. The HD 3D models are a later experiment on one monster and never block the game.
- Map: a ring (Oct 2026, Green TD style). Monsters spawn on it and keep lapping until killed; nothing leaves, so there are no lives. Towers go on any open tile off the path. No mazing.
- Evolution: two adjacent prerequisite towers are consumed into one evolved tower. One tile is freed.
- Launch classes: Paladin, Sorceress, Necromancer. Amazon, Barbarian, Druid and Assassin come after the loop is fun.
- Tower structure: 3 lines per class, 3 tiers per line, T4 evolutions from two towers. T5 evolutions from three towers later.
- Skills are data on ten archetypes (see Skill archetypes). No bespoke code per skill.
- Numbers: skills.txt and monstats.txt values are the baseline, tuned from there.
- Difficulty comes from D2's own systems: resistances, immunities and monster mods. Act bosses close acts. No flying enemies.
- The run is a campaign (Oct 2026): five acts on Normal, then Nightmare, then Hell, 75 waves on the one board, about an hour. Runes and items later.

* Multiplayer is in: FFA on a ring each, and team mode on one shared ring. The simulation is deterministic lockstep from M1, so multiplayer is a transport layer at M4, not a rewrite. Any player can host; there is no central server.
* Team mode shares one ring, an arc per player: one alive count for the team, and kill gold goes to the killer.
* No interest on gold. Extra income comes from a Barbarian gold-find line and gold-find gear.
* Endgame beyond Hell: tiers of harder waves, with runes and items as the power that keeps pace. Built at M7.

- Holy Bolt hits everything: 40% damage against non-undead, full damage against undead (house rule, Oct 2026). Upgrade costs scale geometrically and monster HP follows the tables' levels (the campaign); the balance harness tunes the multipliers, not play-by-feel, and src/data/balance.json is the only place they are written down.

## Core loop and map

Build, kill, spend the gold, repeat. Monsters walk a ring and lap it until they die. The run is lost when the weight of everything alive on the ring reaches 100: a regular monster weighs 1, a champion 2, a unique 3 and an act boss 10 (balance.json aliveLimit and aliveWeight). The HUD shows it as a bar filling across the top of the screen, and the life globe fills with it; the wave tooltip says what each special weighs.

- The ring (src/data/map/ring.json, src/sim/map.ts) is four arcs, each the same turned a quarter more, so every player's arc is identical. Each arc in walking order: a long outer straight, a U-bend dented into the interior (its one-tile pocket touches all three legs), then a 90 degree corner that hands the path to the next arc. Each arc's spawn point is one tile past its handoff corner. Four-fold symmetry needs a square grid: 42 x 42 tiles, the tile count of the 48 x 36 first asked for, a 172-tile loop. ring.json gives arc 0 and the scenery on its wedge by kind (treeline round the edge, rocks on the arc-boundary diagonals, bushes, and an 8 x 8 centre block for the cottage); the code turns both onto the other three, and the map bake draws each kind on exactly its tiles, so the art and the buildable mask agree.
- Every tile belongs to the arc whose wedge holds it (the four triangles between the diagonals); each arc owns the corner handed to it. Path tiles and scenery tiles are unbuildable; everything else is buildable, one tower per tile, by whoever owns its arc. The renderer shows the square sim grid in D2's isometric view.
- Range is measured in tiles from the tower's centre. Melee towers reach 1.5 tiles, so they only work when placed touching the path.
- Targeting per tower: First, Last, Strongest, Weakest, Closest. Default First. First and Last go by how far a monster has walked in all, laps included.
- Summons stand on the path tile nearest their tower and block it. Monsters stop and fight blockers (Kingdom Rush barracks), but a monster held for 6 seconds breaks through, shoving the summon aside (it survives), and bosses are never blocked. Monsters never attack towers in v0.1.
- Speed comes from each monster's velocity in monstats.txt, so a Quill Rat really is faster than a Zombie.
- Waves run on a fixed timer, and Send Next Wave starts the next one early for gold (see Enemies, waves and difficulty).

Modes (built Oct 2026):

- Single player owns the whole ring. Their wave is dealt out over the four spawn points, a pack or a tank at a time.
- Team: one shared ring, an arc per player (up to four; with fewer, the arcs go round so the whole ring is someone's). Every player's arc spawns the whole wave at its spawn point; the team shares the alive count; kill gold goes to the player whose tower last hurt the monster (poison counts as its caster's); each player has their own gold and changes only their own towers.
- FFA: a ring per player from the same seed, each with its own alive count; the last ring standing wins.

The camera: the ring is bigger than the screen. Drag (any mouse button) or WASD and the arrow keys pan, the wheel zooms, and zoom is whole numbers only (1x, 2x, 3x). The default view is your own arc at 2x. A minimap in the top-right corner shows the ring, each arc in its owner's colour, a dot per monster, and the camera's view; clicking it moves the camera. Anyone's towers can be looked at; on a team ring, keys 1 to n jump to a player's arc, and in FFA they watch that player's ring.

## Tower system

A tower is a class, a line, a tier and a level. The line is chosen once, the tier climbs the skill tree, the level scales the current skill.

**Build.** Place a class tower on a buildable tile for its base cost. It is inert until you pick one of three T1 skills. That pick fixes its line for good.

**Tiers.** T1, T2, T3 up the line, one skill per tier. Within a tier the tower has skill levels 1 to 5, bought with gold. Level 5 unlocks the next tier. Nothing gates a tier by stage: any tier or evolution can be bought at any time, and the price curve (balance.json tierCosts, evolveCost, levelCostBase) is tuned so a solo player on natural income first reaches T2 around Normal Act 2, T3 around Nightmare Act 1, T4 evolutions around Hell Act 3 and T5 around Hell Act 5. A player catching teammates' leaks at a handoff corner gets there earlier, which is intended. Levels 1 to 5 map to skills.txt levels 1, 5, 10, 15 and 20 for damage, duration and radius, which gives authentic scaling for free.

**Evolution (T4).** A recipe names two towers and the minimum tier of each. Both must be adjacent (8 neighbours) and at that tier. Evolving consumes both and places the evolved tower on the attack tower's tile. The freed tile is part of the payoff. The evolved tower keeps its attack skill at T3-equivalent power, carries its partner's aura or skill as a built-in bonus, and still projects that aura at half radius for neighbours.

**Sell.** 60% of all gold spent on the tower. An evolved tower sells for 60% of both parents combined.

## Paladin

The Paladin is the reference class: two damage lines and one aura line, and every evolution pairs a damage tower with an aura tower.

| Line | T1 | T2 | T3 | Role on the map |
| --- | --- | --- | --- | --- |
| Zealot (melee) | Sacrifice | Zeal | Vengeance | Short range, highest single-target DPS. Vengeance adds fire, cold and lightning, so it still hits physical immunes. |
| Holy (ranged) | Holy Bolt | Blessed Hammer | Fist of the Heavens | Magic damage ignores most immunities. Holy Bolt is single target and hits everything, at 40% damage against anything not undead and full damage against undead (house rule; in D2 it only hits undead); hammers spiral around the tower; FoH strikes one target and sprays bolts at undead and demons. |
| Aura (support) | Might | Concentration or Holy Freeze | Fanaticism or Conviction | Might and Concentration add damage to towers in radius. Holy Freeze slows enemies in radius. Fanaticism adds attack speed and damage. Conviction cuts enemy resistances. |

Smite is parked: either the stun alternative at Zealot T1, or saved for the Smiter evolution (open question).

A tower shows its line and tier the way D2 shows gear. The line is the weapon: Zealot carries a sword and shield, Holy a scepter and shield, Aura goes unarmed. The tier is the armour weight: T1 light armour and no helm, T2 medium armour and a cap, T3 heavy armour and a full helm. Evolved towers wear T3 gear in the evolved recolour. It is render-only, built from the Paladin's armour and weapon layer variants at extraction (src/data/render/sprites.json).

| Evolution | Recipe | What it does |
| --- | --- | --- |
| Zealdin | Zeal (T2+) + Fanaticism (T3) | Zeal swings at Fanaticism speed; projects a half-radius Fanaticism aura. |
| Hammerdin | Blessed Hammer (T2+) + Concentration (T2+) | More hammers, harder hammers, pure magic damage; half-radius Concentration. |
| Avenger | Vengeance (T3) + Conviction (T3) | Tri-element melee on resistance-shredded targets; the physical-immune answer. |
| Templar | Fist of the Heavens (T3) + Conviction (T3) | FoH with no cooldown; the boss killer. |
| Smiter (later) | Smite + Fanaticism | Needs Holy Shield to exist; bonus damage and stun against bosses. |
| Auradin (T5, later) | Holy Fire + Holy Shock + Conviction | Three towers; needs the aura line to branch first. |

## Sorceress and Necromancer

Both follow the Paladin pattern, with evolutions that cross lines (built in M6). The Sorceress has four lines, three of them elements; the Necromancer has three. Every number comes through the same tier ladders as the Paladin's (src/data/classes, src/data/skills).

| Sorceress line | T1 | T2 | T3 | Role on the map |
| --- | --- | --- | --- | --- |
| Fire | Fire Bolt | Fire Ball | Meteor | Splash damage, slow projectiles, big delayed hits. |
| Cold | Ice Bolt | Glacial Spike | Blizzard or Frozen Orb | Slows and freezes on hit; Blizzard is a zone, Orb is splash plus shards. |
| Lightning | Charged Bolt | Lightning | Chain Lightning | Pierce and chain; best against lines of swarm enemies. |
| Support | Static Field | Enchant | Thunder Storm | Static pulses a % of current HP off everything in radius (boss opener); Enchant adds fire damage to towers in radius; Thunder Storm strikes random enemies in radius. |

| Sorceress evolution | Recipe |
| --- | --- |
| Meteorb | Meteor (T3) + Frozen Orb (T3) |
| Blizzballer | Blizzard (T3) + Fire Ball (T2+) |
| Light Sorc | Chain Lightning (T3) + Thunder Storm (T3) |
| Enchantress (T5, later) | Enchant + any two melee towers, including other classes |

| Necromancer line | T1 | T2 | T3 | Role on the map |
| --- | --- | --- | --- | --- |
| Summoning | Raise Skeleton | Skeletal Mage | Revive | Blockers on the path; mages shoot from behind them; Revive turns fresh corpses into 30-second allies. |
| Bone | Teeth | Bone Spear or Corpse Explosion | Bone Spirit or Poison Nova | Teeth fans projectiles; Bone Spear pierces; Corpse Explosion detonates a nearby corpse for a share of its max HP; Bone Spirit homes; Poison Nova is a zone. |
| Curses | Amplify Damage | Decrepify | Lower Resist | Debuff auras on enemies in radius: more physical damage taken, slow plus less damage, lower elemental resistances. |

| Necromancer evolution | Recipe |
| --- | --- |
| Summoner | Revive (T3) + Amplify Damage (T1+) |
| Bonemancer | Bone Spirit (T3) + Decrepify (T2) |
| Novamancer | Poison Nova (T3) + Lower Resist (T3) |
| Explosionmancer | Corpse Explosion (T2) + Amplify Damage (T1+) |

Corpses are the Necromancer's twist: a killed monster leaves a corpse for 10 seconds that Corpse Explosion, Revive and the Fallen Shaman all compete for. Whoever acts first in a tick takes it (monsters act before towers, towers in build order); a Shaman that loses its corpse mid-cast raises nothing.

How they play (M6):

- Cold chills: a cold hit slows its target by balance.json chillPct for the skill's cold length (ELen). Glacial Spike also freezes for its auralencalc: a frozen monster stands still. Bosses are chilled instead of frozen (house rule).
- Poison lands over the skill's poison length instead of at once; a weaker dose never replaces a stronger one, as in D2.
- Summons come in three kinds. Skeletons stand on the path tile nearest their tower and block it; monsters stop and fight them; a dead one respawns after a delay. Skeletal Mages stand on the tower's side of the path and shoot one of their skill's four missiles (fire, cold, lightning, poison, picked when raised); they never block. Revive raises the toughest fresh corpse in range (normal monsters only) at twice its max HP, blocking where it rose, for 30 seconds (house rule; D2's lasts three minutes). Blocking has a limit: a monster held for balance.json blockBreakTicks (6 seconds) breaks through and walks on, shoving the summon aside; the summon survives, takes the monster's hits for those 6 seconds and does not hold that monster again. Bosses are never blocked. Skeleton and mage HP grow per skill level by their skills.txt HP percent (calc1: 50% a level past 3 for skeletons, 10% for mages); summons are the same on every difficulty, but monsters hit them with their own difficulty's damage (A1MinD/A1MaxD and monlvl DM at that difficulty's level), so Hell's blockers fall fast.
- Curses (Amplify Damage, Decrepify, Lower Resist) are cast on the tower's target and ride on every monster in the radius for their duration. Curses do not add up: a monster under several takes the strongest value of each effect. A curse and an aura do add (Lower Resist with Conviction). Decrepify also halves what a monster does to blockers.
- Breaking immunities is D2's rule: against a monster at 100% or more, every resistance cut (Conviction, Lower Resist, Amplify Damage, Decrepify, added up) works at a fifth of its strength. An immune stays immune unless that fifth brings it under 100.
- Debuffs take no tier bonus: their per-level values are skills.txt's own, so a T3 curse or Conviction cuts what the game's skill at that level cuts. The ladder values a resistance cut against a target at 50% resistance (balance.json debuffTargetResist), not the plain 0% target: x (100 - (50 - cut)) / 50, floored at -100. Where a debuff still falls short of the 110% floor, it climbs cap-4 to cap like any skill that misses the floor. Buff auras and damage skills keep the ladder and its bonus.
- Static Field takes a quarter of current HP off everything in radius, as lightning; it cannot take a monster below 0, 33 or 50% of max HP on Normal, Nightmare and Hell (balance.json staticFloorPct; D2 hardcodes the floors).
- Enchant has no radius in D2 (it targets one ally), so it is an aura of 2.5 tiles that adds its fire to every missile, bolt, swing and blast of the towers in it, not to ground zones or aura pulses (house rule).
- Thunder Storm strikes a random monster in range at its perdelay rate. Charged Bolt and Teeth fire one shot per target; shots with no target of their own fly past, so a volley shreds a crowd and not a boss.
- Evolved towers also cast their partner's skill on its own cooldown when it does something by itself (a curse, Frozen Orb, Fire Ball, Thunder Storm); partner auras still project at half radius.

How they look (M6b, render-only): the same scheme as the Paladin, line = weapon and tier = armour. The Sorceress carries a short staff (Fire), a long staff (Cold), an orb (Lightning) or nothing (Support); the Necromancer a wand (Summoning), a dagger (Bone) or a bone wand (Curses), each with a bone shield (his head shields have no classic shield layer). Casters play D2's cast pose (SC) when they act. Every missile comes from missiles.txt with its ExplosionMissile where it lands; Meteor falls onto its mark, Blizzard's shards fall over its zone, Frozen Orb sprays shards, Poison Nova throws its ring, Corpse Explosion bursts the corpse it took, and Lightning, Chain Lightning and Static Field are drawn lightning, as D2 draws them (their CelFile is null). Curses and Enchant ride on what they touch as their overlay.txt effects; frozen monsters wear Frozen Armor's ice, chilled ones turn blue and poisoned ones green. Skeletons and skeletal mages are D2's own (they climb out of the ground in their S1 mode) and mages throw their element's missile; a revived corpse keeps its own art, pale. The build menu has a tab per class over the belt.

## Skill archetypes

Every skill in the game is one row of data on one of ten archetypes. Adding a skill means adding a JSON entry and a sprite, not code. Forty skills across three classes stays tractable because of this table.

| Archetype | Behaviour | Examples | Data fields |
| --- | --- | --- | --- |
| Projectile | Single-target shot that travels and hits the first enemy | Holy Bolt, Fire Bolt, Ice Bolt, Teeth (fires N) | damage, element, rate, range, speed, count, missile sprite |
| Pierce / chain | Passes through targets or jumps between them | Bone Spear, Lightning, Chain Lightning | pierce count or chain count, falloff per hop |
| Splash | Area damage at the point of impact | Fire Ball, Meteor, Fist of the Heavens, Blessed Hammer (orbits the tower) | radius, falloff, impact delay |
| Zone | Persistent damage on the ground | Blizzard, Fire Wall, Poison Nova cloud, Thunder Storm | duration, tick rate, radius |
| Melee | Hits enemies on adjacent path tiles | Sacrifice, Zeal, Vengeance, Smite | attacks per second, targets per swing, stun |
| Control | Slows, freezes or stuns | Holy Freeze, Glacial Spike, Decrepify, Smite, Clay Golem | slow %, duration, radius or on-hit |
| Buff aura | Boosts towers in radius | Might, Concentration, Fanaticism, Enchant | stat, bonus %, radius |
| Debuff | Weakens enemies in radius or on hit | Conviction, Amplify Damage, Lower Resist, Static Field | stat, amount, radius, duration |
| Summon | Spawns units that block the path and fight | Raise Skeleton, Skeletal Mage, Revive | unit count, HP, damage, respawn time |
| Corpse | Consumes corpses left by kills | Corpse Explosion, Revive, Fallen Shaman | corpse lifetime, radius, % of corpse max HP |

Damage types follow D2: physical, magic, fire, cold, lightning, poison. Each monster's resistances per difficulty come straight from monstats.txt, and 100%+ is an immunity. Summons, corpse skills and Static Field have no standard-target damage, so the tier ladder cannot rank them: they climb the whole range from skill level 1 to the tier's cap.

## Enemies, waves and difficulty

The campaign (Oct 2026, src/data/monsters.json): five acts on Normal, then Nightmare, then Hell, all on the one board, and the towers stay for the whole run. Acts have 6, 5, 5, 3 and 6 waves, 25 a difficulty and 75 in all; at a wave every 45 s that is about an hour. The final wave of every act is its act boss.

- Every act's roster (src/data/monsters.json campaign, by act) is spread over its three visits so each difficulty shows different monsters. Act 1's is spread over its three visits so each difficulty shows different monsters, in the order a player meets them: Normal walks the Blood Moor to the Burial Grounds (Fallen, Quill Rats, Zombies with Corpsefire, Fallen Shamans with Bishibosh, Skeletons with Bonebreak) and ends on Blood Raven; Nightmare the Stony Field to the Forgotten Tower (Dark Rangers with Coldcrow, Moon Clan, Carvers with Rakanishu, Brutes with Treehead Woodfist, Dark Stalkers with the Countess) and ends on Andariel; Hell the Outer Cloister to the Cathedral (Razor Spines with Flamespike, Black Rogues with the Smith, the Returned with Griswold, Tainted with Pitspawn Fouldog, Bone Mages with Bone Ash) and ends on Andariel.
- Act 2 (Rocky Waste to the Far Oasis, the lair Tal Rasha's Tomb) ends on Duriel on every difficulty. Normal: Sand Raiders with Fire Eye, Dune Beasts, Sand Leapers, Scarab Beetles (Dung Soldiers) with Beetleburst. Nightmare: Mummies (Dried Corpses) with Radament, Greater Mummies (Hollow Ones) with Ancient Kaa the Soulless, Vulture Demons (Carrion Birds) with Creeping Feature, Sand Maggots with Coldworm the Burrower. Hell: Sabre Cats with Bloodwitch the Wild (whose pack is the Huntress, so the act's thirteen monsters fit its twelve waves), Blunderbores, Baboon Demons (Rock Dwellers) with Fangskin, Horror Mages. The Greater Mummy comes right after the Mummies, so there are mummy and skeleton corpses for it to raise.
- Act 3 (the Spider Forest to the Flayer Jungle, the lair the Durance of Hate) ends on Mephisto on every difficulty. Normal: Giant Mosquitoes (Suckers) with Sszark the Burning, Tree Lurkers, Thorned Hulks with Stormtree, Flayers. Nightmare: Swamp Dwellers, Zombies (Drowned Carcasses) with Battlemaid Sarina, Blood Hawks with Icehawk Riftwing, Fetish Shamans with their Fetishes and Witch Doctor Endugu. Hell: Zakarum Zealots with Geleb Flamefinger, Zakarum Priests with their Zealots and the Council (Toorc Icefist, Ismail Vilehand, Bremm Sparkfist, Wyand Voidbringer, Maffer Dragonhand, one after another), Dolls (Undead Stygian Dolls), Blood Lords.
- Act 4 (the Outer Steppes and the Plains of Despair, the lair the Chaos Sanctuary) ends on Diablo on every difficulty. Normal: Corpulents with Izual, Finger Mages (Doom Casters) with Hephasto the Armorer. Nightmare: Pit Lords, Trapped Souls with the Grand Vizier of Chaos and his Storm Casters. Hell: Abyss Knights with Lord De Seis and his Doom Knights, Balrogs with the Infector of Souls and his Venom Lords. Izual is a monstats boss, so he walks as a named monster without a superuniques.txt row (his own mods only). The Trapped Soul stands still in D2 (Velocity 0); on the ring everything walks, so a monster the tables leave stationary walks at balance.json stationaryVelocity (3, the slowest walkers' pace).
- Act 5 (the Bloody Foothills into the Frigid Highlands, the lair the Throne of Destruction) ends on Baal on every difficulty. Normal: Enslaved with Eldritch the Rectifier, Overseers with their Enslaved and Shenk the Overseer, Imps (Demon Imps), Siege Beasts with their Imp riders and Thresh Socket, Death Maulers. Nightmare: Slingers, Snow Yetis (Snow Drifters) with Frozenstein, Frozen Horrors (Frozen Creepers), Succubi with Pindleskin, Moon Lords with Nihlathak. Hell: Suicide Minions (Fanatic Enslaved), Imps again as Demon Gremlins, Death Maulers again, Blood Lords, Minions of Destruction with the Ancients (Talic, Madawc, Korlic, one after another). Act 5 has fifteen regular waves for its thirteen monsters, so Imps and Death Maulers come back in Hell as stronger variants of their own family. The Overseer raises Enslaved (and Suicide Minions, the same MonType). D2R names no monster Wendigo; the Snow Yeti family (Frozenstein's own class) stands in for it.
- Every act has content: the placeholder roster and its per-act tints are gone. A run without the extracted maps shows one grey box.
- A monster walks at its monstats level for the difficulty, but never below its act's floor (balance.json actFloorPercentile, the 20th percentile of the act's areas' MonLvlEx for the difficulty): a monster the tables made weaker than the act it walks in is lifted to it (`sandraider1@normal:14`), and one already stronger keeps its own level.
- Raisers get the Fallen Shaman's ability (monsters.json roster): standing still for their monseq sequence (a second without one), they raise a corpse of their kind nearby into their own wave, chance and range from their monstats AI parameters. The Fallen Shaman raises Fallen; the Greater Mummy, D2's Resurrect2, raises mummies and skeletons; the Fetish Shaman raises fetishes. In D2 the Zakarum Priest heals and the Overseer calls for help rather than raising; here both raise their own kind (Zealots; Enslaved), as asked, with the same ability. A raiser may walk with its party (monsters.json roster party, checked against its monstats minion1, PartyMin-PartyMax midway, in the middle of its wave before any pack), as D2 spawns it with its group: the Fetish Shaman with Fetishes, the Zakarum Priest with Zealots. That gives it corpses of its own kind, and it is how Act 3's thirteen monsters fit its twelve waves. A raiser's wave otherwise comes right after the wave of the kind it raises.
- Names are D2R's, from its string table (local/lng/strings/monsters.json): monstats NameStr and superuniques Name are keys into it, so Leatherarm shows as Creeping Feature and Blood Lord1 as Moon Lord.
- Scaling comes from the tables, with no per-wave curve: a monster's HP and damage are its monstats percentages of monlvl.txt at its level, and its level is its monstats Level for the difficulty (Level, Level(N), Level(H)), lifted to its act's floor. Bounty is that level times bountyPerLevel times the rank multiplier. The cost ladder is unchanged.
- The map shows the act: its field, and its boss lair while the act's final wave is out, on the same grid, path and buildable mask. Acts with baked maps show them; an act without (or a missing extraction) is the grey box tinted per act, with the act's name under the alive bar.
- Checkpoints: the run saves as each new act's first wave starts (the seed, every command so far and a snapshot of the match; src/sim/checkpoint.ts), and Continue on the main menu carries it on. In multiplayer the host saves, and its lobby offers to continue the saved game when the mode and the number of players match. Continuing after a defeat starts again at the last act's beginning.

- Pacing (Green TD, Oct 2026): a wave is about 45 s of one monster type (balance.json waves.streamTicks), a swarm monster every second and a tank every 1.5 s (waves.swarm and waves.tank spacingTicks), so 45 or 30 to a wave. Waves start on a fixed timer, one every 45 s (waves.intervalTicks) after a 30 s build time, whether the last wave is dead or not: slow kills bleed into the next wave and pile up on the alive count. Send Next Wave starts the next wave now and pays every player on the ring 2 gold (balance.json earlySendGoldPerSecond) for each second the timer still had, scaled like bounty by the wave's bounty multiplier; on a team ring any player may press it, in FFA it is your own ring. npm run waves reports each wave's count, stream length and lap time.
- Superuniques are the unique pack inside a regular wave of their act (listed above); a wave can carry several, one after another (the Council, the Ancients). A superunique is its class's monster with its own name, palette (Utrans) and mods (Mod1 to Mod3), at unique rank (unique HP bonus, weight 3), with its minions (MinGrp-MaxGrp of the class's minion1 or the class itself, midway) walking just before it in the middle of the wave.
- Act bosses walk behind their pack on a wave of their own: Blood Raven behind 7 Hungry Dead (monstats minion1 and PartyMin-PartyMax), Andariel alone. The Fallen Shaman keeps a wave of its own (with Bishibosh), though alone it has no Fallen corpses to raise.
- Every act's last wave before its boss carries a champion pack in its middle: three of the wave's own monster, with the act's fixed mods (balance.json modSchedule.champions: Extra Fast, Stone Skin, Magic Resistant, Extra Strong, Stone Skin and Magic Resistant) and the difficulty's additions. Colour variants are their own monsters; flyers (Foul Crow, Wraith) walk the path for now, flagged in the data.
- Monster mods are D2's: Extra Fast, Extra Strong, Stone Skin (physical resist), Magic Resistant, Fire, Cold and Lightning Enchanted, Cursed, Spectral Hit (Corpsefire's; no resistance, its elemental hits are not built), and the expansion's Mana Burn, Teleportation and Aura Enchanted, carried by name only (no tower has mana; skipping a path segment and the random aura are not built). Enchanted adds 75 to its element's resistance, so on an already resistant Hell monster it is an immunity; its death burst that stuns nearby summons, and Cursed's aura (towers in radius lose 25% damage), are not built yet: the bosses carry the mods for their resistances only.
- Normal, Nightmare and Hell use the three HP and resistance columns of monstats.txt. Hell immunities are the point: no single line clears Hell, so the player has to mix elements and magic.
- Hell's walls (Oct 2026), as rules: an immune mod (+100, ours: Magic, Poison and Physical Immune) replaces the matching resistant mod (Magic Resistant, Poison Resistant, Stone Skin) and never stacks with it, on every named monster and special (balance.json monsterMods replaces). Every Hell champion pack carries Stone Skin and Poison Immune: Stone Skin lifts a Hell champion's physical resistance to 100, so each pack is physical and poison immune. Stone Skin is +50 on Normal and D2's +80 on Nightmare and Hell elsewhere, stopping at 99. Hell's Treehead is Magic Immune and Griswold Magic and Physical Immune; Hell's Andariel is Physical, Magic and Poison Immune with fire, cold and lightning from her raw Hell columns (-50, 66, 66), so any elemental line can kill her. Nightmare gets the resistant versions: Poison Resistant (+40) on the champions and Andariel, Magic Resistant on Treehead and Griswold, and Andariel keeps her Magic Resistant. Named monsters take theirs by id (balance.json modSchedule.named and added), on top of their table mods, each mod once.
- Nothing leaks: a monster laps the ring until it dies, and weighs on the alive count while it lives (champion 2, unique 3, act boss 10). Bosses are never blocked.
- Difficulty (campaign, Oct 2026): a Nightmare or Hell monster is its own entry (`fallen1@hell`) with that difficulty's resistances, immunities, HP columns and level, and a monster lifted to its act's floor is an entry at that level (`sandraider1@normal:14`). Act 1's Hell columns hold fire, cold and lightning immunities (Fallen, Zombies and Rogues, Skeletons) but nothing against magic or poison; Hell's walls above add those.
- Enemies never attack towers in v0.1. They only fight summons blocking the path.

* Hell is not the ceiling. Endgame tiers (next section) scale past it.

## Endgame: tiers, runes and items (M7)

Hell is where the tutorial ends. Past it the game scales without limit, and the player's answer is gear, the same way D2's own endgame is gear.

- Tiers: Hell+1, Hell+2 and up, chosen in the lobby. Each tier adds 25% HP and damage (compounding), an extra immunity on more monsters, and an extra mod on champions and uniques. The highest tier cleared is saved.
- Loot: monsters drop gold, runes and items from D2's treasure classes (treasureclassex.txt), filtered to what the game can use. Drop rates scale with tier and with magic find.
- Gear: each tower has one item slot; the player has a charm pouch that applies to every tower. Affixes are the ones D2 players expect: +skills (one skill level on every tier), +% damage, pierce, crushing blow, attack speed, resistance pierce, gold find, magic find.
- Runewords: runes socketed in order into a base item make the famous runewords, and the aura ones matter most. Infinity gives Conviction, Beast gives Fanaticism, Dream gives Holy Shock, Pride gives Concentration, Enigma lets the tower move for free. Any class can carry a Paladin aura, which is exactly what D2 does with mercenaries.
- Gold find: Gheed's Fortune, gold-find affixes and the Barbarian's Find Item line stack. Gold find is the endgame's second currency pressure after tier progress.
- Persistence: a stash that survives across runs in a local save file. In multiplayer each player brings their own stash and the host's tier applies to everyone.

## Economy

Gold only in v0.1. The M1 grey-box was far too easy with flat costs and flat HP, so upgrade costs are geometric and, since the campaign (Oct 2026), monster HP climbs with the tables' levels; tools/balance.ts tunes the multipliers against three bot strategies (spam, upgrade, mixed) until a mixed bot survives to wave 25 to 30 and the other two lose between 12 and 20.

Target rhythm (Green TD, not a treadmill): tier-ups and evolutions are big jumps, about 2.5x DPS, that buy three or four comfortable waves while the levels climb underneath; levels within a tier are small and few. A player should feel ahead right after a purchase and behind two waves later. The harness logs per-wave margin so the sawtooth is visible, and the 110% floor is only the no-downgrade guarantee, not the target.

The ring report (tools/report.ts, `npm run report`) has every bot play all 75 waves on the ring in single player and prints, without targets or tuning: the wave each run dies on, alive weight at each wave's start and its peak while it was the newest wave, and where the bots' towers stood at the end, by nearest path leg (U-bend pocket, round the outside of the U, the run into a handoff corner, a long straight, or inland, more than two tiles from any leg). It is the input to the rebalance pass.

First run on real content (Oct 22, all five acts, before the Stage A economy rebuild, seeds 1 to 3): TWOLINE, PALADIN, NECRO and MIXED3 clear all 75 waves; BOLT and HOLY stall on Hell Baal (alive 37 and 53 below the limit, unable to kill him); SORC dies on Hell Andariel (wave 55 or 56). The tower-spam bots end with about 500 towers each and the class bots at their old 64-tower cap; alive weight peaks at 58 to 76 in Normal Act 1, sits at 10 to 30 through the middle of the campaign, and climbs to 35 to 55 on Hell's last bosses. Bosses are not yet the point of failure. Stage A answers this.

- Bounty per kill = monster level x 2 (balance.json bountyPerLevel), with no per-wave curve: the levels climb with the campaign. Champions x3, uniques x5, act bosses x20, Andariel x50.
- Send Next Wave pays for the time it skips (see Enemies, waves and difficulty); there is no wave-clear bonus.
- Starting gold 300, enough for two towers. No lives: the alive count is the loss condition.

* No interest on banked gold. Extra income is a tower, not a bank: the Barbarian's Find Item line loots corpses in radius for bonus gold, and gold-find gear stacks on it in the endgame.

| Action | Gold |
| --- | --- |
| Build a class tower | 150 for the first, then each tower owned multiplies the next by 220% (balance.json buildCostGrowthPct): 150, 330, 726, 1597, 3513, 7729, 17004, 37409, 82299, ... |
| T1 skill pick | free |
| Skill level +1 | Geometric from a base of 60 at T1, 240 at T2, 300 at T3; the per-level multiplier is harness-tuned (see src/data/balance.json) |
| Upgrade to T2 | 400 |
| Upgrade to T3 | 8000 |
| Evolve to T4 | 30000 |
| Sell | 60% of everything spent on the tower |

A Hammerdin therefore costs both parents built, levelled and tiered, plus the evolution fee (totals follow from the multipliers; see src/data/balance.json), and two tiles before it costs one.

The curve was set against the ring report (Oct 2026, `npm run report`, tier-buying bots on three seeds): a bot's cumulative income is about 630 gold entering Normal Act 2, 33,000 entering Nightmare, 140,000 entering Hell and 200,000 entering Hell Act 3. With these prices the bots first buy T2 on waves 7 to 14 (Normal Act 2 to 3), T3 on waves 22 to 43 (median 29, Nightmare Act 1) and their first evolution on waves 25 to 65. The bots buy by power per gold, so the spread is theirs, not the curve's: the two bots that weigh an evolution like any other purchase (MIXED3 and TWOLINE) evolve on waves 63 to 65, Hell Act 3; the Necromancer bot rates its Explosionmancer highly and evolves in Nightmare; the Paladin bot's Hammerdin is its scripted opening and fires whenever it has the fee banked, which a big bounty wave can bring as early as Normal Act 5.

## Visuals and asset pipeline

The look is D2R's legacy toggle done well: classic sprites at 1x with nearest-neighbour sampling, HD panels, fonts and skill icons around them. Since M5 the renderer projects the square sim grid into D2's 2:1 view: one sim tile is a 64 x 32 diamond, two by two of D2's subtiles, so the 42 x 42 ring is a 2688 x 1344 diamond in world space, bigger than the screen. A world camera pans and zooms over it (1x, 2x, 3x) and a second, flat camera draws the HUD, panel and minimap over it; the canvas with HUD and panel is 1440 x 1000, which fits 1080p at zoom 1 with a title bar above the taskbar. Sprites, missiles, HP bars, range ellipses, the build highlight and clicks all go through the projection and its inverse, and everything on the map sorts by projected y. The canvas zooms as a whole by the largest whole number that fits the window and letterboxes the rest; no sprite is scaled on its own and nothing is ever scaled by a fraction. Tile size is render-only: the sim's tile stays 1000 units, so ranges and path lengths do not change. (The ring keeps D2's 64 x 32 diamond rather than the 48 px square tiles first asked for, because the isometric view is locked above.)

- Monsters, heroes and missiles: classic DCC/DC6 frames composited through COF layer files, coloured with an act palette (pal.dat: a monster in the act it first walks in, heroes and missiles in Act 1's) and its PL2 colour shifts for champions and uniques. A mode a monster has no COF for plays one it has (a stationary one stands for its walk, casts for its attack, and its dead pose stands in for a death it lacks), and a layer it does not draw in a mode is another of its variants or left out. A layer stored as DC6 instead of DCC (all of Mephisto's) is read as D2 reads it, and a COF with more directions than its layers (Mephisto's 16 over 8) is drawn in the facings every layer has, the first 8 of 16 being the 8 of an 8-direction file. A TransLvl with no palshift.dat beside the COFs (the Council) draws in the plain palette.
- UI, skill icons, item art, fonts: D2R HD .sprite files, decoded to PNG.
- Map: each act's two ring maps are baked at extraction (tools/extract/map.ts, one layout per act in src/data/map/act<N>.json, drawn in that act's palette) from the player's DT1 tiles. Act 1: the Blood Moor (Town floor grass, a dirt road blended along the closed ring, D2's own Cott4 cottage preset read as a DS1 in the centre, boulders on the arc boundaries, bushes, tree groups along the two back edges) and Catacombs 4 for Act 1's boss waves (catacomb floor, Andariel's woven carpet as the road, her throne and braziers in the centre, spiked pillars on the arc boundaries, gargoyle pillars, barrels and crates along the back edges). The two edges facing the camera get flat rubble instead (rocky ground; bones and broken floor), because anything standing there is drawn over the path in front of it. Act 2: the desert (sand, a cobbled road, palms and dry bushes along the back edges, cacti on the arc boundaries, the great stone head in the centre with palms on its corners, stony ground on the front edges) and Tal Rasha's Tomb (stone floor, a sand path as the road, tomb columns along the back edges, funeral biers on the arc boundaries, a statue niche in the centre, sand drifts on the front edges). Act 3: the jungle (dark grass, a dry-mud road, jungle trees and tree groups along the back edges, stone totems on the arc boundaries, ferns and fetish cauldrons, the stone idol with fetish totems on its corners, mossy ruin rubble on the front edges) and the Durance of Hate (grey stone, Mephisto's blood floor as the road, the spiked golden walls and skull pillars along the back edges, pillars on the arc boundaries, corpse piles, the horned blood archway in the centre, bone-strewn floor on the front edges). Act 4: the mesa (rocky ground, a dark plank causeway as the road, chain pylons and black spires along the back edges, cooled lava rocks on the arc boundaries and among the bones, a demon statue with spires on its corners, broken stone on the front edges) and the Chaos Sanctuary (dark gravel, the striped paving as the road, the burning cathedral walls and spires along the back edges, black rocks, the cathedral facade in the centre with demon statues on its corners, lava-cracked floor on the front edges). A road tile with holes lets the ground show through them. Act 5: the snowfields (plain snow, Harrogath's cobbles as the road, dead trees and pines along the back edges, siege rocks on the arc boundaries, frozen shrubs, a roofed watchtower with stone posts on its corners, trampled snow on the front edges) and the Throne of Destruction (the throne room's stone, Baal's red carpet as the road, the red pillars and banners along the back edges, Worldstone crystals on the arc boundaries and in the centre with banners on its corners, crystal rubble on the front edges). The bake writes one ground image per map plus one image per scenery prefab, which the renderer depth-sorts with the units. An act without a layout, or a missing extraction, show the grey box (flat tiles: dirt path, dark scenery, grass edged in each arc owner's colour).
- Menu and HUD (Oct 2026): D2R's own, from the player's install at launch through the extraction (ui/frontend, ui/hud), drawn at the size D2R draws its HD UI at 1080p and laid out from D2R's layout files (global/ui/layouts/hudpanelhd.json, pauselayouthd.json, playerinventoryexpansionlayouthd.json). The main menu is D2R's logo screen: black, the burning logo (its fire animation, glow and bottom flames) with TOWER DEFENSE in Exocet where RESURRECTED goes, then D2's stone buttons: Single Player, Multiplayer (Host or Join), Continue when a save exists, Options, Exit. In game, D2R's control panel: the life globe fills with this player's share of the current wave's kills and reads their kills in all; the mana globe fills with the alive weight and reads it (full is the loss); both numbers are always shown, as D2R's Show Health and Mana Values draws them. The two skill buttons show the selected tower's current skill with its level in the corner and, on the left, the tier before it (or the partner skill of an evolution). The belt is four empty slots kept for items and runes. The stamina bar drains with the wave timer and the experience bar fills across the act; the run/walk button only changes the figure. The mini-menu row is D2R's; Inventory (I), Automap (Tab) and Menu (Esc) work, the rest say so. Gold is read where D2 shows it, in the inventory's gold box, and in every build and upgrade prompt. Build choices open as D2R's skill-select tray over the panel with a stone tab per class; the selected tower keeps its stone panel. The inventory is D2R's panel with its paper doll, 10 x 4 grid, weapon-swap tabs and gold; item placement comes later. The automap is the ring in D2's style: a translucent sheet, the path as outlines in each arc owner's colour, scenery as marks, a dot per monster, the camera as a box. The Escape menu is D2R's pause layout: the burning logo over D2R's pause buttons, Options (D2R's settings panel, volume), Save (the run as it stands, single player or the host), Quit to Menu (Leave Game online) and Return to Game.
- Sound (M5): D2R's own FLAC from the CASC, chosen through the tables: skills.txt cast sounds, missiles.txt travel and hit sounds, monsounds.txt death sounds, the gold chime, and the Wilderness song and day ambience from levels.txt and soundenviron.txt. D2's hand cursor and D2R's Exocet font come from the same extraction.

Pipeline, a Node script run locally against files exported with CascView:

1. Export from the D2R CASC into assets-raw (gitignored).
2. Decode DCC, DC6, COF, PL2 and .sprite into PNG sprite sheets plus JSON atlases (frame, direction, offset, duration).
3. Parse the excel .txt tables (monstats, skills, missiles, skilldesc, monstats2) into JSON the game loads directly.
4. Write everything to assets-extracted (gitignored). The repo never holds a Blizzard byte.

First files to pull for M0: data\\global\\monsters\\zm, data\\global\\palette\\act1\\pal.dat, the data\\global\\excel folder, and a few HD skill icons from data\\hd\\global\\ui.

HD 3D experiment, after M2: export one monster's .model (Granny GR2) and textures, convert with lslib, render 8 directions from Blender by script. If the zombie comes out clean, the pipeline swaps in HD sheets and the game never notices.

## Multiplayer

FFA on a ring each and team mode on one shared ring, built as lockstep from M1 and shipped at M4 with host-and-play. No cloud server needed for a handful of friends.

- Players: 2 to 6 in FFA, 2 to 4 in team. FFA gives everyone an identical ring, the same waves and the same seed; the last ring standing wins. Sending extra monsters at a rival is the same tech and can come later.
- Team mode: one ring, an arc per player (see Core loop and map). Kill gold goes to the owner of the tower that killed; the team shares the alive count. The relay refuses a team start with more than four players.
- Lockstep: every client runs the same deterministic simulation from the same seed. The only network traffic is the ordered command stream (build, upgrade, sell, evolve, call wave), relayed by the host. Fixed 20 ticks per second, seeded RNG, integer math in gameplay code, a state hash every 100 ticks to catch desync. A TD tolerates 200 ms of command delay without anyone noticing.
- Hosting: the host's Electron app carries the relay, so any friend who clicks Host is the server for that game; the others join with a code that carries the host's address. One forwarded TCP port on the host's router is the only setup; the app asks the router to open it by UPnP first, so most friends never touch router settings. Behind CGNAT with no public IP, Tailscale (free for a few people) replaces the port forward. For games the host is not in, the same relay runs as a service on a Pi, a NAS or an existing web server. If the host drops, the game ends.
- Wave timer (Oct 2026): every ring runs its own wave timer; there is no match-wide clock. On a team ring any player may send the next wave early; in FFA each player sends their own.
- How it is built (M4, ring Oct 2026): a ring is one sim; single player and team run one, FFA one per player, and a Match steps them together. On a team ring every command carries its player (set by the match from the relay's slot), towers carry their owner, and gold is per player. The relay never runs the game: it keeps the lobby, stamps commands into one bundle per tick, and compares the hashes players report. Commands are validated at the relay. Players must have the same app version and the same extracted tables (checked at join), or their sims would differ. Join codes are 12 characters carrying the host's IPv4 address and port with a check against typos. An online game cannot pause; Escape opens a menu over the running game. Players can look at anyone's towers but only build on their own arc or ring. Port 47310.

## Tech stack

TypeScript, Vite and Phaser 3 for the game; a Node pipeline for assets; Electron only when it is time to share.

- Game: Phaser 3 scenes for setup, map and HUD. Skills, towers, monsters and waves are JSON; the ten archetypes are the only skill code.
- Data layer: pure TypeScript with Vitest tests (damage, resistances, targeting, evolution recipes) so balance changes are cheap to verify.
- Assets: the Node pipeline in Visuals. Decoders ported from OpenDiablo2 (Go) and libd2 (Zig) rather than written from scratch.
- Repo: private on GitHub. assets-raw and assets-extracted are gitignored. README states non-commercial, fan project, bring your own D2R install.
- Distribution (M3): Electron app with a setup screen that finds the D2R install, extracts with a bundled CASC reader, then plays. Windows installer from electron-builder, unsigned, zero Blizzard assets inside. Until then the game runs from a local folder with Vite.
- Working method: Claude Code on the PC for anything that touches real game files; chat for design.

## Milestones

Each milestone has one gate. Nothing moves to the next until the gate is met, because art and content hide a loop that is not fun.

1. M0 Pipeline proof. Zombie walk cycle decoded to a sprite sheet, Paladin HD icons rendered. Gate: the zombie animates in a Phaser scene.
2. M1 Grey-box TD. One path, waves of coloured boxes with real monstats numbers, one projectile tower, gold, lives. The simulation is deterministic and command-driven from day one. Gate: a full 10-wave run is playable and losable, and two clients replaying the same command log end in the same state.
3. M2 Paladin complete. Three lines, three tiers, levels, Zealdin and Hammerdin, aura system, targeting modes, Act 1 monsters with sprites. Gate: 30 Normal waves are beatable but not trivially.
4. M3 Launcher and extractor. Electron shell with a setup screen that finds the D2R install, extracts what the game needs with a bundled CASC reader, and a main menu (Play, Host, Join, Settings). Windows installer from electron-builder, zero Blizzard assets inside. Gate: a friend with D2R installs it from the exe and reaches the first wave without help.
5. M4 Multiplayer. Host-and-play relay inside the app, join codes, UPnP, lobby, FFA and team mode with chained zones, desync detection. Gate: four friends finish a team game with no desync.
6. M5 Blood Moor art and HD UI. Rendered map, panels, fonts, skill icons, sound. Gate: a stranger can play it without being told how.
7. M6 Sorceress and Necromancer. Summons that block, corpses, curses, elements, immunities. Gate: Hell waves cannot be cleared with one line. The harness (npm run balance -- --hell) checks it as: no single-class bot (PALADIN, SORC, NECRO) clears Hell, and MIXED3, built from all three, does.
8. M7 Endgame. Post-Hell tiers, loot, runes, runewords, stash, Barbarian gold-find line. Gate: a Hell+5 run needs gear to clear.

### Stage A: economy rebuild (Oct 22)

The player wins with a handful of towers, not dozens. Each tower owned raises the next build's price by 220%, the only brake on the tower count (there is no cap anywhere, the bots' old 64-tower cap included). Tiers, levels and the evolution cost more (table above); income is unchanged, and the escalating build cost is what holds the counts down. Act bosses ramp: a boss's HP is its monstats HP times balance.json bossHpPct, from 60% on Normal Blood Raven in a straight line by wave to 900% on Hell Baal, so early bosses are easier than the tables and late ones much harder. Zeal reaches only the path tile beside its tower (rangeTenths 11, down from 15: about 0.9 tiles of path instead of 2.2) and swings every 9 ticks instead of 20.

Harness (npm run report, seeds 1 and 2, the ordinary bots TWOLINE, PALADIN, NECRO, MIXED3), against the targets:
- Towers at the end of Normal: 5 (target about 4); Nightmare: 7 to 8 (7); Hell: 8 to 9 (10). Close.
- Death: NECRO and MIXED3 die in Hell Act 2 (target Hell Act 1 or 2: met). TWOLINE stalls on Hell Baal, unable to kill him; with Stage B's endless waves a stall is a death in the first endless Tier. PALADIN clears Hell: its scripted Hammerdin carries it, at 50 to 90 alive weight through Hell. Missed for that bot.
- Bosses as the point of failure: missed. Deaths come in the waves around the bosses, because a boss wave puts only the boss and its pack on the ring and the alive count eases while it walks. Making boss waves carry an escort stream is the next lever.
- Tier timing: first T2 on waves 9 to 12 (Normal Act 2 to 3, met), first T3 on waves 21 to 33 (median about 24, late Normal; target Nightmare Act 1, close), first evolution on waves 45 to 52 (late Nightmare to Hell Act 1; target Hell Act 3, early). T5 does not exist yet: the design's three-tower evolutions are still to be built, so its timing is not measured.
- Unspent gold: the bots hold 10k to 60k at Hell's boss waves, saving for the next tower or the evolution, both now very dear. With T3 the top tier and T5 not built there is little else to buy; the item stages add the sinks.

### Stage B: endless Tiers past Hell Baal (Oct 22)

After wave 75 the run goes on forever and never ends in a win. Every 10 waves is a Tier (Tier 1 is waves 76 to 85). Waves 1 to 9 of a Tier walk Hell's 20 regular waves in campaign order, round all five acts, with their packs and the Tier's champion pack on wave 9; wave 10 brings an act boss back with its pack (Andariel, Duriel, Mephisto, Diablo, Baal in turn) at bossHpPct.last. Endless wave n has its monsters at level 85 + n (monlvl.txt extrapolated in a straight line past its last row, 110), and HP and damage multiplied by 3% compounded n times (balance.json endless). The waves are built as the run reaches them, from their index alone, so every sim in a lockstep game builds the same ones. Each Tier also raises the drop rate (Stage D).

Harness: the itemless ordinary bots now all lose by early Tier 1 (TWOLINE and PALADIN on wave 77 with Hell Baal still lapping; NECRO and MIXED3 in Hell Act 2), so nothing stalls on Baal any more. The target for a bot in best-in-slot items (dies between waves 175 and 225) is tuned in Stage F, with the item bots.

### Stage C: item data (Oct 22)

Items come from the player's install, nothing hand-listed: every spawnable base in weapons.txt and armor.txt, and from misc.txt the rings, amulets, jewels, gems and runes (583 bases), with each base's type chain from itemtypes.txt; 396 uniques, 140 set items in 35 sets with their partial and full bonuses, 517 magic prefixes and 474 suffixes, rare names, 99 runewords and the gem and rune socket effects. Names are D2R's strings. Charms, potions, scrolls, keys and quest items are left out. The model is src/sim/items: data.ts reads the tables, item.ts rolls an item (a plain JSON record a command or a save can carry whole) on the sim's seeded RNG, gear.ts sums what a tower wears, tower.ts applies it in the sim.

- Rolling is D2's: the affix level from the item level and the base's quality and magic levels; a magic item has a prefix, a suffix or both; a rare 3 to 6 affixes, at most three of each, one per affix group; affixes only from their item types and never their excluded types, class affixes only on that class's items; uniques and set items by rarity among those of the base at or under the item level, falling back to rare when none fits. Every property rolls once between its min and max; properties.txt turns its code into stats (func 15, 16 and 17 for elemental min, max and length, 21 for +class skills, 11 for chance to cast).
- Paperdoll: weapon, shield, helm, body armour, gloves, boots, belt, two rings, amulet, all live. A two-handed weapon (2handed and not 1or2handed) needs the shield hand free, and a shield needs a one-handed weapon. Class items (itemtypes.txt Class: Auric Shields, Orbs, Voodoo Heads and the other four classes' items) fit only their class's towers; with three tower classes, the other four classes' items fit no tower and are for selling.
- Sockets: a base's limit is its type's MaxSockets for the item level (up to 25, 40, above), capped by its own gemsockets. A gem or rune gives its weaponMod, helmMod (helms and body armour) or shieldMod stats by where it sits; a jewel its own stats. Runes in order, filling exactly the sockets of a white or superior item of an allowed type, make the runeword, with the runes' own stats on top.
- Per-level stats ("based on character level") are taken at the item's level, capped at 99: a tower has no character level.

Stat mapping (src/sim/items/gear.ts and tower.ts), D2's values throughout:

| D2 stat | On a tower |
| --- | --- |
| +all skills, +class skills (that class only), +skill tab of the class | levels added to the tower's line skill: skills.txt levels 1, 5, 10, 15, 20 become 1+n ... 20+n, on every tier and on an evolved tower's attack and partner. The raised skill keeps its art and counts as the same curse or aura. |
| +a single skill (by name or Id), +fire skills (on fire skills) | the same, when it is the tower's skill |
| Enhanced damage, +min/+max damage | melee towers: the worn weapon's base damage (ethereal +50%) plus the flat damage, with enhanced damage added to the skill's damage percent. Spells take none of it, as in D2. |
| Added fire, cold, lightning, magic and poison damage | melee towers: an extra hit of that element per swing (cold with its chill length, poison over its length) |
| Increased attack speed | melee towers: attack speed, at D2's effective rate 120 x IAS / (120 + IAS) |
| Faster cast rate | every other tower: cast speed, the same diminishing rate |
| Crushing blow | melee: a quarter of the monster's life before the hit (an eighth for uniques and bosses), never on physical immunes |
| Deadly strike | melee: doubles the physical part of the hit |
| Slow target, freeze target | melee: slows for two seconds; freezes (never bosses) |
| Gold find | the killing tower's bounty, added: 100% gold find doubles it |
| Magic find | the killing tower's drops (Stage D) |
| Defence, enhanced defence, block | durability: monsters hit the tower's summons by D2's chance to hit (their attack rating against the defence, 5% to 95%) and then the summon blocks by the block chance. Monsters never attack towers. |
| Resistances, life, mana, leech, attributes, light radius | nothing |

Not yet built: chance to cast on hit and on attack (the stat is read and kept, but a tower casts only its own skills), open wounds and pierce; the worn weapon does not yet change the tower's weapon layer (the class composites are extracted with one weapon each).

### Stage D: drops (Oct 22)

Every kill rolls its drops as D2 does (src/sim/items/drops.ts), on a drop stream of the sim's RNG seeded from the run's seed, so loot never moves combat's rolls and every lockstep peer rolls the same items.

- The treasure class is the monster's monstats TreasureClass, TreasureClassChamp or TreasureClassUnique for its difficulty (a superunique's own superuniques.txt TC; act bosses' rows name their boss classes), upgraded within its group to the highest class at or under the monster's level. Picks roll against NoDrop and the entries' Prob; negative picks drop each entry its Prob times in order; nested classes resolve down to an item code or an automatic class (weap3 to weap87, armo, bow, mele, abow: the bases of that type within three levels, weighted by their rarity column). At most six items a kill. Gold (bounty pays instead), potions, charms, scrolls, keys, ammo and quest items come up as nothing.
- Quality is itemratio.txt's (the expansion rows; normal, exceptional and elite, class items): unique, set, rare, magic, superior in turn, each 128 in (ratio - (ilvl - qlvl) / divisor) x 128, divided by magic find (diminishing for unique 250, set 500, rare 600), floored at the minimum, less the treasure class's quality bonus in 1024ths. A unique with none of its base at the item level becomes rare, a set item magic, as in D2. Rings, amulets and jewels are never white. The item level is the monster's level; the magic find is the killing tower's.
- Rune entries (rune codes and the Runes N classes) weigh balance.json drops.runeMultiplierPct, 125%, against everything else: D2R's rates otherwise.
- Endless Tiers: each Tier multiplies the drop rate by 1.25, compounding (drops.tierDropPct 25: NoDrop is divided by 1.25 per Tier, so Tier 4 has 2.4x the drops and Tier 10 9.3x), and Smith's Hammer's chance with it.
- Smith's Hammer (code xsh, ours, drawn as the Hellforge Hammer): its own roll on every kill, drops.smithsHammerPpm 10 in a million, the rate npm run drops measures for Um and Ist from Hell's monsters. Stackable.
- A drop is the killer's (the player whose tower last hurt the monster). It lands at the kill spot with its item's D2 drop sound (weapons, armor and misc dropsound, extracted through sounds.txt) and D2R's name label in the quality's colour. Its owner clicks the label to pick it up (a pickup command); when the monster's wave is cleared, whatever is still on the ground goes to the owner's inventory if there is room (D2's 10 x 4 grid, placed column by column from the top left, consumables stacking) and is lost otherwise. Only your own drops show.

npm run drops (all 75 campaign waves killed once a run, 20 runs, no magic find): Normal 128 items a run (79 white, 33 magic, 6 rare, about one set item and a unique every ten runs), 1.6 runes; Nightmare 89 items, 0.7 sets and 0.7 uniques, 4.7 runes up to Lem; Hell 73 items, 0.6 sets, 0.2 uniques, 1.6 runes, the odd Mal, Gul or Cham. A Smith's Hammer is rare in the campaign (about one in 100,000 Hell kills) and comes with the Tiers.

### Stage E: inventory, stash, socketing, selling, trading (Oct 22)

- Panels: I (or the panel's inventory button) opens D2R's inventory on the right and the stash on the left, drawn with D2R's own panel art and D2R's HD inventory sprites for every item (hd/items/items.json, uniques.json and sets.json map each code, unique and set item to its sprite; extracted at setup). Items move as in D2: click to hold one on the cursor, click where it goes; right-click or Escape puts it back. Tooltips are D2R's: name in its quality colour, the base under it, damage or defence with what the item adds in blue, required level, class restriction, the magic properties in itemstatcost.txt's order with D2R's strings, sockets and ethereal, and set bonuses (green once enough pieces are worn on that tower).
- The paper doll is the selected tower's: click one of your towers, open the inventory, and its ten slots show what it wears. D2's rules apply: two-handed weapons leave no hand for a shield, class items only on their class's towers. Equip and unequip are commands carrying the whole item record. A tower sold or used up in an evolution sends its gear back to its owner's inventory, or to the stash when the inventory is full.
- Sockets: hold a gem, rune or jewel over an item with an empty socket (in the inventory or on a tower) and click. Sockets never unfill. Runes spelling a runeword, in order, in exactly that many sockets of a white or superior base of an allowed type, make the runeword. Smith's Hammer, held over an item and clicked, adds a socket up to the base's maximum for its item level and refuses there (and on runewords).
- Rune tooltips list every runeword the rune is in, in rune order: the runes (in brackets the ones this player owns none of, in the inventory or stash), the base types and the sockets needed.
- Selling: drop an inventory item on the Sell box. The price is D2's cost (the base, then each affix's multiply and add, a unique's or set item's cost mult and add, plus whatever fills its sockets) divided by 4, capped by the vendor's purse for the ring's stage (balance.json vendorCap): Normal 100 gold in Act 1 rising by act to 1,500 in Act 5, Nightmare 2,500 to 10,000, Hell 15,000 to D2's 35,000, and 10% more per endless Tier, compounding. Uniques, set items and runewords ask first.
- Profile: inventory, stash (10 x 10 pages, a page added whenever one is needed) and best wave, in the app data folder per Windows user (userData/profile.json, written to a temporary file and renamed so a crash never loses it), in localStorage in a browser. Saved on every change. While a game runs the sim owns the inventory (every peer must agree what fits); the profile mirrors it and records what the towers wear as in play. Leaving a game any way (quit, restart, defeat, disconnect, or closing the app, which the next start catches) brings everything home into the inventory, overflow into the stash. Items from any mode work in every mode. Checkpoints keep no items: a continued game starts with bare towers.
- Trading (multiplayer): each player has a Trade button per other player on the inventory panel. D2R's trade window replaces the stash for both: their offer above, yours below; drop inventory items on your grid to offer them (they fade in the inventory), click one to take it back, click your gold to add 100 (shift 1000, right-click less), and click the check to accept. Any change clears both accepts; when both have accepted, items and gold move at once, or nothing moves if it no longer fits. Trades are match commands, so they work between FFA rings too, and every peer applies them on the same tick.

### Stage F: the harness with items (Oct 22)

npm run loot plays each bot four ways (tools/loot.ts, tools/outfit.ts): no items; nm, every drop of one pass through Normal and Nightmare (each monster killed once, no magic find); hell, the same through Hell too; bis, every unique, set item and runeword at its best rolls (runewords on the best base that takes them), any number of copies. An outfitter dresses the bot's towers from the pool once a wave, slot by slot, keeping whatever raises the tower's line skill's standard damage per second most with the gear on (+skills raising the skill, the weapon and enhanced damage on melee towers, attack or cast speed), and +skills and speed for aura and summon towers. Item stats are D2's throughout; nothing was tuned on the items.

Results (seeds 1 and 2; waves, towers at the end):

| Bot | none (target Hell Act 1-2) | nm (target Hell Act 4-5) | hell (target Tier 3-6) | bis (target 175-225) |
| --- | --- | --- | --- | --- |
| TWOLINE | 77, 77 | 77, 88 | 77, 88 | 110, 106 |
| PALADIN | 77, 77 | 77, 77 | 77, 77 | 119, 119 |
| NECRO | 60, 58 | 60, 59 | 60, 60 | 58, 58 |
| MIXED3 | 59, 59 | 77, 77 | 99, 98 (met) | 115, 120 |

Missed, and why:
- The two Paladin bots die on wave 77 with no items, with Normal and Nightmare loot and with the whole campaign's loot alike: Hell Baal at bossHpPct 900% laps the ring and they cannot kill him, so the next waves pile onto the alive count. Itemless they clear Hell Acts 1 to 4, so they also miss the itemless target from the other side.
- The Necromancer bot dies in Hell Act 2 whatever it wears, best in slot included: Hell's immunity walls stop its lines, and no item stat breaks an immunity in the mapping (resist and pierce stats do nothing).
- Best in slot reaches waves 106 to 120, not 175 to 225. It is a wall, not a slope: with endless scaling at 1% or 2% a wave instead of 3% (npm run loot -- --set endless.hpPctPerWave=1 --set endless.damagePctPerWave=1) PALADIN still dies on 119 and TWOLINE on 119; only MIXED3 moves (131 at 1%). The endless Tiers walk Hell's regular waves with their immunities, and a Tier's fourth wave brings monsters immune to everything a two-line Paladin does. The levers are the immunity schedule in the Tiers, the boss HP ramp, and giving item stats that cut resistance (D2's -enemy resistance and pierce stats, now ignored) an effect; Stage A and B's numbers were left as they are, since moving them does not reach these targets.
- MIXED3 with the whole campaign's loot dies in endless Tier 3, on target; with Normal and Nightmare loot it gets past Hell (wave 77) rather than dying in Hell Act 4 or 5.

### The Secret Cow Level (Oct 22)

- Wirt's Leg is the real item (weapons.txt leg, its own HD sprite), stackable here. It drops only in Hell and the endless Tiers: 20 in a million from any kill, 2% from each of Griswold's pack (balance.json cow legPpm and griswoldLegPpm; a named monster's pack carries its id, so the Griswold wave knows its own).
- Right-click a leg in the inventory: one is used up (a cowPortal command), D2's red portal (objects/pp, opening then steady) opens at the opener's spawn with D2's portal sound, Moo Moo Farm's song (levels.txt SoundEnv) replaces the act's, and the map swaps to Moo Moo Farm (an Act 1 Wilderness level in D2: the field's grass and road with its farm fences and the farmhouse; src/data/map/act1.json cow).
- The portal takes the wave timer for three cow waves (monsters.json cow): eight packs of ten Hell Bovines each (D2's hordes: the pack count is harness-tuned, below), at their Hell level 81 or the run's current level if higher, with the endless HP and damage scaling of the wave the run was on. The Cow King (The Cow King's superuniques.txt row: unique rank, Magic Resistant and Lightning Enchanted) leads the third wave with his pack of six. Every cow comes out of the portal: the opener's arc in multiplayer, the first arc alone.
- Cows weigh 1 each on the alive count, the Cow King too. Rune entries weigh five times as much on cows' drops (cow runeBoost). The Cow King always drops a rune of Ist or higher, drawn from D2's Runes classes so higher runes keep their rarity, and has a 5% chance of another leg.
- The campaign resumes on the timer after the third cow wave, at the scaling it had; the portal closes, and the farm and the music give way to the act again, when the last cow dies. Cow drops go to their owners' inventories when the portal closes.
- Harness (npm run cow): PALADIN, the only itemless bot that reaches Hell Act 5, opening the portal as Hell Act 5 begins, seeds 1 to 5: 4 of 5 runs lose to the cows (the ring overruns during the cow waves); seed 3 clears them at a peak of 96 alive and, with the cows' gold, lives to wave 85 against 77 without the portal. Six packs of eight let every run clear the cows; ten packs of ten killed every run.

## Overnight decisions

Calls made without asking, each the option closest to Diablo II's own rules.

- Oct 22: the overnight job lists Acts 2 to 5 content as Stage H, after the economy (A) and item stages. It was finished first: the economy and item targets are measured on real content, and Acts 2 to 4 were already in progress.
- Oct 22: D2R has no monster named Wendigo. The Snow Yeti family (Snow Drifter and kin) stands in for it, as the Act 5 monster nearest to a wendigo and the class D2 gives Frozenstein.
- Oct 22: Act 5 has fifteen regular waves for its thirteen listed monsters. The two spare Hell waves are Imps (Demon Gremlin) and Death Maulers again, at stronger variants of their own families, rather than monsters from outside the list.
- Oct 22: Zeal's "adjacent tiles" reach is the orthogonally adjacent path tile (1.1 tiles); diagonal neighbours would be 1.5 tiles, the old reach.
- Oct 22: the Zakarum Priest heals and the Overseer cries for help in D2; the job asks for the Fallen Shaman treatment, so both raise their own kind (Zealots; Enslaved) and walk with their monstats party.
- Oct 22: a tower has no character level, so per-level item stats take the item's own level (capped at 99) as the wearer's.
- Oct 22: D2 adds weapon damage, enhanced damage and added elemental damage to attacks, never to spells. Towers follow it: only melee towers use them; the casters gain from +skills and faster cast rate, as a D2 caster does.
- Oct 22: monsters never attack towers, so armour's durability is the tower's summons: monsters roll D2's chance to hit against the gear's defence and then its block.
- Oct 22: items of the four classes without a tower (Amazon, Barbarian, Druid, Assassin) drop and sell but fit no tower.
- Oct 22: D2's NoDrop shrinks with players in the game; the ring always rolls as one player (each kill's drop is one player's), so NoDrop is D2's single-player value.
- Oct 22: minions of a unique or superunique drop from their own regular treasure class, as D2's minions do; only the leader uses the unique class.
- Oct 22: Smith's Hammer needs art and D2 has none for it; it is drawn as the Hellforge Hammer, the quest hammer D2 already has.
- Oct 22: D2 has no sell box in the inventory; sales happen at a vendor's trade window. With no vendor on the ring, the inventory panel has a Sell box beside the gold.
- Oct 22: D2 moves items by click-to-hold rather than drag and drop; the panels do it D2's way.
- Oct 22: the stash is outside the game (the profile), so items in it cannot be socketed or hammered: they are moved to the inventory first.
- Oct 22: the cow waves hold the campaign's wave timer: the campaign pauses for them rather than running underneath (D2's cow level is a place the player goes, not a second front), and resumes after the third.
- Oct 22: all cows come out of the portal, the opener's spawn, alone as well as in multiplayer, so the portal is where the cows are.
- Oct 22: Moo Moo Farm in D2 is an Act 1 Wilderness level with no tile set of its own; its map here is the Act 1 field with the farm's fences (Act1/Outdoors/Fence.dt1) in place of the boulders.

## Open questions

Answer these in the doc or in chat; each one changes code in M2 or M3.

- [x] Team mode gold: chained zones starved the last players. Answered by the ring (Oct 2026): every player's arc spawns its own wave and kill gold goes to the killer.

- [ ] Smite: the stun alternative at Zealot T1, or saved for the Smiter evolution?
- [ ] Aura line: picks at T2 and T3 (Concentration or Holy Freeze, Fanaticism or Conviction), or one fixed skill per tier?
- [x] Summons block the path Kingdom Rush style, or stand beside it and shoot? Both (M6): skeletons and revives block, mages stand beside it and shoot.
- [x] Corpses as a shared system (Corpse Explosion, Revive, Fallen Shaman, Find Item), or Necromancer-only? Shared (M6).
- [x] After wave 30 the curve started again at the next difficulty. Answered by the campaign (Oct 2026): levels from the tables climb through five acts and three difficulties, with no curve to restart.
- [x] Act 1's Hell has no magic or poison immunes in the tables. Answered (Oct 2026): Magic Immune and Poison Immune mods on Hell's fixed specials, D2's fifth-strength rule for every resistance cut, no tier bonus on debuffs, skeleton HP from skills.txt and monsters hitting summons with their own difficulty's damage (see Enemies, waves and difficulty).
- [ ] The M6 gate on the Act 1 schedule (Oct 2026, seeds 1 to 3): no bot clears Hell, MIXED3 included (PALADIN dies on 6, SORC on 5, NECRO on 10 to 12, MIXED3 on 9 or 10), and Normal is lost too (BOLT, TWOLINE and PALADIN on 30, HOLY on 16). Two causes. Hell's waves are scaled to Normal's average HP across the act, but Normal's monsters climb from level 1 to 12 while Hell's all sit near 70, so Hell's early waves carry 2.5 to 3.5 times Normal's HP; scaling each monster to its own Normal HP instead lets MIXED3 reach wave 16 to 20. And the seven named bosses, with their own monstats HP, never blocked and 5 lives a leak, take 20 lives in four leaks; every bot leaks Blood Raven on wave 4. On Normal the late monsters' levels also lift bounty, so the bots bank 500k to 735k gold, and Normal's Andariel has about 520k HP. Per-monster difficulty scaling, boss HP or leak cost, and a level-neutral bounty are the levers.
- [ ] Skill levels per tier: 5, or 20 straight from skills.txt (Joel's 20+ upgrades)? The harness fixed total spend per tier (see src/data/balance.json); more levels means a gentler multiplier over the same total, not more gold.
- [ ] Random mode as a lobby toggle: random T1 skill for +25% gold?
- [ ] Items and runes persist across runs (D2 stash), or reset every run?
- [ ] Sell refund 60%: keep?
- [ ] Working title.
