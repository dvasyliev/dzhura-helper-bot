import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captionOf,
  describeAll,
  describeChapters,
  pending,
  readDescriptions,
} from "./descriptions.ts";

const LONG = "слово ".repeat(100);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "descriptions-"));
});

describe("describeChapters", () => {
  it("describes a chapter once with haiku, saves it, and does not call again", async () => {
    const run = vi.fn(async () => " Про море. ");
    const chapters = [{ name: "001 A", text: LONG }];
    await describeChapters(dir, "Book", chapters, { run })("001 A");
    expect(await readDescriptions(dir)).toEqual({ "001 A": "Про море." });
    expect(run).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,
      {
        model: "haiku",
      },
    );
    await describeChapters(dir, "Book", chapters, { run })("001 A");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("skips short chapters", async () => {
    const run = vi.fn(async () => "x");
    await describeChapters(
      dir,
      "Book",
      [{ name: "000 Title", text: "short" }],
      {
        run,
      },
    )("000 Title");
    expect(run).not.toHaveBeenCalled();
    expect(await readDescriptions(dir)).toEqual({});
  });

  it("leaves a failed chapter out and goes on", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("Друга.");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wait = describeChapters(
      dir,
      "Book",
      [
        { name: "001 A", text: LONG },
        { name: "002 B", text: LONG },
      ],
      { run },
    );
    await wait("001 A");
    await wait("002 B");
    expect(await readDescriptions(dir)).toEqual({ "002 B": "Друга." });
  });

  it("stops waiting after waitMs for a slow call", async () => {
    const run = vi.fn(() => new Promise<string>(() => {}));
    const wait = describeChapters(
      dir,
      "Book",
      [{ name: "001 A", text: LONG }],
      {
        run,
        waitMs: 10,
      },
    );
    await wait("001 A");
    expect(await readDescriptions(dir)).toEqual({});
  });
});

describe("readDescriptions", () => {
  it("is empty for a missing or damaged file", async () => {
    expect(await readDescriptions(dir)).toEqual({});
    await writeFile(join(dir, "descriptions.json"), "{oops");
    expect(await readDescriptions(dir)).toEqual({});
    expect(await readFile(join(dir, "descriptions.json"), "utf8")).toBe(
      "{oops",
    );
  });
});

describe("captionOf", () => {
  const d = { "001 A": "Про <море> & небо" };
  it("escapes, and only the first file of a chapter gets it", () => {
    expect(captionOf(d, "/x/001 A.mp3")).toBe("Про &lt;море&gt; &amp; небо");
    expect(captionOf(d, "/x/001 A (1).mp3")).toBeDefined();
    expect(captionOf(d, "/x/001 A (2).mp3")).toBeUndefined();
    expect(captionOf(d, "/x/002 B.mp3")).toBeUndefined();
  });
});

describe("pending", () => {
  it("lists the long chapters without a description", async () => {
    await writeFile(join(dir, "descriptions.json"), '{"001 A":"Є."}');
    const chapters = [
      { name: "001 A", text: LONG },
      { name: "002 B", text: LONG },
      { name: "003 C", text: "short" },
    ];
    expect(await pending(dir, chapters)).toEqual([chapters[1]]);
  });
});

describe("describeAll", () => {
  it("waits for every chapter, reports usage and progress", async () => {
    const usage = {
      calls: 1,
      input: 1,
      output: 1,
      cacheWrite: 0,
      cacheRead: 0,
      costUsd: 0.01,
    };
    const run = vi.fn(async (_p: string, _i: string, onUsage?: Function) => {
      onUsage?.(usage);
      return "Опис.";
    });
    const onUsage = vi.fn();
    const onDone = vi.fn();
    await describeAll(
      dir,
      "Book",
      [
        { name: "001 A", text: LONG },
        { name: "002 B", text: LONG },
      ],
      { run, onUsage, onDone },
    );
    expect(Object.keys(await readDescriptions(dir))).toEqual([
      "001 A",
      "002 B",
    ]);
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
