import pRetry from "p-retry";
import { z } from "zod";
import { runPython } from "../../lib/python/python.ts";
import type { TermMatch } from "./lang.ts";

/** A glossary entry: how a source name or term must be written in Ukrainian. */
export type Term = { source: string; uk: string; note?: string };

export const PROBLEM = z.object({
  kind: z.enum([
    "latin",
    "russian-letters",
    "paragraphs",
    "glossary",
    "russianism",
    "title",
    "check-failed",
  ]),
  detail: z.string(),
});

export type Problem = z.infer<typeof PROBLEM>;

export type CheckInput = {
  source: string;
  translation: string;
  /** The glossary terms whose source form occurs in `source` (see `hasTerm`). */
  terms: Term[];
  /** Whether the chunk opens a chapter and so must start with its `# ` title line. */
  first: boolean;
  /** The translation's language: its folder under lang/ ("uk"). */
  language: string;
};

/** The translation after the automatic typography fixes, and the problems left in it. */
export type CheckResult = { translation: string; problems: Problem[] };

const MODULE = "dzhura_helper_bot.translate.chunk_check";
const REPLY = z.object({
  translation: z.string(),
  problems: z.array(PROBLEM),
});

/**
 * A word of a glossary term, as `word_pattern` in dzhura_helper_bot.translate.checks: "whole", the word itself; "stem", its stem (all
 * but the last two letters, at least four) and at most three letters more than the word has.
 */
function wordPattern(word: string, match: TermMatch): string {
  if (match === "whole") return RegExp.escape(word);
  const stem = word.slice(0, Math.max(word.length - 2, 4));
  return `${RegExp.escape(stem)}\\p{L}{0,${word.length + 3 - stem.length}}`;
}

/**
 * Whether a term's source form occurs in `text`: each of its words in a row, starting at a word boundary and matched
 * by `wordPattern` with the book language's `match` (see lang.ts). A name (capital first letter) must match its case.
 */
export function hasTerm(text: string, term: Term, match: TermMatch): boolean {
  const words = term.source.match(/\p{L}+/gu);
  if (!words) return false;
  const name = /^\p{Lu}/u.test(term.source);
  const pattern = words.map((w) => wordPattern(w, match)).join("\\P{L}{1,3}");
  return new RegExp(`(?<!\\p{L})${pattern}(?!\\p{L})`, name ? "u" : "iu").test(
    text,
  );
}

/** Fixes the typography of a translated chunk and checks it against its source, in dzhura_helper_bot.translate.chunk_check. */
export function checkChunk(
  input: CheckInput,
  { retryMs = 1000 }: { retryMs?: number } = {},
): Promise<CheckResult> {
  return pRetry(
    async () => {
      let result: CheckResult | undefined;
      for await (const reply of runPython(MODULE, input, { schema: REPLY }))
        result = reply;
      if (!result) throw new Error("chunk_check printed no reply");
      return result;
    },
    { retries: 1, minTimeout: retryMs, randomize: true },
  );
}
