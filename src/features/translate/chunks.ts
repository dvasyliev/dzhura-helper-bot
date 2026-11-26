import type { Book } from "../book/epub.ts";
import {
  headingMarks,
  markdownParagraph,
  toMarkdown,
} from "../book/markdown.ts";

/** A chunk is sent to the model in one request; a single longer paragraph still goes whole. */
export const MAX_CHUNK_CHARS = 6000;

/** A piece of a chapter; `first` chunks start with the chapter's `# <title>` line (`##`, `###` for a section). */
export type Chunk = {
  chapter: number;
  title: string;
  first: boolean;
  text: string;
};

/** Titles in chunk file names are cut to this many characters. */
const MAX_TITLE_CHARS = 60;

/**
 * File name (without extension) of chunk `index`, lowercase words joined by hyphens: «0007-chapter-title», with «-2»
 * for the second piece of a chapter cut into several. The number keeps the files in reading order.
 */
export function chunkFileName(chunks: Chunk[], index: number): string {
  const chunk = chunks[index]!;
  const pieces = chunks.filter((c) => c.chapter === chunk.chapter);
  const piece = pieces.length > 1 ? `-${pieces.indexOf(chunk) + 1}` : "";
  const title = slug(chunk.title).slice(0, MAX_TITLE_CHARS).replace(/-+$/, "");
  return (
    [String(index + 1).padStart(4, "0"), title].filter(Boolean).join("-") +
    piece
  );
}

/** Lowercase letters and digits, every other run of characters one hyphen. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

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
    let current = `${headingMarks(chapter.level)} ${chapter.title}`;
    let first = true;
    const lines = chapter.text
      .split("\n")
      .map(markdownParagraph)
      .filter(Boolean);
    for (const line of lines) {
      if (current && current.length + 2 + line.length > MAX_CHUNK_CHARS) {
        chunks.push({
          chapter: index,
          title: chapter.title,
          first,
          text: current,
        });
        first = false;
        current = "";
      }
      current = current ? `${current}\n\n${line}` : line;
    }
    chunks.push({ chapter: index, title: chapter.title, first, text: current });
  });
  return chunks;
}

/** Writes the translated chunks as the text of the translation's book.md: front matter, then the chunks. */
export function assemble(
  title: string,
  author: string | undefined,
  translated: string[],
): string {
  return `${toMarkdown({ title, author, chapters: [] })}\n${translated.join("\n\n")}\n`;
}
