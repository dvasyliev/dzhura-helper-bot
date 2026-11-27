import { InputFile, type Api } from "grammy";
import {
  SUMMARY_DIR,
  summaryItems,
  syncSummaries,
} from "../../lib/library/summary.ts";
import { keyboard, textOptions } from "../../lib/library/topic/topic.ts";
import { notify } from "../../lib/telegram/notify.ts";
import { ownerId } from "../../lib/telegram/owner.ts";
import { bold, escape, problem } from "../../lib/text/format.ts";

/** What of a video is delivered: its card or one of its slots. */
export type Delivered = "about" | "summary" | "audio";

/** Delivers `what` of video `id` without waiting: a button's answer must not wait for the topic's sync. */
export function deliverLater(api: Api, id: string, what: Delivered[]): void {
  void (async () => {
    for (const part of what)
      await deliver(api, ownerId(), id, part, SUMMARY_DIR);
  })().catch((error: unknown) =>
    console.error(`Delivering summary ${id} failed:`, error),
  );
}

/**
 * With a library group: `Done → <link>` to the message of `what` in the Summary topic. Without one it comes here:
 * the card with its buttons, or the slot's file. Returns its link in the topic, if any; without `announce` the
 * caller says it is done.
 */
export async function deliver(
  api: Api,
  chatId: number,
  id: string,
  what: Delivered,
  root = SUMMARY_DIR,
  announce = true,
): Promise<string | undefined> {
  const key = `${id}/${what}`;
  const synced = await syncSummaries(api);
  if (synced) {
    const link = synced.link(key);
    if (link && announce)
      await notify(api, chatId, `✅ ${bold("Done")} → ${escape(link)}`);
    return link;
  }
  // A slot still a placeholder has nothing to send.
  const own = (await summaryItems(root)).filter(
    (i) => i.key === key && (what === "about" || i.kind !== "text"),
  );
  for (const item of own)
    if (item.kind === "text")
      await api
        .sendMessage(chatId, item.text, textOptions(item))
        .catch(console.error);
    else
      await (
        item.kind === "audio"
          ? api.sendAudio(chatId, new InputFile(item.file, item.name), {
              title: item.title,
              performer: item.performer,
              reply_markup: keyboard(item),
            })
          : api.sendDocument(chatId, new InputFile(item.file, item.name), {
              reply_markup: keyboard(item),
            })
      ).catch((error) =>
        notify(
          api,
          chatId,
          `⚠️ ${bold("Couldn't send the summary")}\n${problem(error)}`,
        ),
      );
}
