# D2 Tower Defense: Design Doc v0.1

Oct 20, 2026 · @Alexander

## Concept

A fixed-path tower defense built from Diablo II's own data and art, where every tower is a D2 class and every endgame tower is a famous build. You place a class, pick a skill, upgrade it up the tree, and fuse two upgraded towers into a Hammerdin, a Zealdin or a Meteorb. The recognition factor is the hook: D2 players already know what they want to build.

Non-commercial fan project. The game ships zero Blizzard assets and reads them from the player's own Diablo II: Resurrected install, the same posture as D2 Survivors.

## Decisions locked (Oct 20)

- Unit art: classic D2 sprites at 1x on 48 px tiles, nearest-neighbour, never scaled individually. The whole canvas zooms by the largest whole number that fits the window (1 at 1080p, 2 at 4K) and the rest is letterboxed (changed from 2x after M2b: at 2x units stood two tiles tall). HD .sprite files for UI, skill icons, item art and fonts. The HD 3D models are a later experiment on one monster and never block the game.
- Map: fixed path. Towers go on any open tile off the path. No mazing.
- Evolution: two adjacent prerequisite towers are consumed into one evolved tower. One tile is freed.
- Launch classes: Paladin, Sorceress, Necromancer. Amazon, Barbarian, Druid and Assassin come after the loop is fun.
- Tower structure: 3 lines per class, 3 tiers per line, T4 evolutions from two towers. T5 evolutions from three towers later.
- Skills are data on ten archetypes (see Skill archetypes). No bespoke code per skill.
- Numbers: skills.txt and monstats.txt values are the baseline, tuned from there.
- Difficulty comes from D2's own systems: resistances, immunities and monster mods. Act bosses close acts. No flying enemies.
- First playable: one map (Blood Moor), endless waves, gold only. Campaign, runes and items later.

* Multiplayer is in: FFA on separate identical lanes, and team mode with shared lives. The simulation is deterministic lockstep from M1, so multiplayer is a transport layer at M4, not a rewrite. Any player can host; there is no central server.
* Team mode chains the zones: your leaks walk into the next teammate's zone, kill gold goes to the killer, and only a leak past the last zone costs a life.
* No interest on gold. Extra income comes from a Barbarian gold-find line and gold-find gear.
* Endgame beyond Hell: tiers of harder waves, with runes and items as the power that keeps pace. Built at M7.

- Holy Bolt hits everything: 40% damage against non-undead, full damage against undead (house rule, Oct 2026). Upgrade costs and wave HP scale geometrically; the balance harness tunes the multipliers, not play-by-feel, and src/data/balance.json is the only place they are written down.

## Core loop and map

Build, survive a wave, spend the gold, repeat. A run ends when 20 lives are gone: a leaked monster costs 1 life, a leaked boss costs 5.

- The map is a square tile grid (30 x 17 tiles, drawn at 48 px; 1440 x 816 plus HUD and panel fits 1080p at zoom 1) with the path as an ordered list of waypoints. Diagonal path segments are allowed; monsters have 8-direction sprites, so they always face the way they walk.
- Path tiles and scenery tiles are unbuildable. Everything else is buildable, one tower per tile.
- Range is measured in tiles from the tower's centre. Melee towers reach 1.5 tiles, so they only work when placed touching the path.
- Targeting per tower: First, Last, Strongest, Weakest, Closest. Default First.
- Summons stand on the path tile nearest their tower and block it. Monsters stop and fight blockers (Kingdom Rush barracks). Monsters never attack towers in v0.1.
- Speed comes from each monster's velocity in monstats.txt, so a Quill Rat really is faster than a Zombie.
- Calling the next wave early pays a bonus on that wave's bounty (see src/data/balance.json).

In team mode the map is one path through every player's zone in order, so a teammate can kill your leaks. In FFA each player has an identical, separate lane. Rules in Multiplayer below.

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

| Evolution | Recipe | What it does |
| --- | --- | --- |
| Zealdin | Zeal (T2+) + Fanaticism (T3) | Zeal swings at Fanaticism speed; projects a half-radius Fanaticism aura. |
| Hammerdin | Blessed Hammer (T2+) + Concentration (T2+) | More hammers, harder hammers, pure magic damage; half-radius Concentration. |
| Avenger | Vengeance (T3) + Conviction (T3) | Tri-element melee on resistance-shredded targets; the physical-immune answer. |
| Templar | Fist of the Heavens (T3) + Conviction (T3) | FoH with no cooldown; the boss killer. |
| Smiter (later) | Smite + Fanaticism | Needs Holy Shield to exist; bonus damage and stun against bosses. |
| Auradin (T5, later) | Holy Fire + Holy Shock + Conviction | Three towers; needs the aura line to branch first. |

## Sorceress and Necromancer (draft)

Both follow the Paladin pattern: two damage lines and one support line, with evolutions that cross lines. Names and picks are placeholders until the Paladin plays well.

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

Corpses are the Necromancer's twist: a killed monster leaves a corpse for 10 seconds that Corpse Explosion, Revive and the Fallen Shaman all compete for.

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

Damage types follow D2: physical, magic, fire, cold, lightning, poison. Each monster's resistances per difficulty come straight from monstats.txt, and 100%+ is an immunity.

## Enemies, waves and difficulty

The Act 1 roster covers every TD archetype without inventing anything. HP, speed and resistances come from monstats.txt per difficulty.

| Monster | Role | Notes |
| --- | --- | --- |
| Fallen | Swarm | Cheap, fast, many. |
| Fallen Shaman | Support | Resurrects Fallen corpses in radius; priority target. |
| Zombie | Tank | Slow, high HP. |
| Skeleton | Undead | Takes bonus damage from Holy Bolt and FoH. |
| Quill Rat | Fast | Low HP, high speed. |
| Corrupt Rogue | Standard | Baseline enemy. |
| Dark One | Fast swarm | Carver family, runs in packs. |
| Gargantuan Beast | Heavy tank | Slow, very high HP. |
| Blood Raven | Mini boss | Fast, every 10th wave. |
| Andariel | Act boss | Wave 30, poison immune. |

- Waves mix 2 to 4 monster types and alternate swarm-heavy and tank-heavy. Champions (one mod) every 5 waves, uniques (two mods) every 10, Blood Raven on 10 and 20, Andariel on 30. After 30 the map loops at Nightmare scaling, then Hell.
- Monster mods are D2's: Extra Fast, Extra Strong, Stone Skin (physical resist), Magic Resistant, Fire, Cold and Lightning Enchanted (immunity plus a death burst that stuns nearby summons), Cursed (towers in radius lose 25% damage), Teleportation (skips one path segment).
- Normal, Nightmare and Hell use the three HP and resistance columns of monstats.txt. Hell immunities are the point: no single line clears Hell, so the player has to mix elements and magic.
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
- Starting gold 300, enough for two towers. Lives 20. Swarm waves spawn 6 + 2 per wave, tank waves 3 + 1 per wave.

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

The look is D2R's legacy toggle done well: classic sprites at 1x with nearest-neighbour sampling, HD panels, fonts and skill icons around them. Tiles are 48 px, so the map is 1440 x 816 and the canvas with HUD and panel is 1440 x 1000, which fits 1080p at zoom 1 with a title bar above the taskbar. The canvas zooms as a whole by the largest whole number that fits the window and letterboxes the rest; no sprite is scaled on its own and nothing is ever scaled by a fraction. Tile size is render-only: the sim's tile stays 1000 units, so ranges and path lengths do not change.

- Monsters, heroes and missiles: classic DCC/DC6 frames composited through COF layer files, coloured with the Act 1 palette (pal.dat) and the PL2 colour shifts for champions and uniques.
- UI, skill icons, item art, fonts: D2R HD .sprite files, decoded to PNG.
- Map: flat tile colours in M1. Blood Moor rendered from classic DT1 tiles in M5.
- Sound: classic WAV from the CASC, same path D2 Survivors takes.

Pipeline, a Node script run locally against files exported with CascView:

1. Export from the D2R CASC into assets-raw (gitignored).
2. Decode DCC, DC6, COF, PL2 and .sprite into PNG sprite sheets plus JSON atlases (frame, direction, offset, duration).
3. Parse the excel .txt tables (monstats, skills, missiles, skilldesc, monstats2) into JSON the game loads directly.
4. Write everything to assets-extracted (gitignored). The repo never holds a Blizzard byte.

First files to pull for M0: data\\global\\monsters\\zm, data\\global\\palette\\act1\\pal.dat, the data\\global\\excel folder, and a few HD skill icons from data\\hd\\global\\ui.

HD 3D experiment, after M2: export one monster's .model (Granny GR2) and textures, convert with lslib, render 8 directions from Blender by script. If the zombie comes out clean, the pipeline swaps in HD sheets and the game never notices.

## Multiplayer

FFA on separate lanes and team mode with chained zones and shared lives, built as lockstep from M1 and shipped at M4 with host-and-play. No cloud server needed for a handful of friends.

- Players: 2 to 6. FFA gives everyone an identical lane, the same waves and the same seed; last one standing wins. Sending extra monsters at a rival is the same tech and can come later.
- Team mode: zones sit along one path in player order. A leak from zone 1 walks into zone 2. Kill gold goes to the owner of the tower that killed. Only a leak past the last zone costs the team a life.
- Lockstep: every client runs the same deterministic simulation from the same seed. The only network traffic is the ordered command stream (build, upgrade, sell, evolve, call wave), relayed by the host. Fixed 20 ticks per second, seeded RNG, integer math in gameplay code, a state hash every 100 ticks to catch desync. A TD tolerates 200 ms of command delay without anyone noticing.
- Hosting: the host's Electron app carries the relay, so any friend who clicks Host is the server for that game; the others join with a code that carries the host's address. One forwarded TCP port on the host's router is the only setup; the app asks the router to open it by UPnP first, so most friends never touch router settings. Behind CGNAT with no public IP, Tailscale (free for a few people) replaces the port forward. For games the host is not in, the same relay runs as a service on a Pi, a NAS or an existing web server. If the host drops, the game ends.

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
7. M6 Sorceress and Necromancer. Summons that block, corpses, curses, elements, immunities. Gate: Hell waves cannot be cleared with one line.
8. M7 Endgame. Post-Hell tiers, loot, runes, runewords, stash, Barbarian gold-find line. Gate: a Hell+5 run needs gear to clear.

## Open questions

Answer these in the doc or in chat; each one changes code in M2 or M3.

- [ ] Smite: the stun alternative at Zealot T1, or saved for the Smiter evolution?
- [ ] Aura line: picks at T2 and T3 (Concentration or Holy Freeze, Fanaticism or Conviction), or one fixed skill per tier?
- [ ] Summons block the path Kingdom Rush style, or stand beside it and shoot?
- [ ] Corpses as a shared system (Corpse Explosion, Revive, Fallen Shaman, Find Item), or Necromancer-only?
- [ ] Skill levels per tier: 5, or 20 straight from skills.txt (Joel's 20+ upgrades)? The harness fixed total spend per tier (see src/data/balance.json); more levels means a gentler multiplier over the same total, not more gold.
- [ ] Random mode as a lobby toggle: random T1 skill for +25% gold?
- [ ] Items and runes persist across runs (D2 stash), or reset every run?
- [ ] Sell refund 60% and 20 lives: keep?
- [ ] Working title.
