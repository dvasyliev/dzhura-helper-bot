import { describe, expect, it } from "vitest";
import { chapterName, safeFilename } from "./text.ts";

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
