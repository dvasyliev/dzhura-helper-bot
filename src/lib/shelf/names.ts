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

/** «5 7-9» → [5, 7, 8, 9]. */
export function parseNumbers(text: string): number[] {
  const numbers: number[] = [];
  for (const [, from, to] of text.matchAll(/(\d+)(?:\s*[-–]\s*(\d+))?/g)) {
    for (let n = Number(from); n <= Number(to ?? from); n++) numbers.push(n);
  }
  return [...new Set(numbers)];
}
