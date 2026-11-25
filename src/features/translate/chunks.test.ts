import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../book/markdown.ts";
import {
  assemble,
  MAX_CHUNK_CHARS,
  paragraphs,
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
