import { InputFile, type Api } from "grammy";
import { notify } from "../telegram/notify.ts";
import { bold, code, escape, problem } from "../text/format.ts";
import { syncBook } from "./books.ts";

/** With a library group: `Done → <link>` to the topic item `key` (nothing when there is none); without one the EPUB itself. */
export async function sendEpub(
  api: Api,
  chatId: number,
  folder: string,
  epub: string,
  name: string,
  key: string,
): Promise<void> {
  const synced = await syncBook(api, folder);
  if (synced) {
    const first = synced.changed[0];
    const link = synced.link(key) ?? (first && synced.link(first));
    if (link) await notify(api, chatId, `✅ ${bold("Done")} → ${escape(link)}`);
    return;
  }
  await api
    .sendDocument(chatId, new InputFile(epub, `${name}.epub`))
    .catch((error) =>
      notify(
        api,
        chatId,
        `⚠️ ${bold("Couldn't send the EPUB")}\nIt is ${code(escape(epub))}\n${problem(error)}`,
      ),
    );
}
