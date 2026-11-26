import { Composer, InlineKeyboard, InputFile, type Context } from "grammy";
import path from "node:path";
import { config } from "../../config.ts";
import { busyWith, startJob } from "../../jobs.ts";
import { syncKaraoke, VERSION_NAMES } from "../library/karaoke.ts";
import type { Feature } from "../types.ts";
import { estimate, friendly } from "./messages.ts";
import {
  isSeparated,
  runKaraoke,
  type KaraokeEvent,
  type KaraokeJob,
  type Version,
} from "./pipeline.ts";
import { youtube } from "./youtube.ts";

const STEPS = {
  download: "Downloading the clip",
  separate: "Separating the vocals",
  listen: "Recognising the singing",
  lyrics: "Looking for the lyrics",
  align: "Fitting the words to the singing",
  render: "Building the video",
  upload: "Uploading to YouTube",
} satisfies Record<
  Extract<KaraokeEvent, { step: string }>["step"] | "upload",
  string
>;
/** Telegram shows «sending video…» at the top of the chat for 5 s after each chat action. */
const ACTION_EVERY_MS = 4000;
const NO_LYRICS = {
  not_found: "Couldn't find the lyrics of this song.",
  mismatch: "The lyrics found don't match the singing.",
};
/** Telegram splits a long paste into several messages sent one right after another; they are joined. */
const PASTE_WAIT_MS = 1500;
/** Telegram's message limit is 4096 characters; a longer transcript goes as a file. */
const MAX_MESSAGE_CHARS = 4000;
const ANOTHER_SONG =
  "This button is from an earlier song. Send the link again.";
const channel =
  config.googleClientId && config.googleClientSecret && config.youtubePlaylistId
    ? youtube({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
        playlistId: config.youtubePlaylistId,
        storeFile: "data/youtube.json",
      })
    : undefined;

/** «⏳ 3/7 · Recognising the singing…»; without YouTube there is no upload step. */
function stepText(step: keyof typeof STEPS): string {
  const steps = Object.keys(STEPS).filter((s) => channel || s !== "upload");
  return `⏳ ${steps.indexOf(step) + 1}/${steps.length} · ${STEPS[step]}…`;
}

type Clip = { url: string; id: string };
/** The link waiting for «music only or with vocals». */
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

const VERSIONS: Record<string, Version[]> = {
  music: ["music"],
  vocals: ["vocals"],
  both: ["music", "vocals"],
};

/** «Which version?» for the video `id`, with the forecast. */
function askVersion(ctx: Context, id: string) {
  pending = { url: `https://www.youtube.com/watch?v=${id}`, id };
  const keyboard = new InlineKeyboard()
    .text("🎵 Karaoke", "karaoke:music")
    .text("🎤 Vocals", "karaoke:vocals")
    .text("🎵🎤 Both", "karaoke:both");
  return ctx.reply(
    `Which version? ${estimate({ separated: isSeparated(id), youtube: !!channel })}`,
    { reply_markup: keyboard },
  );
}

// The card's «Karaoke» button.
composer.callbackQuery(/^karaoke:open:([\w-]{11})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  await askVersion(ctx, ctx.match[1]);
});

composer.callbackQuery(/^karaoke:(music|vocals|both)$/, async (ctx) => {
  if (!pending) return ctx.answerCallbackQuery("Send the link again.");
  await start(ctx, { ...pending, versions: VERSIONS[ctx.match[1]] });
});

composer.callbackQuery(/^karaoke:mytext:(.+)$/, async (ctx) => {
  if (last?.id !== ctx.match[1]) return ctx.answerCallbackQuery(ANOTHER_SONG);
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  await ctx.reply("Send the lyrics, each line on a new line.");
});

composer.callbackQuery(/^karaoke:transcript:(.+)$/, async (ctx) => {
  if (!last || last.id !== ctx.match[1])
    return ctx.answerCallbackQuery(ANOTHER_SONG);
  const text = heard;
  if (!(await start(ctx, { ...last, useTranscript: true }))) return;
  const intro =
    "The recognised lyrics. Fix them and send them back, and I'll redo the video.";
  if (text.length <= MAX_MESSAGE_CHARS) return ctx.reply(`${intro}\n\n${text}`);
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(text), "transcript.txt"),
    { caption: intro },
  );
});

// A library placeholder's «Make it» button, pressed in the group; the job reports in the private chat.
composer.callbackQuery(
  /^karaoke:make:([\w-]{11}):(music|vocals)$/,
  async (ctx) => {
    const id = ctx.match[1];
    await start(
      ctx,
      {
        url: `https://www.youtube.com/watch?v=${id}`,
        id,
        versions: [ctx.match[2] as Version],
      },
      config.ownerId,
    );
  },
);

export const karaoke: Feature = {
  id: "karaoke",
  title: "🎤 Generate karaoke",
  hint: "Send a YouTube clip link and I'll make a karaoke video of it.",
  composer,
  actions: async (input) =>
    input.kind === "youtube"
      ? {
          buttons: [{ text: "🎤 Karaoke", data: `karaoke:open:${input.id}` }],
          ask: (ctx) => askVersion(ctx, input.id),
        }
      : undefined,
};

/** Runs the job in the background in `chatId`, editing one status message, and sends the result or asks for lyrics. False if busy. */
async function start(
  ctx: Context,
  job: KaraokeJob,
  chatId = ctx.chat!.id,
): Promise<boolean> {
  const work = async () => {
    const status = await ctx.api.sendMessage(chatId, stepText("download"));
    const working = () =>
      void ctx.api.sendChatAction(chatId, "record_video").catch(() => {});
    working();
    const ticker = setInterval(working, ACTION_EVERY_MS);
    try {
      await follow(ctx, chatId, status.message_id, job);
    } finally {
      clearInterval(ticker);
      await ctx.api.deleteMessage(chatId, status.message_id).catch(() => {});
    }
  };
  const stopped = (error: unknown) =>
    ctx.api
      .sendMessage(chatId, `Karaoke failed: ${friendly(error)}`)
      .then(() => {}, console.error);
  if (!startJob("karaoke", work, stopped)) {
    const busy = `Please wait, ${busyWith()} is in progress.`;
    await (ctx.callbackQuery ? ctx.answerCallbackQuery(busy) : ctx.reply(busy));
    return false;
  }
  last = { url: job.url, id: job.id, versions: job.versions };
  pending = undefined;
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    if (chatId === ctx.chat?.id)
      await ctx.editMessageReplyMarkup().catch(() => {});
  }
  return true;
}

/** Edits the status message per step and sends each karaoke or the lyrics buttons. */
async function follow(
  ctx: Context,
  chatId: number,
  statusId: number,
  job: KaraokeJob,
) {
  const status = (step: keyof typeof STEPS) =>
    ctx.api.editMessageText(chatId, statusId, stepText(step)).catch(() => {});
  for await (const event of runKaraoke(job)) {
    if ("step" in event) {
      await status(event.step);
    } else if ("needLyrics" in event) {
      heard = event.transcript;
      const keyboard = new InlineKeyboard()
        .text("✍️ I'll send the lyrics", `karaoke:mytext:${job.id}`)
        .text("🤖 Use the recognised lyrics", `karaoke:transcript:${job.id}`);
      await ctx.api.sendMessage(chatId, NO_LYRICS[event.needLyrics], {
        reply_markup: keyboard,
      });
    } else if ("error" in event) {
      throw new Error(event.error);
    } else {
      const name = path.basename(event.video, ".mp4");
      let link: string | undefined;
      let notInPlaylist = false;
      if (channel) {
        await status("upload");
        try {
          const { url, inPlaylist } = await channel.publish(
            {
              file: event.full,
              title: name,
              description: `Original: ${job.url}`,
            },
            (url, code) => askLogin(ctx, chatId, url, code),
          );
          notInPlaylist = !inPlaylist;
          link = `<b>${escapeHtml(name)}</b>\n${url}${inPlaylist ? "" : "\n(not added to the playlist)"}`;
        } catch (error) {
          await ctx.api.sendMessage(
            chatId,
            `Didn't upload to YouTube: ${friendly(error)}`,
          );
        }
      }
      const inLibrary = (await syncKaraoke(ctx.api))?.link(
        `${path.basename(path.dirname(event.video))}/${versionOf(name)}`,
      );
      if (inLibrary)
        await ctx.api.sendMessage(
          chatId,
          `Done → ${inLibrary}${notInPlaylist ? " (not added to the playlist)" : ""}`,
        );
      else if (link)
        await ctx.api.sendMessage(chatId, link, { parse_mode: "HTML" });
      else await sendVideo(ctx, chatId, event);
    }
  }
}

/** The version a karaoke file is: «X (Karaoke)» → music, «X (Vocals)» → vocals. */
function versionOf(name: string): Version {
  return name.endsWith(`(${VERSION_NAMES.vocals})`) ? "vocals" : "music";
}

/** How to log in, then the code alone, so it is easy to copy. */
async function askLogin(
  ctx: Context,
  chatId: number,
  url: string,
  code: string,
) {
  await ctx.api.sendMessage(
    chatId,
    `To upload to YouTube, sign in: open ${url}, enter the code from the next message and pick the account with the channel. ` +
      "If Google warns that the app isn't verified, press «Continue». After you sign in, the upload continues by itself.",
  );
  await ctx.api.sendMessage(chatId, `<code>${escapeHtml(code)}</code>`, {
    parse_mode: "HTML",
  });
}

/** The video itself, when there is no YouTube link to send. */
async function sendVideo(
  ctx: Context,
  chatId: number,
  event: Extract<KaraokeEvent, { video: string }>,
) {
  const { video, title, duration, width, height } = event;
  try {
    await ctx.api.sendVideo(
      chatId,
      new InputFile(video, path.basename(video)),
      {
        caption: title,
        duration: Math.round(duration),
        width,
        height,
        supports_streaming: true,
      },
    );
  } catch (error) {
    await ctx.api.sendMessage(
      chatId,
      `Couldn't send the video (${friendly(error)}). File: ${video}`,
    );
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
