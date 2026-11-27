import { bold, escape, quote } from "../text/format.ts";
import type { BookLanguage } from "./language.ts";
import type { Book } from "./epub.ts";
import type { BookInfo } from "./info.ts";

/** Telegram's limit for a photo's caption. */
export const MAX_CAPTION = 1024;

const LANGUAGE_NAMES: Record<BookLanguage, string> = {
  uk: "Ukrainian",
  en: "English",
  ru: "Russian",
};

/** `text` cut with «…» so that its escaped form is at most `limit` characters; empty when there is no room. */
function fit(text: string, limit: number): string {
  if (escape(text).length <= limit) return text;
  let cut = text;
  while (cut && escape(cut).length > limit - 1) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * The book's card text, as the caption of its cover: title, author, a quote with the facts and `lines`, then the
 * description, cut so the whole fits Telegram's caption limit. Telegram HTML.
 */
export function bookCaption(options: {
  book: Pick<Book, "title" | "author">;
  chapters: number;
  language?: BookLanguage;
  info?: BookInfo;
  lines?: string[];
}): string {
  const { book, chapters, language, info, lines = [] } = options;
  const facts = [
    ...(language ? [LANGUAGE_NAMES[language]] : []),
    `${chapters} chapters`,
    ...(info?.year ? [String(info.year)] : []),
    ...(info?.pages ? [`~${info.pages} pages`] : []),
  ].join(" · ");
  const head = [
    `📕 ${bold(escape(book.title))}`,
    ...(book.author ? [escape(book.author)] : []),
  ].join("\n");
  const base = `${head}\n\n${quote([facts, ...lines])}`;
  const room = MAX_CAPTION - base.length - 2;
  const description =
    info?.description && room > 20 ? fit(info.description, room) : "";
  return description ? `${base}\n\n${escape(description)}` : base;
}
