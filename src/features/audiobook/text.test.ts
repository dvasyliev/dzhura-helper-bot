import { describe, expect, it } from "vitest";
import { duration } from "../../lib/text/eta.ts";
import { forecast, voicingMinutes, voicingTime } from "./text.ts";

describe("forecast", () => {
  it("estimates audio length, size and voicing time from the text length", () => {
    expect(forecast([7_000, 70_000], "holos")).toBe(
      "≈1 h 50 min of audio, ≈53 MB (largest chapter ≈48 MB).\nThe first chapter will be ready in ≈1 min, the whole voicing takes ≈5 min.",
    );
    expect(forecast([8_500, 85_000], "kokoro")).toBe(
      "≈1 h 50 min of audio, ≈53 MB (largest chapter ≈48 MB).\nThe first chapter will be ready in ≈1 min, the whole voicing takes ≈11 min.",
    );
  });
});

describe("voicingMinutes", () => {
  it("is the voicing time of the characters in minutes", () => {
    expect(voicingTime(9613, "holos")).toBe(
      duration(voicingMinutes(9613, "holos")),
    );
  });
});
