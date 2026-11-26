import { Composer, InlineKeyboard, type Context } from "grammy";
import { bold, code, escape, HTML, problem, quote } from "../../format.ts";
import { busyHtml, busyWith, startJob } from "../../jobs.ts";
import { pressedBook } from "../../search.ts";
import { findFolder, folderKey } from "../translate/button.ts";
import type { Feature } from "../types.ts";
import { notify, voiceBook } from "./deliver.ts";
import type { Book } from "../book/epub.ts";
import {
  chapters,
  loadBook,
  shelf,
  unfinished,
  voicedCount,
  type Chapter,
  type ShelfBook,
} from "./library.ts";
import {
  bookName,
  bookPaths,
  bookLanguage,
  shelfLabel,
  forecast,
  parseNumbers,
  voicingTime,
  type BookLanguage,
  type Language,
} from "./text.ts";
import {
  VOICES,
  isVoiced,
  removeAudio,
  voicesFor,
  type Voice,
} from "./voice.ts";

/** Chapters voiced in one go unless the whole book is asked for. */
const BATCH = 5;
const TYPE_RANGE = "Or type chapter numbers, for example 10-20.";
const ONLY_LANGUAGES = `⚠️ ${bold("I voice only Ukrainian and English books")}`;
export const SEND_AGAIN = `⚠️ ${bold("This book is no longer here")}\nSend it again.`;

/** The last book sent, waiting for the voice to be chosen. */
let pending: ShelfBook | undefined;
/** Book and voice waiting for how many chapters to voice: a button or typed numbers («10-20»). */
let choosing: { book: ShelfBook; voice: Voice } | undefined;
/** The book being voiced or voiced last, for /regen. */
let current: { book: ShelfBook; voice: Voice } | undefined;
/** Book folders offered by the menu; buttons refer to them by index. */
let found: string[] = [];

const composer = new Composer<Context>();

// Voice chosen: a short rest is voiced at once, otherwise the owner picks how much.
composer.callbackQuery(/^voice:(.+)$/, async (ctx) => {
  const book = pending;
  const voice = VOICES.find((v) => v.id === ctx.match[1]);
  if (!book || !voice) return ctx.answerCallbackQuery("Send the book again.");
  const todo = remaining(book, voice);
  if (todo.length && todo.length <= BATCH) return start(ctx, book, voice, todo);
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  if (todo.length) {
    choosing = { book, voice };
    return ctx.reply(
      `❓ ${bold("How many chapters to voice?")}\n${TYPE_RANGE}`,
      { ...HTML, reply_markup: amountKeyboard(book, voice) },
    );
  }
  current = { book, voice };
  await ctx.reply(
    `✅ ${bold(`«${escape(book.title)}» is already voiced by «${escape(voice.name)}»`)}\nTo re-voice a chapter: /regen 5`,
    HTML,
  );
});

composer.callbackQuery(/^amount:(\d+|all)$/, async (ctx) => {
  if (!choosing) return ctx.answerCallbackQuery("Send the book again.");
  const { book, voice } = choosing;
  const todo = remaining(book, voice);
  await start(
    ctx,
    book,
    voice,
    ctx.match[1] === "all" ? todo : todo.slice(0, Number(ctx.match[1])),
  );
});

// Chapter numbers typed instead of pressing an amount button: «10-20», «3 5 7».
composer.hears(/^[\d\s,–-]+$/, async (ctx, next) => {
  if (!choosing) return next();
  const { book, voice } = choosing;
  const all = chapters(book);
  const numbers = parseNumbers(ctx.message!.text!);
  const asked = all.filter((c) => numbers.includes(c.index + 1));
  if (!asked.length)
    return ctx.reply(
      `⚠️ ${bold(`Chapters go from 1 to ${all.length}`)}\nFor example 10-20.`,
      HTML,
    );
  const left = new Set(remaining(book, voice).map((c) => c.index));
  const todo = asked.filter((c) => left.has(c.index));
  if (!todo.length)
    return ctx.reply(
      `✅ ${bold(`These chapters are already voiced by «${escape(voice.name)}»`)}\nTo re-voice: /regen ${escape(ctx.message!.text!)}`,
      HTML,
    );
  await start(ctx, book, voice, todo);
});

composer.command("regen", async (ctx) => {
  if (!current)
    return ctx.reply(
      `🎧 ${bold("Re-voice chapters")}\nRe-voices chapters of the book being voiced. First send a book and pick a voice, then /regen with chapter numbers: /regen 5 or /regen 5-7.`,
      HTML,
    );
  const { book, voice } = current;
  const all = chapters(book);
  const numbers = parseNumbers(ctx.match);
  const todo = all.filter((c) => numbers.includes(c.index + 1));
  if (!todo.length)
    return ctx.reply(
      `❓ ${bold(`Which chapters of «${escape(book.title)}» to re-voice with «${escape(voice.name)}»?`)}\nSend /regen with numbers from 1 to ${all.length}: /regen 5 or /regen 5-7.`,
      HTML,
    );
  const { audioDir } = bookPaths(book.folder, voice.name);
  const chatId = ctx.chat.id;
  const regen = async () => {
    await notify(
      ctx.api,
      chatId,
      `🎧 ${bold("Re-voicing")} ${todo.map((c) => `«${escape(c.name)}»`).join(", ")} with «${escape(voice.name)}»`,
    );
    for (const c of todo) await removeAudio(audioDir, c.name);
    await voiceBook(ctx.api, chatId, book, voice, todo, "regen", {
      done: 0,
      total: todo.length,
    });
    await notify(ctx.api, chatId, `✅ ${bold("Re-voiced")}`);
  };
  if (
    !startJob(`re-voicing «${book.title}»`, regen, (error) =>
      notify(
        ctx.api,
        chatId,
        `⚠️ ${bold("Re-voicing stopped")}\n${problem(error)}`,
      ),
    )
  )
    return ctx.reply(busyHtml(), HTML);
});

// A book from the «Not finished» list of the menu.
composer.callbackQuery(/^book:(.+)$/, (ctx) =>
  pressedBook(ctx, found[Number(ctx.match[1])], (book) => {
    const language = languageOf(book);
    if (language !== "uk" && language !== "en")
      return ctx.reply(ONLY_LANGUAGES, HTML);
    return offer(ctx, book, language);
  }),
);

export const audiobook: Feature = {
  id: "audiobook",
  title: "🎧 Create an audiobook",
  open: openMenu,
  commands: [
    {
      command: "regen",
      description: "🔁 Re-voice chapters",
    },
  ],
  composer,
  actions: async (input) => {
    if (input.kind !== "book") return;
    const { folder, language } = input;
    if (language !== "uk" && language !== "en") return;
    const book = { ...input.book, folder };
    return {
      buttons: [{ text: "🎧 Voice", data: `voice-book:${folderKey(folder)}` }],
      lines: voicedSoFar(book, chapters(book), voicesFor(language)),
      ask: (ctx) => offer(ctx, book, language),
    };
  },
};

// The card's «Voice» button: the voices for the book in the folder the button names.
composer.callbackQuery(/^voice-book:([0-9a-f]+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const folder = findFolder(ctx.match[1], await shelf());
  const book = folder
    ? await loadBook(folder).catch(() => undefined)
    : undefined;
  const language = book && languageOf(book);
  if (!book || (language !== "uk" && language !== "en"))
    return ctx.reply(SEND_AGAIN, HTML);
  await ctx.editMessageReplyMarkup().catch(() => {});
  await offer(ctx, book, language);
});

/** Voices `todo` in the background, then offers the rest of the book if any is left. */
async function start(
  ctx: Context,
  book: ShelfBook,
  voice: Voice,
  todo: Chapter[],
) {
  const chatId = ctx.chat!.id;
  const total = chapters(book).length;
  const range =
    todo.length > 1
      ? `from «${escape(todo[0].name)}» to «${escape(todo.at(-1)!.name)}»`
      : `«${escape(todo[0].name)}»`;
  const voiceTodo = async () => {
    // From the job, so it comes before the status message voiceBook sends.
    await notify(
      ctx.api,
      chatId,
      `🎧 ${bold(`Voicing with «${escape(voice.name)}»`)}\n${range}\n\n${quote(estimate(todo, voice))}`,
    );
    await voiceBook(ctx.api, chatId, book, voice, todo, "new", {
      done: total - remaining(book, voice).length,
      total,
    });
    const left = remaining(book, voice).length;
    if (!left)
      return notify(
        ctx.api,
        chatId,
        `✅ ${bold(`«${escape(book.title)}» is fully voiced`)}\nFiles: ${code(escape(bookPaths(book.folder, voice.name).audioDir))}`,
      );
    choosing = { book, voice };
    await ctx.api
      .sendMessage(
        chatId,
        `❓ ${bold("Voice more?")}\n\n${quote([`Done ${total - left} of ${total}`])}\n\n${TYPE_RANGE}`,
        { ...HTML, reply_markup: amountKeyboard(book, voice) },
      )
      .catch((error) => console.error("sendMessage failed:", error));
  };
  const stopped = (error: unknown) =>
    notify(
      ctx.api,
      chatId,
      `⚠️ ${bold("Voicing stopped")}\n${problem(error)}\n\nTo continue from here, send the book again or type its title.`,
    );
  if (!startJob(`voicing «${book.title}»`, voiceTodo, stopped)) {
    return ctx.callbackQuery
      ? ctx.answerCallbackQuery(`Please wait, ${busyWith()} is in progress.`)
      : ctx.reply(busyHtml(), HTML);
  }
  pending = undefined;
  choosing = undefined;
  current = { book, voice };
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
  }
}

/** «5 chapters · ≈3 min» and «The rest (66) · ≈1 h», for the chapters `voice` has not voiced yet. */
function amountKeyboard(book: ShelfBook, voice: Voice): InlineKeyboard {
  const todo = remaining(book, voice);
  const time = (list: Chapter[]) =>
    ` · ≈${voicingTime(
      list.reduce((sum, c) => sum + c.text.length, 0),
      voice.provider,
    )}`;
  const keyboard = new InlineKeyboard();
  if (todo.length > BATCH)
    keyboard.text(
      `${BATCH} chapters${time(todo.slice(0, BATCH))}`,
      `amount:${BATCH}`,
    );
  const rest =
    todo.length === chapters(book).length
      ? "The whole book"
      : `The rest (${todo.length})`;
  return keyboard.text(`${rest}${time(todo)}`, `amount:all`);
}

function remaining(book: ShelfBook, voice: Voice): Chapter[] {
  const { audioDir } = bookPaths(book.folder, voice.name);
  return chapters(book).filter((c) => !isVoiced(audioDir, c.name));
}

/** The menu button: what to send, and the most recently touched books that are not voiced to the end. */
async function openMenu(ctx: Context) {
  const text = `🎧 ${bold("Create an audiobook")}\nSend an EPUB or PDF book in Ukrainian or English and I'll voice it chapter by chapter. Or type the title or author of a book you sent before.`;
  const books = await unfinished();
  found = books.map((b) => b.folder);
  if (!books.length) return ctx.reply(text, HTML);
  const keyboard = InlineKeyboard.from(
    books.map((b, i) => [
      InlineKeyboard.text(
        `${shelfLabel(b.folder)} · ${b.done}/${b.total}`,
        `book:${i}`,
      ),
    ]),
  );
  await ctx.reply(`${text}\n\nNot finished:`, {
    ...HTML,
    reply_markup: keyboard,
  });
}

function languageOf(book: Book): BookLanguage | undefined {
  return bookLanguage(book.chapters.map((c) => c.text).join("\n"));
}

/** What is already voiced, the forecast and the buttons with the voices of the book's language; an English book can also be translated. */
export async function offer(ctx: Context, book: ShelfBook, language: Language) {
  pending = book;
  choosing = undefined;
  const all = chapters(book);
  const voices = voicesFor(language);
  const resume = voices.some((v) => {
    const left = remaining(book, v).length;
    return left && left < all.length;
  });
  const text = [
    `❓ ${bold("Which voice?")}\n${escape(bookName(book))}`,
    quote([
      `${all.length} chapters`,
      ...voicedSoFar(book, all, voices),
      ...estimate(all, voices[0]),
    ]),
    ...(resume ? ["Pick the same voice to continue where it stopped."] : []),
  ].join("\n\n");
  const keyboard = new InlineKeyboard();
  for (const voice of voices) keyboard.text(voice.name, `voice:${voice.id}`);
  await ctx.reply(text, { ...HTML, reply_markup: keyboard });
}

/** «Already voiced by «Oksana»: 12 of 71» (HTML) for each voice that has audio of this book. */
function voicedSoFar(
  book: ShelfBook,
  all: Chapter[],
  voices: Voice[],
): string[] {
  const done = voices
    .map((voice) => ({
      voice,
      count: voicedCount(book, voice, all),
    }))
    .filter((d) => d.count);
  return done.map(
    (d) =>
      `Already voiced by «${escape(d.voice.name)}»: ${d.count} of ${all.length}`,
  );
}

/** The forecast's lines, for a quote. */
function estimate(todo: Chapter[], voice: Voice): string[] {
  return forecast(
    todo.map((c) => c.text.length),
    voice.provider,
  ).split("\n");
}
