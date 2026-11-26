import { duration } from "../../eta.ts";
/** Longer titles are cut so file names stay readable and within file system limits. */
export const MAX_NAME_CHARS = 100;

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

/**
 * Every book's folder is here: its EPUB (or PDF and book.md), prepared texts (text/), audio per voice
 * (audio/<voice>/), stress dictionary, and its translation in `translation/`, laid out the same way.
 */
export const BOOKS_DIR = "data/books";
const TRANSLATION = "translation";

/** A book's folder is its path under BOOKS_DIR: «X» for an original, «X/translation» for its translation. */
export function translationFolder(folder: string): string {
  return `${folder}/${TRANSLATION}`;
}

/** The original's folder of `folder`, which may be its translation's. */
export function originalFolder(folder: string): string {
  return folder.endsWith(`/${TRANSLATION}`)
    ? folder.slice(0, -TRANSLATION.length - 1)
    : folder;
}

/** How a book folder is shown on a button: «X» or «X · 🌐 Ukrainian» for its translation. */
export function shelfLabel(folder: string): string {
  const original = originalFolder(folder);
  return original === folder ? folder : `${original} · 🌐 Ukrainian`;
}

/** The folder a newly sent book goes to, named after it. */
export function bookDir(name: string): string {
  return `${BOOKS_DIR}/${safeFilename(name)}`;
}

/** Where the texts, a voice's audio and the stress files of the book in `folder` are. */
export function bookPaths(folder: string, voiceName: string) {
  const dir = `${BOOKS_DIR}/${folder}`;
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
/** What `bookLanguage` can tell: the voiced languages and Russian, which the bot only translates. */
export type BookLanguage = Language | "ru";
export type Provider = "holos" | "kokoro";

/** Frequent English words; in English prose they make about a third of all words. */
const ENGLISH_WORDS = new Set(
  "the and of to a in that was he she it his her i you is for with on had as at but not be by they".split(
    " ",
  ),
);
const MIN_ENGLISH_SHARE = 0.15;

/** «uk»: Cyrillic with more і/ї/є/ґ than ы/э/ъ/ё. «ru»: Cyrillic with more ы/э/ъ/ё than і/ї/є/ґ. «en»: Latin with many frequent English words
 * (French and German have few of them). Any other text: undefined. */
export function bookLanguage(text: string): BookLanguage | undefined {
  const count = (letters: RegExp) => text.match(letters)?.length ?? 0;
  const cyrillic = count(/[а-яіїєґё]/gi);
  const latin = count(/[a-z]/gi);
  if (cyrillic > latin) {
    const ukrainian = count(/[іїєґ]/gi);
    const russian = count(/[ыэъё]/gi);
    if (ukrainian === russian) return undefined;
    return ukrainian > russian ? "uk" : "ru";
  }
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

/** Minutes to voice `chars` characters. */
export function voicingMinutes(chars: number, provider: Provider): number {
  return (chars * SPEED[provider].secondsPerChar) / 60;
}

/** Time to voice `chars` characters, e.g. «3 min». */
export function voicingTime(chars: number, provider: Provider): string {
  return duration(voicingMinutes(chars, provider));
}

/** «5 7-9» → [5, 7, 8, 9]. */
export function parseNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const [, from, to] of text.matchAll(/(\d+)(?:\s*[-–]\s*(\d+))?/g)) {
    for (let n = Number(from); n <= Number(to ?? from); n++) numbers.push(n);
  }
  return [...new Set(numbers)];
}
