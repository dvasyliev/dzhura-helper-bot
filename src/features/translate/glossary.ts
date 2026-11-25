import { z } from "zod";
import { bookLanguage } from "../audiobook/text.ts";
import type { Book } from "../book/epub.ts";
import { runClaude } from "./claude.ts";
import type { Term } from "./checks.ts";

const MAX_CANDIDATES = 300;
const MIN_COUNT = 2;
const MIN_TITLE_WORD = 3;
const CONTEXT_CHARS = 60;
const PROMPT = new URL("glossary-prompt.md", import.meta.url).pathname;

export type Candidate = { term: string; count: number; context: string };
export type Glossary = { title: string; author?: string; terms: Term[] };

const CAPITALISED = /\p{Lu}[\p{L}'’-]*/gu;
const TITLES = /\b(?:Mr|Mrs|Ms|Dr|St|Sr|Jr|Prof|Capt|Col|Gen|Lt)\.\s*$/;

/** Is the word at `index` the first word of a sentence (so its capital tells nothing)? */
function startsSentence(text: string, index: number): boolean {
  const before = text.slice(0, index);
  if (!before.trim()) return true;
  if (TITLES.test(before)) return false;
  return /[.!?…]["”»)]*\s*$/.test(before) || /(^|\n)\s*["“«(]*$/.test(before);
}

/** Capitalised words that appear mid-sentence at least twice: likely names. Most frequent first, at most 300. */
export function candidates(book: Book): Candidate[] {
  const found = new Map<string, Candidate>();
  const scan = (text: string, ignoreStart: boolean) => {
    for (const match of text.matchAll(CAPITALISED)) {
      if (!ignoreStart && startsSentence(text, match.index)) continue;
      const term = match[0];
      const known = found.get(term);
      if (known) known.count += 1;
      else {
        const from = Math.max(0, match.index - CONTEXT_CHARS);
        const context = text
          .slice(from, match.index + term.length + CONTEXT_CHARS)
          .replace(/\s+/g, " ")
          .trim();
        found.set(term, { term, count: 1, context });
      }
    }
  };
  scan(book.title, true);
  for (const chapter of book.chapters) scan(chapter.text, false);
  const titleWords = new Set(
    (book.title.match(/\p{L}[\p{L}'’-]*/gu) ?? []).filter(
      (w) => w.length > MIN_TITLE_WORD,
    ),
  );
  for (const word of titleWords) {
    if (!found.has(word))
      found.set(word, { term: word, count: 0, context: book.title });
  }
  const byCount = (a: Candidate, b: Candidate) => b.count - a.count;
  const all = [...found.values()];
  const fromTitle = all.filter((c) => titleWords.has(c.term)).sort(byCount);
  const others = all
    .filter((c) => !titleWords.has(c.term) && c.count >= MIN_COUNT)
    .sort(byCount);
  return [...fromTitle, ...others].slice(0, MAX_CANDIDATES);
}

export const GLOSSARY = z.object({
  title: z.string(),
  author: z.string().optional(),
  terms: z.array(
    z.object({
      source: z.string(),
      uk: z.string(),
      note: z.string().optional(),
    }),
  ),
});

/** The first top-level `{...}` of `text`, found by balancing braces outside strings. */
function firstJsonObject(text: string): string {
  const start = text.indexOf("{");
  let depth = 0;
  let inString = false;
  for (let i = start; start >= 0 && i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error("No JSON object in the glossary reply");
}

/** Asks Claude once for the Ukrainian forms of the book's title, author and recurring names. */
export async function buildGlossary(
  book: Book,
  run = runClaude,
): Promise<Glossary> {
  const sample = book.chapters.map((c) => c.text).join("\n");
  const lines = candidates(book).map(
    (c) => `- ${c.term} (${c.count}): ${c.context}`,
  );
  const input = [
    `Title: ${book.title}`,
    `Author: ${book.author ?? "unknown"}`,
    `Source language: ${bookLanguage(sample) ?? "unknown"}`,
    "Candidates:",
    ...lines,
  ].join("\n");
  const reply = await run(PROMPT, input);
  return GLOSSARY.parse(JSON.parse(firstJsonObject(reply)));
}
