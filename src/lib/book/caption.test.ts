import { describe, expect, it } from "vitest";
import { bookCaption, MAX_CAPTION } from "./caption.ts";

const book = { title: "The <Dip>", author: "Seth Godin" };

describe("bookCaption", () => {
  it("puts the facts in a quote and the description under it", () => {
    expect(
      bookCaption({
        book,
        chapters: 3,
        language: "en",
        info: { year: 2007, pages: 96, description: "Про віддачу." },
        lines: ["🎧 Kokoro: 1 of 3"],
      }),
    ).toBe(
      "📕 <b>The &lt;Dip&gt;</b>\nSeth Godin\n\n<blockquote>English · 3 chapters · 2007 · ~96 pages\n🎧 Kokoro: 1 of 3</blockquote>\n\nПро віддачу.",
    );
  });

  it("is only title and facts without info", () => {
    expect(bookCaption({ book: { title: "T" }, chapters: 2 })).toBe(
      "📕 <b>T</b>\n\n<blockquote>2 chapters</blockquote>",
    );
  });

  it("cuts a long description to fit Telegram's caption", () => {
    const text = bookCaption({
      book,
      chapters: 3,
      info: { description: "слово & ".repeat(300) },
    });
    expect(text.length).toBeLessThanOrEqual(MAX_CAPTION);
    expect(text.endsWith("…")).toBe(true);
  });
});
