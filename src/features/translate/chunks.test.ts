import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../../lib/book/markdown.ts";
import {
  assemble,
  MAX_CHUNK_CHARS,
  paragraphs,
  chunkFileName,
  splitChunks,
} from "./chunks.ts";

describe("splitChunks", () => {
  it("makes one first chunk per short chapter", () => {
    const chunks = splitChunks({
      title: "T",
      chapters: [
        { title: "One", text: "a\nb\nc" },
        { title: "Two", text: "d\ne\nf" },
      ],
    });
    expect(chunks).toHaveLength(2);
    expect(chunks.map((c) => c.first)).toEqual([true, true]);
    expect(chunks[0].text.startsWith("# One\n\n")).toBe(true);
    expect(chunks[1].text.startsWith("# Two\n\n")).toBe(true);
  });

  it("splits a long chapter at paragraph borders", () => {
    const text = Array.from({ length: 10 }, () => "x".repeat(1000)).join("\n");
    const chunks = splitChunks({
      title: "T",
      chapters: [{ title: "One", text }],
    });
    expect(chunks).toHaveLength(2);
    for (const chunk of chunks)
      expect(chunk.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    expect(chunks.map((c) => c.text.startsWith("#"))).toEqual([true, false]);
    expect(chunks.map((c) => c.first)).toEqual([true, false]);
  });

  it("keeps an oversized paragraph whole in its own chunk", () => {
    const big = "y".repeat(7000);
    const chunks = splitChunks({
      title: "T",
      chapters: [{ title: "One", text: `a\n${big}\nb` }],
    });
    expect(chunks.some((c) => c.text.includes(big))).toBe(true);
    expect(chunks.find((c) => c.text.includes(big))?.text).toBe(big);
  });

  it("escapes a paragraph that starts with #", () => {
    const [chunk] = splitChunks({
      title: "T",
      chapters: [{ title: "One", text: "# odd" }],
    });
    expect(chunk.text).toBe("# One\n\n\\# odd");
  });
});

describe("assemble", () => {
  it("joins translated chunks into a book that parses back", () => {
    const book = parseMarkdown(
      assemble("T", "A", ["# One\n\nX", "Y", "# Two\n\nZ"]),
    );
    expect(book.title).toBe("T");
    expect(book.author).toBe("A");
    expect(book.chapters).toEqual([
      { title: "One", text: "X\nY" },
      { title: "Two", text: "Z" },
    ]);
  });
});

describe("paragraphs", () => {
  it("splits on blank lines, trims and drops empty ones", () => {
    expect(paragraphs("a\n\n  b \n\n\n\nc\n")).toEqual(["a", "b", "c"]);
  });
});

describe("chunkFileName", () => {
  const chunks = splitChunks({
    title: "T",
    chapters: [
      { title: "A/B: one", text: "a" },
      {
        title: "Two",
        text: Array.from({ length: 10 }, () => "x".repeat(1000)).join("\n"),
        level: 2,
      },
    ],
  });

  it("names a chunk after its chapter, with a piece number when the chapter has several", () => {
    expect(chunks.map((_, i) => chunkFileName(chunks, i))).toEqual([
      "0001-a-b-one",
      "0002-two-1",
      "0003-two-2",
    ]);
  });

  it("keeps Ukrainian letters", () => {
    const uk = splitChunks({
      title: "T",
      chapters: [{ title: "Розділ 1. Підсумок: «Бути»", text: "a" }],
    });
    expect(chunkFileName(uk, 0)).toBe("0001-розділ-1-підсумок-бути");
  });

  it("keeps the chapter's level in its heading", () => {
    expect(chunks[1].text.startsWith("## Two\n\n")).toBe(true);
  });

  it("cuts a long title", () => {
    const long = splitChunks({
      title: "T",
      chapters: [{ title: "w".repeat(200), text: "a" }],
    });
    expect(chunkFileName(long, 0)).toBe(`0001-${"w".repeat(60)}`);
  });
});
