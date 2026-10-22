# Installing D2 Tower Defense

D2 Tower Defense is a free fan game. It draws its monsters, heroes, maps, menus and sounds from your own copy of Diablo II: Resurrected, so you need that game on the same PC.

## Before you start

1. Diablo II: Resurrected must be installed on this PC through Battle.net.
2. Start Diablo II: Resurrected once and wait until you reach its main menu. Then close it. This makes sure the game has finished setting itself up.

## Install

1. Double-click **D2 Tower Defense Setup.exe** (the file name may end in a version number).
2. Windows may show a blue box that says **"Windows protected your PC"**. This is normal for this game. It appears because the installer is not signed, which costs money that a free fan project does not have.
   - Click **More info**.
   - Click **Run anyway**.
3. If it asks who to install it for, pick **Only for me**. That way Windows does not ask for an administrator password.
4. Pick where to install it, or keep the folder it suggests, and click **Install**.
5. When it finishes, start **D2 Tower Defense** from the Start menu or the desktop.

## The first time you start it

The first start shows a setup screen. Setup copies the pictures and sounds the game needs out of your Diablo II: Resurrected folder: every act's monsters and maps, the items, the menus and the control panel. It only reads from that folder and never changes it.

1. Check the folder shown under **Diablo II: Resurrected folder**. Usually it finds the right one by itself, for example `C:\Program Files (x86)\Diablo II Resurrected`.
2. If it says **Not found**, click **Choose folder...** and pick the folder where you installed Diablo II: Resurrected. It is the folder that has a folder called **Data** inside it.
3. Click **Extract game files** and wait. A bar shows how far it has got. It takes a few minutes.
4. The main menu appears. Click **Single Player**, then **Play**.

You only do this once. Next time the game opens straight to the main menu.

## After an update

A new version of the game may need a few more files from Diablo II: Resurrected. When it does, the setup screen appears by itself on the next start, copies only what is new or changed, and goes on to the main menu. You do not need to click anything, and it is usually done in seconds.

## Playing

- Click a free square next to the path to build a tower, then pick its class and first skill.
- Click a tower to upgrade it.
- The globe on the left shows your share of the current wave's kills; the globe on the right fills as monsters pile up on the ring. If it fills, the run is lost.
- **Send Wave** brings the next wave early for extra gold.
- Press **I** for the inventory, **Tab** for the map, and **Esc** for the menu. The menu has **Options**, **Save**, **Quit to Menu** and **Return to Game**.
- The game saves itself at the start of every act. **Continue** (under **Single Player**) picks up from there.

### Items

- Monsters drop items. Click a name on the ground to pick it up; whatever is left goes into your inventory when the wave is over, if there is room.
- Press **I** to open the inventory and the stash. Click an item to pick it up and click where it should go; right-click puts it back.
- To give a tower an item, click the tower, open the inventory, and put the item in one of the ten slots of the figure at the top.
- Put a gem, rune or jewel on an item with an empty socket to socket it. The four belt slots on the control panel hold gems and runes ready to socket.
- Drop an item on **Sell** to sell it. Smith's Hammer, put on an item, adds a socket. Right-click Wirt's Leg to open the Secret Cow Level, if you dare.
- Your items and stash are kept between games, even if you close the game in the middle of one. They are in `%APPDATA%\D2 Tower Defense\profile.json`; copy that file to keep a backup.

## Playing together

One person hosts and everyone else joins. Everyone needs the same version of this game and the same version of Diablo II: Resurrected.

**To host:** click **Multiplayer** in the main menu, then **Host Game**. The first time, Windows may ask whether to let D2 Tower Defense through the firewall. Click **Allow**, otherwise friends cannot reach you. The lobby shows one or more codes; send your friends the right one:

- **Internet**: for friends anywhere. It only appears when your router agreed to let the game in.
- **Same network**: for people in your home, on the same Wi-Fi or router.
- **Tailscale**: for friends who are on your Tailscale network.

If there is no Internet code, a friend elsewhere can still join if you forward TCP port **47310** to your PC in your router's settings, or if you both use Tailscale (free for small groups). Pick **Team** or **Free for all**, wait for everyone to show up in the list, then click **Start**.

**To join:** click **Multiplayer**, then **Join Game**, type or paste the code, and press **Join**. Then wait for the host to start.

In a game, waves start on a timer; any player can press **Send Wave** to bring the next one early. Everyone brings their own items. To trade, open the inventory and click **Trade** with a player's name; put items and gold on your side and click the tick to accept. The number keys show another player's area; press your own number to go back. **Esc** opens a menu, but the game keeps going for everyone. If the host leaves, the game ends.

## If something goes wrong

The game keeps a log, a small text file that says what happened. If setup fails or the game misbehaves, send that file to whoever gave you the game.

To find it:

- On the setup screen, after an error, click **Open log folder**.
- Or in the main menu, click **Options**, then **Open log folder**.
- Or press the **Windows key** and **R** together, type `%APPDATA%\D2 Tower Defense\logs` and press **Enter**.

Send **main.log**. If there is also a **main.old.log**, send that too; it is the log from the time before.

## Removing it

Open Windows **Settings**, go to **Apps**, then **Installed apps**, find **D2 Tower Defense** and click **Uninstall**.

The copied game pictures, your items and your stash stay behind in `%APPDATA%\D2 Tower Defense`. Delete that folder too if you want them gone.
