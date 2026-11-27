import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { runPython } from "../../lib/python/python.ts";
import { isSeparated, runKaraoke } from "./pipeline.ts";

vi.mock("../../lib/python/python.ts", () => ({ runPython: vi.fn() }));

describe("runKaraoke events", () => {
  it("accepts need_lyrics «unreachable» and reads it as needLyrics", async () => {
    vi.mocked(runPython).mockImplementationOnce(((
      _name: string,
      _input: unknown,
      { schema }: { schema: z.ZodType },
    ) =>
      (async function* () {
        yield schema.parse({ need_lyrics: "unreachable", transcript: "la la" });
      })()) as never);
    const events = [];
    for await (const e of runKaraoke({
      url: "u",
      id: "i",
      versions: ["music"],
    } as never))
      events.push(e);
    expect(events).toEqual([
      { needLyrics: "unreachable", transcript: "la la" },
    ]);
  });
});

describe("isSeparated", () => {
  it("knows a song whose vocals were already split off, found by its YouTube id", async () => {
    const data = mkdtempSync(path.join(tmpdir(), "karaoke-"));
    const song = path.join(data, "Coldplay - Yellow");
    mkdirSync(path.join(song, "stems"), { recursive: true });
    writeFileSync(
      path.join(song, "meta.json"),
      JSON.stringify({
        id: "yKNxeF4KMsY",
        duration: 200,
        width: 1280,
        height: 720,
      }),
    );
    expect(await isSeparated("yKNxeF4KMsY", data)).toBe(false);
    writeFileSync(path.join(song, "stems", "vocals.wav"), "");
    expect(await isSeparated("yKNxeF4KMsY", data)).toBe(true);
    expect(await isSeparated("B0bnhONb2kM", data)).toBe(false);
  });
});
