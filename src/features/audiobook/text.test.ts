import { describe, expect, it } from "vitest";
import { duration } from "../../eta.ts";
import {
  voicingMinutes,
  voicingTime,
  bookName,
  chapterName,
  findBooks,
  forecast,
  bookLanguage,
  parseNumbers,
  safeFilename,
} from "./text.ts";

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

describe("bookLanguage", () => {
  it("finds Ukrainian and English", () => {
    expect(bookLanguage("Він відкрив двері й побачив її.")).toBe("uk");
    expect(
      bookLanguage(
        "He opened the door and saw that she was in the room with a letter.",
      ),
    ).toBe("en");
  });

  it("detects Russian", () => {
    expect(
      bookLanguage("Это было давно, ещё до войны. Мы шли объёмным шагом."),
    ).toBe("ru");
  });

  it("refuses other languages", () => {
    expect(
      bookLanguage("Il ouvrit la porte et vit qu'elle était dans la chambre."),
    ).toBeUndefined();
    expect(
      bookLanguage("Er öffnete die Tür und sah, dass sie im Zimmer war."),
    ).toBeUndefined();
    expect(bookLanguage("")).toBeUndefined();
  });
});

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

describe("parseNumbers", () => {
  it("reads numbers and ranges", () => {
    expect(parseNumbers("5 7-9, 5")).toEqual([5, 7, 8, 9]);
    expect(parseNumbers("")).toEqual([]);
  });
});

describe("voicingMinutes", () => {
  it("is the voicing time of the characters in minutes", () => {
    expect(voicingTime(9613, "holos")).toBe(
      duration(voicingMinutes(9613, "holos")),
    );
  });
});
