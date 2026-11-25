import { describe, expect, it } from "vitest";
import { termMatch } from "./lang.ts";

describe("termMatch", () => {
  it("reads how a language matches glossary terms from its language.json", async () => {
    expect(await termMatch("en")).toBe("whole");
  });

  it("is the stem rule for a language without data", async () => {
    expect(await termMatch("ru")).toBe("stem");
    expect(await termMatch(undefined)).toBe("stem");
  });
});
