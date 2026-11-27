import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseEpub, type Book } from "../book/epub.ts";
import {
  isAbsent,
  readdirEntriesOrEmpty,
  readdirOrEmpty,
} from "../fs/absent.ts";
import { BOOK_MD, parseMarkdown } from "../book/markdown.ts";
import { BOOKS_DIR, translationFolder } from "./names.ts";

/** At most this many books (found by name, or unfinished) are offered as buttons. */
export const MAX_FOUND = 5;

/** A book with its folder under BOOKS_DIR, where all its files are. */
export type ShelfBook = Book & { folder: string };

/** Folders right under `root`, sorted; the PDF work folder `.incoming` is not a book. */
export async function folders(root = BOOKS_DIR): Promise<string[]> {
  const entries = await readdirEntriesOrEmpty(root);
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
    const files = await readdirOrEmpty(path.join(root, translation));
    if (files.includes(BOOK_MD)) result.push(translation);
  }
  return result;
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

/** `loadBook`, but a book that cannot be read is logged and undefined; a missing folder is quiet. */
export async function tryLoadBook(
  folder: string,
  root = BOOKS_DIR,
): Promise<ShelfBook | undefined> {
  try {
    return await loadBook(folder, root);
  } catch (error) {
    if (!isAbsent(error)) console.error(`Book ${folder} unreadable:`, error);
    return undefined;
  }
}
