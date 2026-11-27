import { describe, expect, it } from "vitest";
import { summaryVoices, voicesFor } from "./voice.ts";

describe("summaryVoices", () => {
  it("offers two voices a language: Ukrainian sped up, English as is", () => {
    const tempos = (language: "uk" | "en") =>
      summaryVoices(language).map((v) => [v.name, v.gender, v.summaryTempo]);
    expect(tempos("uk")).toEqual([
      ["Oksana", "woman", 1.15],
      ["Andrii", "man", 1.15],
    ]);
    expect(tempos("en")).toEqual([
      ["Heart", "woman", 1],
      ["George", "man", 1],
    ]);
    // Audiobooks keep every voice.
    expect(voicesFor("en")).toHaveLength(4);
  });
});
