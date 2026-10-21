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
- First playable: one map (Blood Moor), endless waves, gold only. Campaign, runes and items later.

* Multiplayer is in: FFA on a ring each, and team mode on one shared ring. The simulation is deterministic lockstep from M1, so multiplayer is a transport layer at M4, not a rewrite. Any player can host; there is no central server.
* Team mode shares one ring, an arc per player: one alive count for the team, and kill gold goes to the killer.
* No interest on gold. Extra income comes from a Barbarian gold-find line and gold-find gear.
* Endgame beyond Hell: tiers of harder waves, with runes and items as the power that keeps pace. Built at M7.

- Holy Bolt hits everything: 40% damage against non-undead, full damage against undead (house rule, Oct 2026). Upgrade costs and wave HP scale geometrically; the balance harness tunes the multipliers, not play-by-feel, and src/data/balance.json is the only place they are written down.

## Core loop and map

Build, kill, spend the gold, repeat. Monsters walk a ring and lap it until they die. The run is lost when the weight of everything alive on the ring reaches 100: a regular monster weighs 1, a champion 2, a unique 3 and an act boss 10 (balance.json aliveLimit and aliveWeight). The HUD shows it as a bar filling across the top of the screen, and the life globe fills with it; the wave tooltip says what each special weighs.

- The ring (src/data/map/ring.json, src/sim/map.ts) is four arcs, each the same turned a quarter more, so every player's arc is identical. Each arc in walking order: a long outer straight, a U-bend dented into the interior (its one-tile pocket touches all three legs), then a 90 degree corner that hands the path to the next arc. Each arc's spawn point is one tile past its handoff corner. Four-fold symmetry needs a square grid: 42 x 42 tiles, the tile count of the 48 x 36 first asked for, a 172-tile loop. ring.json gives arc 0 and the scenery on its wedge; the code turns both onto the other three.
- Every tile belongs to the arc whose wedge holds it (the four triangles between the diagonals); each arc owns the corner handed to it. Path tiles and scenery tiles are unbuildable; everything else is buildable, one tower per tile, by whoever owns its arc. The renderer shows the square sim grid in D2's isometric view.
- Range is measured in tiles from the tower's centre. Melee towers reach 1.5 tiles, so they only work when placed touching the path.
- Targeting per tower: First, Last, Strongest, Weakest, Closest. Default First. First and Last go by how far a monster has walked in all, laps included.
- Summons stand on the path tile nearest their tower and block it. Monsters stop and fight blockers (Kingdom Rush barracks), but a monster held for 6 seconds breaks through, shoving the summon aside (it survives), and bosses are never blocked. Monsters never attack towers in v0.1.
- Speed comes from each monster's velocity in monstats.txt, so a Quill Rat really is faster than a Zombie.
- Calling the next wave early pays a bonus on that wave's bounty (see src/data/balance.json).

Modes (built Oct 2026):

- Single player owns the whole ring. Their wave is dealt out over the four spawn points, a pack or a tank at a time.
- Team: one shared ring, an arc per player (up to four; with fewer, the arcs go round so the whole ring is someone's). Every player's arc spawns the whole wave at its spawn point; the team shares the alive count; kill gold goes to the player whose tower last hurt the monster (poison counts as its caster's); each player has their own gold and changes only their own towers.
- FFA: a ring per player from the same seed, each with its own alive count; the last ring standing wins.

The camera: the ring is bigger than the screen. Drag (any mouse button) or WASD and the arrow keys pan, the wheel zooms, and zoom is whole numbers only (1x, 2x, 3x). The default view is your own arc at 2x. A minimap in the top-right corner shows the ring, each arc in its owner's colour, a dot per monster, and the camera's view; clicking it moves the camera. Anyone's towers can be looked at; on a team ring, keys 1 to n jump to a player's arc, and in FFA they watch that player's ring.

## Tower system

A tower is a class, a line, a tier and a level. The line is chosen once, the tier climbs the skill tree, the level scales the current skill.

**Build.** Place a class tower on a buildable tile for its base cost. It is inert until you pick one of three T1 skills. That pick fixes its line for good.

**Tiers.** T1, T2, T3 up the line, one skill per tier. Within a tier the tower has skill levels 1 to 5, bought with gold. Level 5 unlocks the next tier. Levels 1 to 5 map to skills.txt levels 1, 5, 10, 15 and 20 for damage, duration and radius, which gives authentic scaling for free.

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

The Act 1 schedule (Oct 2026, src/data/monsters.json) walks the act in 30 waves with no monster twice. HP, speed, resistances, undead and demon flags and flying come from monstats.txt per difficulty; the named bosses from superuniques.txt.

- Eight boss waves, each the boss behind its D2 pack: Blood Raven (monstats minion1 and PartyMin-PartyMax: 7 Hungry Dead), Rakanishu (8 Carvers), Treehead Woodfist (2 Brutes), The Countess (6 Dark Stalkers), Griswold, The Smith, Bone Ash, and Andariel on 30. The first seven are spread evenly over waves 4 to 27 in campaign order (balance.json waves.bossWaves): 4, 8, 12, 16, 19, 23, 27. A superunique is its class's monster with its own name, palette (Utrans), mods (Mod1 to Mod3) and monumod's unique HP bonus; a pack is MinGrp-MaxGrp of the class's minion1 or the class itself, midway. Bosses roll their own monstats HP on the wave curve like any monster.
- The other 22 waves are one Act 1 monster each, in the order a player meets them: Blood Moor (Fallen, Quill Rat, Zombie), Burial Grounds (Skeleton), Cold Plains (Gargantuan Beast, Dark Hunter, Dark Spearwoman), Stony Field (Moon Clan, Foul Crow), Dark Wood (Vile Hunter, Spike Fiend, Skeleton Archer), Black Marsh (Night Clan, Blood Hawk), Barracks and Jail (Black Rogue, Death Clan, Bone Mage, Wraith), Tristram (Returned), Cathedral (Tainted), Catacombs (Ghoul, Banished). Colour variants are their own monsters; a boss's pack monster does not get a wave of its own. Each is a swarm (packs) or a tank (one at a time), a design call in monsters.json. Flyers (Foul Crow, Blood Hawk, Wraith) walk the path for now, flagged in the data.
- Fallen Shamans have no wave: alone they have no corpses to raise. The roster keeps their resurrect for the sim.
- Champion packs stay on 5, 15 and 25 and uniques on 10 and 20, as the wave's own monster with the fixed mods. After 30 the map loops at Nightmare scaling, then Hell.
- Pacing (Oct 2026): a wave is a stream, not a clump. Tanks come one at a time, about 1.25 s apart; swarms come in packs of 3 to 4, as Fallen move in D2, with about 4 s between packs; champions, uniques and bosses follow after a pause. With no towers a normal wave lasts 50 to 70 s from first spawn to last exit: the count grows past its base only while the wave is shorter than that, up to a cap, and difficulty grows through HP instead. Waves with Zombies (0.6 tiles a second in monstats) and boss waves run longer, about two and a half minutes. Spacing, packs, counts and the target length are in src/data/balance.json; npm run waves reports the timing.
- Monster mods are D2's: Extra Fast, Extra Strong, Stone Skin (physical resist), Magic Resistant, Fire, Cold and Lightning Enchanted, Cursed, Teleportation (skips one path segment). Enchanted adds 75 to its element's resistance, so on an already resistant Hell monster it is an immunity; its death burst that stuns nearby summons, and Cursed's aura (towers in radius lose 25% damage), are not built yet: the bosses carry the mods for their resistances only.
- Normal, Nightmare and Hell use the three HP and resistance columns of monstats.txt. Hell immunities are the point: no single line clears Hell, so the player has to mix elements and magic.
- Hell's walls (Oct 2026), as rules: an immune mod (+100, ours: Magic, Poison and Physical Immune) replaces the matching resistant mod (Magic Resistant, Poison Resistant, Stone Skin) and never stacks with it, on every boss and special (balance.json monsterMods replaces). Every Hell champion pack carries Stone Skin and Poison Immune: Stone Skin lifts a Hell champion's physical resistance to 100, so each pack is physical and poison immune. Stone Skin is +50 on Normal and D2's +80 on Nightmare and Hell elsewhere, stopping at 99. Hell's Treehead (12) is Magic Immune and Griswold (19) Magic and Physical Immune; Hell's Andariel is Physical, Magic and Poison Immune with fire, cold and lightning from her raw Hell columns (-50, 66, 66), so any elemental line can kill her. Nightmare gets the resistant versions: Poison Resistant (+40) on the champions and Andariel, Magic Resistant on Treehead and Griswold, and Andariel keeps her Magic Resistant. They sit on top of Normal's mods (balance.json modSchedule.added), each mod once.
- Nothing leaks: a monster laps the ring until it dies, and weighs on the alive count while it lives (champion 2, unique 3, act boss 10). Bosses are never blocked.
- How difficulty is built (M6): a Nightmare or Hell monster is its own entry (`fallen1@hell`) with that difficulty's resistances, immunities and HP columns. The wave curve compounds HP per wave, so raw Hell columns on top of it would be impossible; instead each difficulty's wave monsters are scaled to a percent of Normal's average HP (balance.json difficultyHpPct). The columns decide who is tough against whom, the curve and the percent how tough. Bounty follows each monster's Normal level, so gold keeps to the curve. The lobby and single player pick where a run starts; after its 30 waves the map loops at the next difficulty, up to Hell, and the curve starts again. Act 1's Hell columns hold fire, cold and lightning immunities (Fallen, Zombies and Rogues, Skeletons) but nothing against magic or poison.
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

Gold only in v0.1. The M1 grey-box was far too easy with flat costs and flat HP, so the curves below are geometric; tools/balance.ts tunes the multipliers against three bot strategies (spam, upgrade, mixed) until a mixed bot survives to wave 25 to 30 and the other two lose between 12 and 20.

Target rhythm (Green TD, not a treadmill): tier-ups and evolutions are big jumps, about 2.5x DPS, that buy three or four comfortable waves while HP keeps compounding underneath; levels within a tier are small and few. A player should feel ahead right after a purchase and behind two waves later. The harness logs per-wave margin so the sawtooth is visible, and the 110% floor is only the no-downgrade guarantee, not the target.

- Bounty per kill = monster level x 2, scaled per wave by a harness-tuned multiplier (see src/data/balance.json). Champions x3, uniques x5, Blood Raven x20, Andariel x50. Wave HP compounds per wave (see src/data/balance.json), so the player is always slightly behind.
- Wave-clear bonus and early-call bonus: see src/data/balance.json.
- Starting gold 300, enough for two towers. No lives: the alive count is the loss condition. Swarm waves spawn 6 + 2 per wave, tank waves 3 + 1 per wave.

* No interest on banked gold. Extra income is a tower, not a bank: the Barbarian's Find Item line loots corpses in radius for bonus gold, and gold-find gear stacks on it in the endgame.

| Action | Gold |
| --- | --- |
| Build a class tower | 150 |
| T1 skill pick | free |
| Skill level +1 | Geometric from a base of 40 at T1, 80 at T2, 120 at T3; the per-level multiplier is harness-tuned (see src/data/balance.json) |
| Upgrade to T2 | 250 |
| Upgrade to T3 | 500 |
| Evolve to T4 | 400 |
| Sell | 60% of everything spent on the tower |

A Hammerdin therefore costs both parents built, levelled and tiered, plus the evolution fee (totals follow from the multipliers; see src/data/balance.json), and two tiles before it costs one.

## Visuals and asset pipeline

The look is D2R's legacy toggle done well: classic sprites at 1x with nearest-neighbour sampling, HD panels, fonts and skill icons around them. Since M5 the renderer projects the square sim grid into D2's 2:1 view: one sim tile is a 64 x 32 diamond, two by two of D2's subtiles, so the 42 x 42 ring is a 2688 x 1344 diamond in world space, bigger than the screen. A world camera pans and zooms over it (1x, 2x, 3x) and a second, flat camera draws the HUD, panel and minimap over it; the canvas with HUD and panel is 1440 x 1000, which fits 1080p at zoom 1 with a title bar above the taskbar. Sprites, missiles, HP bars, range ellipses, the build highlight and clicks all go through the projection and its inverse, and everything on the map sorts by projected y. The canvas zooms as a whole by the largest whole number that fits the window and letterboxes the rest; no sprite is scaled on its own and nothing is ever scaled by a fraction. Tile size is render-only: the sim's tile stays 1000 units, so ranges and path lengths do not change. (The ring keeps D2's 64 x 32 diamond rather than the 48 px square tiles first asked for, because the isometric view is locked above.)

- Monsters, heroes and missiles: classic DCC/DC6 frames composited through COF layer files, coloured with the Act 1 palette (pal.dat) and the PL2 colour shifts for champions and uniques.
- UI, skill icons, item art, fonts: D2R HD .sprite files, decoded to PNG.
- Map: the ring is grey-boxed (flat tiles: dirt path, dark scenery, grass edged in each arc owner's colour) until its Blood Moor bake. The M5 bake of the old straight road is gone with that road.
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
- Wave clock (built in M4): in FFA and team, waves start in every lane together, either when every player still in has pressed Call Wave or when the clock runs out (time to wave 1 and between waves: see src/data/balance.json, multiplayer). Independent wave calls could not settle "last one standing". Solo keeps Call Wave as it was.
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

## Open questions

Answer these in the doc or in chat; each one changes code in M2 or M3.

- [x] Team mode gold: chained zones starved the last players. Answered by the ring (Oct 2026): every player's arc spawns its own wave and kill gold goes to the killer.

- [ ] Smite: the stun alternative at Zealot T1, or saved for the Smiter evolution?
- [ ] Aura line: picks at T2 and T3 (Concentration or Holy Freeze, Fanaticism or Conviction), or one fixed skill per tier?
- [x] Summons block the path Kingdom Rush style, or stand beside it and shoot? Both (M6): skeletons and revives block, mages stand beside it and shoot.
- [x] Corpses as a shared system (Corpse Explosion, Revive, Fallen Shaman, Find Item), or Necromancer-only? Shared (M6).
- [ ] After wave 30 the curve starts again at the next difficulty, so a full board meets an easy wave 1 of Nightmare. Start the loop further up the curve?
- [x] Act 1's Hell has no magic or poison immunes in the tables. Answered (Oct 2026): Magic Immune and Poison Immune mods on Hell's fixed specials, D2's fifth-strength rule for every resistance cut, no tier bonus on debuffs, skeleton HP from skills.txt and monsters hitting summons with their own difficulty's damage (see Enemies, waves and difficulty).
- [ ] The M6 gate on the Act 1 schedule (Oct 2026, seeds 1 to 3): no bot clears Hell, MIXED3 included (PALADIN dies on 6, SORC on 5, NECRO on 10 to 12, MIXED3 on 9 or 10), and Normal is lost too (BOLT, TWOLINE and PALADIN on 30, HOLY on 16). Two causes. Hell's waves are scaled to Normal's average HP across the act, but Normal's monsters climb from level 1 to 12 while Hell's all sit near 70, so Hell's early waves carry 2.5 to 3.5 times Normal's HP; scaling each monster to its own Normal HP instead lets MIXED3 reach wave 16 to 20. And the seven named bosses, with their own monstats HP, never blocked and 5 lives a leak, take 20 lives in four leaks; every bot leaks Blood Raven on wave 4. On Normal the late monsters' levels also lift bounty, so the bots bank 500k to 735k gold, and Normal's Andariel has about 520k HP. Per-monster difficulty scaling, boss HP or leak cost, and a level-neutral bounty are the levers.
- [ ] Skill levels per tier: 5, or 20 straight from skills.txt (Joel's 20+ upgrades)? The harness fixed total spend per tier (see src/data/balance.json); more levels means a gentler multiplier over the same total, not more gold.
- [ ] Random mode as a lobby toggle: random T1 skill for +25% gold?
- [ ] Items and runes persist across runs (D2 stash), or reset every run?
- [ ] Sell refund 60%: keep?
- [ ] Working title.
