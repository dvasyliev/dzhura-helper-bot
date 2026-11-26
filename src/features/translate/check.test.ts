import { describe, expect, it } from "vitest";
import { checkChunk, hasTerm } from "./check.ts";

describe("hasTerm", () => {
  const term = (source: string) => ({ source, uk: "x" });

  it("matches a whole English word, with its case and its possessive", () => {
    const whole = (text: string, source: string) =>
      hasTerm(text, term(source), "whole");
    expect(whole("Fogg came.", "Fogg")).toBe(true);
    expect(whole("Fogg's house.", "Fogg")).toBe(true);
    expect(whole("Fogg’s house.", "Fogg")).toBe(true);
    expect(whole("Will came.", "Will")).toBe(true);
    expect(whole("You will go.", "Will")).toBe(false);
    expect(whole("Willow.", "Will")).toBe(false);
    expect(whole("Market Street.", "Mark")).toBe(false);
    expect(whole("A Brazilian came.", "Brazil")).toBe(false);
    expect(whole("The Waitzkins came.", "Waitzkin")).toBe(false);
  });

  it("matches a name by its stem plus at most three more letters", () => {
    for (const text of ["Шекспир", "Шекспира", "Шекспиром", "о Шекспире"])
      expect(hasTerm(`${text} писал.`, term("Шекспир"), "stem")).toBe(true);
    expect(hasTerm("Он жил в Лондоне.", term("Лондон"), "stem")).toBe(true);
    expect(hasTerm("Тараса нет.", term("Тарас"), "stem")).toBe(true);
    expect(hasTerm("шекспира нет.", term("Шекспир"), "stem")).toBe(false);
    expect(hasTerm("Шекспировский музей.", term("Шекспир"), "stem")).toBe(
      false,
    );
    expect(hasTerm("Подшекспир.", term("Шекспир"), "stem")).toBe(false);
  });

  it("matches every word of a several-word name in a row", () => {
    const shakespeare = term("Уильям Шекспир");
    expect(hasTerm("Об Уильяме Шекспире.", shakespeare, "stem")).toBe(true);
    expect(hasTerm("Уильям и Шекспир.", shakespeare, "stem")).toBe(false);
    expect(hasTerm("Chen Ze-Cheng came.", term("Chen Ze-Cheng"), "whole")).toBe(
      true,
    );
  });

  it("matches a common term in any case", () => {
    expect(hasTerm("The Tea was hot.", term("tea"), "whole")).toBe(true);
    expect(hasTerm("Самураями были.", term("самурай"), "stem")).toBe(true);
  });
});

describe("checkChunk", () => {
  it("returns the fixed text and the problems from the Python checker", async () => {
    const result = await checkChunk({
      source: "One.\n\nTwo.",
      translation: "- П'ять дошок.",
      terms: [],
      first: false,
      language: "uk",
    });
    expect(result.translation).toBe("— Пʼять дошок.");
    expect(result.problems.map((p) => p.kind)).toEqual([
      "paragraphs",
      "russianism",
    ]);
  });
});
