import { describe, expect, it } from "vitest";
import { bookName, chapterName, duration, findBooks, forecast, isUkrainian, parseNumbers, safeFilename } from "./text.ts";

describe("chapterName", () => {
  it("pads the number, keeps the title and makes it a safe file name", () => {
    expect(chapterName(1, "Розділ I. Риба-молот")).toBe("001 Розділ I. Риба-молот");
    expect(chapterName(12, "Айртон чи Бен Джойс?")).toBe("012 Айртон чи Бен Джойс_");
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
    expect(bookName({ title: "Діти капітана Гранта", author: "Жуль Верн" })).toBe("Жуль Верн - Діти капітана Гранта");
    expect(bookName({ title: "Кобзар" })).toBe("Кобзар");
  });
});

describe("findBooks", () => {
  it("finds books whose name has every word of the query", () => {
    const names = ["Жуль Верн - Діти капітана Гранта", "Жуль Верн - Таємничий острів", "Тарас Шевченко - Кобзар"];
    expect(findBooks("верн", names)).toEqual(names.slice(0, 2));
    expect(findBooks("Верн гранта", names)).toEqual([names[0]]);
    expect(findBooks("кобзар франко", names)).toEqual([]);
    expect(findBooks("  ", names)).toEqual([]);
  });
});

describe("isUkrainian", () => {
  it("tells Ukrainian from Russian and English", () => {
    expect(isUkrainian("Він відкрив двері й побачив її.")).toBe(true);
    expect(isUkrainian("Он открыл дверь и увидел её.")).toBe(false);
    expect(isUkrainian("He opened the door and saw her.")).toBe(false);
  });
});

describe("forecast", () => {
  it("estimates audio length, size and voicing time from the text length", () => {
    expect(forecast([7_000, 70_000], true)).toBe(
      "≈1 год 50 хв аудіо, ≈53 МБ (найбільший розділ ≈48 МБ).\nПерший розділ буде за ≈1 хв, уся озвучка займе ≈5 хв.",
    );
    expect(forecast([700], false)).toBe("≈1 хв аудіо, ≈1 МБ (найбільший розділ ≈1 МБ).");
  });

  it("formats durations", () => {
    expect(duration(0.2)).toBe("1 хв");
    expect(duration(60)).toBe("1 год");
    expect(duration(75)).toBe("1 год 15 хв");
  });
});

describe("parseNumbers", () => {
  it("reads numbers and ranges", () => {
    expect(parseNumbers("5 7-9, 5")).toEqual([5, 7, 8, 9]);
    expect(parseNumbers("")).toEqual([]);
  });
});
