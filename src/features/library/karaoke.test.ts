import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { karaokeItems, makeButton, songs, type Song } from "./karaoke.ts";

const meta = { duration: 10, width: 640, height: 360 };

function song(folder: string, files: Song["files"]): Song {
  return { folder, id: `id-${folder}`, meta, files };
}

const file = (name: string, mtime = 1) => ({ file: name, size: 5, mtime });

describe("karaokeItems", () => {
  it("a song with only the karaoke file gets a placeholder for vocals", () => {
    const items = karaokeItems(
      [song("Song", { music: file("Song (Karaoke).mp4") })],
      [],
      {},
    );
    expect(items[0]).toMatchObject({
      key: "Song/music",
      kind: "video",
      caption: "Song (Karaoke)",
      video: meta,
    });
    expect(items[1]).toEqual({
      key: "Song/vocals",
      kind: "text",
      text: "⏳ Song (Vocals) — not made yet",
      button: { text: "🎤 Make it", data: "karaoke:make:id-Song:vocals" },
    });
  });

  it("an uploaded version is its YouTube link", () => {
    const items = karaokeItems(
      [song("Song", { music: file("Song (Karaoke).mp4") })],
      [],
      { "Song (Karaoke)": "abc" },
    );
    expect(items[0]).toEqual({
      key: "Song/music",
      kind: "text",
      text: "Song (Karaoke)\nhttps://youtu.be/abc",
    });
  });

  it("posted songs keep their order, new songs go last", () => {
    const a = song("A", { music: file("A (Karaoke).mp4", 5) });
    const b = song("B", { music: file("B (Karaoke).mp4", 3) });
    const c = song("C", { music: file("C (Karaoke).mp4", 1) });
    const keys = karaokeItems([a, b, c], ["B/music", "B/vocals"], {}).map(
      (i) => i.key,
    );
    expect(keys).toEqual([
      "B/music",
      "B/vocals",
      "C/music",
      "C/vocals",
      "A/music",
      "A/vocals",
    ]);
  });
});

describe("makeButton", () => {
  it("data fits 64 bytes", () => {
    const button = makeButton("dQw4w9WgXcQ", "vocals");
    expect(button.data).toBe("karaoke:make:dQw4w9WgXcQ:vocals");
    expect(Buffer.byteLength(button.data)).toBeLessThanOrEqual(64);
  });
});

describe("songs", () => {
  it("songs ignores HQ copies, clip.mp4 and folders without current versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "karaoke-"));
    const put = async (path: string, text = "x") => {
      await mkdir(join(dir, path, ".."), { recursive: true });
      await writeFile(join(dir, path), text);
    };
    const m = JSON.stringify({
      id: "i1",
      title: "t",
      artist: "a",
      track: "k",
      ...meta,
    });
    await put("X/meta.json", m);
    await put("X/X (Karaoke).mp4");
    await put("X/X (Karaoke) (HQ).mp4");
    await put("X/X (без голосу).mp4");
    await put("X/clip.mp4");
    await put("Old/meta.json", m);
    await put("Old/Old (без голосу).mp4");
    await put("Old/clip.mp4");
    await put("NoMeta/NoMeta (Karaoke).mp4");
    await utimes(join(dir, "X/X (Karaoke).mp4"), 100, 100);

    const result = await songs(dir);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ folder: "X", id: "i1", meta });
    expect(Object.keys(result[0]!.files)).toEqual(["music"]);
    expect(result[0]!.files.music).toMatchObject({
      file: join(dir, "X/X (Karaoke).mp4"),
      size: 1,
      mtime: 100000,
    });
  });
});
