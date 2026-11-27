import { describe, expect, it } from "vitest";
import { contentsItem, coverUrl } from "./contents.ts";

describe("contentsItem", () => {
  it("joins the head and every line, pinned, when under the limit", () => {
    expect(contentsItem("Head", ["a", "b"])).toEqual({
      key: "contents",
      kind: "text",
      text: "Head\na\nb",
      pin: true,
    });
  });

  it("drops the oldest lines past 4096 characters and keeps the newest", () => {
    const lines = [
      "old",
      "x".repeat(1500),
      "y".repeat(1500),
      "z".repeat(1500),
      "new",
    ];
    const { text } = contentsItem("Head", lines) as { text: string };
    expect(text.split("\n").map((l) => l.slice(0, 3))).toEqual([
      "Hea",
      "yyy",
      "zzz",
      "new",
    ]);
  });

  it("does not count tags", () => {
    const line = `<a href="https://example.com/${"p".repeat(500)}">${"t".repeat(4000)}</a>`;
    const { text } = contentsItem("H", [line]) as { text: string };
    expect(text).toContain(line);
  });

  it("counts an entity as one character", () => {
    const long = "&amp;".repeat(4093);
    const { text } = contentsItem("H", ["old", long]) as { text: string };
    expect(text === `H\n${long}`).toBe(true);
    const fits = "&amp;".repeat(4090);
    const kept = contentsItem("H", ["old", fits]) as { text: string };
    expect(kept.text.startsWith("H\nold\n")).toBe(true);
  });

  it("keeps the head even when no line fits", () => {
    const { text } = contentsItem("Head", ["z".repeat(5000)]) as {
      text: string;
    };
    expect(text).toBe("Head");
  });
});

describe("coverUrl", () => {
  it("points at the video's maxres thumbnail", () => {
    expect(coverUrl("abc")).toBe(
      "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
    );
  });
});
