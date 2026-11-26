import { describe, expect, it } from "vitest";
import { TRACK_CHARS, groupChapters } from "./tracks.ts";

const chapter = (title: string, size: number) => ({
  title,
  text: "а".repeat(size),
});

describe("groupChapters", () => {
  it("joins short neighbours and puts the later titles on their own lines", () => {
    const [track, ...rest] = groupChapters([
      chapter("One", 300),
      chapter("Two", 400),
    ]);
    expect(rest).toEqual([]);
    expect(track.title).toBe("One");
    expect(track.text).toBe(`${"а".repeat(300)}\nTwo\n${"а".repeat(400)}`);
  });

  it("does not repeat a title the text already starts with", () => {
    const [track] = groupChapters([
      chapter("One", 10),
      { title: "Two", text: "Two\nbody" },
    ]);
    expect(track.text).toBe(`${"а".repeat(10)}\nTwo\nbody`);
  });

  it("starts a new track when the next chapter would not fit", () => {
    const tracks = groupChapters([
      chapter("A", TRACK_CHARS - 100),
      chapter("B", 200),
      chapter("C", 200),
    ]);
    expect(tracks.map((t) => t.title)).toEqual(["A", "B"]);
  });

  it("leaves Verne-like chapters, where no two neighbours fit, untouched", () => {
    const input = [6259, 11582, 12771, 5741, 5448].map((size, i) =>
      chapter(`Розділ ${i + 1}`, size),
    );
    expect(groupChapters(input)).toEqual(input);
  });

  it("keeps a chapter longer than a track on its own", () => {
    const input = [chapter("Long", TRACK_CHARS * 2), chapter("Short", 10)];
    expect(groupChapters(input).map((t) => t.title)).toEqual(["Long", "Short"]);
  });
});
