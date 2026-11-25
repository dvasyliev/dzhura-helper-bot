import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { config } from "../../config.ts";

type ProviderVoices = { male: string[]; female: string[]; default: { female: string; male: string } };

const providers: Record<string, ProviderVoices> = JSON.parse(readFileSync("voices.json", "utf8"));
const voices = providers[config.ttsProvider];
if (!voices) throw new Error(`TTS_PROVIDER=${config.ttsProvider}: no such provider in voices.json`);

/** Voices from voices.json, numbered in the owner's order. */
const numbered = (label: string, ids: string[]) => ids.map((id, i) => ({ name: `${label} ${i + 1}`, id }));
export const VOICE_GROUPS = [numbered("Чоловічий", voices.male), numbered("Жіночий", voices.female)];
export const VOICES = VOICE_GROUPS.flat();
/** Shown first with a star. */
export const DEFAULT_VOICES = [voices.default.female, voices.default.male];

export type ChapterResult = { chapter: number; files?: string[]; error?: string };

/**
 * Voices `chapters` with scripts/audiobook/voice.py (provider from TTS_PROVIDER, run through uv) into
 * `outDir`, yielding each chapter's mp3 files as soon as it is ready. Throws when the provider cannot
 * go on at all (for Fish: bad key or no balance).
 */
export async function* voiceChapters(voiceId: string, outDir: string, chapters: string[]): AsyncGenerator<ChapterResult> {
  const child = spawn("uv", ["run", "--quiet", "python", "scripts/audiobook/voice.py"], { stdio: ["pipe", "pipe", "inherit"] });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  child.stdin.end(JSON.stringify({ provider: config.ttsProvider, voice: voiceId, out_dir: outDir, chapters }));
  for await (const line of createInterface({ input: child.stdout })) {
    if (!line.startsWith("{")) continue;
    const result = JSON.parse(line) as ChapterResult & { fatal?: boolean };
    if (result.fatal) throw new Error(result.error);
    yield result;
  }
  const code = await exited;
  if (code !== 0) throw new Error(`voice.py exited with code ${code}`);
}
