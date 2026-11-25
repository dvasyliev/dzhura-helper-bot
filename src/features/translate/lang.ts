import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** The language books are translated into: its folder under lang/. */
export const LANGUAGE = "uk";

/** The path of `name` in lang/<code>/. */
export function langFile(code: string, name: string): string {
  return fileURLToPath(new URL(`lang/${code}/${name}`, import.meta.url));
}

/**
 * How a glossary term is found in a book's text: "whole" words (English: Fogg, Fogg's; not Brazil in Brazilian), or
 * by "stem" for a language that declines names. Same values as `TermMatch` in scripts/language.py.
 */
export type TermMatch = "whole" | "stem";

const SOURCE = z.object({
  term_match: z.enum(["whole", "stem"]).default("stem"),
});

/** The `term_match` of lang/<code>/language.json; "stem" for a language without one. */
export async function termMatch(code?: string): Promise<TermMatch> {
  if (!code) return "stem";
  const text = await readFile(langFile(code, "language.json"), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "{}";
      throw error;
    },
  );
  return SOURCE.parse(JSON.parse(text)).term_match;
}
