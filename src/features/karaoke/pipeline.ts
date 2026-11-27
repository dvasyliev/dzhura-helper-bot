import path from "node:path";
import { z } from "zod";
import { readdirEntriesOrEmpty, statOrUndefined } from "../../lib/fs/absent.ts";
import { readJsonOrUndefined } from "../../lib/fs/json.ts";
import { KARAOKE_META } from "../../lib/library/karaoke.ts";
import { runPython } from "../../lib/python/python.ts";
import type { Version } from "../../lib/video/version.ts";

export type KaraokeJob = {
  url: string;
  /** YouTube id; the song's folder is found by it, so a re-sent link reuses finished steps. */
  id: string;
  /** Which karaoke to make, in this order: music only, with the singer's voice, or both. */
  versions: Version[];
  /** Lyrics typed by the owner, one line per line. */
  lyricsText?: string;
  /** Build the karaoke from what Whisper heard. */
  useTranscript?: boolean;
};

/** What dzhura_helper_bot.karaoke.karaoke prints; `need_lyrics` is read as `needLyrics`. */
const KARAOKE_EVENT = z.union([
  z.object({
    step: z.enum([
      "download",
      "separate",
      "listen",
      "lyrics",
      "align",
      "render",
    ]),
  }),
  z.object({
    video: z.string(),
    /** The same video in full quality, for YouTube; equals `video` when it fits Telegram. */
    full: z.string(),
    // The bot does not read these; Python's Meta may leave them None.
    title: z.string().nullish(),
    duration: z.number().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
  }),
  z
    .object({
      need_lyrics: z.enum(["not_found", "mismatch", "unreachable"]),
      transcript: z.string(),
    })
    .transform(({ need_lyrics, transcript }) => ({
      needLyrics: need_lyrics,
      transcript,
    })),
  z.object({ error: z.string() }),
]);
export type KaraokeEvent = z.infer<typeof KARAOKE_EVENT>;

const DATA_DIR = "data/karaoke";

/** Whether the clip's vocals were split off before: then the karaoke takes about a minute instead of 2–3. */
export async function isSeparated(
  id: string,
  dataDir = DATA_DIR,
): Promise<boolean> {
  for (const folder of await readdirEntriesOrEmpty(dataDir)) {
    if (!folder.isDirectory()) continue;
    const song = path.join(dataDir, folder.name);
    if (!(await statOrUndefined(path.join(song, "stems", "vocals.wav"))))
      continue;
    const meta = await readJsonOrUndefined(
      path.join(song, "meta.json"),
      KARAOKE_META,
    );
    if (meta?.id === id) return true;
  }
  return false;
}

/** Runs the Python module dzhura_helper_bot.karaoke.karaoke through uv, yielding its progress and its result. */
export async function* runKaraoke(
  job: KaraokeJob,
): AsyncGenerator<KaraokeEvent> {
  const input = {
    url: job.url,
    id: job.id,
    versions: job.versions,
    data_dir: DATA_DIR,
    lyrics_text: job.lyricsText ?? null,
    use_transcript: job.useTranscript ?? false,
  };
  yield* runPython("dzhura_helper_bot.karaoke.karaoke", input, {
    schema: KARAOKE_EVENT,
    background: true,
  });
}
