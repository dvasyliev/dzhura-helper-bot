import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { bookLanguage } from "../audiobook/text.ts";
import type { Book } from "../book/epub.ts";
import { BOOK_MD, parseMarkdown, toMarkdown } from "../book/markdown.ts";
import {
  checkChunk,
  hasTerm,
  PROBLEM,
  type CheckInput,
  type CheckResult,
  type Problem,
  type Term,
} from "./check.ts";
import { assemble, paragraphs, splitChunks, type Chunk } from "./chunks.ts";
import { LimitError, runClaude } from "./claude.ts";
import { LANGUAGE, langFile, termMatch, type TermMatch } from "./lang.ts";
import {
  buildGlossary,
  candidates,
  GLOSSARY,
  type Glossary,
} from "./glossary.ts";

/** Per-book translation folders, named `<Author - Title>` after the source. */
export const TRANSLATE_DIR = "data/translate";

const PROMPT = langFile(LANGUAGE, "prompt.md");
const FIX_PROMPT = langFile(LANGUAGE, "fix-prompt.md");

export type Progress = { done: number; total: number };

type Run = typeof runClaude;

/** The shortest wait after a usage limit, so a reset time already past does not loop. */
const MIN_LIMIT_WAIT_MS = 60_000;
/** Problems that are always real errors, worth a second fix call when the first one leaves them. */
const HARD_KINDS = new Set<Problem["kind"]>(["latin", "russian-letters"]);

/** This many chunks in a row the checker fails on mean the Python side is broken: the translation stops. */
const MAX_FAILED_CHECKS = 3;

type Options = {
  dir: string;
  onProgress(p: Progress): Promise<void>;
  onLimit(resetAt: Date): Promise<void>;
  run?: Run;
  sleep?: (ms: number) => Promise<void>;
  pandoc?: (md: string, epub: string) => Promise<boolean>;
  check?: (input: CheckInput) => Promise<CheckResult>;
  candidates?: typeof candidates;
};

/** A chunk whose first translation had problems: what was found and what is left after the fix calls. */
type ReportEntry = { chunk: string; found: Problem[]; left: Problem[] };

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
    const child = spawn(
      "pandoc",
      [md, "-o", epub, "--metadata", `lang=${LANGUAGE}`],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
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

/** Glossary terms whose source form occurs in `text` (see `hasTerm`). */
function termsIn(text: string, terms: Term[], match: TermMatch): Term[] {
  return terms.filter((t) => hasTerm(text, t, match));
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
  report: { fixed: number; problems: number; unchecked: number };
}> {
  const {
    dir,
    run = runClaude,
    sleep = sleepFor,
    pandoc = runPandoc,
    check = checkChunk,
    candidates: findCandidates = candidates,
  } = opts;

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

  /**
   * The checker, retried once. When it fails twice the translation is kept unchecked, with a `check-failed`
   * problem, so a paid translation is never thrown away and the book goes on.
   */
  const checkOrKeep = async (input: CheckInput): Promise<CheckResult> => {
    try {
      return await check(input).catch(() => check(input));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        translation: input.translation,
        problems: [{ kind: "check-failed", detail }],
      };
    }
  };

  await mkdir(join(dir, "chunks"), { recursive: true });
  await writeFile(join(dir, BOOK_MD), toMarkdown(source));

  const glossaryFile = join(dir, "glossary.json");
  const saved = await readIfExists(glossaryFile);
  let glossary: Glossary;
  if (saved) glossary = GLOSSARY.parse(JSON.parse(saved));
  else {
    glossary = await buildGlossary(
      source,
      join(dir, BOOK_MD),
      call,
      findCandidates,
    );
    await writeFile(glossaryFile, JSON.stringify(glossary, null, 2));
  }

  const reportFile = join(dir, "report.json");
  const savedReport = await readIfExists(reportFile);
  let report: ReportEntry[] = savedReport
    ? REPORT.parse(JSON.parse(savedReport))
    : [];

  const unchecked = (entry?: ReportEntry) =>
    !!entry?.left.some((p) => p.kind === "check-failed");

  /**
   * Checks a translation and, when problems remain, asks for a fix; a second fix only when Latin or Russian
   * letters survive the first. Records the chunk in report.json.
   */
  const checkAndFix = async (
    name: string,
    chunk: Chunk,
    terms: Term[],
    raw: string,
  ): Promise<{ translation: string; failed: boolean }> => {
    const input = {
      source: chunk.text,
      terms,
      first: chunk.first,
      language: LANGUAGE,
    };
    const checked = await checkOrKeep({ ...input, translation: raw });
    let translation = checked.translation;
    const found = checked.problems;
    const failed = found.some((p) => p.kind === "check-failed");
    let left = found;
    for (let round = 1; round <= 2 && left.length && !failed; round++) {
      if (round === 2 && !left.some((p) => HARD_KINDS.has(p.kind))) break;
      const fixed = await checkOrKeep({
        ...input,
        translation: (
          await call(FIX_PROMPT, fixInput(chunk.text, translation, left, terms))
        ).trim(),
      });
      const fixFailed = fixed.problems.some((p) => p.kind === "check-failed");
      if (!fixFailed && fixed.problems.length < left.length) {
        translation = fixed.translation;
        left = fixed.problems;
      }
    }
    report = report.filter((r) => r.chunk !== name);
    if (found.length) report.push({ chunk: name, found, left });
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    return { translation, failed };
  };

  const match = await termMatch(
    bookLanguage(source.chapters.map((c) => c.text).join("\n")),
  );
  const chunks = splitChunks(source);
  const translated: string[] = [];
  let failedInRow = 0;
  for (const [index, chunk] of chunks.entries()) {
    const name = String(index + 1).padStart(4, "0");
    const chunkFile = join(dir, "chunks", `${name}.md`);
    const ukFile = join(dir, "chunks", `${name}.uk.md`);
    await writeFile(chunkFile, chunk.text);
    const done = await readIfExists(ukFile);
    const recheck = unchecked(report.find((r) => r.chunk === name));
    if (done !== undefined && !recheck) {
      translated.push(done);
      continue;
    }

    const terms = termsIn(chunk.text, glossary.terms, match);
    const context = paragraphs(translated.at(-1) ?? "").at(-1);
    const raw =
      done ??
      (await call(PROMPT, translateInput(chunk.text, terms, context))).trim();
    const { translation, failed } = await checkAndFix(name, chunk, terms, raw);
    await writeFile(ukFile, translation);
    translated.push(translation);
    failedInRow = failed ? failedInRow + 1 : 0;
    if (failedInRow >= MAX_FAILED_CHECKS) {
      const detail = report.find((r) => r.chunk === name)?.left[0]?.detail;
      throw new Error(
        `The chunk checker failed on ${MAX_FAILED_CHECKS} parts in a row (${detail}); the Python side looks broken. The parts are saved and get checked when the translation continues`,
      );
    }
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
      problems: report.filter((r) => r.left.length && !unchecked(r)).length,
      unchecked: report.filter(unchecked).length,
    },
  };
}
