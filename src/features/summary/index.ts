import { Composer, InputFile, type Api, type Context } from "grammy";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { aiMeter, reportAi } from "../../ai-usage.ts";
import { config } from "../../config.ts";
import { bold, escape, HTML, problem } from "../../format.ts";
import { busyHtml, startJob } from "../../jobs.ts";
import { runPython } from "../../python.ts";
import { notify } from "../audiobook/deliver.ts";
import { voiceChapters, type Voice } from "../audiobook/voice.ts";
import {
  ABOUT_MD,
  SUMMARY_DIR,
  SUMMARY_VOICES,
  audioFile,
  findVideo,
  type FileLevel,
  isMaking,
  newVideoDir,
  setMaking,
  summaryItems,
  syncSummaries,
} from "../library/summary.ts";
import { textOptions } from "../library/topic.ts";
import { LimitError, runClaude } from "../translate/claude.ts";
import type { Feature } from "../types.ts";
import { isMusic, videoInfo, type VideoInfo } from "../video/info.ts";
import { speechText } from "./speech.ts";
import { levelMarkdown, writeLevel, type Level } from "./summarize.ts";

const TRANSCRIPT = "transcript.txt";

/** Summaries are read ×1.15 faster than audiobooks. */
const SUMMARY_TEMPO = 1.15;

const STEPS: Record<Level, string> = {
  about: "Describing the video…",
  brief: "Writing the brief summary…",
  detailed: "Writing the detailed summary…",
};

/** How an operation is named in the AI usage history. */
const OPERATIONS: Record<Level, string> = {
  about: "📝 Video description",
  brief: "📋 Brief summary",
  detailed: "📖 Detailed summary",
};

function levelFile(dir: string, level: Level): string {
  return path.join(dir, level === "about" ? ABOUT_MD : `${level}.md`);
}

const composer = new Composer<Context>();

// Under a level's document: voice it, writing the document first if needed.
composer.callbackQuery(
  /^summary:voice:(brief|detailed):([\w-]{11}):(\w+)$/,
  async (ctx) => {
    const voice = SUMMARY_VOICES.find((v) => v.name === ctx.match[3]);
    if (!voice) return ctx.answerCallbackQuery("Unknown voice");
    await ctx.answerCallbackQuery();
    if (await begin(ctx.api, ctx.match[2]!, ctx.match[1] as Level, voice))
      await showLoading(ctx, "Voicing audio…");
  },
);

// From the card: the description.
composer.callbackQuery(/^summary:([\w-]{11})$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await begin(ctx.api, ctx.match[1]!, "about");
});

// Under the description, in the chat or the library group.
composer.callbackQuery(
  /^summary:(brief|detailed):([\w-]{11})$/,
  async (ctx) => {
    await ctx.answerCallbackQuery();
    if (await begin(ctx.api, ctx.match[2]!, ctx.match[1] as Level))
      await showLoading(ctx, "Generating document…");
  },
);

/**
 * The pressed placeholder loses its buttons at once, so it cannot be pressed twice; in the library group it also
 * shows `text` (the topic's sync would show it a moment later). In the chat the file comes as a new message, so the
 * placeholder keeps its text there.
 */
async function showLoading(ctx: Context, text: string): Promise<void> {
  await (
    ctx.chat?.type === "private"
      ? ctx.editMessageReplyMarkup()
      : ctx.editMessageText(text)
  ).catch(() => {});
}

export const summary: Feature = {
  id: "summary",
  title: "📝 YouTube summary",
  hint: `📝 ${bold("YouTube summary")}\nSend a YouTube link (not a music clip) and I'll describe it in Ukrainian; a brief or a detailed summary is a button away.`,
  composer,
  actions: async (input) => {
    if (input.kind !== "youtube") return;
    // A music clip gets karaoke instead.
    const info = await videoInfo(input.id);
    if (info && isMusic(info)) return;
    return {
      buttons: [{ text: "📝 Summary", data: `summary:${input.id}` }],
      ask: async (ctx) => {
        await begin(ctx.api, input.id, "about");
      },
    };
  },
};

/** The video's folder, metadata and transcript, read once into that folder. */
async function prepare(
  id: string,
  step: (text: string) => Promise<unknown>,
): Promise<{ dir: string; info: VideoInfo; transcript: string }> {
  const found = await findVideo(id);
  let dir = found?.dir;
  let info: VideoInfo | undefined = found?.info;
  if (!dir || !info) {
    info = await videoInfo(id);
    if (!info) throw new Error("Couldn't read the video on YouTube");
    dir = await newVideoDir(id, info);
  }
  if (!existsSync(path.join(dir, TRANSCRIPT)))
    for await (const event of runPython(
      "src/features/summary/scripts/transcript.py",
      { id, dir },
      { background: true },
    ))
      if (event.step === "whisper")
        await step("No subtitles, listening to the video…");
  return {
    dir,
    info,
    transcript: await readFile(path.join(dir, TRANSCRIPT), "utf8"),
  };
}

/** Shows level `key` as being made in the Summary topic, or no longer. */
async function showMaking(api: Api, key: string, on: boolean): Promise<void> {
  setMaking(key, on);
  await syncSummaries(api).catch(console.error);
}

/**
 * Writes `level` of video `id` in the background, unless it is written already or being written; then delivers it.
 * With `voice` it then voices the level too (its audio, unless voiced already or being voiced).
 * Progress goes to the owner's chat. True when it started.
 */
async function begin(
  api: Api,
  id: string,
  level: Level,
  voice?: Voice,
): Promise<boolean> {
  const chatId = config.ownerId;
  const key = `${id}/${level}`;
  const audioKey = `${key}/audio`;
  const found = await findVideo(id);
  const written = !!found && existsSync(levelFile(found.dir, level));
  if (voice) {
    if (found && (await audioFile(found.dir, level as FileLevel))) {
      await deliver(api, chatId, id, level, SUMMARY_DIR, "audio");
      return false;
    }
    if (isMaking(audioKey)) return false;
  } else if (written) {
    await deliver(api, chatId, id, level);
    return false;
  }
  if (isMaking(key)) return false;
  const work = async () => {
    // The pressed placeholders show they are being made.
    if (voice) setMaking(audioKey, true);
    if (!written && level !== "about") setMaking(key, true);
    await syncSummaries(api).catch(console.error);
    const status = await api.sendMessage(
      chatId,
      `📝 ${bold(written ? "Voicing audio…" : "Getting the transcript…")}`,
      HTML,
    );
    const step = (text: string, icon = "📝") =>
      api
        .editMessageText(
          chatId,
          status.message_id,
          `${icon} ${bold(text)}`,
          HTML,
        )
        .catch(() => {});
    try {
      if (!written) await write(api, id, level, step);
      if (voice) {
        await step("Voicing audio…", "🔊");
        await speak(id, level, voice);
      }
    } finally {
      setMaking(audioKey, false);
      await api.deleteMessage(chatId, status.message_id).catch(() => {});
    }
    if (voice) await deliver(api, chatId, id, level, SUMMARY_DIR, "audio");
  };
  const failed = async (error: unknown) => {
    // The placeholders get their buttons back.
    if (level !== "about") await showMaking(api, key, false);
    await notify(
      api,
      chatId,
      error instanceof LimitError
        ? `⚠️ ${bold("Hit the Claude usage limit")}\nTry again after ${error.resetAt.toTimeString().slice(0, 5)}.`
        : `⚠️ ${bold("Summary failed")}\n${problem(error)}`,
    );
  };
  if (startJob("video summary", work, failed)) return true;
  await notify(api, chatId, busyHtml());
  return false;
}

/** Writes `level` of video `id` with Claude, then delivers it and records the AI usage. */
async function write(
  api: Api,
  id: string,
  level: Level,
  step: (text: string) => Promise<unknown>,
): Promise<void> {
  const key = `${id}/${level}`;
  const meter = aiMeter();
  let title = id;
  try {
    const { dir, info, transcript } = await prepare(id, step);
    await step(STEPS[level]);
    title = info.title;
    const reply = await writeLevel(level, info, transcript, (prompt, input) =>
      runClaude(prompt, input, meter.add),
    );
    await writeFile(
      levelFile(dir, level),
      level === "about"
        ? `${reply.trim()}\n`
        : levelMarkdown(info, id, level, reply),
    );
  } finally {
    setMaking(key, false);
  }
  const link = await deliver(api, config.ownerId, id, level);
  await reportAi(meter.record(`${OPERATIONS[level]} · ${title}`, link));
}

/** Voices the written `level` of video `id` into «<level> - <Voice>.mp3» in its folder: one file, ×1.15. */
async function speak(id: string, level: Level, voice: Voice): Promise<void> {
  const found = await findVideo(id);
  if (!found) throw new Error(`No folder for video ${id}`);
  const { dir } = found;
  const speech = path.join(dir, "speech");
  const md = await readFile(levelFile(dir, level), "utf8");
  for await (const event of voiceChapters({
    voice,
    textDir: speech,
    audioDir: dir,
    dictionary: path.join(speech, "dictionary.txt"),
    chapters: [
      { index: 0, name: `${level} - ${voice.name}`, text: speechText(md) },
    ],
    tempo: SUMMARY_TEMPO,
    oneFile: true,
  }))
    if ("error" in event && event.error) throw new Error(event.error);
}

/**
 * With a library group: `Done → <link>` to the level's message in the Summary topic. Without one the level itself
 * here: the description and its placeholders, or the .md. Returns the level's link in the topic, if any.
 */
export async function deliver(
  api: Api,
  chatId: number,
  id: string,
  level: Level,
  root = SUMMARY_DIR,
  what: "document" | "audio" = "document",
): Promise<string | undefined> {
  const key = what === "audio" ? `${id}/${level}/audio` : `${id}/${level}`;
  const synced = await syncSummaries(api);
  if (synced) {
    const link = synced.link(key);
    if (link) await notify(api, chatId, `✅ ${bold("Done")} → ${escape(link)}`);
    return link;
  }
  // The description comes with its levels' placeholders, as in the topic; a level is its .md.
  const own = (await summaryItems(root)).filter((i) =>
    level === "about"
      ? i.key.startsWith(`${id}/`) && i.kind === "text"
      : i.key === key,
  );
  for (const item of own)
    if (item.kind === "text")
      await api
        .sendMessage(chatId, item.text, textOptions(item))
        .catch(console.error);
    else
      await (
        item.kind === "audio"
          ? api.sendAudio(chatId, new InputFile(item.file, item.name), {
              title: item.title,
              performer: item.performer,
            })
          : api.sendDocument(chatId, new InputFile(item.file, item.name))
      ).catch((error) =>
        notify(
          api,
          chatId,
          `⚠️ ${bold("Couldn't send the summary")}\n${problem(error)}`,
        ),
      );
}
