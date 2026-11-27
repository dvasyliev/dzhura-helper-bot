import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Api } from "grammy";
import { z } from "zod";
import type { Language } from "../book/language.ts";
import { readdirEntriesOrEmpty, statOrUndefined } from "../fs/absent.ts";
import { readJsonOrUndefined } from "../fs/json.ts";
import { MAX_NAME_CHARS, safeFilename } from "../shelf/names.ts";
import { bold, escape } from "../text/format.ts";
import { statusText, withLanguage } from "../text/status.ts";
import { summaryVoices, type Voice } from "../tts/voice.ts";
import { aboutMessage } from "../video/summary.ts";
import { VIDEO_INFO, type VideoInfo } from "../video/info.ts";
import { contentsItem, coverUrl } from "./contents.ts";
import { withGroup } from "./group.ts";
import type { Item } from "./reconcile.ts";
import { LIBRARY_FILE, type LibraryState } from "./state.ts";
import {
  syncTopic,
  TOPIC_ICONS,
  type Synced,
  type SyncOptions,
} from "./topic/topic.ts";

const SUMMARY_TOPIC = "summary";
const TOPIC = { name: "Summary", icon: TOPIC_ICONS.summary };

/**
 * One folder per video, «Channel - Title» like the karaoke songs: meta.json (its VideoInfo and YouTube id),
 * transcript.txt, about.md, and brief.md, detailed.md once asked for.
 */
export const SUMMARY_DIR = "data/summary";
const META_JSON = "meta.json";
export const ABOUT_MD = "about.md";

/** A video folder's meta.json: the folder is found by the id in it. */
const SUMMARY_META = VIDEO_INFO.extend({ id: z.string() });
type SummaryMeta = z.infer<typeof SUMMARY_META>;

/** «Channel - Title», or the title alone; safe as a folder name. */
export function videoFolderName(info: VideoInfo): string {
  const name = info.channel ? `${info.channel} - ${info.title}` : info.title;
  // A leading «.» would hide the folder.
  return safeFilename(name)
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, MAX_NAME_CHARS)
    .trim();
}

/** Each video folder in `root` with its meta.json; folders without a valid one are left out. */
async function videoFolders(
  root: string,
): Promise<{ dir: string; info: SummaryMeta }[]> {
  const entries = await readdirEntriesOrEmpty(root);
  const folders = [];
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const dir = path.join(root, entry.name);
    const info = await readJsonOrUndefined(
      path.join(dir, META_JSON),
      SUMMARY_META,
    );
    if (info) folders.push({ dir, info });
  }
  return folders;
}

/** The folder of video `id` and its metadata, if it was read before. */
export async function findVideo(
  id: string,
  root: string = SUMMARY_DIR,
): Promise<{ dir: string; info: SummaryMeta } | undefined> {
  return (await videoFolders(root)).find((f) => f.info.id === id);
}

/** Makes video `id`'s folder with its meta.json; another video of the same name gets its id after it. */
export async function newVideoDir(
  id: string,
  info: VideoInfo,
  root: string = SUMMARY_DIR,
): Promise<string> {
  let dir = path.join(root, videoFolderName(info));
  if (await statOrUndefined(dir)) dir += ` (${id})`;
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, META_JSON),
    JSON.stringify({ id, ...info }, null, 1),
  );
  return dir;
}

/** The levels made on request. */
const FILE_LEVELS = ["brief", "detailed"] as const;
export type FileLevel = (typeof FILE_LEVELS)[number];

const LEVEL_LABELS: Record<FileLevel, string> = {
  brief: "Brief",
  detailed: "Detailed",
};

/** The pinned first message: each video's title, a link to its description once it is posted. */
function contents(
  videos: { id: string; title: string }[],
  link: (key: string) => string | undefined,
): Item {
  const lines = videos.map(({ id, title }) => {
    const url = link(`${id}/about`);
    return url
      ? `• <a href="${escape(url)}">${escape(title)}</a>`
      : `• ${escape(title)}`;
  });
  return contentsItem(
    `📝 ${bold("Summary")} · ${videos.length} videos\n`,
    lines,
  );
}

/** Keys (`<id>/summary`, `<id>/audio`) of the slots being made now, each with what it shows meanwhile; in memory, so a restart clears them. */
const making = new Map<string, string>();

/** Marks slot `key` as being made (its placeholder reads «⏳ `label`…»), or no longer. */
export function setMaking(key: string, on: boolean, label = ""): void {
  if (on) making.set(key, label);
  else making.delete(key);
}

/** Whether slot `key` is being made now. */
export function isMaking(key: string): boolean {
  return making.has(key);
}

/** How a button names a language. */
const LANGUAGE_LABELS: Record<Language, string> = { uk: "UA", en: "EN" };

/** The languages a summary of the video can be written and voiced in: Ukrainian, and English for an English video. */
export function videoLanguages(info: { language?: string }): Language[] {
  return info.language?.split("-")[0] === "en" ? ["uk", "en"] : ["uk"];
}

/** A level's text in `language`: «brief.md» in Ukrainian, «brief.en.md» in English. */
export function levelFile(
  dir: string,
  level: FileLevel,
  language: Language,
): string {
  return path.join(
    dir,
    language === "uk" ? `${level}.md` : `${level}.${language}.md`,
  );
}

/** The audio of `level` voiced by `voice`: «<level> - <Voice>.mp3» (voice.py writes «.part» first). */
export function voiceFile(dir: string, level: FileLevel, voice: Voice): string {
  return path.join(dir, `${level} - ${voice.name}.mp3`);
}

/** One summary of a video: a level in a language. */
export type Version = { level: FileLevel; language: Language };
/** The version the slots show, and the voice of the audio once voiced. */
export type Shown = Version & { voice?: string };

/** The versions a video can have, in the order the menu lists them and a folder falls back to. */
function versions(languages: Language[]): Version[] {
  return FILE_LEVELS.flatMap((level) =>
    languages.map((language) => ({ level, language })),
  );
}

/** «Brief», or «Brief (EN)» for a video in two languages. */
function versionLabel(version: Version, languages: Language[]): string {
  const name = LEVEL_LABELS[version.level];
  return languages.length > 1
    ? `${name} (${LANGUAGE_LABELS[version.language]})`
    : name;
}

/** «Brief Summary (UA)», «Detailed Audio (EN)»: a version's file named in the slot, the caption and the status. */
export function versionName(
  version: Version,
  kind: "Summary" | "Audio",
): string {
  return withLanguage(
    `${LEVEL_LABELS[version.level]} ${kind}`,
    version.language,
  );
}

/** shown.json: the version the slots show (every version stays on disk). */
const SHOWN_JSON = "shown.json";
const SHOWN = z.object({
  level: z.enum(FILE_LEVELS),
  language: z.enum(["uk", "en"]),
  voice: z.string().optional(),
});

/** The summary voice of `version`'s language voiced already, the one of `gender` first. */
export async function audioOf(
  dir: string,
  version: Version,
  gender?: Voice["gender"],
): Promise<{ file: string; voice: Voice } | undefined> {
  const voices = summaryVoices(version.language).sort(
    (a, b) => Number(b.gender === gender) - Number(a.gender === gender),
  );
  for (const voice of voices) {
    const file = voiceFile(dir, version.level, voice);
    if (await statOrUndefined(file)) return { file, voice };
  }
  return undefined;
}

/**
 * The version the slots show: the one saved in shown.json while its text is there, else the first written (an old
 * shown.json had one per level) with its first audio; none before a summary is written.
 */
export async function shownSummary(
  dir: string,
  info: { language?: string },
): Promise<Shown | undefined> {
  const saved = SHOWN.safeParse(
    await readJsonOrUndefined(path.join(dir, SHOWN_JSON), z.unknown()),
  );
  const written = (v: Version) =>
    statOrUndefined(levelFile(dir, v.level, v.language));
  if (saved.success && (await written(saved.data))) return saved.data;
  for (const version of versions(videoLanguages(info)))
    if (await written(version))
      return { ...version, voice: (await audioOf(dir, version))?.voice.name };
  return undefined;
}

/** Makes the slots show `shown`. */
export async function showSummary(dir: string, shown: Shown): Promise<void> {
  await writeFile(path.join(dir, SHOWN_JSON), JSON.stringify(shown, null, 1));
}

type Button = { text: string; data: string };

/** The card's row of buttons: the summary menu, and the audio menu once a summary is shown. */
export function cardButtons(id: string, shown: boolean): Button[] {
  return [
    { text: "📝 Summary", data: `summary:text:${id}` },
    ...(shown ? [{ text: "🎧 Audio", data: `summary:audio:${id}` }] : []),
  ];
}

/** A menu's rows that are left, then «← Back» to the card's buttons. */
function menu(id: string, rows: Button[][]): Button[][] {
  return [
    ...rows.filter((row) => row.length),
    [{ text: "← Back", data: `summary:back:${id}` }],
  ];
}

/** The summary menu: each version but the shown one, a row per level (one row for a video in one language). */
export function summaryMenu(
  id: string,
  languages: Language[],
  shown?: Version,
): Button[][] {
  const buttons = (level?: FileLevel) =>
    versions(languages)
      .filter((v) => !level || v.level === level)
      .filter((v) => v.level !== shown?.level || v.language !== shown.language)
      .map((v) => ({
        text: versionLabel(v, languages),
        data: `summary:pick:${id}:${v.level}:${v.language}`,
      }));
  return menu(
    id,
    languages.length > 1 ? FILE_LEVELS.map(buttons) : [buttons()],
  );
}

/** The audio menu: the summary voices of the shown language but the one playing, as a woman or a man. */
export function audioMenu(id: string, shown: Shown): Button[][] {
  const label = { woman: "👩 Woman", man: "👨 Man" };
  return menu(id, [
    summaryVoices(shown.language)
      .filter((v) => v.name !== shown.voice)
      .map((v) => ({
        text: `${label[v.gender]} (${LANGUAGE_LABELS[v.language]})`,
        data: `summary:voice:${id}:${v.name}`,
      })),
  ]);
}

/**
 * The video's two slots: the shown summary's document and its audio, each a placeholder until made, «⏳» while
 * made; the file takes the placeholder's message, so nothing below it moves.
 */
async function slotItems(
  dir: string,
  info: { id: string; title: string; channel?: string; language?: string },
  shown: Shown | undefined,
): Promise<Item[]> {
  const summaryKey = `${info.id}/summary`;
  const audioKey = `${info.id}/audio`;
  const placeholder = (key: string, text: string, busy: string): Item => ({
    key,
    kind: "text",
    text: making.has(key)
      ? statusText("processing", making.get(key) || busy)
      : text,
  });
  const md = shown && levelFile(dir, shown.level, shown.language);
  const mdStats = md && (await statOrUndefined(md));
  if (!shown || !md || !mdStats)
    return [
      placeholder(summaryKey, "📝 Summary", "Summary"),
      placeholder(audioKey, "🎧 Audio", "Audio"),
    ];
  const label = versionLabel(shown, videoLanguages(info));
  const title = `${label}: ${info.title}`;
  // The colon stays: Telegram and macOS take it in a file name.
  const name = `${label}: ${safeFilename(info.title)}`;
  const document: Item = {
    key: summaryKey,
    kind: "document",
    file: md,
    name: `${name}.md`,
    size: mdStats.size,
    mtime: mdStats.mtimeMs,
    caption: making.has(summaryKey)
      ? statusText("processing", making.get(summaryKey) || "Summary")
      : `📝 ${bold(versionName(shown, "Summary"))}`,
  };
  const voice = summaryVoices(shown.language).find(
    (v) => v.name === shown.voice,
  );
  const mp3 = voice && voiceFile(dir, shown.level, voice);
  const mp3Stats = mp3 && (await statOrUndefined(mp3));
  const audio: Item =
    mp3 && mp3Stats
      ? {
          key: audioKey,
          kind: "audio",
          file: mp3,
          name: `${name}.mp3`,
          title,
          performer: info.channel ?? info.title,
          size: mp3Stats.size,
          mtime: mp3Stats.mtimeMs,
          caption: making.has(audioKey)
            ? statusText("processing", making.get(audioKey) || "Audio")
            : `🎧 ${bold(versionName(shown, "Audio"))}`,
        }
      : placeholder(audioKey, "🎧 Audio", "Audio");
  return [document, audio];
}

/** Where the summaries and the library state live; tests point them at a temp dir. */
type Dirs = { summary: string; state: string };

const DIRS: Dirs = { summary: SUMMARY_DIR, state: LIBRARY_FILE };

/** Each described video, oldest first: its card (description under its cover, with its buttons), then its two slots. */
export async function summaryItems(
  dir: string = SUMMARY_DIR,
  link: (key: string) => string | undefined = () => undefined,
): Promise<Item[]> {
  const videos = [];
  for (const { dir: folder, info } of await videoFolders(dir)) {
    const about = path.join(folder, ABOUT_MD);
    const stats = await statOrUndefined(about);
    if (stats)
      videos.push({
        id: info.id,
        folder,
        about,
        at: stats.mtimeMs,
        title: info.title,
        info,
      });
  }
  videos.sort((a, b) => a.at - b.at);
  const items: Item[] = [contents(videos, link)];
  for (const { id, folder, about, title, info } of videos) {
    const shown = await shownSummary(folder, info);
    items.push(
      {
        key: `${id}/about`,
        kind: "text",
        text: aboutMessage(title, id, await readFile(about, "utf8")),
        preview: coverUrl(id),
        buttons: cardButtons(id, !!shown),
      },
      ...(await slotItems(folder, info, shown)),
    );
  }
  return items;
}

/**
 * Each video had a document and an audio message per level; now it has one slot of each. The brief's messages become
 * the slots and the detailed ones go (their files stay on disk), so every other message keeps its place.
 */
async function migrateSlots(api: Api, state: LibraryState): Promise<void> {
  const topic = state.topics[SUMMARY_TOPIC];
  if (!topic || state.chatId === undefined) return;
  const chatId = state.chatId;
  const kept = [];
  for (const message of topic.messages) {
    const [id, level, part] = message.key.split("/");
    if (level === "detailed" || part === "title") {
      await api.deleteMessage(chatId, message.messageId).catch((error) => {
        console.error(
          `Deleting summary message ${message.messageId} failed:`,
          error,
        );
      });
      continue;
    }
    if (level === "brief") message.key = part ? `${id}/audio` : `${id}/summary`;
    kept.push(message);
  }
  topic.messages = kept;
}

/** Syncs the summary topic (`probe`: see `syncTopic`); undefined = no group. */
export async function syncSummaries(
  api: Api,
  dirs: Dirs = DIRS,
  options: SyncOptions = {},
): Promise<Synced | undefined> {
  return withGroup(
    api,
    async (state) => {
      await migrateSlots(api, state);
      const sync = (items: Item[]) =>
        syncTopic(api, state, SUMMARY_TOPIC, TOPIC, items, dirs.state, options);
      const synced = await sync(await summaryItems(dirs.summary));
      // The contents links the descriptions, known only once they are posted: a second pass edits it.
      const again = await sync(await summaryItems(dirs.summary, synced.link));
      return {
        ...again,
        changed: [...new Set([...synced.changed, ...again.changed])],
      };
    },
    dirs.state,
  );
}
