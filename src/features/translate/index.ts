import {
  Composer,
  InlineKeyboard,
  InputFile,
  type Api,
  type Context,
} from "grammy";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { offer, SEND_AGAIN } from "../audiobook/index.ts";
import { notify } from "../audiobook/deliver.ts";
import { folders, loadBook } from "../audiobook/library.ts";
import {
  BOOKS_DIR,
  bookName,
  safeFilename,
  translationFolder,
} from "../audiobook/text.ts";
import { leftByPace, leftText } from "../../eta.ts";
import { bold, code, escape, HTML, problem, quote } from "../../format.ts";
import type { Book } from "../book/epub.ts";
import { readInfo } from "../book/info.ts";
import { parseMarkdown } from "../book/markdown.ts";
import { syncBook } from "../library/books.ts";
import type { Feature } from "../types.ts";
import { findFolder, folderKey, translateButton } from "./button.ts";
import type { Usage } from "./claude.ts";
import { splitChunks } from "./chunks.ts";
import { doneCount, unfinishedTranslations } from "./library.ts";
import {
  PARALLEL,
  SOURCE_MD,
  translateBook,
  translateMinutes,
  type Progress,
} from "./pipeline.ts";

const MENU = `🌐 ${bold("Translate a book")}\nSend an EPUB or PDF book in English or Russian, then press «🌐 Translate to Ukrainian».`;

/** Title of the book being translated; only one translation runs at a time. */
let running: string | undefined;

const composer = new Composer<Context>();

// Buttons carry `folderKey` of the book folder, so an old button never picks another book.
// From the voice offer or the Russian reply: the source is the audiobook folder's book.
composer.callbackQuery(/^translate:([0-9a-f]+)$/, async (ctx) =>
  begin(ctx, findFolder(ctx.match[1], await folders()), loadBook),
);

// From the menu: the source is the source.md the translation folder already has.
composer.callbackQuery(/^continue:([0-9a-f]+)$/, async (ctx) =>
  begin(
    ctx,
    findFolder(ctx.match[1], await unfinishedTranslations()),
    async (folder) =>
      parseMarkdown(
        await readFile(
          path.join(BOOKS_DIR, translationFolder(folder), SOURCE_MD),
          "utf8",
        ),
        folder,
      ),
  ),
);

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

function busyHtml(title: string): string {
  return `⏳ ${bold("Please wait")}\n«${escape(title)}» is being translated.`;
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
  if (!folder || !source) return ctx.reply(SEND_AGAIN, HTML);
  if (running) return ctx.reply(busyHtml(running), HTML);
  running = source.title;
  const chatId = ctx.chat!.id;
  void run(ctx, chatId, folder, source)
    .catch((error) =>
      notify(
        ctx.api,
        chatId,
        `⚠️ ${bold("Translation stopped")}\n${problem(error)}\n\nContinue from the menu.`,
      ),
    )
    .finally(() => (running = undefined));
}

/** «🌐 Translating «Book» / 3 of 80 parts · ≈12 min left» and, once Claude was called, its usage so far in a quote. */
export function progressText(
  title: string,
  { done, total, usage }: Progress,
  minutesLeft?: number,
): string {
  const left = minutesLeft === undefined ? "" : ` · ${leftText(minutesLeft)}`;
  const text = `🌐 ${bold(`Translating «${escape(title)}»`)}\n${done} of ${total} parts${left}`;
  return usage ? `${text}\n\n${quote(usageLines(usage))}` : text;
}

/** «14:05» in the Mac's time zone. */
function clock(time: Date): string {
  return time.toTimeString().slice(0, 5);
}

/** Translates with one status message edited as parts finish; then the EPUB, the report and the voice buttons. */
async function run(ctx: Context, chatId: number, folder: string, source: Book) {
  const dir = path.join(BOOKS_DIR, translationFolder(folder));
  const total = splitChunks(source).length;
  const done = await doneCount(dir);
  const started = Date.now();
  let shown = progressText(
    source.title,
    { done, total, ran: 0 },
    translateMinutes(total - done),
  );
  const status = await ctx.api.sendMessage(chatId, shown, HTML);
  const { book, epub, report, usage } = await translateBook(source, {
    dir,
    cover: (await readInfo(folder))?.cover,
    onProgress: async (progress) => {
      const rest = progress.total - progress.done;
      // The first PARALLEL chunks finish together; before that the pace says nothing yet.
      const pace =
        progress.ran >= PARALLEL
          ? leftByPace(Date.now() - started, progress.ran, rest)
          : undefined;
      const left = rest ? (pace ?? translateMinutes(rest)) : undefined;
      const text = progressText(source.title, progress, left);
      if (text === shown) return; // Telegram refuses an edit that changes nothing
      shown = text;
      await ctx.api
        .editMessageText(chatId, status.message_id, text, HTML)
        .catch(() => {});
    },
    onLimit: (resetAt) =>
      notify(
        ctx.api,
        chatId,
        `⏳ ${bold("Hit the Claude usage limit")}\nContinuing at ${clock(resetAt)}.`,
      ),
  });
  const name = bookName(book);
  if (!epub)
    await notify(
      ctx.api,
      chatId,
      `⚠️ ${bold("The EPUB needs pandoc")} (${code("brew install pandoc")})\nThe book is added to the library anyway.`,
    );
  else await sendEpub(ctx.api, chatId, folder, epub, safeFilename(name));
  console.log(`Translated «${source.title}». ${usageLines(usage).join(", ")}`);
  await notify(
    ctx.api,
    chatId,
    `${reportText(report)}\n\n${quote(usageLines(usage))}`,
  );
  const translated = await loadBook(translationFolder(folder));
  if (translated) await offer(ctx, translated, "uk");
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
    if (link) await notify(api, chatId, `✅ ${bold("Done")} → ${escape(link)}`);
    return;
  }
  await api
    .sendDocument(chatId, new InputFile(epub, `${name}.epub`))
    .catch((error) =>
      notify(
        api,
        chatId,
        `⚠️ ${bold("Couldn't send the EPUB")}\nIt is ${code(escape(epub))}\n${problem(error)}`,
      ),
    );
}

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Claude's usage for the book, one fact per line: calls, tokens it read (cache included) and wrote, the cost at API prices. */
export function usageLines(usage: Usage): string[] {
  const read = usage.input + usage.cacheWrite + usage.cacheRead;
  return [
    `Claude: ${usage.calls} calls`,
    `${compact.format(read)} tokens in · ${compact.format(usage.output)} out`,
    `≈$${usage.costUsd.toFixed(2)} at API prices`,
  ];
}

/** The finish message (HTML): fixed parts, parts with problems left, and parts the checker failed on. */
export function reportText(report: {
  fixed: number;
  problems: number;
  unchecked: number;
}): string {
  const text = `✅ ${bold("Translation finished")}\n\n${quote([
    `Fixed ${report.fixed} parts`,
    `${report.problems} still have problems (see report.json)`,
    ...(report.unchecked
      ? [
          `${report.unchecked} parts were not checked: the checker failed (see report.json)`,
        ]
      : []),
  ])}`;
  if (!report.unchecked) return text;
  return `${text}\n\nTranslate the book again to check them; no part is translated twice.`;
}

/** The menu button: what to send, and the translations not finished yet. */
async function openMenu(ctx: Context) {
  const listed = await unfinishedTranslations();
  if (!listed.length) return ctx.reply(MENU, HTML);
  const keyboard = InlineKeyboard.from(
    listed.map((folder) => [
      InlineKeyboard.text(folder, `continue:${folderKey(folder)}`),
    ]),
  );
  await ctx.reply(`${MENU}\n\nNot finished:`, {
    ...HTML,
    reply_markup: keyboard,
  });
}
