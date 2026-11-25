import { Composer, InlineKeyboard, InputFile, type Api, type Context } from "grammy";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.ts";
import { busyWith, startJob } from "../../jobs.ts";
import type { Feature } from "../types.ts";
import { parseEpub, type Book } from "./epub.ts";
import { bookDir, bookName, bookPaths, chapterName, findBooks, forecast, isUkrainian, parseNumbers, safeFilename, voicingTime } from "./text.ts";
import { DEFAULT_VOICES, VOICES, isVoiced, removeAudio, voiceChapters, type VoiceJob } from "./voice.ts";

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // Telegram Bot API getFile limit
const BOOKS_DIR = "data/audiobook";
/** Chapters voiced in one go unless the whole book is asked for. */
const BATCH = 5;
const TYPE_RANGE = "Або напишіть номери розділів, наприклад 10-20.";
/** At most this many books (found by name, or unfinished) are offered as buttons. */
const MAX_FOUND = 5;

type Voice = (typeof VOICES)[number];
type Chapter = VoiceJob["chapters"][number];

/** The last book sent, waiting for the voice to be chosen. */
let pending: Book | undefined;
/** Book and voice waiting for how many chapters to voice: a button or typed numbers («10-20»). */
let choosing: { book: Book; voice: Voice } | undefined;
/** The book being voiced or voiced last, for /regen. */
let current: { book: Book; voice: Voice } | undefined;
/** Book folders offered by the last search or menu; buttons refer to them by index. */
let found: string[] = [];

const composer = new Composer<Context>();

composer.on("message:document", async (ctx, next) => {
  const doc = ctx.message.document;
  if (!doc.file_name?.toLowerCase().endsWith(".epub")) return next();
  if ((doc.file_size ?? 0) > MAX_DOWNLOAD_BYTES)
    return ctx.reply("Файл більший за 20 МБ — Telegram не дає ботам його скачати.");

  try {
    const file = await ctx.getFile();
    const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
    if (!res.ok) throw new Error(`Не вдалося скачати файл (${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    const book = await parseEpub(data, doc.file_name);
    if (!book.chapters.length) return ctx.reply("Не знайшов у книжці жодного розділу з текстом.");
    if (!isUkrainian(book.chapters.map((c) => c.text).join("\n")))
      return ctx.reply("Ця книжка, схоже, не українською. Поки що я озвучую лише українські книжки.");
    const dir = bookDir(bookName(book));
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/${safeFilename(doc.file_name)}`, data);
    await offer(ctx, book);
  } catch (error) {
    await ctx.reply(`Помилка: ${message(error)}`);
  }
});

// Voice chosen: a short rest is voiced at once, otherwise the owner picks how much.
composer.callbackQuery(/^voice:(.+)$/, async (ctx) => {
  const book = pending;
  const voice = VOICES.find((v) => v.id === ctx.match[1]);
  if (!book || !voice) return ctx.answerCallbackQuery("Надішліть книжку ще раз.");
  const todo = remaining(book, voice);
  if (todo.length && todo.length <= BATCH) return start(ctx, book, voice, todo);
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  if (todo.length) {
    choosing = { book, voice };
    return ctx.reply(`Скільки розділів озвучити? ${TYPE_RANGE}`, { reply_markup: amountKeyboard(book, voice) });
  }
  current = { book, voice };
  await ctx.reply(`«${book.title}» вже озвучено голосом «${voice.name}». Переозвучити розділ: /regen 5`);
});

composer.callbackQuery(/^amount:(\d+|all)$/, async (ctx) => {
  if (!choosing) return ctx.answerCallbackQuery("Надішліть книжку ще раз.");
  const { book, voice } = choosing;
  const todo = remaining(book, voice);
  await start(ctx, book, voice, ctx.match[1] === "all" ? todo : todo.slice(0, Number(ctx.match[1])));
});

// Chapter numbers typed instead of pressing an amount button: «10-20», «3 5 7».
composer.hears(/^[\d\s,–-]+$/, async (ctx, next) => {
  if (!choosing) return next();
  const { book, voice } = choosing;
  const all = chapters(book);
  const numbers = parseNumbers(ctx.message!.text!);
  const asked = all.filter((c) => numbers.includes(c.index + 1));
  if (!asked.length) return ctx.reply(`Розділи — від 1 до ${all.length}, наприклад 10-20.`);
  const left = new Set(remaining(book, voice).map((c) => c.index));
  const todo = asked.filter((c) => left.has(c.index));
  if (!todo.length) return ctx.reply(`Ці розділи вже озвучено голосом «${voice.name}». Переозвучити: /regen ${ctx.message!.text}`);
  await start(ctx, book, voice, todo);
});

composer.command("regen", async (ctx) => {
  if (!current) return ctx.reply("Спочатку надішліть книжку й оберіть голос.");
  const { book, voice } = current;
  const all = chapters(book);
  const numbers = parseNumbers(ctx.match);
  const todo = all.filter((c) => numbers.includes(c.index + 1));
  if (!todo.length) return ctx.reply(`Вкажіть номери розділів від 1 до ${all.length}: /regen 5 або /regen 5-7`);
  const { audioDir } = bookPaths(bookName(book), voice.name);
  const chatId = ctx.chat.id;
  const regen = async () => {
    for (const c of todo) await removeAudio(audioDir, c.name);
    await voiceBook(ctx.api, chatId, book, voice, todo, false);
    await notify(ctx.api, chatId, "Переозвучено.");
  };
  if (!startJob(`переозвучка «${book.title}»`, regen, (error) => notify(ctx.api, chatId, `Переозвучку зупинено: ${message(error)}`)))
    return ctx.reply(`Зачекайте, зараз триває ${busyWith()}.`);
  await ctx.reply(`Переозвучую ${todo.map((c) => `«${c.name}»`).join(", ")} голосом «${voice.name}».`);
});

// A book sent before, found by a word of its author or title. Links and multi-line texts (song lyrics) are not titles.
composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text;
  if (text.startsWith("/") || text.includes("\n") || /https?:\/\/|youtu\.?be/.test(text)) return next();
  const folders = await readdir(BOOKS_DIR, { withFileTypes: true }).catch(() => []);
  found = findBooks(ctx.message.text, folders.filter((f) => f.isDirectory()).map((f) => f.name)).slice(0, MAX_FOUND);
  if (!found.length) return ctx.reply("Такої книжки ще немає. Надішліть EPUB, щоб її озвучити.");
  const keyboard = new InlineKeyboard();
  if (found.length === 1) {
    keyboard.text("Так", "book:0").text("Ні", "book:no");
    return ctx.reply(`«${found[0]}» — ця?`, { reply_markup: keyboard });
  }
  const list = InlineKeyboard.from(found.map((name, i) => [InlineKeyboard.text(name, `book:${i}`)]));
  await ctx.reply(`Яку саме? Якщо потрібної немає, уточніть назву.`, { reply_markup: list });
});

composer.callbackQuery(/^book:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  const folder = found[Number(ctx.match[1])];
  if (!folder) return ctx.reply("Добре. Напишіть назву чи автора інакше або надішліть EPUB.");
  try {
    const book = await loadBook(folder);
    if (!book) return ctx.reply(`У папці «${folder}» немає EPUB. Надішліть книжку ще раз.`);
    await offer(ctx, book);
  } catch (error) {
    await ctx.reply(`Помилка: ${message(error)}`);
  }
});

export const audiobook: Feature = {
  id: "audiobook",
  title: "🎧 Створити аудіокнигу",
  open: openMenu,
  commands: [{ command: "regen", description: "Переозвучити розділи останньої книжки: /regen 5 або /regen 5-7" }],
  composer,
};

/** Voices `todo` in the background, then offers the rest of the book if any is left. */
async function start(ctx: Context, book: Book, voice: Voice, todo: Chapter[]) {
  const chatId = ctx.chat!.id;
  const total = chapters(book).length;
  const voiceTodo = async () => {
    await voiceBook(ctx.api, chatId, book, voice, todo, true);
    const left = remaining(book, voice).length;
    if (!left) return notify(ctx.api, chatId, `Готово: «${book.title}» озвучено повністю. Файли: ${bookPaths(bookName(book), voice.name).audioDir}`);
    choosing = { book, voice };
    await ctx.api
      .sendMessage(chatId, `Готово ${total - left} з ${total}. Озвучити далі? ${TYPE_RANGE}`, { reply_markup: amountKeyboard(book, voice) })
      .catch((error) => console.error("sendMessage failed:", error));
  };
  const stopped = (error: unknown) =>
    notify(ctx.api, chatId, `Озвучку зупинено: ${message(error)}\nЩоб продовжити з цього місця, надішліть книжку ще раз або напишіть її назву.`);
  if (!startJob(`озвучка «${book.title}»`, voiceTodo, stopped)) {
    const busy = `Зачекайте, зараз триває ${busyWith()}.`;
    return ctx.callbackQuery ? ctx.answerCallbackQuery(busy) : ctx.reply(busy);
  }
  pending = undefined;
  choosing = undefined;
  current = { book, voice };
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
  }
  const range = todo.length > 1 ? `з «${todo[0].name}» по «${todo.at(-1)!.name}»` : `«${todo[0].name}»`;
  await ctx.reply(`Озвучую голосом «${voice.name}» ${range}.\n${estimate(todo)}`);
}

/** «5 розділів · ≈3 хв» and «Решту (66) · ≈1 год», for the chapters `voice` has not voiced yet. */
function amountKeyboard(book: Book, voice: Voice): InlineKeyboard {
  const todo = remaining(book, voice);
  const time = (list: Chapter[]) =>
    config.ttsProvider === "holos" ? ` · ≈${voicingTime(list.reduce((sum, c) => sum + c.text.length, 0))}` : "";
  const keyboard = new InlineKeyboard();
  if (todo.length > BATCH) keyboard.text(`${BATCH} розділів${time(todo.slice(0, BATCH))}`, `amount:${BATCH}`);
  const rest = todo.length === chapters(book).length ? "Усю книжку" : `Решту (${todo.length})`;
  return keyboard.text(`${rest}${time(todo)}`, `amount:all`);
}

function remaining(book: Book, voice: Voice): Chapter[] {
  const { audioDir } = bookPaths(bookName(book), voice.name);
  return chapters(book).filter((c) => !isVoiced(audioDir, c.name));
}

/** The menu button: what to send, and the most recently touched books that are not voiced to the end. */
async function openMenu(ctx: Context) {
  const text = "Надішліть EPUB-книжку українською, і я озвучу її по розділах. Або напишіть назву чи автора книжки, яку вже надсилали.";
  const books = await unfinished();
  found = books.map((b) => b.folder);
  if (!books.length) return ctx.reply(text);
  const keyboard = InlineKeyboard.from(books.map((b, i) => [InlineKeyboard.text(`${b.folder} · ${b.done}/${b.total}`, `book:${i}`)]));
  await ctx.reply(`${text}\n\nНе дозвучені:`, { reply_markup: keyboard });
}

/** Up to MAX_FOUND book folders, most recently changed first, where no voice has every chapter. */
async function unfinished(): Promise<{ folder: string; done: number; total: number }[]> {
  const folders = (await readdir(BOOKS_DIR, { withFileTypes: true }).catch(() => [])).filter((f) => f.isDirectory());
  const changed = await Promise.all(folders.map(async (f) => ({ folder: f.name, time: await lastChange(f.name) })));
  const result = [];
  for (const { folder } of changed.sort((a, b) => b.time - a.time)) {
    const book = await loadBook(folder).catch(() => undefined);
    if (!book) continue;
    const all = chapters(book);
    const done = Math.max(...VOICES.map((voice) => voicedCount(book, voice, all)));
    if (done < all.length) result.push({ folder, done, total: all.length });
    if (result.length === MAX_FOUND) break;
  }
  return result;
}

/** Latest change in a book folder: its EPUB, texts or any voice's audio. */
async function lastChange(folder: string): Promise<number> {
  const dir = path.join(BOOKS_DIR, folder);
  const voices = await readdir(path.join(dir, "audio")).catch(() => []);
  const dirs = [dir, path.join(dir, "text"), ...voices.map((v) => path.join(dir, "audio", v))];
  const times = await Promise.all(dirs.map((d) => stat(d).then((s) => s.mtimeMs, () => 0)));
  return Math.max(...times);
}

async function loadBook(folder: string): Promise<Book | undefined> {
  const dir = path.join(BOOKS_DIR, folder);
  const epub = (await readdir(dir)).find((f) => f.toLowerCase().endsWith(".epub"));
  return epub ? parseEpub(await readFile(path.join(dir, epub)), epub) : undefined;
}

function voicedCount(book: Book, voice: Voice, all: Chapter[]): number {
  const { audioDir } = bookPaths(bookName(book), voice.name);
  return all.filter((c) => isVoiced(audioDir, c.name)).length;
}

/** What is already voiced, the forecast and the voice buttons. */
async function offer(ctx: Context, book: Book) {
  pending = book;
  choosing = undefined;
  const all = chapters(book);
  const lines = [`${bookName(book)}: розділів ${all.length}.`, ...voicedSoFar(book, all), estimate(all), "Яким голосом озвучити?"];
  await ctx.reply(lines.join("\n"), { reply_markup: voiceKeyboard() });
}

function chapters(book: Book): Chapter[] {
  return book.chapters.map((c, index) => ({ index, name: chapterName(index + 1, c.title), text: c.text }));
}

/** «Уже озвучено голосом «Оксана»: 12 з 71.» for each voice that has audio of this book. */
function voicedSoFar(book: Book, all: Chapter[]): string[] {
  const done = VOICES.map((voice) => ({ voice, count: voicedCount(book, voice, all) })).filter((d) => d.count);
  const lines = done.map((d) => `Уже озвучено голосом «${d.voice.name}»: ${d.count} з ${all.length}.`);
  if (done.some((d) => d.count < all.length)) lines.push("Оберіть той самий голос, щоб продовжити з місця зупинки.");
  return lines;
}

function estimate(todo: Chapter[]): string {
  return forecast(
    todo.map((c) => c.text.length),
    config.ttsProvider === "holos",
  );
}

/** The owner's chosen female and male voice. */
function voiceKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const id of DEFAULT_VOICES) {
    const voice = VOICES.find((v) => v.id === id);
    if (voice) keyboard.text(voice.name, `voice:${voice.id}`);
  }
  return keyboard;
}

/** Voices `todo` and sends each chapter's files in reading order; a failed chapter stops the book. */
async function voiceBook(api: Api, chatId: number, book: Book, voice: Voice, todo: Chapter[], withReport: boolean) {
  const paths = bookPaths(bookName(book), voice.name);
  const job = { voiceId: voice.id, ...paths, report: withReport ? paths.report : undefined, chapters: todo };
  for await (const event of voiceChapters(job)) {
    if ("report" in event) {
      if (event.words) await sendReport(api, chatId, event.report, event.words, paths.dictionary);
      continue;
    }
    const chapter = todo.find((c) => c.index === event.chapter)!;
    if (event.error) throw new Error(`розділ «${chapter.name}»: ${event.error}`);
    for (const file of event.files ?? []) {
      const name = path.basename(file, ".mp3");
      try {
        await api.sendAudio(chatId, new InputFile(file, `${name}.mp3`), { title: name, performer: book.title });
      } catch (error) {
        await notify(api, chatId, `Не вдалося надіслати «${name}» (файл є в ${paths.audioDir}): ${message(error)}`);
      }
    }
  }
}

async function sendReport(api: Api, chatId: number, file: string, words: number, dictionary: string): Promise<void> {
  try {
    await api.sendDocument(chatId, new InputFile(file), {
      caption: `Слів, де варто перевірити наголос: ${words} (імена, невідомі слова, омографи). Неправильні допишіть у ${dictionary} — наступні розділи вже їх врахують, а готові: /regen <номер>.`,
    });
  } catch (error) {
    console.error("sendDocument failed:", error);
  }
}

/** A failed status message must not stop the book. */
async function notify(api: Api, chatId: number, text: string): Promise<void> {
  try {
    await api.sendMessage(chatId, text);
  } catch (error) {
    console.error("sendMessage failed:", error);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
