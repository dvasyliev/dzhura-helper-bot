import { describe, expect, it } from "vitest";
import { parseMarkdown, toMarkdown } from "./markdown.ts";

const md = `---\ntitle: "Part 1: \\"Go\\""\nauthor: "Josh Waitzkin"\n---\n\n# Intro\n\nFirst.\n\n\\#1 rule\n\n# 1. One\n\nText.\n`;

describe("parseMarkdown", () => {
  it("reads front matter and chapters", () => {
    expect(parseMarkdown(md)).toEqual({
      title: 'Part 1: "Go"',
      author: "Josh Waitzkin",
      chapters: [
        { title: "Intro", text: "First.\n#1 rule" },
        { title: "1. One", text: "Text." },
      ],
    });
  });

  it("falls back to the file name and no author", () => {
    expect(parseMarkdown("# A\n\nx\n", "my book.pdf")).toMatchObject({
      title: "my book",
      author: undefined,
    });
  });
});

describe("toMarkdown", () => {
  it("round-trips with parseMarkdown", () => {
    const book = {
      title: 'A: "b"',
      author: "C",
      chapters: [{ title: "One", text: "#1 rule\nText." }],
    };
    expect(parseMarkdown(toMarkdown(book))).toEqual(book);
  });
});
