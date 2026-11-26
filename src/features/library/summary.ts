import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Api } from "grammy";
import { bold, escape } from "../../format.ts";
import { safeFilename } from "../audiobook/text.ts";
import { aboutMessage, LEVEL_NAMES } from "../summary/summarize.ts";
import { VIDEO_INFO } from "../video/info.ts";
import { withGroup } from "./group.ts";
import type { Item } from "./reconcile.ts";
import { LIBRARY_FILE } from "./state.ts";
import { syncTopic, type Synced, type SyncOptions } from "./topic.ts";

const SUMMARY_TOPIC = "summary";
const TOPIC_NAME = "📝 Summary";

/** One folder per video id: meta.json (its VideoInfo), transcript.txt, about.md, and brief.md, detailed.md once asked for. */
export const SUMMARY_DIR = "data/summary";
export const META_JSON = "meta.json";
export const ABOUT_MD = "about.md";

/** The levels made on request, in the order their files are posted. */
const FILE_LEVELS = ["brief", "detailed"] as const;
type FileLevel = (typeof FILE_LEVELS)[number];

const LEVELS: Record<FileLevel, { icon: string; name: string }> = {
  brief: { icon: "📋", name: "Brief summary" },
  detailed: { icon: "📖", name: "Detailed summary" },
};

/** The video's cover on YouTube, shown above its description. */
function coverUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
}

/** Telegram's limit for a message's visible text. */
const MAX_MESSAGE = 4096;

/** The length of Telegram HTML as shown: tags dropped, entities as one character. */
function visible(html: string): number {
  return html.replace(/<[^>]+>/g, "").replace(/&\w+;/g, "_").length;
}

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
  const head = `📝 ${bold("Summary")} · ${videos.length} videos\n`;
  // Telegram counts the visible text only: past its limit the oldest titles go, the newest stay.
  let shown = lines;
  while (shown.length && visible([head, ...shown].join("\n")) > MAX_MESSAGE)
    shown = shown.slice(1);
  return {
    key: "contents",
    kind: "text",
    text: [head, ...shown].join("\n"),
    pin: true,
  };
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

/** `level` of video `id`: its file once made, else a placeholder with the button that makes it (a clock and no button while it is made); the file takes the placeholder's message. */
async function levelItem(
  dir: string,
  id: string,
  title: string,
  level: FileLevel,
): Promise<Item> {
  const key = `${id}/${level}`;
  const { icon, name } = LEVELS[level];
  const file = path.join(dir, id, `${level}.md`);
  const stats = await stat(file).catch(() => undefined);
  if (!stats && making.has(key))
    return { key, kind: "text", text: `⏳ ${bold(name)}` };
  if (!stats)
    return {
      key,
      kind: "text",
      text: `${icon} ${bold(name)}`,
      buttons: [{ text: "Make it", data: `summary:${level}:${id}` }],
    };
  return {
    key,
    kind: "document",
    file,
    name: `${safeFilename(title)} (${LEVEL_NAMES[level].toLowerCase()}).md`,
    size: stats.size,
    mtime: stats.mtimeMs,
    caption: `${icon} ${bold(name)}`,
  };
}

/** Where the summaries and the library state live; tests point them at a temp dir. */
type Dirs = { summary: string; state: string };

const DIRS: Dirs = { summary: SUMMARY_DIR, state: LIBRARY_FILE };

/** Each described video, oldest first: its description under its cover, then each level's file or placeholder. */
export async function summaryItems(
  dir: string = SUMMARY_DIR,
  link: (key: string) => string | undefined = () => undefined,
): Promise<Item[]> {
  const ids = await readdir(dir).catch((): string[] => []);
  const videos = [];
  for (const id of ids) {
    const about = path.join(dir, id, ABOUT_MD);
    const stats = await stat(about).catch(() => undefined);
    const meta = VIDEO_INFO.safeParse(
      await readFile(path.join(dir, id, META_JSON), "utf8")
        .then((text) => JSON.parse(text) as unknown)
        .catch(() => undefined),
    );
    if (stats && meta.success)
      videos.push({ id, about, at: stats.mtimeMs, title: meta.data.title });
  }
  videos.sort((a, b) => a.at - b.at);
  const items: Item[] = [contents(videos, link)];
  for (const { id, about, title } of videos) {
    items.push({
      key: `${id}/about`,
      kind: "text",
      text: aboutMessage(title, id, await readFile(about, "utf8")),
      preview: coverUrl(id),
    });
    for (const level of FILE_LEVELS)
      items.push(await levelItem(dir, id, title, level));
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
        syncTopic(
          api,
          state,
          SUMMARY_TOPIC,
          TOPIC_NAME,
          items,
          dirs.state,
          options,
        );
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
