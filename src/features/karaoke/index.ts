import { Composer, InlineKeyboard, InputFile, type Context } from "grammy";
import { clearButtons } from "../../lib/telegram/buttons.ts";
import path from "node:path";
import { ownerId } from "../../lib/telegram/owner.ts";
import {
  bold,
  code as codeHtml,
  escape,
  HTML,
  problem,
  quote,
} from "../../lib/text/format.ts";
import { busyHtml, busyWith, startJob } from "../../lib/jobs/jobs.ts";
import { isMusic, videoInfo } from "../../lib/video/info.ts";
import { syncKaraoke, VERSION_NAMES } from "../../lib/library/karaoke.ts";
import type { Feature } from "../../lib/feature/types.ts";
import { leftText } from "../../lib/text/eta.ts";
import { spentText } from "../../lib/claude/ai-usage.ts";
import {
  counter,
  failureText,
  statusText,
  withLanguage,
} from "../../lib/text/status.ts";
import { estimate, expectedMinutes, friendly } from "./messages.ts";
import {
  isSeparated,
  runKaraoke,
  type KaraokeEvent,
  type KaraokeJob,
} from "./pipeline.ts";
import { youtube } from "./youtube.ts";
import type { Version } from "../../lib/video/version.ts";

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
  not_found: `⚠️ ${bold("Couldn't find the lyrics of this song")}`,
  unreachable: `⚠️ ${bold("The lyrics service (LRCLIB) is unreachable")}`,
  mismatch: `⚠️ ${bold("The lyrics found don't match the singing")}`,
};
/** Telegram splits a long paste into several messages sent one right after another; they are joined. */
const PASTE_WAIT_MS = 1500;
/** Telegram's message limit is 4096 characters; a longer transcript goes as a file. */
const MAX_MESSAGE_CHARS = 4000;
const ANOTHER_SONG =
  "This button is from an earlier song. Send the link again.";
let channel: ReturnType<typeof youtube> | undefined;

/** Turns on the upload to YouTube; the entry calls it when the settings have the Google client and the playlist. */
export function enableYoutube(settings: {
  clientId: string;
  clientSecret: string;
  playlistId: string;
}): void {
  channel = youtube({ ...settings, storeFile: "data/youtube.json" });
}

/** What a job is called in the statuses: «Karaoke Music (EN)», «Karaoke Music + Vocals (EN)». */
type Named = { what: string; title?: string };

/** «⏳ Processing: Karaoke Music (EN) - Title», then «3/7 · Recognising the singing · ≈2 min left»; without YouTube there is no upload step. */
function stepText(
  step: keyof typeof STEPS,
  minutesLeft: number,
  { what, title }: Named,
): string {
  const steps = Object.keys(STEPS).filter((s) => channel || s !== "upload");
  return `${statusText("processing", what, title)}\n${counter(steps.indexOf(step) + 1, steps.length, "steps")} · ${STEPS[step]} · ${leftText(minutesLeft)}`;
}

/** The job's name and the song's title, read from YouTube. */
async function named(job: KaraokeJob): Promise<Named> {
  const info = await videoInfo(job.id);
  const versions = job.versions
    .map((v) => (v === "vocals" ? "Vocals" : "Music"))
    .join(" + ");
  return {
    what: withLanguage(`Karaoke ${versions}`, info?.language),
    title: info?.title,
  };
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
      void start(ctx, { ...song, lyricsText: parts.join("\n") }).catch(
        console.error,
      );
    }, PASTE_WAIT_MS),
  };
});

const VERSIONS: Record<string, Version[]> = {
  music: ["music"],
  vocals: ["vocals"],
  both: ["music", "vocals"],
};

/** «Which version?» for the video `id`, with the forecast. */
async function askVersion(ctx: Context, id: string) {
  pending = { url: `https://www.youtube.com/watch?v=${id}`, id };
  const keyboard = new InlineKeyboard()
    .text("🎵 Karaoke", "karaoke:music")
    .text("🎤 Vocals", "karaoke:vocals")
    .text("🎵🎤 Both", "karaoke:both");
  return ctx.reply(
    `❓ ${bold("Which version?")}\n\n${quote([estimate({ separated: await isSeparated(id), youtube: !!channel })])}`,
    { ...HTML, reply_markup: keyboard },
  );
}

// The card's «Karaoke» button.
composer.callbackQuery(/^karaoke:open:([\w-]{11})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await clearButtons(ctx);
  await askVersion(ctx, ctx.match[1]);
});

composer.callbackQuery(/^karaoke:(music|vocals|both)$/, async (ctx) => {
  if (!pending) return ctx.answerCallbackQuery("Send the link again.");
  await start(ctx, { ...pending, versions: VERSIONS[ctx.match[1]] });
});

composer.callbackQuery(/^karaoke:mytext:(.+)$/, async (ctx) => {
  if (last?.id !== ctx.match[1]) return ctx.answerCallbackQuery(ANOTHER_SONG);
  await ctx.answerCallbackQuery();
  await clearButtons(ctx);
  await ctx.reply(
    `🎤 ${bold("Send the lyrics")}\nEach line on a new line.`,
    HTML,
  );
});

composer.callbackQuery(/^karaoke:transcript:(.+)$/, async (ctx) => {
  if (!last || last.id !== ctx.match[1])
    return ctx.answerCallbackQuery(ANOTHER_SONG);
  const text = heard;
  if (!(await start(ctx, { ...last, useTranscript: true }))) return;
  const intro = `🎤 ${bold("The recognised lyrics")}\nFix them and send them back, and I'll redo the video.`;
  const shown = escape(text);
  if (shown.length <= MAX_MESSAGE_CHARS)
    return ctx.reply(`${intro}\n\n${shown}`, HTML);
  await ctx.replyWithDocument(
    new InputFile(Buffer.from(text), "transcript.txt"),
    { ...HTML, caption: intro },
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
      ownerId(),
    );
  },
);

export const karaoke: Feature = {
  id: "karaoke",
  title: "🎤 Generate karaoke",
  hint: `🎤 ${bold("Generate karaoke")}\nSend a YouTube clip link and I'll make a karaoke video of it.`,
  composer,
  actions: async (input) => {
    if (input.kind !== "youtube") return;
    // A video known not to be music gets a summary instead.
    const info = await videoInfo(input.id);
    if (info && !isMusic(info)) return;
    return {
      buttons: [{ text: "🎤 Karaoke", data: `karaoke:open:${input.id}` }],
      ask: (ctx) => askVersion(ctx, input.id),
    };
  },
};

/** Runs the job in the background in `chatId`, editing one status message, and sends the result or asks for lyrics. False if busy. */
async function start(
  ctx: Context,
  job: KaraokeJob,
  chatId = ctx.chat!.id,
): Promise<boolean> {
  const expected = expectedMinutes({
    separated: await isSeparated(job.id),
    youtube: !!channel,
    versions: job.versions.length,
  });
  const name = await named(job);
  const work = async () => {
    const started = Date.now();
    // Steps take very different times, so the time left is the estimate less the time gone.
    const left = () => Math.max(0, expected - (Date.now() - started) / 60_000);
    const status = await ctx.api.sendMessage(
      chatId,
      stepText("download", left(), name),
      HTML,
    );
    const working = () =>
      void ctx.api.sendChatAction(chatId, "record_video").catch(() => {}); // only the «recording» hint; the job does not need it
    working();
    const ticker = setInterval(working, ACTION_EVERY_MS);
    try {
      await follow(ctx, chatId, status.message_id, job, left, name, started);
    } finally {
      clearInterval(ticker);
      await ctx.api.deleteMessage(chatId, status.message_id).catch(() => {}); // a leftover status line is harmless
    }
  };
  const stopped = (error: unknown) =>
    ctx.api
      .sendMessage(
        chatId,
        failureText(name.what, friendly(error), name.title),
        HTML,
      )
      .then(() => {}, console.error);
  if (!startJob("karaoke", work, stopped)) {
    await (ctx.callbackQuery
      ? ctx.answerCallbackQuery(`Please wait, ${busyWith()} is in progress.`)
      : ctx.reply(busyHtml(), HTML));
    return false;
  }
  last = { url: job.url, id: job.id, versions: job.versions };
  pending = undefined;
  if (ctx.callbackQuery && chatId !== ctx.chat?.id) {
    // Pressed in the library group: the progress goes to the private chat.
    await ctx.answerCallbackQuery(
      "Started, the progress is in the private chat.",
    );
  } else if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery();
    await clearButtons(ctx);
  }
  return true;
}

/** Edits the status message per step and sends each karaoke or the lyrics buttons. */
async function follow(
  ctx: Context,
  chatId: number,
  statusId: number,
  job: KaraokeJob,
  left: () => number,
  label: Named,
  started: number,
) {
  const status = (step: keyof typeof STEPS) =>
    ctx.api
      .editMessageText(chatId, statusId, stepText(step, left(), label), HTML)
      .catch(() => {}); // a missed status edit is shown by the next step
  for await (const event of runKaraoke(job)) {
    if ("step" in event) {
      await status(event.step);
    } else if ("needLyrics" in event) {
      heard = event.transcript;
      const keyboard = new InlineKeyboard()
        .text("✍️ I'll send the lyrics", `karaoke:mytext:${job.id}`)
        .text("🤖 Use the recognised lyrics", `karaoke:transcript:${job.id}`);
      await ctx.api.sendMessage(chatId, NO_LYRICS[event.needLyrics], {
        ...HTML,
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
          link = `✅ ${bold(escape(name))}\n${escape(url)}${inPlaylist ? "" : "\n(not added to the playlist)"}`;
        } catch (error) {
          await ctx.api.sendMessage(
            chatId,
            `⚠️ ${bold("Didn't upload to YouTube")}\n${problem(friendly(error))}`,
            HTML,
          );
        }
      }
      const spent = `\n\n${spentText({ ms: Date.now() - started })}`;
      const inLibrary = (await syncKaraoke(ctx.api))?.link(
        `${path.basename(path.dirname(event.video))}/${versionOf(name)}`,
      );
      if (inLibrary)
        await ctx.api.sendMessage(
          chatId,
          `${statusText("done", label.what, label.title, inLibrary)}${notInPlaylist ? "\n(not added to the playlist)" : ""}${spent}`,
          HTML,
        );
      else if (link) await ctx.api.sendMessage(chatId, `${link}${spent}`, HTML);
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
    `🎤 ${bold("Sign in to upload to YouTube")}\nOpen ${escape(url)}, enter the code from the next message and pick the account with the channel. ` +
      "If Google warns that the app isn't verified, press «Continue». After you sign in, the upload continues by itself.",
    HTML,
  );
  await ctx.api.sendMessage(chatId, codeHtml(escape(code)), HTML);
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
        ...HTML,
        caption: `🎤 ${bold(escape(title ?? path.parse(video).name))}`,
        duration: duration == null ? undefined : Math.round(duration),
        width: width ?? undefined,
        height: height ?? undefined,
        supports_streaming: true,
      },
    );
  } catch (error) {
    await ctx.api.sendMessage(
      chatId,
      `⚠️ ${bold("Couldn't send the video")}\n${problem(friendly(error))}\nFile: ${codeHtml(escape(video))}`,
      HTML,
    );
  }
}
