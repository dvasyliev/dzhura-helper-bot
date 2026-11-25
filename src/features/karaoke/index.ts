import { Composer, InlineKeyboard, InputFile, type Context } from "grammy";
import path from "node:path";
import { busyWith, startJob } from "../../jobs.ts";
import type { Feature } from "../types.ts";
import { youtubeId } from "./link.ts";
import { isSeparated, runKaraoke, type KaraokeEvent, type KaraokeJob } from "./pipeline.ts";

const STEPS: Record<Extract<KaraokeEvent, { step: string }>["step"], string> = {
  download: "⏳ 1/6 · Скачую кліп…",
  separate: "⏳ 2/6 · Відділяю голос…",
  listen: "⏳ 3/6 · Слухаю…",
  lyrics: "⏳ 4/6 · Шукаю текст…",
  align: "⏳ 5/6 · Синхронізую…",
  render: "⏳ 6/6 · Рендерю…",
};
/** Telegram shows «записує відео…» at the top of the chat for 5 s after each chat action. */
const ACTION_EVERY_MS = 4000;
const NO_LYRICS = { not_found: "Не знайшов текст цієї пісні.", mismatch: "Знайдений текст не збігається зі співом." };
/** Telegram splits a long paste into several messages sent one right after another; they are joined. */
const PASTE_WAIT_MS = 1500;
/** Telegram's message limit is 4096 characters; a longer transcript goes as a file. */
const MAX_MESSAGE_CHARS = 4000;
const ANOTHER_SONG = "Ця кнопка від попередньої пісні. Надішліть посилання ще раз.";

type Clip = { url: string; id: string };
/** The link waiting for «лише музика чи з голосом». */
let pending: Clip | undefined;
/** The last job, re-run with the owner's or the recognized lyrics. */
let last: (Clip & { vocals: boolean }) | undefined;
/** What Whisper heard in the last song without lyrics. */
let heard = "";
/** Parts of a pasted text waiting for the rest. */
let paste: { parts: string[]; timer: NodeJS.Timeout } | undefined;

const composer = new Composer<Context>();

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text;
  const id = youtubeId(text);
  if (id) {
    pending = { url: `https://www.youtube.com/watch?v=${id}`, id };
    const keyboard = new InlineKeyboard().text("🎵 Лише музика", "karaoke:music").text("🎤 З голосом", "karaoke:vocals");
    return ctx.reply(`Лише музика чи з голосом? Займе ≈${isSeparated(id) ? "1 хв" : "2–3 хв"}.`, { reply_markup: keyboard });
  }
  if (!last || !(text.includes("\n") || paste)) return next();
  const song = last;
  if (paste) clearTimeout(paste.timer);
  const parts = [...(paste?.parts ?? []), text];
  paste = {
    parts,
    timer: setTimeout(() => {
      paste = undefined;
      void start(ctx, { ...song, lyricsText: parts.join("\n") });
    }, PASTE_WAIT_MS),
  };
});

composer.callbackQuery(/^karaoke:(vocals|music)$/, async (ctx) => {
  if (!pending) return ctx.answerCallbackQuery("Надішліть посилання ще раз.");
  await start(ctx, { ...pending, vocals: ctx.match[1] === "vocals" });
});

composer.callbackQuery(/^karaoke:mytext:(.+)$/, async (ctx) => {
  if (last?.id !== ctx.match[1]) return ctx.answerCallbackQuery(ANOTHER_SONG);
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  await ctx.reply("Надішліть текст пісні, кожен рядок з нового рядка.");
});

composer.callbackQuery(/^karaoke:transcript:(.+)$/, async (ctx) => {
  if (!last || last.id !== ctx.match[1]) return ctx.answerCallbackQuery(ANOTHER_SONG);
  const text = heard;
  if (!(await start(ctx, { ...last, useTranscript: true }))) return;
  const intro = "Розпізнаний текст. Виправте й надішліть — перероблю.";
  if (text.length <= MAX_MESSAGE_CHARS) return ctx.reply(`${intro}\n\n${text}`);
  await ctx.replyWithDocument(new InputFile(Buffer.from(text), "розпізнаний текст.txt"), { caption: intro });
});

export const karaoke: Feature = {
  id: "karaoke",
  title: "🎤 Згенерувати караоке",
  hint: "Надішліть посилання на YouTube-кліп — зроблю з нього караоке.",
  composer,
};

/** Runs the job in the background, editing one status message, and sends the video or asks for lyrics. False if busy. */
async function start(ctx: Context, job: KaraokeJob): Promise<boolean> {
  const chatId = ctx.chat!.id;
  const work = async () => {
    const status = await ctx.api.sendMessage(chatId, STEPS.download);
    const working = () => void ctx.api.sendChatAction(chatId, "record_video").catch(() => {});
    working();
    const ticker = setInterval(working, ACTION_EVERY_MS);
    try {
      await follow(ctx, chatId, status.message_id, job);
    } finally {
      clearInterval(ticker);
      await ctx.api.deleteMessage(chatId, status.message_id).catch(() => {});
    }
  };
  const stopped = (error: unknown) => ctx.api.sendMessage(chatId, `Караоке не вийшло: ${message(error)}`).then(() => {}, console.error);
  if (!startJob("караоке", work, stopped)) {
    const busy = `Зачекайте, зараз триває ${busyWith()}.`;
    await (ctx.callbackQuery ? ctx.answerCallbackQuery(busy) : ctx.reply(busy));
    return false;
  }
  last = { url: job.url, id: job.id, vocals: job.vocals };
  pending = undefined;
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
  }
  return true;
}

/** Edits the status message per step and sends the video or the lyrics buttons. */
async function follow(ctx: Context, chatId: number, statusId: number, job: KaraokeJob) {
  for await (const event of runKaraoke(job)) {
    if ("step" in event) {
      await ctx.api.editMessageText(chatId, statusId, STEPS[event.step]).catch(() => {});
    } else if ("needLyrics" in event) {
      heard = event.transcript;
      const keyboard = new InlineKeyboard()
        .text("✍️ Надішлю текст сам", `karaoke:mytext:${job.id}`)
        .text("🤖 Зробити з розпізнаного", `karaoke:transcript:${job.id}`);
      await ctx.api.sendMessage(chatId, NO_LYRICS[event.needLyrics], { reply_markup: keyboard });
    } else if ("error" in event) {
      throw new Error(event.error);
    } else {
      const { video, title, duration, width, height } = event;
      try {
        await ctx.api.sendVideo(chatId, new InputFile(video, path.basename(video)), {
          caption: title,
          duration: Math.round(duration),
          width,
          height,
          supports_streaming: true,
        });
      } catch (error) {
        await ctx.api.sendMessage(chatId, `Не вдалося надіслати відео (${message(error)}). Файл: ${video}`);
      }
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
