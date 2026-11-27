import { z } from "zod";
import { runPython } from "../../lib/python/python.ts";
import { bookLanguage } from "../../lib/book/language.ts";
import type { Book } from "../../lib/book/epub.ts";
import { runClaude } from "../../lib/claude/claude.ts";
import { LANGUAGE, langFile } from "./lang.ts";
import type { Term } from "./check.ts";

const PROMPT = langFile(LANGUAGE, "glossary-prompt.md");
const MODULE = "dzhura_helper_bot.translate.glossary_candidates";

const CANDIDATE = z.object({
  term: z.string(),
  count: z.number().int(),
  context: z.string(),
});
const REPLY = z.object({ candidates: z.array(CANDIDATE) });

export type Candidate = z.infer<typeof CANDIDATE>;
export type Glossary = { title: string; author?: string; terms: Term[] };

/** Words of the book at `bookFile` (book.md) likely to need a glossary entry, from dzhura_helper_bot.translate.glossary_candidates. */
export async function candidates(
  bookFile: string,
  language?: string,
): Promise<Candidate[]> {
  let found: Candidate[] | undefined;
  for await (const reply of runPython(
    MODULE,
    {
      book: bookFile,
      language,
    },
    { schema: REPLY },
  ))
    found = reply.candidates;
  if (!found) throw new Error("glossary_candidates printed no reply");
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
