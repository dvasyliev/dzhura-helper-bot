import { describe, expect, it } from "vitest";
import { card, routeText } from "./card.ts";
import type { Input } from "./lib/input/input.ts";

const book: Input = {
  kind: "book",
  folder: "A - T",
  language: "en",
  book: {
    title: "T",
    author: "A",
    chapters: [
      { title: "One", text: "a" },
      { title: "Two", text: "b" },
    ],
  },
};

const ask = async () => undefined;

describe("card", () => {
  it("has nothing to show when no feature offers an action", () => {
    expect(card(book, [])).toEqual({ kind: "none" });
    expect(card(book, [{ buttons: [] }])).toEqual({ kind: "none" });
  });

  it("asks at once when the only action is a question", () => {
    const result = card(book, [{ buttons: [{ text: "V", data: "v" }], ask }]);
    expect(result).toEqual({ kind: "ask", ask });
  });

  it("shows a card for one action that starts work", () => {
    const result = card(book, [{ buttons: [{ text: "T", data: "t" }] }]);
    expect(result.kind).toBe("card");
  });

  it("puts every feature's buttons and lines on one card", () => {
    const result = card(book, [
      { buttons: [{ text: "🎧 Voice", data: "v" }], lines: ["Voiced 1"], ask },
      { buttons: [{ text: "🌐 Translate", data: "t" }], lines: ["Half"] },
    ]);
    if (result.kind !== "card") throw new Error(result.kind);
    expect(result.text).toBe(
      "📕 <b>T</b>\nA\n\n<blockquote>English · 2 chapters\nVoiced 1\nHalf</blockquote>",
    );
    expect(
      result.keyboard.inline_keyboard.map((row) =>
        row.map((b) => ("callback_data" in b ? b.callback_data : "")),
      ),
    ).toEqual([["v"], ["t"]]);
  });

  it("shows the cover and the info of a book on the card", () => {
    const result = card(book, [{ buttons: [{ text: "T", data: "t" }] }], {
      cover: "/c.jpg",
      year: 2007,
      pages: 96,
      description: "Про щось.",
    });
    if (result.kind !== "card") throw new Error(result.kind);
    expect(result.photo).toBe("/c.jpg");
    expect(result.text).toBe(
      "📕 <b>T</b>\nA\n\n<blockquote>English · 2 chapters · 2007 · ~96 pages</blockquote>\n\nПро щось.",
    );
  });

  it("names a YouTube video", () => {
    const result = card({ kind: "youtube", id: "dQw4w9WgXcQ" }, [
      { buttons: [{ text: "a", data: "a" }] },
      { buttons: [{ text: "b", data: "b" }] },
    ]);
    if (result.kind !== "card") throw new Error(result.kind);
    expect(result.text).toBe("🎬 <b>YouTube video</b>");
  });
});

describe("routeText", () => {
  const karaoke = {
    id: "k",
    title: "k",
    actions: async (input: Input) =>
      input.kind === "youtube"
        ? { buttons: [{ text: "🎤", data: "k" }], ask }
        : undefined,
  };

  it("passes on text whose link no feature can use, such as pasted lyrics", async () => {
    expect(
      await routeText("la la\nSource: https://example.com/song", [karaoke]),
    ).toBeUndefined();
  });

  it("passes on text without a link", async () => {
    expect(await routeText("Art of Learning", [karaoke])).toBeUndefined();
  });

  it("answers a YouTube link a feature can use", async () => {
    expect(await routeText("https://youtu.be/dQw4w9WgXcQ", [karaoke])).toEqual({
      kind: "ask",
      ask,
    });
  });
});
