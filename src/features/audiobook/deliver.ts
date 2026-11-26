import { InputFile, type Api } from "grammy";
import path from "node:path";
import type { Book } from "../book/epub.ts";
import { syncBook } from "../library/books.ts";
import { hasGroup } from "../library/group.ts";
import type { Synced } from "../library/topic.ts";
import type { Chapter } from "./library.ts";
import { bookName, bookPaths, safeFilename } from "./text.ts";
import { voiceChapters, type Voice } from "./voice.ts";

/**
 * Voices `todo` in reading order. With a library group the book's topic is synced and the owner gets `Done → <link>`
 * (`"new"`: after every chapter, the link once; `"regen"`: once at the end, even after a failure); without one each
 * chapter's files are sent here as it finishes. A failed chapter stops the book. With `progress` (chapters done before
 * and in all) one status message counts the chapters as they finish.
 */
export async function voiceBook(
  api: Api,
  chatId: number,
  book: Book,
  voice: Voice,
  todo: Chapter[],
  mode: "new" | "regen",
  progress?: { done: number; total: number },
) {
  const name = bookName(book);
  const paths = bookPaths(name, voice.name);
  const folder = safeFilename(name);
  const job = {
    voice,
    ...paths,
    report:
      mode === "new" && voice.language === "uk" ? paths.report : undefined,
    chapters: todo,
  };
  const voiced: string[] = [];
  let linked = false;
  const status =
    progress && (await statusMessage(api, chatId, book, mode, progress));
  const syncAtEnd = mode === "regen" && (await hasGroup());
  // Also after a failed chapter: the chapters re-voiced before it still reach the group.
  const syncVoiced = async () => {
    const synced = await syncBook(api, folder);
    if (!synced) await sendAudio(api, chatId, book, voiced, paths.audioDir);
    else await sendDone(api, chatId, synced);
  };
  try {
    for await (const event of voiceChapters(job)) {
      if ("report" in event) {
        if (event.words)
          await sendReport(
            api,
            chatId,
            event.report,
            event.words,
            paths.dictionary,
          );
        continue;
      }
      const chapter = todo.find((c) => c.index === event.chapter)!;
      if (event.error)
        throw new Error(`chapter «${chapter.name}»: ${event.error}`);
      await status?.next();
      const files = event.files ?? [];
      if (syncAtEnd) {
        voiced.push(...files);
        continue;
      }
      const synced = mode === "new" ? await syncBook(api, folder) : undefined;
      if (!synced) await sendAudio(api, chatId, book, files, paths.audioDir);
      else if (!linked) linked = await sendDone(api, chatId, synced);
    }
  } catch (error) {
    // The chapter's error is the one to report; a failed sync after it must not replace it.
    if (syncAtEnd)
      await syncVoiced().catch((syncError) =>
        console.error("Library sync after a failed chapter:", syncError),
      );
    throw error;
  }
  if (syncAtEnd) await syncVoiced();
}

/** The «Voicing «Book»: 3 of 25 chapters.» message; `next` counts one more chapter. Undefined when it can't be sent. */
async function statusMessage(
  api: Api,
  chatId: number,
  book: Book,
  mode: "new" | "regen",
  { done, total }: { done: number; total: number },
) {
  const verb = mode === "new" ? "Voicing" : "Re-voicing";
  const text = () => `${verb} «${book.title}»: ${done} of ${total} chapters.`;
  const sent = await api.sendMessage(chatId, text()).catch((error) => {
    console.error("sendMessage failed:", error);
    return undefined;
  });
  if (!sent) return undefined;
  return {
    next: async () => {
      done++;
      await api
        .editMessageText(chatId, sent.message_id, text())
        .catch((error) => console.error("editMessageText failed:", error));
    },
  };
}

/** `Done → <link>` to the first changed audio message; false when no audio message changed. */
async function sendDone(
  api: Api,
  chatId: number,
  synced: Synced,
): Promise<boolean> {
  const key = synced.changed.find(
    (k) => k.startsWith("voice:") && k.includes("/"),
  );
  const link = key && synced.link(key);
  if (!link) return false;
  await notify(api, chatId, `Done → ${link}`);
  return true;
}

async function sendAudio(
  api: Api,
  chatId: number,
  book: Book,
  files: string[],
  audioDir: string,
): Promise<void> {
  for (const file of files) {
    const name = path.basename(file, ".mp3");
    try {
      await api.sendAudio(chatId, new InputFile(file, `${name}.mp3`), {
        title: name,
        performer: book.title,
      });
    } catch (error) {
      await notify(
        api,
        chatId,
        `Couldn't send «${name}» (the file is in ${audioDir}): ${message(error)}`,
      );
    }
  }
}

async function sendReport(
  api: Api,
  chatId: number,
  file: string,
  words: number,
  dictionary: string,
): Promise<void> {
  try {
    await api.sendDocument(chatId, new InputFile(file), {
      caption: `Words whose stress is worth checking: ${words} (names, unknown words, homographs). Add the wrong ones to ${dictionary}: the next chapters will use it, and for finished ones run /regen <number>.`,
    });
  } catch (error) {
    console.error("sendDocument failed:", error);
  }
}

/** A failed status message must not stop the book. */
export async function notify(
  api: Api,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    await api.sendMessage(chatId, text);
  } catch (error) {
    console.error("sendMessage failed:", error);
  }
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
