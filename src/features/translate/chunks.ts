import type { Book } from "../book/epub.ts";
import { markdownParagraph, toMarkdown } from "../book/markdown.ts";

/** A chunk is sent to the model in one request; a single longer paragraph still goes whole. */
export const MAX_CHUNK_CHARS = 6000;

/** A piece of a chapter; `first` chunks start with the chapter's `# <title>` line. */
export type Chunk = { chapter: number; first: boolean; text: string };

/** Splits text on blank lines; paragraphs are trimmed and empty ones dropped. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** Cuts every chapter into chunks of whole paragraphs, each at most MAX_CHUNK_CHARS long when it can be. */
export function splitChunks(book: Book): Chunk[] {
  const chunks: Chunk[] = [];
  book.chapters.forEach((chapter, index) => {
    let current = `# ${chapter.title}`;
    let first = true;
    const lines = chapter.text
      .split("\n")
      .map(markdownParagraph)
      .filter(Boolean);
    for (const line of lines) {
      if (current && current.length + 2 + line.length > MAX_CHUNK_CHARS) {
        chunks.push({ chapter: index, first, text: current });
        first = false;
        current = "";
      }
      current = current ? `${current}\n\n${line}` : line;
    }
    chunks.push({ chapter: index, first, text: current });
  });
  return chunks;
}

/** Writes the translated chunks as the text of book.uk.md: front matter, then the chunks. */
export function assemble(
  title: string,
  author: string | undefined,
  translated: string[],
): string {
  return `${toMarkdown({ title, author, chapters: [] })}\n${translated.join("\n\n")}\n`;
}
