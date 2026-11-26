import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Api } from "grammy";
import { z } from "zod";
import { bold, escape } from "../../format.ts";
import { MAX_NAME_CHARS, safeFilename } from "../audiobook/text.ts";
import { voicesFor } from "../audiobook/voice.ts";
import { aboutMessage, LEVEL_NAMES } from "../summary/summarize.ts";
import { VIDEO_INFO, type VideoInfo } from "../video/info.ts";
import { contentsItem, coverUrl } from "./contents.ts";
import { withGroup } from "./group.ts";
import type { Item } from "./reconcile.ts";
import { LIBRARY_FILE } from "./state.ts";
import {
  syncTopic,
  TOPIC_ICONS,
  type Synced,
  type SyncOptions,
} from "./topic.ts";

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
  const names = await readdir(root).catch((): string[] => []);
  const folders = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const meta = SUMMARY_META.safeParse(
      await readFile(path.join(dir, META_JSON), "utf8")
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => undefined),
    );
    if (meta.success) folders.push({ dir, info: meta.data });
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
  if (existsSync(dir)) dir += ` (${id})`;
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, META_JSON),
    JSON.stringify({ id, ...info }, null, 1),
  );
  return dir;
}

/** The levels made on request, in the order their files are posted. */
const FILE_LEVELS = ["brief", "detailed"] as const;
export type FileLevel = (typeof FILE_LEVELS)[number];

const LEVELS: Record<FileLevel, { icon: string; name: string }> = {
  brief: { icon: "📋", name: "Brief summary" },
  detailed: { icon: "📖", name: "Detailed summary" },
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

/** Keys (`<id>/<level>`) of the levels being made now; in memory, so a restart clears them. */
const making = new Set<string>();

/** Marks level `key` as being made, or no longer. */
export function setMaking(key: string, on: boolean): void {
  if (on) making.add(key);
  else making.delete(key);
}

/** Whether level `key` is being made now. */
export function isMaking(key: string): boolean {
  return making.has(key);
}

/** The voices a summary can be voiced in: the Ukrainian ones of the audiobooks. */
export const SUMMARY_VOICES = voicesFor("uk");

/** The level's audio and its voice, once voiced: «<level> - <Voice>.mp3» (voice.py writes «.part» first). */
export async function audioFile(
  dir: string,
  level: FileLevel,
): Promise<{ file: string; voice: string } | undefined> {
  const files = await readdir(dir).catch((): string[] => []);
  for (const { name } of SUMMARY_VOICES) {
    const file = `${level} - ${name}.mp3`;
    if (files.includes(file))
      return { file: path.join(dir, file), voice: name };
  }
  return undefined;
}

/**
 * `level` of video `id` in folder `dir`: its heading, then the place of its document and the place of its audio.
 * Each place holds its file once made, else a placeholder with the buttons that make it (no buttons while it is
 * made); the file takes the placeholder's message, so nothing below it moves.
 */
async function levelItems(
  dir: string,
  id: string,
  title: string,
  level: FileLevel,
): Promise<Item[]> {
  const { icon, name } = LEVELS[level];
  const key = `${id}/${level}`;
  const heading: Item = {
    key: `${key}/title`,
    kind: "text",
    text: `${icon} ${bold(name)}`,
  };
  const fileName = `${safeFilename(title)} (${LEVEL_NAMES[level].toLowerCase()})`;

  const md = path.join(dir, `${level}.md`);
  const mdStats = await stat(md).catch(() => undefined);
  const document: Item = mdStats
    ? {
        key,
        kind: "document",
        file: md,
        name: `${fileName}.md`,
        size: mdStats.size,
        mtime: mdStats.mtimeMs,
      }
    : making.has(key)
      ? { key, kind: "text", text: "Generating document…" }
      : {
          key,
          kind: "text",
          text: "No document yet",
          buttons: [{ text: "✨ Generate", data: `summary:${level}:${id}` }],
        };

  const audioKey = `${key}/audio`;
  const voiced = await audioFile(dir, level);
  const audioStats = voiced && (await stat(voiced.file).catch(() => undefined));
  const audio: Item =
    voiced && audioStats
      ? {
          key: audioKey,
          kind: "audio",
          file: voiced.file,
          name: `${fileName}.mp3`,
          title: `${title} (${LEVEL_NAMES[level].toLowerCase()})`,
          performer: voiced.voice,
          size: audioStats.size,
          mtime: audioStats.mtimeMs,
        }
      : making.has(audioKey)
        ? { key: audioKey, kind: "text", text: "Voicing audio…" }
        : {
            key: audioKey,
            kind: "text",
            text: "No audio yet",
            buttons: SUMMARY_VOICES.map((v) => ({
              text: `🎙 ${v.name}`,
              data: `summary:voice:${level}:${id}:${v.name}`,
            })),
          };
  return [heading, document, audio];
}

/** Where the summaries and the library state live; tests point them at a temp dir. */
type Dirs = { summary: string; state: string };

const DIRS: Dirs = { summary: SUMMARY_DIR, state: LIBRARY_FILE };

/** Each described video, oldest first: its description under its cover, then each level's file or placeholder. */
export async function summaryItems(
  dir: string = SUMMARY_DIR,
  link: (key: string) => string | undefined = () => undefined,
): Promise<Item[]> {
  const videos = [];
  for (const { dir: folder, info } of await videoFolders(dir)) {
    const about = path.join(folder, ABOUT_MD);
    const stats = await stat(about).catch(() => undefined);
    if (stats)
      videos.push({
        id: info.id,
        folder,
        about,
        at: stats.mtimeMs,
        title: info.title,
      });
  }
  videos.sort((a, b) => a.at - b.at);
  const items: Item[] = [contents(videos, link)];
  for (const { id, folder, about, title } of videos) {
    items.push({
      key: `${id}/about`,
      kind: "text",
      text: aboutMessage(title, id, await readFile(about, "utf8")),
      preview: coverUrl(id),
    });
    for (const level of FILE_LEVELS)
      items.push(...(await levelItems(folder, id, title, level)));
  }
  return items;
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
