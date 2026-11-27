import { Composer, InlineKeyboard, type Api, type Context } from "grammy";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { aiMeter, reportAi, spentText } from "../../lib/claude/ai-usage.ts";
import { statOrUndefined } from "../../lib/fs/absent.ts";
import { ownerId } from "../../lib/telegram/owner.ts";
import { bold, problem } from "../../lib/text/format.ts";
import { statusText } from "../../lib/text/status.ts";
import { busyHtml, startJob } from "../../lib/jobs/jobs.ts";
import { z } from "zod";
import { runPython } from "../../lib/python/python.ts";
import { notify } from "../../lib/telegram/notify.ts";
import {
  summaryVoices,
  voiceChapters,
  VOICES,
  type Voice,
} from "../../lib/tts/voice.ts";
import type { Language } from "../../lib/book/language.ts";
import {
  ABOUT_MD,
  audioMenu,
  audioOf,
  cardButtons,
  findVideo,
  type FileLevel,
  isMaking,
  levelFile as levelText,
  newVideoDir,
  setMaking,
  showSummary,
  shownSummary,
  summaryMenu,
  syncSummaries,
  videoLanguages,
  versionName,
  voiceFile,
  type Shown,
  type Version,
} from "../../lib/library/summary.ts";
import { LimitError, runClaude } from "../../lib/claude/claude.ts";
import type { Feature } from "../../lib/feature/types.ts";
import { isMusic, videoInfo, type VideoInfo } from "../../lib/video/info.ts";
import { deliver, deliverLater, type Delivered } from "./deliver.ts";
import { speechText } from "./speech.ts";
import { status, type Line } from "./status.ts";
import { levelMarkdown, writeLevel, type Level } from "./summarize.ts";

const TRANSCRIPT = "transcript.txt";
/** What dzhura_helper_bot.summary.transcript prints: «whisper» before it listens, then where the text came from. */
const TRANSCRIPT_EVENT = z.union([
  z.object({ step: z.literal("whisper") }),
  z.object({ source: z.string() }),
]);

/** The description's name in the status; a summary's comes from its version (see versionName). */
const DESCRIPTION = "Video Description";

/** How an operation is named in the AI usage history. */
const OPERATIONS: Record<Level, string> = {
  about: "📝 Video description",
  brief: "📋 Brief summary",
  detailed: "📖 Detailed summary",
};

const ID = "([\\w-]{11})";

type Button = { text: string; data: string };

/** Puts `rows` in place of the pressed message's buttons: a menu, or back to the card's. */
async function showButtons(ctx: Context, rows: Button[][]): Promise<void> {
  const markup = InlineKeyboard.from(
    rows.map((row) => row.map((b) => InlineKeyboard.text(b.text, b.data))),
  );
  await ctx
    .editMessageReplyMarkup({ reply_markup: markup })
    .catch((error: unknown) =>
      console.error("Editing the summary buttons failed:", error),
    );
}

/** The video's folder, metadata and shown version; undefined before it is described. */
async function video(id: string) {
  const found = await findVideo(id);
  return (
    found && { ...found, shown: await shownSummary(found.dir, found.info) }
  );
}

/** Whether a slot of video `id` is being made: a pick now would be undone when it is done. */
const busy = (id: string) =>
  isMaking(`${id}/summary`) || isMaking(`${id}/audio`);

const composer = new Composer<Context>();

// On the card: the summary menu, the audio menu, and back to the card's buttons.
composer.callbackQuery(new RegExp(`^summary:text:${ID}$`), async (ctx) => {
  await ctx.answerCallbackQuery();
  const found = await video(ctx.match[1]!);
  if (found)
    await showButtons(
      ctx,
      summaryMenu(found.info.id, videoLanguages(found.info), found.shown),
    );
});

composer.callbackQuery(new RegExp(`^summary:audio:${ID}$`), async (ctx) => {
  const found = await video(ctx.match[1]!);
  if (!found?.shown) return ctx.answerCallbackQuery("Make a summary first");
  await ctx.answerCallbackQuery();
  await showButtons(ctx, audioMenu(found.info.id, found.shown));
});

composer.callbackQuery(new RegExp(`^summary:back:${ID}$`), async (ctx) => {
  await ctx.answerCallbackQuery();
  const id = ctx.match[1]!;
  await showButtons(ctx, [cardButtons(id, !!(await video(id))?.shown)]);
});

// In the menus: a version to show, or a voice for the shown one; the menu closes at once, the work goes on.
composer.callbackQuery(
  new RegExp(`^summary:pick:${ID}:(brief|detailed):(uk|en)$`),
  async (ctx) => {
    const id = ctx.match[1]!;
    if (busy(id)) return ctx.answerCallbackQuery("Already working on it");
    await ctx.answerCallbackQuery();
    await showButtons(ctx, [cardButtons(id, true)]);
    await show(ctx.api, id, {
      version: {
        level: ctx.match[2] as FileLevel,
        language: ctx.match[3] as Language,
      },
    });
  },
);

composer.callbackQuery(
  new RegExp(`^summary:voice:${ID}:(\\w+)$`),
  async (ctx) => {
    const id = ctx.match[1]!;
    const voice = VOICES.find((v) => v.summaryTempo && v.name === ctx.match[2]);
    if (!voice) return ctx.answerCallbackQuery("Unknown voice");
    if (busy(id)) return ctx.answerCallbackQuery("Already working on it");
    await ctx.answerCallbackQuery();
    await showButtons(ctx, [cardButtons(id, true)]);
    await show(ctx.api, id, { voice });
  },
);

// From the link's card: the description.
composer.callbackQuery(new RegExp(`^summary:${ID}$`), async (ctx) => {
  await ctx.answerCallbackQuery();
  await describe(ctx.api, ctx.match[1]!);
});

// Buttons of earlier layouts, still under old messages in the chat.
composer.callbackQuery(/^summary:/, (ctx) =>
  ctx.answerCallbackQuery("This button is outdated"),
);

export const summary: Feature = {
  id: "summary",
  title: "📝 YouTube summary",
  hint: `📝 ${bold("YouTube summary")}\nSend a YouTube link (not a music clip) and I'll describe it in Ukrainian; a summary and its audio are a button away.`,
  composer,
  actions: async (input) => {
    if (input.kind !== "youtube") return;
    // A music clip gets karaoke instead.
    const info = await videoInfo(input.id);
    if (info && isMusic(info)) return;
    return {
      buttons: [{ text: "📝 Summary", data: `summary:${input.id}` }],
      ask: async (ctx) => {
        await describe(ctx.api, input.id);
      },
    };
  },
};

/** The video's folder, metadata and transcript, read once into that folder. */
async function prepare(
  id: string,
  line: Line,
): Promise<{ dir: string; info: VideoInfo; transcript: string }> {
  const found = await findVideo(id);
  let dir = found?.dir;
  let info: VideoInfo | undefined = found?.info;
  if (!dir || !info) {
    info = await videoInfo(id);
    if (!info) throw new Error("Couldn't read the video on YouTube");
    dir = await newVideoDir(id, info);
  }
  line.title(info.title);
  await line.step("Transcript");
  if (!(await statOrUndefined(path.join(dir, TRANSCRIPT))))
    for await (const event of runPython(
      "dzhura_helper_bot.summary.transcript",
      { id, dir },
      { schema: TRANSCRIPT_EVENT, background: true },
    ))
      if ("step" in event)
        await line.step("Transcript", "No subtitles, listening to the video…");
  return {
    dir,
    info,
    transcript: await readFile(path.join(dir, TRANSCRIPT), "utf8"),
  };
}

/** Runs `work` as the one job, telling the owner when it fails or another job is running. */
async function run(
  api: Api,
  work: () => Promise<void>,
  undo: () => Promise<void> = async () => {},
  failing: { what: string; title?: string } = { what: DESCRIPTION },
): Promise<void> {
  const chatId = ownerId();
  const failed = async (error: unknown) => {
    await undo();
    await notify(
      api,
      chatId,
      error instanceof LimitError
        ? `⚠️ ${bold("Hit the Claude usage limit")}\nTry again after ${error.resetAt.toTimeString().slice(0, 5)}.`
        : `${statusText("failed", failing.what, failing.title)}\n${problem(error)}`,
    );
  };
  if (!startJob("video summary", work, failed))
    await notify(api, chatId, busyHtml());
}

/** Describes video `id` (its card), unless it is described already: then the card is delivered again. */
async function describe(api: Api, id: string): Promise<void> {
  const found = await findVideo(id);
  if (found && (await statOrUndefined(path.join(found.dir, ABOUT_MD))))
    return deliverLater(api, id, ["about"]);
  await run(api, async () => {
    const line = await status(api);
    try {
      await write(api, id, "about", "uk", line);
    } finally {
      await line.done();
    }
  });
}

/**
 * Makes video `id` show `target.version` and/or voice its shown version with `target.voice`; a version or audio on
 * disk shows at once, the rest is written and voiced in the background with ⏳ in its slot. The audio follows a
 * switch: the new version's audio of the same kind of voice, else a voicing of it (Telegram cannot turn an audio
 * back into a placeholder) when audio was shown, else the placeholder.
 */
async function show(
  api: Api,
  id: string,
  target: { version?: Version; voice?: Voice },
): Promise<void> {
  const found = await video(id);
  const version = target.version ?? found?.shown;
  if (!found || !version) return;
  const { dir, shown: before } = found;
  const written = !!(await statOrUndefined(
    levelText(dir, version.level, version.language),
  ));
  const playing = summaryVoices(before?.language ?? "uk").find(
    (v) => v.name === before?.voice,
  );
  // The picked voice, else the new version's audio of the kind playing now, else that kind to voice it.
  const audio = target.voice
    ? undefined
    : await audioOf(dir, version, playing?.gender);
  const voice =
    target.voice ??
    audio?.voice ??
    (playing &&
      summaryVoices(version.language).find((v) => v.gender === playing.gender));
  const voiced =
    !!voice && !!(await statOrUndefined(voiceFile(dir, version.level, voice)));
  const toVoice = voiced ? undefined : voice;
  const next: Shown = {
    ...version,
    ...(voice && voiced ? { voice: voice.name } : {}),
  };
  const parts: Delivered[] = [
    ...(target.version ? (["summary"] as const) : []),
    ...(voiced ? (["audio"] as const) : []),
  ];
  if (written && !toVoice) {
    await showSummary(dir, next);
    return deliverLater(api, id, parts);
  }
  const keys = { summary: `${id}/summary`, audio: `${id}/audio` };
  const work = async () => {
    // The slots show ⏳; a written version shows at once.
    if (!written)
      setMaking(keys.summary, true, versionName(version, "Summary"));
    if (toVoice) setMaking(keys.audio, true, versionName(version, "Audio"));
    if (written) await showSummary(dir, next);
    const synced = await syncSummaries(api).catch(console.error);
    const line = await status(
      api,
      found.info.title,
      synced?.link(`${id}/about`),
    );
    try {
      if (!written) await write(api, id, version, version.language, line);
      if (toVoice) {
        await line.step(versionName(version, "Audio"));
        const started = Date.now();
        await speak(dir, version, toVoice);
        setMaking(keys.audio, false);
        const link = await deliver(
          api,
          ownerId(),
          id,
          "audio",
          undefined,
          false,
        );
        await line.finish(
          versionName(version, "Audio"),
          link,
          spentText({ ms: Date.now() - started }),
        );
      }
    } finally {
      setMaking(keys.audio, false);
      await line.done();
    }
  };
  await run(
    api,
    work,
    async () => {
      // The slots show what they showed before, without ⏳.
      if (before) await showSummary(dir, before);
      setMaking(keys.summary, false);
      setMaking(keys.audio, false);
      await syncSummaries(api).catch(console.error);
    },
    {
      what: versionName(version, written ? "Audio" : "Summary"),
      title: found.info.title,
    },
  );
}

/** Writes the description or a version of video `id` with Claude, shows and delivers it, and records the AI usage. */
async function write(
  api: Api,
  id: string,
  what: "about" | Version,
  language: Language,
  line: Line,
): Promise<void> {
  const level: Level = what === "about" ? "about" : what.level;
  const name = what === "about" ? DESCRIPTION : versionName(what, "Summary");
  const meter = aiMeter();
  let title = id;
  try {
    const { dir, info, transcript } = await prepare(id, line);
    title = info.title;
    await line.step(name);
    const reply = await writeLevel(
      level,
      info,
      transcript,
      (prompt, input) => runClaude(prompt, input, meter.add),
      language,
    );
    await writeFile(
      what === "about"
        ? path.join(dir, ABOUT_MD)
        : levelText(dir, what.level, language),
      what === "about"
        ? `${reply.trim()}\n`
        : levelMarkdown(info, id, what.level, reply, language),
    );
    if (what !== "about") await showSummary(dir, what);
  } finally {
    setMaking(`${id}/summary`, false);
  }
  const link = await deliver(
    api,
    ownerId(),
    id,
    what === "about" ? "about" : "summary",
    undefined,
    false,
  );
  const label = language === "uk" ? "" : ` (${language.toUpperCase()})`;
  const record = meter.record(`${OPERATIONS[level]}${label} · ${title}`, link);
  await line.finish(name, link, spentText(record));
  await reportAi(record, { message: false });
}

/** Voices `version` of the video in `dir` with `voice` into «<level> - <Voice>.mp3» at the voice's summary tempo, and shows it. */
async function speak(
  dir: string,
  version: Version,
  voice: Voice,
): Promise<void> {
  const speech = path.join(dir, "speech");
  const md = await readFile(
    levelText(dir, version.level, version.language),
    "utf8",
  );
  for await (const event of voiceChapters({
    voice,
    textDir: speech,
    audioDir: dir,
    dictionary: path.join(speech, "dictionary.txt"),
    chapters: [
      {
        index: 0,
        name: `${version.level} - ${voice.name}`,
        text: speechText(md),
      },
    ],
    tempo: voice.summaryTempo,
    oneFile: true,
  }))
    if ("error" in event && event.error) throw new Error(event.error);
  await showSummary(dir, { ...version, voice: voice.name });
}
