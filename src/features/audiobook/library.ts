import path from "node:path";
import { readdirOrEmpty, statOrUndefined } from "../../lib/fs/absent.ts";
import { chapters, type Chapter } from "../../lib/book/tracks.ts";
import { BOOKS_DIR, bookPaths } from "../../lib/shelf/names.ts";
import {
  MAX_FOUND,
  tryLoadBook,
  shelf,
  type ShelfBook,
} from "../../lib/shelf/shelf.ts";
import { VOICES, isVoiced, type Voice } from "../../lib/tts/voice.ts";

/** Up to MAX_FOUND book folders, most recently changed first, where no voice has every chapter. */
export async function unfinished(): Promise<
  { folder: string; done: number; total: number }[]
> {
  const changed = await Promise.all(
    (await shelf()).map(async (folder) => ({
      folder,
      time: await lastChange(folder),
    })),
  );
  const result = [];
  for (const { folder } of changed.sort((a, b) => b.time - a.time)) {
    const book = await tryLoadBook(folder);
    if (!book) continue;
    const all = chapters(book);
    const done = Math.max(
      ...(await Promise.all(
        VOICES.map((voice) => voicedCount(book, voice, all)),
      )),
    );
    if (done < all.length) result.push({ folder, done, total: all.length });
    if (result.length === MAX_FOUND) break;
  }
  return result;
}

/** Latest change in a book folder: its EPUB, texts or any voice's audio. */
async function lastChange(folder: string): Promise<number> {
  const dir = path.join(BOOKS_DIR, folder);
  const voices = await readdirOrEmpty(path.join(dir, "audio"));
  const dirs = [
    dir,
    path.join(dir, "text"),
    ...voices.map((v) => path.join(dir, "audio", v)),
  ];
  const times = await Promise.all(
    dirs.map((d) => statOrUndefined(d).then((s) => s?.mtimeMs ?? 0)),
  );
  return Math.max(...times);
}

export async function voicedCount(
  book: ShelfBook,
  voice: Voice,
  all: Chapter[],
): Promise<number> {
  const { audioDir } = bookPaths(book.folder, voice.name);
  const voiced = await Promise.all(all.map((c) => isVoiced(audioDir, c.name)));
  return voiced.filter(Boolean).length;
}
