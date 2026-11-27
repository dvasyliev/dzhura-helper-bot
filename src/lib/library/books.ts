import { readdir } from "node:fs/promises";
import {
  readdirOrEmpty,
  readFileOrUndefined,
  statOrUndefined,
} from "../fs/absent.ts";
import path from "node:path";
import type { Api } from "grammy";
import { folders, tryLoadBook } from "../shelf/shelf.ts";
import {
  BOOKS_DIR,
  bookName,
  originalFolder,
  safeFilename,
  translationFolder,
} from "../shelf/names.ts";
import { bookLanguage } from "../book/language.ts";
import {
  audioCaption,
  audioTitle,
  bookPartMessage,
} from "../book/audio-caption.ts";
import { bookParts, chapters } from "../book/tracks.ts";
import { bookCaption } from "../book/caption.ts";
import type { Book } from "../book/epub.ts";
import { readInfo } from "../book/info.ts";
import { coverThumbnail } from "./thumbnail.ts";
import { BOOK_MD, parseMarkdown, SOURCE_MD } from "../book/markdown.ts";
import { BOOK_EPUB } from "../book/pandoc.ts";
import { bold, escape } from "../text/format.ts";
import { withGroup } from "./group.ts";
import type { FileItem, Item } from "./reconcile.ts";
import { LIBRARY_FILE } from "./state.ts";
import {
  syncTopic,
  TOPIC_ICONS,
  type Synced,
  type SyncOptions,
} from "./topic/topic.ts";

/** Where the books and the library state live; tests point them at a temp dir. */
type Dirs = { books: string; state: string };

const DIRS: Dirs = { books: BOOKS_DIR, state: LIBRARY_FILE };

/** Telegram's limit for a topic name. */
const MAX_TOPIC_NAME = 128;

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

async function readBookMd(
  file: string,
  name: string,
): Promise<Book | undefined> {
  const text = await readFileOrUndefined(file);
  return text === undefined ? undefined : parseMarkdown(text, name);
}

/** The Ukrainian translation of the original `folder`, if it was finished. */
function ukBook(folder: string, dirs: Dirs): Promise<Book | undefined> {
  return readBookMd(
    path.join(dirs.books, translationFolder(folder), BOOK_MD),
    folder,
  );
}

/** The book of `folder`: its own book.md or EPUB, else the source its translation started from. */
async function sourceBook(
  folder: string,
  dirs: Dirs,
): Promise<Book | undefined> {
  const book = await tryLoadBook(folder, dirs.books);
  return (
    book ??
    readBookMd(
      path.join(dirs.books, translationFolder(folder), SOURCE_MD),
      folder,
    )
  );
}

async function fileItem(
  key: string,
  kind: FileItem["kind"],
  file: string,
  extra: Partial<FileItem> = {},
): Promise<FileItem | undefined> {
  const stats = await statOrUndefined(file);
  return stats
    ? { key, kind, file, size: stats.size, mtime: stats.mtimeMs, ...extra }
    : undefined;
}

/** A voiced book folder's voices: name and whole-chapter mp3s, voices sorted by name. */
async function voices(
  dir: string,
): Promise<{ name: string; dir: string; root: string; files: string[] }[]> {
  const audio = path.join(dir, "audio");
  return Promise.all(
    (await folders(audio)).map(async (name) => ({
      name,
      dir: path.join(audio, name),
      root: dir,
      files: chapterFiles(await readdir(path.join(audio, name))),
    })),
  );
}

/** Chapters with at least their first file: «001 X.mp3» or «001 X (1).mp3». */
function voicedChapters(files: string[]): number {
  return files.filter((f) => (chapterPart(f)?.part ?? 2) <= 1).length;
}

/** A voice's mp3s by track name: «001 X» → its files. */
function filesByTrack(files: string[]): Map<string, string[]> {
  const byTrack = new Map<string, string[]>();
  for (const file of files) {
    const name = chapterPart(file)!.chapter;
    byTrack.set(name, [...(byTrack.get(name) ?? []), file]);
  }
  return byTrack;
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
    path.join(dirs.books, translationFolder(folder), "book.epub"),
    { name: `${ukName}.epub` },
  );

  const dir = path.join(dirs.books, folder);
  const own = await readdirOrEmpty(dir);
  const originalFile = own.find(
    (f) => f !== BOOK_EPUB && /\.(epub|pdf)$/i.test(f),
  );
  const original =
    originalFile &&
    (await fileItem("original", "document", path.join(dir, originalFile)));
  const epub = await fileItem("epub", "document", path.join(dir, BOOK_EPUB), {
    name: `${safeFilename(bookName(book))}.epub`,
  });

  const voiced = [
    ...(await voices(dir)).map((v) => ({ ...v, book })),
    ...(uk && ukName
      ? (await voices(path.join(dirs.books, translationFolder(folder)))).map(
          (v) => ({
            ...v,
            book: uk,
          }),
        )
      : []),
  ];

  const lines = [
    ...voiced.map(
      (v) =>
        `🎧 ${escape(v.name)}: ${voicedChapters(v.files)} of ${chapters(v.book).length}`,
    ),
    ...(ukEpub ? ["🌐 Ukrainian translation"] : []),
  ];
  const info = await readInfo(folder, dirs.books);
  const caption = bookCaption({
    book,
    chapters: chapters(book).length,
    language: bookLanguage(book.chapters.map((c) => c.text).join("\n")),
    info,
    lines,
  });
  // The cover with the card as its caption; a book without a cover gets the same as text.
  const cover = info?.cover
    ? await fileItem("contents", "photo", info.cover, { caption, pin: true })
    : undefined;
  const thumbnail = info?.cover && (await coverThumbnail(info.cover));

  const items: Item[] = [
    cover ?? { key: "contents", kind: "text", text: caption, pin: true },
  ];
  if (original) items.push(original);
  if (epub) items.push(epub);
  if (ukEpub) items.push(ukEpub);
  for (const voice of voiced) {
    items.push({
      key: `voice:${voice.name}`,
      kind: "text",
      text: `🎧 ${bold(escape(voice.name))}`,
    });
    const files = filesByTrack(voice.files);
    const tracks = chapters(voice.book);
    const parts = bookParts(tracks);
    let shownPart: string | undefined;
    for (const [i, track] of tracks.entries()) {
      const own = files.get(track.name) ?? [];
      // One of the book's own parts gets a message before its first voiced audio.
      const part = parts[i];
      if (own.length && part && part !== shownPart) {
        shownPart = part;
        items.push({
          key: `bookpart:${voice.name}/${part}`,
          kind: "text",
          text: bookPartMessage(
            part,
            tracks.filter((_, j) => parts[j] === part),
          ),
        });
      }
      for (const file of own) {
        const item = await fileItem(
          `voice:${voice.name}/${file}`,
          "audio",
          path.join(voice.dir, file),
          {
            title: audioTitle(track, file),
            caption: audioCaption(track, file, own.length),
            ...(thumbnail ? { thumbnail } : {}),
          },
        );
        if (item) items.push(item);
      }
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

/** Syncs the topic of `folder`'s original (`folder` may be its translation); undefined = no group, send to the private chat. `probe`: see `syncTopic`. */
export async function syncBook(
  api: Api,
  folder: string,
  dirs: Dirs = DIRS,
  options: SyncOptions = {},
): Promise<Synced | undefined> {
  const original = originalFolder(folder);
  return withGroup(
    api,
    async (state) => {
      const book = await sourceBook(original, dirs);
      if (!book) return { changed: [], link: () => undefined };
      return syncTopic(
        api,
        state,
        original,
        { name: topicName(book), icon: TOPIC_ICONS.book },
        await bookItems(original, dirs),
        dirs.state,
        options,
      );
    },
    dirs.state,
  );
}

/** Every book topic key: the original book folders. */
export function bookFolders(dirs: Dirs = DIRS): Promise<string[]> {
  return folders(dirs.books);
}
