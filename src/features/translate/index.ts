import { Composer, InlineKeyboard, type Context } from "grammy";
import path from "node:path";
import { offer, SEND_AGAIN } from "../audiobook/index.ts";
import { readFileOrUndefined } from "../../lib/fs/absent.ts";
import { notify } from "../../lib/telegram/notify.ts";
import { folders, loadBook, tryLoadBook } from "../../lib/shelf/shelf.ts";
import {
  BOOKS_DIR,
  bookName,
  safeFilename,
  translationFolder,
} from "../../lib/shelf/names.ts";
import { reportAi, spentText } from "../../lib/claude/ai-usage.ts";
import { leftByPace, leftText } from "../../lib/text/eta.ts";
import { bold, code, escape, HTML, quote } from "../../lib/text/format.ts";
import {
  counter,
  failureText,
  statusText,
  withLanguage,
} from "../../lib/text/status.ts";
import type { Book } from "../../lib/book/epub.ts";
import { readInfo } from "../../lib/book/info.ts";
import { parseMarkdown } from "../../lib/book/markdown.ts";
import { sendEpub } from "../../lib/library/send.ts";
import type { Feature } from "../../lib/feature/types.ts";
import {
  findFolder,
  folderKey,
  translateButton,
} from "../../lib/book/folder-key.ts";
import { SOURCE_MD } from "../../lib/book/markdown.ts";
import type { Usage } from "../../lib/claude/claude.ts";
import { splitChunks } from "./chunks.ts";
import { doneCount, unfinishedTranslations } from "./library.ts";
import {
  PARALLEL,
  translateBook,
  translateMinutes,
  type Progress,
} from "./pipeline/pipeline.ts";

const MENU = `🌐 ${bold("Translate a book")}\nSend an EPUB or PDF book in English or Russian, then press «🌐 Translate to Ukrainian».`;

/** Title of the book being translated; only one translation runs at a time. */
let running: string | undefined;

const composer = new Composer<Context>();

// Buttons carry `folderKey` of the book folder, so an old button never picks another book.
// From the voice offer or the Russian reply: the source is the audiobook folder's book.
composer.callbackQuery(/^translate:([0-9a-f]+)$/, async (ctx) =>
  begin(ctx, findFolder(ctx.match[1], await folders()), tryLoadBook),
);

// From the menu: the source is the source.md the translation folder already has.
composer.callbackQuery(/^continue:([0-9a-f]+)$/, async (ctx) =>
  begin(
    ctx,
    findFolder(ctx.match[1], await unfinishedTranslations()),
    async (folder) => {
      const text = await readFileOrUndefined(
        path.join(BOOKS_DIR, translationFolder(folder), SOURCE_MD),
      );
      return text === undefined ? undefined : parseMarkdown(text, folder);
    },
  ),
);

export const translate: Feature = {
  id: "translate",
  title: "🌐 Translate a book",
  needs: ["claude", "pandoc"],
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
  const source = folder ? await load(folder) : undefined;
  if (!folder || !source) return ctx.reply(SEND_AGAIN, HTML);
  if (running) return ctx.reply(busyHtml(running), HTML);
  running = source.title;
  const chatId = ctx.chat!.id;
  void run(ctx, chatId, folder, source)
    .catch((error) =>
      notify(
        ctx.api,
        chatId,
        `${failureText(BOOK_TRANSLATION, error, source.title)}\n\nContinue from the menu.`,
      ),
    )
    .finally(() => (running = undefined));
}

/** What a translation is called in the statuses. */
const BOOK_TRANSLATION = withLanguage("Book Translation", "uk");

/** «⏳ Processing: Book Translation (UA) - Book / 3/80 parts · ≈12 min left» and, once Claude was called, its usage so far in a quote. */
export function progressText(
  title: string,
  { done, total, usage }: Progress,
  minutesLeft?: number,
): string {
  const left = minutesLeft === undefined ? "" : ` · ${leftText(minutesLeft)}`;
  const text = `${statusText("processing", BOOK_TRANSLATION, title)}\n${counter(done, total, "parts")}${left}`;
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
  const { book, epub, report, usage, model } = await translateBook(source, {
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
        .catch(() => {}); // a missed progress edit is shown by the next one
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
  else
    await sendEpub(
      ctx.api,
      chatId,
      folder,
      epub,
      safeFilename(name),
      "uk-epub",
      { what: BOOK_TRANSLATION, title: source.title },
    );
  console.log(`Translated «${source.title}». ${usageLines(usage).join(", ")}`);
  // The whole book's usage, resumed runs included; the time is this run's.
  const record = {
    what: `🌐 Translation · ${name}`,
    ...(model ? { model } : {}),
    ms: Date.now() - started,
    usage,
  };
  await notify(
    ctx.api,
    chatId,
    reportText(report, source.title, spentText(record)),
  );
  await reportAi(record, { message: false });
  const translated = await loadBook(translationFolder(folder));
  if (translated) await offer(ctx, translated, "uk");
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
    `💵 ≈$${usage.costUsd.toFixed(2)} at API prices`,
  ];
}

/** The finish message (HTML): fixed parts, parts with problems left, parts the checker failed on, then what it `spent`. */
export function reportText(
  report: { fixed: number; problems: number; unchecked: number },
  title?: string,
  spent?: string,
): string {
  const text = `${statusText("done", BOOK_TRANSLATION, title)}\n\n${quote([
    `Fixed ${report.fixed} parts`,
    `${report.problems} still have problems (see report.json)`,
    ...(report.unchecked
      ? [
          `${report.unchecked} parts were not checked: the checker failed (see report.json)`,
        ]
      : []),
  ])}`;
  const hint = report.unchecked
    ? "\n\nTranslate the book again to check them; no part is translated twice."
    : "";
  return `${text}${hint}${spent ? `\n\n${spent}` : ""}`;
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
