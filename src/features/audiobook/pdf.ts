import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { runPython } from "../../python.ts";
import type { Book } from "../book/epub.ts";
import { BOOK_MD, parseMarkdown } from "../book/markdown.ts";
import { BOOKS_DIR, bookDir, bookName, safeFilename } from "./text.ts";

/** A PDF is converted here first: its book folder is named after the title found inside it. */
const INCOMING_DIR = path.join(BOOKS_DIR, ".incoming");

/**
 * Turns a text PDF into book.md with src/features/book/scripts/pdf_convert.py and moves both into the book's
 * folder. Returns "scan" for a PDF without a text layer; nothing is kept then, nor when the script fails.
 */
export async function readPdf(
  data: Buffer,
  fileName: string,
  incoming = INCOMING_DIR,
): Promise<Book | "scan"> {
  await mkdir(incoming, { recursive: true });
  const work = await mkdtemp(path.join(incoming, "pdf-"));
  try {
    const pdfName = safeFilename(fileName);
    const pdf = path.join(work, pdfName);
    const out = path.join(work, BOOK_MD);
    await writeFile(pdf, data);
    let result: Record<string, unknown> = {};
    for await (const event of runPython(
      "src/features/book/scripts/pdf_convert.py",
      { pdf, out, file_name: fileName },
    ))
      result = event;
    if (result.error === "scan") return "scan";
    const book = parseMarkdown(await readFile(out, "utf8"), fileName);
    const dir = bookDir(bookName(book));
    await mkdir(dir, { recursive: true });
    await rename(pdf, path.join(dir, pdfName));
    await rename(out, path.join(dir, BOOK_MD));
    await placeSource(dir, [pdfName, BOOK_MD]);
    return book;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** The last book file sent wins: deletes every other EPUB, PDF and book.md in `dir`; text/ and audio/ stay. */
export async function placeSource(dir: string, keep: string[]): Promise<void> {
  for (const file of await readdir(dir)) {
    if (keep.includes(file)) continue;
    if (file === BOOK_MD || /\.(epub|pdf)$/i.test(file))
      await rm(path.join(dir, file));
  }
}
