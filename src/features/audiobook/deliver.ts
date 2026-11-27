import { InputFile, type Api } from "grammy";
import path from "node:path";
import type { Book } from "../../lib/book/epub.ts";
import { syncBook } from "../../lib/library/books.ts";
import type { Synced } from "../../lib/library/topic/topic.ts";
import { type ShelfBook } from "../../lib/shelf/shelf.ts";
import { leftByPace, leftText } from "../../lib/text/eta.ts";
import { HTML, bold, code, escape, problem } from "../../lib/text/format.ts";
import {
  audioCaption,
  audioTitle,
  bookPartMessage,
} from "../../lib/book/audio-caption.ts";
import {
  bookParts,
  chapters as bookChapters,
  type Chapter,
} from "../../lib/book/tracks.ts";
import { bookPaths } from "../../lib/shelf/names.ts";
import { voicingMinutes } from "./text.ts";
import { voiceChapters, type Voice } from "../../lib/tts/voice.ts";
import { notify } from "../../lib/telegram/notify.ts";

/**
 * Voices `todo` in reading order; each chapter goes out once it is voiced, so listening can start. With a library group "going out" syncs the
 * book's topic and the owner gets `Done → <link>` once; without one the files are sent here. A failed chapter stops
 * the book. With `progress` (chapters done before and in all) one status message counts the chapters as they finish.
 */
export async function voiceBook(
  api: Api,
  chatId: number,
  book: ShelfBook,
  voice: Voice,
  todo: Chapter[],
  mode: "new" | "regen",
  progress?: { done: number; total: number },
) {
  const { folder } = book;
  const paths = bookPaths(folder, voice.name);
  const job = {
    voice,
    ...paths,
    report:
      mode === "new" && voice.language === "uk" ? paths.report : undefined,
    chapters: todo,
  };
  /** Voiced and not sent yet. */
  const waiting: { chapter: Chapter; files: string[] }[] = [];
  /** The book's own part of each track, by its index. */
  const tracks = bookChapters(book);
  const parts = bookParts(tracks);
  /** The part whose message the private chat showed last. */
  let shownPart: string | undefined;
  let linked = false;
  const status =
    progress &&
    (await statusMessage(api, chatId, book, voice, todo, mode, progress));
  const send = async () => {
    const batch = waiting.splice(0);
    if (!batch.length) return;
    const synced = await syncBook(api, folder);
    if (!synced)
      for (const { chapter, files } of batch) {
        const part = parts[chapter.index];
        if (part && part !== shownPart) {
          shownPart = part;
          await notify(
            api,
            chatId,
            bookPartMessage(
              part,
              tracks.filter((_, i) => parts[i] === part),
            ),
          );
        }
        for (const file of files)
          await sendAudio(api, chatId, chapter, file, {
            files: files.length,
            audioDir: paths.audioDir,
          });
      }
    else if (!linked) linked = await sendDone(api, chatId, synced);
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
      await status?.next(chapter.text.length);
      waiting.push({ chapter, files: event.files ?? [] });
      // A failed send does not stop the voicing: the next one syncs what this one missed, the last one says why.
      await send().catch((error: unknown) =>
        console.error("Sending a voiced chapter:", error),
      );
    }
  } catch (error) {
    // The chapter's error is the one to report; a failed send after it must not replace it.
    await send().catch((sendError) =>
      console.error("Sending the chapters before a failed one:", sendError),
    );
    throw error;
  }
  await send();
}

/**
 * The «🎧 Voicing «Book» / 3 of 25 chapters · ≈40 min left» message; `next` counts one more chapter of `chars`
 * characters. The time left is by the measured speed until a chapter is done, then by the pace of this run.
 * Undefined when the message can't be sent.
 */
async function statusMessage(
  api: Api,
  chatId: number,
  book: Book,
  voice: Voice,
  todo: Chapter[],
  mode: "new" | "regen",
  { done, total }: { done: number; total: number },
) {
  const verb = mode === "new" ? "Voicing" : "Re-voicing";
  const started = Date.now();
  let charsDone = 0;
  let charsLeft = todo.reduce((sum, c) => sum + c.text.length, 0);
  const text = () => {
    const minutes =
      leftByPace(Date.now() - started, charsDone, charsLeft) ??
      voicingMinutes(charsLeft, voice.provider);
    const left = charsLeft ? ` · ${leftText(minutes)}` : "";
    return `🎧 ${bold(`${verb} «${escape(book.title)}»`)}\n${done} of ${total} chapters${left}`;
  };
  const sent = await api.sendMessage(chatId, text(), HTML).catch((error) => {
    console.error("sendMessage failed:", error);
    return undefined;
  });
  if (!sent) return undefined;
  return {
    next: async (chars: number) => {
      done++;
      charsDone += chars;
      charsLeft -= chars;
      await api
        .editMessageText(chatId, sent.message_id, text(), HTML)
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
  await notify(api, chatId, `✅ ${bold("Done")} → ${escape(link)}`);
  return true;
}

/** Sends a chapter's audio `file` here, titled «001. Chapter», with its caption (see audioCaption). */
async function sendAudio(
  api: Api,
  chatId: number,
  chapter: Chapter,
  file: string,
  { files, audioDir }: { files: number; audioDir: string },
): Promise<void> {
  const title = audioTitle(chapter, file);
  try {
    await api.sendAudio(
      chatId,
      new InputFile(file, `${path.basename(file, ".mp3")}.mp3`),
      {
        title,
        caption: audioCaption(chapter, file, files),
        ...HTML,
      },
    );
  } catch (error) {
    await notify(
      api,
      chatId,
      `⚠️ ${bold(`Couldn't send «${escape(title)}»`)}\nThe files are in ${code(escape(audioDir))}\n${problem(error)}`,
    );
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
      ...HTML,
      caption: `🎧 ${bold(`Words whose stress is worth checking: ${words}`)}\nNames, unknown words, homographs. Add the wrong ones to ${code(escape(dictionary))}: the next chapters will use it, and for finished ones run ${escape("/regen <number>")}.`,
    });
  } catch (error) {
    console.error("sendDocument failed:", error);
  }
}
