import { Composer, InlineKeyboard, InputFile, type Context } from "grammy";
import path from "node:path";
import { config } from "../../config.ts";
import { busyWith, startJob } from "../../jobs.ts";
import type { Feature } from "../types.ts";
import { youtubeId } from "./link.ts";
import { estimate, friendly } from "./messages.ts";
import { isSeparated, runKaraoke, type KaraokeEvent, type KaraokeJob, type Version } from "./pipeline.ts";
import { youtube } from "./youtube.ts";

const STEPS = {
  download: "Скачую кліп",
  separate: "Відділяю голос",
  listen: "Розпізнаю спів",
  lyrics: "Шукаю текст",
  align: "Підганяю слова під спів",
  render: "Збираю відео",
  upload: "Заливаю на YouTube",
} satisfies Record<Extract<KaraokeEvent, { step: string }>["step"] | "upload", string>;
/** Telegram shows «записує відео…» at the top of the chat for 5 s after each chat action. */
const ACTION_EVERY_MS = 4000;
const NO_LYRICS = { not_found: "Не знайшов текст цієї пісні.", mismatch: "Знайдений текст не збігається зі співом." };
/** Telegram splits a long paste into several messages sent one right after another; they are joined. */
const PASTE_WAIT_MS = 1500;
/** Telegram's message limit is 4096 characters; a longer transcript goes as a file. */
const MAX_MESSAGE_CHARS = 4000;
const ANOTHER_SONG = "Ця кнопка від попередньої пісні. Надішліть посилання ще раз.";
/** The owner's link-only karaoke playlist. */
const PLAYLIST = "PLxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const channel =
  config.googleClientId && config.googleClientSecret
    ? youtube({ clientId: config.googleClientId, clientSecret: config.googleClientSecret, playlistId: PLAYLIST, storeFile: "data/youtube.json" })
    : undefined;

/** «⏳ 3/7 · Слухаю…»; without YouTube there is no upload step. */
function stepText(step: keyof typeof STEPS): string {
  const steps = Object.keys(STEPS).filter((s) => channel || s !== "upload");
  return `⏳ ${steps.indexOf(step) + 1}/${steps.length} · ${STEPS[step]}…`;
}

type Clip = { url: string; id: string };
/** The link waiting for «лише музика чи з голосом». */
let pending: Clip | undefined;
/** The last job, re-run with the owner's or the recognized lyrics. */
let last: (Clip & { versions: Version[] }) | undefined;
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
    const keyboard = new InlineKeyboard()
      .text("🎵 Караоке", "karaoke:music")
      .text("🎤 Вокал", "karaoke:vocals")
      .text("🎵🎤 Обидва", "karaoke:both");
    return ctx.reply(`Яку версію зробити? ${estimate({ separated: isSeparated(id), youtube: !!channel })}`, { reply_markup: keyboard });
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

const VERSIONS: Record<string, Version[]> = { music: ["music"], vocals: ["vocals"], both: ["music", "vocals"] };

composer.callbackQuery(/^karaoke:(music|vocals|both)$/, async (ctx) => {
  if (!pending) return ctx.answerCallbackQuery("Надішліть посилання ще раз.");
  await start(ctx, { ...pending, versions: VERSIONS[ctx.match[1]] });
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

/** Runs the job in the background, editing one status message, and sends the YouTube link (or the video) or asks for lyrics. False if busy. */
async function start(ctx: Context, job: KaraokeJob): Promise<boolean> {
  const chatId = ctx.chat!.id;
  const work = async () => {
    const status = await ctx.api.sendMessage(chatId, stepText("download"));
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
  const stopped = (error: unknown) => ctx.api.sendMessage(chatId, `Караоке не вийшло: ${friendly(error)}`).then(() => {}, console.error);
  if (!startJob("караоке", work, stopped)) {
    const busy = `Зачекайте, зараз триває ${busyWith()}.`;
    await (ctx.callbackQuery ? ctx.answerCallbackQuery(busy) : ctx.reply(busy));
    return false;
  }
  last = { url: job.url, id: job.id, versions: job.versions };
  pending = undefined;
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
  }
  return true;
}

/** Edits the status message per step and sends each karaoke or the lyrics buttons. */
async function follow(ctx: Context, chatId: number, statusId: number, job: KaraokeJob) {
  const status = (step: keyof typeof STEPS) => ctx.api.editMessageText(chatId, statusId, stepText(step)).catch(() => {});
  for await (const event of runKaraoke(job)) {
    if ("step" in event) {
      await status(event.step);
    } else if ("needLyrics" in event) {
      heard = event.transcript;
      const keyboard = new InlineKeyboard()
        .text("✍️ Надішлю текст сам", `karaoke:mytext:${job.id}`)
        .text("🤖 Зробити з розпізнаного", `karaoke:transcript:${job.id}`);
      await ctx.api.sendMessage(chatId, NO_LYRICS[event.needLyrics], { reply_markup: keyboard });
    } else if ("error" in event) {
      throw new Error(event.error);
    } else {
      const name = path.basename(event.video, ".mp4");
      if (!channel) {
        await sendVideo(ctx, chatId, event);
        continue;
      }
      await status("upload");
      try {
        const { url, inPlaylist } = await channel.publish({ file: event.full, title: name, description: `Оригінал: ${job.url}` }, (url, code) =>
          askLogin(ctx, chatId, url, code),
        );
        await ctx.api.sendMessage(chatId, `<b>${escapeHtml(name)}</b>\n${url}${inPlaylist ? "" : "\n(у плейлист не додалось)"}`, { parse_mode: "HTML" });
      } catch (error) {
        await ctx.api.sendMessage(chatId, `Не залив на YouTube: ${friendly(error)}`);
        await sendVideo(ctx, chatId, event);
      }
    }
  }
}

/** How to log in, then the code alone, so it is easy to copy. */
async function askLogin(ctx: Context, chatId: number, url: string, code: string) {
  await ctx.api.sendMessage(
    chatId,
    `Щоб залити на YouTube, увійдіть: відкрийте ${url}, введіть код з наступного повідомлення й оберіть акаунт з каналом. ` +
      "Якщо Google попередить, що застосунок не перевірений, натисніть «Продовжити». Після входу заливка продовжиться сама.",
  );
  await ctx.api.sendMessage(chatId, `<code>${escapeHtml(code)}</code>`, { parse_mode: "HTML" });
}

/** The video itself, when there is no YouTube link to send. */
async function sendVideo(ctx: Context, chatId: number, event: Extract<KaraokeEvent, { video: string }>) {
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
    await ctx.api.sendMessage(chatId, `Не вдалося надіслати відео (${friendly(error)}). Файл: ${video}`);
  }
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
