import { Bot, InputFile, type Api } from "grammy";
import { config } from "./config.ts";
import { parseEpub, type Book } from "./epub.ts";
import { chapterName, estimateCostUsd, groupParts, safeFilename, splitText } from "./text.ts";
import { mapInOrder } from "./pool.ts";
import { FatalTtsError, synthesize } from "./tts.ts";

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024; // Telegram Bot API getFile limit
const MAX_AUDIO_BYTES = 49 * 1024 * 1024; // sendAudio limit is 50 MB
const PARALLEL_CHUNKS = 3;

let busy = false;

export function createBot(): Bot {
  const bot = new Bot(config.botToken);

  bot.use(async (ctx, next) => {
    if (ctx.from?.id === config.ownerId) await next();
  });

  bot.command("start", (ctx) => ctx.reply("Надішліть EPUB-книжку, і я озвучу її по розділах."));

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.file_name?.toLowerCase().endsWith(".epub")) return ctx.reply("Потрібен файл .epub.");
    if ((doc.file_size ?? 0) > MAX_DOWNLOAD_BYTES)
      return ctx.reply("Файл більший за 20 МБ — Telegram не дає ботам його скачати.");
    if (busy) return ctx.reply("Зачекайте, ще озвучую попередню книжку.");

    busy = true;
    try {
      const file = await ctx.getFile();
      const res = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
      if (!res.ok) throw new Error(`Не вдалося скачати файл (${res.status})`);
      const book = await parseEpub(Buffer.from(await res.arrayBuffer()));
      if (!book.chapters.length) {
        busy = false;
        return ctx.reply("Не знайшов у книжці жодного розділу з текстом.");
      }
      const cost = estimateCostUsd(book.chapters.map((c) => c.text));
      await ctx.reply(
        `${book.title}: розділів ${book.chapters.length}. ≈${cost.toFixed(2)} $ на платній моделі (зараз модель ${config.fishModel}).`,
      );
      // Not awaited, so long polling keeps answering while the book is voiced.
      void voiceBook(bot.api, ctx.chat.id, book)
        .catch((error) => console.error("Book failed:", error))
        .finally(() => (busy = false));
    } catch (error) {
      busy = false;
      await ctx.reply(`Помилка: ${message(error)}`);
    }
  });

  bot.catch((err) => console.error(err.error));
  return bot;
}

async function voiceBook(api: Api, chatId: number, book: Book): Promise<void> {
  for (const [i, chapter] of book.chapters.entries()) {
    const name = chapterName(i + 1, chapter.title);
    try {
      const audio = await mapInOrder(splitText(chapter.text), PARALLEL_CHUNKS, (chunk) => synthesize(chunk));
      const parts = groupParts(audio, MAX_AUDIO_BYTES);
      for (const [p, part] of parts.entries()) {
        const partName = parts.length > 1 ? chapterName(i + 1, chapter.title, p) : name;
        await api.sendAudio(chatId, new InputFile(part, `${safeFilename(partName)}.mp3`), {
          title: partName,
          performer: book.title,
        });
      }
    } catch (error) {
      if (error instanceof FatalTtsError) {
        await notify(api, chatId, `Озвучку зупинено на розділі ${name}: ${error.message}`);
        return;
      }
      await notify(api, chatId, `Розділ ${name} пропущено: ${message(error)}`);
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
