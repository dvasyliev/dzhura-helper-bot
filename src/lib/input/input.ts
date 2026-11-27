import type { Context } from "grammy";
import { mkdir, writeFile } from "node:fs/promises";
import { notify } from "../telegram/notify.ts";
import { placeSource, readPdf } from "../book/pdf.ts";
import { bookDir, bookName, safeFilename } from "../shelf/names.ts";
import { bookLanguage, type BookLanguage } from "../book/language.ts";
import { parseEpub, type Book } from "../book/epub.ts";
import { youtubeId } from "../video/link.ts";
import { bold, HTML, problem } from "../text/format.ts";
import { busyHtml, busyWith, startJob } from "../jobs/jobs.ts";

/** What the owner sent, recognised once; features offer their actions for it. */
export type Input =
  | { kind: "book"; book: Book; folder: string; language?: BookLanguage }
  | { kind: "youtube"; id: string }
  | { kind: "link"; url: string };

/** A YouTube video or any other link in `text`; plain text is not an input here. */
export function linkInput(text: string): Input | undefined {
  const id = youtubeId(text);
  if (id) return { kind: "youtube", id };
  const url = text.match(/https?:\/\/\S+/)?.[0];
  return url ? { kind: "link", url } : undefined;
}

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // Telegram Bot API getFile limit
const NO_CHAPTER = `⚠️ ${bold("Found no chapter with text in the book")}`;
const SCAN = `⚠️ ${bold("This PDF looks like a scan")}\nI can read only PDFs with a text layer for now.`;

/** Whether a sent file is a book the bot reads, by its name. */
export function isBookFile(name: string): "epub" | "pdf" | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".pdf")) return "pdf";
  return undefined;
}

/**
 * Reads a sent EPUB at once, or a PDF in the background (it takes a minute or two), saves it in its book
 * folder and hands it to `show`. False when the document is not a book file.
 */
export async function receiveBook(
  ctx: Context,
  show: (input: Input) => Promise<unknown>,
): Promise<boolean> {
  const doc = ctx.message?.document;
  const name = doc?.file_name ?? "";
  const type = isBookFile(name);
  if (!doc || !type) return false;
  if ((doc.file_size ?? 0) > MAX_DOWNLOAD_BYTES) {
    await ctx.reply(
      `⚠️ ${bold("The file is over 20 MB")}\nTelegram doesn't let bots download it.`,
      HTML,
    );
    return true;
  }
  if (type === "pdf" && busyWith()) {
    await ctx.reply(busyHtml(), HTML);
    return true;
  }
  try {
    const data = await download(ctx);
    if (type === "pdf") await startPdf(ctx, data, name, show);
    else {
      const book = await parseEpub(data, name);
      if (!book.chapters.length) await ctx.reply(NO_CHAPTER, HTML);
      else {
        const dir = bookDir(bookName(book));
        await mkdir(dir, { recursive: true });
        await writeFile(`${dir}/${safeFilename(name)}`, data);
        await placeSource(dir, [safeFilename(name)]);
        await show(bookInput(book));
      }
    }
  } catch (error) {
    await ctx.reply(`⚠️ ${bold("Error")}\n${problem(error)}`, HTML);
  }
  return true;
}

/** A book as an input; `folder` is its book folder, by default the one a sent book is saved to. */
export function bookInput(
  book: Book,
  folder = safeFilename(bookName(book)),
): Input {
  return {
    kind: "book",
    book,
    folder,
    language: bookLanguage(book.chapters.map((c) => c.text).join("\n")),
  };
}

async function download(ctx: Context): Promise<Buffer> {
  const file = await ctx.getFile();
  const res = await fetch(
    `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`,
    { signal: AbortSignal.timeout(5 * 60_000) },
  );
  if (!res.ok) throw new Error(`Couldn't download the file (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads the PDF into book.md in the background, then shows it. */
async function startPdf(
  ctx: Context,
  data: Buffer,
  name: string,
  show: (input: Input) => Promise<unknown>,
) {
  const chatId = ctx.chat!.id;
  const read = async () => {
    const book = await readPdf(data, name);
    if (book === "scan") return notify(ctx.api, chatId, SCAN);
    if (!book.chapters.length) return notify(ctx.api, chatId, NO_CHAPTER);
    await show(bookInput(book));
  };
  const stopped = (error: unknown) =>
    notify(
      ctx.api,
      chatId,
      `⚠️ ${bold("Reading the PDF stopped")}\n${problem(error)}`,
    );
  if (!startJob(`reading «${name}»`, read, stopped))
    return ctx.reply(busyHtml(), HTML);
  await ctx.reply(
    `⏳ ${bold("Reading the PDF")}\nThis takes a minute or two.`,
    HTML,
  );
}
