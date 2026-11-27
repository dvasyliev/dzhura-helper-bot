import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { vi } from "vitest";
import type { Book } from "../../../lib/book/epub.ts";
import type { CheckInput, Problem } from "../check.ts";
import { paragraphs } from "../chunks.ts";
import type { Progress } from "./pipeline.ts";

export const book: Book = {
  title: "Two Chapters",
  author: "Some Author",
  chapters: [
    { title: "One", text: "First paragraph.\nSecond paragraph." },
    { title: "Two", text: "Third paragraph.\nFourth paragraph." },
  ],
};

const GLOSSARY = '{"title":"Два розділи","author":"Якийсь Автор","terms":[]}';

/** The text between `<tag>` and `</tag>` in a prompt input. */
export function tagged(input: string, tag: string): string {
  return input.split(`<${tag}>\n`)[1]?.split(`\n</${tag}>`)[0] ?? "";
}

/** A fake translation that keeps the paragraph count; `drop` loses the last paragraph. */
export function translate(text: string, drop = false): string {
  const result = paragraphs(text).map((p, i) =>
    p.startsWith("# ") ? "# Розділ" : `Абзац ${i}`,
  );
  if (drop) result.pop();
  return result.join("\n\n");
}

/** A fake checker: paragraph count, title line and the word "Zzz"; it fixes ' to ʼ. */
export async function fakeCheck({ source, translation, first }: CheckInput) {
  const problems: Problem[] = [];
  if (paragraphs(source).length !== paragraphs(translation).length)
    problems.push({ kind: "paragraphs", detail: "" });
  if (first && !translation.startsWith("# "))
    problems.push({ kind: "title", detail: "" });
  if (translation.includes("Zzz"))
    problems.push({ kind: "latin", detail: "Zzz" });
  return { translation: translation.replaceAll("'", "ʼ"), problems };
}

export type Call = { prompt: string; input: string };

/** A fake `run`: `translateReply` answers translate calls by the chunk's source text. */
export function fakeRun(
  translateReply: (source: string, n: number) => string = (s) => translate(s),
  fixReply: (source: string) => string = (s) => translate(s),
) {
  const calls: Call[] = [];
  let translations = 0;
  const run = vi.fn(async (promptFile: string, input: string) => {
    const prompt = basename(promptFile);
    calls.push({ prompt, input });
    if (prompt === "glossary-prompt.md") return GLOSSARY;
    if (prompt === "fix-prompt.md") return fixReply(tagged(input, "source"));
    if (prompt === "fix-paragraphs-prompt.md")
      return [...input.matchAll(/<paragraph n="(\d+)">\n<source>\n([^\n]*)/g)]
        .map(
          ([, n, text]) =>
            `<paragraph n="${n}">\n${fixReply(text!)}\n</paragraph>`,
        )
        .join("\n");
    translations += 1;
    return translateReply(tagged(input, "text"), translations);
  });
  return { run, calls };
}

export async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "translate-"));
  const progress: Progress[] = [];
  const limits: Date[] = [];
  const sleeps: number[] = [];
  const opts = {
    dir,
    onProgress: async (p: Progress) => {
      progress.push(p);
    },
    onLimit: async (resetAt: Date) => {
      limits.push(resetAt);
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    pandoc: async () => true,
    check: fakeCheck,
    candidates: async () => [],
  };
  return { dir, opts, progress, limits, sleeps };
}

/** A fix call, of the whole chunk or of its paragraphs. */
export const isFix = (c: Call) => c.prompt.startsWith("fix");

export const isFirstChunk = (source: string) => source.startsWith("# One");
