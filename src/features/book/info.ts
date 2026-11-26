import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadBook } from "../audiobook/library.ts";
import { BOOKS_DIR, originalFolder } from "../audiobook/text.ts";
import { runClaude } from "../translate/claude.ts";
import { epubCover } from "./cover.ts";
import type { Book } from "./epub.ts";
import { downloadCover, findBook } from "./openlibrary.ts";

/** What the card shows besides the title: the cover file, the year, the pages and a short description. */
export type BookInfo = {
  /** Path of the cover image. */
  cover?: string;
  year?: number;
  pages?: number;
  description?: string;
};

type Run = typeof runClaude;
type Options = { root?: string; run?: Run };

const INFO_FILE = "info.json";
const DESCRIPTION_PROMPT = fileURLToPath(
  new URL("description-prompt.md", import.meta.url),
);
/** Characters of a page, to estimate the pages of a book Open Library does not know. */
const PAGE_CHARS = 1800;
/** How much of the book's beginning Claude reads for the description. */
const SAMPLE_CHARS = 6000;
/** The card waits this long for the info; a slower one finishes in the background for next time. */
const WAIT_MS = 30_000;

const SAVED = z.object({
  cover: z.string().optional(),
  year: z.number().optional(),
  pages: z.number().optional(),
  description: z.string().optional(),
});
type Saved = z.infer<typeof SAVED>;

async function readSaved(dir: string): Promise<Saved | undefined> {
  const text = await readFile(path.join(dir, INFO_FILE), "utf8").catch(
    () => undefined,
  );
  if (text === undefined) return undefined;
  try {
    return SAVED.parse(JSON.parse(text));
  } catch {
    return undefined; // a damaged file is computed again
  }
}

function withCover(saved: Saved, dir: string): BookInfo {
  const { cover, ...rest } = saved;
  return { ...rest, ...(cover ? { cover: path.join(dir, cover) } : {}) };
}

/**
 * The info saved for the book of `folder`, or undefined when none was computed yet. A translation shows its
 * original's cover, year and pages with its own description.
 */
export async function readInfo(
  folder: string,
  root = BOOKS_DIR,
): Promise<BookInfo | undefined> {
  const dir = path.join(root, folder);
  const own = await readSaved(dir);
  const original = originalFolder(folder);
  if (original === folder) return own && withCover(own, dir);
  const base = await readSaved(path.join(root, original));
  if (!own && !base) return undefined;
  return {
    ...(base ? withCover(base, path.join(root, original)) : {}),
    description: own?.description,
  };
}

/** Runs `part`; a failure is logged and leaves that part out. */
async function attempt<T>(
  name: string,
  part: () => Promise<T | undefined>,
): Promise<T | undefined> {
  try {
    return await part();
  } catch (error) {
    console.error(
      `Book info: ${name} failed:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

async function describe(book: Book, run: Run): Promise<string | undefined> {
  const text = book.chapters
    .map((c) => c.text)
    .join("\n\n")
    .slice(0, SAMPLE_CHARS);
  const input = `Title: ${book.title}\nAuthor: ${book.author ?? "unknown"}\n\n${text}`;
  return (await run(DESCRIPTION_PROMPT, input)).trim() || undefined;
}

/** Writes the cover next to info.json; returns its file name. */
async function saveCover(
  dir: string,
  data: Buffer,
  ext: string,
): Promise<string> {
  const name = `cover.${ext}`;
  await writeFile(path.join(dir, name), data);
  return name;
}

/** An original's info: the EPUB's own cover (else Open Library's), year, pages and Claude's description. */
async function originalInfo(
  folder: string,
  book: Book,
  { root = BOOKS_DIR, run = runClaude }: Options,
): Promise<Saved> {
  const dir = path.join(root, folder);
  const found = await attempt("Open Library", () =>
    findBook(book.title, book.author),
  );
  const cover = async () => {
    const epub = (await readdir(dir)).find((f) => /\.epub$/i.test(f));
    const own = epub && (await epubCover(await readFile(path.join(dir, epub))));
    if (own) return saveCover(dir, own.data, own.ext);
    return found?.coverId === undefined
      ? undefined
      : saveCover(dir, await downloadCover(found.coverId), "jpg");
  };
  const [coverName, description] = await Promise.all([
    attempt("cover", cover),
    attempt("description", () => describe(book, run)),
  ]);
  const chars = book.chapters.reduce((sum, c) => sum + c.text.length, 0);
  const saved: Saved = {
    cover: coverName,
    year: found?.year,
    pages: found?.pages ?? Math.max(1, Math.round(chars / PAGE_CHARS)),
    description,
  };
  await writeFile(path.join(dir, INFO_FILE), JSON.stringify(saved, null, 2));
  return saved;
}

async function compute(
  folder: string,
  book: Book,
  options: Options,
): Promise<void> {
  const root = options.root ?? BOOKS_DIR;
  const original = originalFolder(folder);
  if (!(await readSaved(path.join(root, original)))) {
    const source =
      original === folder
        ? book
        : await loadBook(original, root).catch(() => undefined);
    if (source) await originalInfo(original, source, options);
  }
  if (original === folder) return;
  const description = await attempt("description", () =>
    describe(book, options.run ?? runClaude),
  );
  await writeFile(
    path.join(root, folder, INFO_FILE),
    JSON.stringify({ description }, null, 2),
  );
}

/** Computations under way, so a second request for the same book waits for the first instead of calling Claude again. */
const running = new Map<string, Promise<void>>();

/**
 * The info of `book` in `folder`: read from info.json, or computed once and saved there (Open Library and Claude
 * can take a while, so after `waitMs` this returns what is saved so far and the computation goes on in the
 * background). Parts that failed are left out; this never throws.
 */
export async function bookInfo(
  folder: string,
  book: Book,
  options: Options & { waitMs?: number } = {},
): Promise<BookInfo> {
  const root = options.root ?? BOOKS_DIR;
  const key = path.join(root, folder);
  if (await saved(folder, root)) return (await readInfo(folder, root)) ?? {};
  const job =
    running.get(key) ??
    compute(folder, book, options)
      .catch((error: unknown) => console.error("Book info failed:", error))
      .finally(() => running.delete(key));
  running.set(key, job);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, options.waitMs ?? WAIT_MS);
  });
  await Promise.race([job, late]);
  clearTimeout(timer);
  return (await readInfo(folder, root)) ?? {};
}

/** Whether the info of `folder` was computed before: its own info.json (for a translation, and its original's). */
async function saved(folder: string, root: string): Promise<boolean> {
  const original = originalFolder(folder);
  return Boolean(
    (await readSaved(path.join(root, folder))) &&
    (original === folder || (await readSaved(path.join(root, original)))),
  );
}
