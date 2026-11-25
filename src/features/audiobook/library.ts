import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseEpub, type Book } from "../book/epub.ts";
import { BOOK_MD, parseMarkdown } from "../book/markdown.ts";
import { bookName, bookPaths, chapterName } from "./text.ts";
import { VOICES, isVoiced, type Voice, type VoiceJob } from "./voice.ts";

export const BOOKS_DIR = "data/audiobook";
/** At most this many books (found by name, or unfinished) are offered as buttons. */
export const MAX_FOUND = 5;

export type Chapter = VoiceJob["chapters"][number];

/** Up to MAX_FOUND book folders, most recently changed first, where no voice has every chapter. */
export async function unfinished(): Promise<
  { folder: string; done: number; total: number }[]
> {
  const folders = (
    await readdir(BOOKS_DIR, { withFileTypes: true }).catch(() => [])
  ).filter((f) => f.isDirectory());
  const changed = await Promise.all(
    folders.map(async (f) => ({
      folder: f.name,
      time: await lastChange(f.name),
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

export async function loadBook(folder: string): Promise<Book | undefined> {
  const dir = path.join(BOOKS_DIR, folder);
  const files = await readdir(dir);
  // A PDF is read once into book.md; reading the PDF again would take a minute.
  if (files.includes(BOOK_MD))
    return parseMarkdown(
      await readFile(path.join(dir, BOOK_MD), "utf8"),
      folder,
    );
  const epub = files.find((f) => f.toLowerCase().endsWith(".epub"));
  return epub
    ? parseEpub(await readFile(path.join(dir, epub)), epub)
    : undefined;
}

export function voicedCount(book: Book, voice: Voice, all: Chapter[]): number {
  const { audioDir } = bookPaths(bookName(book), voice.name);
  return all.filter((c) => isVoiced(audioDir, c.name)).length;
}

export function chapters(book: Book): Chapter[] {
  return book.chapters.map((c, index) => ({
    index,
    name: chapterName(index + 1, c.title),
    text: c.text,
  }));
}
