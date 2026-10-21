// Where checkpoints live: the launcher's save files in the app, localStorage in a plain
// browser (npm run dev). A save that no longer parses or fits this version is no save.

import type { LauncherApi, SaveSlot } from '../launcher/api.ts';
import { CHECKPOINT_VERSION, type Checkpoint } from '../sim/checkpoint.ts';

const key = (slot: SaveSlot) => `d2td-checkpoint-${slot}`;

export async function loadCheckpoint(launcher: LauncherApi | undefined, slot: SaveSlot): Promise<Checkpoint | undefined> {
  try {
    const json = launcher ? await launcher.loadCheckpoint(slot) : localStorage.getItem(key(slot));
    const cp = json ? (JSON.parse(json) as Checkpoint) : undefined;
    return cp?.version === CHECKPOINT_VERSION ? cp : undefined;
  } catch {
    return undefined;
  }
}

export async function saveCheckpoint(launcher: LauncherApi | undefined, slot: SaveSlot, cp: Checkpoint): Promise<void> {
  const json = JSON.stringify(cp);
  try {
    if (launcher) await launcher.saveCheckpoint(slot, json);
    else localStorage.setItem(key(slot), json);
  } catch {
    // A save that cannot be written is not worth stopping the game for
  }
}

export async function clearCheckpoint(launcher: LauncherApi | undefined, slot: SaveSlot): Promise<void> {
  try {
    if (launcher) await launcher.clearCheckpoint(slot);
    else localStorage.removeItem(key(slot));
  } catch {
    // Nothing to clear
  }
}
