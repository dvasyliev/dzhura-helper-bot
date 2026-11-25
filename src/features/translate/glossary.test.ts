import { describe, expect, it } from "vitest";
import type { Book } from "../book/epub.ts";
import { buildGlossary, candidates } from "./glossary.ts";

const book: Book = {
  title: "Around the World",
  author: "Jules Verne",
  chapters: [
    {
      title: "One",
      text: "Phileas Fogg went out. Mr. Fogg came back. The Reform Club. The club was quiet.",
    },
  ],
};

describe("candidates", () => {
  it("finds repeated capitalised words, not sentence starters", () => {
    const found = candidates(book);
    const fogg = found.find((c) => c.term === "Fogg");
    expect(fogg?.count).toBe(2);
    expect(fogg?.context).toContain("Fogg");
    expect(found.some((c) => c.term === "The")).toBe(false);
  });

  it("always includes the words of the title", () => {
    const found = candidates({
      title: "Voyage Around Atlantis",
      chapters: [{ title: "c", text: "They saw Voyage once." }],
    });
    const terms = found.map((c) => c.term);
    expect(terms).toContain("Atlantis");
    expect(terms).toContain("Voyage");
    expect(terms).toContain("Around");
  });

  it("skips words seen once", () => {
    expect(candidates(book).some((c) => c.term === "Reform")).toBe(false);
  });

  it("keeps at most 300", () => {
    const text = Array.from(
      { length: 400 },
      (_, i) =>
        `go Name${"x".repeat(i % 7)}${i} and Name${"x".repeat(i % 7)}${i}.`,
    ).join(" ");
    const found = candidates({ title: "T", chapters: [{ title: "c", text }] });
    expect(found.length).toBeLessThanOrEqual(300);
  });
});

describe("buildGlossary", () => {
  it("parses the first JSON object of the reply", async () => {
    const run = async () =>
      'Here you go:\n{"title":"Навколо світу","author":"Жуль Верн","terms":[{"source":"Fogg","uk":"Фоґ","note":"чол., відм. як Фоґ-а"}]}\nDone.';
    const glossary = await buildGlossary(book, run);
    expect(glossary.title).toBe("Навколо світу");
    expect(glossary.terms[0]?.uk).toBe("Фоґ");
  });

  it("sends the title, author, language and candidates", async () => {
    let input = "";
    await buildGlossary(book, async (_prompt, text) => {
      input = text;
      return '{"title":"x","terms":[]}';
    });
    expect(input).toContain("Around the World");
    expect(input).toContain("Jules Verne");
    expect(input).toContain("en");
    expect(input).toContain("Fogg");
  });

  it("throws on invalid JSON", async () => {
    await expect(
      buildGlossary(book, async () => "no json here"),
    ).rejects.toThrow();
    await expect(
      buildGlossary(book, async () => '{"title": 5}'),
    ).rejects.toThrow();
  });
});
