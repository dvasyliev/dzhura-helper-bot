import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import { config } from "../../config.ts";

/** Voice id → the name shown to the user, in the owner's order. */
type Named = Record<string, string>;
type ProviderVoices = { male: Named; female: Named; default: { female: string; male: string } };

const providers: Record<string, ProviderVoices> = JSON.parse(readFileSync("voices.json", "utf8"));
const voices = providers[config.ttsProvider];
if (!voices) throw new Error(`TTS_PROVIDER=${config.ttsProvider}: no such provider in voices.json`);

const named = (group: Named) => Object.entries(group).map(([id, name]) => ({ name, id }));
export const VOICES = [...named(voices.male), ...named(voices.female)];
/** The two voices offered in the bot; the rest are for `npm run sample`. */
export const DEFAULT_VOICES = [voices.default.female, voices.default.male];

export type VoiceJob = {
  voiceId: string;
  textDir: string;
  audioDir: string;
  /** The book's stress dictionary; it wins over automatic stress marks. */
  dictionary: string;
  /** Where to write the list of words with guessed stress; omitted when re-voicing single chapters. */
  report?: string;
  chapters: { index: number; name: string; text: string }[];
};

export type VoiceEvent = { chapter: number; files?: string[]; error?: string } | { report: string; words: number };

/**
 * Voices the job's chapters with src/features/audiobook/scripts/voice.py (provider from TTS_PROVIDER, run through uv),
 * yielding each chapter's mp3 files in order as soon as they are ready. A chapter that failed comes with
 * `error` and is the last one.
 */
export async function* voiceChapters(job: VoiceJob): AsyncGenerator<VoiceEvent> {
  const child = spawn("uv", ["run", "--quiet", "python", "src/features/audiobook/scripts/voice.py"], { stdio: ["pipe", "pipe", "inherit"] });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  child.stdin.end(
    JSON.stringify({
      provider: config.ttsProvider,
      voice: job.voiceId,
      text_dir: job.textDir,
      audio_dir: job.audioDir,
      dictionary: job.dictionary,
      report: job.report ?? null,
      chapters: job.chapters,
    }),
  );
  for await (const line of createInterface({ input: child.stdout })) {
    if (line.startsWith("{")) yield JSON.parse(line) as VoiceEvent;
  }
  const code = await exited;
  if (code !== 0) throw new Error(`voice.py exited with code ${code}`);
}

/** voice.py renames a chapter's first file last, so if it exists the chapter is complete. */
export function isVoiced(audioDir: string, name: string): boolean {
  return existsSync(`${audioDir}/${name}.mp3`) || existsSync(`${audioDir}/${name} (1).mp3`);
}

/** Removes a chapter's audio so it is voiced again. */
export async function removeAudio(audioDir: string, name: string): Promise<void> {
  if (!existsSync(audioDir)) return;
  for (const file of await readdir(audioDir)) {
    const rest = file.startsWith(name) ? file.slice(name.length) : undefined;
    if (rest !== undefined && /^( \(\d+\))?\.mp3(\.part)?$/.test(rest)) await rm(`${audioDir}/${file}`);
  }
}
