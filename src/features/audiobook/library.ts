import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseEpub, type Book } from "../book/epub.ts";
import { BOOK_MD, parseMarkdown } from "../book/markdown.ts";
import {
  BOOKS_DIR,
  bookPaths,
  chapterName,
  translationFolder,
} from "./text.ts";
import { groupChapters } from "./tracks.ts";
import { VOICES, isVoiced, type Voice, type VoiceJob } from "./voice.ts";

/** At most this many books (found by name, or unfinished) are offered as buttons. */
export const MAX_FOUND = 5;

/** A track; `title` is its first chapter's title as written in the book, for the audio's title. */
export type Chapter = VoiceJob["chapters"][number] & { title: string };

/** A book with its folder under BOOKS_DIR, where all its files are. */
export type ShelfBook = Book & { folder: string };

/** Folders right under `root`, sorted; the PDF work folder `.incoming` is not a book. */
export async function folders(root = BOOKS_DIR): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/** Every book folder: the originals and the finished translations («X/translation» with its book.md). */
export async function shelf(root = BOOKS_DIR): Promise<string[]> {
  const result: string[] = [];
  for (const folder of await folders(root)) {
    result.push(folder);
    const translation = translationFolder(folder);
    const files: string[] = await readdir(path.join(root, translation)).catch(
      () => [],
    );
    if (files.includes(BOOK_MD)) result.push(translation);
  }
  return result;
}

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
    const book = await loadBook(folder).catch(() => undefined);
    if (!book) continue;
    const all = chapters(book);
    const done = Math.max(
      ...VOICES.map((voice) => voicedCount(book, voice, all)),
    );
    if (done < all.length) result.push({ folder, done, total: all.length });
    if (result.length === MAX_FOUND) break;
  }
  return result;
}

/** Latest change in a book folder: its EPUB, texts or any voice's audio. */
async function lastChange(folder: string): Promise<number> {
  const dir = path.join(BOOKS_DIR, folder);
  const voices = await readdir(path.join(dir, "audio")).catch(() => []);
  const dirs = [
    dir,
    path.join(dir, "text"),
    ...voices.map((v) => path.join(dir, "audio", v)),
  ];
  const times = await Promise.all(
    dirs.map((d) =>
      stat(d).then(
        (s) => s.mtimeMs,
        () => 0,
      ),
    ),
  );
  return Math.max(...times);
}

/** The book in `folder` (book.md, else its EPUB); undefined when it has neither. */
export async function loadBook(
  folder: string,
  root = BOOKS_DIR,
): Promise<ShelfBook | undefined> {
  const dir = path.join(root, folder);
  const files = await readdir(dir);
  // A PDF is read once into book.md; reading the PDF again would take a minute.
  if (files.includes(BOOK_MD))
    return {
      ...parseMarkdown(await readFile(path.join(dir, BOOK_MD), "utf8"), folder),
      folder,
    };
  const epub = files.find((f) => f.toLowerCase().endsWith(".epub"));
  return epub
    ? {
        ...(await parseEpub(await readFile(path.join(dir, epub)), epub)),
        folder,
      }
    : undefined;
}

export function voicedCount(
  book: ShelfBook,
  voice: Voice,
  all: Chapter[],
): number {
  const { audioDir } = bookPaths(book.folder, voice.name);
  return all.filter((c) => isVoiced(audioDir, c.name)).length;
}

/** The book's tracks: short chapters joined up to about 10 minutes of audio each (see groupChapters). */
export function chapters(book: Book): Chapter[] {
  return groupChapters(book.chapters).map((c, index) => ({
    index,
    name: chapterName(index + 1, c.title),
    text: c.text,
    title: c.title,
  }));
}
