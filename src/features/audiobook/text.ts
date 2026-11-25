/** Longer titles are cut so file names stay readable and within file system limits. */
const MAX_NAME_CHARS = 100;

/** «001 Розділ I. Риба-молот»: the number keeps files in reading order. Used for text and audio files. */
export function chapterName(index: number, title: string): string {
  return safeFilename(`${String(index).padStart(3, "0")} ${title}`)
    .slice(0, MAX_NAME_CHARS)
    .trim();
}

export function safeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_");
}

/** «Жуль Верн - Діти капітана Гранта»: the author keeps books with the same title apart. */
export function bookName(book: { title: string; author?: string }): string {
  return book.author ? `${book.author} - ${book.title}` : book.title;
}

/** A book's folder: its EPUB, prepared texts (text/), audio per voice (audio/<voice>/) and stress dictionary. */
export function bookDir(name: string): string {
  return `data/audiobook/${safeFilename(name)}`;
}

export function bookPaths(name: string, voiceName: string) {
  const dir = bookDir(name);
  return {
    textDir: `${dir}/text`,
    audioDir: `${dir}/audio/${safeFilename(voiceName)}`,
    dictionary: `${dir}/stresses.txt`,
    report: `${dir}/stress-check.txt`,
  };
}

/** Book folder names that contain every word of `query`, e.g. «верн грант». */
export function findBooks(query: string, names: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[’ʼ`]/g, "'");
  const words = norm(query).split(/\s+/).filter(Boolean);
  return words.length
    ? names.filter((name) => words.every((w) => norm(name).includes(w)))
    : [];
}

/** The book languages the bot voices. */
export type Language = "uk" | "en";
export type Provider = "holos" | "kokoro";

/** Frequent English words; in English prose they make about a third of all words. */
const ENGLISH_WORDS = new Set(
  "the and of to a in that was he she it his her i you is for with on had as at but not be by they".split(
    " ",
  ),
);
const MIN_ENGLISH_SHARE = 0.15;

/** «uk»: Cyrillic with more і/ї/є/ґ than ы/э/ъ/ё (Russian). «en»: Latin with many frequent English words
 * (French and German have few of them). Any other text: undefined. */
export function bookLanguage(text: string): Language | undefined {
  const count = (letters: RegExp) => text.match(letters)?.length ?? 0;
  const cyrillic = count(/[а-яіїєґё]/gi);
  const latin = count(/[a-z]/gi);
  if (cyrillic > latin)
    return count(/[іїєґ]/gi) > count(/[ыэъё]/gi) ? "uk" : undefined;
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const english = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  return words.length && english / words.length >= MIN_ENGLISH_SHARE
    ? "en"
    : undefined;
}

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

/** Time to voice `chars` characters, e.g. «3 min». */
export function voicingTime(chars: number, provider: Provider): string {
  return duration((chars * SPEED[provider].secondsPerChar) / 60);
}

export function duration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/** «5 7-9» → [5, 7, 8, 9]. */
export function parseNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const [, from, to] of text.matchAll(/(\d+)(?:\s*[-–]\s*(\d+))?/g)) {
    for (let n = Number(from); n <= Number(to ?? from); n++) numbers.push(n);
  }
  return [...new Set(numbers)];
}
