import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { runPython } from "../python/python.ts";
import { readdirOrEmpty, statOrUndefined } from "../fs/absent.ts";
import type { Language } from "../book/language.ts";
export type Provider = "holos" | "kokoro";

export type Voice = {
  id: string;
  /** On the button and the name of the audio folder, so unique across languages. */
  name: string;
  provider: Provider;
  language: Language;
  gender: "woman" | "man";
  /** Set on the voices a summary offers: how much faster than an audiobook it reads one. */
  summaryTempo?: number;
};

const byLanguage = z
  .record(
    z.enum(["uk", "en"]),
    z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        provider: z.enum(["holos", "kokoro"]),
        gender: z.enum(["woman", "man"]),
        summaryTempo: z.number().positive().optional(),
      }),
    ),
  )
  .parse(
    // Sync: runs once at startup, while the module loads.
    JSON.parse(readFileSync(new URL("voices.json", import.meta.url), "utf8")),
  );
/** Every voice of every language; the bot offers those of the book's language. */
export const VOICES: Voice[] = Object.entries(byLanguage).flatMap(
  ([language, voices]) =>
    voices.map((v) => ({ ...v, language: language as Language })),
);

export function voicesFor(language: Language): Voice[] {
  return VOICES.filter((v) => v.language === language);
}

/** What the user sees for a voice: «👩 Woman (UA)»; a folder of a voice no longer offered keeps its name. */
export function voiceLabel(name: string): string {
  const voice = VOICES.find((v) => v.name === name);
  if (!voice) return name;
  const gender = voice.gender === "woman" ? "👩 Woman" : "👨 Man";
  return `${gender} (${voice.language === "uk" ? "UA" : "EN"})`;
}

/** The voices a summary in `language` offers, in voices.json order. */
export function summaryVoices(language: Language): Voice[] {
  return voicesFor(language).filter((v) => v.summaryTempo);
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
  /** Plays the audio this many times faster, pitch kept; 1 by default. */
  tempo?: number;
  /** Each chapter in one file, however long. */
  oneFile?: boolean;
};

const VOICE_EVENT = z.union([
  z.object({
    chapter: z.number(),
    files: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  z.object({ report: z.string(), words: z.number() }),
]);
export type VoiceEvent = z.infer<typeof VOICE_EVENT>;

/**
 * Voices the job's chapters with dzhura_helper_bot.audiobook.voice (run through uv) and the voice's provider,
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
    tempo: job.tempo ?? 1,
    one_file: job.oneFile ?? false,
  };
  for await (const event of runPython(
    "dzhura_helper_bot.audiobook.voice",
    input,
    { schema: VOICE_EVENT, background: true },
  ))
    yield event;
}

/** voice.py renames a chapter's first file last, so if it exists the chapter is complete. */
export async function isVoiced(
  audioDir: string,
  name: string,
): Promise<boolean> {
  return (
    !!(await statOrUndefined(`${audioDir}/${name}.mp3`)) ||
    !!(await statOrUndefined(`${audioDir}/${name} (1).mp3`))
  );
}

/** Removes a chapter's audio so it is voiced again. */
export async function removeAudio(
  audioDir: string,
  name: string,
): Promise<void> {
  for (const file of await readdirOrEmpty(audioDir)) {
    const rest = file.startsWith(name) ? file.slice(name.length) : undefined;
    if (rest !== undefined && /^( \(\d+\))?\.mp3(\.part)?$/.test(rest))
      await rm(`${audioDir}/${file}`);
  }
}
