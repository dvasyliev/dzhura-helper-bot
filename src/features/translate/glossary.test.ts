import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Book } from "../../lib/book/epub.ts";
import { buildGlossary, candidates, type Candidate } from "./glossary.ts";

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
  it("runs glossary_candidates on book.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glossary-"));
    const file = join(dir, "book.md");
    await writeFile(
      file,
      '---\ntitle: "Буря"\n---\n\n# Один\n\nВчера Тарас пришёл. Потом Тарас ушёл.\n',
    );
    const found = await candidates(file, "ru");
    expect(found.map((c) => c.term)).toEqual(["Буря", "Тарас"]);
    expect(found[1]?.count).toBe(2);
  }, 60_000); // A cold Python start (CI) loads its models for longer than the default 5 s.
});

const fogg: Candidate[] = [
  { term: "Fogg", count: 2, context: "Mr. Fogg came back." },
];
const find = async () => fogg;

describe("buildGlossary", () => {
  it("parses the first JSON object of the reply", async () => {
    const run = async () =>
      'Here you go:\n{"title":"Навколо світу","author":"Жуль Верн","terms":[{"source":"Fogg","uk":"Фоґ","note":"чол., відм. як Фоґ-а"}]}\nDone.';
    const glossary = await buildGlossary(book, "book.md", run, find);
    expect(glossary.title).toBe("Навколо світу");
    expect(glossary.terms[0]?.uk).toBe("Фоґ");
  });

  it("sends the title, author, language and candidates", async () => {
    let input = "";
    let asked: unknown[] = [];
    await buildGlossary(
      book,
      "book.md",
      async (_prompt, text) => {
        input = text;
        return '{"title":"x","terms":[]}';
      },
      async (...args) => {
        asked = args;
        return fogg;
      },
    );
    expect(asked).toEqual(["book.md", "en"]);
    expect(input).toContain("Around the World");
    expect(input).toContain("Jules Verne");
    expect(input).toContain("en");
    expect(input).toContain("Fogg");
  });

  it("throws on invalid JSON", async () => {
    await expect(
      buildGlossary(book, "book.md", async () => "no json here", find),
    ).rejects.toThrow();
    await expect(
      buildGlossary(book, "book.md", async () => '{"title": 5}', find),
    ).rejects.toThrow();
  });
});
