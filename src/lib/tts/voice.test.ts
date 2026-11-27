import { describe, expect, it } from "vitest";
import { summaryVoices, voiceLabel, voicesFor } from "./voice.ts";

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
    // Audiobooks offer the same two voices.
    expect(voicesFor("en")).toEqual(summaryVoices("en"));
  });
});

describe("voiceLabel", () => {
  it("names a voice by its gender and language, never by its name", () => {
    expect(voiceLabel("Oksana")).toBe("👩 Woman (UA)");
    expect(voiceLabel("Andrii")).toBe("👨 Man (UA)");
    expect(voiceLabel("Heart")).toBe("👩 Woman (EN)");
    expect(voiceLabel("George")).toBe("👨 Man (EN)");
  });

  it("keeps the folder name of a voice no longer offered", () => {
    expect(voiceLabel("Bella")).toBe("Bella");
  });
});
