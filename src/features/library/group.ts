import type { Api } from "grammy";
import { config } from "../../config.ts";
import { LIBRARY_FILE, loadState, serial, type LibraryState } from "./state.ts";
import type { Synced } from "./topic.ts";

/** Set once the owner was told the group is unavailable, so the note is sent once. */
let told = false;

/** Lets the next failure tell the owner again; called when a group is saved. */
export function resetUnavailable(): void {
  told = false;
}

/** True when a library group is set. */
export async function hasGroup(file = LIBRARY_FILE): Promise<boolean> {
  return (await loadState(file)).chatId !== undefined;
}

/**
 * Runs `work` on the library state, one sync at a time. Undefined means "send to the private chat": no group is
 * set, or the group failed (the owner is told once why).
 */
export function withGroup(
  api: Api,
  work: (state: LibraryState) => Promise<Synced>,
  file = LIBRARY_FILE,
): Promise<Synced | undefined> {
  return serial(async () => {
    const state = await loadState(file);
    if (state.chatId === undefined) return undefined;
    try {
      return await work(state);
    } catch (error) {
      if (!told) {
        told = true;
        await api
          .sendMessage(
            config.ownerId,
            `The library group is unavailable (${error instanceof Error ? error.message : String(error)}); sending here.`,
          )
          .catch((sendError) =>
            console.error("sendMessage failed:", sendError),
          );
      }
      return undefined;
    }
  });
}
