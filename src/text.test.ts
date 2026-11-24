import { describe, expect, it } from "vitest";
import { chapterName, estimateCostUsd, groupParts, safeFilename, splitText } from "./text.ts";

describe("chapterName", () => {
  it("pads the number and adds a part letter only when given", () => {
    expect(chapterName(1, "Вступ")).toBe("001 Вступ");
    expect(chapterName(12, "Глава", 0)).toBe("012a Глава");
    expect(chapterName(12, "Глава", 1)).toBe("012b Глава");
  });
});

describe("safeFilename", () => {
  it("replaces characters that are not allowed in file names", () => {
    expect(safeFilename("001 Що? Так/ні")).toBe("001 Що_ Так_ні");
  });
});

describe("splitText", () => {
  it("packs whole sentences up to the limit", () => {
    expect(splitText("Перше речення. Друге речення! Третє?", 20)).toEqual([
      "Перше речення.",
      "Друге речення!",
      "Третє?",
    ]);
  });

  it("splits a sentence longer than the limit on spaces without losing words", () => {
    const long = "слово ".repeat(1000).trim();
    const parts = splitText(long, 2000);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
    expect(parts.join(" ")).toBe(long);
  });

  it("returns nothing for blank text", () => {
    expect(splitText("  ")).toEqual([]);
  });
});

describe("groupParts", () => {
  const b = (n: number) => Buffer.alloc(n);

  it("joins consecutive buffers up to the limit", () => {
    expect(groupParts([b(3), b(3), b(3)], 6).map((x) => x.length)).toEqual([6, 3]);
  });

  it("keeps an oversized buffer as its own part", () => {
    expect(groupParts([b(10)], 6).map((x) => x.length)).toEqual([10]);
  });
});

describe("estimateCostUsd", () => {
  it("charges $15 per million UTF-8 bytes", () => {
    expect(estimateCostUsd(["аа"])).toBeCloseTo((4 * 15) / 1e6);
  });
});
