import type { Api } from "grammy";
import { ownerId } from "../../lib/telegram/owner.ts";
import { escape, HTML } from "../../lib/text/format.ts";
import { statusText, type Status } from "../../lib/text/status.ts";

/**
 * The owner's chat line for a job: «⏳ Processing: Detailed Summary (UA) - Title», edited as the job goes on. A finished
 * part stays as «✅ Done: …» with the title linked to the result and what it spent under it, and the next part starts a
 * new line. The title is linked to the video's card in the library group until then.
 */
export async function status(api: Api, title?: string, card?: string) {
  const chatId = ownerId();
  let messageId: number | undefined;
  let name = title;
  const post = async (text: string) => {
    if (messageId === undefined)
      messageId = (await api.sendMessage(chatId, text, HTML)).message_id;
    else
      await api.editMessageText(chatId, messageId, text, HTML).catch(() => {}); // a missed status edit is shown by the next one
  };
  const line = (kind: Status, what: string, link = card) =>
    statusText(kind, what, name, link);
  return {
    title: (text: string) => {
      name = text;
    },
    /** A step of the job: what is made, and the icon of the step. */
    step: (what: string, detail?: string) =>
      post(`${line("processing", what)}${detail ? `\n${escape(detail)}` : ""}`),
    /** «✅ Done: …», what the part `spent` under it. */
    finish: async (what: string, link: string | undefined, spent: string) => {
      await post(`${line("done", what, link)}\n\n${spent}`);
      messageId = undefined;
    },
    /** Removes a line left over when the job failed. */
    done: async () => {
      if (messageId !== undefined)
        await api.deleteMessage(chatId, messageId).catch(() => {}); // a leftover status line is harmless
      messageId = undefined;
    },
  };
}

export type Line = Awaited<ReturnType<typeof status>>;
