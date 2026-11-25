import { existsSync, readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { runPython } from "../../python.ts";
import type { Language, Provider } from "./text.ts";

export type Voice = {
  id: string;
  /** On the button and the name of the audio folder, so unique across languages. */
  name: string;
  provider: Provider;
  language: Language;
};

const byLanguage: Record<Language, Omit<Voice, "language">[]> = JSON.parse(
  readFileSync(new URL("voices.json", import.meta.url), "utf8"),
);
/** Every voice of every language; the bot offers those of the book's language. */
export const VOICES: Voice[] = Object.entries(byLanguage).flatMap(
  ([language, voices]) =>
    voices.map((v) => ({ ...v, language: language as Language })),
);

export function voicesFor(language: Language): Voice[] {
  return VOICES.filter((v) => v.language === language);
}

export type VoiceJob = {
  voice: Voice;
  textDir: string;
  audioDir: string;
  /** The book's stress dictionary; it wins over automatic stress marks. */
  dictionary: string;
  /** Where to write the list of words with guessed stress (Ukrainian only); omitted when re-voicing single chapters. */
  report?: string;
  chapters: { index: number; name: string; text: string }[];
};

export type VoiceEvent =
  | { chapter: number; files?: string[]; error?: string }
  | { report: string; words: number };

/**
 * Voices the job's chapters with src/features/audiobook/scripts/voice.py (run through uv) and the voice's provider,
 * yielding each chapter's mp3 files in order as soon as they are ready. A chapter that failed comes with
 * `error` and is the last one.
 */
export async function* voiceChapters(
  job: VoiceJob,
): AsyncGenerator<VoiceEvent> {
  const input = {
    provider: job.voice.provider,
    language: job.voice.language,
    voice: job.voice.id,
    text_dir: job.textDir,
    audio_dir: job.audioDir,
    dictionary: job.dictionary,
    report: job.report ?? null,
    chapters: job.chapters,
  };
  for await (const event of runPython(
    "src/features/audiobook/scripts/voice.py",
    input,
  ))
    yield event as VoiceEvent;
}

/** voice.py renames a chapter's first file last, so if it exists the chapter is complete. */
export function isVoiced(audioDir: string, name: string): boolean {
  return (
    existsSync(`${audioDir}/${name}.mp3`) ||
    existsSync(`${audioDir}/${name} (1).mp3`)
  );
}

/** Removes a chapter's audio so it is voiced again. */
export async function removeAudio(
  audioDir: string,
  name: string,
): Promise<void> {
  if (!existsSync(audioDir)) return;
  for (const file of await readdir(audioDir)) {
    const rest = file.startsWith(name) ? file.slice(name.length) : undefined;
    if (rest !== undefined && /^( \(\d+\))?\.mp3(\.part)?$/.test(rest))
      await rm(`${audioDir}/${file}`);
  }
}
