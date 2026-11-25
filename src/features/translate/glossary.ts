import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runPython } from "../../python.ts";
import { bookLanguage } from "../audiobook/text.ts";
import type { Book } from "../book/epub.ts";
import { runClaude } from "./claude.ts";
import { LANGUAGE, langFile } from "./lang.ts";
import type { Term } from "./check.ts";

const PROMPT = langFile(LANGUAGE, "glossary-prompt.md");
const SCRIPT = fileURLToPath(
  new URL("scripts/glossary_candidates.py", import.meta.url),
);

const CANDIDATE = z.object({
  term: z.string(),
  count: z.number().int(),
  context: z.string(),
});
const REPLY = z.object({ candidates: z.array(CANDIDATE) });

export type Candidate = z.infer<typeof CANDIDATE>;
export type Glossary = { title: string; author?: string; terms: Term[] };

/** Words of the book at `bookFile` (book.md) likely to need a glossary entry, from scripts/glossary_candidates.py. */
export async function candidates(
  bookFile: string,
  language?: string,
): Promise<Candidate[]> {
  let found: Candidate[] | undefined;
  for await (const reply of runPython(SCRIPT, { book: bookFile, language }))
    found = REPLY.parse(reply).candidates;
  if (!found) throw new Error("glossary_candidates.py printed no reply");
  return found;
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

/** Asks Claude once for the Ukrainian forms of the book's title, author and recurring names; `bookFile` is its book.md. */
export async function buildGlossary(
  book: Book,
  bookFile: string,
  run = runClaude,
  find = candidates,
): Promise<Glossary> {
  const sample = book.chapters.map((c) => c.text).join("\n");
  const language = bookLanguage(sample);
  const lines = (await find(bookFile, language)).map(
    (c) => `- ${c.term} (${c.count}): ${c.context}`,
  );
  const input = [
    `Title: ${book.title}`,
    `Author: ${book.author ?? "unknown"}`,
    `Source language: ${language ?? "unknown"}`,
    "Candidates:",
    ...lines,
  ].join("\n");
  const reply = await run(PROMPT, input);
  return GLOSSARY.parse(JSON.parse(firstJsonObject(reply)));
}
