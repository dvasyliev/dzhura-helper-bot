import { z } from "zod";
import { MAX_LEVEL, type Book } from "./epub.ts";

/** The book's text as written by dzhura_helper_bot.book.pdf_convert; kept next to the original so it is read only once. */
export const BOOK_MD = "book.md";

/** The source book as Markdown, in the translation folder; book.md there is the finished translation. */
export const SOURCE_MD = "source.md";

const HEADING = /^(#{1,3}) /;

/** The `#` marks of a chapter's heading in book.md. */
export function headingMarks(level = 1): string {
  return "#".repeat(Math.min(level, MAX_LEVEL));
}

/**
 * Reads book.md: YAML front matter with quoted `title` and `author`, a `# ` line per top-level chapter (`## `
 * and `### ` for its sections; a book with no sections has no levels), one line per paragraph. A text line starting
 * with `\#` is a paragraph, not a chapter. `fileName` names the book when it has
 * no title.
 */
export function parseMarkdown(text: string, fileName = "Book"): Book {
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = (key: string) => {
    const value = front?.[1].match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];
    return value ? z.string().parse(JSON.parse(value)) : undefined;
  };
  const chapters: Book["chapters"] = [];
  let paragraphs: string[] = [];
  const body = text.slice(front?.[0].length ?? 0);
  for (const line of body.split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      paragraphs = [];
      chapters.push({
        title: line.slice(heading[0].length).trim(),
        text: "",
        level: heading[1].length,
      });
    } else if (line.trim() && chapters.length) {
      paragraphs.push(line.startsWith("\\#") ? line.slice(1) : line);
      chapters[chapters.length - 1].text = paragraphs.join("\n");
    }
  }
  if (chapters.every((c) => c.level === 1))
    for (const c of chapters) delete c.level;
  return {
    title: meta("title") || fileName.replace(/\.[^.]+$/, ""),
    author: meta("author"),
    chapters,
  };
}

/** Writes a book as book.md, in the format of `to_markdown` in dzhura_helper_bot.book.pdf_book. */
export function toMarkdown(book: Book): string {
  const lines = ["---", `title: ${JSON.stringify(book.title)}`];
  if (book.author) lines.push(`author: ${JSON.stringify(book.author)}`);
  lines.push("---", "");
  for (const chapter of book.chapters) {
    lines.push(`${headingMarks(chapter.level)} ${oneLine(chapter.title)}`, "");
    for (const paragraph of chapter.text.split("\n")) {
      const text = markdownParagraph(paragraph);
      if (text) lines.push(text, "");
    }
  }
  return lines.join("\n");
}

/** One paragraph as a book.md line; a leading `#` is escaped so it is not read as a chapter. Empty when blank. */
export function markdownParagraph(paragraph: string): string {
  const text = oneLine(paragraph);
  return text.startsWith("#") ? `\\${text}` : text;
}

function oneLine(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}
