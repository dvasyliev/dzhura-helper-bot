import { describe, expect, it } from "vitest";
import {
  checkChunk,
  fixApostrophes,
  loadTable,
  type Replacement,
} from "./checks.ts";

const kinds = (...args: Parameters<typeof checkChunk>) =>
  checkChunk(...args).map((problem) => problem.kind);

describe("checkChunk", () => {
  it("flags a word mixing Latin and Cyrillic letters", () => {
    expect(kinds("a", "statок", [], [])).toEqual(["latin"]);
    expect(kinds("a", "лордa", [], [])).toEqual(["latin"]);
  });

  it("allows a whole Latin word", () => {
    expect(kinds("He bought an iPhone.", "Він купив iPhone.", [], [])).toEqual(
      [],
    );
  });

  it("flags a whole Latin word that is not in the source", () => {
    expect(kinds("He drank wine.", "Він пив claret.", [], [])).toEqual([
      "latin",
    ]);
  });

  it("flags Russian-only letters", () => {
    expect(kinds("a", "объём", [], [])).toEqual(["russian-letters"]);
  });

  it("flags a different paragraph count", () => {
    expect(kinds("a\n\nb\n\nc", "а\n\nб", [], [])).toEqual(["paragraphs"]);
  });

  it("checks glossary terms by their stem", () => {
    const terms = [{ source: "Fogg", uk: "Фоґ" }];
    expect(kinds("Fogg came.", "Фоґові прийшов.", terms, [])).toEqual([]);
    expect(kinds("Fogg came.", "Фогг прийшов.", terms, [])).toEqual([
      "glossary",
    ]);
  });

  it("takes all but the last two letters of a five-letter form as its stem", () => {
    const terms = [
      { source: "India", uk: "Індія" },
      { source: "Maria", uk: "Марія" },
    ];
    expect(kinds("India and Maria.", "Індії та Марії.", terms, [])).toEqual([]);
  });

  it("matches a glossary name only as a whole word with its case", () => {
    const terms = [
      { source: "Will", uk: "Вілл" },
      { source: "Mark", uk: "Марк" },
    ];
    expect(
      kinds("You will go to the market.", "Ти підеш на ринок.", terms, []),
    ).toEqual([]);
    expect(kinds("Will came.", "Він прийшов.", terms, [])).toEqual([
      "glossary",
    ]);
  });

  it("flags a first chunk that loses its title line", () => {
    expect(kinds("# One\n\nText.", "Один\n\nТекст.", [], [], true)).toEqual([
      "title",
    ]);
    expect(kinds("# One\n\nText.", "# Один\n\nТекст.", [], [], true)).toEqual(
      [],
    );
  });

  it("flags a title line in a chunk that is not first", () => {
    expect(kinds("Text.\n\nMore.", "# Текст.\n\nЩе.", [], [], false)).toEqual([
      "title",
    ]);
  });

  it("allows Roman numerals", () => {
    expect(
      kinds("In the eleventh century.", "У XI ст. та IV.", [], []),
    ).toEqual([]);
  });

  it("ignores glossary terms absent from the source", () => {
    const terms = [{ source: "Fogg", uk: "Фоґ" }];
    expect(kinds("He came.", "Він прийшов.", terms, [])).toEqual([]);
  });

  it("flags a table phrase and names the suggestion", () => {
    const table: Replacement[] = [{ pattern: "так от", suggestions: ["отож"] }];
    const problems = checkChunk("a", "Так от, ми пішли.", [], table);
    expect(problems.map((p) => p.kind)).toEqual(["russianism"]);
    expect(problems[0]?.detail).toContain("отож");
  });

  it("matches a single word by its stem only", () => {
    const table: Replacement[] = [
      { pattern: "приймаючий", suggestions: ["той, що приймає"] },
    ];
    expect(kinds("a", "приймаючого", [], table)).toEqual(["russianism"]);
    expect(kinds("a", "приймати", [], table)).toEqual([]);
  });

  it("treats apostrophes alike", () => {
    const table: Replacement[] = [
      { pattern: "м'який знак", suggestions: ["х"] },
    ];
    expect(kinds("a", "Це м’який знак.", [], table)).toEqual(["russianism"]);
  });
});

describe("fixApostrophes", () => {
  it("puts the Ukrainian apostrophe between Cyrillic letters", () => {
    expect(fixApostrophes("п'ять, м’ята, 'quoted' don't")).toBe(
      "пʼять, мʼята, 'quoted' don't",
    );
  });
});

describe("loadTable", () => {
  it("drops advice rows and words that are wrong only inside a set phrase", () => {
    const patterns = new Set(loadTable().map((row) => row.pattern));
    for (const word of ["любий", "образу", "єдиного", "рівна", "прийом"])
      expect(patterns.has(word)).toBe(false);
    for (const word of ["дошок", "заможній", "крупний"])
      expect(patterns.has(word)).toBe(true);
  });

  it("has many rows and no advice rows", () => {
    const table = loadTable();
    expect(table.length).toBeGreaterThan(1000);
    // lt-replace.tsv has 10,444 rows, 1,707 of them advice
    expect(table.length).toBeLessThan(9000);
    expect(table.every((row) => row.suggestions.length > 0)).toBe(true);
    expect(loadTable()).toBe(table);
  });
});
