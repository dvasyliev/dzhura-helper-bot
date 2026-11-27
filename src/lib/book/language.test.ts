import { describe, expect, it } from "vitest";
import { bookLanguage } from "./language.ts";

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
