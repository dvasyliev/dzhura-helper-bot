import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Book } from "../book/epub.ts";
import { BOOK_MD, parseMarkdown, toMarkdown } from "../book/markdown.ts";
import {
  checkChunk,
  fixApostrophes,
  hasTerm,
  loadTable,
  type Problem,
  type Replacement,
  type Term,
} from "./checks.ts";
import { assemble, paragraphs, splitChunks } from "./chunks.ts";
import { LimitError, runClaude } from "./claude.ts";
import { buildGlossary, GLOSSARY, type Glossary } from "./glossary.ts";

/** Per-book translation folders, named `<Author - Title>` after the source. */
export const TRANSLATE_DIR = "data/translate";

const PROMPT = fileURLToPath(new URL("prompt.md", import.meta.url));
const FIX_PROMPT = fileURLToPath(new URL("fix-prompt.md", import.meta.url));

export type Progress = { done: number; total: number };

type Run = typeof runClaude;

/** The shortest wait after a usage limit, so a reset time already past does not loop. */
const MIN_LIMIT_WAIT_MS = 60_000;

type Options = {
  dir: string;
  onProgress(p: Progress): Promise<void>;
  onLimit(resetAt: Date): Promise<void>;
  run?: Run;
  sleep?: (ms: number) => Promise<void>;
  pandoc?: (md: string, epub: string) => Promise<boolean>;
};

/** A chunk whose first translation had problems: what was found and what is left after the fix call. */
type ReportEntry = { chunk: string; found: Problem[]; left: Problem[] };

const PROBLEM = z.object({
  kind: z.enum([
    "latin",
    "russian-letters",
    "paragraphs",
    "glossary",
    "russianism",
    "title",
  ]),
  detail: z.string(),
});
const REPORT = z.array(
  z.object({
    chunk: z.string(),
    found: z.array(PROBLEM),
    left: z.array(PROBLEM),
  }),
);

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Builds the EPUB with pandoc; false when pandoc is not installed. */
function runPandoc(md: string, epub: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn("pandoc", [md, "-o", epub, "--metadata", "lang=uk"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") resolve(false);
      else reject(error);
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolve(true);
      else
        reject(
          new Error(
            `pandoc exited with ${code ?? signal}: ${stderr.slice(0, 500)}`,
          ),
        );
    });
  });
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Glossary terms whose source form occurs in `text` as a whole word. */
function termsIn(text: string, terms: Term[]): Term[] {
  return terms.filter((t) => hasTerm(text, t));
}

function glossaryBlock(terms: Term[]): string[] {
  if (!terms.length) return [];
  const lines = terms.map(
    (t) => `- ${t.source}: ${t.uk}${t.note ? ` (${t.note})` : ""}`,
  );
  return ["<glossary>", ...lines, "</glossary>"];
}

function translateInput(text: string, terms: Term[], context?: string): string {
  const parts = glossaryBlock(terms);
  if (context) parts.push("<context>", context, "</context>");
  parts.push("<text>", text, "</text>");
  return parts.join("\n");
}

function fixInput(
  source: string,
  translation: string,
  problems: Problem[],
  terms: Term[],
): string {
  return [
    ...glossaryBlock(terms),
    "<source>",
    source,
    "</source>",
    "<translation>",
    translation,
    "</translation>",
    "<problems>",
    ...problems.map((p) => `- ${p.kind}: ${p.detail}`),
    "</problems>",
  ].join("\n");
}

/**
 * Translates a book chunk by chunk into `opts.dir`, resuming from the chunks already translated there.
 * Returns the Ukrainian book, its EPUB path (unless pandoc is missing) and how many flagged chunks were fully fixed or still have problems.
 */
export async function translateBook(
  source: Book,
  opts: Options,
): Promise<{
  book: Book;
  epub?: string;
  report: { fixed: number; problems: number };
}> {
  const { dir, run = runClaude, sleep = sleepFor, pandoc = runPandoc } = opts;

  /** A usage limit waits for its reset and retries; any other failure gets one retry. */
  const call: Run = async (prompt, input) => {
    let failed = false;
    for (;;) {
      try {
        return await run(prompt, input);
      } catch (error) {
        if (error instanceof LimitError) {
          await opts.onLimit(error.resetAt);
          await sleep(
            Math.max(MIN_LIMIT_WAIT_MS, error.resetAt.getTime() - Date.now()),
          );
        } else if (failed) throw error;
        else failed = true;
      }
    }
  };

  await mkdir(join(dir, "chunks"), { recursive: true });
  await writeFile(join(dir, BOOK_MD), toMarkdown(source));

  const glossaryFile = join(dir, "glossary.json");
  const saved = await readIfExists(glossaryFile);
  let glossary: Glossary;
  if (saved) glossary = GLOSSARY.parse(JSON.parse(saved));
  else {
    glossary = await buildGlossary(source, call);
    await writeFile(glossaryFile, JSON.stringify(glossary, null, 2));
  }

  const reportFile = join(dir, "report.json");
  const savedReport = await readIfExists(reportFile);
  let report: ReportEntry[] = savedReport
    ? REPORT.parse(JSON.parse(savedReport))
    : [];

  const table: Replacement[] = loadTable();
  const chunks = splitChunks(source);
  const translated: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const name = String(index + 1).padStart(4, "0");
    const chunkFile = join(dir, "chunks", `${name}.md`);
    const ukFile = join(dir, "chunks", `${name}.uk.md`);
    await writeFile(chunkFile, chunk.text);
    const done = await readIfExists(ukFile);
    if (done !== undefined) {
      translated.push(done);
      continue;
    }

    const terms = termsIn(chunk.text, glossary.terms);
    const context = paragraphs(translated.at(-1) ?? "").at(-1);
    let translation = fixApostrophes(
      (await call(PROMPT, translateInput(chunk.text, terms, context))).trim(),
    );
    const found = checkChunk(
      chunk.text,
      translation,
      terms,
      table,
      chunk.first,
    );
    if (found.length) {
      const fixed = fixApostrophes(
        (
          await call(
            FIX_PROMPT,
            fixInput(chunk.text, translation, found, terms),
          )
        ).trim(),
      );
      const left = checkChunk(chunk.text, fixed, terms, table, chunk.first);
      const better = left.length < found.length;
      if (better) translation = fixed;
      report = [
        ...report.filter((r) => r.chunk !== name),
        { chunk: name, found, left: better ? left : found },
      ];
      await writeFile(reportFile, JSON.stringify(report, null, 2));
    }
    await writeFile(ukFile, translation);
    translated.push(translation);
    await opts.onProgress({ done: index + 1, total: chunks.length });
  }
  await writeFile(reportFile, JSON.stringify(report, null, 2));

  const text = assemble(glossary.title, glossary.author, translated);
  const md = join(dir, "book.uk.md");
  await writeFile(md, text);
  const epubFile = join(dir, "book.uk.epub");
  const epub = (await pandoc(md, epubFile)) ? epubFile : undefined;

  return {
    book: parseMarkdown(text),
    epub,
    report: {
      fixed: report.filter((r) => !r.left.length).length,
      problems: report.filter((r) => r.left.length).length,
    },
  };
}
