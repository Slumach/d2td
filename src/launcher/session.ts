// The renderer's end of multiplayer: one listener at a time for events from the main
// process (the lobby, then the game). Between the start message and the game scene being
// ready, events are held so no tick bundle is lost while sprites load.

import type { ClientMessage } from '../net/protocol.ts';
import type { JoinCode, LauncherApi, MpEvent } from './api.ts';

export class MpSession {
  private static instance: MpSession | undefined;
  private listener: ((e: MpEvent) => void) | undefined;
  private held: MpEvent[] | undefined;

  private constructor(private readonly api: LauncherApi) {
    api.onMp((e) => {
      if (this.held) this.held.push(e);
      else this.listener?.(e);
    });
  }

  static of(api: LauncherApi): MpSession {
    MpSession.instance ??= new MpSession(api);
    return MpSession.instance;
  }

  /** The one place events go from now on. Anything held while switching is delivered first. */
  listen(listener: (e: MpEvent) => void): void {
    this.listener = listener;
    const held = this.held ?? [];
    this.held = undefined;
    for (const e of held) listener(e);
  }

  /** Keeps events until the next listen(): the lobby calls this on start. */
  hold(): void {
    this.held ??= [];
    this.listener = undefined;
  }

  host(): Promise<{ ok: boolean; error?: string; codes: JoinCode[] }> {
    return this.api.mpHost();
  }

  join(code: string): Promise<{ ok: boolean; error?: string }> {
    return this.api.mpJoin(code);
  }

  send(message: ClientMessage): void {
    this.api.mpSend(message);
  }

  leave(): Promise<void> {
    this.listener = undefined;
    this.held = undefined;
    return this.api.mpLeave();
  }
}
