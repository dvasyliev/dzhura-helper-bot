import { Composer, InputFile, type Api, type Context } from "grammy";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.ts";
import { bold, escape, HTML, problem } from "../../format.ts";
import { busyHtml, startJob } from "../../jobs.ts";
import { runPython } from "../../python.ts";
import { notify } from "../audiobook/deliver.ts";
import {
  ABOUT_MD,
  META_JSON,
  SUMMARY_DIR,
  summaryItems,
  syncSummaries,
} from "../library/summary.ts";
import { keyboard } from "../library/topic.ts";
import { LimitError } from "../translate/claude.ts";
import type { Feature } from "../types.ts";
import {
  isMusic,
  VIDEO_INFO,
  videoInfo,
  type VideoInfo,
} from "../video/info.ts";
import { levelMarkdown, writeLevel, type Level } from "./summarize.ts";

const TRANSCRIPT = "transcript.txt";

const STEPS: Record<Level, string> = {
  about: "Describing the video…",
  brief: "Writing the brief summary…",
  detailed: "Writing the detailed summary…",
};

function levelFile(dir: string, level: Level): string {
  return path.join(dir, level === "about" ? ABOUT_MD : `${level}.md`);
}

const composer = new Composer<Context>();

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
    await begin(ctx.api, ctx.match[2]!, ctx.match[1] as Level);
  },
);

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
      ask: (ctx) => begin(ctx.api, input.id, "about"),
    };
  },
};

/** The video's metadata and transcript, read once into its folder. */
async function prepare(
  id: string,
  dir: string,
  step: (text: string) => Promise<unknown>,
): Promise<{ info: VideoInfo; transcript: string }> {
  const meta = path.join(dir, META_JSON);
  let info: VideoInfo | undefined;
  if (existsSync(meta))
    info = VIDEO_INFO.parse(JSON.parse(await readFile(meta, "utf8")));
  else {
    info = await videoInfo(id);
    if (!info) throw new Error("Couldn't read the video on YouTube");
    await mkdir(dir, { recursive: true });
    await writeFile(meta, JSON.stringify(info, null, 1));
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
    info,
    transcript: await readFile(path.join(dir, TRANSCRIPT), "utf8"),
  };
}

/** Writes `level` of video `id` in the background, unless it is written already; then delivers it. Progress goes to the owner's chat. */
async function begin(api: Api, id: string, level: Level): Promise<void> {
  const chatId = config.ownerId;
  const dir = path.join(SUMMARY_DIR, id);
  if (existsSync(levelFile(dir, level))) return deliver(api, chatId, id, level);
  const work = async () => {
    const status = await api.sendMessage(
      chatId,
      `📝 ${bold("Getting the transcript…")}`,
      HTML,
    );
    const step = (text: string) =>
      api
        .editMessageText(chatId, status.message_id, `📝 ${bold(text)}`, HTML)
        .catch(() => {});
    try {
      const { info, transcript } = await prepare(id, dir, step);
      await step(STEPS[level]);
      const reply = await writeLevel(level, info, transcript);
      await writeFile(
        levelFile(dir, level),
        level === "about"
          ? `${reply.trim()}\n`
          : levelMarkdown(info, id, level, reply),
      );
    } finally {
      await api.deleteMessage(chatId, status.message_id).catch(() => {});
    }
    await deliver(api, chatId, id, level);
  };
  const failed = (error: unknown) =>
    notify(
      api,
      chatId,
      error instanceof LimitError
        ? `⚠️ ${bold("Hit the Claude usage limit")}\nTry again after ${error.resetAt.toTimeString().slice(0, 5)}.`
        : `⚠️ ${bold("Summary failed")}\n${problem(error)}`,
    );
  if (!startJob("video summary", work, failed))
    await notify(api, chatId, busyHtml());
}

/**
 * With a library group: `Done → <link>` to the level's message in the Summary topic. Without one the level itself
 * here: the description with its buttons, or the .md.
 */
export async function deliver(
  api: Api,
  chatId: number,
  id: string,
  level: Level,
  root = SUMMARY_DIR,
): Promise<void> {
  const synced = await syncSummaries(api);
  if (synced) {
    const link = synced.link(`${id}/${level}`);
    if (link) await notify(api, chatId, `✅ ${bold("Done")} → ${escape(link)}`);
    return;
  }
  const item = (await summaryItems(root)).find(
    (i) => i.key === `${id}/${level}`,
  );
  if (item?.kind === "text")
    await api
      .sendMessage(chatId, item.text, { ...HTML, reply_markup: keyboard(item) })
      .catch(console.error);
  else if (item)
    await api
      .sendDocument(chatId, new InputFile(item.file, item.name))
      .catch((error) =>
        notify(
          api,
          chatId,
          `⚠️ ${bold("Couldn't send the summary")}\n${problem(error)}`,
        ),
      );
}
