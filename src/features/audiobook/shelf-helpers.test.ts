import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Chapter } from "../../lib/book/tracks.ts";
import type { ShelfBook } from "../../lib/shelf/shelf.ts";
import type { Voice } from "../../lib/tts/voice.ts";

const root = mkdtempSync(path.join(tmpdir(), "shelf-"));
vi.mock("../../lib/shelf/names.ts", async (original) => ({
  ...(await original<typeof import("../../lib/shelf/names.ts")>()),
  bookPaths: () => ({ audioDir: root }),
}));
vi.mock("../../lib/book/tracks.ts", () => ({
  chapters: () =>
    ["001 A", "002 B", "003 C", "004 D"].map((name) => ({ name })),
}));

const { remaining } = await import("./offer.ts");
const { voicedCount } = await import("./library.ts");

const book = { folder: "b" } as ShelfBook;
const voice = { name: "v" } as Voice;

describe("voiced chapters", () => {
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "001 A.mp3"), "");
  writeFileSync(path.join(root, "003 C (1).mp3"), "");
  writeFileSync(path.join(root, "003 C (2).mp3"), "");

  it("remaining lists the chapters without audio, in order", async () => {
    expect((await remaining(book, voice)).map((c) => c.name)).toEqual([
      "002 B",
      "004 D",
    ]);
  });

  it("voicedCount counts a chapter with one file or several parts once", async () => {
    const all = [{ name: "001 A" }, { name: "002 B" }, { name: "003 C" }];
    expect(await voicedCount(book, voice, all as Chapter[])).toBe(2);
  });
});
