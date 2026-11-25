import { InputFile, type Api } from "grammy";
import path from "node:path";
import type { Book } from "./epub.ts";
import type { Chapter, Voice } from "./library.ts";
import { bookName, bookPaths } from "./text.ts";
import { voiceChapters } from "./voice.ts";

/** Voices `todo` and sends each chapter's files in reading order; a failed chapter stops the book. */
export async function voiceBook(
  api: Api,
  chatId: number,
  book: Book,
  voice: Voice,
  todo: Chapter[],
  withReport: boolean,
) {
  const paths = bookPaths(bookName(book), voice.name);
  const job = {
    voiceId: voice.id,
    ...paths,
    report: withReport ? paths.report : undefined,
    chapters: todo,
  };
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
      throw new Error(`розділ «${chapter.name}»: ${event.error}`);
    for (const file of event.files ?? []) {
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
          `Не вдалося надіслати «${name}» (файл є в ${paths.audioDir}): ${message(error)}`,
        );
      }
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
      caption: `Слів, де варто перевірити наголос: ${words} (імена, невідомі слова, омографи). Неправильні допишіть у ${dictionary} — наступні розділи вже їх врахують, а готові: /regen <номер>.`,
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
