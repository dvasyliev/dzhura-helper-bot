import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Api } from "grammy";
import { BOOKS_DIR, chapters, loadBook } from "../audiobook/library.ts";
import {
  bookLanguage,
  bookName,
  safeFilename,
  type BookLanguage,
} from "../audiobook/text.ts";
import type { Book } from "../book/epub.ts";
import { BOOK_MD, parseMarkdown } from "../book/markdown.ts";
import { TRANSLATE_DIR } from "../translate/pipeline.ts";
import { withGroup } from "./group.ts";
import type { FileItem, Item } from "./reconcile.ts";
import { LIBRARY_FILE } from "./state.ts";
import { syncTopic, type Synced } from "./topic.ts";

/** Where the books, their translations and the library state live; tests point them at a temp dir. */
type Dirs = { books: string; translate: string; state: string };

const DIRS: Dirs = {
  books: BOOKS_DIR,
  translate: TRANSLATE_DIR,
  state: LIBRARY_FILE,
};

/** Telegram's limit for a topic name. */
const MAX_TOPIC_NAME = 128;

const LANGUAGES: Record<BookLanguage, string> = {
  uk: "Ukrainian",
  en: "English",
  ru: "Russian",
};

/** «001 X (2).mp3» → chapter «001 X», part 2; a whole-chapter file is part 0. */
function chapterPart(
  file: string,
): { chapter: string; part: number } | undefined {
  const match = file.match(/^(.*?)(?: \((\d+)\))?\.mp3$/);
  return match
    ? { chapter: match[1]!, part: Number(match[2] ?? 0) }
    : undefined;
}

/** Mp3 names of whole chapters in reading order: «001 X.mp3», or «001 X (1).mp3», «001 X (2).mp3»…; a chapter whose first file is missing is still being voiced and is left out; `.part` files are left out. */
export function chapterFiles(files: string[]): string[] {
  const parts = files.flatMap((file) => {
    const parsed = chapterPart(file);
    return parsed ? [{ file, ...parsed }] : [];
  });
  const whole = new Set(parts.filter((p) => p.part <= 1).map((p) => p.chapter));
  return parts
    .filter((p) => whole.has(p.chapter))
    .sort((a, b) =>
      a.chapter === b.chapter
        ? a.part - b.part
        : a.chapter < b.chapter
          ? -1
          : 1,
    )
    .map((p) => p.file);
}

async function folders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function readBookMd(
  file: string,
  name: string,
): Promise<Book | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined);
  return text === undefined ? undefined : parseMarkdown(text, name);
}

/** The Ukrainian translation of the original `folder`, if it was made. */
function ukBook(folder: string, dirs: Dirs): Promise<Book | undefined> {
  return readBookMd(path.join(dirs.translate, folder, "book.uk.md"), folder);
}

/** Ukrainian book folder in data/audiobook → its original's folder, from each data/translate/<original>/book.uk.md. */
export async function translations(
  dirs: Dirs = DIRS,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const original of await folders(dirs.translate)) {
    const uk = await ukBook(original, dirs);
    if (uk) result.set(safeFilename(bookName(uk)), original);
  }
  return result;
}

/** The book of `folder`: its audiobook folder's, else the book.md of its translate folder. */
async function sourceBook(
  folder: string,
  dirs: Dirs,
): Promise<Book | undefined> {
  const book = await loadBook(folder, dirs.books).catch(() => undefined);
  return book ?? readBookMd(path.join(dirs.translate, folder, BOOK_MD), folder);
}

async function fileItem(
  key: string,
  kind: FileItem["kind"],
  file: string,
  extra: Partial<FileItem> = {},
): Promise<FileItem | undefined> {
  const stats = await stat(file).catch(() => undefined);
  return stats
    ? { key, kind, file, size: stats.size, mtime: stats.mtimeMs, ...extra }
    : undefined;
}

/** A voiced book folder's voices: name and whole-chapter mp3s, voices sorted by name. */
async function voices(
  dir: string,
): Promise<{ name: string; dir: string; files: string[] }[]> {
  const audio = path.join(dir, "audio");
  return Promise.all(
    (await folders(audio)).map(async (name) => ({
      name,
      dir: path.join(audio, name),
      files: chapterFiles(await readdir(path.join(audio, name))),
    })),
  );
}

/** Chapters with at least their first file: «001 X.mp3» or «001 X (1).mp3». */
function voicedChapters(files: string[]): number {
  return files.filter((f) => (chapterPart(f)?.part ?? 2) <= 1).length;
}

/** Topic items for the original book `folder`, in the spec's order. */
export async function bookItems(
  folder: string,
  dirs: Dirs = DIRS,
): Promise<Item[]> {
  const book = await sourceBook(folder, dirs);
  if (!book) return [];
  const uk = await ukBook(folder, dirs);
  const ukName = uk && safeFilename(bookName(uk));
  const ukEpub = await fileItem(
    "uk-epub",
    "document",
    path.join(dirs.translate, folder, "book.uk.epub"),
    { name: `${ukName}.epub` },
  );

  const dir = path.join(dirs.books, folder);
  const own = await readdir(dir).catch(() => []);
  const originalFile = own.find((f) => /\.(epub|pdf)$/i.test(f));
  const original =
    originalFile &&
    (await fileItem("original", "document", path.join(dir, originalFile)));

  const voiced = [
    ...(await voices(dir)).map((v) => ({ ...v, book })),
    ...(uk && ukName
      ? (await voices(path.join(dirs.books, ukName))).map((v) => ({
          ...v,
          book: uk,
        }))
      : []),
  ];

  const language = bookLanguage(book.chapters.map((c) => c.text).join("\n"));
  const count = `${chapters(book).length} chapters`;
  const lines = [
    `📕 ${book.title}`,
    ...(book.author ? [book.author] : []),
    language ? `${LANGUAGES[language]} · ${count}` : count,
    ...voiced.map(
      (v) =>
        `🎧 ${v.name}: ${voicedChapters(v.files)} of ${chapters(v.book).length}`,
    ),
    ...(ukEpub ? ["🌐 Ukrainian translation"] : []),
  ];

  const items: Item[] = [
    { key: "contents", kind: "text", text: lines.join("\n"), pin: true },
  ];
  if (original) items.push(original);
  if (ukEpub) items.push(ukEpub);
  for (const voice of voiced) {
    items.push({
      key: `voice:${voice.name}`,
      kind: "text",
      text: `🎧 ${voice.name}`,
    });
    for (const file of voice.files) {
      const item = await fileItem(
        `voice:${voice.name}/${file}`,
        "audio",
        path.join(voice.dir, file),
        { title: file.replace(/\.mp3$/, ""), performer: voice.book.title },
      );
      if (item) items.push(item);
    }
  }
  return items;
}

export function topicName(book: { title: string; author?: string }): string {
  const name = book.author ? `${book.author} — ${book.title}` : book.title;
  // Whole characters only: a cut through an emoji would leave half of it.
  let result = "";
  for (const { segment } of new Intl.Segmenter().segment(name)) {
    if (result.length + segment.length > MAX_TOPIC_NAME) break;
    result += segment;
  }
  return result;
}

/** Syncs the topic of `folder` (or of its original when it is a translation); undefined = no group, send to the private chat. `probe`: see `syncTopic`. */
export async function syncBook(
  api: Api,
  folder: string,
  dirs: Dirs = DIRS,
  options: { probe?: boolean } = {},
): Promise<Synced | undefined> {
  const original = (await translations(dirs)).get(folder) ?? folder;
  return withGroup(
    api,
    async (state) => {
      const book = await sourceBook(original, dirs);
      if (!book) return { changed: [], link: () => undefined };
      const items = await bookItems(original, dirs);
      return syncTopic(
        api,
        state,
        original,
        topicName(book),
        items,
        dirs.state,
        options,
      );
    },
    dirs.state,
  );
}

/** Every book topic key: audiobook folders that are not translations, plus translate folders with no audiobook folder. */
export async function bookFolders(dirs: Dirs = DIRS): Promise<string[]> {
  const books = await folders(dirs.books);
  const translated = await translations(dirs);
  return [
    ...books.filter((f) => !translated.has(f)),
    ...(await folders(dirs.translate)).filter((f) => !books.includes(f)),
  ];
}
