import { describe, expect, it } from "vitest";
import { karaoke } from "./index.ts";

describe("karaoke.actions", () => {
  it("offers karaoke for a YouTube video, with the version as its question", async () => {
    const actions = await karaoke.actions?.({
      kind: "youtube",
      id: "dQw4w9WgXcQ",
    });
    expect(actions?.buttons).toEqual([
      { text: "🎤 Karaoke", data: "karaoke:open:dQw4w9WgXcQ" },
    ]);
    expect(actions?.ask).toBeTypeOf("function");
  });

  it("offers nothing for another link", async () => {
    expect(
      await karaoke.actions?.({ kind: "link", url: "https://example.com" }),
    ).toBeUndefined();
  });
});
