import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Book } from "../book/epub.ts";
import type { CheckInput, Problem } from "./check.ts";
import { paragraphs } from "./chunks.ts";
import { LimitError } from "./claude.ts";
import { translateBook } from "./pipeline.ts";

const book: Book = {
  title: "Two Chapters",
  author: "Some Author",
  chapters: [
    { title: "One", text: "First paragraph.\nSecond paragraph." },
    { title: "Two", text: "Third paragraph.\nFourth paragraph." },
  ],
};

const GLOSSARY = '{"title":"Два розділи","author":"Якийсь Автор","terms":[]}';

/** The text between `<tag>` and `</tag>` in a prompt input. */
function tagged(input: string, tag: string): string {
  return input.split(`<${tag}>\n`)[1]?.split(`\n</${tag}>`)[0] ?? "";
}

/** A fake translation that keeps the paragraph count; `drop` loses the last paragraph. */
function translate(text: string, drop = false): string {
  const result = paragraphs(text).map((p, i) =>
    p.startsWith("# ") ? "# Розділ" : `Абзац ${i}`,
  );
  if (drop) result.pop();
  return result.join("\n\n");
}

/** A fake checker: paragraph count, title line and the word "Zzz"; it fixes ' to ʼ. */
async function fakeCheck({ source, translation, first }: CheckInput) {
  const problems: Problem[] = [];
  if (paragraphs(source).length !== paragraphs(translation).length)
    problems.push({ kind: "paragraphs", detail: "" });
  if (first && !translation.startsWith("# "))
    problems.push({ kind: "title", detail: "" });
  if (translation.includes("Zzz"))
    problems.push({ kind: "latin", detail: "Zzz" });
  return { translation: translation.replaceAll("'", "ʼ"), problems };
}

type Call = { prompt: string; input: string };

/** A fake `run`: `translateReply` answers translate calls by the chunk's source text. */
function fakeRun(
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
    translations += 1;
    return translateReply(tagged(input, "text"), translations);
  });
  return { run, calls };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "translate-"));
  const progress: { done: number; total: number }[] = [];
  const limits: Date[] = [];
  const sleeps: number[] = [];
  const opts = {
    dir,
    onProgress: async (p: { done: number; total: number }) => {
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

const isFirstChunk = (source: string) => source.startsWith("# One");

describe("translateBook", () => {
  it("translates a two-chapter book", async () => {
    const { dir, opts, progress } = await setup();
    const { run } = fakeRun();
    const result = await translateBook(book, { ...opts, run });
    expect(result.book.title).toBe("Два розділи");
    expect(result.book.author).toBe("Якийсь Автор");
    expect(result.book.chapters).toHaveLength(2);
    expect(result.report).toEqual({ fixed: 0, problems: 0, unchecked: 0 });
    expect(result.epub).toBe(join(dir, "book.uk.epub"));
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 });
    const files = await readdir(join(dir, "chunks"));
    expect(files.sort()).toEqual(
      ["0001.md", "0001.uk.md", "0002.md", "0002.uk.md"].sort(),
    );
    for (const file of ["book.md", "glossary.json", "report.json"])
      await expect(readFile(join(dir, file), "utf8")).resolves.toBeTruthy();
    const uk = await readFile(join(dir, "book.uk.md"), "utf8");
    expect(uk).toContain("# Розділ");
  });

  it("sends the previous chunk's last paragraph as context", async () => {
    const { opts } = await setup();
    const { run, calls } = fakeRun();
    await translateBook(book, { ...opts, run });
    const second = calls.filter((c) => c.prompt === "prompt.md")[1];
    expect(tagged(second?.input ?? "", "context")).toBe("Абзац 2");
  });

  it("keeps the fix when it has fewer problems", async () => {
    const { opts } = await setup();
    const { run, calls } = fakeRun((s) => translate(s, isFirstChunk(s)));
    const result = await translateBook(book, { ...opts, run });
    expect(result.report).toEqual({ fixed: 1, problems: 0, unchecked: 0 });
    const fix = calls.find((c) => c.prompt === "fix-prompt.md");
    expect(tagged(fix?.input ?? "", "problems")).toContain("paragraphs");
  });

  it("reports a chunk the fix did not mend and still finishes", async () => {
    const { dir, opts } = await setup();
    const broken = (s: string) => `${translate(s, true)} Zzz`;
    const { run } = fakeRun(
      (s) => (isFirstChunk(s) ? broken(s) : translate(s)),
      broken,
    );
    const result = await translateBook(book, { ...opts, run });
    expect(result.report).toEqual({ fixed: 0, problems: 1, unchecked: 0 });
    expect(result.book.chapters).toHaveLength(2);
    const report = JSON.parse(
      await readFile(join(dir, "report.json"), "utf8"),
    ) as { chunk: string }[];
    expect(report.map((r) => r.chunk)).toEqual(["0001"]);
  });

  it("retries a failed check once", async () => {
    const { opts } = await setup();
    const { run, calls } = fakeRun();
    let checks = 0;
    const check = async (input: CheckInput) => {
      checks += 1;
      if (checks === 1) throw new Error("checker crashed");
      return fakeCheck(input);
    };
    const result = await translateBook(book, { ...opts, run, check });
    expect(result.report).toEqual({ fixed: 0, problems: 0, unchecked: 0 });
    expect(calls.filter((c) => c.prompt === "prompt.md")).toHaveLength(2);
  });

  it("keeps a translation the checker fails on twice and goes on", async () => {
    const { dir, opts } = await setup();
    const { run, calls } = fakeRun();
    const check = async (input: CheckInput) => {
      if (isFirstChunk(input.source)) throw new Error("checker crashed");
      return fakeCheck(input);
    };
    const result = await translateBook(book, { ...opts, run, check });
    expect(result.book.chapters).toHaveLength(2);
    expect(result.report).toEqual({ fixed: 0, problems: 0, unchecked: 1 });
    expect(calls.map((c) => c.prompt)).not.toContain("fix-prompt.md");
    const saved = await readFile(join(dir, "chunks", "0001.uk.md"), "utf8");
    expect(saved).toMatch(/^# Розділ/);
    const report = JSON.parse(
      await readFile(join(dir, "report.json"), "utf8"),
    ) as { chunk: string; left: Problem[] }[];
    expect(report).toEqual([
      {
        chunk: "0001",
        found: [{ kind: "check-failed", detail: "checker crashed" }],
        left: [{ kind: "check-failed", detail: "checker crashed" }],
      },
    ]);
  });

  it("checks again on resume a chunk the checker failed on", async () => {
    const { dir, opts } = await setup();
    const crash = async (input: CheckInput) => {
      if (isFirstChunk(input.source)) throw new Error("checker crashed");
      return fakeCheck(input);
    };
    await translateBook(book, { ...opts, run: fakeRun().run, check: crash });

    const { run, calls } = fakeRun();
    const checked: string[] = [];
    const check = async (input: CheckInput) => {
      checked.push(input.source);
      return { ...(await fakeCheck(input)), translation: "# Перевірено" };
    };
    const result = await translateBook(book, { ...opts, run, check });
    expect(calls).toEqual([]);
    expect(checked).toHaveLength(1);
    expect(isFirstChunk(checked[0] ?? "")).toBe(true);
    expect(result.report).toEqual({ fixed: 0, problems: 0, unchecked: 0 });
    expect(await readFile(join(dir, "chunks", "0001.uk.md"), "utf8")).toBe(
      "# Перевірено",
    );
    expect(
      JSON.parse(await readFile(join(dir, "report.json"), "utf8")),
    ).toEqual([]);
  });

  it("stops when the checker fails on three chunks in a row", async () => {
    const { dir, opts } = await setup();
    const long: Book = {
      title: "Four",
      chapters: ["One", "Two", "Three", "Four"].map((title) => ({
        title,
        text: `${title} text.`,
      })),
    };
    const check = async () => {
      throw new Error("no module named pymorphy3");
    };
    await expect(
      translateBook(long, { ...opts, run: fakeRun().run, check }),
    ).rejects.toThrow(/3 parts in a row.*no module named pymorphy3/);
    const saved = await readdir(join(dir, "chunks"));
    expect(saved.filter((f) => f.endsWith(".uk.md"))).toEqual([
      "0001.uk.md",
      "0002.uk.md",
      "0003.uk.md",
    ]);
  });

  it("sends a glossary term only for a chunk with its whole English word", async () => {
    const { dir, opts } = await setup();
    await writeFile(
      join(dir, "glossary.json"),
      JSON.stringify({
        title: "Два",
        terms: [{ source: "Brazil", uk: "Бразилія" }],
      }),
    );
    const english: Book = {
      title: "Two",
      chapters: [
        { title: "One", text: "He went to Brazil with the man and his son." },
        { title: "Two", text: "The Brazilian was in the house of the man." },
      ],
    };
    const { run, calls } = fakeRun();
    await translateBook(english, { ...opts, run });
    const inputs = calls.filter((c) => c.prompt === "prompt.md");
    expect(inputs.map((c) => c.input.includes("Brazil: Бразилія"))).toEqual([
      true,
      false,
    ]);
  });

  it("retries a failed call once", async () => {
    const { opts } = await setup();
    const { run } = fakeRun((s, n) => {
      if (n === 2) throw new Error("boom");
      return translate(s);
    });
    const result = await translateBook(book, { ...opts, run });
    expect(result.book.chapters).toHaveLength(2);
  });

  it("stops after a second failure and resumes where it stopped", async () => {
    const { opts } = await setup();
    const failing = fakeRun((s, n) => {
      if (n >= 2) throw new Error("boom");
      return translate(s);
    });
    await expect(
      translateBook(book, { ...opts, run: failing.run }),
    ).rejects.toThrow("boom");

    const { run, calls } = fakeRun();
    const result = await translateBook(book, { ...opts, run });
    expect(result.book.chapters).toHaveLength(2);
    expect(calls.map((c) => c.prompt)).toEqual(["prompt.md"]);
    expect(tagged(calls[0]?.input ?? "", "text")).toContain("# Two");
  });

  it("waits out the usage limit and retries the same call", async () => {
    const { opts, limits, sleeps } = await setup();
    const resetAt = new Date(Date.now() + 60_000);
    const { run } = fakeRun((s, n) => {
      if (n === 1) throw new LimitError(resetAt);
      return translate(s);
    });
    const result = await translateBook(book, { ...opts, run });
    expect(limits).toEqual([resetAt]);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(50_000);
    expect(sleeps[0]).toBeLessThanOrEqual(60_000);
    expect(result.book.chapters).toHaveLength(2);
  });

  it("waits at least a minute when the reset time has already passed", async () => {
    const { opts, sleeps } = await setup();
    const { run } = fakeRun((s, n) => {
      if (n === 1) throw new LimitError(new Date(Date.now() - 1000));
      return translate(s);
    });
    await translateBook(book, { ...opts, run });
    expect(sleeps[0]).toBeGreaterThanOrEqual(60_000);
  });

  it("flags a first chunk that lost its title line", async () => {
    const { opts } = await setup();
    const { run, calls } = fakeRun((s) =>
      isFirstChunk(s) ? translate(s).replace("# ", "") : translate(s),
    );
    const result = await translateBook(book, { ...opts, run });
    expect(result.report).toEqual({ fixed: 1, problems: 0, unchecked: 0 });
    const fix = calls.find((c) => c.prompt === "fix-prompt.md");
    expect(tagged(fix?.input ?? "", "problems")).toContain("title");
  });

  it("saves the checker's text and calls the fix only for a chunk with problems", async () => {
    const { dir, opts } = await setup();
    const apostrophe = (s: string) => translate(s).replace("Абзац", "П'ять");
    const { run, calls } = fakeRun(
      (s) => (isFirstChunk(s) ? translate(s, true) : apostrophe(s)),
      apostrophe,
    );
    await translateBook(book, { ...opts, run });
    for (const name of ["0001.uk.md", "0002.uk.md"])
      expect(await readFile(join(dir, "chunks", name), "utf8")).toContain(
        "Пʼять",
      );
    expect(calls.filter((c) => c.prompt === "fix-prompt.md")).toHaveLength(1);
  });

  it("returns the book without an EPUB when pandoc is missing", async () => {
    const { opts } = await setup();
    const { run } = fakeRun();
    const result = await translateBook(book, {
      ...opts,
      run,
      pandoc: async () => false,
    });
    expect(result.epub).toBeUndefined();
    expect(result.book.chapters).toHaveLength(2);
  });
});
