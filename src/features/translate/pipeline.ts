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
import {
  applyParagraphFix,
  fixInput,
  glossaryBlock,
  paragraphFixInput,
  problemParagraphs,
} from "./fix.ts";
import { LimitError, runClaude, type Usage } from "./claude.ts";
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
const FIX_PARAGRAPHS_PROMPT = langFile(LANGUAGE, "fix-paragraphs-prompt.md");

/** Parts done of all, and Claude's usage for the book so far (from the first part done in this run). */
export type Progress = { done: number; total: number; usage?: Usage };

type Run = typeof runClaude;

/** The shortest wait after a usage limit, so a reset time already past does not loop. */
const MIN_LIMIT_WAIT_MS = 60_000;
/** Problems that are always real errors, worth a second fix call when the first one leaves them. */
const HARD_KINDS = new Set<Problem["kind"]>(["latin", "russian-letters"]);

/** This many chunks in a row the checker fails on mean the Python side is broken: the translation stops. */
const MAX_FAILED_CHECKS = 3;

/** Chunks translated at once, each by its own `claude -p`. */
const PARALLEL = 8;

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

const USAGE = z.object({
  calls: z.number(),
  input: z.number(),
  output: z.number(),
  cacheWrite: z.number(),
  cacheRead: z.number(),
  costUsd: z.number(),
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

function translateInput(text: string, terms: Term[], context?: string): string {
  const parts = glossaryBlock(terms);
  if (context) parts.push("<context>", context, "</context>");
  parts.push("<text>", text, "</text>");
  return parts.join("\n");
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
  usage: Usage;
}> {
  const {
    dir,
    run = runClaude,
    sleep = sleepFor,
    pandoc = runPandoc,
    check = checkChunk,
    candidates: findCandidates = candidates,
  } = opts;

  /** Claude's usage for the whole book, kept in usage.json so a resumed translation adds to it. */
  const usageFile = join(dir, "usage.json");
  const savedUsage = await readIfExists(usageFile);
  const usage: Usage = savedUsage
    ? USAGE.parse(JSON.parse(savedUsage))
    : {
        calls: 0,
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        costUsd: 0,
      };
  let savingUsage = Promise.resolve();
  const addUsage = (one: Usage) => {
    for (const key of Object.keys(usage) as (keyof Usage)[])
      usage[key] += one[key];
    savingUsage = savingUsage.then(() =>
      writeFile(usageFile, JSON.stringify(usage, null, 2)),
    );
  };

  /** The wait for a usage limit's reset; calls hitting the limit while it runs share it. */
  let limitWait: Promise<void> | undefined;
  const waitForReset = (resetAt: Date) =>
    (limitWait ??= (async () => {
      await opts.onLimit(resetAt);
      await sleep(Math.max(MIN_LIMIT_WAIT_MS, resetAt.getTime() - Date.now()));
    })().finally(() => (limitWait = undefined)));

  /** A usage limit waits for its reset and retries; any other failure gets one retry. */
  const call: Run = async (prompt, input) => {
    let failed = false;
    for (;;) {
      try {
        return await run(prompt, input, addUsage);
      } catch (error) {
        if (error instanceof LimitError) await waitForReset(error.resetAt);
        else if (failed) throw error;
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

  /** Chunks finish at once, so report.json is written one save after another, each with the latest report. */
  let saving = Promise.resolve();
  const saveReport = () =>
    (saving = saving.then(() =>
      writeFile(reportFile, JSON.stringify(report, null, 2)),
    ));

  const unchecked = (entry?: ReportEntry) =>
    !!entry?.left.some((p) => p.kind === "check-failed");

  /**
   * Checks a translation and, when problems remain, asks for a fix; a second fix only when Latin or Russian
   * letters survive the first. Records the chunk in report.json.
   */
  const match = await termMatch(
    bookLanguage(source.chapters.map((c) => c.text).join("\n")),
  );

  /**
   * One fix call: only the paragraphs with problems when they can be placed, else the whole chunk. A paragraph
   * reply that doesn't fit leaves the translation as it was.
   */
  const fix = async (
    source: string,
    translation: string,
    problems: Problem[],
    terms: Term[],
  ): Promise<string> => {
    const sourceParts = paragraphs(source);
    const parts = paragraphs(translation);
    const indices = problemParagraphs(
      problems,
      sourceParts,
      parts,
      terms,
      match,
    );
    if (!indices)
      return (
        await call(FIX_PROMPT, fixInput(source, translation, problems, terms))
      ).trim();
    const reply = await call(
      FIX_PARAGRAPHS_PROMPT,
      paragraphFixInput(sourceParts, parts, indices, problems, terms),
    );
    return applyParagraphFix(parts, indices, reply) ?? translation;
  };

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
        translation: await fix(chunk.text, translation, left, terms),
      });
      const fixFailed = fixed.problems.some((p) => p.kind === "check-failed");
      if (!fixFailed && fixed.problems.length < left.length) {
        translation = fixed.translation;
        left = fixed.problems;
      }
    }
    report = report.filter((r) => r.chunk !== name);
    if (found.length) report.push({ chunk: name, found, left });
    await saveReport();
    return { translation, failed };
  };

  const chunks = splitChunks(source);
  const translated: string[] = [];
  let finished = 0;
  let failedInRow = 0;
  let stop: unknown;

  /** Translates, checks and saves chunk `index`, unless it is already done. */
  const translateChunk = async (index: number) => {
    const chunk = chunks[index]!;
    const name = String(index + 1).padStart(4, "0");
    const chunkFile = join(dir, "chunks", `${name}.md`);
    const ukFile = join(dir, "chunks", `${name}.uk.md`);
    await writeFile(chunkFile, chunk.text);
    const done = await readIfExists(ukFile);
    const recheck = unchecked(report.find((r) => r.chunk === name));
    if (done !== undefined && !recheck) {
      translated[index] = done;
      return;
    }

    const terms = termsIn(chunk.text, glossary.terms, match);
    // The previous chunk's source: its translation may still be running.
    const context = paragraphs(chunks[index - 1]?.text ?? "").at(-1);
    const raw =
      done ??
      (await call(PROMPT, translateInput(chunk.text, terms, context))).trim();
    const { translation, failed } = await checkAndFix(name, chunk, terms, raw);
    await writeFile(ukFile, translation);
    translated[index] = translation;
    failedInRow = failed ? failedInRow + 1 : 0;
    if (failedInRow >= MAX_FAILED_CHECKS) {
      const detail = report.find((r) => r.chunk === name)?.left[0]?.detail;
      throw new Error(
        `The chunk checker failed on ${MAX_FAILED_CHECKS} parts in a row (${detail}); the Python side looks broken. The parts are saved and get checked when the translation continues`,
      );
    }
  };

  /** Takes the next chunk until none is left; the first error stops new chunks, the running ones finish. */
  let next = 0;
  const worker = async () => {
    while (stop === undefined && next < chunks.length) {
      const index = next++;
      try {
        await translateChunk(index);
      } catch (error) {
        stop ??= error;
        return;
      }
      finished += 1;
      await opts.onProgress({
        done: finished,
        total: chunks.length,
        usage: { ...usage },
      });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (stop !== undefined) throw stop;
  await saveReport();

  const text = assemble(glossary.title, glossary.author, translated);
  const md = join(dir, "book.uk.md");
  await writeFile(md, text);
  const epubFile = join(dir, "book.uk.epub");
  const epub = (await pandoc(md, epubFile)) ? epubFile : undefined;

  await savingUsage;
  return {
    book: parseMarkdown(text),
    epub,
    usage,
    report: {
      fixed: report.filter((r) => !r.left.length).length,
      problems: report.filter((r) => r.left.length && !unchecked(r)).length,
      unchecked: report.filter(unchecked).length,
    },
  };
}
