import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Api } from "grammy";
import { safeFilename } from "../audiobook/text.ts";
import { aboutMessage, LEVEL_NAMES } from "../summary/summarize.ts";
import { VIDEO_INFO } from "../video/info.ts";
import { withGroup } from "./group.ts";
import type { FileItem, Item } from "./reconcile.ts";
import { LIBRARY_FILE } from "./state.ts";
import { syncTopic, type Synced } from "./topic.ts";

const SUMMARY_TOPIC = "summary";
const TOPIC_NAME = "📝 Summary";

/** One folder per video id: meta.json (its VideoInfo), transcript.txt, about.md, and brief.md, detailed.md once asked for. */
export const SUMMARY_DIR = "data/summary";
export const META_JSON = "meta.json";
export const ABOUT_MD = "about.md";

/** The levels made on request, in the order their files are posted. */
const FILE_LEVELS = ["brief", "detailed"] as const;
type FileLevel = (typeof FILE_LEVELS)[number];

const BUTTONS: Record<FileLevel, string> = {
  brief: "📋 Стисло",
  detailed: "📖 Детально",
};

/** The button that makes `level` of video `id`. */
function levelButton(
  id: string,
  level: FileLevel,
): { text: string; data: string } {
  return { text: BUTTONS[level], data: `summary:${level}:${id}` };
}

/** Where the summaries and the library state live; tests point them at a temp dir. */
type Dirs = { summary: string; state: string };

const DIRS: Dirs = { summary: SUMMARY_DIR, state: LIBRARY_FILE };

/** The description of a described video, with the buttons for the levels not made yet, then its level files; oldest first. */
export async function summaryItems(dir: string = SUMMARY_DIR): Promise<Item[]> {
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
  const items: Item[] = [];
  for (const { id, about, title } of videos) {
    const files: FileItem[] = [];
    const missing: FileLevel[] = [];
    for (const level of FILE_LEVELS) {
      const file = path.join(dir, id, `${level}.md`);
      const stats = await stat(file).catch(() => undefined);
      if (!stats) {
        missing.push(level);
        continue;
      }
      files.push({
        key: `${id}/${level}`,
        kind: "document",
        file,
        name: `${safeFilename(title)} (${LEVEL_NAMES[level].toLowerCase()}).md`,
        size: stats.size,
        mtime: stats.mtimeMs,
      });
    }
    const text = aboutMessage(title, id, await readFile(about, "utf8"));
    items.push(
      {
        key: `${id}/about`,
        kind: "text",
        text,
        ...(missing.length
          ? { buttons: missing.map((level) => levelButton(id, level)) }
          : {}),
      },
      ...files,
    );
  }
  return items;
}

/** Syncs the summary topic (`probe`: see `syncTopic`); undefined = no group. */
export async function syncSummaries(
  api: Api,
  dirs: Dirs = DIRS,
  options: { probe?: boolean } = {},
): Promise<Synced | undefined> {
  return withGroup(
    api,
    async (state) =>
      syncTopic(
        api,
        state,
        SUMMARY_TOPIC,
        TOPIC_NAME,
        await summaryItems(dirs.summary),
        dirs.state,
        options,
      ),
    dirs.state,
  );
}
