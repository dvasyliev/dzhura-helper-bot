import { describe, expect, it } from "vitest";
import {
  MIN_TRACK_CHARS,
  PART_CHARS,
  TRACK_CHARS,
  groupChapters,
  groupParts,
} from "./tracks.ts";

const chapter = (title: string, size: number) => ({
  title,
  text: "а".repeat(size),
});

describe("groupChapters by the book's chapters", () => {
  const sized = (title: string, size: number, level?: number) => ({
    title,
    text: "а".repeat(size),
    level,
  });

  it("makes each top-level chapter one track, however long, with its sections", () => {
    const tracks = groupChapters([
      sized("Intro", 100, 1),
      sized("One", TRACK_CHARS, 1),
      sized("One A", TRACK_CHARS, 2),
      sized("Two", TRACK_CHARS, 1),
    ]);
    expect(tracks.map((t) => t.title)).toEqual(["Intro", "One", "Two"]);
    expect(tracks[1].text).toContain("\nOne A\n");
  });

  it("guesses chapters from numbered titles in a flat list", () => {
    const tracks = groupChapters([
      sized("About the book", TRACK_CHARS),
      sized("About the author", TRACK_CHARS),
      sized("Chapter 1 | Summary", TRACK_CHARS),
      sized("Key ideas", TRACK_CHARS),
      sized("Chapter 2 | Summary", TRACK_CHARS),
      sized("3.Question", TRACK_CHARS),
      sized("Afterword", TRACK_CHARS),
      sized("Copyright", TRACK_CHARS),
    ]);
    expect(tracks.map((t) => t.title)).toEqual([
      "About the book",
      "Chapter 1 | Summary",
      "Chapter 2 | Summary",
      "Afterword",
    ]);
  });

  it("counts «1. X» titles only in a run from 1", () => {
    const run = ["1. A", "2. B", "3. C"].map((t) => sized(t, TRACK_CHARS));
    expect(groupChapters(run)).toHaveLength(3);
    const loose = ["3. A", "5. B", "9. C"].map((t) => sized(t, 10));
    expect(groupChapters(loose)).toHaveLength(1);
  });

  it("joins a chapter of under about 2 minutes to the track before it", () => {
    const tracks = groupChapters([
      sized("About the book", 100),
      sized("Chapter 1 Summary", TRACK_CHARS),
      sized("Chapter 1 Quotes", MIN_TRACK_CHARS - 1),
      sized("Chapter 2 Quotes", TRACK_CHARS),
      sized("Chapter 1 Quiz", 10),
      sized("Chapter 2 Quiz", 10),
    ]);
    expect(tracks.map((t) => t.title)).toEqual([
      "About the book",
      "Chapter 1 Summary",
      "Chapter 2 Quotes",
    ]);
    expect(tracks[2].text).toContain("\nChapter 2 Quiz\n");
  });

  it("knows Ukrainian and Cyrillic-lookalike numerals", () => {
    const titles = ["Частина друга", "Розділ ХІІ. X", "Глава 5", "Книга перша"];
    expect(
      groupChapters(titles.map((t) => sized(t, TRACK_CHARS))),
    ).toHaveLength(4);
  });
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

describe("groupParts", () => {
  const track = (size: number) => ({ text: "а".repeat(size) });
  const sizes = (parts: { text: string }[][]) =>
    parts.map((p) => p.map((t) => t.text.length));

  it("groups tracks up to PART_CHARS", () => {
    expect(
      sizes(
        groupParts([
          track(12_000),
          track(12_000),
          track(12_000),
          track(12_000),
          track(12_000),
        ]),
      ),
    ).toEqual([
      [12_000, 12_000, 12_000],
      [12_000, 12_000],
    ]);
    expect(PART_CHARS).toBe(46_000);
  });

  it("puts at most 10 tracks in a part", () => {
    expect(
      groupParts(Array.from({ length: 25 }, () => track(100))).map(
        (p) => p.length,
      ),
    ).toEqual([10, 10, 5]);
  });

  it("keeps a track longer than a part on its own", () => {
    expect(
      sizes(groupParts([track(100), track(PART_CHARS + 1), track(100)])),
    ).toEqual([[100], [PART_CHARS + 1], [100]]);
  });

  it("gives Verne-like tracks (median ~12.8k) 3 tracks a part", () => {
    const parts = groupParts(Array.from({ length: 71 }, () => track(12_800)));
    expect(parts.slice(0, -1).every((p) => p.length === 3)).toBe(true);
    expect(parts).toHaveLength(24);
  });
});
