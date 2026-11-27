import { describe, expect, it } from "vitest";
import {
  bookName,
  chapterName,
  findBooks,
  parseNumbers,
  safeFilename,
} from "./names.ts";

describe("chapterName", () => {
  it("pads the number, keeps the title and makes it a safe file name", () => {
    expect(chapterName(1, "Розділ I. Риба-молот")).toBe(
      "001 Розділ I. Риба-молот",
    );
    expect(chapterName(12, "Айртон чи Бен Джойс?")).toBe(
      "012 Айртон чи Бен Джойс_",
    );
    expect(chapterName(3, "Дуже ".repeat(40)).length).toBeLessThanOrEqual(100);
  });
});

describe("safeFilename", () => {
  it("replaces characters that are not allowed in file names", () => {
    expect(safeFilename("001 Що? Так/ні")).toBe("001 Що_ Так_ні");
  });
});

describe("bookName", () => {
  it("puts the author before the title when there is one", () => {
    expect(
      bookName({ title: "Діти капітана Гранта", author: "Жуль Верн" }),
    ).toBe("Жуль Верн - Діти капітана Гранта");
    expect(bookName({ title: "Кобзар" })).toBe("Кобзар");
  });
});

describe("findBooks", () => {
  it("finds books whose name has every word of the query", () => {
    const names = [
      "Жуль Верн - Діти капітана Гранта",
      "Жуль Верн - Таємничий острів",
      "Тарас Шевченко - Кобзар",
    ];
    expect(findBooks("верн", names)).toEqual(names.slice(0, 2));
    expect(findBooks("Верн гранта", names)).toEqual([names[0]]);
    expect(findBooks("кобзар франко", names)).toEqual([]);
    expect(findBooks("  ", names)).toEqual([]);
  });
});

describe("parseNumbers", () => {
  it("reads numbers and ranges", () => {
    expect(parseNumbers("5 7-9, 5")).toEqual([5, 7, 8, 9]);
    expect(parseNumbers("")).toEqual([]);
  });
});
