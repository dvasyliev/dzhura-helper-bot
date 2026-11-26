import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Api } from "grammy";
import type { Version } from "../karaoke/pipeline.ts";
import { uploads } from "../karaoke/youtube.ts";
import { withGroup } from "./group.ts";
import type { Item } from "./reconcile.ts";
import { LIBRARY_FILE } from "./state.ts";
import { syncTopic, type Synced } from "./topic.ts";

const KARAOKE_TOPIC = "karaoke";
const TOPIC_NAME = "🎤 Karaoke";

export type Song = {
  folder: string;
  id: string;
  meta: { duration: number; width: number; height: number };
  files: Partial<
    Record<Version, { file: string; size: number; mtime: number }>
  >;
};

/** The name each version has in the file name and the YouTube title. */
export const VERSION_NAMES: Record<Version, string> = {
  music: "Karaoke",
  vocals: "Vocals",
};

const VERSIONS = Object.keys(VERSION_NAMES) as Version[];

/** Where the songs, the YouTube uploads and the library state live; tests point them at a temp dir. */
type Dirs = { karaoke: string; youtube: string; state: string };

const DIRS: Dirs = {
  karaoke: "data/karaoke",
  youtube: "data/youtube.json",
  state: LIBRARY_FILE,
};

/** Songs in data/karaoke with meta.json and at least one current version file. */
export async function songs(dir: string = DIRS.karaoke): Promise<Song[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const result: Song[] = [];
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const folder = entry.name;
    const meta = await readFile(path.join(dir, folder, "meta.json"), "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => undefined);
    if (!meta) continue;
    const files: Song["files"] = {};
    for (const version of VERSIONS) {
      const file = path.join(
        dir,
        folder,
        `${folder} (${VERSION_NAMES[version]}).mp4`,
      );
      const stats = await stat(file).catch(() => undefined);
      if (stats)
        files[version] = { file, size: stats.size, mtime: stats.mtimeMs };
    }
    if (Object.keys(files).length === 0) continue;
    result.push({
      folder,
      id: meta.id,
      meta: { duration: meta.duration, width: meta.width, height: meta.height },
      files,
    });
  }
  return result.sort((a, b) => (a.folder < b.folder ? -1 : 1));
}

/** The button that makes a missing version of the song with YouTube id `id`. */
export function makeButton(
  id: string,
  version: Version,
): { text: "🎤 Make it"; data: string } {
  return { text: "🎤 Make it", data: `karaoke:make:${id}:${version}` };
}

const newest = (song: Song): number =>
  Math.max(...Object.values(song.files).map((f) => f.mtime));

/** Two items per song (`<folder>/music`, `<folder>/vocals`): posted songs keep their place, new ones go at the end, oldest first. */
export function karaokeItems(
  all: Song[],
  posted: string[],
  youtube: Record<string, string>,
): Item[] {
  const place = (song: Song): number => {
    const index = posted.findIndex((key) =>
      VERSIONS.some((v) => key === `${song.folder}/${v}`),
    );
    return index === -1 ? Infinity : index;
  };
  const ordered = [...all].sort((a, b) => {
    const [pa, pb] = [place(a), place(b)];
    return pa === pb ? newest(a) - newest(b) : pa < pb ? -1 : 1;
  });
  return ordered.flatMap((song) =>
    VERSIONS.map((version): Item => {
      const key = `${song.folder}/${version}`;
      const title = `${song.folder} (${VERSION_NAMES[version]})`;
      const videoId = youtube[title];
      const made = song.files[version];
      if (videoId) {
        return {
          key,
          kind: "text",
          text: `${title}\nhttps://youtu.be/${videoId}`,
        };
      }
      if (made) {
        return {
          key,
          kind: "video",
          ...made,
          caption: title,
          video: song.meta,
        };
      }
      return {
        key,
        kind: "text",
        text: `⏳ ${title} — not made yet`,
        button: makeButton(song.id, version),
      };
    }),
  );
}

/** Syncs the karaoke topic (`probe`: see `syncTopic`); undefined = no group. */
export async function syncKaraoke(
  api: Api,
  dirs: Dirs = DIRS,
  options: { probe?: boolean } = {},
): Promise<Synced | undefined> {
  return withGroup(
    api,
    async (state) => {
      const posted =
        state.topics[KARAOKE_TOPIC]?.messages.map((m) => m.key) ?? [];
      const items = karaokeItems(
        await songs(dirs.karaoke),
        posted,
        uploads(dirs.youtube),
      );
      return syncTopic(
        api,
        state,
        KARAOKE_TOPIC,
        TOPIC_NAME,
        items,
        dirs.state,
        options,
      );
    },
    dirs.state,
  );
}
