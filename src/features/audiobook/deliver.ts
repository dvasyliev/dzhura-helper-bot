import { InputFile, InputMediaBuilder, type Api } from "grammy";
import path from "node:path";
import type { Book } from "../book/epub.ts";
import { syncBook } from "../library/books.ts";
import { albumAt, type Synced } from "../library/topic.ts";
import {
  chapters as bookChapters,
  type Chapter,
  type ShelfBook,
} from "./library.ts";
import { leftByPace, leftText } from "../../eta.ts";
import { HTML, bold, code, escape, problem } from "../../format.ts";
import { partMessage, partsOf, audioTitle, type Part } from "./parts.ts";
import { bookPaths, voicingMinutes } from "./text.ts";
import { voiceChapters, type Voice } from "./voice.ts";

/**
 * Voices `todo` in reading order. The first chapter goes out at once, so listening can start; then each part (about an hour, one album) once all its
 * chapters of this run are voiced, and the rest at the end, also after a failure. With a library group "going out" syncs the
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
  const parts = partsOf(bookChapters(book));
  const partOf = (chapter: Chapter) =>
    parts.find((p) => p.tracks.some((t) => t.index === chapter.index))!;
  /** The last chapter of each part in this run: its part goes out after it. */
  const lastInPart = new Set(
    parts.flatMap((p) => {
      const last = p.tracks.filter((t) =>
        todo.some((c) => c.index === t.index),
      );
      return last.length ? [last.at(-1)!.index] : [];
    }),
  );
  /** Parts whose message is already in the private chat. */
  const announced = new Set<number>();
  let sentAny = false;
  let linked = false;
  const status =
    progress &&
    (await statusMessage(api, chatId, book, voice, todo, mode, progress));
  const send = async () => {
    const batch = waiting.splice(0);
    if (!batch.length) return;
    sentAny = true;
    const synced = await syncBook(api, folder);
    if (!synced)
      await sendParts(api, chatId, batch, partOf, announced, paths.audioDir);
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
      if (!sentAny || lastInPart.has(chapter.index)) await send();
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

/**
 * Sends the voiced chapters here, part by part: the part's message once (the first time one of its chapters goes
 * out), then its audio as albums of up to MAX_ALBUM, a lone file as plain audio. Titled «001. Chapter», no book name,
 * and without a caption.
 */
async function sendParts(
  api: Api,
  chatId: number,
  batch: { chapter: Chapter; files: string[] }[],
  partOf: (chapter: Chapter) => Part,
  announced: Set<number>,
  audioDir: string,
): Promise<void> {
  const groups = new Map<Part, typeof batch>();
  for (const item of batch) {
    const part = partOf(item.chapter);
    groups.set(part, [...(groups.get(part) ?? []), item]);
  }
  for (const [part, items] of groups) {
    if (!announced.has(part.number)) {
      announced.add(part.number);
      await notify(api, chatId, partMessage(part));
    }
    const audio = items.flatMap(({ chapter, files }) =>
      files.map((file) => ({ kind: "audio", file, chapter })),
    );
    await sendAudio(api, chatId, audio, audioDir);
  }
}

async function sendAudio(
  api: Api,
  chatId: number,
  audio: { kind: string; file: string; chapter: Chapter }[],
  audioDir: string,
): Promise<void> {
  for (let i = 0; i < audio.length;) {
    const album = albumAt(audio, i).map(({ file, chapter }) => {
      const title = audioTitle(chapter, file);
      return {
        title,
        input: new InputFile(file, `${path.basename(file, ".mp3")}.mp3`),
        extra: { title },
      };
    });
    i += album.length;
    try {
      if (album.length === 1)
        await api.sendAudio(chatId, album[0]!.input, album[0]!.extra);
      else
        await api.sendMediaGroup(
          chatId,
          album.map(({ input, extra }) =>
            InputMediaBuilder.audio(input, extra),
          ),
        );
    } catch (error) {
      const names = album.map((a) => `«${escape(a.title)}»`).join(", ");
      await notify(
        api,
        chatId,
        `⚠️ ${bold(`Couldn't send ${names}`)}\nThe files are in ${code(escape(audioDir))}\n${problem(error)}`,
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
      ...HTML,
      caption: `🎧 ${bold(`Words whose stress is worth checking: ${words}`)}\nNames, unknown words, homographs. Add the wrong ones to ${code(escape(dictionary))}: the next chapters will use it, and for finished ones run ${escape("/regen <number>")}.`,
    });
  } catch (error) {
    console.error("sendDocument failed:", error);
  }
}

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
