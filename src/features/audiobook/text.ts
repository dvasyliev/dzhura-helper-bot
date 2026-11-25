/** Longer titles are cut so file names stay readable and within file system limits. */
const MAX_NAME_CHARS = 100;

/** «001 Розділ I. Риба-молот»: the number keeps files in reading order. Used for text and audio files. */
export function chapterName(index: number, title: string): string {
  return safeFilename(`${String(index).padStart(3, "0")} ${title}`).slice(0, MAX_NAME_CHARS).trim();
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
    dictionary: `${dir}/словник наголосів.txt`,
    report: `${dir}/сумнівні наголоси.txt`,
  };
}

/** Book folder names that contain every word of `query`, e.g. «верн грант». */
export function findBooks(query: string, names: string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[’ʼ`]/g, "'");
  const words = norm(query).split(/\s+/).filter(Boolean);
  return words.length ? names.filter((name) => words.every((w) => norm(name).includes(w))) : [];
}

/** Cyrillic text with more і/ї/є/ґ than ы/э/ъ/ё (Russian). */
export function isUkrainian(text: string): boolean {
  const count = (letters: RegExp) => text.match(letters)?.length ?? 0;
  return count(/[а-яіїєґ]/gi) > count(/[a-z]/gi) && count(/[іїєґ]/gi) > count(/[ыэъё]/gi);
}

// Measured on «Діти капітана Гранта», HolosTTS on an Apple M5, with pauses and accentuk:
// chapter 1, 9 613 chars → 13.3 min of audio in 40 s, model loading included.
const CHARS_PER_MINUTE = 700;
const MB_PER_MINUTE = 0.48; // 64 kbps mono mp3
const GENERATION_SECONDS_PER_CHAR = 0.0042;

/** «≈18 год 10 хв аудіо, ≈520 МБ (найбільший розділ ≈21 МБ)», plus voicing time when it is known:
 * for all of `chapterChars` and for the first of them, the first file the owner gets. */
export function forecast(chapterChars: number[], withVoicingTime: boolean): string {
  const minutes = (chars: number) => chars / CHARS_PER_MINUTE;
  const total = chapterChars.reduce((a, b) => a + b, 0);
  const mb = (chars: number) => Math.max(1, Math.round(minutes(chars) * MB_PER_MINUTE));
  const lines = [
    `≈${duration(minutes(total))} аудіо, ≈${mb(total)} МБ (найбільший розділ ≈${mb(Math.max(...chapterChars))} МБ).`,
  ];
  if (withVoicingTime)
    lines.push(`Перший розділ буде за ≈${voicingTime(chapterChars[0])}, уся озвучка займе ≈${voicingTime(total)}.`);
  return lines.join("\n");
}

/** HolosTTS time to voice `chars` characters, e.g. «3 хв». */
export function voicingTime(chars: number): string {
  return duration((chars * GENERATION_SECONDS_PER_CHAR) / 60);
}

export function duration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} год${m % 60 ? ` ${m % 60} хв` : ""}` : `${m} хв`;
}

/** «5 7-9» → [5, 7, 8, 9]. */
export function parseNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const [, from, to] of text.matchAll(/(\d+)(?:\s*[-–]\s*(\d+))?/g)) {
    for (let n = Number(from); n <= Number(to ?? from); n++) numbers.push(n);
  }
  return [...new Set(numbers)];
}
