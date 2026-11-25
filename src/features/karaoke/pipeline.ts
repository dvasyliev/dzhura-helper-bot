import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

export type KaraokeJob = {
  url: string;
  /** YouTube id; the song's folder is found by it, so a re-sent link reuses finished steps. */
  id: string;
  vocals: boolean;
  /** Lyrics typed by the owner, one line per line. */
  lyricsText?: string;
  /** Build the karaoke from what Whisper heard. */
  useTranscript?: boolean;
};

export type KaraokeEvent =
  | { step: "download" | "separate" | "listen" | "lyrics" | "align" | "render" }
  | { video: string; title: string; duration: number; width: number; height: number }
  | { needLyrics: "not_found" | "mismatch"; transcript: string }
  | { error: string };

const DATA_DIR = "data/karaoke";

/** Whether the clip's vocals were split off before: then the karaoke takes about a minute instead of 2–3. */
export function isSeparated(id: string, dataDir = DATA_DIR): boolean {
  const folders = existsSync(dataDir) ? readdirSync(dataDir, { withFileTypes: true }).filter((f) => f.isDirectory()) : [];
  return folders.some((f) => {
    const song = path.join(dataDir, f.name);
    if (!existsSync(path.join(song, "stems", "vocals.wav")) || !existsSync(path.join(song, "meta.json"))) return false;
    return JSON.parse(readFileSync(path.join(song, "meta.json"), "utf8")).id === id;
  });
}

/** Runs src/features/karaoke/scripts/karaoke.py through uv, yielding its progress and its result. */
export async function* runKaraoke(job: KaraokeJob): AsyncGenerator<KaraokeEvent> {
  const child = spawn("uv", ["run", "--quiet", "python", "src/features/karaoke/scripts/karaoke.py"], { stdio: ["pipe", "pipe", "inherit"] });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  child.stdin.end(
    JSON.stringify({
      url: job.url,
      id: job.id,
      vocals: job.vocals,
      data_dir: DATA_DIR,
      lyrics_text: job.lyricsText ?? null,
      use_transcript: job.useTranscript ?? false,
    }),
  );
  for await (const line of createInterface({ input: child.stdout })) {
    if (!line.startsWith("{")) continue;
    const { need_lyrics, ...rest } = JSON.parse(line);
    yield (need_lyrics ? { needLyrics: need_lyrics, transcript: rest.transcript } : rest) as KaraokeEvent;
  }
  const code = await exited;
  if (code !== 0) throw new Error(`karaoke.py exited with code ${code}`);
}
