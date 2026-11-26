import {
  Composer,
  InlineKeyboard,
  InputFile,
  type Api,
  type Context,
} from "grammy";
import { copyFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { offer } from "../audiobook/index.ts";
import { message, notify } from "../audiobook/deliver.ts";
import { BOOKS_DIR, loadBook } from "../audiobook/library.ts";
import { bookDir, bookName, safeFilename } from "../audiobook/text.ts";
import type { Book } from "../book/epub.ts";
import { BOOK_MD, parseMarkdown } from "../book/markdown.ts";
import { syncBook } from "../library/books.ts";
import type { Feature } from "../types.ts";
import { findFolder, folderKey, translateButton } from "./button.ts";
import { splitChunks } from "./chunks.ts";
import { doneCount, unfinishedTranslations } from "./library.ts";
import { TRANSLATE_DIR, translateBook, type Progress } from "./pipeline.ts";

const MENU =
  "Send an EPUB or PDF book in English or Russian, then press «🌐 Translate to Ukrainian».";
const SEND_AGAIN = "This book is no longer here; send it again.";

/** Title of the book being translated; only one translation runs at a time. */
let running: string | undefined;

const composer = new Composer<Context>();

// Buttons carry `folderKey` of the book folder, so an old button never picks another book.
// From the voice offer or the Russian reply: the source is the audiobook folder's book.
composer.callbackQuery(/^translate:([0-9a-f]+)$/, async (ctx) =>
  begin(ctx, findFolder(ctx.match[1], await bookFolders()), loadBook),
);

// From the menu: the source is the book.md the translation folder already has.
composer.callbackQuery(/^continue:([0-9a-f]+)$/, async (ctx) =>
  begin(
    ctx,
    findFolder(ctx.match[1], await unfinishedTranslations()),
    async (folder) =>
      parseMarkdown(
        await readFile(path.join(TRANSLATE_DIR, folder, BOOK_MD), "utf8"),
        folder,
      ),
  ),
);

async function bookFolders(): Promise<string[]> {
  const entries = await readdir(BOOKS_DIR, { withFileTypes: true }).catch(
    () => [],
  );
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export const translate: Feature = {
  id: "translate",
  title: "🌐 Translate a book",
  open: openMenu,
  composer,
  actions: async (input) => {
    if (input.kind !== "book") return;
    if (input.language !== "en" && input.language !== "ru") return;
    const button = translateButton(input.folder);
    return { buttons: [{ text: button.text, data: button.callback_data }] };
  },
};

function busy(title: string): string {
  return `Please wait, «${title}» is being translated.`;
}

/** Starts translating the book of `folder` in the background, unless a translation already runs. */
async function begin(
  ctx: Context,
  folder: string | undefined,
  load: (folder: string) => Promise<Book | undefined>,
) {
  if (running) return ctx.answerCallbackQuery(busy(running));
  await ctx.answerCallbackQuery();
  const source = folder ? await load(folder).catch(() => undefined) : undefined;
  if (!folder || !source) return ctx.reply(SEND_AGAIN);
  if (running) return ctx.reply(busy(running));
  running = source.title;
  const chatId = ctx.chat!.id;
  void run(ctx, chatId, folder, source)
    .catch((error) =>
      notify(
        ctx.api,
        chatId,
        `Translation stopped: ${message(error)}. Continue from the menu.`,
      ),
    )
    .finally(() => (running = undefined));
}

function progressText(title: string, { done, total }: Progress): string {
  return `Translating «${title}»: ${done} of ${total} parts.`;
}

/** «14:05» in the Mac's time zone. */
function clock(time: Date): string {
  return time.toTimeString().slice(0, 5);
}

/** Translates with one status message edited as parts finish; then the EPUB, the report and the voice buttons. */
async function run(ctx: Context, chatId: number, folder: string, source: Book) {
  const dir = path.join(TRANSLATE_DIR, folder);
  const total = splitChunks(source).length;
  let shown = progressText(source.title, { done: await doneCount(dir), total });
  const status = await ctx.api.sendMessage(chatId, shown);
  const { book, epub, report } = await translateBook(source, {
    dir,
    onProgress: async (progress) => {
      const text = progressText(source.title, progress);
      if (text === shown) return; // Telegram refuses an edit that changes nothing
      shown = text;
      await ctx.api
        .editMessageText(chatId, status.message_id, text)
        .catch(() => {});
    },
    onLimit: (resetAt) =>
      notify(
        ctx.api,
        chatId,
        `Hit the Claude usage limit; continuing at ${clock(resetAt)}.`,
      ),
  });
  const name = bookName(book);
  if (!epub)
    await notify(
      ctx.api,
      chatId,
      "The EPUB needs pandoc (brew install pandoc); the book is added to the library anyway.",
    );
  else await sendEpub(ctx.api, chatId, folder, epub, safeFilename(name));
  await notify(ctx.api, chatId, reportText(report));
  const library = bookDir(name);
  await mkdir(library, { recursive: true });
  await copyFile(path.join(dir, "book.uk.md"), path.join(library, BOOK_MD));
  await offer(ctx, book, "uk");
}

/** With a library group: `Done → <link>` to the EPUB's message (nothing when there is none); without one the EPUB itself. */
export async function sendEpub(
  api: Api,
  chatId: number,
  folder: string,
  epub: string,
  name: string,
): Promise<void> {
  const synced = await syncBook(api, folder);
  if (synced) {
    const first = synced.changed[0];
    const link = synced.link("uk-epub") ?? (first && synced.link(first));
    if (link) await notify(api, chatId, `Done → ${link}`);
    return;
  }
  await api
    .sendDocument(chatId, new InputFile(epub, `${name}.epub`))
    .catch((error) =>
      notify(
        api,
        chatId,
        `Couldn't send the EPUB (it is ${epub}): ${message(error)}`,
      ),
    );
}

/** The finish message: fixed parts, parts with problems left, and parts the checker failed on. */
export function reportText(report: {
  fixed: number;
  problems: number;
  unchecked: number;
}): string {
  const text = `Fixed ${report.fixed} parts; ${report.problems} still have problems (see report.json).`;
  if (!report.unchecked) return text;
  return `${text} ${report.unchecked} parts were not checked: the checker failed (see report.json). Translate the book again to check them; no part is translated twice.`;
}

/** The menu button: what to send, and the translations not finished yet. */
async function openMenu(ctx: Context) {
  const listed = await unfinishedTranslations();
  if (!listed.length) return ctx.reply(MENU);
  const keyboard = InlineKeyboard.from(
    listed.map((folder) => [
      InlineKeyboard.text(folder, `continue:${folderKey(folder)}`),
    ]),
  );
  await ctx.reply(`${MENU}\n\nNot finished:`, { reply_markup: keyboard });
}
