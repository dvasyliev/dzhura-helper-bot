import { describe, expect, it } from "vitest";
import { folderKey } from "../translate/button.ts";
import { audiobook } from "./index.ts";

const input = (language: "en" | "ru" | "uk") => ({
  kind: "book" as const,
  folder: "Nobody - Not a real book",
  language,
  book: {
    title: "Not a real book",
    author: "Nobody",
    chapters: [{ title: "1", text: "x" }],
  },
});

describe("audiobook.actions", () => {
  it("offers voicing for an English or Ukrainian book, with the voices as its question", async () => {
    for (const language of ["en", "uk"] as const) {
      const actions = await audiobook.actions?.(input(language));
      expect(actions?.buttons).toEqual([
        {
          text: "🎧 Voice",
          data: `voice-book:${folderKey("Nobody - Not a real book")}`,
        },
      ]);
      expect(actions?.ask).toBeTypeOf("function");
    }
  });

  it("offers nothing for a Russian book or a YouTube link", async () => {
    expect(await audiobook.actions?.(input("ru"))).toBeUndefined();
    expect(
      await audiobook.actions?.({ kind: "youtube", id: "dQw4w9WgXcQ" }),
    ).toBeUndefined();
  });
});
