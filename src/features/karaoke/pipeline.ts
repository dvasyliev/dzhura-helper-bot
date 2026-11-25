import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { runPython } from "../../python.ts";

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

export type Version = "music" | "vocals";

export type KaraokeEvent =
  | { step: "download" | "separate" | "listen" | "lyrics" | "align" | "render" }
  | {
      video: string;
      /** The same video in full quality, for YouTube; equals `video` when it fits Telegram. */ full: string;
      title: string;
      duration: number;
      width: number;
      height: number;
    }
  | { needLyrics: "not_found" | "mismatch"; transcript: string }
  | { error: string };

const DATA_DIR = "data/karaoke";

/** Whether the clip's vocals were split off before: then the karaoke takes about a minute instead of 2–3. */
export function isSeparated(id: string, dataDir = DATA_DIR): boolean {
  const folders = existsSync(dataDir)
    ? readdirSync(dataDir, { withFileTypes: true }).filter((f) =>
        f.isDirectory(),
      )
    : [];
  return folders.some((f) => {
    const song = path.join(dataDir, f.name);
    if (
      !existsSync(path.join(song, "stems", "vocals.wav")) ||
      !existsSync(path.join(song, "meta.json"))
    )
      return false;
    return (
      JSON.parse(readFileSync(path.join(song, "meta.json"), "utf8")).id === id
    );
  });
}

/** Runs src/features/karaoke/scripts/karaoke.py through uv, yielding its progress and its result. */
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
  for await (const { need_lyrics, ...rest } of runPython(
    "src/features/karaoke/scripts/karaoke.py",
    input,
  ))
    yield (
      need_lyrics
        ? { needLyrics: need_lyrics, transcript: rest.transcript }
        : rest
    ) as KaraokeEvent;
}
