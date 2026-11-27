import { duration } from "../../lib/text/eta.ts";
import type { Provider } from "../../lib/tts/voice.ts";

const MB_PER_MINUTE = 0.48; // 64 kbps mono mp3
/** Measured on an Apple M5. HolosTTS: «Діти капітана Гранта», chapter 1, 9 613 chars → 13.3 min of audio
 * in 40 s, model loading included. Kokoro: 2 540 chars of English → 3 min of audio in 18 s. */
const SPEED: Record<
  Provider,
  { charsPerMinute: number; secondsPerChar: number }
> = {
  holos: { charsPerMinute: 700, secondsPerChar: 0.0042 },
  kokoro: { charsPerMinute: 850, secondsPerChar: 0.007 },
};

/** «≈18 h 10 min of audio, ≈520 MB (largest chapter ≈21 MB)» and the voicing time:
 * for all of `chapterChars` and for the first of them, the first file the owner gets. */
export function forecast(chapterChars: number[], provider: Provider): string {
  const minutes = (chars: number) => chars / SPEED[provider].charsPerMinute;
  const total = chapterChars.reduce((a, b) => a + b, 0);
  const mb = (chars: number) =>
    Math.max(1, Math.round(minutes(chars) * MB_PER_MINUTE));
  return [
    `≈${duration(minutes(total))} of audio, ≈${mb(total)} MB (largest chapter ≈${mb(Math.max(...chapterChars))} MB).`,
    `The first chapter will be ready in ≈${voicingTime(chapterChars[0], provider)}, the whole voicing takes ≈${voicingTime(total, provider)}.`,
  ].join("\n");
}

/** Minutes to voice `chars` characters. */
export function voicingMinutes(chars: number, provider: Provider): number {
  return (chars * SPEED[provider].secondsPerChar) / 60;
}

/** Time to voice `chars` characters, e.g. «3 min». */
export function voicingTime(chars: number, provider: Provider): string {
  return duration(voicingMinutes(chars, provider));
}
