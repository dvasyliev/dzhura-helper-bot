import { Composer, InlineKeyboard, InputFile, type Api, type Context } from "grammy";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "../../config.ts";
import { busyWith, startJob } from "../../jobs.ts";
import type { Feature } from "../types.ts";
import { parseEpub, type Book } from "./epub.ts";
import { bookDir, chapterName, safeFilename } from "./text.ts";
import { DEFAULT_VOICES, VOICE_GROUPS, VOICES, voiceChapters } from "./voice.ts";

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // Telegram Bot API getFile limit

/** The last book sent, waiting for the voice to be chosen. */
let pending: Book | undefined;

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
    const book = await parseEpub(data);
    if (!book.chapters.length) return ctx.reply("Не знайшов у книжці жодного розділу з текстом.");
    await mkdir(bookDir(book.title), { recursive: true });
    await writeFile(`${bookDir(book.title)}/${safeFilename(doc.file_name)}`, data);
    pending = book;
    await ctx.reply(`${book.title}: розділів ${book.chapters.length}.\nЯким голосом озвучити?`, {
      reply_markup: voiceKeyboard(),
    });
  } catch (error) {
    await ctx.reply(`Помилка: ${message(error)}`);
  }
});

composer.callbackQuery(/^voice:(.+)$/, async (ctx) => {
  const book = pending;
  const voice = VOICES.find((v) => v.id === ctx.match[1]);
  if (!book || !voice) return ctx.answerCallbackQuery("Надішліть книжку ще раз.");
  const chatId = ctx.chat!.id;
  const started = startJob(`озвучка «${book.title}»`, () => voiceBook(ctx.api, chatId, book, voice.id), (error) =>
    notify(ctx.api, chatId, `Озвучку зупинено: ${message(error)}`),
  );
  if (!started) return ctx.answerCallbackQuery(`Зачекайте, зараз триває ${busyWith()}.`);
  pending = undefined;
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  await ctx.reply(`Озвучую голосом «${voice.name}».`);
});

export const audiobook: Feature = {
  id: "audiobook",
  title: "🎧 Створити аудіокнигу",
  hint: "Надішліть EPUB-книжку українською, і я озвучу її по розділах.",
  composer,
};

/** Default voices first with a star, then the rest by group. */
function voiceKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const id of DEFAULT_VOICES) {
    const voice = VOICES.find((v) => v.id === id);
    if (voice) keyboard.text(`⭐ ${voice.name}`, `voice:${voice.id}`);
  }
  keyboard.row();
  for (const all of VOICE_GROUPS) {
    const group = all.filter((v) => !DEFAULT_VOICES.includes(v.id));
    for (const [i, voice] of group.entries()) {
      keyboard.text(voice.name, `voice:${voice.id}`);
      if (i % 3 === 2 || i === group.length - 1) keyboard.row();
    }
  }
  return keyboard;
}

async function voiceBook(api: Api, chatId: number, book: Book, voiceId: string): Promise<void> {
  const texts = book.chapters.map((c) => c.text);
  for await (const result of voiceChapters(voiceId, bookDir(book.title), texts)) {
    const { title } = book.chapters[result.chapter];
    const name = chapterName(result.chapter + 1, title);
    if (result.error) {
      await notify(api, chatId, `Розділ ${name} пропущено: ${result.error}`);
      continue;
    }
    const files = result.files ?? [];
    for (const [p, file] of files.entries()) {
      const partName = files.length > 1 ? chapterName(result.chapter + 1, title, p) : name;
      try {
        await api.sendAudio(chatId, new InputFile(file, `${safeFilename(partName)}.mp3`), {
          title: partName,
          performer: book.title,
        });
      } catch (error) {
        await notify(api, chatId, `Не вдалося надіслати ${partName}: ${message(error)}`);
      }
    }
  }
  await notify(api, chatId, `Готово: ${book.title}.`);
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
