import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Book } from "../book/epub.ts";
import { LimitError, type Usage } from "./claude.ts";
import { translateBook } from "./pipeline.ts";
import { book, fakeRun, setup, translate } from "./pipeline.testing.ts";

describe("translateBook, chunks at once", () => {
  it("translates up to eight chunks at once", async () => {
    const { opts, progress } = await setup();
    const many: Book = {
      title: "Many",
      chapters: Array.from({ length: 10 }, (_, i) => ({
        title: `Chapter ${i + 1}`,
        text: "Some text.",
      })),
    };
    let running = 0;
    let most = 0;
    const { run } = fakeRun();
    const slow = vi.fn(async (prompt: string, input: string) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return run(prompt, input);
    });
    const result = await translateBook(many, { ...opts, run: slow });
    expect(most).toBe(8);
    expect(result.book.chapters).toHaveLength(10);
    expect(progress.map((p) => p.done)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("waits out a usage limit hit by several chunks once", async () => {
    const { opts, limits, sleeps } = await setup();
    const resetAt = new Date(Date.now() + 60_000);
    const { run } = fakeRun((s, n) => {
      if (n <= 2) throw new LimitError(resetAt);
      return translate(s);
    });
    // Both calls fail while the first wait still runs.
    const sleep = async (ms: number) => {
      sleeps.push(ms);
      await new Promise((resolve) => setTimeout(resolve, 5));
    };
    const result = await translateBook(book, { ...opts, run, sleep });
    expect(limits).toEqual([resetAt]);
    expect(sleeps).toHaveLength(1);
    expect(result.book.chapters).toHaveLength(2);
  });

  it("adds up Claude's usage in usage.json, across a resume", async () => {
    const { dir, opts, progress } = await setup();
    const one = {
      calls: 1,
      input: 10,
      output: 20,
      cacheWrite: 30,
      cacheRead: 40,
      costUsd: 0.5,
    };
    const counted = () => {
      const { run } = fakeRun();
      return vi.fn(
        async (prompt: string, input: string, onUsage?: (u: Usage) => void) => {
          onUsage?.(one);
          return run(prompt, input);
        },
      );
    };
    const first = await translateBook(book, { ...opts, run: counted() });
    // Each part's progress carries the usage so far.
    expect(progress.at(-1)?.usage).toEqual(first.usage);
    // The glossary and the two chunks.
    expect(first.usage).toEqual({
      calls: 3,
      input: 30,
      output: 60,
      cacheWrite: 90,
      cacheRead: 120,
      costUsd: 1.5,
    });
    await rm(join(dir, "chunks", "0002.uk.md"));
    const second = await translateBook(book, { ...opts, run: counted() });
    expect(second.usage.calls).toBe(4);
    expect(JSON.parse(await readFile(join(dir, "usage.json"), "utf8"))).toEqual(
      second.usage,
    );
  });
});
