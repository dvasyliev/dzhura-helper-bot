import { describe, expect, it } from "vitest";
import { isBookFile, linkInput } from "./input.ts";

describe("linkInput", () => {
  it("recognises a short YouTube link", () => {
    expect(linkInput("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      kind: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  it("finds a YouTube link inside other text", () => {
    expect(
      linkInput("look https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toEqual({ kind: "youtube", id: "dQw4w9WgXcQ" });
  });

  it("takes any other link as a link", () => {
    expect(linkInput("https://example.com/a")).toEqual({
      kind: "link",
      url: "https://example.com/a",
    });
  });

  it("returns nothing for plain text", () => {
    expect(linkInput("Art of Learning")).toBeUndefined();
  });
});

describe("isBookFile", () => {
  it("tells EPUB and PDF apart by the name, in any case", () => {
    expect(isBookFile("a.EPUB")).toBe("epub");
    expect(isBookFile("b.pdf")).toBe("pdf");
    expect(isBookFile("c.txt")).toBeUndefined();
    expect(isBookFile("")).toBeUndefined();
  });
});
