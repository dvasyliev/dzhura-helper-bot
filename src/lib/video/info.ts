import { z } from "zod";
import { runPython } from "../python/python.ts";

export const VIDEO_INFO = z.object({
  title: z.string(),
  channel: z.string().optional(),
  duration: z.number().optional(),
  categories: z.array(z.string()).default([]),
  chapters: z
    .array(z.object({ start: z.number(), title: z.string() }))
    .default([]),
  language: z.string().optional(),
});

/** A YouTube video's metadata, as dzhura_helper_bot.video.info reads it with yt-dlp. */
export type VideoInfo = z.infer<typeof VIDEO_INFO>;

const cache = new Map<string, VideoInfo>();

/** The video's metadata, read once per id; undefined when yt-dlp fails (it is asked again next time). */
export async function videoInfo(
  id: string,
  run: (
    module: string,
    input: unknown,
    options: { schema: typeof VIDEO_INFO },
  ) => AsyncIterable<VideoInfo> = runPython,
): Promise<VideoInfo | undefined> {
  const cached = cache.get(id);
  if (cached) return cached;
  try {
    let info: VideoInfo | undefined;
    for await (const line of run(
      "dzhura_helper_bot.video.info",
      { id },
      { schema: VIDEO_INFO },
    ))
      info = line;
    if (!info) throw new Error("info printed no reply");
    cache.set(id, info);
    return info;
  } catch (error) {
    console.error(`Reading YouTube video ${id} failed:`, error);
    return undefined;
  }
}

/** Whether YouTube files the video under Music: it gets karaoke, anything else a summary. */
export function isMusic(info: VideoInfo): boolean {
  return info.categories.includes("Music");
}
