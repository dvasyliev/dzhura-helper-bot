/** The book languages the bot voices. */
export type Language = "uk" | "en";
/** What `bookLanguage` can tell: the voiced languages and Russian, which the bot only translates. */
export type BookLanguage = Language | "ru";

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
