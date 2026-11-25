import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSeparated } from "./pipeline.ts";

describe("isSeparated", () => {
  it("knows a song whose vocals were already split off, found by its YouTube id", () => {
    const data = mkdtempSync(path.join(tmpdir(), "karaoke-"));
    const song = path.join(data, "Coldplay - Yellow");
    mkdirSync(path.join(song, "stems"), { recursive: true });
    writeFileSync(path.join(song, "meta.json"), JSON.stringify({ id: "yKNxeF4KMsY" }));
    expect(isSeparated("yKNxeF4KMsY", data)).toBe(false);
    writeFileSync(path.join(song, "stems", "vocals.wav"), "");
    expect(isSeparated("yKNxeF4KMsY", data)).toBe(true);
    expect(isSeparated("B0bnhONb2kM", data)).toBe(false);
  });
});
