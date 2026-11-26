import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Book } from "../book/epub.ts";
import type { CheckInput, Problem } from "./check.ts";
import { LimitError } from "./claude.ts";
import { translateBook } from "./pipeline.ts";
import {
  book,
  fakeCheck,
  fakeRun,
  isFirstChunk,
  isFix,
  setup,
  tagged,
  translate,
} from "./pipeline.testing.ts";

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
    expect(progress.at(-1)).toMatchObject({ done: 2, total: 2 });
    const files = await readdir(join(dir, "chunks"));
    expect(files.sort()).toEqual(
      ["0001.md", "0001.uk.md", "0002.md", "0002.uk.md"].sort(),
    );
    for (const file of ["book.md", "glossary.json", "report.json"])
      await expect(readFile(join(dir, file), "utf8")).resolves.toBeTruthy();
    const uk = await readFile(join(dir, "book.uk.md"), "utf8");
    expect(uk).toContain("# Розділ");
  });

  it("sends the previous chunk's last source paragraph as context", async () => {
    const { opts } = await setup();
    const { run, calls } = fakeRun();
    await translateBook(book, { ...opts, run });
    const second = calls.find((c) =>
      tagged(c.input, "text").startsWith("# Two"),
    );
    expect(tagged(second?.input ?? "", "context")).toBe("Second paragraph.");
  });

  it("keeps the fix when it has fewer problems", async () => {
    const { opts } = await setup();
    const { run, calls } = fakeRun((s) => translate(s, isFirstChunk(s)));
    const result = await translateBook(book, { ...opts, run });
    expect(result.report).toEqual({ fixed: 1, problems: 0, unchecked: 0 });
    const fix = calls.find((c) => isFix(c));
    expect(tagged(fix?.input ?? "", "problems")).toContain("paragraphs");
  });

  it("asks for a second fix when Latin or Russian letters survive the first", async () => {
    const { opts } = await setup();
    let fixes = 0;
    const { run, calls } = fakeRun(
      (s) => `${translate(s)}${isFirstChunk(s) ? " Zzz" : ""}`,
      (s) => {
        fixes += 1;
        return fixes === 1 ? `${translate(s)} Zzz` : translate(s);
      },
    );
    const result = await translateBook(book, { ...opts, run });
    // Latin letters sit in one paragraph: only it goes to the fix, not the whole chunk.
    expect(calls.filter((c) => isFix(c)).map((c) => c.prompt)).toEqual([
      "fix-paragraphs-prompt.md",
      "fix-paragraphs-prompt.md",
    ]);
    expect(calls.find((c) => isFix(c))?.input).not.toContain("# One");
    expect(result.report).toEqual({ fixed: 1, problems: 0, unchecked: 0 });
    expect(result.book.chapters[0]?.text).not.toContain("Zzz");
  });

  it("makes no second fix when only other problems are left", async () => {
    const { opts } = await setup();
    const { run, calls } = fakeRun(
      (s) => translate(s, isFirstChunk(s)),
      (s) => translate(s, true),
    );
    const result = await translateBook(book, { ...opts, run });
    expect(calls.filter((c) => isFix(c))).toHaveLength(1);
    expect(result.report).toEqual({ fixed: 0, problems: 1, unchecked: 0 });
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
    expect(calls.filter((c) => isFix(c))).toEqual([]);
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
      title: "Many",
      chapters: Array.from({ length: 20 }, (_, i) => ({
        title: `Chapter ${i + 1}`,
        text: "Some text.",
      })),
    };
    const check = async () => {
      throw new Error("no module named pymorphy3");
    };
    await expect(
      translateBook(long, { ...opts, run: fakeRun().run, check }),
    ).rejects.toThrow(/3 parts in a row.*no module named pymorphy3/);
    // The chunks already running finish and are kept; no new one starts.
    const saved = await readdir(join(dir, "chunks"));
    expect(saved.filter((f) => f.endsWith(".uk.md")).length).toBeLessThan(20);
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
    // Chunks run at once, so the calls come in any order.
    const inputs = calls
      .filter((c) => c.prompt === "prompt.md")
      .sort((a, b) =>
        tagged(a.input, "text").localeCompare(tagged(b.input, "text")),
      );
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
    const failing = fakeRun((s) => {
      if (s.startsWith("# Two")) throw new Error("boom");
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
    const fix = calls.find((c) => isFix(c));
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
    expect(calls.filter((c) => isFix(c))).toHaveLength(1);
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
