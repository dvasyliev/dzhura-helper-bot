import type { Api } from "grammy";
import { HTML } from "../text/format.ts";

/** Sends `text` (HTML); a failed status message must not stop the book. */
export async function notify(
  api: Api,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    await api.sendMessage(chatId, text, HTML);
  } catch (error) {
    console.error("sendMessage failed:", error);
  }
}
