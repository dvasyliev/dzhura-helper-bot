import type { Book } from "./epub.ts";

/** The book's text as written by scripts/pdf_convert.py; kept next to the original so it is read only once. */
export const BOOK_MD = "book.md";

/**
 * Reads book.md: YAML front matter with quoted `title` and `author`, a `# ` line per chapter, one line per
 * paragraph. A text line starting with `\#` is a paragraph, not a chapter. `fileName` names the book when it has
 * no title.
 */
export function parseMarkdown(text: string, fileName = "Book"): Book {
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = (key: string) => {
    const value = front?.[1].match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];
    return value ? (JSON.parse(value) as string) : undefined;
  };
  const chapters: Book["chapters"] = [];
  let paragraphs: string[] = [];
  const body = text.slice(front?.[0].length ?? 0);
  for (const line of body.split("\n")) {
    if (line.startsWith("# ")) {
      paragraphs = [];
      chapters.push({ title: line.slice(2).trim(), text: "" });
    } else if (line.trim() && chapters.length) {
      paragraphs.push(line.startsWith("\\#") ? line.slice(1) : line);
      chapters[chapters.length - 1].text = paragraphs.join("\n");
    }
  }
  return {
    title: meta("title") || fileName.replace(/\.[^.]+$/, ""),
    author: meta("author"),
    chapters,
  };
}

/** Writes a book as book.md, in the format of `to_markdown` in scripts/pdf_book.py. */
export function toMarkdown(book: Book): string {
  const lines = ["---", `title: ${JSON.stringify(book.title)}`];
  if (book.author) lines.push(`author: ${JSON.stringify(book.author)}`);
  lines.push("---", "");
  for (const chapter of book.chapters) {
    lines.push(`# ${oneLine(chapter.title)}`, "");
    for (const paragraph of chapter.text.split("\n")) {
      const text = oneLine(paragraph);
      if (text) lines.push(text.startsWith("#") ? `\\${text}` : text, "");
    }
  }
  return lines.join("\n");
}

function oneLine(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}
